import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

void main() {
  MobileEditIr withSticker() {
    final ir = TimelineOps.addSticker(TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920), {'kind': 'asset', 'assetId': 'a'},
        startMs: 1000, durationMs: 4000);
    return TimelineOps.updateOverlay(ir, ir.overlays.single.id, layer: const EditIrLayer(x: 0.2, y: 0.2, scale: 0.3));
  }

  test('two keyframes animate the layer between them; a keyframe near the playhead is edited, not duplicated', () {
    var ir = withSticker();
    final id = ir.overlays.single.id;
    ir = TimelineOps.setLayerKeyframe(ir, id, 1000); // at the start, current pose
    ir = TimelineOps.setLayerKeyframe(ir, id, 3000, x: 0.8, y: 0.6, scale: 0.5);
    final layer = ir.overlays.single.layer!;
    expect(layer.keyframes.map((k) => k.atMs), [0, 2000]);
    final mid = layerAt(layer, 1000, 1);
    expect(mid.x, closeTo(0.5, 1e-9));
    expect(mid.scale, closeTo(0.4, 1e-9));
    // Dragging at 3.02 s edits the 2 s keyframe.
    ir = TimelineOps.setLayerKeyframe(ir, id, 3020, x: 0.9);
    expect(ir.overlays.single.layer!.keyframes.length, 2);
    expect(ir.overlays.single.layer!.keyframes.last.x, 0.9);
    ir = TimelineOps.removeLayerKeyframe(ir, id, ir.overlays.single.layer!.keyframes.last.atMs);
    expect(ir.overlays.single.layer!.keyframes.length, 1);
    expect(() => TimelineOps.setLayerKeyframe(ir, id, 9000), throwsA(isA<Exception>()));
  });
}
