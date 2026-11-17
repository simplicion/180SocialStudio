// Preview vs export parity of v2 captions, on the device (Android).
//
// Every fixture caption (3 templates × Latin / Hindi / Arabic / Japanese × 4 instants, integration_test/
// caption_v2_fixtures.dart) is drawn twice at 1080×1920 on a transparent canvas:
//   - export: the Android renderer itself (CaptionOverlay → CaptionV2Renderer, via renderCaptionFrames);
//   - preview: the Flutter painter the editor uses (CaptionV2Renderer in caption_v2_painter.dart).
// Both get the same font FILES (the OFL fonts in test/fonts, pushed to <ext>/test_assets). The two images are compared
// (see `_compare` for the metrics and tolerance) and both are saved to <ext>/evidence/caption_parity for review.
// The caption drawing time at 1080×1920 is measured on the export renderer.
//
// Run (from apps/social-studio-mobile, emulator up):
//   bash run_it.sh integration_test/caption_parity_test.dart .ready_captions <out> \
//     Inter-800.ttf:Inter-800.ttf NotoSansDevanagari-800.ttf:NotoSansDevanagari-800.ttf \
//     NotoSansArabic-800.ttf:NotoSansArabic-800.ttf NotoSansJP-800-subset.ttf:NotoSansJP-800-subset.ttf
// (copy test/fonts/*.ttf into test_assets/ first; test_assets is gitignored).

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:social_studio_mobile/core/native_engine/caption_v2.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';
import 'package:social_studio_mobile/features/studio/caption_v2_painter.dart';

import 'caption_v2_fixtures.dart';

late Directory ext;
late Directory evidence;
final fontPaths = <String, String>{};
final report = <String, dynamic>{};

/// Tolerance (see the report): IoU of the drawn-text boxes ≥ 0.90 and mean absolute difference ≤ 10 / 255 per
/// channel inside the union of the two text boxes (both composited on mid-grey).
const kMinIoU = 0.90;
const kMaxMad = 10.0;

Future<ui.Image> _decode(Uint8List png) async {
  final codec = await ui.instantiateImageCodec(png);
  return (await codec.getNextFrame()).image;
}

Future<Uint8List> _rgba(ui.Image img) async => (await img.toByteData(format: ui.ImageByteFormat.rawStraightRgba))!.buffer.asUint8List();

