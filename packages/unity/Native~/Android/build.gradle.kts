plugins { id("com.android.library") version "9.0.0" }
android {
    namespace = "com.rejourney.unity"
    compileSdk = 36
    ndkVersion = "27.2.12479018"
    System.getenv("REJOURNEY_NDK")?.let { ndkPath = it }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
    defaultConfig { minSdk = 24; ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }; consumerProguardFiles("consumer-rules.pro") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildTypes { release { isMinifyEnabled = false } }
}
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.work:work-runtime-ktx:2.10.2")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.lifecycle:lifecycle-process:2.9.2")
}
