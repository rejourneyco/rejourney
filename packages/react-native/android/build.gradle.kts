plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.facebook.react") 
}

// Read newArchEnabled from project properties (Gradle injects from root project's gradle.properties)
// This approach matches react-native-screens and other industry-standard RN libraries
fun isNewArchitectureEnabled(): Boolean {
    // To opt-in for the New Architecture, you can either:
    // - Set `newArchEnabled` to true inside the `gradle.properties` file
    // - Invoke gradle with `-PnewArchEnabled=true`
    // - Set an environment variable `ORG_GRADLE_PROJECT_newArchEnabled=true`
    val newArchEnabled = project.hasProperty("newArchEnabled") && 
                         project.property("newArchEnabled").toString() == "true"
    
    // Log the detection result for debugging
    println("[Rejourney] New Architecture enabled: $newArchEnabled (project: ${project.name})")
    
    return newArchEnabled
}

android {
    namespace = "com.rejourney"
    compileSdk = 35

    // Enable BuildConfig generation (required for IS_NEW_ARCHITECTURE_ENABLED)
    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        
        // Pass new architecture flag to BuildConfig - read from root project (app)
        val isNewArchEnabled = isNewArchitectureEnabled()
        buildConfigField("boolean", "IS_NEW_ARCHITECTURE_ENABLED", isNewArchEnabled.toString())
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }
}

// Dual Architecture Support:
// - When newArchEnabled=true: compile newarch/ source set (TurboModules + codegen NativeRejourneySpec)
// - When newArchEnabled=false: compile oldarch/ source set (Bridge)
val isNewArchEnabled = isNewArchitectureEnabled()

android.sourceSets {
    getByName("main") {
        if (isNewArchEnabled) {
            // New Architecture: include newarch sources
            // Codegen generates NativeRejourneySpec.java in build/generated/source/codegen/java/
            // which is automatically added by the React Native Gradle plugin
            java.srcDirs("src/main/java", "src/newarch/java")
        } else {
            // Old Architecture: include oldarch sources
            java.srcDirs("src/main/java", "src/oldarch/java")
        }
    }
}

/* 
// Ensure codegen directory exists before CMake runs
// This is a workaround until codegen runs automatically
tasks.register("ensureCodegenDirectory") {
    doLast {
        val codegenDir = file("build/generated/source/codegen/jni")
        codegenDir.mkdirs()
        // Create stub CMakeLists.txt if it doesn't exist
        val cmakeFile = file("build/generated/source/codegen/jni/CMakeLists.txt")
        if (!cmakeFile.exists()) {
            cmakeFile.writeText("""
                # Temporary stub CMakeLists.txt for codegen directory
                # This file will be replaced when codegen runs and generates the actual bindings
                cmake_minimum_required(VERSION 3.13)
                # Create a stub library target that will be replaced by actual codegen output
                add_library(react_codegen_RejourneySpec INTERFACE)
                # This is a placeholder - actual codegen will generate the real implementation
                message(STATUS "Using stub codegen for RejourneySpec - codegen should run to generate actual bindings")
            """.trimIndent())
        }
    }
}

// Run ensureCodegenDirectory before any build task
tasks.named("preBuild").configure {
    dependsOn("ensureCodegenDirectory")
}
*/

dependencies {
    // React Native
    implementation("com.facebook.react:react-android")

    // Kotlin Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // OkHttp for networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // WorkManager for background uploads
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Encrypted SharedPreferences for secure storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // AndroidX Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    
    // RecyclerView for layout serialization
    implementation("androidx.recyclerview:recyclerview:1.3.2")

    // Lifecycle for ProcessLifecycleOwner (reliable app foreground/background detection)
    implementation("androidx.lifecycle:lifecycle-process:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
}