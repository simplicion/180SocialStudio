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
  Map<String, dynamic> directorAnswer({bool confirm = false, Map<String, dynamic>? editIR, bool? autoApplied}) => {
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
          // The server decides what applies without asking (F-09); the phone follows it.
          'autoApplied': autoApplied ?? !confirm,
          'editIR': editIR ?? TimelineOps.removeRange(c.ir!, 5000, 10000).toJson(),
        },
      };

  Future<void> settle() async {
    for (var i = 0; i < 300 && c.directorBusy; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }

  test('F-01 a manual edit made while the Director is thinking is merged with its answer, not lost', () async {
    final gate = backend.hold('POST', _direct, directorAnswer());
    final turn = c.askDirector('cut the second half');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(c.directorBusy, isTrue);
    c.apply((ir) => TimelineOps.addText(ir, 'My hook', startMs: 1000, durationMs: 1500));
    gate.complete();
    await turn;
    await settle();
    expect(c.ir!.durationMs, 5000, reason: "the Director's cut");
    expect(c.ir!.captions.where((t) => t.text == 'My hook'), hasLength(1), reason: 'the manual title survives');
    expect(c.messages.any((m) => m.text.contains('on top of the edits you made')), isTrue);
  });

  test('F-02 applying a proposal after two manual edits keeps both edits', () async {
    backend.json('POST', _direct, directorAnswer(confirm: true));
    await c.askDirector('cut the second half');
    final idx = c.messages.lastIndexWhere((m) => m.response != null);
    c.apply((ir) => TimelineOps.addText(ir, 'Title', startMs: 500, durationMs: 1000));
    c.apply((ir) => TimelineOps.addZoom(ir, startMs: 1000, durationMs: 1200));
    c.applyProposal(idx);
    expect(c.ir!.durationMs, 5000);
    expect(c.ir!.captions.where((t) => t.text == 'Title'), hasLength(1));
    expect(c.ir!.zooms, hasLength(1));
    expect(c.messages[idx].applied, isTrue);
    c.undo();
    expect(c.ir!.durationMs, 10000, reason: 'one undo step takes the Director turn back');
    expect(c.ir!.zooms, hasLength(1), reason: '... and keeps the manual work');
  });

  test('F-02 both sides changed the cuts: nothing is applied until the creator chooses', () async {
    backend.json('POST', _direct, directorAnswer(confirm: true));
    await c.askDirector('cut the second half');
    final idx = c.messages.lastIndexWhere((m) => m.response != null);
    c.apply((ir) => TimelineOps.removeRange(ir, 0, 1000));
    final mine = c.ir;
    c.applyProposal(idx);
    expect(identical(c.ir, mine), isTrue);
    expect(c.messages[idx].structuralConflict, isTrue);
    expect(c.messages[idx].applied, isFalse);
    c.resolveDirectorConflict(idx, useDirectors: true);
    expect(c.ir!.durationMs, 5000);
    c.undo();
    expect(c.ir!.durationMs, 9000, reason: 'the creator keeps an undo back to their own cuts');
  });

  test('F-01 the request carries the timeline revision', () async {
    backend.json('POST', _direct, directorAnswer());
    final rev = c.revision;
    await c.askDirector('cut the second half');
    expect(backend.last('POST', _direct)!.json['baseRevision'], rev);
    expect(c.revision, greaterThan(rev));
  });

  test('F-09 the phone follows the server: not autoApplied means a proposal, even without requiresConfirmation', () async {
    backend.json('POST', _direct, directorAnswer(autoApplied: false));
    await c.askDirector('cut the second half');
    expect(c.ir!.durationMs, 10000);
    expect(c.messages.last.applied, isFalse);
  });

  test('Phase 7: an applied Director turn is reported, and undoing it within 30 s is reported as regret', () async {
    const feedback = '/api/v1/social-media/projects/p1/agent-memory/feedback';
    backend.json('POST', feedback, {'success': true, 'item': {}});
    final answer = directorAnswer();
    (answer['data'] as Map)['runId'] = 'run_42';
    backend.json('POST', _direct, answer);
    await c.askDirector('cut the second half');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final applied = backend.last('POST', feedback)!.json;
    expect(applied['accepted'], isTrue);
    expect(applied['runId'], 'run_42');
    c.undo();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final undone = backend.last('POST', feedback)!.json;
    expect(undone['accepted'], isFalse);
    expect(undone['summary'], contains('regret'));
  });

  test('F-21 items made by hand are marked manual and can be locked; the request carries it', () async {
    c.apply((ir) => TimelineOps.addText(ir, 'My hook', startMs: 0, durationMs: 1000));
    final id = c.ir!.captions.single.id;
    expect(c.ir!.itemMeta[id]?.origin, 'manual');
    c.toggleItemLock(id);
    expect(c.isItemLocked(id), isTrue);
    backend.json('POST', _direct, directorAnswer(editIR: c.ir!.toJson()));
    await c.askDirector('make it pop');
    final meta = (backend.last('POST', _direct)!.json['currentEditIR'] as Map)['itemMeta'] as Map;
    expect(meta[id], {'origin': 'manual', 'locked': true});
    c.undo(); // the lock is one undo step
    c.undo();
    expect(c.isItemLocked(id), isFalse);
  });

  test('F-16 history tells the Director which turns were applied, never applied, or undone', () async {
    backend.json('POST', _direct, directorAnswer());
    await c.askDirector('cut the second half'); // applied
    c.undo(); // ... then undone
    backend.json('POST', _direct, directorAnswer(confirm: true));
    await c.askDirector('cut it again'); // a proposal left unapplied
    backend.json('POST', _direct, directorAnswer(editIR: c.ir!.toJson()));
    await c.askDirector('what now?');
    final history = (backend.last('POST', _direct)!.json['history'] as List).cast<Map>();
    final assistant = history.where((t) => t['role'] == 'assistant').toList();
    expect(assistant.map((t) => t['status']), ['undone', 'proposed_not_applied']);
    expect(assistant.first['appliedOps'], ['remove_range']);
  });

  test('F-16 a redone Director turn counts as applied again', () async {
    backend.json('POST', _direct, directorAnswer());
    await c.askDirector('cut the second half');
    c.undo();
    c.redo();
    backend.json('POST', _direct, directorAnswer(editIR: c.ir!.toJson()));
    await c.askDirector('next');
    final history = (backend.last('POST', _direct)!.json['history'] as List).cast<Map>();
    expect(history.firstWhere((t) => t['role'] == 'assistant')['status'], 'applied');
  });

  test('F-03 music and SFX from the phone are asset references; plain-http links are refused', () {
    final music = c.localMediaSource('/storage/emulated/0/Music/song.m4a', label: 'song.m4a');
    c.apply((ir) => TimelineOps.setMusic(ir, source: music, title: 'song.m4a'));
    final src = c.ir!.toJson()['audio']['music'][0]['source'] as Map;
    expect(src['kind'], 'asset');
    expect(src.containsKey('path'), isFalse, reason: 'the server never sees a device path');
    expect(c.localOverlayPath(c.ir!.audio.music.single.source), '/storage/emulated/0/Music/song.m4a');

    final pop = c.localMediaSource('/storage/emulated/0/pop.wav');
    c.apply((ir) => TimelineOps.addSfx(ir, source: pop, startMs: 1000));
    expect(c.ir!.audio.sfx.single.durationMs, isNull, reason: 'the whole file plays (was cut to 2 s)');
    expect(c.ir!.audio.sfx.single.source['kind'], 'asset');

    expect(() => TimelineOps.setMusic(c.ir!, url: 'http://example.com/a.mp3'), throwsA(isA<Exception>()));
    expect(() => TimelineOps.addSfx(c.ir!, url: 'http://example.com/a.mp3', startMs: 0), throwsA(isA<Exception>()));
  });

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
      {'role': 'assistant', 'content': 'I cut everything after 0:05.', 'status': 'applied', 'appliedOps': ['remove_range']},
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

  test('a drag on the preview is one undo step back to where the text was before it', () {
    c.apply((ir) => TimelineOps.addText(ir, 'Hook', startMs: 0, durationMs: 2000, positionY: 0.2));
    final id = c.ir!.captions.single.id;
    double y() => (c.ir!.captions.single.style['positionY'] as num).toDouble();
    final before = y();

    c.beginLiveEdit();
    for (final v in [0.3, 0.4, 0.5]) {
      c.applyWithoutHistory((ir) => TimelineOps.updateCaptionPosition(ir, id, positionX: 0.5, positionY: v));
    }
    c.endLiveEdit();
    expect(y(), 0.5);

    c.undo();
    expect(y(), before, reason: 'undo restores the pre-drag position, not the last drag frame');
    c.undo();
    expect(c.ir!.captions, isEmpty);
    c.redo();
    c.redo();
    expect(y(), 0.5);

    // A gesture that changed nothing adds no undo step.
    c.beginLiveEdit();
    c.endLiveEdit();
    c.undo();
    expect(y(), before);
  });

  test('selecting a text, deleting it, and editing invalidate stale state', () {
    c.apply((ir) => TimelineOps.addText(ir, 'Hook', startMs: 0, durationMs: 2000));
    final id = c.ir!.captions.single.id;
    c.selectTrackItem(id, TrackKind.text);
    expect(c.selectedCaption?.id, id);
    c.clearItemSelection();
    expect(c.selectedCaption, isNull);

    c.selectTrackItem(id, TrackKind.text);
    c.apply((ir) => TimelineOps.removeCaption(ir, id));
    expect(c.selectedItemId, isNull, reason: 'a deleted item is no longer selected');

    // A finished export is dropped once the timeline changes, so the sheet renders the new edit.
    c.export = ExportState(error: Exception('old'));
    c.apply((ir) => TimelineOps.split(ir, 5000));
    expect(c.export, isNull);
    expect(c.ir!.clips, hasLength(2));
  });

  test('a failed director turn is friendly, keeps the raw error, and Try again does not duplicate the message', () async {
    backend.fail('POST', _direct, 503, 'upstream exploded');
    await c.askDirector('cut the second half');
    final failed = c.messages.last;
    expect(failed.failed, isTrue);
    expect(failed.error, isNotNull);
    expect(failed.text, startsWith('I could not do that:'));
    expect(failed.text, isNot(contains('Exception')));

    backend.json('POST', _direct, directorAnswer());
    await c.retryLastDirectorTurn();
    expect(c.messages.where((m) => m.fromUser).map((m) => m.text), ['cut the second half']);
    expect(c.messages.any((m) => m.failed), isFalse);
    expect(c.ir!.durationMs, 5000);
    // The failed attempt is not sent to the director as conversation history.
    expect(backend.last('POST', _direct)!.json['history'], isEmpty);
  });
}
