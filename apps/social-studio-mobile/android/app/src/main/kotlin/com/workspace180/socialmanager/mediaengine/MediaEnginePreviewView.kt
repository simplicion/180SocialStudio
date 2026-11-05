package com.workspace180.socialmanager.mediaengine

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.View
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.CompositionPlayer
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import java.util.concurrent.Executors

/** Creates [MediaEnginePreviewView]s for the Dart `NativeCompositionPreview` widget (view type [VIEW_TYPE]). */
@UnstableApi
class MediaEnginePreviewFactory(private val messenger: BinaryMessenger) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    companion object {
        const val VIEW_TYPE = "com.workspace180.socialmanager/media_engine_preview"
        const val CHANNEL_PREFIX = "com.workspace180.socialmanager/media_engine_preview_"
    }

    override fun create(context: Context, viewId: Int, args: Any?): PlatformView = MediaEnginePreviewView(context, viewId, messenger)
}

/**
 * Live editor preview (audit F-14): a Media3 [CompositionPlayer] on a SurfaceView playing the SAME composition the
 * export renders ([CompositionFactory], mode PREVIEW: proxies, preview resolution, no loudness pass).
 *
 * Per-view MethodChannel `com.workspace180.socialmanager/media_engine_preview_<viewId>`:
 *   Dart -> native: setTimeline {editIrJson, assetPaths, proxyPaths, overlayPaths, musicPaths, fontPaths, sfxPaths,
 *                   watermarkPath} (debounced [DEBOUNCE_MS]), seek {ms}, play, pause.
 *   native -> Dart: position {ms, playing} (every ~50 ms while playing, and on every state change),
 *                   timeline {durationMs, warnings} after a timeline was built, error {code, message}.
 */
