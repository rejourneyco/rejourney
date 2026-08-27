# Consumer ProGuard rules for the Rejourney Flutter plugin.
# Applied automatically to apps that depend on this plugin.
#
# These mirror the React Native SDK's rules: both ship the same
# com.rejourney recording core, so both need the same keeps.

-keep class com.rejourney.** { *; }
-keepclassmembers class com.rejourney.** { *; }

# SpecialCases reaches Google Maps and Mapbox through reflection and
# java.lang.reflect.Proxy. The proxies implement third-party listener
# interfaces resolved by name at runtime, so R8 cannot see the link from
# our call sites to those types. Missing classes are expected on apps that
# do not bundle either SDK -- SpecialCases already handles that -- so the
# warning is suppressed rather than the dependency being required.
-dontwarn com.google.android.gms.maps.**
-dontwarn com.mapbox.maps.**
