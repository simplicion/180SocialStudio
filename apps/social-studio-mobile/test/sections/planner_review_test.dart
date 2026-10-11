import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/widgets/universal_skeleton.dart';
import 'package:social_studio_mobile/features/planner/calendar_detail_screen.dart';
import 'package:social_studio_mobile/features/planner/calendar_generator_screen.dart';
import 'package:social_studio_mobile/features/planner/detailed_script_screen.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

void main() {
  group('Planner', () {
    appTest('skeleton, then calendars; tapping one opens pieces by week', (tester) async {
      final b = seededBackend();
      final gate = b.hold('GET', '$sm/content-calendar', {'calendars': [calendarJson()]});
      final h = await pumpApp(tester, b);
      h.router.go('/planner');
      await settle(tester);
      expect(find.byType(UniversalSkeleton), findsWidgets);
      gate.complete();
      await settle(tester);
      await tester.tap(find.text('Acme').first);
      await settle(tester);
      expect(find.byType(CalendarDetailScreen), findsOneWidget);
      expect(find.text('WEEK 1'), findsOneWidget);
      expect(find.text('3 myths about shipping'), findsOneWidget);
    });

    appTest('empty planner offers "Generate calendar"', (tester) async {
      final b = seededBackend()..json('GET', '$sm/content-calendar', {'calendars': []});
      await pumpApp(tester, b, location: '/planner');
      expect(find.text('No content calendars yet'), findsOneWidget);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Generate calendar'));
      await settle(tester);
      expect(find.byType(CalendarGeneratorScreen), findsOneWidget);
    });

    appTest('planner error offers retry', (tester) async {
      final b = seededBackend()..on('GET', '$sm/content-calendar', (_) => FakeResponse.json({'error': 'LLM quota exceeded'}, status: 500));
      await pumpApp(tester, b, location: '/planner');
      expect(find.text('LLM quota exceeded'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    appTest('piece status change PUTs to the piece', (tester) async {
      final b = seededBackend()..json('PUT', '$sm/content-calendar/:id/pieces/:pieceId', {'piece': pieceJson()});
      await pumpApp(tester, b, location: '/planner/cal1');
      await tester.tap(find.text('3 myths about shipping'));
      await settle(tester);
      await tester.tap(find.text('Ready').last);
      await settle(tester);
      await tester.tap(find.text('In progress').last);
      await settle(tester);
      expect(b.last('PUT', '$sm/content-calendar/cal1/pieces/piece1')!.json, {'status': 'in_progress'});
    });

    appTest('piece "View detailed script" button opens DetailedScriptScreen via /planner/script', (tester) async {
      final b = seededBackend();
      await pumpApp(tester, b, location: '/planner/cal1');
      await tester.tap(find.text('3 myths about shipping'));
      await settle(tester);
      expect(find.text('View detailed script'), findsOneWidget);
      await tester.tap(find.text('View detailed script'));
      await settle(tester);
      expect(find.byType(DetailedScriptScreen), findsOneWidget);
    });

    appTest('day sheet "Full script" button opens DetailedScriptScreen via /planner/script', (tester) async {
      final b = seededBackend();
      await pumpApp(tester, b, location: '/planner/cal1');
      await tester.tap(find.text('2').first);
      await settle(tester);
      expect(find.text('Full script'), findsOneWidget);
      await tester.tap(find.text('Full script'));
      await settle(tester);
      expect(find.byType(DetailedScriptScreen), findsOneWidget);
    });
  });
}

