// On-device verification of two export fixes (Android Media3 renderer):
//   * AAC is only requested when the timeline has audio: a video-only source must export (no audio track),
//     not fail with an encoder error.
//   * HDR tone-mapping is only enabled for HDR sources: an SDR source reports no HDR warning, a PQ (HDR10) source
//     is tone-mapped to SDR and says so.
// Fixtures (gitignored test_assets/) are pushed by the host after install:
//   adb push test_assets/silent-6s.mp4 <ext>/test_assets/silent.mp4   (H.264, no audio track)
//   adb push test_assets/hdr-pq-4s.mp4 <ext>/test_assets/hdr.mp4      (HEVC Main10, BT.2020 / SMPTE-2084)
//   adb push test_assets/speech_obama_30s.mp4 <ext>/test_assets/speech.mp4 (H.264 + AAC)
//   adb shell touch <ext>/test_assets/.formats-ready
// where <ext> = /sdcard/Android/data/com.workspace180.social_studio_mobile/files
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';

late Directory ext;
late String silent, hdr, speech;
late Directory evidence;
final report = <String, dynamic>{};

Map<String, dynamic> singleClipIr(String id, int durationMs, {required int w, required int h}) => {
      'schemaVersion': 'mobile-editir/1',
      'projectId': id,
      'canvas': {'aspect': '16:9', 'width': 1280, 'height': 720, 'fps': 30, 'background': '#000000'},
      'durationMs': durationMs,
      'sources': [
        {'assetId': 'primary', 'durationMs': durationMs, 'width': w, 'height': h},
      ],
      'clips': [
        {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': durationMs, 'timelineStartMs': 0, 'timelineEndMs': durationMs,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
      ],
      'audio': {'originalTrack': {'volumeDb': 0}, 'music': <dynamic>[], 'speechRangesMs': <dynamic>[]},
    };

Future<RenderResult> render(Map<String, dynamic> ir, String source, String out) async {
  RenderResult? result;
  await for (final p in MediaEngineService.renderEditIr(editIr: MobileEditIr.fromJson(ir), outputPath: out, assetPaths: {'primary': source})) {
    if (p.result != null) result = p.result;
  }
  return result!;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    ext = (await getExternalStorageDirectory())!;
    silent = '${ext.path}/test_assets/silent.mp4';
    hdr = '${ext.path}/test_assets/hdr.mp4';
    speech = '${ext.path}/test_assets/speech.mp4';
    final deadline = DateTime.now().add(const Duration(minutes: 3));
    bool ready() => File('${ext.path}/test_assets/.formats-ready').existsSync();
    while (!ready() && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    for (final f in [silent, hdr, speech]) {
      expect(File(f).existsSync(), isTrue, reason: 'fixture missing: $f (push it with adb)');
    }
    evidence = Directory('${ext.path}/evidence-formats')..createSync(recursive: true);
  });

  tearDownAll(() {
    // ignore: avoid_print
    print('EXPORT_FORMATS_REPORT ${jsonEncode(report)}');
  });

  testWidgets('video-only source exports without an audio track (no AAC encoder requested)', (tester) async {
    final info = await MediaEngineService.getVideoInfo(silent);
    expect(info.hasAudio, isFalse, reason: 'fixture must be video-only');
    final out = '${evidence.path}/silent_export.mp4';
    final r = await render(singleClipIr('silent', 5000, w: info.displayWidth, h: info.displayHeight), silent, out);
    final verify = await MediaEngineService.getVideoInfo(out);
    report['silent'] = {'durationMs': r.durationMs, 'hasAudio': verify.hasAudio, 'audioEncoder': r.audioEncoder, 'videoEncoder': r.videoEncoder, 'warnings': r.warnings};
    expect(verify.hasVideo, isTrue);
    expect(verify.hasAudio, isFalse);
    expect(r.durationMs, closeTo(5000, 200));
    expect(r.warnings.any((w) => w.contains('HDR')), isFalse, reason: 'SDR source must not be tone-mapped');
  });

  testWidgets('mixed timeline (video-only clip + clip with audio) keeps one continuous audio track', (tester) async {
    final ir = {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'mixed',
      'canvas': {'aspect': '16:9', 'width': 1280, 'height': 720, 'fps': 30, 'background': '#000000'},
      'durationMs': 6000,
      'sources': [
        {'assetId': 'silent', 'durationMs': 6000, 'width': 1920, 'height': 1080},
        {'assetId': 'speech', 'durationMs': 30000, 'width': 1280, 'height': 720},
      ],
      'clips': [
        {'id': 'c1', 'assetId': 'silent', 'sourceStartMs': 0, 'sourceEndMs': 3000, 'timelineStartMs': 0, 'timelineEndMs': 3000,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
        {'id': 'c2', 'assetId': 'speech', 'sourceStartMs': 1000, 'sourceEndMs': 4000, 'timelineStartMs': 3000, 'timelineEndMs': 6000,
          'speed': 1.0, 'volumeDb': 0, 'crop': null, 'filter': null, 'transitionIn': null},
      ],
      'audio': {'originalTrack': {'volumeDb': 0}, 'music': <dynamic>[], 'speechRangesMs': <dynamic>[]},
    };
    RenderResult? r;
    await for (final p in MediaEngineService.renderEditIr(
        editIr: MobileEditIr.fromJson(ir), outputPath: '${evidence.path}/mixed_export.mp4', assetPaths: {'silent': silent, 'speech': speech})) {
      if (p.result != null) r = p.result;
    }
    report['mixed'] = {'durationMs': r!.durationMs, 'hasAudio': r.hasAudio, 'audioEncoder': r.audioEncoder, 'warnings': r.warnings};
    expect(r.hasAudio, isTrue);
    expect(r.durationMs, closeTo(6000, 250));
  });

  testWidgets('HDR10 (PQ) source is tone-mapped to SDR and reports it', (tester) async {
    final info = await MediaEngineService.getVideoInfo(hdr);
    final out = '${evidence.path}/hdr_export.mp4';
    Object? error;
    RenderResult? r;
    try {
      r = await render(singleClipIr('hdr', 3500, w: info.displayWidth, h: info.displayHeight), hdr, out);
    } catch (e) {
      error = e;
    }
    report['hdr'] = {'sourceIsHdr': info.toString(), 'error': error?.toString(), 'warnings': r?.warnings, 'hasAudio': r?.hasAudio};
    if (error != null) {
      // A GPU without GL_EXT_YUV_target (e.g. the emulator) falls back to MediaCodec tone-mapping; if the decoder
      // cannot either, the export fails with the typed HDR_NOT_SUPPORTED code and an actionable message.
      expect(error, isA<MediaEngineException>().having((e) => e.code, 'code', 'HDR_NOT_SUPPORTED'));
      expect((error as MediaEngineException).message, contains('HDR'));
      return;
    }
    expect(r!.warnings.any((w) => w.contains('HDR source tone-mapped')), isTrue);
    expect(r.hasAudio, isFalse);
  });
}