@UnstableApi
class MediaEnginePreviewView(
    private val context: Context,
    viewId: Int,
    messenger: BinaryMessenger,
) : PlatformView, MethodChannel.MethodCallHandler {
    private companion object {
        const val DEBOUNCE_MS = 150L
        const val TICK_MS = 50L
    }

    private val surface = SurfaceView(context)
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var channel: MethodChannel? = MethodChannel(messenger, MediaEnginePreviewFactory.CHANNEL_PREFIX + viewId).also {
        it.setMethodCallHandler(this)
    }
    private var player: CompositionPlayer? = null

    /// Kept across timeline rebuilds (a new player gets the same volume).
    private var volume = 1f
    private var pendingBuild: Runnable? = null
    private var generation = 0
    private var durationMs = 0L
    private var cropPans: List<CropPanTransformation> = emptyList()
    private var disposed = false

    private val ticker = object : Runnable {
        override fun run() {
            emitPosition()
            if (player?.isPlaying == true) main.postDelayed(this, TICK_MS)
        }
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            main.removeCallbacks(ticker)
            if (isPlaying) main.post(ticker) else emitPosition()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED) {
                player?.pause()
                emitPosition()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            send("error", mapOf("code" to "PREVIEW_PLAYBACK_FAILED", "message" to "${error.errorCodeName}: ${error.message ?: ""}".trim()))
        }
    }

    private fun ensurePlayer(): CompositionPlayer = player ?: CompositionPlayer.Builder(context).build().also {
        it.addListener(listener)
        it.setVideoSurfaceView(surface)
        it.volume = volume
        player = it
    }

    override fun getView(): View = surface

    override fun dispose() {
        disposed = true
        pendingBuild?.let(main::removeCallbacks)
        main.removeCallbacks(ticker)
        channel?.setMethodCallHandler(null)
        channel = null
        player?.removeListener(listener)
        player?.release()
        player = null
        worker.shutdownNow()
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "setTimeline" -> {
                    scheduleTimeline(call)
                    result.success(null)
                }
                "seek" -> {
                    val ms = (call.argument<Number>("ms")?.toLong() ?: 0L).coerceIn(0L, maxOf(0L, durationMs))
                    cropPans.forEach { it.reanchorAtTimeline(ms.toDouble()) }
                    player?.seekTo(ms)
                    emitPosition()
                    result.success(null)
                }
                "play" -> {
                    val p = player
                    if (p != null) {
                        if (p.currentPosition >= durationMs - 50) seekAndReanchor(p, 0L)
                        p.play()
                    }
                    result.success(null)
                }
                "pause" -> {
                    player?.pause()
                    result.success(null)
                }
                "setVolume" -> {
                    // Muted while a voiceover records, so the microphone does not pick the playback up.
                    val v = ((call.argument<Number>("volume"))?.toFloat() ?: 1f).coerceIn(0f, 1f)
                    player?.volume = v
                    volume = v
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        } catch (e: Exception) {
            result.error("PREVIEW_ERROR", e.message ?: e.toString(), null)
        }
    }

    private fun seekAndReanchor(p: CompositionPlayer, ms: Long) {
        cropPans.forEach { it.reanchorAtTimeline(ms.toDouble()) }
        p.seekTo(ms)
    }

    /** Coalesces rapid edits (a drag notifies every frame): only the last timeline within [DEBOUNCE_MS] is built. */
    private fun scheduleTimeline(call: MethodCall) {
        val json = call.argument<String>("editIrJson") ?: throw MediaEngineError("INVALID_ARGS", "Missing argument 'editIrJson'")
        val media = RenderMedia(
            assetPaths = call.argument<Map<String, String>>("assetPaths") ?: emptyMap(),
            overlayPaths = call.argument<Map<String, String>>("overlayPaths") ?: emptyMap(),
            musicPaths = call.argument<Map<String, String>>("musicPaths") ?: emptyMap(),
            fontPaths = call.argument<Map<String, String>>("fontPaths") ?: emptyMap(),
            watermarkPath = call.argument<String>("watermarkPath"),
            sfxPaths = call.argument<Map<String, String>>("sfxPaths") ?: emptyMap(),
            proxyPaths = call.argument<Map<String, String>>("proxyPaths") ?: emptyMap(),
        )
        pendingBuild?.let(main::removeCallbacks)
        val gen = ++generation
        val task = Runnable { build(gen, json, media) }
        pendingBuild = task
        main.postDelayed(task, DEBOUNCE_MS)
    }

    /** Parses and builds off the main thread (probing files is I/O), then swaps the composition in on the main thread. */
    private fun build(gen: Int, json: String, media: RenderMedia) {
        if (disposed) return
        worker.execute {
            val warnings = mutableListOf<String>()
            val built = try {
                val ir = MobileEditIr.parse(json)
                warnings.addAll(ir.parseWarnings)
                val factory = CompositionFactory(context, ir, media, RenderOptions(), CompositionMode.PREVIEW, warnings)
                Triple(factory.build(), ir.durationMs, factory.cropPans.toList())
            } catch (e: EditIrException) {
                send("error", mapOf("code" to e.code, "message" to (e.message ?: "invalid editIR")))
                return@execute
            } catch (e: Exception) {
                android.util.Log.e("MediaEnginePreview", "Preview build failed", e)
                send("error", mapOf("code" to "PREVIEW_SETUP_FAILED", "message" to (e.message ?: e.toString())))
                return@execute
            }
            main.post {
                if (disposed || gen != generation) return@post
                apply(built.first, built.second, built.third)
                send("timeline", mapOf("durationMs" to built.second, "warnings" to warnings.distinct()))
            }
        }
    }

    private fun apply(composition: Composition, newDurationMs: Long, pans: List<CropPanTransformation>) {
        val p = ensurePlayer()
        val wasPlaying = p.isPlaying
        val at = if (player != null && durationMs > 0) p.currentPosition.coerceIn(0L, maxOf(0L, newDurationMs - 1)) else 0L
        durationMs = newDurationMs
        cropPans = pans
        pans.forEach { it.reanchorAtTimeline(at.toDouble()) }
        p.setComposition(composition, at) // start position in ms, like every Player position
        p.prepare()
        if (wasPlaying) p.play()
        emitPosition()
    }

    private fun emitPosition() {
        val p = player ?: return
        send("position", mapOf("ms" to p.currentPosition.coerceIn(0L, maxOf(0L, durationMs)), "playing" to p.isPlaying))
    }

    private fun send(method: String, args: Map<String, Any?>) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { send(method, args) }
            return
        }
        channel?.invokeMethod(method, args)
    }
}
