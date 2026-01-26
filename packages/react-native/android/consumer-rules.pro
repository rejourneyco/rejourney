# Consumer ProGuard rules for Rejourney SDK
# These rules will be applied to apps that use this library

-keep class com.rejourney.** { *; }
-keepclassmembers class com.rejourney.** { *; }

# Keep React Native bridge annotations
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}
