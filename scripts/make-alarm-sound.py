# Generates a loud, attention-grabbing alarm tone for the native arrival alarm.
# Output: android/app/src/main/res/raw/alarm.wav  (mono, 44.1kHz, 16-bit PCM)
# Pure stdlib — no external deps. Run:  python scripts/make-alarm-sound.py
import math, struct, wave, os

SR = 44100
AMP = 0.82            # loud, but short of clipping
PATTERN = [           # (freq Hz, seconds)  — urgent two-tone warble, repeated
    (988, 0.20), (0, 0.06),   # B5
    (1319, 0.20), (0, 0.06),  # E6
    (988, 0.20), (0, 0.06),
    (1319, 0.20), (0, 0.34),  # longer gap = "ring … ring …"
]
REPEATS = 5           # ~6.5s total; notification plays it once through

frames = bytearray()
for _ in range(REPEATS):
    for freq, dur in PATTERN:
        n = int(SR * dur)
        for i in range(n):
            if freq == 0:
                s = 0.0
            else:
                # quick attack/release envelope to avoid clicks
                env = min(1.0, i / (SR * 0.005), (n - i) / (SR * 0.005))
                s = AMP * env * math.sin(2 * math.pi * freq * i / SR)
            frames += struct.pack('<h', int(s * 32767))

out = os.path.join('android', 'app', 'src', 'main', 'res', 'raw', 'alarm.wav')
os.makedirs(os.path.dirname(out), exist_ok=True)
with wave.open(out, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(bytes(frames))
print('wrote', out, len(frames), 'bytes of PCM')
