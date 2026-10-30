import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';

void main() {
  group('MobileEditIr Watermark & SFX serialization', () {
    test('Watermark round-trips from JSON -> Dart -> JSON with identical attributes', () {
      final json = <String, dynamic>{
        'schemaVersion': 'mobile-editir/1',
        'projectId': 'proj_123',
        'canvas': {
          'aspect': '9:16',
          'width': 1080,
          'height': 1920,
          'fps': 30,
          'background': '#000000',
        },
        'durationMs': 5000,
        'sources': [
          {'assetId': 'primary', 'durationMs': 5000, 'width': 1080, 'height': 1920},
        ],
        'clips': [
          {
            'id': 'c1',
            'assetId': 'primary',
            'sourceStartMs': 0,
            'sourceEndMs': 5000,
            'timelineStartMs': 0,
            'timelineEndMs': 5000,
            'speed': 1.0,
            'volumeDb': 0.0,
          },
        ],
        'overlays': [],
        'captions': [],
        'zooms': [],
        'audio': {
          'originalTrack': {'volumeDb': 0.0},
          'music': [],
          'speechRangesMs': [],
          'sfx': [
            {
              'id': 'sfx_woosh',
              'timelineStartMs': 1200,
              'durationMs': 450,
              'source': {'kind': 'url', 'url': 'https://cdn.example.com/sfx.mp3'},
              'volumeDb': -6.0,
              'credit': 'Creative Commons',
            },
          ],
        },
        'watermark': {
          'imageUrl': 'https://brand.test/logo.png',
          'position': 'top_right',
          'opacityPct': 85.0,
          'widthFraction': 0.18,
          'localPath': '/cache/watermark.png',
          'x': 0.8,
          'y': 0.05,
          'width': 0.18,
          'height': 0.08,
        },
      };

      final ir = MobileEditIr.fromJson(json);
      expect(ir.watermark, isNotNull);
      expect(ir.watermark!.imageUrl, 'https://brand.test/logo.png');
      expect(ir.watermark!.position, 'top_right');
      expect(ir.watermark!.opacityPct, 85.0);
      expect(ir.watermark!.widthFraction, 0.18);
      expect(ir.watermark!.localPath, '/cache/watermark.png');
      expect(ir.watermark!.x, 0.8);
      expect(ir.watermark!.y, 0.05);

      expect(ir.audio.sfx, hasLength(1));
      expect(ir.audio.sfx.first.id, 'sfx_woosh');
      expect(ir.audio.sfx.first.timelineStartMs, 1200);
      expect(ir.audio.sfx.first.durationMs, 450);
      expect(ir.audio.sfx.first.volumeDb, -6.0);

      // Round-trip back to JSON
      final outputJson = ir.toJson();
      expect(outputJson['watermark'], isNotNull);
      final wmMap = outputJson['watermark'] as Map<String, dynamic>;
      expect(wmMap['imageUrl'], 'https://brand.test/logo.png');
      expect(wmMap['position'], 'top_right');
      expect(wmMap['opacityPct'], 85.0);
      expect(wmMap['widthFraction'], 0.18);
      expect(wmMap['localPath'], '/cache/watermark.png');

      final sfxList = (outputJson['audio'] as Map<String, dynamic>)['sfx'] as List;
      expect(sfxList, hasLength(1));
      expect(sfxList.first['id'], 'sfx_woosh');

      // Test copyWith keeps watermark
      final copied = ir.copyWith(durationMs: 6000);
      expect(copied.watermark, isNotNull);
      expect(copied.watermark!.imageUrl, 'https://brand.test/logo.png');

      // Test copyWith clearWatermark
      final cleared = ir.copyWith(clearWatermark: true);
      expect(cleared.watermark, isNull);
    });
  });

  group('EditIrCaption.displayWords (same rules as the Android CaptionOverlay)', () {
    List<String> texts(EditIrCaption c) => c.displayWords.map((w) => w.text).toList();

    test('a title draws its text word by word, ignoring the stale single-word copy', () {
      final c = EditIrCaption(
        id: 't', kind: 'text', startMs: 0, endMs: 2000, text: 'New title\nsecond line',
        words: [EditIrWord(text: 'Old title', startMs: 0, endMs: 2000)],
      );
      expect(texts(c), ['New', 'title', EditIrCaption.lineBreak, 'second', 'line']);
      expect(c.displayWords.every((w) => w.startMs == 0 && w.endMs == 2000), isTrue);
    });

    test('a speech caption keeps its timed words while the text matches', () {
      final c = EditIrCaption(id: 'c', startMs: 0, endMs: 1000, text: ' hello   world ', words: [
        EditIrWord(text: 'hello', startMs: 0, endMs: 400),
        EditIrWord(text: 'world', startMs: 400, endMs: 1000, highlight: true),
      ]);
      expect(texts(c), ['hello', 'world']);
      expect(c.displayWords[1].highlight, isTrue);
    });

    test('an edited speech caption with the same word count keeps each timing and emphasis', () {
      final c = EditIrCaption(id: 'c', startMs: 0, endMs: 1000, text: 'Hello World', words: [
        EditIrWord(text: 'hello', startMs: 0, endMs: 400),
        EditIrWord(text: 'world', startMs: 400, endMs: 1000, highlight: true),
      ]);
      final w = c.displayWords;
      expect(texts(c), ['Hello', 'World']);
      expect([w[1].startMs, w[1].endMs, w[1].highlight], [400, 1000, true]);
    });

    test('an edited speech caption with a different word count is re-timed across the caption', () {
      final c = EditIrCaption(id: 'c', startMs: 1000, endMs: 2000, text: 'aa bb cccc', words: [
        EditIrWord(text: 'x', startMs: 1000, endMs: 2000),
      ]);
      final w = c.displayWords;
      expect(texts(c), ['aa', 'bb', 'cccc']);
      expect([for (final x in w) [x.startMs, x.endMs]], [[1000, 1250], [1250, 1500], [1500, 2000]]);
    });

    test('a caption without words draws its text', () {
      final c = EditIrCaption(id: 'c', startMs: 0, endMs: 500, text: 'just text');
      expect(texts(c), ['just', 'text']);
    });

    test('canvas pixels scale to the preview width', () {
      expect(EditIrCaption.canvasPxScale(360, 1080), closeTo(1 / 3, 1e-9));
      expect(EditIrCaption.canvasPxScale(0, 1080), 1);
    });
  });
}
