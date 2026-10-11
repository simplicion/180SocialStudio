import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/providers.dart';
import 'package:social_studio_mobile/data/models/autopilot.dart';
import 'package:social_studio_mobile/features/planner/calendar_detail_screen.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

final structuredScript = jsonEncode({
  'schema': 'autopilot-piece/1',
  'format': 'reel',
  'spokenHook': 'Stop brewing coffee like this',
  'onScreenHook': 'You are wasting beans',
  'script': {
    'hook': 'Stop brewing coffee like this',
    'body': [
      {'beat': 'Most people use water that is too hot.', 'retentionDevice': 'open loop'},
      {'beat': 'Drop it to 93 degrees.'},
    ],
    'retentionLoop': 'Watch to the end for the ratio.',
    'cta': 'Follow for the next brew guide',
    'estimatedDurationSec': 28,
  },
  'shotNotes': ['Close-up of kettle'],
});

void main() {
  group('PieceBrief', () {
    test('parses the autopilot payload and builds a label-free teleprompter script', () {
      final b = PieceBrief.parse(structuredScript)!;
      expect(b.openingHook, 'Stop brewing coffee like this');
      expect(b.body.map((e) => e.beat), ['Most people use water that is too hot.', 'Drop it to 93 degrees.']);
      expect(b.durationSec, 28);
      expect(
        b.teleprompterText,
        'Stop brewing coffee like this\n\nMost people use water that is too hot.\n\nDrop it to 93 degrees.\n\n'
        'Watch to the end for the ratio.\n\nFollow for the next brew guide',
      );
    });

    test('plain text and broken JSON are not briefs', () {
      expect(PieceBrief.parse('Hook: you have been lied to'), isNull);
      expect(PieceBrief.parse('{not json'), isNull);
    });
  });

  group('Jobs', () {
    test('creative job reads slide urls, falling back to mediaUrls', () {
      final j = CreativeJob.fromJson({
        'id': 'cj1',
        'status': 'completed',
        'step': 'Done',
        'progress': {'done': 4, 'total': 4},
        'result': {
          'slides': [
            {'index': 0, 'url': 'https://cdn.test/s0.png'},
            {'index': 1},
          ],
          'mediaUrls': ['https://cdn.test/s0.png', 'https://cdn.test/s1.png'],
          'coverUrl': 'https://cdn.test/s0.png',
        },
        'warnings': [],
        'error': null,
      });
      expect(j.isDone, isTrue);
      expect(j.slides.map((s) => s.url), ['https://cdn.test/s0.png', 'https://cdn.test/s1.png']);
    });
  });

  group('Autopilot calendar', () {
    appTest('starts a 30-day job, follows its stages, then opens the calendar', (tester) async {
      var polls = 0;
      final b = seededBackend()
        ..json('GET', '$sm/content-calendar/:id', {'calendar': calendarJson(), 'pieces': [pieceJson()]})
        ..json('POST', '$sm/projects/:id/autopilot/calendar', {'success': true, 'jobId': 'apj_1', 'calendarId': 'cal1', 'status': 'queued'}, status: 202)
        ..on('GET', '$sm/projects/:id/autopilot/jobs/:jobId', (_) {
          polls++;
          return FakeResponse.json(polls < 2
              ? {'success': true, 'jobId': 'apj_1', 'calendarId': 'cal1', 'status': 'running', 'stage': 'hooks_scripts', 'progress': 55}
              : {'success': true, 'jobId': 'apj_1', 'calendarId': 'cal1', 'status': 'completed', 'stage': 'done', 'progress': 100, 'totalPieces': 30});
        });
      final h = await pumpApp(tester, b, location: '/planner/new');
      await tester.tap(find.text('Generate 30-day calendar'));
      await settle(tester);
      expect(find.text('Writing hooks and scripts'), findsOneWidget);
      final body = b.last('POST', '$sm/projects/p1/autopilot/calendar')!.json;
      expect(body['days'], 30);
      expect(body['platforms'], ['instagram']);
      await tester.pump(const Duration(seconds: 2));
      await settle(tester);
      expect(h.router.routeInformationProvider.value.uri.path, '/planner/cal1');
    });

    appTest('409 resumes the job that is already running', (tester) async {
      final b = seededBackend()
        ..json('POST', '$sm/projects/:id/autopilot/calendar',
            {'success': false, 'code': 'CONFLICT', 'error': 'already running', 'details': {'jobId': 'apj_live', 'calendarId': 'cal1'}},
            status: 409)
        ..json('GET', '$sm/projects/:id/autopilot/jobs/:jobId',
            {'success': true, 'jobId': 'apj_live', 'calendarId': 'cal1', 'status': 'running', 'stage': 'research', 'progress': 10});
      await pumpApp(tester, b, location: '/planner/new');
      await tester.tap(find.text('Generate 30-day calendar'));
      await settle(tester);
      expect(find.text('Researching your niche'), findsOneWidget);
      expect(b.calls('GET', '$sm/projects/p1/autopilot/jobs/apj_live'), isNotEmpty);
    });

    appTest('failed job shows the reason, retry and the classic generator', (tester) async {
      final b = seededBackend()
        ..json('POST', '$sm/projects/:id/autopilot/calendar', {'success': true, 'jobId': 'apj_1', 'calendarId': 'cal1'}, status: 202)
        ..json('GET', '$sm/projects/:id/autopilot/jobs/:jobId', {
          'success': true, 'jobId': 'apj_1', 'calendarId': 'cal1', 'status': 'failed', 'stage': 'strategy', 'progress': 20,
          'error': {'code': 'AI_NOT_CONFIGURED', 'message': 'No AI provider is configured for this workspace.'},
        });
      await pumpApp(tester, b, location: '/planner/new');
      await tester.tap(find.text('Generate 30-day calendar'));
      await settle(tester);
      expect(find.text('No AI provider is configured for this workspace.'), findsOneWidget);
      await tester.tap(find.text('Use the classic generator'));
      await settle(tester);
      expect(find.text('Brand name *'), findsOneWidget);
    });
  });

  group('Piece sheet', () {
    appTest('structured script shows as hook/script blocks and carousel pieces can be designed', (tester) async {
      final piece = {...pieceJson(), 'contentType': 'Carousel', 'videoScriptOrHooks': structuredScript};
      final b = seededBackend()
        ..json('GET', '$sm/content-calendar/:id', {'calendar': calendarJson(), 'pieces': [piece]})
        ..json('POST', '$sm/projects/:id/creative/carousels', {
          'success': true,
          'job': {'id': 'cj1', 'status': 'failed', 'step': 'Photos', 'progress': {'done': 1, 'total': 4},
            'error': {'code': 'IMAGE_MODEL_NOT_CONFIGURED', 'message': 'No image model'}},
        }, status: 202);
      await pumpApp(tester, b, location: '/planner/cal1');
      await tester.tap(find.text('3 myths about shipping'));
      await settle(tester);
      expect(find.byType(PieceSheet), findsOneWidget);
      expect(find.text('HOOK (SAY THIS)'), findsOneWidget);
      expect(find.textContaining('1. Most people use water'), findsOneWidget);
      expect(find.textContaining('"schema"'), findsNothing);

      await tester.ensureVisible(find.text('Design carousel slides'));
      await tester.tap(find.text('Design carousel slides'));
      await settle(tester);
      await tester.tap(find.text('Design slides'));
      await settle(tester);
      expect(find.text('No image model is set up for this workspace'), findsOneWidget);
      expect(find.text('Use stock photos'), findsOneWidget);
      expect(b.last('POST', '$sm/projects/p1/creative/carousels')!.json['pieceId'], 'piece1');
    });
  });

  appTest('raw footage upload posts multipart "video" and returns the stored URL', (tester) async {
    final b = seededBackend()
      ..json('POST', '$sm/calendar-pieces/:pieceId/raw-footage',
          {'success': true, 'data': {'pieceId': 'piece1', 'url': 'https://cdn.test/raw/take1.mp4'}}, status: 201);
    final h = await pumpApp(tester, b);
    final f = File('${Directory.systemTemp.createTempSync('raw').path}/take1.mp4')..writeAsBytesSync(List.filled(64, 1));
    final url = await tester.runAsync(() => h.container.read(socialApiProvider).uploadPieceRawFootage('piece1', f.path));
    expect(url, 'https://cdn.test/raw/take1.mp4');
    expect(b.calls('POST', '$sm/calendar-pieces/piece1/raw-footage'), hasLength(1));
  });
}
