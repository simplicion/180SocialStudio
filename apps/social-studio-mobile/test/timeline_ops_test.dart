import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_exception.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/features/studio/caption_tools.dart';
import 'package:social_studio_mobile/features/studio/text_templates.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// 10 s landscape source with speech in [1s, 4s) and [6s, 9s).
final words = [
  for (var i = 0; i < 6; i++) TranscriptWord(text: 'w$i', startMs: 1000 + i * 500, endMs: 1400 + i * 500),
  for (var i = 0; i < 6; i++) TranscriptWord(text: 'v$i${i == 5 ? '.' : ''}', startMs: 6000 + i * 500, endMs: 6400 + i * 500),
];

MobileEditIr base() => TimelineOps.initial(projectId: 'p1', durationMs: 10000, width: 1920, height: 1080, words: words);

void main() {
  group('initial timeline', () {
    test('one clip over the whole source, centre-cropped to 9:16, with speech ranges', () {
      final ir = base();
      expect(ir.clips, hasLength(1));
      expect(ir.durationMs, 10000);
      expect(ir.canvas.width, 1080);
      expect(ir.canvas.height, 1920);
      final crop = ir.clips.single.crop!;
      expect(crop.height, 1);
      expect(crop.width, closeTo((9 / 16) / (16 / 9), 0.001));
      expect(crop.x, closeTo((1 - crop.width) / 2, 0.001));
      expect(ir.sources.single.durationMs, 10000);
      expect(ir.audio.speechRangesMs, [
        [1000, 3900],
        [6000, 8900],
      ]);
    });

    test('same-aspect source needs no crop; too-short source is rejected', () {
      final ir = TimelineOps.initial(projectId: 'p', durationMs: 5000, width: 1080, height: 1920);
      expect(ir.clips.single.crop, isNull);
      expect(() => TimelineOps.initial(projectId: 'p', durationMs: 50, width: 1080, height: 1920), throwsA(isA<MediaEngineException>()));
    });

    test('serialises sources and a non-null duck (server schema requirements)', () {
      final ir = TimelineOps.setMusic(base(), url: 'https://cdn.example.com/a.mp3', duckUnderSpeech: false);
      final j = ir.toJson();
      expect(j['sources'], [
        {'assetId': 'primary', 'durationMs': 10000, 'width': 1920, 'height': 1080}
      ]);
      expect(((j['audio'] as Map)['music'] as List).single['duck'], isA<Map>());
      final back = MobileEditIr.fromJson(j);
      expect(back.sources, hasLength(1));
      back.validate();
    });
  });

  group('main track edits keep every invariant', () {
    test('split creates two contiguous clips and keeps total duration', () {
      final ir = TimelineOps.split(base(), 5000);
      expect(ir.clips, hasLength(2));
      expect(ir.clips[0].sourceEndMs, 5000);
      expect(ir.clips[1].sourceStartMs, 5000);
      expect(ir.clips[1].timelineStartMs, 5000);
      expect(ir.durationMs, 10000);
      expect(ir.clips[0].id, isNot(ir.clips[1].id));
    });

    test('split at a clip edge is refused', () {
      expect(() => TimelineOps.split(base(), 50), throwsA(isA<MediaEngineException>()));
    });

    test('ripple delete shifts captions, zooms, b-roll, speech and music together', () {
      var ir = TimelineOps.autoCaptions(base(), words, wordsPerCaption: 3);
      ir = TimelineOps.addZoom(ir, startMs: 7000, durationMs: 1000);
      ir = TimelineOps.addBroll(ir, {'kind': 'url', 'url': 'https://x.test/b.mp4'}, startMs: 6500, durationMs: 1000);
      ir = TimelineOps.setMusic(ir, url: 'https://x.test/m.mp3');
      ir = TimelineOps.split(ir, 4500);
      ir = TimelineOps.split(ir, 5500);
      // Delete the middle second [4500, 5500): everything later moves 1 s earlier.
      final cut = TimelineOps.deleteClip(ir, 1);
      expect(cut.durationMs, 9000);
      expect(cut.zooms.single.startMs, 6000);
      expect(cut.overlays.single.timelineStartMs, 5500);
      expect(cut.audio.music.single.timelineEndMs, 9000, reason: 'full-length music keeps covering the video');
      expect(cut.audio.speechRangesMs.last, [5000, 7900]);
      final lateCaption = cut.captions.lastWhere((c) => c.kind == 'caption');
      expect(lateCaption.words.first.startMs, greaterThanOrEqualTo(lateCaption.startMs));
      expect(lateCaption.endMs, lessThanOrEqualTo(9000));
      // Word timings shifted by exactly the removed second.
      final v0 = cut.captions.expand((c) => c.words).firstWhere((w) => w.text == 'v0');
      expect(v0.startMs, 5000);
      cut.validate();
    });

    test('removeRange drops content inside the range and trims straddling items', () {
      var ir = TimelineOps.autoCaptions(base(), words, wordsPerCaption: 6);
      ir = TimelineOps.removeRange(ir, 0, 1000);
      expect(ir.durationMs, 9000);
      expect(ir.captions.first.startMs, 0);
      expect(ir.audio.speechRangesMs.first[0], 0);
      ir.validate();
    });

    test('captions after cuts + a re-order follow the timeline (no empty ranges, a word stays in its clip)', () {
      // Found by the on-device manual edit: grouping in source order clamped a caption to an empty range.
      var ir = TimelineOps.removeRange(base(), 4000, 6000);
      ir = TimelineOps.moveClip(ir, 1, 0); // the [6s, 10s) part now plays first
      ir = TimelineOps.autoCaptions(ir, words, wordsPerCaption: 3);
      ir.validate();
      final caps = ir.captions.where((c) => c.kind == 'caption').toList();
      expect(caps.every((c) => c.endMs > c.startMs), isTrue);
      expect(caps.first.text, startsWith('v0'), reason: 'the moved clip is captioned first');
      for (var i = 0; i < caps.length - 1; i++) {
        expect(caps[i].endMs, lessThanOrEqualTo(caps[i + 1].startMs));
      }
      expect(caps.expand((c) => c.words).map((w) => w.text).toSet(), containsAll(['w0', 'w5', 'v0', 'v5.']));
    });

    test('removePauses cuts the long pauses (and the silent head/tail) but no words', () {
      final ir = TimelineOps.removePauses(base(), words, minGapMs: 500, padMs: 100);
      ir.validate();
      // head 0..900, the 6 s gap 3.9..5.9 s (minus padding), tail 9.0..10 s
      expect(ir.durationMs, lessThan(10000 - 900 - 1800 - 900 + 50));
      for (final w in words) {
        final mid = (w.startMs + w.endMs) ~/ 2;
        expect(TimelineOps.sourceToTimeline(ir, mid), isNotNull, reason: '${w.text} is kept');
      }
    });

    test('removeFillers cuts "you know" and "um" wherever they play, also after a re-order', () {
      final talk = [
        TranscriptWord(text: 'So,', startMs: 1000, endMs: 1300),
        TranscriptWord(text: 'you', startMs: 1400, endMs: 1600),
        TranscriptWord(text: 'know,', startMs: 1600, endMs: 1900),
        TranscriptWord(text: 'this', startMs: 2000, endMs: 2300),
        TranscriptWord(text: 'works.', startMs: 2300, endMs: 2800),
        TranscriptWord(text: 'Um', startMs: 6000, endMs: 6400),
        TranscriptWord(text: 'really', startMs: 6500, endMs: 6900),
      ];
      var ir = TimelineOps.split(TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1920, height: 1080, words: talk), 5000);
      ir = TimelineOps.moveClip(ir, 1, 0);
      ir = TimelineOps.removeFillers(ir, talk);
      ir.validate();
      expect(TimelineOps.sourceToTimeline(ir, 1700), isNull, reason: '"know" is cut');
      expect(TimelineOps.sourceToTimeline(ir, 6200), isNull, reason: '"Um" is cut');
      expect(TimelineOps.sourceToTimeline(ir, 2100), isNotNull);
      expect(TimelineOps.sourceToTimeline(ir, 6700), isNotNull);
      expect(() => TimelineOps.removeFillers(base(), words), throwsA(isA<MediaEngineException>()), reason: 'nothing to remove is said, not faked');
    });

    test('stickers land in the spot farthest from the face', () {
      expect(TimelineOps.stickerSpotAwayFrom(null), TimelineOps.stickerSpots.first);
      expect(TimelineOps.stickerSpotAwayFrom((x: 0.7, y: 0.25)).x, lessThan(0.5), reason: 'face upper right → sticker left');
      final ir = base();
      final crop = ir.clips.first.crop!;
      // A face in the centre of the source shows in the centre of the 9:16 crop.
      final face = TimelineOps.faceOnCanvas(ir, [FaceSample(tMs: 2000, x: crop.x + crop.width * 0.72, y: 0.25, w: 0.1, h: 0.2)], 2000);
      expect(face!.x, closeTo(0.72, 0.01));
      final withSticker = TimelineOps.addSticker(ir, {'kind': 'url', 'url': 'https://x.test/s.png'}, startMs: 2000, avoidFace: face);
      expect(withSticker.overlays.single.layer!.x, lessThan(0.5));
    });

    test('word_pop captions make the spoken word pop (scale 1.15), other styles do not', () {
      final pop = TimelineOps.autoCaptions(base(), words, preset: 'BOLD_POP');
      final popAnim = pop.captions.first.style['animation'];
      expect(pop.captions.first.words.first.scale, popAnim == 'word_pop' ? 1.15 : 1.0);
      final restyled = TimelineOps.styleCaptions(pop, 'KARAOKE');
      if (restyled.captions.first.style['animation'] != 'word_pop') expect(restyled.captions.first.words.first.scale, 1.0);
    });

    test('removing the whole video is refused', () {
      expect(() => TimelineOps.removeRange(base(), 0, 10000), throwsA(isA<MediaEngineException>()));
    });

    test('speed change rescales duration and the items on that clip', () {
      var ir = TimelineOps.addZoom(base(), startMs: 8000, durationMs: 1000);
      ir = TimelineOps.setSpeed(ir, 2);
      expect(ir.durationMs, 5000);
      expect(ir.clips.single.timelineEndMs, 5000);
      expect(ir.zooms.single.startMs, 4000);
      expect(ir.zooms.single.endMs, 4500);
      expect(() => TimelineOps.setSpeed(ir, 10).clips.single.speed, returnsNormally);
      expect(TimelineOps.setSpeed(ir, 10).clips.single.speed, 4);
    });

    test('trim and reorder', () {
      var ir = TimelineOps.split(base(), 5000);
      ir = TimelineOps.trim(ir, 0, sourceStartMs: 1000, sourceEndMs: 4000);
      expect(ir.clips[0].timelineEndMs, 3000);
      expect(ir.clips[1].timelineStartMs, 3000);
      final moved = TimelineOps.moveClip(ir, 1, 0);
      expect(moved.clips[0].sourceStartMs, 5000);
      expect(moved.clips[0].timelineStartMs, 0);
      expect(moved.durationMs, ir.durationMs);
      expect(() => TimelineOps.trim(ir, 0, sourceStartMs: 1000, sourceEndMs: 1050), throwsA(isA<MediaEngineException>()));
    });

    test('the last clip cannot be deleted', () {
      expect(() => TimelineOps.deleteClip(base(), 0), throwsA(isA<MediaEngineException>()));
    });
  });

  group('look, canvas and audio', () {
    test('aspect change recomputes crops; fit mode clears them', () {
      final square = TimelineOps.setAspect(base(), '1:1');
      expect(square.canvas.width, square.canvas.height);
      expect(square.clips.single.crop!.width, closeTo(1080 / 1920, 0.001));
      final fit = TimelineOps.setAspect(base(), '9:16', fill: false);
      expect(fit.clips.single.crop, isNull);
      final wide = TimelineOps.setAspect(base(), '16:9');
      expect(wide.clips.single.crop, isNull, reason: '16:9 source on a 16:9 canvas');
    });

    test('rotate 90 re-centres the crop for the rotated frame and round-trips', () {
      final r = TimelineOps.rotate(base());
      expect(r.clips.single.rotationDeg, 90);
      expect(r.clips.single.crop, isNull, reason: 'a rotated 16:9 source is 9:16 already');
      final j = r.toJson();
      expect((j['clips'] as List).single['rotationDeg'], 90);
      expect((base().toJson()['clips'] as List).single.containsKey('rotationDeg'), isFalse);
      final flipped = TimelineOps.rotate(base(), rotate90: false, toggleFlip: true);
      expect(flipped.clips.single.flipH, isTrue);
    });

    test('filter, volume, transition only at cuts', () {
      var ir = TimelineOps.split(base(), 5000);
      ir = TimelineOps.setFilter(ir, EditIrFilter(preset: 'VIVID', saturation: 1.3), index: 1);
      expect(ir.clips[0].filter, isNull);
      expect(ir.clips[1].filter!.preset, 'VIVID');
      ir = TimelineOps.setClipVolume(ir, -100);
      expect(ir.clips.every((c) => c.volumeDb == -60), isTrue);
      ir = TimelineOps.setTransition(ir, EditIrTransition(durationMs: 300));
      expect(ir.clips[0].transitionIn, isNull);
      expect(ir.clips[1].transitionIn, isNotNull);
    });

    test('crop outside the frame is rejected', () {
      expect(() => TimelineOps.setCrop(base(), EditIrCrop(x: 0.8, y: 0, width: 0.5, height: 1)), throwsA(isA<MediaEngineException>()));
    });

    test('music needs a device file or web URL and ducks only with speech', () {
      // Device music is allowed (uploads from the phone); anything that is neither a path nor http(s) is rejected.
      expect(TimelineOps.setMusic(base(), url: 'file:///sdcard/a.mp3').audio.music, hasLength(1));
      expect(() => TimelineOps.setMusic(base(), url: 'ftp://host/a.mp3'), throwsA(isA<MediaEngineException>()));
      expect(() => TimelineOps.setMusic(base(), url: 'not a url'), throwsA(isA<MediaEngineException>()));
      final noSpeech = TimelineOps.initial(projectId: 'p', durationMs: 5000, width: 1080, height: 1920);
      expect(TimelineOps.setMusic(noSpeech, url: 'https://x.test/m.mp3').audio.music.single.duck!.enabled, isFalse);
      expect(TimelineOps.setMusic(base(), url: 'https://x.test/m.mp3').audio.music.single.duck!.enabled, isTrue);
      expect(() => TimelineOps.updateMusic(noSpeech, volumeDb: -10), throwsA(isA<MediaEngineException>()));
    });
  });

  group('text and captions', () {
    test('caption tools: key word, script fonts and subtitle files', () {
      expect(CaptionTools.keywordIndex(['this', 'cost', r'$500', 'amazing']), 2);
      expect(CaptionTools.keywordIndex(['the', 'biggest', 'mistake']), 1);
      expect(CaptionTools.keywordIndex(['so', 'here', 'we', 'go']), isNull);
      expect(CaptionTools.fontFor('आज हम', 'Anton'), 'Noto Sans Devanagari');
      expect(CaptionTools.fontFor('आज हम', 'Poppins'), 'Poppins');
      expect(CaptionTools.fontFor('aaj hum', 'Anton'), 'Anton');

      final ir = TimelineOps.autoCaptions(base(), words, wordsPerCaption: 6);
      final srt = CaptionTools.toSrt(ir);
      expect(srt, startsWith('1\n00:00:01,000 --> 00:00:03,900\nw0 w1 w2 w3 w4 w5\n\n2\n00:00:06,000 --> '));
      final vtt = CaptionTools.toVtt(ir);
      expect(vtt, startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:03.900\nw0 w1 w2 w3 w4 w5\n'));
    });

    test('enhanceCaptions highlights one key word, adds no emoji, and is idempotent', () {
      final spoken = [
        for (final (i, t) in ['we', 'made', 'serious', 'money', 'so', 'here', 'we', 'go'].indexed)
          TranscriptWord(text: t, startMs: 1000 + i * 400, endMs: 1350 + i * 400),
      ];
      final ir = TimelineOps.autoCaptions(
        TimelineOps.initial(projectId: 'p1', durationMs: 10000, width: 1080, height: 1920, words: spoken),
        spoken,
        wordsPerCaption: 4,
      );
      final out = TimelineOps.enhanceCaptions(ir);
      expect(out.captions[0].words.map((w) => w.highlight).toList(), [false, false, true, false]);
      expect(out.captions[0].text, 'we made serious money');
      expect(out.captions[0].words.last.endMs, ir.captions[0].words.last.endMs);
      expect(out.captions[1].text, 'so here we go');
      expect(out.captions[1].words.any((w) => w.highlight), isFalse);
      final again = TimelineOps.enhanceCaptions(out);
      expect(again.captions.map((c) => c.text).toList(), out.captions.map((c) => c.text).toList());
    });

    test('a correction with the same word count keeps every word timing; Hindi text gets a Devanagari font', () {
      final ir = TimelineOps.autoCaptions(base(), words, preset: 'HORMOZI_BOUNCE', wordsPerCaption: 3);
      final first = ir.captions.first;
      final fixed = TimelineOps.retextCaptions(ir, {first.id: 'one two three'}).captions.first;
      expect(fixed.words.map((w) => (w.startMs, w.endMs)).toList(), first.words.map((w) => (w.startMs, w.endMs)).toList());
      expect(fixed.style['fontFamily'], 'Anton');
      final hindi = TimelineOps.retextCaptions(ir, {first.id: 'आज हम बात'}).captions.first;
      expect(hindi.style['fontFamily'], 'Noto Sans Devanagari');
    });

    test('new creator templates: box and reveal motions survive style normalisation with a full style', () {
      const expected = {
        'RAJ_SHAMANI_BOLD': 'word_pop',
        'VARUN_MAYYA_BOX': 'word_box',
        'IMAN_GADZHI_LUXE': 'word_reveal',
        'MUMBAI_BUBBLE': 'word_box',
      };
      for (final e in expected.entries) {
        expect(TimelineOps.captionPresets.containsKey(e.key), isTrue, reason: e.key);
        final ir = TimelineOps.autoCaptions(base(), words, preset: e.key);
        final style = ir.captions.first.style;
        expect(style['preset'], e.key);
        expect(style['animation'], e.value);
        expect(normaliseCaptionStyle(style)['animation'], e.value);
        expect(ir.captions.first.words.first.scale, e.value == 'word_pop' ? 1.15 : 1.0);
      }
      expect(TimelineOps.captionStyle('MUMBAI_BUBBLE')['background'], isNotNull);
    });

    test('auto captions break on the Hindi danda and other non-Latin sentence ends', () {
      final hindi = [
        for (final (i, t) in ['आज', 'हम', 'बात', 'करेंगे।', 'चलो', 'शुरू', 'करें'].indexed)
          TranscriptWord(text: t, startMs: 1000 + i * 400, endMs: 1350 + i * 400),
      ];
      final ir = TimelineOps.autoCaptions(
        TimelineOps.initial(projectId: 'p1', durationMs: 10000, width: 1080, height: 1920, words: hindi),
        hindi,
        wordsPerCaption: 6,
      );
      expect(ir.captions.map((c) => c.text).toList(), ['आज हम बात करेंगे।', 'चलो शुरू करें']);
    });

    test('retextCaptions swaps the words, keeps range and style, and times words inside the caption', () {
      final ir = TimelineOps.autoCaptions(base(), words, preset: 'MRBEAST_HYPE', wordsPerCaption: 3);
      final first = ir.captions.first;
      final out = TimelineOps.retextCaptions(ir, {first.id: 'aaj hum baat karenge doston'});
      final c = out.captions.firstWhere((x) => x.id == first.id);
      expect(c.text, 'aaj hum baat karenge doston');
      expect(c.words.map((w) => w.text).toList(), ['aaj', 'hum', 'baat', 'karenge', 'doston']);
      expect((c.startMs, c.endMs), (first.startMs, first.endMs));
      expect(c.style, first.style);
      expect(c.words.first.startMs, c.startMs);
      expect(c.words.last.endMs, c.endMs);
      for (var i = 0; i < c.words.length; i++) {
        expect(c.words[i].endMs, greaterThan(c.words[i].startMs));
        if (i > 0) expect(c.words[i].startMs, greaterThanOrEqualTo(c.words[i - 1].endMs));
        expect(c.words[i].scale, 1.15);
      }
      // Captions that were not translated are untouched.
      expect(out.captions.where((x) => x.id != first.id).map((x) => x.text).toList(),
          ir.captions.where((x) => x.id != first.id).map((x) => x.text).toList());
      expect(TimelineOps.retextCaptions(ir, {first.id: '   '}).captions.first.text, first.text);
    });

    test('auto captions group words, break on sentence end, never overlap, carry a full style', () {
      final ir = TimelineOps.autoCaptions(base(), words, wordsPerCaption: 4);
      final caps = ir.captions;
      expect(caps.map((c) => c.words.length).reduce((a, b) => a + b), words.length);
      for (var i = 0; i < caps.length - 1; i++) {
        expect(caps[i].endMs, lessThanOrEqualTo(caps[i + 1].startMs));
      }
      expect(caps.last.text.endsWith('v5.'), isTrue);
      for (final k in ['preset', 'animation', 'fontFamily', 'fontWeight', 'fontSizePx', 'textColor', 'highlightColor', 'strokeColor', 'strokeWidthPx', 'shadow', 'background', 'uppercase', 'positionX', 'positionY', 'maxWidthFraction']) {
        expect(caps.first.style.containsKey(k), isTrue, reason: 'style.$k is required by the server schema');
      }
    });

    test('captions skip words that were cut out', () {
      final cut = TimelineOps.removeRange(base(), 900, 4000);
      final caps = TimelineOps.autoCaptions(cut, words);
      expect(caps.captions.expand((c) => c.words).any((w) => w.text.startsWith('w')), isFalse);
    });

    test('no transcript, no captions', () {
      expect(() => TimelineOps.autoCaptions(base(), const []), throwsA(isA<MediaEngineException>()));
    });

    test('titles survive caption regeneration and clear', () {
      var ir = TimelineOps.addText(base(), 'Hello', startMs: 0, durationMs: 2000);
      ir = TimelineOps.autoCaptions(ir, words);
      ir = TimelineOps.clearCaptions(ir);
      expect(ir.captions.single.kind, 'text');
      expect(() => TimelineOps.addText(ir, '   ', startMs: 0, durationMs: 1000), throwsA(isA<MediaEngineException>()));
    });

    test('overlapping zooms are refused', () {
      final ir = TimelineOps.addZoom(base(), startMs: 1000, durationMs: 2000);
      expect(() => TimelineOps.addZoom(ir, startMs: 2000, durationMs: 1000), throwsA(isA<MediaEngineException>()));
    });
  });

  group('face-centred reframe', () {
    final faces = [
      for (var i = 0; i < 10; i++) FaceSample(tMs: i * 500, x: i == 4 ? 0.1 : 0.75, y: 0.35, w: 0.1, h: 0.18),
      FaceSample(tMs: 0, x: 0.2, y: 0.5, w: 0.02, h: 0.03), // smaller face in the same frame: ignored
    ];

    test('faceFocus is the median of the largest face per sample, clamped', () {
      expect(TimelineOps.faceFocus(faces), (x: 0.75, y: 0.35));
      expect(TimelineOps.faceFocus(const []), isNull);
      expect(TimelineOps.faceFocus([FaceSample(tMs: 0, x: 0.99, y: 0.01, w: 0.1, h: 0.1)]), (x: 0.9, y: 0.1));
    });

    test('initial and setAspect centre the crop on the face and keep it inside the frame', () {
      final focus = TimelineOps.faceFocus(faces);
      final ir = TimelineOps.initial(projectId: 'p', durationMs: 5000, width: 1920, height: 1080, focus: focus);
      final c = ir.clips.single.crop!;
      expect(c.x + c.width / 2, closeTo(0.75, 0.001));
      final square = TimelineOps.setAspect(ir, '1:1', focus: focus).clips.single.crop!;
      expect(square.x + square.width, lessThanOrEqualTo(1.0001)); // clamped at the right edge
      expect(square.x, closeTo(1 - square.width, 0.001));
      final centred = TimelineOps.setAspect(ir, '9:16').clips.single.crop!;
      expect(centred.x, closeTo((1 - centred.width) / 2, 0.001));
    });
  });

  test('director sound effects round-trip and follow the footage through cuts', () {
    final json = base().toJson();
    (json['audio'] as Map)['sfx'] = [
      {'id': 's1', 'timelineStartMs': 2000, 'source': {'kind': 'url', 'url': 'https://x.test/whoosh.mp3'}, 'volumeDb': -12, 'credit': 'Whoosh by A (CC BY)'},
      {'id': 's2', 'timelineStartMs': 7000, 'durationMs': 800, 'source': {'kind': 'url', 'url': 'https://x.test/pop.mp3'}, 'volumeDb': -10},
    ];
    final ir = MobileEditIr.fromJson(json);
    expect(ir.audio.sfx, hasLength(2));
    expect(((ir.toJson()['audio'] as Map)['sfx'] as List).first['credit'], 'Whoosh by A (CC BY)');
    // Cut [1000, 3000): s1 (at 2000) is inside the cut and dropped; s2 moves 2 s earlier.
    final cut = TimelineOps.removeRange(ir, 1000, 3000);
    expect(cut.audio.sfx.map((e) => e.id), ['s2']);
    expect(cut.audio.sfx.single.timelineStartMs, 5000);
    expect((base().toJson()['audio'] as Map).containsKey('sfx'), isFalse, reason: 'omitted when empty');
    // Manual audio edits keep them.
    expect(TimelineOps.setOriginalVolume(ir, -6).audio.sfx, hasLength(2));
  });

  group('manual library + timeline items', () {
    test('sound effects: add at playhead, volume, move, trim, delete; JSON round-trip', () {
      var ir = TimelineOps.addSfx(base(), url: 'https://cdn.test/whoosh.mp3', startMs: 2000, durationMs: 800, credit: 'CC0');
      final id = ir.audio.sfx.single.id;
      expect(ir.audio.sfx.single.timelineStartMs, 2000);
      ir = TimelineOps.setSfxVolume(ir, id, -3);
      expect(ir.audio.sfx.single.volumeDb, -3);
      ir = TimelineOps.moveItem(ir, TrackKind.sfx, id, 9900);
      expect(ir.audio.sfx.single.timelineStartMs, 9200, reason: 'clamped so the effect ends inside the video');
      ir = TimelineOps.setItemRange(ir, TrackKind.sfx, id, 1000, 1500);
      expect((ir.audio.sfx.single.timelineStartMs, ir.audio.sfx.single.durationMs), (1000, 500));
      final back = MobileEditIr.fromJson(ir.toJson());
      expect(back.audio.sfx.single.credit, 'CC0');
      expect(TimelineOps.deleteItem(ir, TrackKind.sfx, id).audio.sfx, isEmpty);
      expect(TimelineOps.addSfx(base(), url: '/local/file.mp3', startMs: 0).audio.sfx, hasLength(1));
      expect(() => TimelineOps.addSfx(base(), url: 'ftp://host/file.mp3', startMs: 0), throwsA(isA<MediaEngineException>()));
    });

    test('text template: style applied with brand font, text and style editable, move keeps length', () {
      final t = TextTemplate.byId('lower_third')!;
      var ir = TimelineOps.addText(base(), 'Jane · Founder', startMs: 1000, durationMs: 3000, positionY: t.positionY,
          style: t.style(BrandLook(font: 'Poppins', primaryColor: '#1F3A2E')));
      final cap = ir.captions.single;
      expect(cap.style['fontFamily'], 'Poppins');
      expect((cap.style['background'] as Map)['color'], '#1F3A2EE6');
      ir = TimelineOps.editText(ir, cap.id, text: 'New words', style: TextTemplate.byId('bold_title')!.style());
      expect(ir.captions.single.text, 'New words');
      expect(ir.captions.single.style['preset'], 'TPL_BOLD_TITLE');
      ir = TimelineOps.moveItem(ir, TrackKind.text, cap.id, 5000);
      expect((ir.captions.single.startMs, ir.captions.single.endMs), (5000, 8000));
    });

    test('items() lists what the AI or the user placed, per track', () {
      var ir = TimelineOps.addBroll(base(), {'kind': 'url', 'url': 'https://cdn.test/b.mp4', 'query': 'coffee'}, startMs: 1000);
      ir = TimelineOps.addZoom(ir, startMs: 5000);
      ir = TimelineOps.setMusic(ir, url: 'https://cdn.test/m.mp3', title: 'Lo-fi');
      final kinds = TimelineOps.items(ir).map((i) => i.kind).toSet();
      expect(kinds, containsAll([TrackKind.video, TrackKind.broll, TrackKind.zoom, TrackKind.music]));
      final broll = TimelineOps.items(ir).firstWhere((i) => i.kind == TrackKind.broll);
      final trimmed = TimelineOps.setItemRange(ir, TrackKind.broll, broll.id, 1500, 2500);
      expect((trimmed.overlays.single.timelineStartMs, trimmed.overlays.single.sourceStartMs), (1500, 500));
      final music = TimelineOps.setItemRange(ir, TrackKind.music, ir.audio.music.single.id, 0, 6000);
      expect(music.audio.music.single.timelineEndMs, 6000);
    });

    test('zooms cannot be moved onto another zoom', () {
      var ir = TimelineOps.addZoom(base(), startMs: 1000);
      ir = TimelineOps.addZoom(ir, startMs: 5000);
      expect(() => TimelineOps.moveItem(ir, TrackKind.zoom, ir.zooms.last.id, 1200), throwsA(isA<MediaEngineException>()));
    });
  });

  group('effects and photos', () {
    test('effects: default length per type, round-trip, follow cuts, omitted when empty', () {
      var ir = TimelineOps.addEffect(base(), 'flash', startMs: 6000, intensity: 0.8);
      expect((ir.effects.single.startMs, ir.effects.single.endMs, ir.effects.single.intensity), (6000, 6300, 0.8));
      expect((ir.toJson()['effects'] as List).single['type'], 'flash');
      expect(MobileEditIr.fromJson(ir.toJson()).effects.single.type, 'flash');
      ir = TimelineOps.removeRange(ir, 1000, 3000);
      expect(ir.effects.single.startMs, 4000, reason: 'moved 2 s earlier with the footage');
      ir = TimelineOps.setEffectIntensity(ir, ir.effects.single.id, 0.3);
      expect(ir.effects.single.intensity, 0.3);
      expect(TimelineOps.items(ir).where((i) => i.kind == TrackKind.effect), hasLength(1));
      expect(TimelineOps.deleteItem(ir, TrackKind.effect, ir.effects.single.id).toJson().containsKey('effects'), isFalse);
      expect(() => TimelineOps.addEffect(base(), 'glitter', startMs: 0), throwsA(isA<MediaEngineException>()));
    });

    test('effects survive unrelated edits (watermark, audio, captions)', () {
      var ir = TimelineOps.addEffect(base(), 'vignette', startMs: 0);
      ir = TimelineOps.setOriginalVolume(ir, -3);
      ir = TimelineOps.addText(ir, 'Hi', startMs: 0, durationMs: 1000);
      ir = ir.withWatermark(EditIrWatermark(imageUrl: 'https://cdn.test/logo.png'));
      expect(ir.effects.single.type, 'vignette');
    });

    test('photo overlays keep mediaType through moves, trims and JSON', () {
      var ir = TimelineOps.addBroll(base(), {'kind': 'url', 'url': 'https://cdn.test/p.jpg'}, startMs: 2000, durationMs: 3000, image: true);
      final id = ir.overlays.single.id;
      ir = TimelineOps.moveItem(ir, TrackKind.broll, id, 4000);
      ir = TimelineOps.setItemRange(ir, TrackKind.broll, id, 4500, 6000);
      final o = MobileEditIr.fromJson(ir.toJson()).overlays.single;
      expect((o.isImage, o.timelineStartMs, o.sourceStartMs), (true, 4500, 0));
      expect(ir.toJson()['overlays'][0]['mediaType'], 'image');
      final video = TimelineOps.addBroll(base(), {'kind': 'url', 'url': 'https://cdn.test/v.mp4'}, startMs: 0);
      expect((video.toJson()['overlays'] as List).single.containsKey('mediaType'), isFalse);
    });
  });

  group('caption presets (desktop Caption Studio parity)', () {
    test('all 8 viral presets + the 4 classic ones produce complete styles; classic ids unchanged', () {
      const required = ['preset', 'animation', 'fontFamily', 'fontWeight', 'fontSizePx', 'textColor', 'highlightColor',
          'strokeColor', 'strokeWidthPx', 'shadow', 'background', 'uppercase', 'positionX', 'positionY', 'maxWidthFraction'];
      expect(TimelineOps.captionPresets.keys, containsAll(['CLEAN', 'BOLD_POP', 'KARAOKE', 'BOXED', 'HORMOZI_BOUNCE',
          'MRBEAST_HYPE', 'ALI_ABDAAL_CLEAN', 'DAN_KOE_MINIMAL', 'CYBER_NEON', 'KARAOKE_FROSTED', 'VOX_EXPLAINER', 'CINEMATIC_SUBTITLE']));
      for (final id in TimelineOps.captionPresets.keys) {
        final st = TimelineOps.captionStyle(id);
        expect(st.keys, containsAll(required), reason: id);
        expect(st['preset'], id);
        expect(['word_pop', 'karaoke', 'word_box', 'word_reveal', 'none'], contains(st['animation']));
      }
      expect(TimelineOps.captionStyle('BOLD_POP')['fontSizePx'], 72);
      expect(TimelineOps.captionStyle('BOLD_POP')['highlightColor'], '#FFE600');
    });

    test('viral presets carry the desktop values; highlight override and glow are optional', () {
      final h = TimelineOps.captionStyle('HORMOZI_BOUNCE');
      expect((h['fontFamily'], h['fontSizePx'], h['textColor'], h['highlightColor'], h['strokeWidthPx']),
          ('Anton', 52, '#FACC15', '#22C55E', 3));
      expect((TimelineOps.captionStyle('VOX_EXPLAINER')['background'] as Map)['color'], '#FACC15');
      expect(TimelineOps.captionStyle('CINEMATIC_SUBTITLE')['fontFamily'], 'Bebas Neue');
      expect(TimelineOps.captionStyle('CYBER_NEON')['glow'], isTrue);
      expect(TimelineOps.captionStyle('CLEAN').containsKey('glow'), isFalse);
      expect(TimelineOps.captionStyle('MRBEAST_HYPE', highlightColor: '#22D3EE')['highlightColor'], '#22D3EE');

      // Test newly added ONE_WORD_PUNCH and GOLDEN_LUXURY
      final punch = TimelineOps.captionStyle('ONE_WORD_PUNCH');
      expect((punch['fontFamily'], punch['fontSizePx'], punch['uppercase']), ('Montserrat', 60, true));
      final luxe = TimelineOps.captionStyle('GOLDEN_LUXURY');
      expect((luxe['fontFamily'], luxe['fontSizePx']), ('Playfair Display', 46));

      // Test fontSizePx override
      final customSize = TimelineOps.captionStyle('HORMOZI_BOUNCE', fontSizePx: 84);
      expect(customSize['fontSizePx'], 84);
    });

    test('apply to all: styleCaptions restyles speech captions only and survives JSON', () {
      var ir = TimelineOps.autoCaptions(base(), words, fontSizePx: 70);
      expect(ir.captions.first.style['fontSizePx'], 70);
      ir = TimelineOps.addText(ir, 'Title', startMs: 0, durationMs: 1000);
      ir = TimelineOps.styleCaptions(ir, 'ALI_ABDAAL_CLEAN', fontSizePx: 56);
      final back = MobileEditIr.fromJson(ir.toJson());
      expect(back.captions.where((c) => c.kind == 'caption').every((c) => c.style['fontFamily'] == 'Poppins' && c.style['fontSizePx'] == 56), isTrue);
      expect(back.captions.firstWhere((c) => c.kind == 'text').style['fontFamily'], isNot('Poppins'));
    });
  });

  group('track mute', () {
    test('voice mute sets original audio to -60 dB and unmute restores the previous level', () {
      var ir = TimelineOps.setOriginalVolume(base(), -4);
      final before = TimelineOps.trackVolumes(ir, TrackKind.voice);
      ir = TimelineOps.setTrackMuted(ir, TrackKind.voice, true);
      expect(ir.audio.originalVolumeDb, TimelineOps.mutedDb);
      expect(TimelineOps.isTrackMuted(ir, TrackKind.voice), isTrue);
      ir = TimelineOps.setTrackMuted(ir, TrackKind.voice, false, restoreDb: before);
      expect(ir.audio.originalVolumeDb, -4);
      expect(TimelineOps.setTrackMuted(TimelineOps.setTrackMuted(base(), TrackKind.voice, true), TrackKind.voice, false)
          .audio.originalVolumeDb, 0, reason: 'default when the previous level is unknown');
    });

    test('music and SFX mute every item and restore each one; other tracks are untouched', () {
      var ir = TimelineOps.setMusic(base(), url: 'https://cdn.test/m.mp3', volumeDb: -12);
      ir = TimelineOps.addSfx(ir, url: 'https://cdn.test/a.mp3', startMs: 1000, volumeDb: -3);
      ir = TimelineOps.addSfx(ir, url: 'https://cdn.test/b.mp3', startMs: 3000, volumeDb: -9);
      final sfxBefore = TimelineOps.trackVolumes(ir, TrackKind.sfx);
      final musicBefore = TimelineOps.trackVolumes(ir, TrackKind.music);
      ir = TimelineOps.setTrackMuted(ir, TrackKind.sfx, true);
      ir = TimelineOps.setTrackMuted(ir, TrackKind.music, true);
      expect(ir.audio.sfx.map((e) => e.volumeDb), everyElement(TimelineOps.mutedDb));
      expect(ir.audio.music.single.volumeDb, TimelineOps.mutedDb);
      expect(ir.audio.originalVolumeDb, 0);
      expect(TimelineOps.isTrackMuted(ir, TrackKind.voice), isFalse);
      ir = TimelineOps.setTrackMuted(ir, TrackKind.sfx, false, restoreDb: sfxBefore);
      ir = TimelineOps.setTrackMuted(ir, TrackKind.music, false, restoreDb: musicBefore);
      expect(ir.audio.sfx.map((e) => e.volumeDb).toList(), [-3, -9]);
      expect(ir.audio.music.single.volumeDb, -12);
      expect(TimelineOps.isTrackMuted(base(), TrackKind.music), isFalse, reason: 'an empty track is not muted');
    });

    test('voice track lists speech ranges and cannot be moved or deleted', () {
      final voice = TimelineOps.items(base()).where((i) => i.kind == TrackKind.voice).toList();
      expect(voice.map((v) => (v.startMs, v.endMs)), [(1000, 3900), (6000, 8900)]);
      expect(() => TimelineOps.moveItem(base(), TrackKind.voice, voice.first.id, 0), throwsA(isA<MediaEngineException>()));
      expect(() => TimelineOps.deleteItem(base(), TrackKind.voice, voice.first.id), throwsA(isA<MediaEngineException>()));
    });
  });

  group('transitions', () {
    test('mobile transition types round-trip; unknown types are kept', () {
      for (final type in EditIrTransition.types.keys.where((t) => t != 'CUT')) {
        var ir = TimelineOps.split(base(), 5000);
        ir = TimelineOps.setTransition(ir, EditIrTransition(type: type, durationMs: 400));
        expect(MobileEditIr.fromJson(ir.toJson()).clips[1].transitionIn!.type, type);
      }
      final odd = EditIrTransition(type: 'WIPE_LEFT', durationMs: 300);
      expect(odd.isKnown, isFalse);
      expect(EditIrTransition.fromJson(odd.toJson()).type, 'WIPE_LEFT');
    });
  });
}
