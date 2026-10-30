import Foundation
import AVFoundation
import CoreGraphics
import CoreText
import UIKit

/// iOS renderer for a `mobile-editir/1` timeline (AVMutableComposition + AVMutableVideoComposition +
/// AVMutableAudioMix + AVAssetExportSession), the counterpart of Android's EditIrRenderer.
///
/// Drawn on iOS: main clips (trim, split, speed with pitch kept, rotation, mirror, crop/fit to the canvas, canvas
/// background), transitions (as a dip through black/white at the cut), captions and titles (burned in, canvas-pixel
/// units, typed line breaks, wrapping at maxWidthFraction, colours, outline, shadow, background, highlighted words,
/// enter/exit fades), clip / original / music / sfx / voiceover levels and fades, the watermark.
/// Everything else in the timeline (B-roll, layers, colour filters, zooms, effects, per-word animation) is reported
/// in the result's warnings instead of being silently dropped.
/// One word (or "\n" line break) of a caption as drawn.
struct CaptionToken {
    let text: String
    let highlight: Bool
    let color: Any?
}

public class EditIrAppleRenderer {
    private let jobId: String
    private let irJson: [String: Any]
    private let assetPaths: [String: String]
    private let overlayPaths: [String: String]
    private let musicPaths: [String: String]
    private let fontPaths: [String: String]
    private let watermarkPath: String?
    private let sfxPaths: [String: String]
    private let outputPath: String
    private let onProgress: (Double) -> Void
    private let onComplete: ([String: Any]) -> Void
    private let onError: (String, String) -> Void

    private var exportSession: AVAssetExportSession?
    private var progressTimer: Timer?
    private var isCancelled = false
    private var warnings: [String] = []

    public init(
        jobId: String,
        irJson: [String: Any],
        assetPaths: [String: String],
        overlayPaths: [String: String] = [:],
        musicPaths: [String: String] = [:],
        fontPaths: [String: String] = [:],
        watermarkPath: String? = nil,
        sfxPaths: [String: String] = [:],
        outputPath: String,
        onProgress: @escaping (Double) -> Void,
        onComplete: @escaping ([String: Any]) -> Void,
        onError: @escaping (String, String) -> Void
    ) {
        self.jobId = jobId
        self.irJson = irJson
        self.assetPaths = assetPaths
        self.overlayPaths = overlayPaths
        self.musicPaths = musicPaths
        self.fontPaths = fontPaths
        self.watermarkPath = watermarkPath
        self.sfxPaths = sfxPaths
        self.outputPath = outputPath
        self.onProgress = onProgress
        self.onComplete = onComplete
        self.onError = onError
    }

