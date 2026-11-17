import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/face_track.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

FaceSample face(int tMs, double x, double y, {double w = 0.1, double h = 0.1}) => FaceSample(tMs: tMs, x: x, y: y, w: w, h: h);

void main() {
  test('a 16:9 source reframed to 9:16 (crop): a face at the frame centre lands at the canvas centre, scaled', () {
    // initial() centre-crops a 1280x720 source to 9:16: the window is 405/1280 of the width.
    final ir = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1280, height: 720);
    final crop = ir.clips.single.crop!;
    final out = FaceTrack.toTimeline(ir, {'primary': [face(2000, 0.5, 0.4)]});
    expect(out, hasLength(1));
    expect(out.single.tMs, 2000);
    expect(out.single.x, closeTo(0.5, 1e-6));
    expect(out.single.y, closeTo(0.4, 1e-6), reason: 'full height kept, so y is unchanged');
    expect(out.single.w, closeTo(0.1 / crop.width, 1e-6), reason: 'the face is wider on screen than in the source');
  });

  test('faces outside the visible crop window are dropped', () {
    final ir = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1280, height: 720);
    expect(FaceTrack.toTimeline(ir, {'primary': [face(1000, 0.05, 0.4)]}), isEmpty);
  });

  test('cuts and speed: source time maps through each clip; a face in a cut part is gone', () {
    var ir = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920);
    ir = TimelineOps.removeRange(ir, 2000, 4000); // source 4000.. now plays from 2000
    final out = FaceTrack.toTimeline(ir, {'primary': [face(1000, 0.5, 0.3), face(3000, 0.5, 0.3), face(5000, 0.5, 0.3)]});
    expect(out.map((f) => f.tMs).toList(), [1000, 3000], reason: 'source 3000 was cut; source 5000 plays at 3000');

    final fast = ir.copyWith(clips: [
      for (final c in ir.clips)
        EditIrClip(
          id: c.id, assetId: c.assetId, sourceStartMs: c.sourceStartMs, sourceEndMs: c.sourceEndMs,
          timelineStartMs: c.timelineStartMs, timelineEndMs: c.timelineStartMs + ((c.sourceEndMs - c.sourceStartMs) / 2).round(),
          speed: 2, volumeDb: c.volumeDb, crop: c.crop,
        ),
    ]);
    expect(FaceTrack.toTimeline(fast, {'primary': [face(1000, 0.5, 0.3)]}).single.tMs, 500, reason: '2x speed halves the time');
  });

  test('a mirrored clip mirrors the face', () {
    final ir = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920);
    final c = ir.clips.single;
    final flipped = ir.copyWith(clips: [
      EditIrClip(
        id: c.id, assetId: c.assetId, sourceStartMs: c.sourceStartMs, sourceEndMs: c.sourceEndMs,
        timelineStartMs: c.timelineStartMs, timelineEndMs: c.timelineEndMs, speed: c.speed, volumeDb: c.volumeDb, crop: c.crop, flipH: true,
      ),
    ]);
    expect(FaceTrack.toTimeline(flipped, {'primary': [face(1000, 0.3, 0.3)]}).single.x, closeTo(0.7, 1e-6));
  });

  test('an uncropped landscape clip on a 9:16 canvas is letterboxed: the face moves toward the middle band', () {
    final base = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1280, height: 720);
    final c = base.clips.single;
    final fitted = base.copyWith(clips: [
      EditIrClip(
        id: c.id, assetId: c.assetId, sourceStartMs: c.sourceStartMs, sourceEndMs: c.sourceEndMs,
        timelineStartMs: c.timelineStartMs, timelineEndMs: c.timelineEndMs, speed: c.speed, volumeDb: c.volumeDb, crop: null,
      ),
    ]);
    final f = FaceTrack.toTimeline(fitted, {'primary': [face(1000, 0.25, 0.0, w: 0.2, h: 0.2)]}).single;
    // Picture height on the canvas = (9/16) / (16/9) of the canvas height.
    const sy = (9 / 16) / (16 / 9);
    expect(f.x, closeTo(0.25, 1e-6), reason: 'full width');
    expect(f.y, closeTo(0.5 - 0.5 * sy, 1e-6), reason: 'top of the picture = top of the letterbox band');
    expect(f.h, closeTo(0.2 * sy, 1e-6));
  });

  test('faces of other assets map through their own clips; unknown assets and rotated clips are skipped', () {
    final ir = TimelineOps.initial(projectId: 'p', durationMs: 4000, width: 1080, height: 1920);
    expect(FaceTrack.toTimeline(ir, {'other': [face(1000, 0.5, 0.5)]}), isEmpty);
    final c = ir.clips.single;
    final rotated = ir.copyWith(clips: [
      EditIrClip(
        id: c.id, assetId: c.assetId, sourceStartMs: c.sourceStartMs, sourceEndMs: c.sourceEndMs,
        timelineStartMs: c.timelineStartMs, timelineEndMs: c.timelineEndMs, speed: c.speed, volumeDb: c.volumeDb, crop: c.crop, rotationDeg: 90,
      ),
    ]);
    expect(FaceTrack.toTimeline(rotated, {'primary': [face(1000, 0.5, 0.5)]}), isEmpty);
  });
}
