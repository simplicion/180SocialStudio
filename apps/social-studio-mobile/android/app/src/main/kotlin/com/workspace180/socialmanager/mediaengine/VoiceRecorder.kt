package com.workspace180.socialmanager.mediaengine

import android.content.Context
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import java.io.File

/**
 * Records a voiceover from the microphone to an AAC .m4a on the device (E2.4). One recording at a time; the caller
 * must hold RECORD_AUDIO. The file never leaves the phone; the timeline references it as a local asset.
 */
class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var path: String? = null
    private var startedAt = 0L

    val isRecording: Boolean get() = recorder != null

    fun start(outputPath: String) {
        if (recorder != null) throw MediaEngineError("RECORDING_ACTIVE", "A voiceover is already being recorded")
        File(outputPath).parentFile?.mkdirs()
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioSamplingRate(44_100)
            r.setAudioEncodingBitRate(128_000)
            r.setAudioChannels(1)
            r.setOutputFile(outputPath)
            r.prepare()
            r.start()
        } catch (e: Exception) {
            r.release()
            File(outputPath).delete()
            throw MediaEngineError("RECORDING_FAILED", "The microphone could not start: ${e.message ?: e.javaClass.simpleName}")
        }
        recorder = r
        path = outputPath
        startedAt = SystemClock.elapsedRealtime()
    }

    /** Stops and returns {path, durationMs}. A recording too short to hold audio is deleted and reported. */
    fun stop(): Map<String, Any> {
        val r = recorder ?: throw MediaEngineError("NOT_RECORDING", "No voiceover is being recorded")
        val out = path!!
        val elapsed = SystemClock.elapsedRealtime() - startedAt
        recorder = null
        path = null
        try {
            r.stop()
        } catch (e: RuntimeException) {
            // MediaRecorder throws when stopped before any audio was written.
            File(out).delete()
            throw MediaEngineError("RECORDING_TOO_SHORT", "The recording was too short. Hold the button a little longer.")
        } finally {
            r.release()
        }
        val probed = try {
            MediaMetadataRetriever().run {
                try {
                    setDataSource(out)
                    extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                } finally {
                    release()
                }
            }
        } catch (_: Exception) {
            null
        }
        return mapOf("path" to out, "durationMs" to (probed ?: elapsed))
    }

    fun cancel() {
        val r = recorder ?: return
        recorder = null
        try { r.stop() } catch (_: RuntimeException) {}
        r.release()
        path?.let { File(it).delete() }
        path = null
    }
}
