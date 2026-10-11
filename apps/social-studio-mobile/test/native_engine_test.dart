import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';

const _method = MethodChannel('com.workspace180.socialmanager/media_engine');
const _events = EventChannel('com.workspace180.socialmanager/media_engine/render_events');

Map<String, dynamic> sampleIrJson() => {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'p1',
      'canvas': {'aspect': '9:16', 'width': 1080, 'height': 1920, 'fps': 30, 'background': '#000000'},
      'durationMs': 6000,
      'sources': [
        {'assetId': 'primary', 'durationMs': 30000, 'width': 1280, 'height': 720},
      ],
      'clips': [
        {
          'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 3000, 'timelineStartMs': 0, 'timelineEndMs': 3000,
          'speed': 1.0, 'volumeDb': 0, 'crop': {'x': 0.34, 'y': 0, 'width': 0.32, 'height': 1}, 'filter': null, 'transitionIn': null,
        },
        {
          'id': 'c2', 'assetId': 'primary', 'sourceStartMs': 5000, 'sourceEndMs': 11000, 'timelineStartMs': 3000, 'timelineEndMs': 6000,
          'speed': 2.0, 'volumeDb': -3, 'crop': null, 'filter': {'preset': 'VIVID', 'brightness': 1.1, 'contrast': 1, 'saturation': 1},
          'transitionIn': {'type': 'CROSSFADE', 'durationMs': 300},
        },
      ],
      'overlays': [
        {'id': 'b1', 'kind': 'broll', 'timelineStartMs': 1000, 'timelineEndMs': 2000, 'sourceStartMs': 0,
          'source': {'kind': 'url', 'url': 'https://example.invalid/b.mp4'}, 'fit': 'cover', 'opacity': 1, 'muted': true},
      ],
      'captions': [
        {
          'id': 't1', 'kind': 'caption', 'startMs': 0, 'endMs': 1200, 'text': 'hello there',
          'words': [
            {'text': 'hello', 'startMs': 0, 'endMs': 600, 'highlight': true, 'color': '#FFE600', 'scale': 1.2},
            {'text': 'there', 'startMs': 600, 'endMs': 1200},
          ],
          'style': {'animation': 'word_pop', 'fontSizePx': 72, 'positionX': 0.5, 'positionY': 0.72},
        },
      ],
      'zooms': [
        {'id': 'z1', 'startMs': 4000, 'endMs': 5000, 'scale': 1.3, 'centerX': 0.5, 'centerY': 0.4, 'rampMs': 250},
      ],
      'audio': {
        'originalTrack': {'volumeDb': 0},
        'music': [
          {'id': 'm1', 'timelineStartMs': 0, 'timelineEndMs': 6000, 'sourceStartMs': 0, 'source': {'kind': 'stock_query', 'query': 'upbeat', 'url': null},
            'volumeDb': -16, 'fadeInMs': 500, 'fadeOutMs': 1000, 'duck': {'enabled': true, 'duckDb': -12, 'attackMs': 120, 'releaseMs': 350}},
        ],
        'speechRangesMs': [
          [0, 2500],
          [3200, 5800],
        ],
      },
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() {
    messenger.setMockMethodCallHandler(_method, null);
    messenger.setMockStreamHandler(_events, null);
  });

  group('MobileEditIr model', () {
    test('parses the contract example and round-trips through toJson', () {
      final ir = MobileEditIr.fromJson(sampleIrJson());
      expect(ir.clips, hasLength(2));
      expect(ir.clips[1].speed, 2.0);
      expect(ir.clips[1].transitionIn!.durationMs, 300);
      expect(ir.captions.single.words.first.color, '#FFE600');
      expect(ir.audio.music.single.duck!.duckDb, -12);
      expect(ir.audio.speechRangesMs[1], [3200, 5800]);
      ir.validate();

      final again = MobileEditIr.fromJson(ir.toJson());
      expect(again.toJson(), ir.toJson());
    });

    test('rejects an unknown schema version', () {
      final j = sampleIrJson()..['schemaVersion'] = 'mobile-editir/2';
      expect(() => MobileEditIr.fromJson(j), throwsA(isA<MediaEngineException>().having((e) => e.code, 'code', 'UNSUPPORTED_SCHEMA')));
    });

    test('rejects non-contiguous clips and speed/duration mismatch', () {
      final gap = sampleIrJson();
      (gap['clips'] as List)[1]['timelineStartMs'] = 3100;
      expect(() => MobileEditIr.fromJson(gap).validate(), throwsA(isA<MediaEngineException>()));

      final speed = sampleIrJson();
      (speed['clips'] as List)[1]['speed'] = 1.0;
      expect(() => MobileEditIr.fromJson(speed).validate(), throwsA(isA<MediaEngineException>()));
    });

    test('missing required field is a typed error, not a default', () {
      final j = sampleIrJson();
      (j['clips'] as List)[0].remove('sourceEndMs');
      expect(() => MobileEditIr.fromJson(j), throwsA(isA<MediaEngineException>().having((e) => e.code, 'code', 'INVALID_EDIT_IR')));
    });
  });

  group('MediaEngineService channel contract', () {
    test('native errors surface as MediaEngineException with the native code', () async {
      messenger.setMockMethodCallHandler(_method, (call) async {
        throw PlatformException(code: 'NO_AUDIO_TRACK', message: 'No audio track in x.mp4');
      });
      await expectLater(
        MediaEngineService.extractAudio(sourcePath: 'x.mp4', destPath: 'x.wav'),
        throwsA(isA<MediaEngineException>().having((e) => e.code, 'code', 'NO_AUDIO_TRACK')),
      );
    });

    test('extractAudio picks the format from the extension and returns typed details', () async {
      MethodCall? seen;
      messenger.setMockMethodCallHandler(_method, (call) async {
        seen = call;
        return {'path': 'a.wav', 'format': 'wav', 'sampleRate': 16000, 'channels': 1, 'durationMs': 30000, 'fileSizeBytes': 960044};
      });
      final a = await MediaEngineService.extractAudio(sourcePath: 'v.mp4', destPath: 'a.wav');
      expect(seen!.arguments['format'], 'wav');
      expect(a.format, SttAudioFormat.wav);
      expect(a.sampleRate, 16000);
      expect(a.channels, 1);
    });

    test('getVideoInfo maps display size and track presence', () async {
      messenger.setMockMethodCallHandler(_method, (call) async => {
            'durationMs': 30090, 'width': 1280, 'height': 720, 'rotation': 90,
            'displayWidth': 720, 'displayHeight': 1280, 'hasVideo': true, 'hasAudio': true, 'frameRate': 29.97,
          });
      final info = await MediaEngineService.getVideoInfo('v.mp4');
      expect(info.displayWidth, 720);
      expect(info.displayHeight, 1280);
      expect(info.hasAudio, isTrue);
    });

    test('renderEditIr streams progress then a verified result', () async {
      MethodCall? renderCall;
      messenger.setMockMethodCallHandler(_method, (call) async {
        renderCall = call;
        return call.arguments['jobId'];
      });
      messenger.setMockStreamHandler(
        _events,
        MockStreamHandler.inline(onListen: (args, sink) {
          Future<void>(() async {
            // Wait until the render call has been made so we know the job id.
            while (renderCall == null) {
              await Future<void>.delayed(const Duration(milliseconds: 1));
            }
            final id = renderCall!.arguments['jobId'];
            sink.success({'jobId': 'other-job', 'state': 'progress', 'progress': 0.9});
            sink.success({'jobId': id, 'state': 'started', 'progress': 0.0});
            sink.success({'jobId': id, 'state': 'progress', 'progress': 0.5});
            sink.success({
              'jobId': id, 'state': 'completed', 'progress': 1.0, 'outputPath': '/out.mp4', 'durationMs': 6010,
              'expectedDurationMs': 6000, 'width': 1080, 'height': 1920, 'hasAudio': true, 'fileSizeBytes': 1234,
              'warnings': ['font Inter 800 not supplied; system sans-serif used'],
            });
          });
        }),
      );

      final events = await MediaEngineService.renderEditIr(
        editIr: MobileEditIr.fromJson(sampleIrJson()),
        outputPath: '/out.mp4',
        assetPaths: {'primary': '/src.mp4'},
        overlayPaths: {'b1': '/b.mp4'},
        musicPaths: {'m1': '/m.mp3'},
        jobId: 'job-1',
      ).toList();

      expect(renderCall!.method, 'renderEditIr');
      expect(renderCall!.arguments['assetPaths'], {'primary': '/src.mp4'});
      expect(renderCall!.arguments['editIrJson'], contains('mobile-editir/1'));
      expect(events.map((e) => e.state), [RenderState.started, RenderState.progress, RenderState.completed]);
      final result = events.last.result!;
      expect(result.width, 1080);
      expect(result.height, 1920);
      expect(result.warnings, hasLength(1));
    });

    test('renderEditIr turns a native failure event into a stream error', () async {
      messenger.setMockMethodCallHandler(_method, (call) async => call.arguments['jobId']);
      messenger.setMockStreamHandler(
        _events,
        MockStreamHandler.inline(onListen: (args, sink) {
          Future<void>.delayed(const Duration(milliseconds: 5), () {
            sink.success({'jobId': 'job-2', 'state': 'failed', 'errorCode': 'MISSING_MEDIA', 'message': 'No local file for overlay b1'});
          });
        }),
      );
      final stream = MediaEngineService.renderEditIr(
        editIr: MobileEditIr.fromJson(sampleIrJson()),
        outputPath: '/out.mp4',
        assetPaths: {'primary': '/src.mp4'},
        jobId: 'job-2',
      );
      await expectLater(stream, emitsError(isA<MediaEngineException>().having((e) => e.code, 'code', 'MISSING_MEDIA')));
    });

    test('detectSilences sends the arguments and returns typed ranges', () async {
      MethodCall? seen;
      messenger.setMockMethodCallHandler(_method, (call) async {
        seen = call;
        return [
          {'startMs': 0, 'endMs': 820},
          {'startMs': 4100, 'endMs': 4760},
          {'startMs': 28900, 'endMs': 30090},
        ];
      });
      final ranges = await MediaEngineService.detectSilences(sourcePath: 'v.mp4', minSilenceMs: 600, thresholdDb: -35);
      expect(seen!.method, 'detectSilences');
      expect(seen!.arguments, {'sourcePath': 'v.mp4', 'minSilenceMs': 600, 'thresholdDb': -35.0});
      expect(ranges, hasLength(3));
      expect(ranges.first, (startMs: 0, endMs: 820));
      expect(ranges.last.endMs, 30090);
    });

    test('detectSilences uses 500 ms / -40 dB by default and passes an empty result through', () async {
      MethodCall? seen;
      messenger.setMockMethodCallHandler(_method, (call) async {
        seen = call;
        return <Object?>[]; // e.g. a source with no audio track
      });
      final ranges = await MediaEngineService.detectSilences(sourcePath: 'silent.mp4');
      expect(seen!.arguments['minSilenceMs'], 500);
      expect(seen!.arguments['thresholdDb'], -40.0);
      expect(ranges, isEmpty);
    });

    test('detectFaces sends the sample interval and returns typed face samples', () async {
      MethodCall? seen;
      messenger.setMockMethodCallHandler(_method, (call) async {
        seen = call;
        return [
          {'tMs': 0, 'x': 0.7, 'y': 0.35, 'w': 0.12, 'h': 0.2},
          {'tMs': 500, 'x': 0.71, 'y': 0.36, 'w': 0.12, 'h': 0.21},
        ];
      });
      final faces = await MediaEngineService.detectFaces(sourcePath: 'v.mp4');
      expect(seen!.method, 'detectFaces');
      expect(seen!.arguments, {'sourcePath': 'v.mp4', 'sampleEveryMs': 500});
      expect(faces, hasLength(2));
      expect(faces.last.tMs, 500);
      expect(faces.first.toJson(), {'tMs': 0, 'x': 0.7, 'y': 0.35, 'w': 0.12, 'h': 0.2});
    });

    test('detectBeats returns beat times and bpm; errors keep their code', () async {
      MethodCall? seen;
      messenger.setMockMethodCallHandler(_method, (call) async {
        seen = call;
        return {'beatsMs': [480, 980, 1480], 'bpm': 120.0};
      });
      final r = await MediaEngineService.detectBeats(audioPath: 'song.m4a');
      expect(seen!.method, 'detectBeats');
      expect(seen!.arguments, {'audioPath': 'song.m4a'});
      expect(r.beatsMs, [480, 980, 1480]);
      expect(r.bpm, 120.0);

      messenger.setMockMethodCallHandler(_method, (call) async => {'beatsMs': <int>[], 'bpm': null});
      final none = await MediaEngineService.detectBeats(audioPath: 'silent.mp4');
      expect(none.beatsMs, isEmpty);
      expect(none.bpm, isNull);

      messenger.setMockMethodCallHandler(_method, (call) async => throw PlatformException(code: 'DECODE_FAILED', message: 'bad'));
      await expectLater(MediaEngineService.detectBeats(audioPath: 'x'), throwsA(isA<MediaEngineException>().having((e) => e.code, 'code', 'DECODE_FAILED')));
    });

    test('detectSilences surfaces native errors with their code', () async {
      messenger.setMockMethodCallHandler(_method, (call) async {
        throw PlatformException(code: 'FILE_NOT_FOUND', message: 'File not found: gone.mp4');
      });
      await expectLater(
        MediaEngineService.detectSilences(sourcePath: 'gone.mp4'),
        throwsA(isA<MediaEngineException>().having((e) => e.code, 'code', 'FILE_NOT_FOUND')),
      );
    });

    test('renderEditIr reports INSUFFICIENT_STORAGE as a distinct error code', () async {
      messenger.setMockMethodCallHandler(_method, (call) async => call.arguments['jobId']);
      messenger.setMockStreamHandler(
        _events,
        MockStreamHandler.inline(onListen: (args, sink) {
          Future<void>.delayed(const Duration(milliseconds: 5), () {
            sink.success({
              'jobId': 'job-4', 'state': 'failed', 'errorCode': 'INSUFFICIENT_STORAGE',
              'message': 'Not enough free storage to export: about 180 MB needed, 40 MB available.',
            });
          });
        }),
      );
      final stream = MediaEngineService.renderEditIr(
        editIr: MobileEditIr.fromJson(sampleIrJson()),
        outputPath: '/out.mp4',
        assetPaths: {'primary': '/src.mp4'},
        jobId: 'job-4',
      );
      await expectLater(stream, emitsError(isA<MediaEngineException>().having((e) => e.code, 'code', 'INSUFFICIENT_STORAGE')));
    });

    test('renderEditIr rejects an invalid timeline before calling native code', () async {
      var called = false;
      messenger.setMockMethodCallHandler(_method, (call) async {
        called = true;
        return null;
      });
      final j = sampleIrJson()..['durationMs'] = 9999;
      final stream = MediaEngineService.renderEditIr(editIr: MobileEditIr.fromJson(j), outputPath: '/o.mp4', assetPaths: {'primary': '/s.mp4'});
      await expectLater(stream, emitsError(isA<MediaEngineException>().having((e) => e.code, 'code', 'INVALID_EDIT_IR')));
      expect(called, isFalse);
    });

    test('cancelling the subscription cancels the native job', () async {
      final calls = <String>[];
      messenger.setMockMethodCallHandler(_method, (call) async {
        calls.add(call.method);
        return call.method == 'cancelRender' ? true : call.arguments['jobId'];
      });
      messenger.setMockStreamHandler(
        _events,
        MockStreamHandler.inline(onListen: (args, sink) {
          Future<void>.delayed(const Duration(milliseconds: 5), () => sink.success({'jobId': 'job-3', 'state': 'progress', 'progress': 0.1}));
        }),
      );
      final stream = MediaEngineService.renderEditIr(
        editIr: MobileEditIr.fromJson(sampleIrJson()),
        outputPath: '/o.mp4',
        assetPaths: {'primary': '/s.mp4'},
        jobId: 'job-3',
      );
      final first = await stream.first; // `first` cancels the subscription after one event.
      expect(first.progress, closeTo(0.1, 1e-9));
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(calls, containsAllInOrder(['renderEditIr', 'cancelRender']));
    });
  });
}
