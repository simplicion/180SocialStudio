// On-device verification of the native media engine (Android Media3 renderer).
//
// Fixtures are real files pushed by the host before the run (see test_assets/, gitignored):
//   adb push test_assets/speech_obama_30s.mp4 <ext>/test_assets/speech.mp4   (public-domain speech, 1280x720)
//   adb push test_assets/sample-15s.mp4        <ext>/test_assets/broll.mp4    (samplelib, 1920x1080)
//   adb push test_assets/sample-15s.mp3        <ext>/test_assets/music.mp3    (samplelib)
// where <ext> = /sdcard/Android/data/com.workspace180.social_studio_mobile/files
//
// Evidence (rendered MP4s, frame JPEGs, report.json) is written to <ext>/evidence for `adb pull`.
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:social_studio_mobile/core/native_engine/color_grade.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';

late Directory ext;
late String speech, broll, music;
late Directory evidence;
final report = <String, dynamic>{};

const canvas = {'aspect': '9:16', 'width': 1080, 'height': 1920, 'fps': 30, 'background': '#000000'};

Map<String, dynamic> captionStyle({String animation = 'word_pop', double y = 0.72}) => {
      'preset': 'HORMOZI_BOUNCE',
      'animation': animation,
      'fontFamily': 'Inter',
      'fontWeight': 800,
      'fontSizePx': 84,
      'textColor': '#FFFFFF',
      'highlightColor': '#FFE600',
      'strokeColor': '#000000',
      'strokeWidthPx': 6,
      'shadow': true,
      'background': null,
      'uppercase': true,
      'positionX': 0.5,
      'positionY': y,
      'maxWidthFraction': 0.86,
    };

/// Evenly spreads word timings across [start, end) of the timeline.
List<Map<String, dynamic>> words(String text, int start, int end, {int? highlightIndex}) {
  final parts = text.split(' ');
  final step = (end - start) ~/ parts.length;
  return [
    for (var i = 0; i < parts.length; i++)
      {
        'text': parts[i],
        'startMs': start + i * step,
        'endMs': i == parts.length - 1 ? end : start + (i + 1) * step,
        'highlight': i == highlightIndex,
        'color': i == highlightIndex ? '#00FF88' : null,
        'scale': 1.25,
      },
  ];
}

