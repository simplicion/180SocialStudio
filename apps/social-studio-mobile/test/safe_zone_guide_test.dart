import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/features/studio/safe_zone_guide.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

void main() {
  group('SafeZonePlatform', () {
    test('cycles platforms sequentially: none -> tiktok -> reels -> shorts -> none', () {
      expect(SafeZonePlatform.none.next(), SafeZonePlatform.tiktok);
      expect(SafeZonePlatform.tiktok.next(), SafeZonePlatform.reels);
      expect(SafeZonePlatform.reels.next(), SafeZonePlatform.shorts);
      expect(SafeZonePlatform.shorts.next(), SafeZonePlatform.none);
    });

    test('exact contract margins on 1080x1920 reference frame', () {
      final tt = SafeZoneOverlayGuide.margins[SafeZonePlatform.tiktok]!;
      expect((tt.top, tt.bottom, tt.left, tt.right), (220, 480, 60, 140));

      final reels = SafeZoneOverlayGuide.margins[SafeZonePlatform.reels]!;
      expect(
        (reels.top, reels.bottom, reels.left, reels.right),
        (270, 670, 65, 120),
      );

      final shorts = SafeZoneOverlayGuide.margins[SafeZonePlatform.shorts]!;
      expect(
        (shorts.top, shorts.bottom, shorts.left, shorts.right),
        (240, 600, 60, 140), // same as caption-style-v2.ts, TextMotion.kt and the Swift renderer,
      );

      final none = SafeZoneOverlayGuide.margins[SafeZonePlatform.none]!;
      expect((none.top, none.bottom, none.left, none.right), (0, 0, 0, 0));
    });

    testWidgets('SafeZoneOverlayGuide renders safe box with IgnorePointer', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 360,
              height: 640,
              child: SafeZoneOverlayGuide(platform: SafeZonePlatform.tiktok),
            ),
          ),
        ),
      );

      final ignorePointerInGuide = find.descendant(
        of: find.byType(SafeZoneOverlayGuide),
        matching: find.byType(IgnorePointer),
      );
      expect(ignorePointerInGuide, findsOneWidget);
      expect(find.text('TikTok Safe Zone'), findsOneWidget);
      expect(find.text('TikTok Top Header'), findsOneWidget);
      expect(
        find.text('TikTok Bottom UI (Description & Audio)'),
        findsOneWidget,
      );
    });

    testWidgets('SafeZoneOverlayGuide renders nothing when platform is none', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 360,
              height: 640,
              child: SafeZoneOverlayGuide(platform: SafeZonePlatform.none),
            ),
          ),
        ),
      );

      final ignorePointerInGuide = find.descendant(
        of: find.byType(SafeZoneOverlayGuide),
        matching: find.byType(IgnorePointer),
      );
      expect(ignorePointerInGuide, findsNothing);
      expect(find.textContaining('Safe Zone'), findsNothing);
    });
  });

  group('TimelineOps.toggleWordHighlight', () {
    test(
      'toggles highlight on chosen word and preserves word timings and text',
      () {
        final words = [
          TranscriptWord(text: 'create', startMs: 0, endMs: 400),
          TranscriptWord(text: 'viral', startMs: 400, endMs: 800),
          TranscriptWord(text: 'content', startMs: 800, endMs: 1200),
        ];
        final ir = TimelineOps.autoCaptions(
          TimelineOps.initial(
            projectId: 'p1',
            durationMs: 5000,
            width: 1080,
            height: 1920,
            words: words,
          ),
          words,
          wordsPerCaption: 3,
        );

        final cap = ir.captions.first;
        expect(cap.words[1].text, 'viral');
        expect(cap.words[1].highlight, isFalse);

        // Toggle ON
        final toggled = TimelineOps.toggleWordHighlight(ir, cap.id, 1);
        final toggledWord = toggled.captions.first.words[1];
        expect(toggledWord.highlight, isTrue);
        expect(toggledWord.startMs, cap.words[1].startMs);
        expect(toggledWord.endMs, cap.words[1].endMs);

        // Other words untouched
        expect(toggled.captions.first.words[0].highlight, isFalse);
        expect(toggled.captions.first.words[2].highlight, isFalse);

        // Toggle OFF
        final untoggled = TimelineOps.toggleWordHighlight(toggled, cap.id, 1);
        expect(untoggled.captions.first.words[1].highlight, isFalse);
      },
    );
  });
}
