import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/caption_catalog.dart';
import 'package:social_studio_mobile/features/studio/caption_template_apply.dart';
import 'package:social_studio_mobile/features/studio/safe_zone_guide.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// A CaptionStyleV2 JSON spec like caption-style-v2.ts produces (Anton 52, size range 31..83, one stroke).
Map<String, dynamic> spec({List<String>? editable}) => {
  'version': 2,
  'typography': {
    'fonts': {'latin': 'Anton'},
    'weight': 400,
    'sizePx': 52,
    'sizeRangePx': {'min': 31, 'max': 83},
    'case': 'upper',
  },
  'paint': {
    'fill': {'type': 'solid', 'color': '#FACC15'},
    'strokes': [
      {'color': '#000000', 'widthPx': 8, 'join': 'round'},
    ],
    'background': {'mode': 'none', 'color': '#000000'},
  },
  'words': {
    'active': {'color': '#22C55E', 'scale': 1.15},
  },
  'motion': {
    'activeWord': {'type': 'scale-spring', 'durationMs': 160},
    'intensity': 1,
  },
  'layout': {'position': 'lower-third', 'safeZone': 'tiktok'},
  'grouping': {'maxWords': 3},
  'emphasis': {
    'colors': {'emphasis': '#F7C204'},
  },
  'editable': editable ?? captionEditableFields,
};

void main() {
  group('applyToSpec mirrors applyCaptionOverrides (caption-style-v2.test.ts)', () {
    test('editable fields apply, size is clamped to the template range, the signature stays', () {
      final s = spec();
      final r = CaptionTemplateApply.applyToSpec(
        s,
        const CaptionOverrides(
          colors: {'text': '#FFFFFF', 'active': '#00FF88'},
          sizePx: 200,
          position: 'upper-third',
          textCase: 'none',
          motionIntensity: 0.4,
        ),
      );
      expect(r.rejected, isEmpty);
      expect(r.spec['paint']['fill'], {'type': 'solid', 'color': '#FFFFFF'});
      expect(r.spec['words']['active']['color'], '#00FF88');
      expect(r.spec['typography']['sizePx'], 83);
      expect([r.spec['layout']['position'], r.spec['typography']['case'], r.spec['motion']['intensity']], [
        'upper-third',
        'none',
        0.4,
      ]);
      expect(r.spec['typography']['fonts'], s['typography']['fonts']);
      expect(r.spec['paint']['strokes'], s['paint']['strokes']);
      expect(r.spec['motion']['activeWord']['type'], 'scale-spring');
      // The input is not changed.
      expect(s['typography']['sizePx'], 52);
    });

    test('locked fields are refused', () {
      final s = spec(editable: ['colors']);
      final r = CaptionTemplateApply.applyToSpec(
        s,
        const CaptionOverrides(colors: {'text': '#000000'}, sizePx: 40, maxWords: 1),
      );
      expect(r.rejected..sort(), ['maxWords', 'sizePx']);
      expect(r.spec['typography']['sizePx'], 52);
      expect(r.spec['grouping']['maxWords'], 3);
      expect(r.spec['paint']['fill']['color'], '#000000');
    });

    test('"make the captions yellow" changes only the colour', () {
      final s = spec();
      final r = CaptionTemplateApply.applyToSpec(s, const CaptionOverrides(colors: {'text': '#FACC15'}));
      final a = {...r.spec, 'paint': {...r.spec['paint'], 'fill': null}};
      final b = {...s, 'paint': {...s['paint'], 'fill': null}};
      expect(a, b);
    });

    test('a gradient fill keeps its gradient (top colour changes); stroke and emphasis colours', () {
      final s = spec()..['paint'] = {
        'fill': {'type': 'gradient', 'top': '#FFFFFF', 'bottom': '#888888'},
        'strokes': [
          {'color': '#000000', 'widthPx': 8},
          {'color': '#111111', 'widthPx': 14},
        ],
      };
      final r = CaptionTemplateApply.applyToSpec(
        s,
        const CaptionOverrides(colors: {'text': '#FF0000', 'stroke': '#0000FF', 'emphasis': '#00FF00'}),
      );
      expect(r.spec['paint']['fill'], {'type': 'gradient', 'top': '#FF0000', 'bottom': '#888888'});
      expect(r.spec['paint']['strokes'][0]['color'], '#0000FF');
      expect(r.spec['paint']['strokes'][1]['color'], '#111111');
      expect(r.spec['emphasis']['colors']['emphasis'], '#00FF00');
    });

    test('custom position writes x / y', () {
      final r = CaptionTemplateApply.applyToSpec(spec(), const CaptionOverrides(position: 'custom', x: 0.4, y: 0.2));
      expect(r.spec['layout'], containsPair('x', 0.4));
      expect(r.spec['layout'], containsPair('y', 0.2));
    });
  });

  test('overrides round-trip through JSON and merge per colour role', () {
    const a = CaptionOverrides(colors: {'text': '#FFFFFF'}, sizePx: 60, position: 'custom', x: 0.3, y: 0.4);
    final back = CaptionOverrides.fromJson(a.toJson());
    expect(back.toJson(), a.toJson());
    final m = a.merge(const CaptionOverrides(colors: {'active': '#000000'}, position: 'center'));
    expect(m.colors, {'text': '#FFFFFF', 'active': '#000000'});
    expect([m.sizePx, m.position, m.x], [60, 'center', null]);
  });

  test('safe zone clamp matches anchorInSafeZone (tiktok: top 220 / bottom 480 of 1920)', () {
    final p = SafeZonePlatform.tiktok.clampCentre(0.5, 0.99, blockH: 0.1);
    expect(p.dy, closeTo((1920 - 480) / 1920 - 0.05, 1e-9));
    final top = SafeZonePlatform.tiktok.clampCentre(0.0, 0.0);
    expect(top.dx, closeTo(60 / 1080, 1e-9));
    expect(top.dy, closeTo(220 / 1920, 1e-9));
    // A block wider than the safe area is centred in it.
    final wide = SafeZonePlatform.reels.clampCentre(0.1, 0.5, blockW: 2);
    expect(wide.dx, closeTo((65 / 1080 + 1 - 120 / 1080) / 2, 1e-9));
    expect(SafeZonePlatform.none.clampCentre(0.01, 0.99), const Offset(0.01, 0.99));
  });

  test('regroup keeps every word and its timing, breaks at maxWords and on sentence ends', () {
    var ir = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920);
    final words = [
      for (final (i, t) in ['one', 'two', 'three', 'four.', 'five', 'six'].indexed)
        EditIrWord(text: t, startMs: i * 300, endMs: i * 300 + 250),
    ];
    ir = ir.copyWith(
      captions: [
        EditIrCaption(id: 'a', startMs: 0, endMs: 850, text: 'one two three', words: words.sublist(0, 3)),
        EditIrCaption(id: 'b', startMs: 900, endMs: 1750, text: 'four. five six', words: words.sublist(3)),
      ],
    );
    final out = CaptionTemplateApply.regroup(ir, 2);
    expect(out.captions.map((c) => c.text).toList(), ['one two', 'three four.', 'five six']);
    expect([for (final c in out.captions) ...c.words.map((w) => (w.text, w.startMs, w.endMs))], [
      for (final w in words) (w.text, w.startMs, w.endMs),
    ]);
  });
}
