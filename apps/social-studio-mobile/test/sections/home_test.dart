import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/widgets/universal_skeleton.dart';
import 'package:social_studio_mobile/features/dashboard/studio_dashboard_screen.dart';
import 'package:social_studio_mobile/features/posts/post_composer_screen.dart';
import 'package:social_studio_mobile/features/projects/create_project_screen.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

void main() {
  appTest('Home: skeleton while projects load, then the project overview', (tester) async {
    final b = seededBackend();
    final gate = b.hold('GET', '$sm/projects', {'success': true, 'projects': [projectJson()]});
    await pumpApp(tester, b);
    expect(find.byType(StudioDashboardScreen), findsOneWidget);
    expect(find.byType(UniversalSkeleton), findsWidgets);
    gate.complete();
    await settle(tester);
    expect(find.byType(UniversalSkeleton), findsNothing);
    expect(find.text('Q3 launch campaign'), findsOneWidget);
    expect(find.text('Scheduled this week'), findsOneWidget);
    expect(find.text('Scheduled & Runway'), findsOneWidget);
    expect(find.textContaining('days left'), findsOneWidget);
    expect(find.text('Created (30-Day)'), findsNothing);
    expect(find.text('2'), findsWidgets); // postsScheduledThisWeek from the dashboard payload
    expect(b.last('GET', '$sm/projects/p1/dashboard'), isNotNull);
  });

  appTest('Home: no projects shows the empty state with a "New project" action', (tester) async {
    final b = seededBackend()..json('GET', '$sm/projects', {'success': true, 'projects': []});
    await pumpApp(tester, b);
    expect(find.text('Create your first project'), findsOneWidget);
    await tester.tap(find.widgetWithText(ElevatedButton, 'New project'));
    await settle(tester);
    expect(find.byType(CreateProjectScreen), findsOneWidget);
  });

  appTest('Home: load error offers retry and a second recovery path, retry recovers', (tester) async {
    final b = seededBackend()..fail('GET', '$sm/projects', 500, 'Database unavailable');
    await pumpApp(tester, b);
    expect(find.text('Database unavailable'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    // Second path out of the error: the account menu (All projects / Sync status / Sign out).
    await tester.tap(find.byIcon(Icons.account_circle_rounded));
    await settle(tester);
    expect(find.text('All projects'), findsOneWidget);
    expect(find.text('Sign out'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.close_rounded)); // dismiss the bottom sheet
    await settle(tester);

    b.json('GET', '$sm/projects', {'success': true, 'projects': [projectJson()]});
    await tester.tap(find.text('Try again'));
    await settle(tester);
    expect(find.text('Q3 launch campaign'), findsOneWidget);
  });

  appTest('Home: dashboard section error is contained and retryable', (tester) async {
    final b = seededBackend()..fail('GET', '$sm/projects/:id/dashboard', 400, 'Project not found');
    await pumpApp(tester, b);
    expect(find.text('Project not found'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Workspace'.toUpperCase()), findsOneWidget); // rest of Home still usable
  });

  appTest('Home: "Create content" opens the composer for the active project', (tester) async {
    await pumpApp(tester, seededBackend());
    await tester.tap(find.text('Create content'));
    await settle(tester);
    expect(find.byType(PostComposerScreen), findsOneWidget);
    expect(find.text('Acme Launch'), findsWidgets);
  });

  appTest('Home: project switcher selects another project and reloads its dashboard', (tester) async {
    final b = seededBackend()
      ..json('GET', '$sm/projects', {'success': true, 'projects': [projectJson(), projectJson(id: 'p2', name: 'Beta Brand')]});
    await pumpApp(tester, b);
    await tester.tap(find.byKey(const Key('projectSwitcher')));
    await settle(tester);
    await tester.tap(find.text('Beta Brand'));
    await settle(tester);
    expect(b.last('GET', '$sm/projects/p2/dashboard'), isNotNull);
    expect(find.descendant(of: find.byType(AppBar), matching: find.text('Beta Brand')), findsOneWidget);
  });

  appTest('Home: sign out from the account menu revokes and returns to login', (tester) async {
    final b = seededBackend()..json('DELETE', '/api/desktop/devices/:id', {'success': true});
    final h = await pumpApp(tester, b);
    await tester.tap(find.byIcon(Icons.account_circle_rounded));
    await settle(tester);
    await tester.drag(find.byType(SingleChildScrollView).last, const Offset(0, -200));
    await settle(tester);
    await tester.tap(find.text('Sign out').last);
    await settle(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
    await settle(tester);
    expect(b.last('POST', '/api/auth/logout')!.json['refreshToken'], 'refresh-1');
    expect(b.calls('DELETE', '/api/desktop/devices/dev1'), hasLength(1));
    expect(await h.store.read('auth.accessToken'), isNull);
    expect(h.router.routerDelegate.currentConfiguration.uri.path, '/login');
  });

  test('fixtures are shaped like the backend (sanity)', () {
    expect(projectJson()['socialSettings'], isA<Map>());
    expect(FakeResponse.error(400, 'x').body, {'success': false, 'error': 'x'});
  });
}
