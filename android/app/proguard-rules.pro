# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Keep rules for R8/minify. Capacitor loads plugins + invokes @PluginMethod
# methods by reflection, so they must not be stripped or renamed. The native
# alarm plugin/activity/receiver are referenced from the manifest and via
# registerPlugin(), so keep the whole app package too.
# ---------------------------------------------------------------------------
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-keep class com.arriveoclock.app.** { *; }
-keep class com.equimaps.capacitor_background_geolocation.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class org.apache.cordova.** { *; }
-dontwarn com.getcapacitor.**
