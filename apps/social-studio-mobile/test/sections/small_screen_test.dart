import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

/// Every main screen at 320×640 dp (small Android phones) must lay out without overflow.
void main() {
  const routes = [
    '/home',
    '/planner',
    '/planner/cal1',
    '/inbox',
    '/inbox/conv1',
    '/library',
    '/studio',
    '/projects',
    '/posts/post1',
    '/posts/new?projectId=p1',
    '/projects/p1/calendar',
    '/projects/p1/content',
    '/projects/p1/publishing',
    '/projects/p1/analytics',
    '/projects/p1/brand',
    '/projects/p1/accounts',
    '/projects/p1/evergreen',
    '/projects/p1/settings',
  ];

  appTest('no layout overflow at 320dp on any main screen', (tester) async {
    final b = seededBackend()
      ..json('GET', '$sm/projects', {'success': true, 'projects': [projectJson(name: 'Acme International Holiday Launch Campaign 2026')]})
      ..json('GET', '$sm/posts', {'success': true, 'posts': [
        postJson(title: 'A very long post title that will certainly not fit on one line of a small phone', status: 'partially_published'),
      ]});
    final h = await pumpApp(tester, b, size: const Size(320, 640));
    for (final r in routes) {
      h.router.go(r);
      await settle(tester);
      expect(tester.takeException(), isNull, reason: 'layout error on $r');
      expect(find.byType(Scaffold), findsWidgets, reason: r);
    }
  });
}
