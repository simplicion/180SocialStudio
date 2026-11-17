import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/caption_v2.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/caption_fonts.dart';

/// Reads one name record (platform 3, any language) of a TTF/OTF.
String? _nameRecord(Uint8List bytes, int nameId) {
  final b = ByteData.sublistView(bytes);
  final numTables = b.getUint16(4);
  for (var i = 0; i < numTables; i++) {
    final rec = 12 + i * 16;
    if (String.fromCharCodes(bytes.sublist(rec, rec + 4)) != 'name') continue;
    final off = b.getUint32(rec + 8);
    final count = b.getUint16(off + 2);
    final strings = off + b.getUint16(off + 4);
    for (var r = 0; r < count; r++) {
      final p = off + 6 + r * 12;
      if (b.getUint16(p) != 3 || b.getUint16(p + 6) != nameId) continue;
      final len = b.getUint16(p + 8), so = strings + b.getUint16(p + 10);
      return String.fromCharCodes([for (var k = 0; k < len; k += 2) b.getUint16(so + k)]);
    }
  }
  return null;
}

void main() {
  test('every font a caption can be drawn with is OFL or Apache licensed', () {
    final families = {...kDefaultScriptFonts.values, ...CaptionFonts.exportFamilies};
    for (final f in families) {
      expect(CaptionFonts.licenceOf(f), anyOf('OFL-1.1', 'Apache-2.0'), reason: f);
    }
    // Unknown / proprietary families are refused (drawn with Inter, with a warning).
    expect(CaptionFonts.licenceOf('Komika Axis'), isNull);
    expect(CaptionFonts.licenceOf('Proxima Nova'), isNull);
  });

  test('the bundled and test font files carry the SIL OFL licence', () {
    final files = [
      'android/app/src/main/assets/fonts/Inter-400.ttf',
      'android/app/src/main/assets/fonts/Inter-600.ttf',
      'android/app/src/main/assets/fonts/Inter-800.ttf',
      for (final f in Directory('test/fonts').listSync().whereType<File>().where((f) => f.path.endsWith('.ttf'))) f.path,
    ];
    expect(files.length, greaterThanOrEqualTo(7));
    for (final path in files) {
      final url = _nameRecord(File(path).readAsBytesSync(), 14) ?? '';
      expect(url.contains('openfontlicense.org') || url.contains('scripts.sil.org/OFL'), isTrue, reason: '$path licence URL "$url"');
    }
    expect(File('test/fonts/OFL.txt').readAsStringSync(), contains('SIL OPEN FONT LICENSE'));
  });

  test('export fetches a font for every script present, not only the Latin family', () {
    EditIrCaption cap(String id, String text, Map<String, dynamic> style, {String? lang}) =>
        EditIrCaption(id: id, kind: 'text', startMs: 0, endMs: 1000, text: text, style: style, language: lang);
    final v2 = {
      'version': 2,
      'typography': {
        'fonts': {'latin': 'Anton', 'arabic': 'Cairo'},
        'weight': 800,
        'sizePx': 72,
      },
      'paint': {
        'fill': {'type': 'solid', 'color': '#FFFFFF'},
      },
    };
    final ir = MobileEditIr(
      projectId: 'p',
      canvas: EditIrCanvas(width: 1080, height: 1920, fps: 30, aspect: '9:16'),
      durationMs: 1000,
      clips: const [],
      captions: [
        cap('a', 'मैं iPhone लूँगा', {'styleV2': v2}),
        cap('b', 'ابدأ اليوم', {'styleV2': v2}),
        cap('c', '今日から始めよう', {'styleV2': v2}, lang: 'ja'),
        cap('d', 'नमस्ते', {'fontFamily': 'Anton', 'fontWeight': 800}),
      ],
    );
    final f = CaptionFonts.familiesFor(ir);
    expect(f, containsAll(<(String, int)>[('Noto Sans Devanagari', 800), ('Anton', 800), ('Cairo', 800), ('Noto Sans JP', 800)]));
    expect(f.contains(('Noto Sans SC', 800)), isFalse, reason: 'Han in a Japanese caption uses the Japanese font');
  });
}
