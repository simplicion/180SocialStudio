import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

MobileEditIr base() => TimelineOps.initial(projectId: 'p1', durationMs: 10000, width: 1920, height: 1080);

void main() {
  test('fades are stored, capped at half the clip, and round-trip', () {
    final ir = TimelineOps.setClipAudioFades(base(), fadeInMs: 1500, fadeOutMs: 9000);
    final c = ir.clips.single;
    expect(c.audioFadeInMs, 1500);
    expect(c.audioFadeOutMs, 5000);
    final back = MobileEditIr.fromJson(ir.toJson()).clips.single;
    expect([back.audioFadeInMs, back.audioFadeOutMs], [1500, 5000]);
    expect(base().clips.single.toJson().containsKey('audioFadeInMs'), isFalse);
  });

  test('split keeps the fade-in on the first part and the fade-out on the second', () {
    final ir = TimelineOps.split(TimelineOps.setClipAudioFades(base(), fadeInMs: 1000, fadeOutMs: 1000), 4000);
    expect([ir.clips[0].audioFadeInMs, ir.clips[0].audioFadeOutMs], [1000, 0]);
    expect([ir.clips[1].audioFadeInMs, ir.clips[1].audioFadeOutMs], [0, 1000]);
  });

  test('preview gain follows the same ramps as the export', () {
    final ir = TimelineOps.setClipAudioFades(base(), fadeInMs: 2000, fadeOutMs: 1000);
    expect(TimelineOps.clipPreviewGain(ir, 0, 0), 0);
    expect(TimelineOps.clipPreviewGain(ir, 0, 1000), closeTo(0.5, 1e-9));
    expect(TimelineOps.clipPreviewGain(ir, 0, 5000), 1);
    expect(TimelineOps.clipPreviewGain(ir, 0, 9500), closeTo(0.5, 1e-9));
    expect(TimelineOps.clipPreviewGain(TimelineOps.setClipVolume(base(), -60), 0, 5000), 0);
    expect(TimelineOps.clipPreviewGain(TimelineOps.setClipVolume(base(), -6), 0, 5000), closeTo(0.501, 1e-3));
  });

  test('voiceover: placed at the playhead, clipped to the end, round-trips, follows ripple edits', () {
    var ir = TimelineOps.addVoiceover(base(), assetId: 'rec1', atMs: 8000, durationMs: 5000);
    final v = ir.audio.voiceovers.single;
    expect([v.timelineStartMs, v.durationMs], [8000, 2000]);
    expect(MobileEditIr.fromJson(ir.toJson()).audio.voiceovers.single.toJson(), v.toJson());
    // Cutting 0-2000 moves the voiceover 2 s earlier.
    ir = TimelineOps.removeRange(ir, 0, 2000);
    expect(ir.audio.voiceovers.single.timelineStartMs, 6000);
    // Trimming its start moves the source start with it; the end cannot grow past the recording.
    final id = ir.audio.voiceovers.single.id;
    ir = TimelineOps.setItemRange(ir, TrackKind.voiceover, id, 6500, 9000);
    final t = ir.audio.voiceovers.single;
    expect([t.timelineStartMs, t.sourceStartMs, t.timelineEndMs], [6500, 500, 8000]);
    expect(TimelineOps.items(ir).where((i) => i.kind == TrackKind.voiceover).length, 1);
    expect(TimelineOps.deleteItem(ir, TrackKind.voiceover, id).audio.voiceovers, isEmpty);
  });

  test('speed ramp splits the clip into parts with the preset speeds and the right length', () {
    final ir = TimelineOps.speedRamp(base(), 0, 'hero');
    expect(ir.clips.map((c) => c.speed), [1.0, 0.4, 1.0]);
    expect(ir.clips.first.sourceStartMs, 0);
    expect(ir.clips.last.sourceEndMs, 10000);
    // 3.5 s + 3 s / 0.4 + 3.5 s = 14.5 s
    expect(ir.durationMs, closeTo(14500, 5));
  });
}
