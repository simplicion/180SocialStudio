import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';
import 'package:social_studio_mobile/core/network/api_client.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/core/network/device_registration.dart';
import 'package:social_studio_mobile/core/storage/key_value_store.dart';
import 'package:social_studio_mobile/core/storage/token_store.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/studio/clip_analysis.dart';
import 'package:social_studio_mobile/features/studio/studio_controller.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

import 'support/app_harness.dart' show signedInStore;
import 'support/fake_backend.dart';

/// Editor overhaul Phase 4: every clip is analysed (F-10) and added clips are framed like the first (F-11).
const _engines = [
  MethodChannel('com.workspace180.social_studio_mobile/media_engine'),
  MethodChannel('com.workspace180.socialmanager/media_engine'),
];
const _direct = '/api/v1/media-editor/ai-direct';

TranscriptWord w(String t, int s) => TranscriptWord(text: t, startMs: s, endMs: s + 300);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  group('TimelineOps', () {
    test('speech ranges come from the words of every source', () {
      var ir = TimelineOps.initial(projectId: 'p', durationMs: 4000, width: 1080, height: 1920);
      ir = TimelineOps.addTimelineClip(ir, assetId: 'take2', durationMs: 4000, width: 1080, height: 1920);
      final ranges = TimelineOps.speechRangesAll({
        'primary': [w('hi', 500)],
        'take2': [w('second', 1000)],
      }, ir);
      expect(ranges.length, 2);
      expect(ranges[1][0], 5000, reason: "take2's word at 1.0 s plays at 5.0 s on the timeline");
      expect(TimelineOps.speechRanges([w('hi', 500)], ir).length, 1, reason: 'the primary-only form still works');
    });

    test('F-11: an added clip is framed like the first (display size, fill crop, speaker focus)', () {
      final ir = TimelineOps.initial(projectId: 'p', durationMs: 4000, width: 1080, height: 1920);
      final landscape = TimelineOps.addTimelineClip(ir, assetId: 'wide', durationMs: 4000, width: 1920, height: 1080, focus: (x: 0.8, y: 0.4));
      final crop = landscape.clips.last.crop!;
      expect(crop.height, 1);
      expect((crop.x + crop.width / 2 - 0.8).abs() < 0.02 || crop.x + crop.width >= 0.999, isTrue, reason: 'centred on the speaker');
      final portrait = TimelineOps.addTimelineClip(ir, assetId: 'tall', durationMs: 4000, width: 1080, height: 1920);
      expect(portrait.clips.last.crop, isNull, reason: 'portrait footage already fills a 9:16 canvas');
    });
  });

  test('ClipAnalysis becomes the request form for its asset, with its own words', () {
    final a = ClipAnalysis(path: '/x.mp4', info: VideoMetadata(durationMs: 4000, width: 1920, height: 1080, rotation: 90, displayWidth: 1080, displayHeight: 1920, hasVideo: true, hasAudio: true))
      ..transcript = Transcript(language: 'en', durationMs: 4000, text: 'so um yes', words: [w('so', 0), w('um', 400), w('yes', 800)]);
    final j = a.toAnalysis('take2')!.toJson();
    expect(j['assetId'], 'take2');
    expect([j['width'], j['height']], [1080, 1920], reason: 'display size');
    expect(((j['transcript'] as Map)['words'] as List).map((x) => (x as Map)['text']), ['so', 'um', 'yes']);
  });

  group('StudioController', () {
    late FakeBackend backend;
    late StudioController c;
    late File primary;
    late File second;

    setUp(() async {
      primary = File('${Directory.systemTemp.path}/p4_primary_${DateTime.now().microsecondsSinceEpoch}.mp4')..writeAsBytesSync([0, 0, 0, 24]);
      second = File('${Directory.systemTemp.path}/p4_second_${DateTime.now().microsecondsSinceEpoch}.mp4')..writeAsBytesSync([0, 0, 0, 24, 1]);
      Future<Object?> handler(MethodCall call) async {
        final path = (call.arguments as Map?)?['sourcePath'];
        switch (call.method) {
          case 'getVideoInfo':
            // The second clip is portrait phone footage stored rotated (coded 1920x1080, shown 1080x1920).
            return path == second.path
                ? {'durationMs': 3000, 'width': 1920, 'height': 1080, 'rotation': 90, 'displayWidth': 1080, 'displayHeight': 1920, 'hasVideo': true, 'hasAudio': true, 'frameRate': 30.0}
                : {'durationMs': 5000, 'width': 1080, 'height': 1920, 'rotation': 0, 'displayWidth': 1080, 'displayHeight': 1920, 'hasVideo': true, 'hasAudio': true, 'frameRate': 30.0};
          case 'detectSilences':
            return path == second.path
                ? [{'startMs': 1000, 'endMs': 1800}]
                : [{'startMs': 4000, 'endMs': 4800}];
          default:
            throw PlatformException(code: 'ENGINE_UNAVAILABLE', message: 'not in tests');
        }
      }

      for (final e in _engines) {
        messenger.setMockMethodCallHandler(e, handler);
      }
      backend = FakeBackend();
      final api = ApiClient(tokens: TokenStore(InMemoryKeyValueStore(signedInStore())), baseUrl: 'https://api.test', adapter: backend);
      final device = DeviceRegistration(api, platformOverride: 'android');
      c = StudioController(director: AiDirectorService(api, device), transcriber: AudioTranscriptionService(api, device));
      await c.load(primary.path);
      for (var i = 0; i < 200 && c.transcriptState == TranscriptState.running; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
    });

    tearDown(() {
      for (final e in _engines) {
        messenger.setMockMethodCallHandler(e, null);
      }
      c.dispose();
      for (final f in [primary, second]) {
        if (f.existsSync()) f.deleteSync();
      }
    });

    Future<void> settle() async {
      for (var i = 0; i < 300 && (c.clipAnalyses.values.any((a) => a.pending) || c.directorBusy); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
    }

    test('F-11 + F-10: an added rotated clip is registered portrait and analysed; the Director gets its analysis', () async {
      await c.addVideoClip(second.path);
      final added = c.ir!.clips.last;
      final src = c.ir!.sources.firstWhere((s) => s.assetId == added.assetId);
      expect([src.width, src.height], [1080, 1920], reason: 'display size, not the coded 1920x1080');
      await settle();
      final a = c.clipAnalyses[added.assetId]!;
      expect(a.silences!.single.startMs, 1000, reason: "the added clip's own silences");
      expect(a.transcriptState, TranscriptState.failed, reason: 'no transcription engine here: reported, never guessed');

      backend.json('POST', _direct, {
        'success': true,
        'data': {'plannerSource': 'llm', 'summary': 'ok', 'reply': 'ok', 'appliedOperations': [], 'autoApplied': false, 'editIR': c.ir!.toJson()},
      });
      await c.askDirector('remove the pauses');
      final body = backend.last('POST', _direct)!.json;
      final list = (body['mediaList'] as List).cast<Map>();
      expect(list.single['assetId'], added.assetId);
      expect(list.single['silences'], [{'startMs': 1000, 'endMs': 1800}]);
      expect(body.containsKey('analysisPending'), isFalse, reason: 'nothing is still running');
    });

    test('the same file added twice is analysed once', () async {
      await c.addVideoClip(second.path);
      await c.addVideoClip(second.path);
      final ids = c.ir!.clips.skip(1).map((x) => x.assetId).toList();
      expect(ids.toSet().length, 2);
      expect(identical(c.clipAnalyses[ids[0]], c.clipAnalyses[ids[1]]), isTrue);
      await settle();
    });
  });
}
