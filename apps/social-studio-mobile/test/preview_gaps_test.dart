import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/core/native_engine/overlay_layer.dart';
import 'package:social_studio_mobile/core/network/api_client.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/core/network/device_registration.dart';
import 'package:social_studio_mobile/core/storage/key_value_store.dart';
import 'package:social_studio_mobile/core/storage/token_store.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/studio/clip_audio_fades.dart';
import 'package:social_studio_mobile/features/studio/layer_placement.dart';
import 'package:social_studio_mobile/features/studio/studio_controller.dart';
import 'package:social_studio_mobile/features/studio/studio_drafts_service.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

import 'support/app_harness.dart' show signedInStore;
import 'support/fake_backend.dart';

/// The preview gaps closed after Phase 5.1: pinch / rotate layers (and native-mode handles), J/L cuts in the Dart
/// preview with the export's rules.
MobileEditIr twoClips({int leadMs = 0, int lagMs = 0}) {
  final ir = TimelineOps.split(TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920), 5000);
  // The source is longer than the timeline, so there is material before / after each clip.
  final src = ir.copyWith(sources: [EditIrSource(assetId: 'primary', durationMs: 20000, width: 1080, height: 1920)]);
  return TimelineOps.setJLCut(TimelineOps.setJLCut(src, 1, leadMs: leadMs), 0, lagMs: lagMs);
}

void main() {
  group('J/L cuts in the Dart preview', () {
    test('without J/L cuts the gain is the old de-click gain', () {
      final ir = twoClips();
      for (final t in [0, 2500, 4995, 5000, 5005, 9000]) {
        final i = TimelineOps.clipIndexAt(ir, t);
        expect(clipPreviewGainJl(ir, i, t), closeTo(clipPreviewGainWithDeclick(ir, i, t - ir.clips[i].timelineStartMs), 1e-9), reason: 't=$t');
      }
      expect(jlNeighbourAt(ir, 4900), isNull);
    });

    test("a J-cut plays the next clip's sound under the end of this one, while this one fades out", () {
      final ir = twoClips(leadMs: 400);
      expect(ir.clips[1].audioLeadMs, 400);
      final n = jlNeighbourAt(ir, 4800)!;
      expect(n.clipIndex, 1);
      expect(n.sourceMs, ir.clips[1].sourceStartMs - 200, reason: '200 ms before the next clip starts');
      expect(n.gain, closeTo(1, 1e-6), reason: 'the overlapping sound comes in at full level');
      expect(clipPreviewGainJl(ir, 0, 4800), lessThan(1), reason: 'the current clip fades out under it');
      expect(clipPreviewGainJl(ir, 0, 4600), greaterThanOrEqualTo(clipPreviewGainJl(ir, 0, 4800)));
      expect(jlNeighbourAt(ir, 4500), isNull, reason: 'before the lead window');
    });

    test('an L-cut keeps the previous clip talking over the start of the next', () {
      final ir = twoClips(lagMs: 300);
      final n = jlNeighbourAt(ir, 5150)!;
      expect(n.clipIndex, 0);
      expect(n.sourceMs, ir.clips[0].sourceEndMs + 150);
      expect(jlNeighbourAt(ir, 5400), isNull, reason: 'after the lag window');
    });

    test('clamps match the export: a still has no J/L, the first clip has no lead', () {
      final ir = twoClips(leadMs: 400);
      expect(clipJlMs(ir, 1, isStill: (_) => true), (0.0, 0.0));
      expect(clipJlMs(ir, 0).$1, 0);
    });
  });

  group('layer handles', () {
    late StudioController c;

    setUp(() async {
      final backend = FakeBackend();
      final api = ApiClient(tokens: TokenStore(InMemoryKeyValueStore(signedInStore())), baseUrl: 'https://api.test', adapter: backend);
      final device = DeviceRegistration(api, platformOverride: 'android');
      c = StudioController(director: AiDirectorService(api, device), transcriber: AudioTranscriptionService(api, device));
      var ir = TimelineOps.initial(projectId: 'p', durationMs: 10000, width: 1080, height: 1920);
      ir = TimelineOps.addBroll(ir, {'kind': 'url', 'url': 'https://cdn.test/pip.mp4'}, startMs: 0, durationMs: 5000);
      final o = ir.overlays.single;
      ir = TimelineOps.updateOverlay(ir, o.id, layer: const EditIrLayer(x: 0.5, y: 0.5, scale: 0.4));
      await c.restoreFromDraft(StudioDraft(id: 'd', title: 't', sourcePath: '/x.mp4', ir: ir, updatedAt: DateTime(2026)));
    });

    tearDown(() => c.dispose());

    Widget host(bool ghost) => MaterialApp(
          home: Center(
            child: SizedBox(
              width: 300,
              height: 300,
              child: AnimatedBuilder(
                animation: c,
                builder: (_, _) => LayerPlacement(
                  overlay: c.ir!.overlays.single,
                  playheadMs: 1000,
                  mediaAspect: 1,
                  controller: c,
                  onTap: () {},
                  ghost: ghost,
                  child: const ColoredBox(color: Colors.red),
                ),
              ),
            ),
          ),
        );

    testWidgets('one finger moves the layer; one undo puts it back', (tester) async {
      await tester.pumpWidget(host(false));
      await tester.drag(find.byType(ColoredBox).first, const Offset(60, 0));
      await tester.pump();
      expect(c.ir!.overlays.single.layer!.x, closeTo(0.7, 0.02));
      c.undo();
      expect(c.ir!.overlays.single.layer!.x, 0.5);
    });

    testWidgets('two fingers pinch the layer bigger', (tester) async {
      await tester.pumpWidget(host(false));
      final centre = tester.getCenter(find.byType(LayerPlacement));
      final a = await tester.startGesture(centre - const Offset(20, 0), pointer: 41);
      final b = await tester.startGesture(centre + const Offset(20, 0), pointer: 42);
      await tester.pump();
      await a.moveBy(const Offset(-20, 0));
      await b.moveBy(const Offset(20, 0));
      await tester.pump();
      await a.up();
      await b.up();
      await tester.pump();
      expect(c.ir!.overlays.single.layer!.scale, greaterThan(0.6), reason: 'twice the finger distance: about twice the size');
    });

    testWidgets('a native-mode (ghost) handle is invisible but still moves the layer', (tester) async {
      await tester.pumpWidget(host(true));
      expect(find.byWidgetPredicate((w) => w is ColoredBox && w.color == Colors.red), findsNothing, reason: 'the native frame shows the layer');
      final opacity = tester.widget<Opacity>(find.descendant(of: find.byType(LayerPlacement), matching: find.byType(Opacity)).first);
      expect(opacity.opacity, 0);
      await tester.drag(find.byType(LayerPlacement), const Offset(0, -60));
      await tester.pump();
      expect(c.ir!.overlays.single.layer!.y, closeTo(0.3, 0.02));
    });
  });
}