/// Real-looking AI Director output: 3 cuts (one at 1.25x), 9:16 reframe crop, B-roll cutaway,
/// kinetic word captions, a zoom punch-in, a crossfade, and ducked background music.
Map<String, dynamic> directorIr() {
  // Source is 1280x720 → a centred 9:16 window is 405/1280 of the width.
  const cropW = 405 / 1280;
  const crop = {'x': (1 - cropW) / 2, 'y': 0.0, 'width': cropW, 'height': 1.0};
  return {
    'schemaVersion': 'mobile-editir/1',
    'projectId': 'emulator-verification',
    'canvas': canvas,
    'durationMs': 11150,
    'sources': [
      {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
    ],
    'clips': [
      {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 600, 'sourceEndMs': 4080, 'timelineStartMs': 0, 'timelineEndMs': 3480,
        'speed': 1.0, 'volumeDb': 0, 'crop': crop, 'filter': null, 'transitionIn': null},
      {'id': 'c2', 'assetId': 'primary', 'sourceStartMs': 8020, 'sourceEndMs': 12490, 'timelineStartMs': 3480, 'timelineEndMs': 7950,
        'speed': 1.0, 'volumeDb': 0, 'crop': crop, 'filter': null, 'transitionIn': {'type': 'CROSSFADE', 'durationMs': 300}},
      {'id': 'c3', 'assetId': 'primary', 'sourceStartMs': 15010, 'sourceEndMs': 19010, 'timelineStartMs': 7950, 'timelineEndMs': 11150,
        'speed': 1.25, 'volumeDb': 0, 'crop': crop, 'filter': {'preset': 'VIVID', 'brightness': 1.05, 'contrast': 1.0, 'saturation': 1.0},
        'transitionIn': null},
    ],
    'overlays': [
      {'id': 'b1', 'kind': 'broll', 'timelineStartMs': 5000, 'timelineEndMs': 6500, 'sourceStartMs': 2000,
        'source': {'kind': 'url', 'url': 'https://download.samplelib.com/mp4/sample-15s.mp4'}, 'fit': 'cover', 'opacity': 1, 'muted': true},
    ],
    'captions': [
      {'id': 't1', 'kind': 'caption', 'startMs': 0, 'endMs': 1700, 'text': 'thank you so much',
        'words': words('thank you so much', 0, 1700, highlightIndex: 2), 'style': captionStyle()},
      {'id': 't2', 'kind': 'caption', 'startMs': 1700, 'endMs': 3480, 'text': 'for being here today',
        'words': words('for being here today', 1700, 3480), 'style': captionStyle()},
      {'id': 't3', 'kind': 'caption', 'startMs': 3480, 'endMs': 7950, 'text': 'education is the key to your future',
        'words': words('education is the key to your future', 3480, 7950), 'style': captionStyle(animation: 'karaoke')},
      {'id': 't4', 'kind': 'caption', 'startMs': 7950, 'endMs': 11150, 'text': 'my education my future',
        'words': words('my education my future', 7950, 11150), 'style': captionStyle()},
    ],
    'zooms': [
      {'id': 'z1', 'startMs': 8500, 'endMs': 10500, 'scale': 1.3, 'centerX': 0.5, 'centerY': 0.4, 'rampMs': 300},
    ],
    'audio': {
      'originalTrack': {'volumeDb': 0},
      'music': [
        // Starts 10 s into a 15 s track, so the renderer must loop it to cover 11.15 s.
        {'id': 'm1', 'timelineStartMs': 0, 'timelineEndMs': 11150, 'sourceStartMs': 10000,
          'source': {'kind': 'stock_query', 'query': 'upbeat', 'url': null},
          'volumeDb': -14, 'fadeInMs': 500, 'fadeOutMs': 1000, 'duck': {'enabled': true, 'duckDb': -12, 'attackMs': 120, 'releaseMs': 350}},
      ],
      'speechRangesMs': [
        [200, 3300],
        [3700, 7900],
        [8200, 10900],
      ],
    },
  };
}

/// Music-only timeline (speech muted) to measure the ducking envelope in the output.
Map<String, dynamic> duckIr() => {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'duck-verification',
      'canvas': canvas,
      'durationMs': 8000,
      'clips': [
        {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 8000, 'timelineStartMs': 0, 'timelineEndMs': 8000,
          'speed': 1.0, 'volumeDb': -60, 'crop': null, 'filter': null, 'transitionIn': null},
      ],
      'audio': {
        'originalTrack': {'volumeDb': 0},
        'music': [
          {'id': 'm1', 'timelineStartMs': 0, 'timelineEndMs': 8000, 'sourceStartMs': 0, 'source': {'kind': 'stock_query', 'query': 'x'},
            'volumeDb': 0, 'fadeInMs': 0, 'fadeOutMs': 0, 'duck': {'enabled': true, 'duckDb': -12, 'attackMs': 120, 'releaseMs': 350}},
        ],
        'speechRangesMs': [
          [3000, 5500],
        ],
      },
    };

Future<RenderResult> render(Map<String, dynamic> ir, String out, {Map<String, String> overlays = const {}, List<double>? progressOut}) async {
  RenderResult? result;
  await for (final p in MediaEngineService.renderEditIr(
    editIr: MobileEditIr.fromJson(ir),
    outputPath: out,
    assetPaths: {'primary': speech},
    overlayPaths: overlays,
    musicPaths: {'m1': music},
  )) {
    progressOut?.add(p.progress);
    if (p.result != null) result = p.result;
  }
  return result!;
}

/// RMS in dBFS of a 16-bit mono WAV between [fromMs, toMs).
double rmsDb(Uint8List wav, int fromMs, int toMs) {
  final data = ByteData.sublistView(wav, 44);
  final a = fromMs * 16;
  final b = math.min(toMs * 16, data.lengthInBytes ~/ 2);
  var sum = 0.0;
  for (var i = a; i < b; i++) {
    final s = data.getInt16(i * 2, Endian.little) / 32768.0;
    sum += s * s;
  }
  return 20 * math.log(math.sqrt(sum / (b - a)) + 1e-12) / math.ln10;
}

/// Mean RGB (0..255) of a region (fractions l, t, r, b) of a JPEG frame; with [affine] each pixel is first graded the
/// way the preview does (color_grade.dart), clamped like the GPU.
Future<List<double>> regionMean(String jpg, List<double> region, {List<double>? affine}) async {
  final codec = await ui.instantiateImageCodec(File(jpg).readAsBytesSync());
  final img = (await codec.getNextFrame()).image;
  final bytes = (await img.toByteData(format: ui.ImageByteFormat.rawRgba))!;
  final w = img.width, h = img.height;
  final sum = [0.0, 0.0, 0.0];
  var n = 0;
  for (var y = (region[1] * h).floor(); y < (region[3] * h).floor(); y++) {
    for (var x = (region[0] * w).floor(); x < (region[2] * w).floor(); x++) {
      final i = (y * w + x) * 4;
      final c = [bytes.getUint8(i) / 255, bytes.getUint8(i + 1) / 255, bytes.getUint8(i + 2) / 255];
      for (var k = 0; k < 3; k++) {
        final v = affine == null ? c[k] : affine[k * 4] * c[0] + affine[k * 4 + 1] * c[1] + affine[k * 4 + 2] * c[2] + affine[k * 4 + 3];
        sum[k] += v.clamp(0.0, 1.0) * 255;
      }
      n++;
    }
  }
  return [for (final v in sum) v / n];
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    ext = (await getExternalStorageDirectory())!;
    speech = '${ext.path}/test_assets/speech.mp4';
    broll = '${ext.path}/test_assets/broll.mp4';
    music = '${ext.path}/test_assets/music.mp3';
    // `flutter test` reinstalls the app (wiping this directory), so the host pushes fixtures
    // right after install; wait for them rather than failing immediately.
    // `.waiting` tells the host runner (tool/run_render_tests.sh) that this install is up and ready to receive them.
    Directory('${ext.path}/test_assets').createSync(recursive: true);
    File('${ext.path}/test_assets/.waiting').writeAsStringSync('1');
    final deadline = DateTime.now().add(const Duration(minutes: 3));
    bool ready() => [speech, broll, music].every((f) => File(f).existsSync()) && File('${ext.path}/test_assets/.ready').existsSync();
    while (!ready() && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    for (final f in [speech, broll, music]) {
      expect(File(f).existsSync(), isTrue, reason: 'fixture missing: $f (push it with adb)');
    }
    evidence = Directory('${ext.path}/evidence');
    if (evidence.existsSync()) evidence.deleteSync(recursive: true);
    evidence.createSync(recursive: true);
  });

  tearDownAll(() {
    File('${evidence.path}/report.json').writeAsStringSync(const JsonEncoder.withIndent('  ').convert(report));
    // ignore: avoid_print
    print('MEDIA_ENGINE_REPORT ${jsonEncode(report)}');
  });

  testWidgets('getVideoInfo reads the real source', (tester) async {
    final info = await MediaEngineService.getVideoInfo(speech);
    report['sourceInfo'] = {'durationMs': info.durationMs, 'w': info.displayWidth, 'h': info.displayHeight, 'hasAudio': info.hasAudio, 'fps': info.frameRate};
    expect(info.displayWidth, 1280);
    expect(info.displayHeight, 720);
    expect(info.hasAudio, isTrue);
    expect(info.durationMs, closeTo(30090, 200));
  });

  testWidgets('extractAudio produces 16 kHz mono WAV and M4A for STT', (tester) async {
    final wav = await MediaEngineService.extractAudio(sourcePath: speech, destPath: '${evidence.path}/speech_16k.wav');
    final bytes = File(wav.path).readAsBytesSync();
    final header = ByteData.sublistView(bytes, 0, 44);
    report['extractWav'] = {'durationMs': wav.durationMs, 'bytes': wav.fileSizeBytes, 'rate': header.getUint32(24, Endian.little), 'channels': header.getUint16(22, Endian.little), 'speechRmsDb': rmsDb(bytes, 1000, 4000)};
    expect(String.fromCharCodes(bytes.sublist(0, 4)), 'RIFF');
    expect(header.getUint32(24, Endian.little), 16000);
    expect(header.getUint16(22, Endian.little), 1);
    expect(wav.durationMs, closeTo(30090, 150));
    expect(rmsDb(bytes, 1000, 4000), greaterThan(-40), reason: 'speech must be audible, not silence');

    final m4a = await MediaEngineService.extractAudio(sourcePath: speech, destPath: '${evidence.path}/speech_16k.m4a');
    final m4aInfo = await MediaEngineService.getVideoInfo(m4a.path);
    report['extractM4a'] = {'durationMs': m4a.durationMs, 'bytes': m4a.fileSizeBytes, 'rate': m4a.sampleRate, 'channels': m4a.channels, 'hasVideo': m4aInfo.hasVideo};
    expect(m4a.sampleRate, 16000);
    expect(m4a.channels, 1);
    expect(m4aInfo.hasVideo, isFalse);
    expect(m4a.durationMs, closeTo(30090, 200));
  });

  testWidgets('renderEditIr: cuts + speed + 9:16 crop + B-roll + kinetic captions + zoom + ducked music', (tester) async {
    final out = '${evidence.path}/director_render.mp4';
    final progress = <double>[];
    final sw = Stopwatch()..start();
    final r = await render(directorIr(), out, overlays: {'b1': broll}, progressOut: progress);
    sw.stop();
    final verify = await MediaEngineService.getVideoInfo(out);
    report['directorRender'] = {
      'expectedDurationMs': r.expectedDurationMs,
      'durationMs': r.durationMs,
      'width': r.width,
      'height': r.height,
      'hasAudio': r.hasAudio,
      'bytes': r.fileSizeBytes,
      'videoEncoder': r.videoEncoder,
      'audioEncoder': r.audioEncoder,
      'warnings': r.warnings,
      'progressEvents': progress.length,
      'renderWallMs': sw.elapsedMilliseconds,
      'verifyDurationMs': verify.durationMs,
    };
    expect(progress, isNotEmpty);
    expect(r.durationMs, closeTo(11150, 150));
    expect(verify.displayWidth, 1080);
    expect(verify.displayHeight, 1920);
    expect(verify.hasAudio, isTrue);
    expect(verify.hasVideo, isTrue);

    final frames = await MediaEngineService.generateThumbnails(
      sourcePath: out,
      outputDir: '${evidence.path}/frames',
      timesMs: [400, 1250, 2600, 5700, 6800, 9600, 10900],
      maxWidth: 540,
      exact: true,
    );
    report['frames'] = frames;
    expect(frames, hasLength(7));

    final audio = await MediaEngineService.extractAudio(sourcePath: out, destPath: '${evidence.path}/director_render_16k.wav');
    report['directorRender']['audioDurationMs'] = audio.durationMs;
  });

  testWidgets('text motion (in / out / loop / typewriter) renders on device', (tester) async {
    final out = '${evidence.path}/text_motion_render.mp4';
    Map<String, dynamic> titled(String id, int s, int e, String text, Map<String, dynamic> motion) =>
        {'id': id, 'kind': 'text', 'startMs': s, 'endMs': e, 'text': text, 'words': [], 'style': {...captionStyle(animation: 'none', y: 0.3), ...motion}};
    final ir = {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'text-motion-verification',
      'canvas': canvas,
      'durationMs': 4000,
      'sources': [
        {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
      ],
      'clips': [
        {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 4000, 'timelineStartMs': 0, 'timelineEndMs': 4000,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
      ],
      'captions': [
        titled('m1', 0, 2000, 'SLIDE AND FADE', {'enter': {'type': 'slide_up', 'durationMs': 400}, 'exit': {'type': 'fade', 'durationMs': 400}}),
        titled('m2', 0, 4000, 'PULSE', {'loop': {'type': 'pulse', 'periodMs': 800}}),
        titled('m3', 2000, 4000, 'typewriter reveal', {'enter': {'type': 'typewriter', 'durationMs': 1200}, 'exit': {'type': 'pop', 'durationMs': 300}}),
      ],
      'audio': {'originalTrack': {'volumeDb': 0}},
    };
    final r = await render(ir, out);
    final verify = await MediaEngineService.getVideoInfo(out);
    report['textMotionRender'] = {'durationMs': r.durationMs, 'warnings': r.warnings};
    expect(r.durationMs, closeTo(4000, 150));
    expect(verify.hasVideo, isTrue);
    final frames = await MediaEngineService.generateThumbnails(
      sourcePath: out, outputDir: '${evidence.path}/text_motion_frames', timesMs: [100, 300, 1000, 1900, 2500, 3500], maxWidth: 540, exact: true);
    expect(frames, hasLength(6));
  });

  testWidgets('clips from different files render from their own files (multi-asset timeline)', (tester) async {
    final out = '${evidence.path}/multi_asset_render.mp4';
    final ir = {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'multi-asset-verification',
      'canvas': canvas,
      'durationMs': 5000,
      'sources': [
        {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
        {'assetId': 'asset_take2', 'durationMs': 15000, 'width': 1920, 'height': 1080},
      ],
      'clips': [
        {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 2500, 'timelineStartMs': 0, 'timelineEndMs': 2500,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
        {'id': 'c2', 'assetId': 'asset_take2', 'sourceStartMs': 1000, 'sourceEndMs': 3500, 'timelineStartMs': 2500, 'timelineEndMs': 5000,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
      ],
      'audio': {'originalTrack': {'volumeDb': 0}},
    };
    RenderResult? r;
    await for (final p in MediaEngineService.renderEditIr(
      editIr: MobileEditIr.fromJson(ir),
      outputPath: out,
      assetPaths: {'primary': speech, 'asset_take2': broll},
    )) {
      if (p.result != null) r = p.result;
    }
    report['multiAssetRender'] = {'durationMs': r!.durationMs, 'warnings': r.warnings};
    expect(r.durationMs, closeTo(5000, 150));
    final frames = await MediaEngineService.generateThumbnails(
      sourcePath: out, outputDir: '${evidence.path}/multi_asset_frames', timesMs: [1000, 4000], maxWidth: 360, exact: true);
    expect(frames, hasLength(2));
    // The two halves come from different videos, so the frames must differ.
    expect(File(frames[0]).readAsBytesSync(), isNot(equals(File(frames[1]).readAsBytesSync())));
  });

  testWidgets('layers: PiP composited above the main video, gaps invisible, keyframed fade-in, full length kept', (tester) async {
    Map<String, dynamic> layerIr({Map<String, dynamic>? layer}) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'layer-verification',
          'canvas': canvas,
          'durationMs': 6000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 6000, 'timelineStartMs': 0, 'timelineEndMs': 6000,
              'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
          ],
          'overlays': [
            if (layer != null)
              {'id': 'pip', 'kind': 'broll', 'timelineStartMs': 1000, 'timelineEndMs': 4000, 'sourceStartMs': 2000,
                'source': {'kind': 'url', 'url': 'https://example.invalid/b.mp4'}, 'fit': 'contain', 'opacity': 1, 'muted': true, 'layer': layer},
          ],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<List<String>> renderFrames(String name, Map<String, dynamic> ir) async {
      final out = '${evidence.path}/$name.mp4';
      RenderResult? r;
      await for (final p in MediaEngineService.renderEditIr(
        editIr: MobileEditIr.fromJson(ir),
        outputPath: out,
        assetPaths: {'primary': speech},
        overlayPaths: {if ((ir['overlays'] as List).isNotEmpty) 'pip': broll},
      )) {
        if (p.result != null) r = p.result;
      }
      report[name] = {'durationMs': r!.durationMs, 'warnings': r.warnings};
      expect(r.durationMs, closeTo(6000, 150), reason: '$name keeps the full timeline length');
      return MediaEngineService.generateThumbnails(
          sourcePath: out, outputDir: '${evidence.path}/${name}_frames', timesMs: [500, 1100, 2500, 4500], maxWidth: 270, exact: true);
    }

    final base = await renderFrames('layer_base', layerIr());
    final pip = await renderFrames('layer_pip', layerIr(layer: {
      'mode': 'overlay', 'x': 0.72, 'y': 0.25, 'scale': 0.5, 'rotation': 0,
      'keyframes': [
        {'atMs': 0, 'opacity': 0},
        {'atMs': 600, 'opacity': 1},
      ],
    }));

    // Mean RGB of a region given as fractions of the frame.
    Future<List<double>> mean(String jpg, double l, double t, double r, double b) async {
      final codec = await ui.instantiateImageCodec(File(jpg).readAsBytesSync());
      final img = (await codec.getNextFrame()).image;
      final bytes = (await img.toByteData(format: ui.ImageByteFormat.rawRgba))!;
      final w = img.width, h = img.height;
      var sr = 0.0, sg = 0.0, sb = 0.0, n = 0;
      for (var y = (t * h).floor(); y < (b * h).floor(); y++) {
        for (var x = (l * w).floor(); x < (r * w).floor(); x++) {
          final i = (y * w + x) * 4;
          sr += bytes.getUint8(i);
          sg += bytes.getUint8(i + 1);
          sb += bytes.getUint8(i + 2);
          n++;
        }
      }
      return [sr / n, sg / n, sb / n];
    }

    double diff(List<double> a, List<double> b) => (a[0] - b[0]).abs() + (a[1] - b[1]).abs() + (a[2] - b[2]).abs();
    const topRight = [0.55, 0.15, 0.9, 0.35];
    const bottomLeft = [0.05, 0.7, 0.4, 0.95];
    Future<double> regionDiff(int frame, List<double> r) async =>
        diff(await mean(base[frame], r[0], r[1], r[2], r[3]), await mean(pip[frame], r[0], r[1], r[2], r[3]));

    final before = await regionDiff(0, topRight); // 0.5 s: no layer yet, the gap must be invisible
    final fadingIn = await regionDiff(1, topRight); // 1.1 s: keyframed opacity ~0.17
    final during = await regionDiff(2, topRight); // 2.5 s: layer fully visible
    final untouched = await regionDiff(2, bottomLeft); // the layer does not cover the bottom-left
    final after = await regionDiff(3, topRight); // 4.5 s: layer ended
    report['layerDiffs'] = {'before': before, 'fadingIn': fadingIn, 'during': during, 'untouched': untouched, 'after': after};
    expect(before, lessThan(25), reason: 'gap frames must not darken or cover the main video');
    expect(during, greaterThan(40), reason: 'the PiP must be visible in the top-right');
    expect(fadingIn, lessThan(during), reason: 'the keyframed fade-in starts transparent');
    expect(untouched, lessThan(25), reason: 'the PiP is a small layer, not a full-frame cutaway');
    expect(after, lessThan(25), reason: 'the layer disappears after its slot');
  });

  testWidgets('colour grade: export matches the preview matrix; vignette darkens only the edges', (tester) async {
    // 1280x720 source cropped to fill 9:16, so the corners hold picture (not letterbox bars).
    Map<String, dynamic> gradeIr(Map<String, dynamic>? filter) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'grade-verification',
          'canvas': canvas,
          'durationMs': 4000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 4000, 'timelineStartMs': 0, 'timelineEndMs': 4000,
              'speed': 1.0, 'volumeDb': 0, 'crop': {'x': 0.342, 'y': 0.0, 'width': 0.316, 'height': 1.0}, 'filter': filter, 'transitionIn': null},
          ],
          'overlays': [],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<List<String>> frames(String name, Map<String, dynamic>? filter) async {
      final r = await render(gradeIr(filter), '${evidence.path}/$name.mp4');
      report[name] = {'durationMs': r.durationMs, 'warnings': r.warnings};
      return MediaEngineService.generateThumbnails(
          sourcePath: '${evidence.path}/$name.mp4', outputDir: '${evidence.path}/${name}_frames', timesMs: [1000, 3000], maxWidth: 270, exact: true);
    }

    final grade = EditIrFilter(preset: 'VINTAGE_WARM', exposure: -0.2, contrast: 0.9, saturation: 0.8, temperature: 0.6, tint: 0.2);
    final base = await frames('grade_base', null);
    final graded = await frames('grade_color', grade.toJson());
    final vignetted = await frames('grade_vignette', EditIrFilter(vignette: 0.8).toJson());

    const centre = [0.3, 0.35, 0.7, 0.65];
    const corner = [0.0, 0.0, 0.18, 0.12];
    final affine = gradeAffine(grade);
    final errors = <double>[];
    for (var i = 0; i < 2; i++) {
      final predicted = await regionMean(base[i], centre, affine: affine);
      final actual = await regionMean(graded[i], centre);
      for (var k = 0; k < 3; k++) {
        errors.add((predicted[k] - actual[k]).abs());
      }
    }
    final baseCorner = await regionMean(base[0], corner);
    final vigCorner = await regionMean(vignetted[0], corner);
    final baseCentre = await regionMean(base[0], centre);
    final vigCentre = await regionMean(vignetted[0], centre);
    double sum(List<double> c) => c[0] + c[1] + c[2];
    report['grade_check'] = {
      'maxChannelError': errors.reduce(math.max),
      'cornerDrop': sum(baseCorner) - sum(vigCorner),
      'centreDrop': sum(baseCentre) - sum(vigCentre),
    };
    // Encoder + JPEG noise stays well under this; a different formula (the old HSL / Brightness chain) does not.
    expect(errors.reduce(math.max), lessThan(9), reason: 'export colour = preview matrix (per channel, 0..255)');
    expect(sum(baseCorner) - sum(vigCorner), greaterThan(30), reason: 'vignette darkens the corners');
    expect((sum(baseCentre) - sum(vigCentre)).abs(), lessThan(9), reason: 'vignette leaves the centre alone');
  });

  testWidgets('ducking: music drops by ~duckDb inside speech ranges', (tester) async {
    final out = '${evidence.path}/duck_render.mp4';
    final r = await render(duckIr(), out);
    final wav = await MediaEngineService.extractAudio(sourcePath: out, destPath: '${evidence.path}/duck_render_16k.wav');
    final bytes = File(wav.path).readAsBytesSync();
    final before = rmsDb(bytes, 1000, 2700);
    final ducked = rmsDb(bytes, 3300, 5300);
    final after = rmsDb(bytes, 6000, 7800);
    report['duckRender'] = {'durationMs': r.durationMs, 'rmsBeforeDb': before, 'rmsDuckedDb': ducked, 'rmsAfterDb': after, 'deltaDb': ducked - before};
    // The music itself varies, so allow a few dB of slack around the -12 dB target.
    expect(ducked - before, lessThan(-8));
    expect(ducked - before, greaterThan(-16));
    expect(after - ducked, greaterThan(6));
  });

  testWidgets('clip audio fades: voice fades in and out, the middle is untouched', (tester) async {
    Map<String, dynamic> fadeIr({int fadeIn = 0, int fadeOut = 0}) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'fade-verification',
          'canvas': canvas,
          'durationMs': 6000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 2000, 'sourceEndMs': 8000, 'timelineStartMs': 0, 'timelineEndMs': 6000,
              'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null,
              if (fadeIn > 0) 'audioFadeInMs': fadeIn,
              if (fadeOut > 0) 'audioFadeOutMs': fadeOut},
          ],
          'overlays': [],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<Uint8List> wav(String name, Map<String, dynamic> ir) async {
      await render(ir, '${evidence.path}/$name.mp4');
      final w = await MediaEngineService.extractAudio(sourcePath: '${evidence.path}/$name.mp4', destPath: '${evidence.path}/${name}_16k.wav');
      return File(w.path).readAsBytesSync();
    }

    final base = await wav('fade_base', fadeIr());
    final faded = await wav('fade_clip', fadeIr(fadeIn: 2000, fadeOut: 2000));
    double delta(int a, int b) => rmsDb(faded, a, b) - rmsDb(base, a, b);
    final start = delta(50, 450); // gain ≤ 0.23
    final middle = delta(2500, 3500); // no fade
    final end = delta(5550, 5950); // gain ≤ 0.23
    report['clipFades'] = {'startDb': start, 'middleDb': middle, 'endDb': end};
    expect(start, lessThan(-10), reason: 'the voice starts faded in');
    expect(end, lessThan(-10), reason: 'the voice ends faded out');
    expect(middle.abs(), lessThan(1.5), reason: 'outside the fades the voice is unchanged');
  });

  testWidgets('export settings: 720p, 24 fps and high quality change the file, not the edit', (tester) async {
    Future<(RenderResult, VideoMetadata)> exportWith(String name, ExportSettings settings) async {
      final out = '${evidence.path}/$name.mp4';
      RenderResult? r;
      await for (final p in MediaEngineService.renderEditIr(
        editIr: MobileEditIr.fromJson(directorIr()),
        outputPath: out,
        assetPaths: {'primary': speech},
        overlayPaths: {'b1': broll},
        musicPaths: {'m1': music},
        settings: settings,
      )) {
        if (p.result != null) r = p.result;
      }
      final info = await MediaEngineService.getVideoInfo(out);
      report[name] = {'width': r!.width, 'height': r.height, 'bytes': r.fileSizeBytes, 'fps': info.frameRate, 'warnings': r.warnings};
      return (r, info);
    }

    final (std, stdInfo) = await exportWith('export_standard', const ExportSettings());
    final (small, smallInfo) = await exportWith('export_720_24_high', const ExportSettings(maxShortSide: 720, fps: 24, quality: 'high'));
    expect([std.width, std.height], [1080, 1920]);
    expect([small.width, small.height], [720, 1280], reason: 'short side scaled to 720, aspect kept');
    expect(small.durationMs, closeTo(std.durationMs, 150));
    // Real frame rates from the sample table (the container's frame-rate field is only an encoder hint).
    final real = await MediaEngineService.countVideoFrames('${evidence.path}/export_720_24_high.mp4');
    final real0 = await MediaEngineService.countVideoFrames('${evidence.path}/export_standard.mp4');
    report['exportFps'] = {'standard': real0.fps, 'standardFrames': real0.frames, 'at24': real.fps, 'at24Frames': real.frames, 'hint24': smallInfo.frameRate, 'hint': stdInfo.frameRate};
    expect(real.fps, lessThanOrEqualTo(24.6), reason: 'the 24 fps export has at most 24 frames per second');
    expect(real.fps, greaterThan(18), reason: 'and is not starved of frames');
    // 720p at double bitrate is still a real encode of the same length; "high" must not shrink below standard 720p.
    expect(small.fileSizeBytes, greaterThan(std.fileSizeBytes * 0.3));
  });

  testWidgets('voiceover: placed at its slot over muted footage; the recorder writes a real file', (tester) async {
    Map<String, dynamic> voIr() => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'voiceover-verification',
          'canvas': canvas,
          'durationMs': 6000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 6000, 'timelineStartMs': 0, 'timelineEndMs': 6000,
              'speed': 1.0, 'volumeDb': -60, 'crop': null, 'filter': null, 'transitionIn': null},
          ],
          'overlays': [],
          'audio': {
            'originalTrack': {'volumeDb': 0},
            'music': [],
            'speechRangesMs': [],
            'voiceovers': [
              {'id': 'vo1', 'timelineStartMs': 2000, 'durationMs': 2500, 'sourceStartMs': 3000, 'source': {'kind': 'asset', 'assetId': 'rec'}, 'volumeDb': 0},
            ],
          },
        };
    final out = '${evidence.path}/voiceover.mp4';
    RenderResult? r;
    await for (final p in MediaEngineService.renderEditIr(
      editIr: MobileEditIr.fromJson(voIr()),
      outputPath: out,
      assetPaths: {'primary': speech, 'rec': music},
    )) {
      if (p.result != null) r = p.result;
    }
    final wav = File((await MediaEngineService.extractAudio(sourcePath: out, destPath: '${evidence.path}/voiceover_16k.wav')).path).readAsBytesSync();
    final before = rmsDb(wav, 200, 1800);
    final during = rmsDb(wav, 2300, 4200);
    final after = rmsDb(wav, 4800, 5800);
    report['voiceover'] = {'durationMs': r!.durationMs, 'beforeDb': before, 'duringDb': during, 'afterDb': after};
    expect(r.durationMs, closeTo(6000, 150));
    expect(during - before, greaterThan(25), reason: 'the voiceover is heard only in its slot');
    expect(during - after, greaterThan(25));

    // Recorder: the emulator microphone may be silent, but a real AAC file of about the right length must appear.
    final recPath = await MediaEngineService.getVoiceoverPath('test_recording.m4a');
    await MediaEngineService.startVoiceRecording(recPath);
    await Future<void>.delayed(const Duration(milliseconds: 1600));
    final rec = await MediaEngineService.stopVoiceRecording();
    report['recorder'] = {'durationMs': rec.durationMs, 'bytes': File(rec.path).lengthSync()};
    expect(File(rec.path).existsSync(), isTrue);
    expect(rec.durationMs, inInclusiveRange(1000, 3000));
  });

  testWidgets('stickers: a transparent PNG layer shows only its drawn pixels', (tester) async {
    // A red disc on a transparent 512² canvas, like an emoji sticker.
    final rec = ui.PictureRecorder();
    ui.Canvas(rec).drawCircle(const ui.Offset(256, 256), 150, ui.Paint()..color = const ui.Color(0xFFFF0000));
    final img = await rec.endRecording().toImage(512, 512);
    final png = (await img.toByteData(format: ui.ImageByteFormat.png))!;
    final stickerPath = '${evidence.path}/sticker.png';
    File(stickerPath).writeAsBytesSync(png.buffer.asUint8List());

    Map<String, dynamic> stickerIr({bool withSticker = true}) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'sticker-verification',
          'canvas': canvas,
          'durationMs': 3000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 3000, 'timelineStartMs': 0, 'timelineEndMs': 3000,
              'speed': 1.0, 'volumeDb': 0, 'crop': {'x': 0.342, 'y': 0.0, 'width': 0.316, 'height': 1.0}, 'filter': null, 'transitionIn': null},
          ],
          'overlays': [
            if (withSticker)
              {'id': 'st', 'kind': 'broll', 'mediaType': 'image', 'timelineStartMs': 0, 'timelineEndMs': 3000, 'sourceStartMs': 0,
                'source': {'kind': 'asset', 'assetId': 'local_st'}, 'fit': 'contain', 'opacity': 1, 'muted': true,
                'layer': {'mode': 'overlay', 'x': 0.5, 'y': 0.5, 'scale': 0.5, 'rotation': 0}},
          ],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<List<String>> frames(String name, Map<String, dynamic> ir) async {
      await render(ir, '${evidence.path}/$name.mp4', overlays: {if ((ir['overlays'] as List).isNotEmpty) 'st': stickerPath});
      return MediaEngineService.generateThumbnails(
          sourcePath: '${evidence.path}/$name.mp4', outputDir: '${evidence.path}/${name}_frames', timesMs: [1500], maxWidth: 270, exact: true);
    }

    final base = await frames('sticker_base', stickerIr(withSticker: false));
    final withSticker = await frames('sticker_layer', stickerIr());
    // The layer box is 540 px square in the middle; the disc covers its centre, its corners are transparent.
    const disc = [0.46, 0.48, 0.54, 0.52];
    const transparentCorner = [0.26, 0.37, 0.30, 0.39];
    final d = await regionMean(withSticker[0], disc);
    final cornerBase = await regionMean(base[0], transparentCorner);
    final cornerSticker = await regionMean(withSticker[0], transparentCorner);
    final cornerDiff = [for (var k = 0; k < 3; k++) (cornerBase[k] - cornerSticker[k]).abs()].reduce(math.max);
    report['sticker'] = {'disc': d, 'cornerDiff': cornerDiff};
    expect(d[0], greaterThan(200), reason: 'the disc is drawn');
    expect(d[1] + d[2], lessThan(80), reason: 'the disc is red');
    expect(cornerDiff, lessThan(10), reason: 'transparent pixels show the video underneath');
  });

  testWidgets('freeze frame: a still on the main track holds, matches the source frame and is silent', (tester) async {
    final still = (await MediaEngineService.generateThumbnails(
        sourcePath: speech, outputDir: '${evidence.path}/freeze_still', timesMs: [6000], maxWidth: 1920, exact: true))
        .single;
    Map<String, dynamic> clip(String id, String asset, int s, int e, int ts) => {
          'id': id, 'assetId': asset, 'sourceStartMs': s, 'sourceEndMs': e, 'timelineStartMs': ts, 'timelineEndMs': ts + e - s,
          'speed': 1.0, 'volumeDb': 0, 'crop': {'x': 0.342, 'y': 0.0, 'width': 0.316, 'height': 1.0}, 'filter': null, 'transitionIn': null,
        };
    final ir = {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'freeze-verification',
      'canvas': canvas,
      'durationMs': 6000,
      'sources': [
        {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
        {'assetId': 'still', 'durationMs': 600000, 'width': 1280, 'height': 720},
      ],
      'clips': [clip('c1', 'primary', 4000, 6000, 0), clip('fz', 'still', 0, 2000, 2000), clip('c2', 'primary', 6000, 8000, 4000)],
      'overlays': [],
      'audio': {'originalTrack': {'volumeDb': 0}},
    };
    final out = '${evidence.path}/freeze.mp4';
    RenderResult? r;
    await for (final p in MediaEngineService.renderEditIr(
      editIr: MobileEditIr.fromJson(ir),
      outputPath: out,
      assetPaths: {'primary': speech, 'still': still},
    )) {
      if (p.result != null) r = p.result;
    }
    final frames = await MediaEngineService.generateThumbnails(
        sourcePath: out, outputDir: '${evidence.path}/freeze_frames', timesMs: [1950, 2300, 3700, 4300], maxWidth: 270, exact: true);
    const centre = [0.2, 0.3, 0.8, 0.7];
    double diff(List<double> a, List<double> b) => [for (var k = 0; k < 3; k++) (a[k] - b[k]).abs()].reduce(math.max);
    final before = await regionMean(frames[0], centre);
    final holdA = await regionMean(frames[1], centre);
    final holdB = await regionMean(frames[2], centre);
    final wav = File((await MediaEngineService.extractAudio(sourcePath: out, destPath: '${evidence.path}/freeze_16k.wav')).path).readAsBytesSync();
    final speechDb = rmsDb(wav, 200, 1800);
    final holdDb = rmsDb(wav, 2200, 3800);
    report['freeze'] = {'durationMs': r!.durationMs, 'holdDiff': diff(holdA, holdB), 'toSourceDiff': diff(before, holdA), 'speechDb': speechDb, 'holdDb': holdDb};
    expect(r.durationMs, closeTo(6000, 150));
    expect(diff(holdA, holdB), lessThan(4), reason: 'the still does not move');
    expect(diff(before, holdA), lessThan(20), reason: 'the still is the frame where the clip stopped');
    expect(speechDb - holdDb, greaterThan(20), reason: 'the hold is silent');
  });

  testWidgets('green screen: the key colour becomes see-through, the subject stays', (tester) async {
    // A "green-screen shot": pure green with a red subject in the middle.
    final rec = ui.PictureRecorder();
    final cv = ui.Canvas(rec);
    cv.drawRect(const ui.Rect.fromLTWH(0, 0, 720, 1280), ui.Paint()..color = const ui.Color(0xFF00FF00));
    cv.drawRect(const ui.Rect.fromLTWH(260, 540, 200, 200), ui.Paint()..color = const ui.Color(0xFFFF0000));
    final img = await rec.endRecording().toImage(720, 1280);
    final png = (await img.toByteData(format: ui.ImageByteFormat.png))!;
    final gsPath = '${evidence.path}/greenscreen.png';
    File(gsPath).writeAsBytesSync(png.buffer.asUint8List());

    Map<String, dynamic> gsIr({bool keyed = true}) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'chroma-verification',
          'canvas': canvas,
          'durationMs': 3000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 3000, 'timelineStartMs': 0, 'timelineEndMs': 3000,
              'speed': 1.0, 'volumeDb': 0, 'crop': {'x': 0.342, 'y': 0.0, 'width': 0.316, 'height': 1.0}, 'filter': null, 'transitionIn': null},
          ],
          'overlays': [
            if (keyed)
              {'id': 'gs', 'kind': 'broll', 'mediaType': 'image', 'timelineStartMs': 0, 'timelineEndMs': 3000, 'sourceStartMs': 0,
                'source': {'kind': 'asset', 'assetId': 'local_gs'}, 'fit': 'contain', 'opacity': 1, 'muted': true,
                'layer': {'mode': 'overlay', 'x': 0.5, 'y': 0.5, 'scale': 1, 'rotation': 0},
                'chromaKey': {'color': '#00FF00', 'similarity': 0.3, 'smoothness': 0.1, 'spill': 0.5}},
          ],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<String> frame(String name, Map<String, dynamic> ir) async {
      await render(ir, '${evidence.path}/$name.mp4', overlays: {if ((ir['overlays'] as List).isNotEmpty) 'gs': gsPath});
      return (await MediaEngineService.generateThumbnails(
              sourcePath: '${evidence.path}/$name.mp4', outputDir: '${evidence.path}/${name}_frames', timesMs: [1500], maxWidth: 270, exact: true))
          .single;
    }

    final base = await frame('chroma_base', gsIr(keyed: false));
    final keyed = await frame('chroma_keyed', gsIr());
    const subject = [0.42, 0.45, 0.58, 0.55];
    const background = [0.1, 0.1, 0.3, 0.3];
    final s = await regionMean(keyed, subject);
    final bgBase = await regionMean(base, background);
    final bgKeyed = await regionMean(keyed, background);
    final bgDiff = [for (var k = 0; k < 3; k++) (bgBase[k] - bgKeyed[k]).abs()].reduce(math.max);
    report['chroma'] = {'subject': s, 'backgroundDiff': bgDiff};
    expect(s[0], greaterThan(200), reason: 'the subject is kept');
    expect(s[1], lessThan(60), reason: 'no green left on the subject');
    expect(bgDiff, lessThan(10), reason: 'the green background shows the main video');
  });

  testWidgets('visual understanding: scene labels, scene cuts, OCR and loudness run on the phone', (tester) async {
    final labels = await MediaEngineService.labelScenes(sourcePath: broll);
    final scenes = await MediaEngineService.detectScenes(sourcePath: broll);
    final ocr = await MediaEngineService.recognizeText(sourcePath: speech, sampleEveryMs: 3000);
    final loud = await MediaEngineService.measureLoudness(sourcePath: speech);
    report['visual'] = {
      'labels': [for (final l in labels.take(6)) l.toJson()],
      'scenes': scenes.length,
      'ocr': [for (final o in ocr.take(3)) o.toJson()],
      'lufs': loud.integratedLufs,
    };
    expect(labels, isNotEmpty, reason: 'ML Kit names what the B-roll shows');
    expect(labels.every((l) => l.labels.isNotEmpty && l.endMs > l.startMs), isTrue);
    expect(loud.integratedLufs, isNotNull);
    // The request carries them as plain data.
    final json = MediaIntelligence(scenesMs: scenes, ocr: ocr, labels: labels, loudness: loud).toJson();
    expect(json['labels'], isA<List>());
  });

  testWidgets('AI narration: the phone speaks the text to a real audio file (or says why it cannot)', (tester) async {
    final out = await MediaEngineService.getVoiceoverPath('test_tts.wav');
    try {
      final r = await MediaEngineService.synthesizeSpeech(text: 'Wait for the last tip, it changes everything.', outputPath: out);
      final wav = File(r.path).readAsBytesSync();
      final level = rmsDb(Uint8List.fromList(wav), 100, math.min(r.durationMs - 100, 1500));
      report['tts'] = {'durationMs': r.durationMs, 'bytes': wav.length, 'rmsDb': level};
      expect(r.durationMs, inInclusiveRange(1200, 8000), reason: 'about 2-4 s of speech');
      expect(wav.length, greaterThan(20000));
    } on MediaEngineException catch (e) {
      // An image without a TTS voice must say so with a typed error, never return silence.
      report['tts'] = {'error': e.code};
      expect(e.code, anyOf('TTS_NOT_AVAILABLE', 'TTS_LANGUAGE_UNAVAILABLE'));
    }
  });

  testWidgets('voice cleanup: quiet noise between words drops, speech keeps its level', (tester) async {
    Map<String, dynamic> ir({bool clean = false}) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'cleanup-verification',
          'canvas': canvas,
          'durationMs': 12000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 12000, 'timelineStartMs': 0, 'timelineEndMs': 12000,
              'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null, if (clean) 'voiceCleanup': true},
          ],
          'overlays': [],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<List<double>> windows(String name, Map<String, dynamic> irJson) async {
      await render(irJson, '${evidence.path}/$name.mp4');
      final wav = File((await MediaEngineService.extractAudio(sourcePath: '${evidence.path}/$name.mp4', destPath: '${evidence.path}/${name}_16k.wav')).path)
          .readAsBytesSync();
      return [for (var t = 500; t < 11500; t += 100) rmsDb(wav, t, t + 100)];
    }

    final base = await windows('cleanup_off', ir());
    final clean = await windows('cleanup_on', ir(clean: true));
    // Rank windows by the original level: the quietest are pauses/room noise, the loudest are speech.
    final order = List.generate(base.length, (i) => i)..sort((a, b) => base[a].compareTo(base[b]));
    double meanOf(List<double> v, Iterable<int> idx) => idx.map((i) => v[i]).reduce((a, b) => a + b) / idx.length;
    final quiet = order.take(order.length ~/ 10);
    final loud = order.skip(order.length * 8 ~/ 10);
    final quietDrop = meanOf(base, quiet) - meanOf(clean, quiet);
    final loudDrop = meanOf(base, loud) - meanOf(clean, loud);
    report['voiceCleanup'] = {'quietDropDb': quietDrop, 'loudDropDb': loudDrop};
    expect(quietDrop, greaterThan(4), reason: 'noise between words is lowered');
    expect(loudDrop.abs(), lessThan(2.5), reason: 'speech keeps its level');
  });

  testWidgets('layer mask: a circle shape keeps the middle and shows the video in the corners', (tester) async {
    final rec = ui.PictureRecorder();
    ui.Canvas(rec).drawRect(const ui.Rect.fromLTWH(0, 0, 512, 512), ui.Paint()..color = const ui.Color(0xFFFF0000));
    final img = await rec.endRecording().toImage(512, 512);
    final png = (await img.toByteData(format: ui.ImageByteFormat.png))!;
    final squarePath = '${evidence.path}/square.png';
    File(squarePath).writeAsBytesSync(png.buffer.asUint8List());
    Map<String, dynamic> maskIr({bool layer = true}) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'mask-verification',
          'canvas': canvas,
          'durationMs': 3000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 3000, 'timelineStartMs': 0, 'timelineEndMs': 3000,
              'speed': 1.0, 'volumeDb': 0, 'crop': {'x': 0.342, 'y': 0.0, 'width': 0.316, 'height': 1.0}, 'filter': null, 'transitionIn': null},
          ],
          'overlays': [
            if (layer)
              {'id': 'sq', 'kind': 'broll', 'mediaType': 'image', 'timelineStartMs': 0, 'timelineEndMs': 3000, 'sourceStartMs': 0,
                'source': {'kind': 'asset', 'assetId': 'local_sq'}, 'fit': 'contain', 'opacity': 1, 'muted': true,
                'layer': {'mode': 'overlay', 'x': 0.5, 'y': 0.5, 'scale': 0.5, 'rotation': 0},
                'mask': {'shape': 'circle', 'radius': 0.15, 'feather': 0.01}},
          ],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<String> frame(String name, Map<String, dynamic> ir) async {
      await render(ir, '${evidence.path}/$name.mp4', overlays: {if ((ir['overlays'] as List).isNotEmpty) 'sq': squarePath});
      return (await MediaEngineService.generateThumbnails(
              sourcePath: '${evidence.path}/$name.mp4', outputDir: '${evidence.path}/${name}_frames', timesMs: [1500], maxWidth: 270, exact: true))
          .single;
    }

    final base = await frame('mask_base', maskIr(layer: false));
    final masked = await frame('mask_circle', maskIr());
    // The 540 px layer box spans x 0.25-0.75, y ~0.36-0.64; its corners are outside the circle.
    const centre = [0.46, 0.48, 0.54, 0.52];
    const corner = [0.26, 0.37, 0.29, 0.385];
    final c = await regionMean(masked, centre);
    final cb = await regionMean(base, corner);
    final cm = await regionMean(masked, corner);
    final cornerDiff = [for (var k = 0; k < 3; k++) (cb[k] - cm[k]).abs()].reduce(math.max);
    report['mask'] = {'centre': c, 'cornerDiff': cornerDiff};
    expect(c[0], greaterThan(200));
    expect(c[1] + c[2], lessThan(80));
    expect(cornerDiff, lessThan(10), reason: 'outside the circle the video shows');
  });

  testWidgets('reverse: frames and sound of the range play backwards in a new file of the same length', (tester) async {
    // Picture: B-roll has motion.
    final v = await MediaEngineService.reverseClip(sourcePath: broll, startMs: 2000, endMs: 6000, outputPath: '${evidence.path}/rev_broll.mp4');
    expect(v.durationMs, closeTo(4000, 120));
    Future<String> f(String src, int t, String tag) async =>
        (await MediaEngineService.generateThumbnails(sourcePath: src, outputDir: '${evidence.path}/rev_$tag', timesMs: [t], maxWidth: 160, exact: true)).single;
    const all = [0.0, 0.0, 1.0, 1.0];
    double diff(List<double> a, List<double> b) => [for (var k = 0; k < 3; k++) (a[k] - b[k]).abs()].reduce((x, y) => x + y);
    final revStart = await regionMean(await f(v.path, 300, 'r0'), all);
    final srcEnd = await regionMean(await f(broll, 5700, 's1'), all);
    final srcStart = await regionMean(await f(broll, 2300, 's0'), all);

    // Sound: the loudness envelope of the reversed speech is the original one flipped.
    final a = await MediaEngineService.reverseClip(sourcePath: speech, startMs: 2000, endMs: 6000, outputPath: '${evidence.path}/rev_speech.mp4');
    final origWav = File((await MediaEngineService.extractAudio(sourcePath: speech, destPath: '${evidence.path}/rev_orig_16k.wav')).path).readAsBytesSync();
    final revWav = File((await MediaEngineService.extractAudio(sourcePath: a.path, destPath: '${evidence.path}/rev_rev_16k.wav')).path).readAsBytesSync();
    final orig = [for (var t = 2000; t < 5800; t += 200) rmsDb(origWav, t, t + 200)];
    final rev = [for (var t = 0; t < 3800; t += 200) rmsDb(revWav, t, t + 200)];
    double envDiff(List<double> x, List<double> y) {
      var s = 0.0;
      for (var i = 0; i < math.min(x.length, y.length); i++) {
        s += (x[i].clamp(-80.0, 0.0) - y[i].clamp(-80.0, 0.0)).abs();
      }
      return s / math.min(x.length, y.length);
    }
    final flipped = envDiff(rev, orig.reversed.toList());
    final straight = envDiff(rev, orig);
    report['reverse'] = {
      'videoMs': v.durationMs, 'audioMs': a.durationMs,
      'frameToEnd': diff(revStart, srcEnd), 'frameToStart': diff(revStart, srcStart),
      'envFlipped': flipped, 'envStraight': straight,
    };
    expect(diff(revStart, srcEnd), lessThan(diff(revStart, srcStart)), reason: 'the reversed clip starts where the original ended');
    expect(flipped, lessThan(straight), reason: 'the sound runs backwards');
  });

  testWidgets('remove background: the person stays, the rest becomes key green (video) or transparent (photo)', (tester) async {
    final v = await MediaEngineService.removeBackground(sourcePath: speech, startMs: 2000, endMs: 4000, outputPath: '${evidence.path}/cutout.mp4');
    expect(v.durationMs, closeTo(2000, 100));
    final frame = (await MediaEngineService.generateThumbnails(
            sourcePath: v.path, outputDir: '${evidence.path}/cutout_frames', timesMs: [1000], maxWidth: 320, exact: true))
        .single;
    final corner = await regionMean(frame, const [0.0, 0.0, 0.12, 0.2]);

    // Photo: transparent PNG of the same moment (source 3.0 s = cut-out 1.0 s).
    final still = (await MediaEngineService.generateThumbnails(
            sourcePath: speech, outputDir: '${evidence.path}/cutout_still', timesMs: [3000], maxWidth: 1280, exact: true))
        .single;
    final png = await MediaEngineService.removeImageBackground(sourcePath: still, outputPath: '${evidence.path}/cutout.png');
    final codec = await ui.instantiateImageCodec(File(png).readAsBytesSync());
    final img = (await codec.getNextFrame()).image;
    final bytes = (await img.toByteData(format: ui.ImageByteFormat.rawRgba))!;
    int alphaAt(double fx, double fy) => bytes.getUint8(((fy * img.height).floor() * img.width + (fx * img.width).floor()) * 4 + 3);
    // Where the photo mask is most solidly "person": the cell whose 3x3 neighbourhood is fully opaque.
    (double, double)? person;
    for (var gy = 1; gy < 17 && person == null; gy++) {
      for (var gx = 1; gx < 31 && person == null; gx++) {
        final fx = gx / 32, fy = gy / 18;
        final solid = [for (final dx in [-1, 0, 1]) for (final dy in [-1, 0, 1]) alphaAt(fx + dx / 64, fy + dy / 36)].every((a) => a > 220);
        if (solid) person = (fx, fy);
      }
    }
    expect(person, isNotNull, reason: 'a person is found in the photo');
    final (px, py) = person!;
    final inPerson = await regionMean(frame, [px - 0.01, py - 0.015, px + 0.01, py + 0.015]);
    report['cutout'] = {'corner': corner, 'inPerson': inPerson, 'at': [px, py], 'cornerAlpha': alphaAt(0.03, 0.05)};
    expect(corner[1], greaterThan(180), reason: 'background is key green');
    expect(corner[0] + corner[2], lessThan(120));
    expect(inPerson[1] < inPerson[0] + inPerson[2] + 40, isTrue, reason: 'the person in the video is kept (not green)');
    expect(alphaAt(0.03, 0.05), lessThan(40), reason: 'photo background is transparent');
  });

  testWidgets('crossfade: the incoming clip really overlaps the outgoing one (no dip through black)', (tester) async {
    Map<String, dynamic> clip(String id, String asset, int s, int e, int ts, {Map<String, dynamic>? transition}) => {
          'id': id, 'assetId': asset, 'sourceStartMs': s, 'sourceEndMs': e, 'timelineStartMs': ts, 'timelineEndMs': ts + e - s,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': transition,
        };
    Map<String, dynamic> ir(List<Map<String, dynamic>> clips, int duration) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'xfade-verification',
          'canvas': canvas,
          'durationMs': duration,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
            {'assetId': 'b', 'durationMs': 15000, 'width': 1280, 'height': 720},
          ],
          'clips': clips,
          'overlays': [],
          'audio': {'originalTrack': {'volumeDb': 0}},
        };
    Future<List<String>> frames(String name, Map<String, dynamic> irJson, List<int> at) async {
      final out = '${evidence.path}/$name.mp4';
      RenderResult? r;
      await for (final p in MediaEngineService.renderEditIr(editIr: MobileEditIr.fromJson(irJson), outputPath: out, assetPaths: {'primary': speech, 'b': broll})) {
        if (p.result != null) r = p.result;
      }
      report[name] = {'durationMs': r!.durationMs, 'warnings': r.warnings};
      return MediaEngineService.generateThumbnails(sourcePath: out, outputDir: '${evidence.path}/${name}_frames', timesMs: at, maxWidth: 270, exact: true);
    }

    final xf = await frames('xfade', ir([clip('a', 'primary', 0, 3000, 0), clip('b', 'b', 3000, 6000, 3000, transition: {'type': 'CROSSFADE', 'durationMs': 1000})], 6000), [1500, 2500, 2950, 3500]);
    final aOnly = await frames('xfade_a', ir([clip('a', 'primary', 0, 3000, 0)], 3000), [2500]);
    final bPre = await frames('xfade_b', ir([clip('b', 'b', 2500, 3500, 0)], 1000), [0]);
    const centre = [0.1, 0.38, 0.9, 0.62];
    final mid = await regionMean(xf[1], centre);
    final a = await regionMean(aOnly[0], centre);
    final b = await regionMean(bPre[0], centre);
    final expected = [for (var k = 0; k < 3; k++) (a[k] + b[k]) / 2];
    final mixErr = [for (var k = 0; k < 3; k++) (mid[k] - expected[k]).abs()].reduce(math.max);
    final nearCut = await regionMean(xf[2], centre);
    double luma(List<double> c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    report['xfadeCheck'] = {'mid': mid, 'expected': expected, 'mixErr': mixErr, 'nearCutLuma': luma(nearCut), 'bLuma': luma(b)};
    expect(mixErr, lessThan(14), reason: 'halfway, the frame is half outgoing + half incoming');
    expect(luma(nearCut), greaterThan(luma(b) * 0.7), reason: 'no dip through black at the cut');
    expect((report['xfade'] as Map)['warnings'].toString().contains('dip through black'), isFalse);
  });

  testWidgets('stabilise: a shaking static shot comes out steady', (tester) async {
    // A static scene (a still) shaken by the "shake" effect = pure camera shake.
    final still = (await MediaEngineService.generateThumbnails(
            sourcePath: speech, outputDir: '${evidence.path}/stab_still', timesMs: [3000], maxWidth: 1280, exact: true))
        .single;
    final shakyIr = {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'stab-verification',
      'canvas': {'aspect': '16:9', 'width': 1280, 'height': 720, 'fps': 30, 'background': '#000000'},
      'durationMs': 4000,
      'sources': [
        {'assetId': 'still', 'durationMs': 600000, 'width': 1280, 'height': 720},
      ],
      'clips': [
        {'id': 'c1', 'assetId': 'still', 'sourceStartMs': 0, 'sourceEndMs': 4000, 'timelineStartMs': 0, 'timelineEndMs': 4000,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
      ],
      'overlays': [],
      'effects': [
        {'id': 'sh', 'type': 'shake', 'startMs': 0, 'endMs': 4000, 'intensity': 1.0},
      ],
      'audio': {'originalTrack': {'volumeDb': 0}},
    };
    final shaky = '${evidence.path}/shaky.mp4';
    await for (final _ in MediaEngineService.renderEditIr(editIr: MobileEditIr.fromJson(shakyIr), outputPath: shaky, assetPaths: {'still': still})) {}
    final steady = await MediaEngineService.stabilizeClip(sourcePath: shaky, startMs: 0, endMs: 4000, outputPath: '${evidence.path}/steady.mp4');
    expect(steady.durationMs, closeTo(4000, 120));

    Future<List<int>> gray(String jpg) async {
      final img = (await (await ui.instantiateImageCodec(File(jpg).readAsBytesSync())).getNextFrame()).image;
      final b = (await img.toByteData(format: ui.ImageByteFormat.rawRgba))!;
      return [for (var i = 0; i < img.width * img.height; i++) (b.getUint8(i * 4) * 77 + b.getUint8(i * 4 + 1) * 150 + b.getUint8(i * 4 + 2) * 29) >> 8];
    }
    Future<double> jitter(String video, String tag) async {
      final times = [for (var t = 1000; t <= 3000; t += 100) t];
      final files = await MediaEngineService.generateThumbnails(sourcePath: video, outputDir: '${evidence.path}/stab_$tag', timesMs: times, maxWidth: 160, exact: true);
      var total = 0.0;
      List<int>? prev;
      for (final f in files) {
        final g = await gray(f);
        if (prev != null) {
          var d = 0;
          for (var i = 0; i < g.length; i++) {
            d += (g[i] - prev[i]).abs();
          }
          total += d / g.length;
        }
        prev = g;
      }
      return total / (files.length - 1);
    }

    final before = await jitter(shaky, 'shaky');
    final after = await jitter(steady.path, 'steady');
    report['stabilise'] = {'jitterBefore': before, 'jitterAfter': after};
    expect(after, lessThan(before * 0.5), reason: 'frame-to-frame movement at least halves');
  });

  testWidgets('frame rate: 15 fps exports hold with speed changes, cutaways and music', (tester) async {
    Map<String, dynamic> ir(Map<String, dynamic> extra) => {
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'fps-probe',
          'canvas': {...canvas, 'fps': 15},
          'durationMs': 4000,
          'sources': [
            {'assetId': 'primary', 'durationMs': 30090, 'width': 1280, 'height': 720},
          ],
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 4000, 'timelineStartMs': 0, 'timelineEndMs': 4000,
              'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
          ],
          'overlays': [],
          'audio': {'originalTrack': {'volumeDb': 0}},
          ...extra,
        };
    final plain = '${evidence.path}/fps_plain.mp4';
    RenderResult? r;
    await for (final p in MediaEngineService.renderEditIr(editIr: MobileEditIr.fromJson(ir({})), outputPath: plain, assetPaths: {'primary': speech})) {
      if (p.result != null) r = p.result;
    }
    final c = await MediaEngineService.countVideoFrames(plain);
    final out = <String, Object>{'plain': c.fps, 'warnings': r!.warnings};
    final variants = <String, Map<String, dynamic>>{
      'speed': {
        'clips': [
          {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 6000, 'timelineStartMs': 0, 'timelineEndMs': 4000,
            'speed': 1.5, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
        ],
      },
      'cutaway': {
        'overlays': [
          {'id': 'b1', 'kind': 'broll', 'timelineStartMs': 1000, 'timelineEndMs': 2500, 'sourceStartMs': 0,
            'source': {'kind': 'url', 'url': 'https://example.invalid/b.mp4'}, 'fit': 'cover', 'opacity': 1, 'muted': true},
        ],
      },
      'music': {
        'audio': {'originalTrack': {'volumeDb': 0}, 'music': [
          {'id': 'm1', 'timelineStartMs': 0, 'timelineEndMs': 4000, 'sourceStartMs': 0, 'source': {'kind': 'url', 'url': 'https://example.invalid/m.mp3'},
            'volumeDb': -12, 'fadeInMs': 0, 'fadeOutMs': 0, 'duck': {'enabled': false, 'duckDb': -12, 'attackMs': 100, 'releaseMs': 300}},
        ], 'speechRangesMs': []},
      },
    };
    for (final e in variants.entries) {
      final path = '${evidence.path}/fps_${e.key}.mp4';
      await for (final _ in MediaEngineService.renderEditIr(
          editIr: MobileEditIr.fromJson(ir(e.value)), outputPath: path, assetPaths: {'primary': speech}, overlayPaths: {'b1': broll}, musicPaths: {'m1': music})) {}
      out[e.key] = (await MediaEngineService.countVideoFrames(path)).fps;
    }
    report['frameRate'] = out;
    for (final e in out.entries.where((e) => e.value is double)) {
      expect(e.value as double, inInclusiveRange(13.5, 15.6), reason: '${e.key} keeps the export frame rate');
    }
  });

  testWidgets('cancel stops the export with CANCELLED and removes the partial file', (tester) async {
    final out = '${evidence.path}/cancelled.mp4';
    final stream = MediaEngineService.renderEditIr(
      editIr: MobileEditIr.fromJson(directorIr()),
      outputPath: out,
      assetPaths: {'primary': speech},
      overlayPaths: {'b1': broll},
      musicPaths: {'m1': music},
      jobId: 'cancel-me',
    );
    Object? error;
    var cancelRequested = false;
    try {
      await for (final p in stream) {
        if (!cancelRequested && p.state == RenderState.progress) {
          cancelRequested = true;
          expect(await MediaEngineService.cancelRender('cancel-me'), isTrue);
        }
      }
    } catch (e) {
      error = e;
    }
    report['cancel'] = {'error': '$error', 'fileExists': File(out).existsSync()};
    expect(error, isA<MediaEngineException>().having((e) => e.code, 'code', 'CANCELLED'));
    expect(File(out).existsSync(), isFalse);
  });

  testWidgets('missing media is a typed error, never a placeholder file', (tester) async {
    final out = '${evidence.path}/missing.mp4';
    await expectLater(
      render(directorIr(), out), // no overlayPaths for b1
      throwsA(isA<MediaEngineException>().having((e) => e.code, 'code', 'MISSING_MEDIA')),
    );
    expect(File(out).existsSync(), isFalse);
  });
}
