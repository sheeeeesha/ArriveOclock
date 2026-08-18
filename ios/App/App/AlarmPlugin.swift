import Foundation
import Capacitor
import AVFoundation
import AudioToolbox
import UserNotifications
import CoreLocation
import UIKit

/**
 * iOS arrival alarm — mirrors the Android Alarm plugin's JS contract:
 *   Alarm.set({ at, title, body })  schedule (or ring now) the arrival alarm
 *   Alarm.cancel()                  cancel pending + stop any ringing
 *   Alarm.stop()                    stop ringing only
 *
 * iOS has no AlarmManager/full-screen-intent equivalent, so:
 *  - LIVE fire (at <= now): loop the bundled alarm.wav via AVAudioPlayer on a
 *    .playback session — this ignores the silent switch and, because the app
 *    has the `audio` + `location` background modes and is kept alive by the
 *    background-geolocation watcher during a journey, it sounds even with the
 *    screen locked. A time-sensitive local notification is posted too, so the
 *    user sees why their phone is ringing on the lock screen.
 *  - SCHEDULED backstop (at > now): a burst of time-sensitive local
 *    notifications (t, +8s, +16s, +24s) each playing alarm.wav — the closest
 *    iOS gets to an alarm if the OS suspends JS before arrival. Stable ids so
 *    re-scheduling replaces the previous backstop instead of stacking.
 */
@objc(AlarmPlugin)
public class AlarmPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AlarmPlugin"
    public let jsName = "Alarm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSetting", returnType: CAPPluginReturnPromise)
    ]

    private static let backstopIds = (0..<4).map { "aoc-backstop-\($0)" }
    private var player: AVAudioPlayer?
    private var vibrateTimer: Timer?

    @objc func set(_ call: CAPPluginCall) {
        let atMs = call.getDouble("at") ?? Date().timeIntervalSince1970 * 1000
        let title = call.getString("title") ?? "Almost there"
        let body = call.getString("body") ?? "You're arriving at your stop."
        // Absolute path to the user's chosen song, or nil for the bundled tone.
        let sound = call.getString("sound")
        // "Gradually increase volume" — applies to the live ring; the
        // notification backstop's sound is played by the system at full volume.
        let fadeIn = call.getBool("fadeIn") ?? false
        let delaySec = (atMs / 1000) - Date().timeIntervalSince1970

        cancelBackstop()
        if delaySec <= 0.5 {
            ringNow(title: title, body: body, sound: sound, fadeIn: fadeIn)
        } else {
            scheduleBackstop(after: delaySec, title: title, body: body)
        }
        call.resolve()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        cancelBackstop()
        stopRinging()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopRinging()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        call.resolve()
    }

    // MARK: - Live ring

    /// The chosen song if it's present and playable, else the bundled tone.
    /// An alarm must never end up silent, so every failure falls back.
    private func alarmURL(_ sound: String?) -> URL? {
        if let path = sound, !path.isEmpty, FileManager.default.fileExists(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        return Bundle.main.url(forResource: "alarm", withExtension: "wav")
    }

    /// Ramp length for "gradually increase volume" — matches FADE_SEC in sound.js.
    private static let fadeSeconds: TimeInterval = 20

    private func ringNow(title: String, body: String, sound: String?, fadeIn: Bool) {
        // Post a notification first (lock-screen visibility + sound fallback if
        // the audio session can't start).
        postNotification(title: title, body: body, after: 0.1, id: "aoc-live")

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            do {
                let session = AVAudioSession.sharedInstance()
                // .playback ignores the silent switch; .duckOthers keeps it polite.
                try session.setCategory(.playback, options: [.duckOthers])
                try session.setActive(true)
                // AVAudioPlayer handles mp3/m4a/wav of any length, so the full
                // song plays here — unlike the notification sound below.
                if let url = self.alarmURL(sound) {
                    do {
                        self.player = try AVAudioPlayer(contentsOf: url)
                    } catch {
                        // Unreadable/corrupt song — retry with the bundled tone.
                        if let fallback = Bundle.main.url(forResource: "alarm", withExtension: "wav") {
                            self.player = try? AVAudioPlayer(contentsOf: fallback)
                        }
                    }
                    self.player?.numberOfLoops = -1 // loop until stopped
                    if fadeIn {
                        // Start near-silent and let AVAudioPlayer ramp it up.
                        self.player?.volume = 0.06
                        self.player?.play()
                        self.player?.setVolume(1.0, fadeDuration: AlarmPlugin.fadeSeconds)
                    } else {
                        self.player?.volume = 1.0
                        self.player?.play()
                    }
                }
            } catch {
                CAPLog.print("AlarmPlugin: audio session failed — notification sound is the fallback", error)
            }
            // Repeating vibration while ringing.
            self.vibrateTimer?.invalidate()
            self.vibrateTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { _ in
                AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            }
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            // Safety: never ring forever (2 min cap, matching Android).
            DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
                self?.stopRinging()
            }
        }
    }

    private func stopRinging() {
        DispatchQueue.main.async { [weak self] in
            self?.player?.stop()
            self?.player = nil
            self?.vibrateTimer?.invalidate()
            self?.vibrateTimer = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    // MARK: - Scheduled backstop

    private func scheduleBackstop(after delaySec: Double, title: String, body: String) {
        // A burst of notifications approximates a looping alarm on iOS.
        for (i, id) in AlarmPlugin.backstopIds.enumerated() {
            postNotification(title: title, body: body, after: delaySec + Double(i) * 8.0, id: id)
        }
    }

    private func postNotification(title: String, body: String, after: Double, id: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        // Deliberately the bundled tone, NOT the user's song: iOS notification
        // sounds must be <=30s, live in the bundle or Library/Sounds, and be
        // CAF/AIFF/WAV (mp3 is not supported). The chosen song plays through
        // AVAudioPlayer in ringNow() instead, which has none of those limits.
        content.sound = UNNotificationSound(named: UNNotificationSoundName("alarm.wav"))
        if #available(iOS 15.0, *) {
            // Breaks through Focus/scheduled-summary. Requires the
            // time-sensitive entitlement (in App.entitlements).
            content.interruptionLevel = .timeSensitive
        }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(0.1, after), repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error { CAPLog.print("AlarmPlugin: schedule failed", error) }
        }
    }

    private func cancelBackstop() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: AlarmPlugin.backstopIds + ["aoc-live"])
        center.removeDeliveredNotifications(withIdentifiers: AlarmPlugin.backstopIds + ["aoc-live"])
    }

    // MARK: - Alarm-reliability permissions

    /// Mirrors the Android contract so the JS permission panel is shared. iOS has
    /// no battery-optimisation or exact-alarm concept, so those report true —
    /// the OS manages them and there is nothing for the user to fix.
    @objc func permissions(_ call: CAPPluginCall) {
        let status: CLAuthorizationStatus
        if #available(iOS 14.0, *) {
            status = CLLocationManager().authorizationStatus
        } else {
            status = CLLocationManager.authorizationStatus()
        }
        let foreground = status == .authorizedWhenInUse || status == .authorizedAlways
        let always = status == .authorizedAlways

        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let notifs = settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
            call.resolve([
                "fineLocation": foreground,
                "backgroundLocation": always,
                "notifications": notifs,
                "batteryUnrestricted": true,
                "exactAlarms": true
            ])
        }
    }

    /// iOS exposes a single per-app settings page; every target lands there.
    @objc func openSetting(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(url) else {
                call.reject("Could not open settings")
                return
            }
            UIApplication.shared.open(url, options: [:]) { _ in call.resolve() }
        }
    }
}
