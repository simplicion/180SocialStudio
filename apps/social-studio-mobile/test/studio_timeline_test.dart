import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/media/asset_cache.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/core/network/api_client.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/core/network/device_registration.dart';
import 'package:social_studio_mobile/core/storage/key_value_store.dart';
import 'package:social_studio_mobile/core/storage/token_store.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/studio/studio_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:social_studio_mobile/core/providers.dart';
import 'package:social_studio_mobile/features/studio/studio_tools.dart';
import 'package:social_studio_mobile/features/studio/studio_timeline.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

import 'support/app_harness.dart' show signedInStore;
import 'support/fake_backend.dart';

// The channel name is being renamed on the native side; mock both so this test tracks either.
const _engines = [
  MethodChannel('com.workspace180.social_studio_mobile/media_engine'),
  MethodChannel('com.workspace180.socialmanager/media_engine'),
];

void main() {
  // Widget tests cannot reach the network: online assets "download" to a placeholder path instantly.
  setUpAll(() => AssetCache.instance.fetchOverride = (url, kind) async => '${Directory.systemTemp.path}/asset_${url.hashCode}');
  tearDownAll(() => AssetCache.instance.fetchOverride = null);

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
  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(useMaterial3: true),
      home: Scaffold(
        body: ListenableBuilder(
          listenable: c,
          builder: (_, _) => Column(children: [
            const Spacer(),
            StudioTimeline(controller: c, onScrub: c.seek, onEdit: (op, {done}) => c.apply(op), onOpenTool: (_) {}),
          ]),
        ),
      ),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('every placed item gets its own track; tapping a sound effect opens its inspector and can delete it', (tester) async {
    c.apply((ir) => TimelineOps.addSfx(ir, url: 'https://cdn.test/whoosh.mp3', startMs: 2000, durationMs: 800, credit: 'Whoosh'));
    c.apply((ir) => TimelineOps.addText(ir, 'Hello', startMs: 5000, durationMs: 2000));
    await pump(tester);
    expect(find.byTooltip('Sound FX'), findsOneWidget);
    expect(find.byTooltip('Text'), findsOneWidget);
    expect(find.byTooltip('Music'), findsNothing, reason: 'empty tracks are hidden');

    await tester.tap(find.bySemanticsLabel(RegExp('^Sound FX: Whoosh')));
    await tester.pumpAndSettle();
    expect(find.text('To playhead'), findsOneWidget);
    await tester.tap(find.text('Delete sound fx'));
    await tester.pumpAndSettle();
    expect(c.ir!.audio.sfx, isEmpty);
    expect(find.byTooltip('Sound FX'), findsNothing);
  });

  testWidgets('text inspector restyles with a template and nudges timing', (tester) async {
    c.apply((ir) => TimelineOps.addText(ir, 'Hello', startMs: 5000, durationMs: 2000));
    await pump(tester);
    await tester.tap(find.bySemanticsLabel(RegExp('^Text: Hello')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('0.5 s →'));
    await tester.pumpAndSettle();
    expect(c.ir!.captions.single.startMs, 5500);

    await tester.tap(find.bySemanticsLabel(RegExp('^Text: Hello')));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Big number'), 100, scrollable: find.byType(Scrollable).last);
    await tester.tap(find.text('Big number'));
    await tester.pumpAndSettle();
    expect(c.ir!.captions.single.style['preset'], 'TPL_BIG_NUMBER');
  });

  testWidgets('long-press drag moves a text item and shows a time tooltip, committed once on release', (tester) async {
    c.apply((ir) => TimelineOps.addText(ir, 'Hello', startMs: 2000, durationMs: 1000));
    await pump(tester);
    final block = find.bySemanticsLabel(RegExp('^Text: Hello'));
    final gesture = await tester.startGesture(tester.getCenter(block));
    await tester.pump(const Duration(milliseconds: 600)); // past the long-press timeout
    await gesture.moveBy(const Offset(60, 0));
    await tester.pump();
    expect(find.byKey(const Key('timeline-drag-tooltip')), findsOneWidget);
    expect(c.ir!.captions.single.startMs, 2000, reason: 'nothing is committed while dragging');
    await gesture.up();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-drag-tooltip')), findsNothing);
    final cap = c.ir!.captions.single;
    expect(cap.startMs, greaterThan(2000));
    expect(cap.endMs - cap.startMs, 1000, reason: 'moving keeps the length');
    expect(c.canUndo, isTrue);
  });

  testWidgets('selected item shows trim handles; dragging the end handle trims it', (tester) async {
    c.apply((ir) => TimelineOps.addSfx(ir, url: 'https://cdn.test/whoosh.mp3', startMs: 2000, durationMs: 2000, credit: 'Whoosh'));
    await pump(tester);
    final id = c.ir!.audio.sfx.single.id;
    expect(find.byKey(Key('trim-end-$id')), findsNothing);
    await tester.tap(find.bySemanticsLabel(RegExp('^Sound FX: Whoosh')));
    await tester.pumpAndSettle();
    Navigator.of(tester.element(find.text('To playhead'))).pop(); // close the inspector
    await tester.pumpAndSettle();
    await tester.drag(find.byKey(Key('trim-end-$id')), const Offset(-40, 0));
    await tester.pumpAndSettle();
    final sfx = c.ir!.audio.sfx.single;
    expect(sfx.timelineStartMs, 2000);
    expect(sfx.durationMs, lessThan(2000));
    expect(sfx.durationMs, greaterThanOrEqualTo(300));
  });

  testWidgets('track headers mute and unmute Voice, Music and Sound FX', (tester) async {
    c.apply((ir) => TimelineOps.setMusic(ir, url: 'https://cdn.test/m.mp3', volumeDb: -12));
    c.apply((ir) => TimelineOps.addSfx(ir, url: 'https://cdn.test/whoosh.mp3', startMs: 2000, volumeDb: -5));
    c.apply((ir) => TimelineOps.setOriginalVolume(ir, -3));
    await pump(tester);
    if (c.ir!.audio.speechRangesMs.isEmpty) {
      expect(find.bySemanticsLabel('Mute Voice'), findsNothing, reason: 'no speech ranges, no voice row');
    }
    await tester.tap(find.bySemanticsLabel('Mute Music'));
    await tester.pumpAndSettle();
    expect(c.ir!.audio.music.single.volumeDb, TimelineOps.mutedDb);
    expect(find.bySemanticsLabel('Unmute Music'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Mute Sound FX'));
    await tester.pumpAndSettle();
    expect(c.ir!.audio.sfx.single.volumeDb, TimelineOps.mutedDb);
    await tester.tap(find.bySemanticsLabel('Unmute Music'));
    await tester.tap(find.bySemanticsLabel('Unmute Sound FX'));
    await tester.pumpAndSettle();
    expect(c.ir!.audio.music.single.volumeDb, -12);
    expect(c.ir!.audio.sfx.single.volumeDb, -5);
    expect(c.ir!.audio.originalVolumeDb, -3);
  });

  testWidgets('Voice row appears with speech ranges and mutes the original audio', (tester) async {
    c.apply((ir) => MobileEditIr.fromJson({
          ...ir.toJson(),
          'audio': {
            ...ir.audio.toJson(),
            'speechRangesMs': [
              [1000, 3000],
            ],
          },
        }));
    await pump(tester);
    await tester.tap(find.bySemanticsLabel('Mute Voice'));
    await tester.pumpAndSettle();
    expect(c.ir!.audio.originalVolumeDb, TimelineOps.mutedDb);
    expect(find.bySemanticsLabel('Unmute Voice'), findsOneWidget);
    c.undo();
    await tester.pumpAndSettle();
    expect(c.ir!.audio.originalVolumeDb, 0);
  });

  testWidgets('Captions sheet shows every preset as a sample and applies one to all captions', (tester) async {
    c.apply((ir) => TimelineOps.autoCaptions(ir, [
          TranscriptWord(text: 'hello', startMs: 500, endMs: 900),
          TranscriptWord(text: 'world', startMs: 900, endMs: 1300),
        ]));
    tester.view.physicalSize = const Size(400, 860);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(useMaterial3: true),
      home: Builder(
        builder: (ctx) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showStudioTool(ctx, StudioTool.captions, c, onEdit: (op, {done}) => c.apply(op)),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.byType(CaptionPresetCard), findsWidgets);
    final hormozi = find.bySemanticsLabel(RegExp('^Caption style Hormozi Viral'));
    await tester.dragUntilVisible(hormozi, find.byType(ListView), const Offset(-120, 0));
    await tester.tap(hormozi);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply to all captions'));
    await tester.pumpAndSettle();
    expect(c.ir!.captions.map((x) => (x.style['preset'], x.style['fontFamily'], x.style['highlightColor'])).toSet(),
        {('HORMOZI_BOUNCE', 'Anton', '#22C55E')});
  });

  testWidgets('Library: search sound effects and add one at the playhead with its credit', (tester) async {
    backend.json('GET', '/api/v1/media-editor/stock/unified', {
      'success': true,
      'unifiedAudio': [
        {'id': 's1', 'url': 'https://cdn.test/whoosh.mp3', 'title': 'Fast whoosh', 'durationSec': 0.8, 'provider': 'freesound', 'kind': 'sfx', 'attribution': 'CC BY — Jo'},
      ],
    });
    c.seek(3000);
    final api = ApiClient(tokens: TokenStore(InMemoryKeyValueStore(signedInStore())), baseUrl: 'https://api.test', adapter: backend);
    tester.view.physicalSize = const Size(400, 860);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      overrides: [aiDirectorServiceProvider.overrideWithValue(AiDirectorService(api, DeviceRegistration(api, platformOverride: 'android')))],
      child: MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: Builder(
          builder: (ctx) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => showStudioTool(ctx, StudioTool.library, c, onEdit: (op, {done}) => c.apply(op)),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    // The library tab bar scrolls (Uploads is first), so bring the tab into view before tapping it.
    await tester.ensureVisible(find.text('Sound FX'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sound FX'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ActionChip, 'whoosh'));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(find.text('Fast whoosh'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Add'));
    await tester.pumpAndSettle();
    final sfx = c.ir!.audio.sfx.single;
    expect((sfx.timelineStartMs, sfx.durationMs, sfx.credit), (3000, 800, 'CC BY — Jo'));
    expect(c.mediaCredits['https://cdn.test/whoosh.mp3'], 'CC BY — Jo');
  });
}
