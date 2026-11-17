import 'dart:io';

import 'package:flutter/material.dart';
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
import 'package:social_studio_mobile/features/studio/caption_catalog.dart';
import 'package:social_studio_mobile/features/studio/caption_customize_sheet.dart';
import 'package:social_studio_mobile/features/studio/caption_template_apply.dart';
import 'package:social_studio_mobile/features/studio/caption_templates_panel.dart';
import 'package:social_studio_mobile/features/studio/safe_zone_guide.dart';
import 'package:social_studio_mobile/features/studio/studio_controller.dart';
import 'package:social_studio_mobile/features/studio/studio_tools.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

import 'support/app_harness.dart' show signedInStore;
import 'support/fake_backend.dart';

const _engines = [
  MethodChannel('com.workspace180.social_studio_mobile/media_engine'),
  MethodChannel('com.workspace180.socialmanager/media_engine'),
];

/// A template with a full styleV2 spec and a narrow editable list (the stub catalog has empty specs).
CaptionTemplate _template({List<String> editable = captionEditableFields}) => CaptionTemplate(
  id: 'TEST_SPOT',
  name: 'Test Spotlight',
  description: 'test',
  bestFor: const [],
  energy: 3,
  editable: editable,
  sizeRangePx: (min: 40, max: 90),
  styleV2: const {
    'version': 2,
    'typography': {
      'fonts': {'latin': 'Inter'},
      'sizePx': 64,
      'sizeRangePx': {'min': 40, 'max': 90},
      'case': 'upper',
    },
    'paint': {
      'fill': {'type': 'solid', 'color': '#FFFFFF'},
      'strokes': [
        {'color': '#000000', 'widthPx': 6},
      ],
    },
    'layout': {'position': 'lower-third', 'safeZone': 'tiktok'},
    'motion': {'intensity': 1},
    'grouping': {'maxWords': 3},
  },
  legacyStyle: const {
    'animation': 'word_pop',
    'fontFamily': 'Inter',
    'fontSizePx': 64,
    'textColor': '#FFFFFF',
    'highlightColor': '#FFE600',
    'strokeColor': '#000000',
    'strokeWidthPx': 6,
    'uppercase': true,
  },
);

MobileEditIr _withCaptions() {
  final ir = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920);
  EditIrCaption cap(String id, int s, List<String> w) => EditIrCaption(
    id: id,
    startMs: s,
    endMs: s + w.length * 400,
    text: w.join(' '),
    words: [for (final (i, t) in w.indexed) EditIrWord(text: t, startMs: s + i * 400, endMs: s + i * 400 + 350)],
    style: TimelineOps.captionStyle('CLEAN'),
  );
  return ir.copyWith(captions: [cap('a', 0, ['hello', 'there']), cap('b', 1000, ['big', 'news']), cap('c', 2000, ['see', 'you'])]);
}

