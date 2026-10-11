import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/posts/publish_status.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

/// After "Publish": live rows, Open buttons per posted platform; scheduled posts show a countdown.
void main() {
  test('time left is written for people', () {
    expect(formatLeft(const Duration(days: 3, hours: 4, minutes: 9)), '3 d 4 h');
    expect(formatLeft(const Duration(hours: 2, minutes: 14)), '2 h 14 min');
    expect(formatLeft(const Duration(minutes: 9)), '9 min');
    expect(formatLeft(const Duration(seconds: 20)), '< 1 min');
  });

  appTest('scheduled post shows a countdown', (tester) async {
    final when = DateTime.now().add(const Duration(hours: 2, minutes: 30)).toUtc().toIso8601String();
    final b = seededBackend()..json('GET', '$sm/posts/:id', {'success': true, 'post': postJson(status: 'scheduled', scheduledFor: when)});
    await pumpApp(tester, b, location: '/posts/post1');
    expect(find.textContaining('Publishes in 2 h'), findsOneWidget);
  });

  appTest('publish result offers Open for each posted platform', (tester) async {
    final b = seededBackend()
      ..json('GET', '$sm/posts/:id/validate-publish', {'success': true, 'isReady': true, 'issues': []})
      ..json('POST', '$sm/posts/:id/publish', {
        'success': true,
        'status': 'published',
        'message': '',
        'publishedLinks': {'instagram': 'https://instagram.com/p/1'},
        'errors': {},
      });
    await pumpApp(tester, b, location: '/posts/post1');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Publish'));
    await settle(tester);
    await tester.tap(find.text('Auto-Publish (1-Click)'));
    await settle(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Publish'));
    await settle(tester);
    expect(find.text('✓ instagram: posted'), findsOneWidget);
    expect(find.widgetWithText(TextButton, 'Open'), findsOneWidget);
  });
}
