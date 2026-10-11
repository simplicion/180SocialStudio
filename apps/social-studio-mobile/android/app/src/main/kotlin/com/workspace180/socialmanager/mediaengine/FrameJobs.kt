package com.workspace180.socialmanager.mediaengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Frame-level clip processing on the phone (editor E3): a clip range is decoded to still frames (optionally
 * transformed, e.g. background removed), optionally in reverse with its audio reversed, and encoded back to an
 * H.264/AAC mp4 that the timeline then uses as an ordinary local clip. Nothing leaves the device.
 */
@UnstableApi
object FrameJobs {
    /** Longest range processed in one job (memory / time bound). */
    const val MAX_RANGE_MS = 60_000L
    private const val MAX_FPS = 30.0
    private const val CHUNK = 8

    data class FrameSet(val files: List<File>, val fps: Double, val width: Int, val height: Int)

    /**
     * Decodes [startMs, endMs) of [src] as JPEG frames in [dir], at most [maxShortSide] on the short side and 30 fps,
     * upright. [reverse] writes them last-to-first. [transform] (called in playback order) may replace each frame.
     */
    fun extractFrames(
        src: String,
        startMs: Long,
        endMs: Long,
        dir: File,
        maxShortSide: Int,
        reverse: Boolean,
        control: AnalysisControl,
        transform: ((Bitmap) -> Bitmap)? = null,
    ): FrameSet {
        MediaTools.requireFile(src)
        if (endMs - startMs < 100) throw MediaEngineError("INVALID_ARGS", "The range is too short")
        if (endMs - startMs > MAX_RANGE_MS) throw MediaEngineError("RANGE_TOO_LONG", "Pick a part shorter than ${MAX_RANGE_MS / 1000} s")
        val info = MediaTools.getVideoInfo(src)
        if (info["hasVideo"] != true) throw MediaEngineError("NO_VIDEO_TRACK", "No video track in $src")
        val durationMs = (info["durationMs"] as Number).toLong()
        val rotation = (info["rotation"] as Number?)?.toInt() ?: 0
        val displayW = (info["displayWidth"] as Number).toInt()
        val displayH = (info["displayHeight"] as Number).toInt()
        val end = min(endMs, durationMs)
        dir.deleteRecursively()
        dir.mkdirs()
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(src)
            val frameCount = if (Build.VERSION.SDK_INT >= 28) r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toIntOrNull() else null
            val srcFps = (info["frameRate"] as Number?)?.toDouble()?.takeIf { it > 1 }
                ?: frameCount?.let { it * 1000.0 / durationMs }
                ?: 30.0
            val step = max(1, (srcFps / MAX_FPS).roundToInt())
            val fps = srcFps / step
            val scale = min(1.0, maxShortSide.toDouble() / min(displayW, displayH))
            val outW = (displayW * scale).roundToInt() / 2 * 2
            val outH = (displayH * scale).roundToInt() / 2 * 2

            fun upright(b: Bitmap): Bitmap {
                // Some decoders return frames without the container rotation applied.
                val needsTurn = rotation % 180 != 0 && (b.height > b.width) != (displayH > displayW)
                val m = Matrix()
                if (needsTurn) m.postRotate(rotation.toFloat())
                val turned = if (needsTurn) Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true) else b
                val out = if (turned.width != outW || turned.height != outH) Bitmap.createScaledBitmap(turned, outW, outH, true) else turned
                if (turned !== b && turned !== out) turned.recycle()
                return out
            }