void main() {
  group('template ops', () {
    test('apply writes styleV2 + the v1 fields and keeps text, words and timing', () {
      final ir = _withCaptions();
      final out = CaptionTemplateApply.applyTemplateObject(ir, _template());
      for (final (i, c) in out.captions.indexed) {
        final before = ir.captions[i];
        expect((c.id, c.text, c.startMs, c.endMs), (before.id, before.text, before.startMs, before.endMs));
        expect([for (final w in c.words) (w.text, w.startMs, w.endMs)], [for (final w in before.words) (w.text, w.startMs, w.endMs)]);
        expect(c.style['styleV2'], isA<Map>());
        expect((c.style['styleV2'] as Map)['paint'], isNotNull);
        expect(c.style['captionTemplate'], 'TEST_SPOT');
        expect((c.style['fontFamily'], c.style['animation'], c.style['uppercase'], c.style['highlightColor']), ('Inter', 'word_pop', true, '#FFE600'));
      }
    });

    test('catalog templates apply through TimelineOps (styleV2 only when the template has one)', () {
      final t = CaptionCatalog.templates.first;
      final out = TimelineOps.applyCaptionTemplate(_withCaptions(), t.id);
      for (final c in out.captions) {
        expect(c.style['captionTemplate'], t.id);
        expect(c.style.containsKey('styleV2'), t.styleV2.isNotEmpty);
        for (final e in t.legacyStyle.entries.where((e) => e.key != 'positionY' && e.key != 'positionX' && e.key != 'fontFamily')) {
          expect(c.style[e.key], e.value, reason: e.key);
        }
      }
      expect(TimelineOps.applyCaptionTemplate(_withCaptions(), 'NO_SUCH_TEMPLATE').captions.first.style, _withCaptions().captions.first.style);
    });

    test('a selection only changes the selected captions', () {
      final ir = _withCaptions();
      final t = CaptionCatalog.templates.first;
      final out = TimelineOps.applyCaptionTemplate(ir, t.id, captionIds: {'b'});
      expect(out.captions[0].style, ir.captions[0].style);
      expect(out.captions[2].style, ir.captions[2].style);
      expect(out.captions[1].style['captionTemplate'], t.id);
    });

    test('customize keeps locked fields, clamps size; reset restores the template exactly', () {
      final t = CaptionCatalog.templates.first;
      final applied = TimelineOps.applyCaptionTemplate(_withCaptions(), t.id);
      final custom = TimelineOps.customizeCaptions(
        applied,
        const CaptionOverrides(colors: {'text': '#00FF00'}, sizePx: 999, position: 'upper-third'),
      );
      final st = custom.captions.first.style;
      expect(st['textColor'], '#00FF00');
      expect(st['fontSizePx'], t.sizeRangePx.max);
      expect((st['positionY'] as num).toDouble(), closeTo(0.3, 0.001));
      expect(st['captionOverrides'], isA<Map>());
      final reset = TimelineOps.resetCaptionsToTemplate(custom);
      for (final (i, c) in reset.captions.indexed) {
        expect(c.style, applied.captions[i].style);
      }
    });

    test('a template that locks a field refuses it', () {
      final locked = _template(editable: ['colors']);
      final r = CaptionTemplateApply.styleFor(locked, overrides: const CaptionOverrides(sizePx: 88, colors: {'text': '#123456'}));
      expect(r.rejected, ['sizePx']);
      expect(r.style['fontSizePx'], 64);
      expect(r.style['textColor'], '#123456');
    });

    test('placement is clamped to the safe zone (dragged below the TikTok bottom bar)', () {
      final t = CaptionCatalog.templates.first;
      final out = TimelineOps.customizeCaptions(
        TimelineOps.applyCaptionTemplate(_withCaptions(), t.id),
        const CaptionOverrides(position: 'custom', x: 0.5, y: 0.98),
        safeZone: SafeZonePlatform.tiktok,
      );
      final y = (out.captions.first.style['positionY'] as num).toDouble();
      expect(y, lessThan(1 - 480 / 1920));
      expect(out.captions.first.style['safeZone'], 'tiktok');
    });
  });

  group('Customize sheet', () {
    Future<void> pumpSheet(WidgetTester tester, CaptionTemplate t, {void Function(CaptionOverrides, SafeZonePlatform)? onApply, VoidCallback? onReset}) async {
      tester.view.physicalSize = const Size(420, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: Scaffold(
          body: CaptionCustomizeSheet(
            template: t,
            initial: const CaptionOverrides(),
            brandColors: const ['#123ABC'],
            onApply: onApply ?? (_, _) {},
            onReset: onReset ?? () {},
          ),
        ),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('shows only the editable fields', (tester) async {
      await pumpSheet(tester, _template(editable: ['colors', 'case']));
      expect(find.byKey(const ValueKey('customize-colors')), findsOneWidget);
      expect(find.byKey(const ValueKey('customize-case')), findsOneWidget);
      for (final k in ['customize-size', 'customize-position', 'caption-drag-pad', 'customize-words', 'customize-motion']) {
        expect(find.byKey(ValueKey(k)), findsNothing, reason: k);
      }
      await pumpSheet(tester, _template());
      for (final k in ['customize-colors', 'customize-size', 'customize-position', 'caption-drag-pad', 'customize-case', 'customize-words', 'customize-motion']) {
        expect(find.byKey(ValueKey(k)), findsOneWidget, reason: k);
      }
      // Brand colours come first.
      expect(find.bySemanticsLabel('Brand colour #123ABC'), findsWidgets);
    });

    testWidgets('size slider is bounded by the template range', (tester) async {
      CaptionOverrides? got;
      await pumpSheet(tester, _template(), onApply: (o, _) => got = o);
      final slider = tester.widget<Slider>(find.byKey(const ValueKey('customize-size')));
      expect((slider.min, slider.max), (40.0, 90.0));
      await tester.drag(find.byKey(const ValueKey('customize-size')), const Offset(2000, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('customize-apply')));
      expect(got!.sizePx, 90);
      await tester.drag(find.byKey(const ValueKey('customize-size')), const Offset(-2000, 0));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('customize-apply')));
      expect(got!.sizePx, 40);
    });

    testWidgets('a brand colour tap sets that colour; Reset calls back', (tester) async {
      CaptionOverrides? got;
      var reset = 0;
      await pumpSheet(tester, _template(), onApply: (o, _) => got = o, onReset: () => reset++);
      await tester.tap(find.byKey(const ValueKey('swatch-text-#123ABC')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('customize-apply')));
      expect(got!.colors['text'], '#123ABC');
      await tester.tap(find.byKey(const ValueKey('customize-reset')));
      expect(reset, 1);
    });

    testWidgets('dragging the caption block clamps it inside the safe zone', (tester) async {
      Offset? last;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: CaptionDragPad(
              zone: SafeZonePlatform.reels,
              x: 0.5,
              y: 0.5,
              block: const Size(0.4, 0.06),
              onChanged: (p) => last = p,
            ),
          ),
        ),
      ));
      final pad = find.byType(CaptionDragPad);
      final box = tester.getRect(pad);
      await tester.dragFrom(box.center, Offset(0, box.height));
      final r = SafeZonePlatform.reels.safeFraction;
      expect(last!.dy, closeTo(r.bottom - 0.03, 1e-6));
      await tester.dragFrom(box.center, Offset(-box.width, -box.height));
      expect(last!.dx, closeTo(r.left + 0.2, 1e-6));
      expect(last!.dy, closeTo(r.top + 0.03, 1e-6));
    });
  });

  group('with a studio session', () {
    setUpAll(() => AssetCache.instance.fetchOverride = (url, kind) async => '${Directory.systemTemp.path}/asset_${url.hashCode}');
    tearDownAll(() => AssetCache.instance.fetchOverride = null);
    TestWidgetsFlutterBinding.ensureInitialized();
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    late StudioController c;
    late File source;

    setUp(() async {
      Future<Object?> handler(MethodCall call) async {
        if (call.method == 'getVideoInfo') {
          return {
            'durationMs': 10000, 'width': 1080, 'height': 1920, 'rotation': 0,
            'displayWidth': 1080, 'displayHeight': 1920, 'hasVideo': true, 'hasAudio': true, 'frameRate': 30.0,
          };
        }
        if (call.method == 'detectSilences') return <Object>[];
        throw PlatformException(code: 'ENGINE_UNAVAILABLE', message: 'not in tests');
      }

      for (final e in _engines) {
        messenger.setMockMethodCallHandler(e, handler);
      }
      source = File('${Directory.systemTemp.path}/cap_editor_${DateTime.now().microsecondsSinceEpoch}.mp4')..writeAsBytesSync([0, 0, 0, 24]);
      final api = ApiClient(tokens: TokenStore(InMemoryKeyValueStore(signedInStore())), baseUrl: 'https://api.test', adapter: FakeBackend());
      final device = DeviceRegistration(api, platformOverride: 'android');
      c = StudioController(director: AiDirectorService(api, device), transcriber: AudioTranscriptionService(api, device));
      await c.load(source.path);
      for (var i = 0; i < 200 && (c.transcriptState == TranscriptState.running || c.silences == null); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      c.apply((ir) => ir.copyWith(captions: _withCaptions().captions));
    });

    tearDown(() {
      for (final e in _engines) {
        messenger.setMockMethodCallHandler(e, null);
      }
      c.dispose();
      if (source.existsSync()) source.deleteSync();
    });

    testWidgets('gallery: live cards animate the user\'s first 3 s and one tap applies to all captions', (tester) async {
      tester.view.physicalSize = const Size(420, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData.dark(useMaterial3: true),
        home: Scaffold(body: CaptionTemplatesPanel(controller: c, onEdit: (op, {done}) => c.apply(op))),
      ));
      await tester.pump();
      final first = CaptionCatalog.templates.first;
      expect(find.byKey(ValueKey('caption-template-${first.id}')), findsOneWidget);
      // The card draws the caption that is on screen at the loop time, from the user's own captions.
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.textContaining('hello', findRichText: true), findsWidgets);
      await tester.pump(const Duration(milliseconds: 1000));
      expect(find.textContaining('big', findRichText: true), findsWidgets);
      await tester.tap(find.byKey(ValueKey('caption-template-${first.id}')));
      await tester.pump();
      expect(c.ir!.captions.map((x) => x.style['captionTemplate']).toSet(), {first.id});
      expect(c.ir!.captions.map((x) => x.text).toList(), ['hello there', 'big news', 'see you']);
      // Reset is offered once a template is chosen.
      expect(tester.widget<TextButton>(find.byKey(const ValueKey('templates-reset'))).onPressed, isNotNull);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('Captions tool: ticking one line applies the template to that line only', (tester) async {
      tester.view.physicalSize = const Size(420, 1400);
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
      final box = find.byKey(const ValueKey('select-caption-b'));
      await tester.ensureVisible(box);
      await tester.tap(box);
      await tester.pumpAndSettle();
      expect(find.text('Templates & Customize (1 selected)'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('open-caption-templates')));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      final first = CaptionCatalog.templates.first;
      await tester.tap(find.byKey(ValueKey('caption-template-${first.id}')));
      await tester.pump();
      final byId = {for (final x in c.ir!.captions) x.id: x.style['captionTemplate']};
      expect(byId, {'a': null, 'b': first.id, 'c': null});
      await tester.pumpWidget(const SizedBox());
    });
  });
}
