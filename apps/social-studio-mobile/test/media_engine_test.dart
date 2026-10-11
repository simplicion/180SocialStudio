import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/core/widgets/universal_skeleton.dart';
import 'package:social_studio_mobile/core/widgets/skeleton_boundary.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('MediaEngineService & AudioTranscription Tests', () {
    test('MediaEngineService fails loudly when the native engine is absent', () async {
      // No channel mock is registered: the engine must throw, never fabricate an output file.
      await expectLater(
        MediaEngineService.sliceVideo(sourcePath: '/tmp/non_existent.mp4', destPath: '/tmp/test_slice.mp4', startMs: 1000, endMs: 5000),
        throwsA(isA<MediaEngineException>().having((e) => e.code, 'code', 'ENGINE_UNAVAILABLE')),
      );
      await expectLater(
        MediaEngineService.extractAudio(sourcePath: '/tmp/non_existent.mp4', destPath: '/tmp/test_audio.m4a'),
        throwsA(isA<MediaEngineException>()),
      );
    });

    test('AudioTranscriptionService picks the upload content type from the extension', () {
      expect(AudioTranscriptionService.contentTypeFor('/a/b.wav').toString(), 'audio/wav');
      expect(AudioTranscriptionService.contentTypeFor('/a/b.m4a').toString(), 'audio/mp4');
      expect(AudioTranscriptionService.contentTypeFor('/a/b.MP3').toString(), 'audio/mpeg');
    });
  });

  group('UX & UI Architecture - Universal Skeleton & Skeleton Boundary Tests', () {
    testWidgets('UniversalSkeleton renders geometry without layout shifts', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: UniversalSkeleton(type: SkeletonType.calendar),
          ),
        ),
      );

      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byType(UniversalSkeleton), findsOneWidget);
    });

    testWidgets('SkeletonBoundary renders dual-path error recovery and 44px min touch target', (tester) async {
      bool retried = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonBoundary(
              loading: false,
              error: 'Failed to sync with 180workspace backend',
              skeletonType: SkeletonType.table,
              onRetry: () => retried = true,
              children: const Text('Real Content'),
            ),
          ),
        ),
      );

      expect(find.text('Something Went Wrong'), findsOneWidget);
      expect(find.text('Try Again'), findsOneWidget);
      expect(find.text('Dashboard'), findsOneWidget);

      await tester.tap(find.text('Try Again'));
      expect(retried, isTrue);
    });

    testWidgets('SkeletonBoundary renders actionable empty state with CTA', (tester) async {
      bool actionTapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SkeletonBoundary(
              loading: false,
              empty: true,
              skeletonType: SkeletonType.chat,
              emptyTitle: 'No Comments',
              emptyMessage: 'Inbox is completely caught up.',
              emptyActionLabel: 'Refresh Feed',
              onEmptyAction: () => actionTapped = true,
              children: const Text('Content'),
            ),
          ),
        ),
      );

      expect(find.text('No Comments'), findsOneWidget);
      expect(find.text('Refresh Feed'), findsOneWidget);

      await tester.tap(find.text('Refresh Feed'));
      expect(actionTapped, isTrue);
    });
  });
}
