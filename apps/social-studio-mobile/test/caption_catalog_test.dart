import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/studio/caption_catalog.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// Captions v2: the phone's catalog is generated from packages/video-contracts/src/caption-templates.ts.
void main() {
  test('the generated catalog: 18 templates with full v2 specs, metadata and flat styles', () {
    final ts = CaptionCatalog.templates;
    expect(ts.length, 18);
    expect(ts.map((t) => t.id).toSet().length, 18);
    for (final t in ts) {
      expect(t.styleV2['version'], 2, reason: t.id);
      expect((t.styleV2['typography'] as Map)['fonts'], isA<Map<String, dynamic>>());
      expect(t.legacyStyle['fontFamily'], ((t.styleV2['typography'] as Map)['fonts'] as Map)['latin'], reason: t.id);
      expect(t.bestFor, isNotEmpty);
      expect(t.energy, inInclusiveRange(1, 5));
      expect(t.canEdit('colors') && t.canEdit('sizePx') && t.canEdit('position'), isTrue, reason: t.id);
      final size = ((t.styleV2['typography'] as Map)['sizePx'] as num).toDouble();
      expect(t.sizeRangePx.min <= size && size <= t.sizeRangePx.max, isTrue, reason: t.id);
    }
    expect(CaptionCatalog.byId('CINEMA_SUBTITLE')!.canEdit('maxWords'), isFalse);
  });

  test('old template ids still open: canonicalId / byId map them to the new template', () {
    expect(CaptionCatalog.canonicalId('MRBEAST_HYPE'), 'IMPACT_BOLD');
    expect(CaptionCatalog.canonicalId('HORMOZI_BOUNCE'), 'SPOTLIGHT_WORD');
    expect(CaptionCatalog.canonicalId('CINEMATIC_SUBTITLE'), 'CINEMA_SUBTITLE');
    expect(CaptionCatalog.byId('VARUN_MAYYA_BOX')!.id, 'WORD_BOX_SLIDE');
    expect(CaptionCatalog.canonicalId('CLEAN'), 'CLEAN');
    expect(CaptionCatalog.byId('nope'), isNull);
    // TimelineOps presets are the same data.
    for (final t in CaptionCatalog.templates) {
      expect(TimelineOps.captionPresets[t.id], t.name);
      expect(TimelineOps.captionStyle(t.id)['fontFamily'], t.legacyStyle['fontFamily']);
    }
  });

  test('no creator or brand name in any app string (the generated catalog\'s legacy-id list is the only exception)', () {
    final forbidden = RegExp(r'vox|beast|hormozi|abdaal|shamani|mayya|gadzhi|dan koe|netflix', caseSensitive: false);
    final single = RegExp(r"'(?:[^'\\]|\\.)*'");
    final dquoted = RegExp(r'"(?:[^"\\]|\\.)*"');
    final hits = <String>[];
    for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
      final generated = f.path.replaceAll('\\', '/').endsWith('features/studio/caption_catalog.g.dart');
      final lines = f.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (line.trimLeft().startsWith('//')) continue;
        for (final m in [...single.allMatches(line), ...dquoted.allMatches(line)]) {
          if (!forbidden.hasMatch(m.group(0)!)) continue;
          // The generated file may name old ids only inside its legacy lists (legacyIds / the legacy id map).
          if (generated && (line.contains('legacyIds:') || RegExp(r"^\s*'[A-Z_]+': '[A-Z_]+',$").hasMatch(line))) continue;
          hits.add('${f.path}:${i + 1}: ${m.group(0)}');
        }
      }
    }
    expect(hits, isEmpty);
  });
}