    public func start() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.buildAndExport()
        }
    }

    public func cancel() {
        isCancelled = true
        exportSession?.cancelExport()
        stopTimer()
        cleanupOutput()
    }

    // MARK: - JSON helpers (JSONSerialization gives NSNumber for every number)

    private func dbl(_ v: Any?, _ d: Double) -> Double { (v as? NSNumber)?.doubleValue ?? d }
    private func int(_ v: Any?, _ d: Int) -> Int { (v as? NSNumber)?.intValue ?? d }
    private func bool(_ v: Any?, _ d: Bool) -> Bool { (v as? NSNumber)?.boolValue ?? d }
    private func cm(_ ms: Double) -> CMTime { CMTime(value: CMTimeValue((ms * 1000).rounded()), timescale: 1_000_000) }
    private func gain(_ db: Double) -> Float { Float(pow(10.0, db / 20.0)) }

    /// Contract colours are #RRGGBB or #RRGGBBAA.
    private func color(_ v: Any?, _ d: UIColor) -> UIColor {
        guard var hex = v as? String else { return d }
        hex = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard hex.count == 6 || hex.count == 8, let n = UInt64(hex, radix: 16) else { return d }
        let r, g, b, a: CGFloat
        if hex.count == 6 {
            r = CGFloat((n >> 16) & 0xFF) / 255; g = CGFloat((n >> 8) & 0xFF) / 255; b = CGFloat(n & 0xFF) / 255; a = 1
        } else {
            r = CGFloat((n >> 24) & 0xFF) / 255; g = CGFloat((n >> 16) & 0xFF) / 255; b = CGFloat((n >> 8) & 0xFF) / 255; a = CGFloat(n & 0xFF) / 255
        }
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }

    private func warn(_ s: String) { if !warnings.contains(s) { warnings.append(s) } }

    // MARK: - Build

    private func buildAndExport() {
        guard !isCancelled else { return }
        guard let canvas = irJson["canvas"] as? [String: Any],
              let clips = irJson["clips"] as? [[String: Any]], !clips.isEmpty,
              irJson["durationMs"] != nil else {
            onError("INVALID_EDIT_IR", "Timeline must contain canvas, clips, and durationMs")
            return
        }
        let durationMs = dbl(irJson["durationMs"], 0)
        let renderSize = CGSize(width: CGFloat(int(canvas["width"], 1080)), height: CGFloat(int(canvas["height"], 1920)))
        let fps = max(1, min(120, dbl(canvas["fps"], 30)))
        let background = color(canvas["background"], .black)
        let audio = irJson["audio"] as? [String: Any] ?? [:]
        let originalDb = dbl((audio["originalTrack"] as? [String: Any])?["volumeDb"], 0)

        let composition = AVMutableComposition()
        guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            onError("RENDER_INIT_FAILED", "Failed to allocate AVMutableComposition tracks")
            return
        }

        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
        let mainAudioParams = AVMutableAudioMixInputParameters(track: audioTrack)
        var anyClipAudio = false

        for (index, clip) in clips.enumerated() {
            let assetId = clip["assetId"] as? String ?? ""
            let clipName = clip["id"] as? String ?? "#\(index + 1)"
            guard let filePath = assetPaths[assetId], FileManager.default.fileExists(atPath: filePath) else {
                onError("MISSING_MEDIA", "No local file supplied for assetId '\(assetId)'")
                return
            }
            let asset = AVURLAsset(url: URL(fileURLWithPath: filePath))
            guard let srcVideo = asset.tracks(withMediaType: .video).first else {
                onError("MISSING_MEDIA", "Clip \(clipName) has no video track (photos on the main track are not supported on iOS yet)")
                return
            }
            let srcStart = dbl(clip["sourceStartMs"], 0)
            let srcEnd = dbl(clip["sourceEndMs"], srcStart)
            let speed = max(0.25, min(4, dbl(clip["speed"], 1)))
            let tlStart = dbl(clip["timelineStartMs"], 0)
            let tlEnd = dbl(clip["timelineEndMs"], tlStart + (srcEnd - srcStart) / speed)
            guard srcEnd > srcStart else {
                onError("INVALID_EDIT_IR", "Clip \(clipName) has an empty source range")
                return
            }
            let srcRange = CMTimeRange(start: cm(srcStart), duration: cm(srcEnd - srcStart))
            let at = cm(tlStart)
            let target = cm(tlEnd - tlStart)
            do {
                try videoTrack.insertTimeRange(srcRange, of: srcVideo, at: at)
                videoTrack.scaleTimeRange(CMTimeRange(start: at, duration: srcRange.duration), toDuration: target)
            } catch {
                onError("EXPORT_FAILED", "Could not place clip \(clipName): \(error.localizedDescription)")
                return
            }
            if let srcAudio = asset.tracks(withMediaType: .audio).first {
                do {
                    try audioTrack.insertTimeRange(srcRange, of: srcAudio, at: at)
                    audioTrack.scaleTimeRange(CMTimeRange(start: at, duration: srcRange.duration), toDuration: target)
                    anyClipAudio = true
                } catch {
                    warn("Clip \(clipName): its sound could not be added (\(error.localizedDescription))")
                }
            } else {
                // Keep the voice lane aligned with the picture.
                audioTrack.insertEmptyTimeRange(CMTimeRange(start: at, duration: target))
            }

            // Picture placement for this clip: orientation, rotation, mirror, crop (fill) or fit.
            layerInstruction.setTransform(clipTransform(clip: clip, track: srcVideo, canvas: renderSize), at: at)

            // Clip level and fades on the voice lane.
            let level = gain(originalDb + dbl(clip["volumeDb"], 0))
            let fadeIn = dbl(clip["audioFadeInMs"], 0)
            let fadeOut = dbl(clip["audioFadeOutMs"], 0)
            let len = tlEnd - tlStart
            if fadeIn > 0 {
                mainAudioParams.setVolumeRamp(fromStartVolume: 0, toEndVolume: level, timeRange: CMTimeRange(start: at, duration: cm(min(fadeIn, len / 2))))
            } else {
                mainAudioParams.setVolume(level, at: at)
            }
            if fadeOut > 0 {
                let f = min(fadeOut, len / 2)
                mainAudioParams.setVolumeRamp(fromStartVolume: level, toEndVolume: 0, timeRange: CMTimeRange(start: cm(tlEnd - f), duration: cm(f)))
            }
            if (clip["filter"] as? [String: Any]) != nil { warn("Colour filters are not applied on iOS yet") }
        }

        // Transitions: a dip through black (or white) centred on the cut, like Android's fallback when no
        // spare footage exists for an overlapping crossfade.
        var dipWhite: [(Double, Double)] = []
        for (i, clip) in clips.enumerated() where i > 0 {
            guard let tr = clip["transitionIn"] as? [String: Any] else { continue }
            let type = tr["type"] as? String ?? "CROSSFADE"
            if type == "CUT" { continue }
            let cut = dbl(clip["timelineStartMs"], 0)
            let prevLen = dbl(clips[i - 1]["timelineEndMs"], 0) - dbl(clips[i - 1]["timelineStartMs"], 0)
            let len = dbl(clip["timelineEndMs"], 0) - cut
            let half = min(dbl(tr["durationMs"], 400) / 2, prevLen / 2, len / 2)
            if half < 20 { continue }
            layerInstruction.setOpacityRamp(fromStartOpacity: 1, toEndOpacity: 0, timeRange: CMTimeRange(start: cm(cut - half), duration: cm(half)))
            layerInstruction.setOpacityRamp(fromStartOpacity: 0, toEndOpacity: 1, timeRange: CMTimeRange(start: cm(cut), duration: cm(half)))
            if type == "DIP_WHITE" { dipWhite.append((cut, half)) }
            if !["CROSSFADE", "DISSOLVE", "DIP_BLACK", "DIP_WHITE"].contains(type) {
                warn("Transition \(type) is drawn as a dip through black on iOS")
            } else if type == "CROSSFADE" || type == "DISSOLVE" {
                warn("Crossfades are drawn as a dip through black on iOS")
            }
        }

        if !anyClipAudio { warn("main source has no audio track") }

        // Unsupported parts of the timeline are named, never silently dropped.
        if let overlays = irJson["overlays"] as? [[String: Any]], !overlays.isEmpty { warn("B-roll and overlay layers are not rendered on iOS yet (\(overlays.count) left out)") }
        if let zooms = irJson["zooms"] as? [[String: Any]], !zooms.isEmpty { warn("Zoom punch-ins are not rendered on iOS yet") }
        if let effects = irJson["effects"] as? [[String: Any]], !effects.isEmpty { warn("Video effects are not rendered on iOS yet") }

        // Video composition.
        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1000, timescale: CMTimeScale((fps * 1000).rounded()))
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: cm(durationMs))
        // Dips go through the canvas colour (black unless the timeline sets one); DIP_WHITE draws white below.
        instruction.backgroundColor = background.cgColor
        instruction.layerInstructions = [layerInstruction]
        videoComposition.instructions = [instruction]

        // Burned-in layers (CoreAnimation): white dips, captions and titles, watermark. The export's layer space has
        // its origin at the bottom left, so every top-left contract position goes through `flipped`.
        let parentLayer = CALayer()
        parentLayer.frame = CGRect(origin: .zero, size: renderSize)
        let videoLayer = CALayer()
        videoLayer.frame = parentLayer.frame
        parentLayer.addSublayer(videoLayer)
        var hasLayers = false
        for (cut, half) in dipWhite {
            let white = CALayer()
            white.frame = parentLayer.frame
            white.backgroundColor = UIColor.white.cgColor
            white.opacity = 0
            white.add(opacityTrack(startMs: cut - half, endMs: cut + half, fadeInMs: half, fadeOutMs: half, totalMs: durationMs), forKey: "dip")
            parentLayer.addSublayer(white)
            hasLayers = true
        }
        if let captions = irJson["captions"] as? [[String: Any]] {
            for cap in captions {
                if let layer = captionLayer(cap, canvas: renderSize, totalMs: durationMs) {
                    parentLayer.addSublayer(layer)
                    hasLayers = true
                }
            }
        }
        if let wm = watermarkLayer(canvas: renderSize) {
            parentLayer.addSublayer(wm)
            hasLayers = true
        }
        if hasLayers {
            videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parentLayer)
        }

        // Audio mix: voice lane, music, sfx, voiceovers.
        var params: [AVMutableAudioMixInputParameters] = []
        if anyClipAudio {
            params.append(mainAudioParams)
        } else {
            composition.removeTrack(audioTrack)
        }
        params.append(contentsOf: musicParams(audio: audio, composition: composition, durationMs: durationMs))
        params.append(contentsOf: sfxParams(audio: audio, composition: composition, durationMs: durationMs))
        params.append(contentsOf: voiceoverParams(audio: audio, composition: composition, durationMs: durationMs))
        let audioMix = AVMutableAudioMix()
        audioMix.inputParameters = params

        let outputUrl = URL(fileURLWithPath: outputPath)
        try? FileManager.default.removeItem(at: outputUrl)
        try? FileManager.default.createDirectory(at: outputUrl.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            onError("EXPORT_SESSION_FAILED", "Could not initialize AVAssetExportSession")
            return
        }
        exportSession = session
        session.outputURL = outputUrl
        session.outputFileType = .mp4
        session.videoComposition = videoComposition
        session.audioMix = audioMix
        session.audioTimePitchAlgorithm = .spectral // speed changes keep the voice's pitch
        session.timeRange = CMTimeRange(start: .zero, duration: cm(durationMs))
        session.shouldOptimizeForNetworkUse = true

        startTimer()
        session.exportAsynchronously { [weak self] in
            guard let self = self else { return }
            self.stopTimer()
            switch session.status {
            case .completed:
                self.onProgress(1.0)
                self.onComplete(self.verifiedResult(expectedMs: durationMs))
            case .failed:
                self.cleanupOutput()
                self.onError("EXPORT_FAILED", session.error?.localizedDescription ?? "Export failed")
            case .cancelled:
                self.cleanupOutput()
                if !self.isCancelled { self.onError("CANCELLED", "Export was cancelled") }
            default:
                break
            }
        }
    }

    // MARK: - Picture placement

    /// Natural frame -> canvas: track orientation, contract rotation (clockwise) and mirror, then the crop rect
    /// scaled to fill the canvas (or, without a crop, the whole picture fitted inside it), centred.
    private func clipTransform(clip: [String: Any], track: AVAssetTrack, canvas: CGSize) -> CGAffineTransform {
        let pt = track.preferredTransform
        let box = CGRect(origin: .zero, size: track.naturalSize).applying(pt)
        var t = pt.concatenating(CGAffineTransform(translationX: -box.origin.x, y: -box.origin.y))
        var w = abs(box.width), h = abs(box.height)
        switch ((int(clip["rotationDeg"], 0) % 360) + 360) % 360 {
        case 90:
            t = t.concatenating(CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: h, ty: 0)); swap(&w, &h)
        case 180:
            t = t.concatenating(CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: w, ty: h))
        case 270:
            t = t.concatenating(CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: w)); swap(&w, &h)
        default:
            break
        }
        if bool(clip["flipH"], false) {
            t = t.concatenating(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: w, ty: 0))
        }
        var region = CGRect(x: 0, y: 0, width: w, height: h)
        var fill = false
        if let crop = clip["crop"] as? [String: Any] {
            let x = max(0, min(1, dbl(crop["x"], 0))), y = max(0, min(1, dbl(crop["y"], 0)))
            let cw = max(0.001, min(1 - x, dbl(crop["width"], 1))), ch = max(0.001, min(1 - y, dbl(crop["height"], 1)))
            region = CGRect(x: CGFloat(x) * w, y: CGFloat(y) * h, width: CGFloat(cw) * w, height: CGFloat(ch) * h)
            fill = true
        }
        guard region.width > 0, region.height > 0 else { return t }
        let sx = canvas.width / region.width, sy = canvas.height / region.height
        let s = fill ? max(sx, sy) : min(sx, sy)
        let tx = (canvas.width - region.width * s) / 2 - region.minX * s
        let ty = (canvas.height - region.height * s) / 2 - region.minY * s
        return t.concatenating(CGAffineTransform(scaleX: s, y: s)).concatenating(CGAffineTransform(translationX: tx, y: ty))
    }

    // MARK: - Captions and titles

    /// Opacity over the whole timeline: hidden, fade in at [startMs], shown, fade out to [endMs], hidden.
    private func opacityTrack(startMs: Double, endMs: Double, fadeInMs: Double, fadeOutMs: Double, totalMs: Double) -> CAKeyframeAnimation {
        let total = max(totalMs, endMs, 1)
        let a = max(0, startMs) / total
        let len = max(endMs - startMs, 1)
        let fi = min(max(fadeInMs, 1), len / 2) / total
        let fo = min(max(fadeOutMs, 1), len / 2) / total
        let e = min(endMs, total) / total
        let anim = CAKeyframeAnimation(keyPath: "opacity")
        anim.values = [0, 0, 1, 1, 0, 0]
        anim.keyTimes = [0, a, min(a + fi, e - fo), max(e - fo, a + fi), e, 1].map { NSNumber(value: min(1, max(0, $0))) }
        anim.calculationMode = .linear
        anim.beginTime = AVCoreAnimationBeginTimeAtZero
        anim.duration = total / 1000
        anim.isRemovedOnCompletion = false
        anim.fillMode = .both
        return anim
    }

    /// Words to draw (same rules as `displayWords` in VideoEffects.kt / edit_ir.dart): titles draw their text; a
    /// speech caption draws its words unless the text was edited away from them. "\n" entries are line breaks.
    private func displayTokens(_ cap: [String: Any]) -> [CaptionToken] {
        let text = (cap["text"] as? String ?? "").replacingOccurrences(of: "\r\n", with: "\n")
        let words = (cap["words"] as? [[String: Any]] ?? []).filter { !(($0["text"] as? String) ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        func tokens(_ s: String) -> [String] {
            var out: [String] = []
            for (i, line) in s.components(separatedBy: "\n").enumerated() {
                if i > 0 { out.append("\n") }
                out.append(contentsOf: line.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init))
            }
            while out.first == "\n" { out.removeFirst() }
            while out.last == "\n" { out.removeLast() }
            return out
        }
        func norm(_ s: String) -> String { s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
        let joined = words.map { $0["text"] as? String ?? "" }.joined(separator: " ")
        if (cap["kind"] as? String) == "text" || words.isEmpty {
            return tokens(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? joined : text).map { CaptionToken(text: $0, highlight: false, color: nil) }
        }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || norm(text) == norm(joined) {
            return words.map { w -> CaptionToken in CaptionToken(text: w["text"] as? String ?? "", highlight: self.bool(w["highlight"], false), color: w["color"]) }
        }
        let typed = tokens(text)
        if typed.filter({ $0 != "\n" }).count == words.count {
            var i = 0
            return typed.map { p -> CaptionToken in
                if p == "\n" { return CaptionToken(text: p, highlight: false, color: nil) }
                let w = words[i]
                i += 1
                return CaptionToken(text: p, highlight: self.bool(w["highlight"], false), color: w["color"])
            }
        }
        return typed.map { CaptionToken(text: $0, highlight: false, color: nil) }
    }

    private func font(family: String, weight: Int, size: CGFloat) -> UIFont {
        if let path = fontPaths["\(family):\(weight)"] ?? fontPaths[family],
           let provider = CGDataProvider(url: URL(fileURLWithPath: path) as CFURL),
           let cg = CGFont(provider) {
            var error: Unmanaged<CFError>?
            _ = CTFontManagerRegisterGraphicsFont(cg, &error) // already registered is fine
            if let name = cg.postScriptName as String?, let f = UIFont(name: name, size: size) { return f }
        }
        if let f = UIFont(name: family, size: size) {
            let traits: [UIFontDescriptor.TraitKey: Any] = [.weight: uiWeight(weight)]
            return UIFont(descriptor: f.fontDescriptor.addingAttributes([.traits: traits]), size: size)
        }
        warn("font '\(family)' \(weight) not supplied; the system font was used")
        return UIFont.systemFont(ofSize: size, weight: uiWeight(weight))
    }

    private func uiWeight(_ w: Int) -> UIFont.Weight {
        switch w {
        case ..<200: return .ultraLight
        case ..<300: return .thin
        case ..<400: return .light
        case ..<500: return .regular
        case ..<600: return .medium
        case ..<700: return .semibold
        case ..<800: return .bold
        case ..<900: return .heavy
        default: return .black
        }
    }

    /// One caption / title as a pre-drawn image layer, shown for its time range. Sizes are canvas pixels (contract
    /// §3.4); the render size is the canvas, so they are used as-is.
    private func captionLayer(_ cap: [String: Any], canvas: CGSize, totalMs: Double) -> CALayer? {
        let startMs = dbl(cap["startMs"], 0), endMs = min(dbl(cap["endMs"], 0), totalMs)
        guard endMs > startMs else { return nil }
        let st = cap["style"] as? [String: Any] ?? [:]
        let isTitle = (cap["kind"] as? String) == "text"
        let tokens = displayTokens(cap)
        guard tokens.contains(where: { $0.text != "\n" }) else { return nil }

        let size = CGFloat(max(1, dbl(st["fontSizePx"], 72)))
        let uiFont = font(family: st["fontFamily"] as? String ?? "Inter", weight: int(st["fontWeight"], 800), size: size)
        let textColor = color(st["textColor"], .white)
        let highlight = color(st["highlightColor"], isTitle ? textColor : UIColor(red: 1, green: 0.9, blue: 0, alpha: 1))
        let upper = bool(st["uppercase"], false)
        let strokePx = dbl(st["strokeWidthPx"], 0)
        let animation = st["animation"] as? String ?? (isTitle ? "none" : "word_pop")
        if animation != "none" && !isTitle { warn("Word-by-word caption animation is drawn static on iOS (highlighted words keep their colour)") }

        let para = NSMutableParagraphStyle()
        para.alignment = .center
        para.lineBreakMode = .byWordWrapping
        var base: [NSAttributedString.Key: Any] = [.font: uiFont, .paragraphStyle: para, .foregroundColor: textColor]
        if strokePx > 0 {
            // Negative = fill and stroke; width is a percentage of the point size, centred on the glyph edge.
            base[.strokeWidth] = -(2 * strokePx / Double(size)) * 100
            base[.strokeColor] = color(st["strokeColor"], .black)
        }
        if bool(st["glow"], false) {
            let s = NSShadow(); s.shadowBlurRadius = size * 0.25; s.shadowOffset = .zero; s.shadowColor = highlight
            base[.shadow] = s
        } else if bool(st["shadow"], true) {
            let s = NSShadow(); s.shadowBlurRadius = 6; s.shadowOffset = CGSize(width: 0, height: 4); s.shadowColor = UIColor.black.withAlphaComponent(0.63)
            base[.shadow] = s
        }
        let str = NSMutableAttributedString()
        for (i, tok) in tokens.enumerated() {
            if tok.text == "\n" { str.append(NSAttributedString(string: "\n", attributes: base)); continue }
            if i > 0 && tokens[i - 1].text != "\n" { str.append(NSAttributedString(string: " ", attributes: base)) }
            var attrs = base
            if tok.highlight { attrs[.foregroundColor] = color(tok.color, highlight) }
            str.append(NSAttributedString(string: upper ? tok.text.uppercased() : tok.text, attributes: attrs))
        }

        let maxWidth = CGFloat(max(0.05, min(1, dbl(st["maxWidthFraction"], 0.86)))) * canvas.width
        let bounds = str.boundingRect(with: CGSize(width: maxWidth, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).integral
        let bg = st["background"] as? [String: Any]
        let pad = bg != nil ? CGFloat(dbl(bg?["paddingPx"], 16)) : 0
        let margin = size * 0.4 // room for outline / shadow / glow
        let imgSize = CGSize(width: bounds.width + 2 * (pad + margin), height: bounds.height + 2 * (pad + margin))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let image = UIGraphicsImageRenderer(size: imgSize, format: format).image { ctx in
            if let bg = bg {
                color(bg["color"], UIColor.black.withAlphaComponent(0.7)).setFill()
                let r = CGFloat(dbl(bg["radiusPx"], 16))
                UIBezierPath(roundedRect: CGRect(x: margin, y: margin, width: bounds.width + 2 * pad, height: bounds.height + 2 * pad), cornerRadius: r).fill()
            }
            str.draw(with: CGRect(x: margin + pad, y: margin + pad, width: bounds.width, height: bounds.height), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
            _ = ctx
        }

        let layer = CALayer()
        layer.contents = image.cgImage
        let cx = CGFloat(dbl(st["positionX"], 0.5)) * canvas.width
        let cy = CGFloat(dbl(st["positionY"], isTitle ? 0.25 : 0.72)) * canvas.height
        layer.frame = flipped(CGRect(x: cx - imgSize.width / 2, y: cy - imgSize.height / 2, width: imgSize.width, height: imgSize.height), canvas)
        layer.opacity = 0
        let enter = st["enter"] as? [String: Any]
        let exit = st["exit"] as? [String: Any]
        if let e = enter?["type"] as? String, e != "fade" { warn("Text motion '\(e)' is drawn as a fade on iOS") }
        if let e = exit?["type"] as? String, e != "fade" { warn("Text motion '\(e)' is drawn as a fade on iOS") }
        if st["loop"] != nil { warn("Looping text motion is not drawn on iOS yet") }
        layer.add(opacityTrack(startMs: startMs, endMs: endMs, fadeInMs: dbl(enter?["durationMs"], 0), fadeOutMs: dbl(exit?["durationMs"], 0), totalMs: totalMs), forKey: "show")
        return layer
    }

    /// Top-left canvas rect -> the bottom-left layer space of AVVideoCompositionCoreAnimationTool.
    private func flipped(_ r: CGRect, _ canvas: CGSize) -> CGRect {
        CGRect(x: r.minX, y: canvas.height - r.maxY, width: r.width, height: r.height)
    }

    // MARK: - Watermark

    private func watermarkLayer(canvas: CGSize) -> CALayer? {
        guard let wm = irJson["watermark"] as? [String: Any] else { return nil }
        guard let path = watermarkPath, FileManager.default.fileExists(atPath: path), let image = UIImage(contentsOfFile: path), image.size.width > 0 else {
            warn("watermark: no local logo file supplied (watermarkPath); exported without the logo")
            return nil
        }
        let layer = CALayer()
        layer.contents = image.cgImage
        layer.opacity = Float(max(0, min(100, dbl(wm["opacityPct"], 100))) / 100)
        if let nx = (wm["x"] as? NSNumber)?.doubleValue, let ny = (wm["y"] as? NSNumber)?.doubleValue, let nw = (wm["width"] as? NSNumber)?.doubleValue {
            let w = canvas.width * CGFloat(nw)
            let h = (wm["height"] as? NSNumber).map { canvas.height * CGFloat($0.doubleValue) } ?? w * image.size.height / image.size.width
            layer.frame = flipped(CGRect(x: canvas.width * CGFloat(nx), y: canvas.height * CGFloat(ny), width: w, height: h), canvas)
        } else {
            let margin = min(canvas.width, canvas.height) * 0.04
            let w = canvas.width * CGFloat(dbl(wm["widthFraction"], 0.14))
            let h = w * image.size.height / image.size.width
            let pos = wm["position"] as? String ?? "top_right"
            layer.frame = flipped(CGRect(x: pos.hasSuffix("left") ? margin : canvas.width - margin - w,
                                         y: pos.hasPrefix("top") ? margin : canvas.height - margin - h, width: w, height: h), canvas)
        }
        return layer
    }

    // MARK: - Audio lanes

    private func musicParams(audio: [String: Any], composition: AVMutableComposition, durationMs: Double) -> [AVMutableAudioMixInputParameters] {
        guard let list = audio["music"] as? [[String: Any]] else { return [] }
        var out: [AVMutableAudioMixInputParameters] = []
        for m in list {
            let id = m["id"] as? String ?? ""
            guard let path = musicPaths[id], FileManager.default.fileExists(atPath: path) else {
                onErrorLater("MISSING_MEDIA", "No local file supplied for music '\(id)'")
                continue
            }
            let asset = AVURLAsset(url: URL(fileURLWithPath: path))
            guard let src = asset.tracks(withMediaType: .audio).first,
                  let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
            let start = dbl(m["timelineStartMs"], 0)
            let end = min(dbl(m["timelineEndMs"], durationMs), durationMs)
            var srcStart = dbl(m["sourceStartMs"], 0)
            let fileMs = asset.duration.seconds * 1000
            guard end > start, fileMs > 0 else { continue }
            // Loop the file to fill the slot.
            var tl = start
            var loops = 0
            while tl < end && loops < 500 {
                let len = min(end - tl, fileMs - srcStart)
                if len <= 0 { break }
                try? track.insertTimeRange(CMTimeRange(start: cm(srcStart), duration: cm(len)), of: src, at: cm(tl))
                tl += len
                srcStart = 0
                loops += 1
            }
            let p = AVMutableAudioMixInputParameters(track: track)
            let level = gain(dbl(m["volumeDb"], 0))
            let fi = min(dbl(m["fadeInMs"], 0), (end - start) / 2)
            let fo = min(dbl(m["fadeOutMs"], 0), (end - start) / 2)
            if fi > 0 { p.setVolumeRamp(fromStartVolume: 0, toEndVolume: level, timeRange: CMTimeRange(start: cm(start), duration: cm(fi))) } else { p.setVolume(level, at: cm(start)) }
            if fo > 0 { p.setVolumeRamp(fromStartVolume: level, toEndVolume: 0, timeRange: CMTimeRange(start: cm(end - fo), duration: cm(fo))) }
            if let duck = m["duck"] as? [String: Any], bool(duck["enabled"], false) { warn("Music ducking under speech is not applied on iOS yet") }
            out.append(p)
        }
        return out
    }

    private func sfxParams(audio: [String: Any], composition: AVMutableComposition, durationMs: Double) -> [AVMutableAudioMixInputParameters] {
        guard let list = audio["sfx"] as? [[String: Any]] else { return [] }
        var out: [AVMutableAudioMixInputParameters] = []
        // One composition track per effect: insertTimeRange shifts what follows on a shared track.
        for s in list {
            let id = s["id"] as? String ?? ""
            guard let path = sfxPaths[id], FileManager.default.fileExists(atPath: path) else {
                warn("A sound effect had no local file and was left out")
                continue
            }
            let asset = AVURLAsset(url: URL(fileURLWithPath: path))
            guard let src = asset.tracks(withMediaType: .audio).first,
                  let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
            let start = dbl(s["timelineStartMs"], 0)
            let len = min(dbl(s["durationMs"], asset.duration.seconds * 1000), asset.duration.seconds * 1000, durationMs - start)
            guard len > 0 else { continue }
            try? track.insertTimeRange(CMTimeRange(start: .zero, duration: cm(len)), of: src, at: cm(start))
            let p = AVMutableAudioMixInputParameters(track: track)
            p.setVolume(gain(dbl(s["volumeDb"], -12)), at: .zero)
            out.append(p)
        }
        return out
    }

    private func voiceoverParams(audio: [String: Any], composition: AVMutableComposition, durationMs: Double) -> [AVMutableAudioMixInputParameters] {
        guard let list = audio["voiceovers"] as? [[String: Any]] else { return [] }
        var out: [AVMutableAudioMixInputParameters] = []
        for v in list {
            let assetId = (v["source"] as? [String: Any])?["assetId"] as? String ?? ""
            guard let path = assetPaths[assetId], FileManager.default.fileExists(atPath: path) else {
                warn("A voiceover recording is not on this device and was left out")
                continue
            }
            let asset = AVURLAsset(url: URL(fileURLWithPath: path))
            guard let src = asset.tracks(withMediaType: .audio).first,
                  let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
            let start = dbl(v["timelineStartMs"], 0)
            let srcStart = dbl(v["sourceStartMs"], 0)
            let len = min(dbl(v["durationMs"], 0), asset.duration.seconds * 1000 - srcStart, durationMs - start)
            guard len > 0 else { continue }
            try? track.insertTimeRange(CMTimeRange(start: cm(srcStart), duration: cm(len)), of: src, at: cm(start))
            let p = AVMutableAudioMixInputParameters(track: track)
            let level = gain(dbl(v["volumeDb"], 0))
            let fi = min(dbl(v["fadeInMs"], 0), len / 2), fo = min(dbl(v["fadeOutMs"], 0), len / 2)
            if fi > 0 { p.setVolumeRamp(fromStartVolume: 0, toEndVolume: level, timeRange: CMTimeRange(start: cm(start), duration: cm(fi))) } else { p.setVolume(level, at: cm(start)) }
            if fo > 0 { p.setVolumeRamp(fromStartVolume: level, toEndVolume: 0, timeRange: CMTimeRange(start: cm(start + len - fo), duration: cm(fo))) }
            out.append(p)
        }
        return out
    }

    /// Music the caller did not supply is skipped (like a failed download) and reported.
    private func onErrorLater(_ code: String, _ message: String) { warn("\(message); exported without it") }

    // MARK: - Result

    /// The `completed` event payload, read back from the written file (same keys as Android).
    private func verifiedResult(expectedMs: Double) -> [String: Any] {
        let url = URL(fileURLWithPath: outputPath)
        let asset = AVURLAsset(url: url)
        var width = 0, height = 0
        if let v = asset.tracks(withMediaType: .video).first {
            let r = CGRect(origin: .zero, size: v.naturalSize).applying(v.preferredTransform)
            width = Int(abs(r.width).rounded()); height = Int(abs(r.height).rounded())
        }
        let attrs = try? FileManager.default.attributesOfItem(atPath: outputPath)
        let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
        return [
            "outputPath": outputPath,
            "durationMs": Int((asset.duration.seconds * 1000).rounded()),
            "expectedDurationMs": Int(expectedMs.rounded()),
            "width": width,
            "height": height,
            "hasAudio": !asset.tracks(withMediaType: .audio).isEmpty,
            "fileSizeBytes": size,
            "videoEncoder": "AVAssetExportSession",
            "warnings": warnings,
        ]
    }

    private func startTimer() {
        DispatchQueue.main.async { [weak self] in
            self?.progressTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                guard let self = self, let session = self.exportSession else { return }
                self.onProgress(Double(session.progress))
            }
        }
    }

    private func stopTimer() {
        DispatchQueue.main.async { [weak self] in
            self?.progressTimer?.invalidate()
            self?.progressTimer = nil
        }
    }

    private func cleanupOutput() {
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: outputPath))
    }
}
