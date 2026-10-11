package com.workspace180.socialmanager

import android.annotation.SuppressLint
import android.provider.Settings
import androidx.media3.common.util.UnstableApi
import com.workspace180.socialmanager.mediaengine.MediaEnginePlugin
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

@UnstableApi
class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine.plugins.add(MediaEnginePlugin())
        // Stable install key for device-slot reuse after a reinstall. ANDROID_ID (API 26+) is scoped to this app's
        // signing key + user + device and survives uninstall/reinstall; the server stores it only hashed per user.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.workspace180.socialmanager/device")
            .setMethodCallHandler { call, result ->
                if (call.method == "installKey") {
                    @SuppressLint("HardwareIds")
                    val id = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
                    result.success(id)
                } else {
                    result.notImplemented()
                }
            }

        // Direct Native App Launcher: Bypasses the generic Android Share Sheet chooser
        // to directly open the target platform app (YouTube, Pinterest, Instagram, Facebook, X, etc.)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.workspace180.socialmanager/app_launcher")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isAppInstalled" -> {
                        val pkg = call.argument<String>("package")
                        if (pkg.isNullOrEmpty()) {
                            result.success(false)
                            return@setMethodCallHandler
                        }
                        try {
                            context.packageManager.getPackageInfo(pkg, 0)
                            result.success(true)
                        } catch (e: PackageManager.NameNotFoundException) {
                            result.success(false)
                        } catch (t: Throwable) {
                            result.success(false)
                        }
                    }
                    "launchDirectShare" -> {
                        val pkg = call.argument<String>("package")
                        val text = call.argument<String>("text")
                        val title = call.argument<String>("title")
                        val mediaPath = call.argument<String>("mediaPath")
                        val mimeType = call.argument<String>("mimeType") ?: "*/*"

                        try {
                            val intent = Intent(Intent.ACTION_SEND).apply {
                                if (!pkg.isNullOrEmpty()) {
                                    setPackage(pkg)
                                }
                                type = mimeType
                                if (!text.isNullOrEmpty()) {
                                    putExtra(Intent.EXTRA_TEXT, text)
                                }
                                if (!title.isNullOrEmpty()) {
                                    putExtra(Intent.EXTRA_SUBJECT, title)
                                    putExtra(Intent.EXTRA_TITLE, title)
                                }
                                if (!mediaPath.isNullOrEmpty()) {
                                    val file = File(mediaPath)
                                    if (file.exists()) {
                                        val uri: Uri = FileProvider.getUriForFile(
                                            context,
                                            "${context.packageName}.fileprovider",
                                            file
                                        )
                                        putExtra(Intent.EXTRA_STREAM, uri)
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    }
                                }
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }

                            // Check if an activity exists to handle this targeted intent
                            if (intent.resolveActivity(context.packageManager) != null) {
                                context.startActivity(intent)
                                result.success(true)
                            } else {
                                result.error("NOT_INSTALLED", "App not installed: $pkg", null)
                            }
                        } catch (e: Exception) {
                            result.error("LAUNCH_FAILED", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
