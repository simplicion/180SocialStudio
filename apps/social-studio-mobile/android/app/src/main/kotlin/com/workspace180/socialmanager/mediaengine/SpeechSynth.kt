package com.workspace180.socialmanager.mediaengine

import android.content.Context
import android.media.MediaMetadataRetriever
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * AI narration on the phone: the system text-to-speech engine writes [text] to a WAV file, which the timeline uses
 * like a recorded voiceover. Nothing is sent to a server. Without a TTS engine / voice for the language the call
 * fails with a typed error (never silence or a placeholder file). Must not run on the main thread.
 */
object SpeechSynth {
    private const val INIT_TIMEOUT_S = 10L
    private const val SYNTH_TIMEOUT_S = 60L

    fun synthesize(context: Context, text: String, outputPath: String, languageTag: String?, rate: Float, pitch: Float): Map<String, Any> {
        val clean = text.trim()
        if (clean.isEmpty()) throw MediaEngineError("INVALID_ARGS", "Type the narration text first")
        if (clean.length > TextToSpeech.getMaxSpeechInputLength()) throw MediaEngineError("INVALID_ARGS", "The narration is too long; split it into shorter lines")
        val ready = CountDownLatch(1)
        var status = TextToSpeech.ERROR
        val tts = TextToSpeech(context.applicationContext) { s -> status = s; ready.countDown() }
        try {
            if (!ready.await(INIT_TIMEOUT_S, TimeUnit.SECONDS) || status != TextToSpeech.SUCCESS) {
                throw MediaEngineError("TTS_NOT_AVAILABLE", "This phone has no text-to-speech engine ready. Install or enable one in Settings > Accessibility > Text-to-speech.")
            }
            val locale = languageTag?.takeIf { it.isNotBlank() }?.let { Locale.forLanguageTag(it) } ?: Locale.getDefault()
            val lang = tts.setLanguage(locale)
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                throw MediaEngineError("TTS_LANGUAGE_UNAVAILABLE", "No text-to-speech voice for ${locale.displayLanguage} on this phone. Download it in Settings > Text-to-speech.")
            }
            tts.setSpeechRate(rate.coerceIn(0.5f, 2f))
            tts.setPitch(pitch.coerceIn(0.5f, 2f))
            val out = File(outputPath)
            out.parentFile?.mkdirs()
            out.delete()
            val done = CountDownLatch(1)
            var error: String? = null
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { done.countDown() }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { error = "synthesis failed"; done.countDown() }
                override fun onError(utteranceId: String?, errorCode: Int) { error = "synthesis failed ($errorCode)"; done.countDown() }
            })
            if (tts.synthesizeToFile(clean, Bundle(), out, "narration") != TextToSpeech.SUCCESS) {
                throw MediaEngineError("TTS_FAILED", "The voice could not be generated")
            }
            if (!done.await(SYNTH_TIMEOUT_S, TimeUnit.SECONDS)) throw MediaEngineError("TTS_FAILED", "Generating the voice took too long")
            error?.let { throw MediaEngineError("TTS_FAILED", "The voice could not be generated: $it") }
            if (!out.isFile || out.length() < 1024) throw MediaEngineError("TTS_FAILED", "The voice engine produced no audio")
            val durationMs = MediaMetadataRetriever().run {
                try {
                    setDataSource(out.path)
                    extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                } finally {
                    release()
                }
            } ?: throw MediaEngineError("TTS_FAILED", "The generated voice file cannot be read")
            return mapOf("path" to out.path, "durationMs" to durationMs)
        } finally {
            tts.shutdown()
        }
    }
}
