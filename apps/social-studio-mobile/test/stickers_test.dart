import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

void main() {
  test('a sticker is a contained image layer that pops in, and round-trips', () {
    final ir = TimelineOps.addSticker(
      TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920),
      {'kind': 'asset', 'assetId': 'local_1'},
      startMs: 9000,
    );
    final o = ir.overlays.single;
    expect([o.timelineStartMs, o.timelineEndMs], [9000, 10000]);
    expect(o.isImage, isTrue);
    expect(o.fit, 'contain');
    expect(o.isLayer, isTrue);
    expect(o.layer!.keyframes.first.opacity, 0);
    final back = MobileEditIr.fromJson(ir.toJson()).overlays.single;
    expect(back.layer!.toJson(), o.layer!.toJson());
    expect(back.source, {'kind': 'asset', 'assetId': 'local_1'});
  });
}
