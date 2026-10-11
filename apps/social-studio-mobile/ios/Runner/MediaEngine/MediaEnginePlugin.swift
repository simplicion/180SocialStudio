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
            let watermarkPath = args["watermarkPath"] as? String
            let sfxPaths = args["sfxPaths"] as? [String: String] ?? [:]

            let renderer = EditIrAppleRenderer(
                jobId: jobId,
                irJson: irJson,
                assetPaths: assetPaths,
                overlayPaths: overlayPaths,
                musicPaths: musicPaths,
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
                onComplete: { [weak self] path, warnings in
                    self?.activeRenderers.removeValue(forKey: jobId)
                    self?.emitEvent([
                        "jobId": jobId,
                        "state": "completed",
                        "outputPath": path,
                        "warnings": warnings
                    ])
                },
                onError: { [weak self] code, message in
                    self?.activeRenderers.removeValue(forKey: jobId)
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

        case "detectSilences":
            result([]) // Fallback to speech transcript timing on iOS

        case "detectBeats":
            result([]) // Fallback to stock BPM metadata on iOS

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
            "hasAudio": hasAudio
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
        audioRecorder?.stop()
        audioRecorder = nil
        result(nil)
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
