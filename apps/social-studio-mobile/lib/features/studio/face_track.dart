// Faces on the OUTPUT timeline (IR `faceBoxes`) for v2 caption face avoidance, from the faces the phone detected on
// each source file (MediaEngineService.detectFaces: source ms, display-oriented source-frame fractions).
//
// The mapping follows the export (CompositionFactory.mainVideoEffects): horizontal flip first, then the clip's
// (moving) crop filled to the canvas; a clip without a crop is FITTED (letterboxed) into the canvas. Source time goes
// through the clip's speed. Faces outside what is visible are dropped. Not mapped: rotated clips (their faces are
// skipped) and zoom punch-ins (the face is then a little larger on screen than its box).
import '../../core/native_engine/edit_ir.dart';

class FaceTrack {
  FaceTrack._();

  /// Most samples sent to the renderers (the Android parser keeps 2000).
  static const maxSamples = 2000;

  static List<FaceSample> toTimeline(MobileEditIr ir, Map<String, List<FaceSample>> facesByAsset) {
    final out = <FaceSample>[];
    final canvasAspect = ir.canvas.width / ir.canvas.height;
    for (final c in ir.clips) {
      final faces = facesByAsset[c.assetId];
      if (faces == null || faces.isEmpty || c.rotationDeg != 0) continue;
      final speed = c.speed > 0 ? c.speed : 1.0;
      EditIrSource? src;
      for (final s in ir.sources) {
        if (s.assetId == c.assetId) src = s;
      }
      for (final f in faces) {
        if (f.tMs < c.sourceStartMs || f.tMs >= c.sourceEndMs) continue;
        final fx = c.flipH ? 1 - f.x : f.x;
        double x, y, w, h;
        final crop = c.cropAt(f.tMs);
        if (crop != null && crop.width > 0 && crop.height > 0) {
          x = (fx - crop.x) / crop.width;
          y = (f.y - crop.y) / crop.height;
          w = f.w / crop.width;
          h = f.h / crop.height;
        } else {
          // Fitted: the picture spans the canvas on one axis and is centred on the other.
          final srcAspect = (src != null && src.width > 0 && src.height > 0) ? src.width / src.height : canvasAspect;
          final sx = srcAspect >= canvasAspect ? 1.0 : srcAspect / canvasAspect;
          final sy = srcAspect >= canvasAspect ? canvasAspect / srcAspect : 1.0;
          x = 0.5 + (fx - 0.5) * sx;
          y = 0.5 + (f.y - 0.5) * sy;
          w = f.w * sx;
          h = f.h * sy;
        }
        if (x < 0 || x > 1 || y < 0 || y > 1) continue;
        out.add(FaceSample(tMs: c.timelineStartMs + ((f.tMs - c.sourceStartMs) / speed).round(), x: x, y: y, w: w, h: h));
      }
    }
    out.sort((a, b) => a.tMs.compareTo(b.tMs));
    if (out.length <= maxSamples) return out;
    return [for (var i = 0; i < maxSamples; i++) out[i * out.length ~/ maxSamples]];
  }
}
