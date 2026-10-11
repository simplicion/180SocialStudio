import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/network/api_client.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/core/network/device_registration.dart';
import 'package:social_studio_mobile/core/storage/key_value_store.dart';
import 'package:social_studio_mobile/core/storage/token_store.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/studio/studio_controller.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

import 'support/app_harness.dart' show signedInStore;
import 'support/fake_backend.dart';

// The channel name is being renamed on the native side; mock both so this test tracks either.
const _engines = [
  MethodChannel('com.workspace180.social_studio_mobile/media_engine'),
  MethodChannel('com.workspace180.socialmanager/media_engine'),
];
const _direct = '/api/v1/media-editor/ai-direct';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  late FakeBackend backend;
  late StudioController c;
  late File source;

  setUp(() async {
    Future<Object?> handler(MethodCall call) async {
      switch (call.method) {
        case 'getVideoInfo':
          return {
            'durationMs': 10000, 'width': 1920, 'height': 1080, 'rotation': 0,
            'displayWidth': 1920, 'displayHeight': 1080, 'hasVideo': true, 'hasAudio': true, 'frameRate': 30.0,
          };
        case 'detectSilences':
          return [
            {'startMs': 4000, 'endMs': 4800},
          ];
        default:
          // Transcription needs a real device (audio extraction + STT); it fails here and the
          // controller must degrade to "no transcript", never invent one.
          throw PlatformException(code: 'ENGINE_UNAVAILABLE', message: 'not in tests');
      }
    }

    for (final e in _engines) {
      messenger.setMockMethodCallHandler(e, handler);
    }
    source = File('${Directory.systemTemp.path}/studio_test_${DateTime.now().microsecondsSinceEpoch}.mp4')..writeAsBytesSync([0, 0, 0, 24]);
    backend = FakeBackend();
    final api = ApiClient(tokens: TokenStore(InMemoryKeyValueStore(signedInStore())), baseUrl: 'https://api.test', adapter: backend);
    final device = DeviceRegistration(api, platformOverride: 'android');
    c = StudioController(director: AiDirectorService(api, device), transcriber: AudioTranscriptionService(api, device), projectId: 'p1');
    await c.load(source.path);
    // Let the background silence detection / transcription attempts finish.
    for (var i = 0; i < 200 && (c.transcriptState == TranscriptState.running || c.silences == null); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    // The automatic opening greeting (projectId is set) must settle before a test's own turn.
    for (var i = 0; i < 200 && c.directorBusy; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  });

  tearDown(() {
    for (final e in _engines) {
      messenger.setMockMethodCallHandler(e, null);
    }
    c.dispose();
    if (source.existsSync()) source.deleteSync();
  });

  /// The director's answer: keep the first 5 s (a valid edit of the loaded timeline).
  Map<String, dynamic> directorAnswer({bool confirm = false, Map<String, dynamic>? editIR}) => {
        'success': true,
        'data': {
          'plannerSource': 'llm',
          'summary': 'Removed the second half',
          'reply': 'I cut everything after 0:05.',
          'operations': [
            {'op': 'remove_range', 'startMs': 5000, 'endMs': 10000},
          ],
          'appliedOperations': ['remove_range'],
          'rejectedOperations': [],
          'warnings': [],
          'requiresConfirmation': confirm,
          'editIR': editIR ?? TimelineOps.removeRange(c.ir!, 5000, 10000).toJson(),
        },
      };

  test('load builds the initial timeline and keeps on-device silences', () {
    expect(c.ir!.durationMs, 10000);
    expect(c.silences!.single.startMs, 4000);
    expect(c.transcriptState, TranscriptState.failed);
    expect(c.canUndo, isFalse);
  });

  test('an applied director edit replaces the timeline; undo/redo walk it back and forth', () async {
    backend.json('POST', _direct, directorAnswer());
    await c.askDirector('cut the second half');

    final req = backend.last('POST', _direct)!;
    expect(req.headers['x-device-token'], 'device-token-1');
    expect(req.json['prompt'], 'cut the second half');
    expect(req.json['projectId'], 'p1');
    expect((req.json['media'] as Map)['silences'], [
      {'startMs': 4000, 'endMs': 4800},
    ]);
    expect((req.json['currentEditIR'] as Map)['durationMs'], 10000);

    expect(c.ir!.durationMs, 5000);
    expect(c.messages.last.applied, isTrue);
    expect(c.messages.last.text, 'I cut everything after 0:05.');
    expect(c.directorBusy, isFalse);

    c.undo();
    expect(c.ir!.durationMs, 10000);
    expect(c.canRedo, isTrue);
    c.redo();
    expect(c.ir!.durationMs, 5000);
  });

  test('requiresConfirmation leaves the timeline alone until applyProposal', () async {
    backend.json('POST', _direct, directorAnswer(confirm: true));
    await c.askDirector('cut the second half');
    expect(c.ir!.durationMs, 10000);
    final idx = c.messages.length - 1;
    expect(c.messages[idx].applied, isFalse);

    c.applyProposal(idx);
    expect(c.ir!.durationMs, 5000);
    expect(c.messages[idx].applied, isTrue);

    c.applyProposal(idx); // applying twice is a no-op
    c.undo();
    expect(c.ir!.durationMs, 10000);
    expect(c.canUndo, isFalse);
  });

  test('the next turn sends the history and the edited timeline', () async {
    backend.json('POST', _direct, directorAnswer());
    await c.askDirector('cut the second half');
    backend.json('POST', _direct, directorAnswer(editIR: c.ir!.toJson()));
    await c.askDirector('now add captions');
    final req = backend.last('POST', _direct)!;
    expect(req.json['history'], [
      {'role': 'user', 'content': 'cut the second half'},
      {'role': 'assistant', 'content': 'I cut everything after 0:05.'},
    ]);
    expect((req.json['currentEditIR'] as Map)['durationMs'], 5000);
  });

  test('a server error is reported in the chat and changes nothing', () async {
    backend.fail('POST', _direct, 400, 'Prompt is too vague');
    await c.askDirector('do something');
    expect(c.ir!.durationMs, 10000);
    expect(c.canUndo, isFalse);
    expect(c.messages.last.fromUser, isFalse);
    expect(c.messages.last.text, contains('Prompt is too vague'));
    expect(c.directorBusy, isFalse);
  });

  test('an invalid timeline from the server is rejected, not applied', () async {
    final bad = TimelineOps.removeRange(c.ir!, 5000, 10000).toJson()..['durationMs'] = 9999;
    backend.json('POST', _direct, directorAnswer(editIR: bad));
    await c.askDirector('cut the second half');
    expect(c.ir!.durationMs, 10000);
    expect(c.messages.last.applied, isFalse);
    expect(c.messages.last.text, startsWith('I could not do that'));
  });

  test('an expired device token is renewed once and the turn retried', () async {
    var n = 0;
    backend.on('POST', _direct, (_) => ++n == 1
        ? FakeResponse.json({'success': false, 'error': 'DESKTOP_APP_REQUIRED', 'message': 'Device token expired'}, status: 403)
        : FakeResponse.json(directorAnswer()));
    backend.json('POST', '/api/desktop/devices/register',
        {'success': true, 'token': 'device-token-2', 'deviceId': 'dev1', 'expiresAt': DateTime.now().add(const Duration(days: 30)).toIso8601String()});
    await c.askDirector('cut the second half');
    expect(backend.calls('POST', '/api/desktop/devices/register'), hasLength(1));
    expect(backend.last('POST', _direct)!.headers['x-device-token'], 'device-token-2');
    expect(c.ir!.durationMs, 5000);
  });

  test('opening from a calendar piece greets with a brand-aware proposal that waits for Apply', () async {
    backend.json('POST', _direct, directorAnswer(confirm: true));
    final api = ApiClient(tokens: TokenStore(InMemoryKeyValueStore(signedInStore())), baseUrl: 'https://api.test', adapter: backend);
    final device = DeviceRegistration(api, platformOverride: 'android');
    final g = StudioController(
      director: AiDirectorService(api, device),
      transcriber: AudioTranscriptionService(api, device),
      projectId: 'p1',
      pieceId: 'piece-9',
    );
    addTearDown(g.dispose);
    await g.load(source.path);
    for (var i = 0; i < 200 && g.messages.isEmpty; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    final req = backend.last('POST', _direct)!;
    expect(req.json['intent'], 'greet');
    expect(req.json['calendarPieceId'], 'piece-9');
    expect(req.json['projectId'], 'p1');
    expect(req.json['prompt'], '');
    expect(g.messages.single.fromUser, isFalse);
    expect(g.messages.single.applied, isFalse, reason: 'a greeting proposal is never auto-applied');
    expect(g.ir!.durationMs, 10000);
    g.applyProposal(0);
    expect(g.ir!.durationMs, 5000);
  });

  test('a brand watermark from the director survives manual edits and round-trips', () async {
    final withLogo = TimelineOps.removeRange(c.ir!, 5000, 10000).toJson()
      ..['watermark'] = {'imageUrl': 'https://cdn.test/logo.png', 'position': 'bottom_right', 'opacityPct': 80, 'widthFraction': 0.12};
    backend.json('POST', _direct, directorAnswer(editIR: withLogo));
    await c.askDirector('add my logo');
    expect(c.ir!.watermark!.position, 'bottom_right');
    c.apply((ir) => TimelineOps.split(ir, 2000));
    c.apply((ir) => TimelineOps.setSpeed(ir, 2));
    expect(c.ir!.watermark!.imageUrl, 'https://cdn.test/logo.png');
    final json = c.ir!.toJson();
    expect((json['watermark'] as Map)['opacityPct'], 80);
    expect(c.ir!.withWatermark(null).toJson().containsKey('watermark'), isFalse);
  });
}
