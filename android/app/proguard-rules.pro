-keep class com.bytebikri.app.security.** { *; }
-keep class com.bytebikri.app.network.** { *; }

-keep class com.bytebikri.app.network.AuthResponse { *; }
-keep class com.bytebikri.app.network.Asset { *; }
-keep class com.bytebikri.app.network.PurchaseResponse { *; }

-dontwarn okhttp3.**
-dontwarn okio.**
-keepattributes Signature
-keepattributes *Annotation*
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

-keep class kotlin.** { *; }
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**
-keepclassmembers class **$WhenMappings {
    <fields>;
}

-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}

-keep class androidx.compose.** { *; }
-keepclassmembers class androidx.compose.** { *; }

-keep class org.json.** { *; }

-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}

-optimizationpasses 5
-dontusemixedcaseclassnames
-verbose