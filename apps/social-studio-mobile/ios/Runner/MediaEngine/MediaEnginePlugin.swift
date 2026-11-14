import Flutter
import UIKit
import AVFoundation

public class MediaEnginePlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
    private var eventSink: FlutterEventSink?
    private var activeRenderers: [String: EditIrAppleRenderer] = [:]
    private var audioRecorder: AVAudioRecorder?

    public static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(
            name: "com.workspace180.socialmanager/media_engine",
            binaryMessenger: registrar.messenger()
        )
        let eventChannel = FlutterEventChannel(
            name: "com.workspace180.socialmanager/media_engine/render_events",
            binaryMessenger: registrar.messenger()
        )

        let instance = MediaEnginePlugin()
        registrar.addMethodCallDelegate(instance, channel: channel)
        eventChannel.setStreamHandler(instance)
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        let args = call.arguments as? [String: Any] ?? [:]

        switch call.method {
        case "getVideoInfo":
            guard let path = (args["sourcePath"] as? String) ?? (args["path"] as? String) else {
                result(FlutterError(code: "INVALID_ARGS", message: "Path is required", details: nil))
                return
            }
            getVideoInfo(path: path, result: result)

        case "generateProxy":
            guard let sourcePath = args["sourcePath"] as? String,
                  let destPath = args["destPath"] as? String else {
                result(FlutterError(code: "INVALID_ARGS", message: "sourcePath and destPath required", details: nil))
                return
            }
            generateProxy(sourcePath: sourcePath, destPath: destPath, result: result)

        case "renderEditIr":
            guard let jobId = args["jobId"] as? String,
                  let editIrJsonString = args["editIrJson"] as? String,
                  let outputPath = args["outputPath"] as? String,
                  let assetPaths = args["assetPaths"] as? [String: String] else {
                result(FlutterError(code: "INVALID_ARGS", message: "Missing required renderEditIr arguments", details: nil))
                return
            }

            guard let data = editIrJsonString.data(using: .utf8),
                  let irJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                result(FlutterError(code: "INVALID_EDIT_IR", message: "Failed to parse editIrJson", details: nil))
                return
            }

            let overlayPaths = args["overlayPaths"] as? [String: String] ?? [:]
            let musicPaths = args["musicPaths"] as? [String: String] ?? [:]
            let fontPaths = args["fontPaths"] as? [String: String] ?? [:]
            let watermarkPath = args["watermarkPath"] as? String
            let sfxPaths = args["sfxPaths"] as? [String: String] ?? [:]

            let renderer = EditIrAppleRenderer(
                jobId: jobId,
                irJson: irJson,
                assetPaths: assetPaths,
                overlayPaths: overlayPaths,
                musicPaths: musicPaths,
                fontPaths: fontPaths,
                watermarkPath: watermarkPath,
                sfxPaths: sfxPaths,
                outputPath: outputPath,
                onProgress: { [weak self] progress in
                    self?.emitEvent([
                        "jobId": jobId,
                        "state": "progress",
                        "progress": progress
                    ])
                },
                onComplete: { [weak self] verified in
                    // Same payload as Android: the Dart RenderResult reads every one of these keys.
                    var event = verified
                    event["jobId"] = jobId
                    event["state"] = "completed"
                    event["progress"] = 1.0
                    self?.emitEvent(event)
                    DispatchQueue.main.async { self?.activeRenderers.removeValue(forKey: jobId) }
                },
                onError: { [weak self] code, message in
                    DispatchQueue.main.async { self?.activeRenderers.removeValue(forKey: jobId) }
                    self?.emitEvent([
                        "jobId": jobId,
                        "state": "failed",
                        "errorCode": code,
                        "message": message
                    ])
                }
            )

            activeRenderers[jobId] = renderer
            emitEvent(["jobId": jobId, "state": "started", "progress": 0.0])
            renderer.start()
            result(jobId)

        case "cancelRender":
            if let jobId = args["jobId"] as? String, let renderer = activeRenderers[jobId] {
                renderer.cancel()
                activeRenderers.removeValue(forKey: jobId)
                emitEvent(["jobId": jobId, "state": "cancelled"])
                result(true)
            } else {
                result(false)
            }

        case "renderJobStatus":
            if let jobId = args["jobId"] as? String {
                let running = activeRenderers.keys.contains(jobId)
                result(["running": running])
            } else {
                result(["running": false])
            }

        case "startVoiceRecording":
            if let outPath = args["outputPath"] as? String {
                startVoiceRecording(outputPath: outPath, result: result)
            } else {
                result(FlutterError(code: "INVALID_ARGS", message: "outputPath is required", details: nil))
            }

        case "stopVoiceRecording":
            stopVoiceRecording(result: result)

        case "cancelVoiceRecording":
            cancelVoiceRecording(result: result)

        case "generateThumbnails":
            // Stills for the timeline and, with the creator's consent, for the AI Director's vision pass (Phase 2).
            guard let sourcePath = args["sourcePath"] as? String,
                  let outputDir = args["outputDir"] as? String,
                  let times = args["timesMs"] as? [NSNumber], !times.isEmpty else {
                result(FlutterError(code: "INVALID_ARGS", message: "sourcePath, outputDir and timesMs are required", details: nil))
                return
            }
            let maxWidth = (args["maxWidth"] as? NSNumber)?.intValue ?? 0
            let exact = (args["exact"] as? Bool) ?? false
            let quality = min(100, max(1, (args["quality"] as? NSNumber)?.intValue ?? 88))
            generateThumbnails(sourcePath: sourcePath, outputDir: outputDir, timesMs: times.map { $0.int64Value },
                               maxWidth: maxWidth, exact: exact, quality: quality, result: result)

        case "extractAudio":
            // The clip's sound for transcription (audit F-13: without it iPhone has no captions, no filler or pause
            // removal and no ducking). AAC in an M4A container, which the transcription upload accepts.
            guard let sourcePath = args["sourcePath"] as? String,
                  let destPath = args["destPath"] as? String else {
                result(FlutterError(code: "INVALID_ARGS", message: "sourcePath and destPath required", details: nil))
                return
            }
            extractAudio(sourcePath: sourcePath, destPath: destPath, format: args["format"] as? String, result: result)

        case "detectSilences":
            // Not measured on iOS yet. An empty list would read as "no pauses": say it is unavailable instead, and the
            // app falls back to transcript gaps.
            result(FlutterError(code: "NOT_AVAILABLE", message: "Silence detection is not available on iOS yet", details: nil))

        case "detectBeats":
            // Not measured on iOS yet. An empty list would read as "no beats": unavailable instead.
            result(FlutterError(code: "NOT_AVAILABLE", message: "Beat detection is not available on iOS yet", details: nil))

        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private func getVideoInfo(path: String, result: @escaping FlutterResult) {
        let url = URL(fileURLWithPath: path)
        let asset = AVURLAsset(url: url)

        guard let track = asset.tracks(withMediaType: .video).first else {
            result(FlutterError(code: "NO_VIDEO_TRACK", message: "Video track not found", details: nil))
            return
        }

        let size = track.naturalSize
        let t = track.preferredTransform
        let durationMs = Int(CMTimeGetSeconds(asset.duration) * 1000)
        let fps = track.nominalFrameRate > 0 ? Double(track.nominalFrameRate) : 30.0
        let hasAudio = !asset.tracks(withMediaType: .audio).isEmpty

        var width = Int(size.width)
        var height = Int(size.height)
        var rotation = 0

        if t.a == 0 && t.b == 1.0 && t.c == -1.0 && t.d == 0 {
            rotation = 90
        } else if t.a == 0 && t.b == -1.0 && t.c == 1.0 && t.d == 0 {
            rotation = 270
        } else if t.a == -1.0 && t.b == 0 && t.c == 0 && t.d == -1.0 {
            rotation = 180
        }

        let isRotated = rotation == 90 || rotation == 270
        let displayWidth = isRotated ? height : width
        let displayHeight = isRotated ? width : height

        result([
            "width": width,
            "height": height,
            "displayWidth": displayWidth,
            "displayHeight": displayHeight,
            "durationMs": durationMs,
            "rotation": rotation,
            "fps": fps,
            // Keys VideoMetadata.fromMap reads (hasVideo defaulted to false without it).
            "frameRate": fps,
            "hasVideo": true,
            "hasAudio": hasAudio,
            "isHdr": false,
            "fileSizeBytes": ((try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? NSNumber)?.int64Value ?? 0
        ])
    }

    private func generateProxy(sourcePath: String, destPath: String, result: @escaping FlutterResult) {
        let sourceUrl = URL(fileURLWithPath: sourcePath)
        let destUrl = URL(fileURLWithPath: destPath)
        let asset = AVURLAsset(url: sourceUrl)

        try? FileManager.default.removeItem(at: destUrl)

        guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
            result(FlutterError(code: "PROXY_FAILED", message: "Could not create AVAssetExportSession for proxy", details: nil))
            return
        }

        exportSession.outputURL = destUrl
        exportSession.outputFileType = .mp4
        exportSession.shouldOptimizeForNetworkUse = true

        exportSession.exportAsynchronously {
            DispatchQueue.main.async {
                if exportSession.status == .completed {
                    result(destPath)
                } else {
                    let err = exportSession.error?.localizedDescription ?? "Proxy generation failed"
                    result(FlutterError(code: "PROXY_FAILED", message: err, details: nil))
                }
            }
        }
    }

    /// One JPEG per time into [outputDir], upright (the track's preferred transform applied), at most [maxWidth] px wide
    /// (0 = full size). Same contract as Android's MediaTools.generateThumbnails: paths in order, or an error.
    private func generateThumbnails(sourcePath: String, outputDir: String, timesMs: [Int64], maxWidth: Int, exact: Bool,
                                    quality: Int, result: @escaping FlutterResult) {
        guard FileManager.default.fileExists(atPath: sourcePath) else {
            result(FlutterError(code: "FILE_NOT_FOUND", message: "No file at \(sourcePath)", details: nil))
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let asset = AVURLAsset(url: URL(fileURLWithPath: sourcePath))
            guard asset.tracks(withMediaType: .video).first != nil else {
                DispatchQueue.main.async { result(FlutterError(code: "NO_VIDEO_TRACK", message: "No video track in \(sourcePath)", details: nil)) }
                return
            }
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            if maxWidth > 0 { generator.maximumSize = CGSize(width: maxWidth, height: maxWidth * 4) }
            if exact {
                generator.requestedTimeToleranceBefore = .zero
                generator.requestedTimeToleranceAfter = .zero
            }
            try? FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
            let base = URL(fileURLWithPath: sourcePath).deletingPathExtension().lastPathComponent
            var paths: [String] = []
            for t in timesMs {
                let time = CMTime(value: t, timescale: 1000)
                guard let cg = try? generator.copyCGImage(at: time, actualTime: nil),
                      let data = UIImage(cgImage: cg).jpegData(compressionQuality: CGFloat(quality) / 100.0) else {
                    DispatchQueue.main.async { result(FlutterError(code: "THUMBNAIL_FAILED", message: "No frame at \(t)ms in \(sourcePath)", details: nil)) }
                    return
                }
                let out = (outputDir as NSString).appendingPathComponent("\(base)_\(t).jpg")
                do {
                    try data.write(to: URL(fileURLWithPath: out), options: .atomic)
                } catch {
                    DispatchQueue.main.async { result(FlutterError(code: "THUMBNAIL_FAILED", message: error.localizedDescription, details: nil)) }
                    return
                }
                paths.append(out)
            }
            DispatchQueue.main.async { result(paths) }
        }
    }

    private func extractAudio(sourcePath: String, destPath: String, format: String?, result: @escaping FlutterResult) {
        if format == "wav" {
            result(FlutterError(code: "NOT_AVAILABLE", message: "WAV extraction is not available on iOS; use m4a", details: nil))
            return
        }
        let asset = AVURLAsset(url: URL(fileURLWithPath: sourcePath))
        guard let audioTrack = asset.tracks(withMediaType: .audio).first else {
            result(FlutterError(code: "NO_AUDIO_TRACK", message: "This video has no sound", details: nil))
            return
        }
        let destUrl = URL(fileURLWithPath: destPath)
        try? FileManager.default.removeItem(at: destUrl)
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            result(FlutterError(code: "EXTRACT_FAILED", message: "Could not create an audio export session", details: nil))
            return
        }
        session.outputURL = destUrl
        session.outputFileType = .m4a
        // Sample rate and channels of the source track (the M4A preset keeps them).
        var sampleRate = 44100
        var channels = 1
        if let desc = audioTrack.formatDescriptions.first,
           let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc as! CMAudioFormatDescription)?.pointee {
            if asbd.mSampleRate > 0 { sampleRate = Int(asbd.mSampleRate) }
            if asbd.mChannelsPerFrame > 0 { channels = Int(asbd.mChannelsPerFrame) }
        }
        session.exportAsynchronously {
            DispatchQueue.main.async {
                guard session.status == .completed else {
                    let err = session.error?.localizedDescription ?? "Audio extraction failed"
                    result(FlutterError(code: "EXTRACT_FAILED", message: err, details: nil))
                    return
                }
                let out = AVURLAsset(url: destUrl)
                let size = ((try? FileManager.default.attributesOfItem(atPath: destPath))?[.size] as? NSNumber)?.int64Value ?? 0
                // The keys ExtractedAudio.fromMap reads (Android returns the same).
                result([
                    "path": destPath,
                    "format": "m4a",
                    "sampleRate": sampleRate,
                    "channels": channels,
                    "durationMs": max(0, Int((CMTimeGetSeconds(out.duration) * 1000).rounded())),
                    "fileSizeBytes": size,
                ])
            }
        }
    }

    private func startVoiceRecording(outputPath: String, result: @escaping FlutterResult) {
        let url = URL(fileURLWithPath: outputPath)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default)
            try session.setActive(true)
            audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder?.record()
            result(nil)
        } catch {
            result(FlutterError(code: "RECORD_FAILED", message: error.localizedDescription, details: nil))
        }
    }

    private func stopVoiceRecording(result: @escaping FlutterResult) {
        guard let rec = audioRecorder else {
            result(FlutterError(code: "NOT_RECORDING", message: "No voice recording is in progress", details: nil))
            return
        }
        let url = rec.url
        rec.stop()
        audioRecorder = nil
        let durationMs = Int((AVURLAsset(url: url).duration.seconds * 1000).rounded())
        // MediaEngineService.stopVoiceRecording reads {path, durationMs}.
        result(["path": url.path, "durationMs": max(0, durationMs)])
    }

    private func cancelVoiceRecording(result: @escaping FlutterResult) {
        if let rec = audioRecorder {
            rec.stop()
            rec.deleteRecording()
            audioRecorder = nil
        }
        result(nil)
    }

    private func emitEvent(_ event: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            self?.eventSink?(event)
        }
    }

    public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        self.eventSink = events
        return nil
    }

    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
        self.eventSink = nil
        return nil
    }
}
