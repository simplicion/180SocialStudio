import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/clip_audio_fades.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

MobileEditIr base() => TimelineOps.initial(projectId: 'p1', durationMs: 10000, width: 1920, height: 1080);

void main() {
  test('a single clip keeps the timeline start and end untouched', () {
    expect(clipPreviewFadesMs(base(), 0), (0.0, 0.0));
    expect(clipPreviewGainWithDeclick(base(), 0, 0), 1);
  });

  test('a hard cut gets a 10 ms fade-out before it and a 10 ms fade-in after it', () {
    final ir = TimelineOps.split(base(), 4000);
    expect(clipPreviewFadesMs(ir, 0), (0.0, 10.0));
    expect(clipPreviewFadesMs(ir, 1), (10.0, 0.0));
    expect(clipPreviewGainWithDeclick(ir, 0, 3995), closeTo(0.5, 1e-9));
    expect(clipPreviewGainWithDeclick(ir, 0, 4000), 0);
    expect(clipPreviewGainWithDeclick(ir, 1, 0), 0);
    expect(clipPreviewGainWithDeclick(ir, 1, 5), closeTo(0.5, 1e-9));
    expect(clipPreviewGainWithDeclick(ir, 1, 2000), 1);
  });

  test('a longer manual fade wins over the de-click minimum', () {
    final ir = TimelineOps.split(TimelineOps.setClipAudioFades(base(), fadeInMs: 0, fadeOutMs: 500), 4000);
    expect(clipPreviewFadesMs(ir, 1).$2, 500);
    expect(clipPreviewFadesMs(ir, 1).$1, 10);
    expect(clipPreviewFadesMs(ir, 0).$2, 10);
  });

  test('matches clipPreviewGain away from cuts', () {
    final ir = TimelineOps.setClipAudioFades(base(), fadeInMs: 2000, fadeOutMs: 1000);
    for (final t in [0, 1000, 5000, 9500]) {
      expect(clipPreviewGainWithDeclick(ir, 0, t), TimelineOps.clipPreviewGain(ir, 0, t));
    }
  });

  test('clips under 40 ms and muted clips get no de-click fade', () {
    // Three clips, then the middle one shortened to 30 ms (split refuses cuts that close to an edge).
    final j = TimelineOps.split(TimelineOps.split(base(), 4000), 5000).toJson();
    final clips = (j['clips'] as List).cast<Map<String, dynamic>>();
    clips[1]['sourceEndMs'] = 4030;
    clips[1]['timelineEndMs'] = 4030;
    final ir = MobileEditIr.fromJson(j);
    expect(ir.clips[1].timelineEndMs - ir.clips[1].timelineStartMs, 30);
    expect(clipPreviewFadesMs(ir, 1), (0.0, 0.0));
    final muted = TimelineOps.setClipVolume(TimelineOps.split(base(), 4000), -60);
    expect(clipPreviewFadesMs(muted, 0), (0.0, 0.0));
  });
}
