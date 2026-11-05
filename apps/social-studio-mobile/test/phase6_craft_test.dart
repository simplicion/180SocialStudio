import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// Editor overhaul Phase 6 on the phone: moving crops, J/L cuts, several music beds, frame-accurate cuts.
MobileEditIr base({int ms = 10000, int fps = 30}) => TimelineOps.initial(projectId: 'p', durationMs: ms, width: 1920, height: 1080, fps: fps);

void main() {
  test('cropAt interpolates the moving crop linearly and holds it at the ends', () {
    final c = EditIrClip(
      id: 'c',
      sourceStartMs: 0,
      sourceEndMs: 4000,
      timelineStartMs: 0,
      timelineEndMs: 4000,
      crop: EditIrCrop(x: 0.1, y: 0, width: 0.3164, height: 1),
      cropKeyframes: const [EditIrCropKeyframe(sourceMs: 1000, x: 0.1, y: 0), EditIrCropKeyframe(sourceMs: 3000, x: 0.5, y: 0)],
    );
    expect(c.cropAt(0)!.x, 0.1);
    expect(c.cropAt(2000)!.x, closeTo(0.3, 1e-9));
    expect(c.cropAt(3999)!.x, 0.5);
    expect(c.cropAt(2000)!.width, 0.3164, reason: 'the window keeps its size');
    final back = EditIrClip.fromJson(c.toJson());
    expect(back.cropKeyframes.length, 2);
  });

  test('setting the crop by hand replaces the moving crop', () {
    var ir = base();
    final c = ir.clips.first;
    ir = ir.copyWith(clips: [
      EditIrClip(id: c.id, sourceStartMs: c.sourceStartMs, sourceEndMs: c.sourceEndMs, timelineStartMs: 0, timelineEndMs: c.timelineEndMs, crop: c.crop,
          cropKeyframes: const [EditIrCropKeyframe(sourceMs: 0, x: 0.1, y: 0), EditIrCropKeyframe(sourceMs: 5000, x: 0.6, y: 0)]),
    ]);
    final manual = TimelineOps.setCrop(ir, EditIrCrop(x: 0.2, y: 0, width: 0.3164, height: 1), index: 0);
    expect(manual.clips.first.cropKeyframes, isEmpty);
  });

  test('setJLCut clamps to the footage and the neighbouring clip; a split keeps lead at the front, lag at the back', () {
    var ir = TimelineOps.split(base(), 5000);
    ir = TimelineOps.setJLCut(ir, 1, leadMs: 300, lagMs: 9000);
    expect(ir.clips[1].audioLeadMs, 300);
    expect(ir.clips[1].audioLagMs, 0, reason: 'the last clip has nothing after it');
    ir = TimelineOps.setJLCut(ir, 0, leadMs: 300);
    expect(ir.clips[0].audioLeadMs, 0, reason: 'the first clip has nothing before it');
    ir.validate();
    final again = TimelineOps.split(ir, 7000);
    expect(again.clips[1].audioLeadMs, 300, reason: 'front piece keeps the J-cut');
    expect(again.clips[2].audioLeadMs, 0, reason: 'a split itself is seamless');
  });

  test('music beds: a second bed for part of the video; overlaps refused; edits target one bed', () {
    var ir = TimelineOps.setMusic(base(), url: 'https://cdn.test/a.mp3');
    ir = TimelineOps.updateMusic(ir, volumeDb: -20);
    final first = ir.audio.music.single;
    expect(() => TimelineOps.addMusicBed(ir, url: 'https://cdn.test/b.mp3', startMs: 6000, endMs: 9000), throwsA(isA<Exception>()), reason: 'the first bed covers the whole video');
    ir = ir.copyWith(audio: EditIrAudio(music: [
      EditIrMusic(id: first.id, timelineStartMs: 0, timelineEndMs: 5000, source: first.source, volumeDb: first.volumeDb, fadeInMs: 0, fadeOutMs: 0, duck: first.duck),
    ]));
    ir = TimelineOps.addMusicBed(ir, url: 'https://cdn.test/b.mp3', startMs: 6000, endMs: 9000);
    expect(ir.audio.music.length, 2);
    ir.validate();
    final second = ir.audio.music[1].id;
    ir = TimelineOps.updateMusic(ir, id: second, volumeDb: -8);
    expect(ir.audio.music.first.volumeDb, -20, reason: 'the other bed is untouched');
    expect(ir.audio.music[1].volumeDb, -8);
    ir = TimelineOps.removeMusic(ir, id: second);
    expect(ir.audio.music.single.id, first.id);
  });

  test('frame-accurate cuts: clip ends land on frames, and repeated edits do not drift', () {
    var ir = TimelineOps.removeRange(base(), 1234, 2345);
    const frame = 1000 / 30;
    for (final c in ir.clips) {
      final f = c.timelineEndMs / frame;
      expect((c.timelineEndMs - f.round() * frame).abs() <= 1.5, isTrue, reason: 'clip end ${c.timelineEndMs} is on a frame');
    }
    ir.validate();
    final zoomed = TimelineOps.addZoom(ir, startMs: 500);
    final again = TimelineOps.split(TimelineOps.moveItem(zoomed, TrackKind.zoom, zoomed.zooms.single.id, 800), 6000);
    again.validate();
    // Splitting re-lays every clip out: the ends that were on frames stay exactly where they were.
    expect(again.clips.first.timelineEndMs, ir.clips.first.timelineEndMs);
    expect(again.clips.last.timelineEndMs, ir.clips.last.timelineEndMs);
  });
}