/// Box of the pixels with alpha ≥ 64 (null when nothing is drawn).
Rect? _box(Uint8List px, int w, int h) {
  var l = w, t = h, r = -1, b = -1;
  for (var y = 0; y < h; y++) {
    final row = y * w * 4;
    for (var x = 0; x < w; x++) {
      if (px[row + x * 4 + 3] >= 64) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return r < 0 ? null : Rect.fromLTRB(l.toDouble(), t.toDouble(), r + 1.0, b + 1.0);
}

/// IoU of the two text boxes and the mean absolute RGB difference (0..255) over their union, both images
/// composited on mid-grey (so differences in colour and in coverage both count).
Map<String, dynamic> _compare(Uint8List a, Uint8List b, int w, int h) {
  final ba = _box(a, w, h), bb = _box(b, w, h);
  if (ba == null || bb == null) return {'iou': ba == bb ? 1.0 : 0.0, 'mad': ba == bb ? 0.0 : 255.0, 'empty': ba == null && bb == null};
  final inter = ba.intersect(bb);
  final ia = inter.width > 0 && inter.height > 0 ? inter.width * inter.height : 0.0;
  final iou = ia / (ba.width * ba.height + bb.width * bb.height - ia);
  final u = ba.expandToInclude(bb);
  var sum = 0.0;
  var n = 0;
  for (var y = u.top.toInt(); y < u.bottom.toInt(); y++) {
    for (var x = u.left.toInt(); x < u.right.toInt(); x++) {
      final i = (y * w + x) * 4;
      final aa = a[i + 3] / 255, ab = b[i + 3] / 255;
      for (var c = 0; c < 3; c++) {
        final va = a[i + c] * aa + 128 * (1 - aa);
        final vb = b[i + c] * ab + 128 * (1 - ab);
        sum += (va - vb).abs();
      }
      n += 3;
    }
  }
  return {'iou': iou, 'mad': sum / n, 'boxExport': [ba.left, ba.top, ba.right, ba.bottom], 'boxPreview': [bb.left, bb.top, bb.right, bb.bottom]};
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    ext = (await getExternalStorageDirectory())!;
    Directory('${ext.path}/test_assets').createSync(recursive: true);
    for (var i = 0; i < 300 && !File('${ext.path}/test_assets/.ready_captions').existsSync(); i++) {
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    for (final e in kCaptionTestFonts.entries) {
      final path = '${ext.path}/test_assets/${e.value}';
      expect(File(path).existsSync(), isTrue, reason: 'font fixture $path was not pushed');
      fontPaths['${e.key}:800'] = path;
      fontPaths[e.key] = path;
      await (FontLoader(e.key)..addFont(Future.value(ByteData.sublistView(File(path).readAsBytesSync())))).load();
    }
    evidence = Directory('${ext.path}/evidence/caption_parity');
    if (evidence.existsSync()) evidence.deleteSync(recursive: true);
    evidence.createSync(recursive: true);
  });

  tearDownAll(() async {
    File('${evidence.path}/report.json').writeAsStringSync(const JsonEncoder.withIndent('  ').convert(report));
    // Let the host mirror the evidence before the app is uninstalled (run_it.sh answers .done with .pulled).
    File('${evidence.path}/.done').writeAsStringSync('1');
    for (var i = 0; i < 60 && !File('${evidence.path}/.pulled').existsSync(); i++) {
      await Future<void>.delayed(const Duration(seconds: 1));
    }
  });

  testWidgets('preview painter and export renderer draw the same caption frames', (tester) async {
    final frames = <String, dynamic>{};
    var worstIou = 1.0, worstMad = 0.0;
    final failures = <String>[];
    for (final spec in kCaptionTestSpecs.keys) {
      for (final script in kCaptionTestScripts.keys) {
        final cap = captionFixture(spec, script);
        final irJson = jsonEncode(captionIrJson([cap]));
        final times = kCaptionTestTimes.values.toList();
        final native = await MediaEngineService.renderCaptionFrames(
          editIrJson: irJson,
          timesMs: times,
          outputDir: evidence.path,
          fontPaths: fontPaths,
          prefix: 'export_${spec}_$script',
        );
        expect(native['icu'], isTrue, reason: 'android.icu installed');
        expect(native['glyphsMissing'], isEmpty);
        expect(native['glyphsFromSystem'], isEmpty, reason: 'every glyph comes from the template font');
        final paths = (native['paths'] as List).cast<String>();
        // The preview: the same IR caption (parsed back, as the editor holds it).
        final parsed = MobileEditIr.fromJson(jsonDecode(irJson) as Map<String, dynamic>).captions.single;
        final renderer = CaptionV2Renderer(fontFor: registeredCaptionFont, canvasWidth: 1080);
        for (var i = 0; i < times.length; i++) {
          final rec = ui.PictureRecorder();
          renderer.draw(Canvas(rec), const Size(1080, 1920), parsed, parsed.styleV2!, times[i].toDouble());
          final img = await rec.endRecording().toImage(1080, 1920);
          final png = (await img.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
          File('${evidence.path}/preview_${spec}_${script}_${times[i]}.png').writeAsBytesSync(png);
          final exportImg = await _decode(File(paths[i]).readAsBytesSync());
          final m = _compare(await _rgba(exportImg), await _rgba(img), 1080, 1920);
          final key = '$spec/$script/${kCaptionTestTimes.keys.elementAt(i)}';
          frames[key] = m;
          final iou = (m['iou'] as num).toDouble(), mad = (m['mad'] as num).toDouble();
          worstIou = math.min(worstIou, iou);
          worstMad = math.max(worstMad, mad);
          if (iou < kMinIoU || mad > kMaxMad) failures.add('$key iou=${iou.toStringAsFixed(3)} mad=${mad.toStringAsFixed(2)}');
        }
      }
    }
    report['parity'] = {'tolerance': {'minIoU': kMinIoU, 'maxMad': kMaxMad}, 'worstIoU': worstIou, 'worstMad': worstMad, 'frames': frames, 'failures': failures};
    // ignore: avoid_print
    print('REPORT parity frames=${frames.length} worstIoU=${worstIou.toStringAsFixed(3)} worstMad=${worstMad.toStringAsFixed(2)} failures=$failures');
    expect(failures, isEmpty);
  });

  testWidgets('word tokens (and so word timing) are the same in preview and export, incl. Thai and Japanese', (tester) async {
    final titles = {
      'thai': 'สวัสดีครับวันนี้อากาศดีมาก',
      'ja': '今日から物語を始めよう',
      'zh': '我们今天去北京',
      'mixed': 'मैं iPhone 16 लूँगा',
    };
    final caps = [
      for (final e in titles.entries) EditIrCaption(id: e.key, kind: 'text', startMs: 0, endMs: 2000, text: e.value, style: {'styleV2': kCaptionTestSpecs['glass']}),
    ];
    final native = await MediaEngineService.renderCaptionFrames(editIrJson: jsonEncode(captionIrJson(caps)), timesMs: const [], outputDir: evidence.path);
    final nativeTokens = (native['tokens'] as Map).cast<String, dynamic>();
    final out = <String, dynamic>{};
    for (final c in caps) {
      final preview = c.displayWords.map((w) => w.text).toList();
      out[c.id] = {'export': nativeTokens[c.id], 'preview': preview};
      expect(preview, nativeTokens[c.id], reason: c.id);
    }
    report['tokens'] = out;
    expect((nativeTokens['thai'] as List).length, greaterThan(2), reason: 'Thai split by the ICU dictionary');
    expect(CaptionTextEngine.join((nativeTokens['thai'] as List).cast<String>()), titles['thai']);
  });

  testWidgets('a character no font has is reported as CAPTION_GLYPHS_MISSING, not drawn as tofu', (tester) async {
    final cap = EditIrCaption(id: 'tofu', kind: 'text', startMs: 0, endMs: 2000, text: 'Hello \u{E000}\u{10FFFD}', style: {'styleV2': kCaptionTestSpecs['impact']});
    final r = await MediaEngineService.renderCaptionFrames(editIrJson: jsonEncode(captionIrJson([cap])), timesMs: const [], outputDir: evidence.path, fontPaths: fontPaths);
    report['glyphCheck'] = r['glyphsMissing'];
    expect((r['glyphsMissing'] as List), isNotEmpty);
    final miss = ((r['glyphsMissing'] as List).first as Map).cast<String, dynamic>();
    expect((miss['chars'] as List).cast<int>(), containsAll([0xE000, 0x10FFFD]));
  });

  testWidgets('caption drawing time at 1080x1920 (export renderer)', (tester) async {
    final out = <String, dynamic>{};
    for (final spec in kCaptionTestSpecs.keys) {
      final r = await MediaEngineService.renderCaptionFrames(
        editIrJson: jsonEncode(captionIrJson([captionFixture(spec, 'latin')])),
        timesMs: const [],
        outputDir: evidence.path,
        fontPaths: fontPaths,
        perfFrames: 240,
      );
      out[spec] = {'firstFrameMs': r['firstFrameMs'], 'msPerFrame': r['msPerFrame']};
    }
    report['timing'] = out;
    // ignore: avoid_print
    print('REPORT timing $out');
    // The < 2 ms target is for a mid-range phone; on the emulator this is indicative only, so only a loose bound.
    for (final v in out.values) {
      expect(((v as Map)['msPerFrame'] as num).toDouble(), lessThan(16.0));
    }
  });
}