            // Frame times in playback order.
            val times = generateSequence(startMs.toDouble()) { it + 1000.0 / fps }.takeWhile { it < end - 1 }.toList()
            if (times.isEmpty()) throw MediaEngineError("INVALID_ARGS", "No frames in that range")
            val files = ArrayList<File>(times.size)
            val ordered = times.indices.toList()
            val useIndex = frameCount != null && frameCount > 0
            var i = 0
            while (i < ordered.size) {
                control.check()
                val chunk = ordered.subList(i, min(ordered.size, i + CHUNK))
                val bitmaps: List<Bitmap?> = if (useIndex && Build.VERSION.SDK_INT >= 28) {
                    val first = ((times[chunk.first()] / 1000.0) * srcFps).roundToInt().coerceIn(0, frameCount!! - 1)
                    val last = ((times[chunk.last()] / 1000.0) * srcFps).roundToInt().coerceIn(first, frameCount - 1)
                    val decoded = r.getFramesAtIndex(first, last - first + 1)
                    chunk.map { k ->
                        val idx = ((times[k] / 1000.0) * srcFps).roundToInt().coerceIn(first, last)
                        decoded.getOrNull(idx - first)
                    }.also { picked -> decoded.filter { d -> picked.none { it === d } }.forEach { it.recycle() } }
                } else {
                    chunk.map { k -> r.getFrameAtTime((times[k] * 1000).roundToLong(), MediaMetadataRetriever.OPTION_CLOSEST) }
                }
                for ((n, k) in chunk.withIndex()) {
                    val raw = bitmaps[n] ?: continue
                    val up = upright(raw)
                    if (up !== raw) raw.recycle()
                    val done = transform?.invoke(up) ?: up
                    if (done !== up) up.recycle()
                    val f = File(dir, "f_%06d.jpg".format(k))
                    FileOutputStream(f).use { done.compress(Bitmap.CompressFormat.JPEG, 92, it) }
                    done.recycle()
                    files.add(f)
                }
                control.onProgress(0.8 * (i + chunk.size).toDouble() / ordered.size)
                i += CHUNK
            }
            if (files.isEmpty()) throw MediaEngineError("FRAME_SCAN_UNAVAILABLE", "This device's video decoder does not expose frames for processing")
            val sorted = files.sortedBy { it.name }
            return FrameSet(if (reverse) sorted.reversed() else sorted, fps, outW, outH)
        } finally {
            r.release()
        }
    }

    /** The audio of [startMs, endMs) decoded to 16-bit PCM, reversed when [reverse], as a WAV; null without audio. */
    fun audioWav(src: String, startMs: Long, endMs: Long, reverse: Boolean, outWav: File, control: AnalysisControl): File? {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(src)
            val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: return null
            val fmt = ex.getTrackFormat(track)
            ex.selectTrack(track)
            ex.seekTo(startMs * 1000, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
            codec.configure(fmt, null, null, 0)
            codec.start()
            var sampleRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val pcm = java.io.ByteArrayOutputStream()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            try {
                while (!outputDone) {
                    control.check()
                    if (!inputDone) {
                        val inIdx = codec.dequeueInputBuffer(10_000)
                        if (inIdx >= 0) {
                            val buf = codec.getInputBuffer(inIdx)!!
                            val n = ex.readSampleData(buf, 0)
                            if (n < 0 || ex.sampleTime > endMs * 1000 + 100_000) {
                                codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(inIdx, 0, n, ex.sampleTime, 0)
                                ex.advance()
                            }
                        }
                    }
                    val outIdx = codec.dequeueOutputBuffer(info, 10_000)
                    if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val of = codec.outputFormat
                        sampleRate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (of.containsKey(MediaFormat.KEY_PCM_ENCODING) && of.getInteger(MediaFormat.KEY_PCM_ENCODING) != 2 /* ENCODING_PCM_16BIT */) {
                            throw MediaEngineError("AUDIO_FORMAT", "Unsupported decoded audio format")
                        }
                    } else if (outIdx >= 0) {
                        if (info.size > 0) {
                            val buf = codec.getOutputBuffer(outIdx)!!
                            val bytesPerFrame = 2 * channels
                            val frames = info.size / bytesPerFrame
                            val t0 = info.presentationTimeUs
                            // Keep only the samples inside [start, end).
                            val first = max(0L, ((startMs * 1000 - t0) * sampleRate / 1_000_000)).toInt()
                            val last = min(frames.toLong(), ((endMs * 1000 - t0) * sampleRate / 1_000_000)).toInt()
                            if (last > first) {
                                val bytes = ByteArray((last - first) * bytesPerFrame)
                                buf.position(info.offset + first * bytesPerFrame)
                                buf.get(bytes)
                                pcm.write(bytes)
                            }
                        }
                        codec.releaseOutputBuffer(outIdx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            } finally {
                codec.stop()
                codec.release()
            }
            var data = pcm.toByteArray()
            if (data.isEmpty()) return null
            if (reverse) {
                val bpf = 2 * channels
                val out = ByteArray(data.size)
                val n = data.size / bpf
                for (f in 0 until n) System.arraycopy(data, f * bpf, out, (n - 1 - f) * bpf, bpf)
                data = out
            }
            writeWav(outWav, data, sampleRate, channels)
            return outWav
        } finally {
            ex.release()
        }
    }

    private fun writeWav(f: File, pcm: ByteArray, sampleRate: Int, channels: Int) {
        f.parentFile?.mkdirs()
        RandomAccessFile(f, "rw").use { out ->
            out.setLength(0)
            val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
            h.put("RIFF".toByteArray()); h.putInt(36 + pcm.size); h.put("WAVE".toByteArray())
            h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(channels.toShort())
            h.putInt(sampleRate); h.putInt(sampleRate * channels * 2); h.putShort((channels * 2).toShort()); h.putShort(16)
            h.put("data".toByteArray()); h.putInt(pcm.size)
            out.write(h.array())
            out.write(pcm)
        }
    }

    /**
     * Encodes [frames] (+ optional [audio] WAV) to [outPath] with Media3 (H.264/AAC). Must be called on a Looper
     * thread; [onDone] runs there with the output path or the error.
     */
    fun encode(context: Context, frames: FrameSet, audio: File?, outPath: String, onDone: (Result<String>) -> Unit) {
        val items = frames.files.mapIndexed { i, f ->
            // Cumulative rounding keeps the total length exact at any frame rate.
            val ms = ((i + 1) * 1000.0 / frames.fps).roundToLong() - (i * 1000.0 / frames.fps).roundToLong()
            EditedMediaItem.Builder(MediaItem.Builder().setUri(Uri.fromFile(f)).setImageDurationMs(ms.coerceAtLeast(1)).build())
                .setFrameRate(frames.fps.roundToInt().coerceIn(1, 60))
                .build()
        }
        val sequences = mutableListOf(EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO)).addItems(items).build())
        if (audio != null) {
            sequences.add(
                EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
                    .addItem(EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(audio))).setRemoveVideo(true).build())
                    .build(),
            )
        }
        File(outPath).parentFile?.mkdirs()
        File(outPath).delete()
        val b = Transformer.Builder(context).setVideoMimeType(MimeTypes.VIDEO_H264)
        if (audio != null) b.setAudioMimeType(MimeTypes.AUDIO_AAC)
        b.addListener(object : Transformer.Listener {
            override fun onCompleted(composition: Composition, exportResult: ExportResult) = onDone(Result.success(outPath))
            override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                File(outPath).delete()
                onDone(Result.failure(MediaEngineError("ENCODE_FAILED", "Could not write the processed clip: ${exportException.errorCodeName}")))
            }
        }).build().start(Composition.Builder(sequences).build(), outPath)
    }

    /** Runs [work] (frames + audio) on [io], then encodes on the main looper, cleaning the frame folder after. */
    fun run(
        context: Context,
        io: java.util.concurrent.Executor,
        workDir: File,
        outPath: String,
        work: () -> Pair<FrameSet, File?>,
        onDone: (Result<Map<String, Any>>) -> Unit,
    ) {
        val main = Handler(Looper.getMainLooper())
        io.execute {
            val prepared = try {
                Result.success(work())
            } catch (e: Throwable) {
                Result.failure(e)
            }
            main.post {
                prepared.fold(
                    { (frames, audio) ->
                        try {
                            encode(context, frames, audio, outPath) { r ->
                                workDir.deleteRecursively()
                                onDone(r.map { path ->
                                    mapOf(
                                        "path" to path,
                                        "durationMs" to (frames.files.size * 1000.0 / frames.fps).roundToLong(),
                                        "width" to frames.width,
                                        "height" to frames.height,
                                    )
                                })
                            }
                        } catch (e: Throwable) {
                            workDir.deleteRecursively()
                            onDone(Result.failure(e))
                        }
                    },
                    { e ->
                        workDir.deleteRecursively()
                        onDone(Result.failure(e))
                    },
                )
            }
        }
    }

    /** Key colour painted behind the person; the layer is then keyed with this colour (ChromaKey.kt). */
    const val KEY_GREEN = 0xFF00FF00.toInt()

    /**
     * Person cut-out: ML Kit selfie segmentation (stream mode, so masks stay steady from frame to frame) keeps the
     * person and paints everything else [KEY_GREEN], with a soft edge. Call [close] on the returned holder when done.
     */
    class BackgroundRemover : AutoCloseable {
        private val segmenter = com.google.mlkit.vision.segmentation.Segmentation.getClient(
            com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions.Builder()
                .setDetectorMode(com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions.STREAM_MODE)
                .build(),
        )

        fun apply(frame: Bitmap): Bitmap {
            val mask = com.google.android.gms.tasks.Tasks.await(segmenter.process(com.google.mlkit.vision.common.InputImage.fromBitmap(frame, 0)))
            val w = frame.width
            val h = frame.height
            val px = IntArray(w * h)
            frame.getPixels(px, 0, w, 0, 0, w, h)
            val buf = mask.buffer.order(ByteOrder.nativeOrder()).asFloatBuffer()
            val mw = mask.width
            val mh = mask.height
            val gr = 0; val gg = 255; val gb = 0
            for (y in 0 until h) {
                val my = min(mh - 1, y * mh / h)
                for (x in 0 until w) {
                    val mx = min(mw - 1, x * mw / w)
                    val c = buf.get(my * mw + mx)
                    // Soft edge between 0.35 and 0.65 confidence.
                    val a = ((c - 0.35f) / 0.3f).coerceIn(0f, 1f)
                    if (a >= 1f) continue
                    val p = px[y * w + x]
                    val r = (((p shr 16) and 0xFF) * a + gr * (1 - a)).toInt()
                    val g = (((p shr 8) and 0xFF) * a + gg * (1 - a)).toInt()
                    val b = ((p and 0xFF) * a + gb * (1 - a)).toInt()
                    px[y * w + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                }
            }
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            out.setPixels(px, 0, w, 0, 0, w, h)
            return out
        }

        override fun close() = segmenter.close()
    }

    /** Photo cut-out: the person kept, everything else transparent, saved as PNG (single-image segmentation). */
    fun removeImageBackground(src: String, outPath: String): Map<String, Any> {
        val opts = android.graphics.BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val decoded = android.graphics.BitmapFactory.decodeFile(src, opts) ?: throw MediaEngineError("MISSING_MEDIA", "Photo cannot be read")
        // Upright like the export (Media3 applies EXIF orientation), at most 1440 px on the long side.
        val orientation = try {
            android.media.ExifInterface(src).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            android.media.ExifInterface.ORIENTATION_NORMAL
        }
        val deg = when (orientation) {
            android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        val k = min(1.0, 1440.0 / max(decoded.width, decoded.height))
        val m = Matrix().apply { postScale(k.toFloat(), k.toFloat()); postRotate(deg) }
        val frame = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
        if (frame !== decoded) decoded.recycle()
        val segmenter = com.google.mlkit.vision.segmentation.Segmentation.getClient(
            com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions.Builder()
                .setDetectorMode(com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions.SINGLE_IMAGE_MODE)
                .build(),
        )
        try {
            val mask = com.google.android.gms.tasks.Tasks.await(segmenter.process(com.google.mlkit.vision.common.InputImage.fromBitmap(frame, 0)))
            val w = frame.width
            val h = frame.height
            val px = IntArray(w * h)
            frame.getPixels(px, 0, w, 0, 0, w, h)
            val buf = mask.buffer.order(ByteOrder.nativeOrder()).asFloatBuffer()
            var kept = 0
            for (y in 0 until h) {
                val my = min(mask.height - 1, y * mask.height / h)
                for (x in 0 until w) {
                    val mx = min(mask.width - 1, x * mask.width / w)
                    val a = ((buf.get(my * mask.width + mx) - 0.35f) / 0.3f).coerceIn(0f, 1f)
                    if (a > 0.5f) kept++
                    px[y * w + x] = ((a * 255).toInt() shl 24) or (px[y * w + x] and 0xFFFFFF)
                }
            }
            if (kept < w * h / 100) throw MediaEngineError("NO_PERSON_FOUND", "No person was found in this photo, so nothing was removed")
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            out.setPixels(px, 0, w, 0, 0, w, h)
            File(outPath).parentFile?.mkdirs()
            FileOutputStream(outPath).use { out.compress(Bitmap.CompressFormat.PNG, 100, it) }
            out.recycle()
            return mapOf("path" to outPath, "width" to w, "height" to h)
        } finally {
            frame.recycle()
            segmenter.close()
        }
    }

    /**
     * Video stabilisation (translation): pass 1 measures the frame-to-frame shift on small greyscale frames (global
     * block matching), the camera path is smoothed over [strength] seconds, and pass 2 moves each frame onto the
     * smooth path with a small zoom that hides the moved edges. Returns the frames for [encode] and the zoom used.
     */
    fun stabilizeFrames(src: String, startMs: Long, endMs: Long, dir: File, maxShortSide: Int, strength: Double, control: AnalysisControl): Pair<FrameSet, Double> {
        // Pass 1: motion. Frames are reduced to 160 px wide greyscale (written as tiny JPEGs only to reuse the reader).
        val shifts = ArrayList<Pair<Double, Double>>()
        var prev: IntArray? = null
        var gw = 0
        var gh = 0
        val probeDir = File(dir.parentFile, "motion")
        val motionControl = AnalysisControl(control.isCancelled) { p -> control.onProgress(p * 0.4) }
        extractFrames(src, startMs, endMs, probeDir, maxShortSide, reverse = false, control = motionControl) { frame ->
            val w = MOTION_WIDTH
            val h = max(16, (MOTION_WIDTH.toDouble() * frame.height / frame.width).roundToInt())
            val small = Bitmap.createScaledBitmap(frame, w, h, true)
            val px = IntArray(w * h)
            small.getPixels(px, 0, w, 0, 0, w, h)
            small.recycle()
            val gray = IntArray(w * h) { i -> val c = px[i]; (((c shr 16) and 0xFF) * 77 + ((c shr 8) and 0xFF) * 150 + (c and 0xFF) * 29) shr 8 }
            val p0 = prev
            if (p0 == null) shifts.add(0.0 to 0.0) else shifts.add(estimateShift(p0, gray, w, h))
            prev = gray
            gw = w; gh = h
            Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        }
        probeDir.deleteRecursively()
        if (shifts.size < 3) throw MediaEngineError("INVALID_ARGS", "The clip is too short to stabilise")
        // Camera path (fractions of the frame), smoothed with a centred moving average.
        val pathX = DoubleArray(shifts.size)
        val pathY = DoubleArray(shifts.size)
        for (i in 1 until shifts.size) {
            pathX[i] = pathX[i - 1] + shifts[i].first / gw
            pathY[i] = pathY[i - 1] + shifts[i].second / gh
        }
        val fps = shifts.size * 1000.0 / (endMs - startMs)
        val radius = max(1, (strength.coerceIn(0.2, 3.0) * fps / 2).roundToInt())
        fun smooth(a: DoubleArray) = DoubleArray(a.size) { i ->
            val lo = max(0, i - radius); val hi = min(a.size - 1, i + radius)
            (lo..hi).sumOf { a[it] } / (hi - lo + 1)
        }
        val sx = smooth(pathX)
        val sy = smooth(pathY)
        val corrX = DoubleArray(shifts.size) { sx[it] - pathX[it] }
        val corrY = DoubleArray(shifts.size) { sy[it] - pathY[it] }
        val maxCorr = max(corrX.maxOf { kotlin.math.abs(it) }, corrY.maxOf { kotlin.math.abs(it) })
        val zoom = (1.0 + 2.0 * maxCorr).coerceIn(1.02, 1.3)
        // Pass 2: move each frame onto the smooth path (clamped so the zoom always covers the edges).
        val limit = (zoom - 1.0) / 2.0
        var k = 0
        val frameControl = AnalysisControl(control.isCancelled) { p -> control.onProgress(0.4 + p * 0.5) }
        val frames = extractFrames(src, startMs, endMs, dir, maxShortSide, reverse = false, control = frameControl) { frame ->
            val i = min(k++, corrX.size - 1)
            val dx = corrX[i].coerceIn(-limit, limit) * frame.width
            val dy = corrY[i].coerceIn(-limit, limit) * frame.height
            val out = Bitmap.createBitmap(frame.width, frame.height, Bitmap.Config.ARGB_8888)
            val m = Matrix().apply {
                postScale(zoom.toFloat(), zoom.toFloat(), frame.width / 2f, frame.height / 2f)
                postTranslate((dx * zoom).toFloat(), (dy * zoom).toFloat())
            }
            android.graphics.Canvas(out).drawBitmap(frame, m, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
            out
        }
        return frames to zoom
    }

    private const val MOTION_WIDTH = 320

    /**
     * Global shift (dx, dy in pixels) that best maps [a] onto [b]: mean absolute difference over a ±16 px search,
     * refined to sub-pixel with a parabola through the neighbouring scores.
     */
    private fun estimateShift(a: IntArray, b: IntArray, w: Int, h: Int): Pair<Double, Double> {
        val r = 16
        fun score(dx: Int, dy: Int): Double {
            var sum = 0L
            var n = 0
            var y = r
            while (y < h - r) {
                var x = r
                while (x < w - r) {
                    sum += kotlin.math.abs(a[y * w + x] - b[(y + dy) * w + (x + dx)])
                    n++
                    x += 2
                }
                y += 2
            }
            return sum.toDouble() / max(1, n)
        }
        var best = Double.MAX_VALUE
        var bx = 0
        var by = 0
        for (dy in -r..r) for (dx in -r..r) {
            val sc = score(dx, dy)
            if (sc < best) { best = sc; bx = dx; by = dy }
        }
        fun refine(lo: Double, mid: Double, hi: Double): Double {
            val den = lo - 2 * mid + hi
            return if (den <= 1e-9) 0.0 else ((lo - hi) / (2 * den)).coerceIn(-0.5, 0.5)
        }
        val fx = if (bx in (-r + 1) until r) refine(score(bx - 1, by), best, score(bx + 1, by)) else 0.0
        val fy = if (by in (-r + 1) until r) refine(score(bx, by - 1), best, score(bx, by + 1)) else 0.0
        // Content moved by (bx, by) from a to b: the camera moved the opposite way.
        return (bx + fx) to (by + fy)
    }
}
