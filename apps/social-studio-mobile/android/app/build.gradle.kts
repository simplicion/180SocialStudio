import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    namespace = "com.workspace180.social_studio_mobile"
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.workspace180.social_studio_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        // The upload key lives outside git (android/key.properties + *.jks are ignored).
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
        }
    }
}

// Debug builds (and CI tests) work without the upload key; a release build without it fails loudly
// instead of producing an APK/AAB the Play Store would reject.
gradle.taskGraph.whenReady {
    val releaseTask = allTasks.any { t ->
        t.project == project && t.name.contains("Release") && (t.name.startsWith("assemble") || t.name.startsWith("bundle"))
    }
    if (releaseTask && !keystorePropertiesFile.exists()) {
        throw GradleException("android/key.properties is missing: release builds must be signed with the upload key.")
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // On-device EditIR renderer (AI Director output) — AndroidX Media3 Transformer.
    val media3Version = "1.11.1"
    implementation("androidx.media3:media3-transformer:$media3Version")
    implementation("androidx.media3:media3-effect:$media3Version")
    implementation("androidx.media3:media3-common:$media3Version")
    // On-device face detection for smart reframe (bundled model, works offline; adds a few MB
    // to the APK, see docs/social-studio-mobile/FREE_MEDIA_SOURCES.md).
    implementation("com.google.mlkit:face-detection:16.1.7")
    // On-device OCR for the AI Director (`media.ocr`): bundled Latin model, offline, no server
    // tokens. Adds about 4 MB per ABI; see docs/social-studio-mobile/SOCIAL_OS_AUDIT.md.
    implementation("com.google.mlkit:text-recognition:16.0.1")
    // On-device scene labels ("laptop", "food", "beach"...) so the AI Director knows what each shot shows without
    // any pixels leaving the phone. Bundled base model (~5.7 MB), offline.
    implementation("com.google.mlkit:image-labeling:17.0.9")
    // On-device person segmentation for "Remove background" (FrameJobs.removeBackground), bundled, offline.
    implementation("com.google.mlkit:segmentation-selfie:16.0.0-beta6")
    // JVM unit tests of the pure analysis algorithms (AnalysisAlgorithms.kt).
    testImplementation("junit:junit:4.12")
}
