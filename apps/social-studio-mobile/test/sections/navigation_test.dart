import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/auth/login_screen.dart';
import 'package:social_studio_mobile/features/common/feature_lock_view.dart';
import 'package:social_studio_mobile/features/dashboard/studio_dashboard_screen.dart';
import 'package:social_studio_mobile/features/inbox/inbox_screen.dart';
import 'package:social_studio_mobile/features/library/library_screen.dart';
import 'package:social_studio_mobile/features/planner/planner_screen.dart';
import 'package:social_studio_mobile/features/studio/studio_screen.dart';
import 'package:social_studio_mobile/features/workspace/project_workspace_screen.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

void main() {
  appTest('signed-in session with social entitlement lands on Home', (tester) async {
    final b = seededBackend();
    await pumpApp(tester, b);
    expect(find.byType(StudioDashboardScreen), findsOneWidget);
    expect(find.text('Acme Launch'), findsWidgets);
    expect(b.last('GET', '/api/auth/me')!.authorization, 'Bearer access-1');
    expectNoRoutingError();
  });

  appTest('every bottom tab opens its real screen', (tester) async {
    await pumpApp(tester, seededBackend());
    final screens = {
      'Planner': PlannerScreen,
      'Inbox': InboxScreen,
      'Library': LibraryScreen,
      'Studio': StudioScreen,
      'Home': StudioDashboardScreen,
    };
    for (final e in screens.entries) {
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(e.key)));
      await settle(tester);
      expect(find.byType(e.value), findsOneWidget, reason: '${e.key} tab');
      expectNoRoutingError();
    }
  });

  appTest('every Home "Workspace" tile opens a real project section', (tester) async {
    final h = await pumpApp(tester, seededBackend());
    for (final s in ProjectSection.all) {
      final tile = find.descendant(of: find.byType(GridView).last, matching: find.text(s.label));
      await tapVisible(tester, tile);
      expect(find.byType(ProjectWorkspaceScreen), findsOneWidget, reason: s.tab);
      expect(find.descendant(of: find.byType(AppBar), matching: find.text(s.label)), findsOneWidget, reason: s.tab);
      expectNoRoutingError();
      expect(tester.takeException(), isNull, reason: s.tab);
      h.router.pop();
      await settle(tester);
    }
  });

  appTest('an expired access token is refreshed once and the request retried', (tester) async {
    final b = seededBackend()..validAccessToken = 'access-9';
    await pumpApp(tester, b);
    expect(b.calls('POST', '/api/auth/refresh'), hasLength(1));
    expect(b.last('POST', '/api/auth/refresh')!.json['refreshToken'], 'refresh-1');
    final me = b.calls('GET', '/api/auth/me').toList();
    expect(me.first.authorization, 'Bearer access-1');
    expect(me.last.authorization, 'Bearer ${b.validAccessToken}');
    expect(find.byType(StudioDashboardScreen), findsOneWidget);
  });

  appTest('a rejected refresh signs the user out to the login screen', (tester) async {
    final b = seededBackend()
      ..validAccessToken = 'access-9'
      ..refreshRejected = true;
    final h = await pumpApp(tester, b);
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(await h.store.read('auth.refreshToken'), isNull);
  });

  appTest('no social entitlement shows the lock screen', (tester) async {
    final b = seededBackend()..json('GET', '/api/auth/me', meJson(availableApps: const ['crm']));
    await pumpApp(tester, b);
    expect(find.byType(FeatureLockView), findsOneWidget);
  });

  appTest('entitlement falls back to /api/billing + /api/feature-flags when /me has none', (tester) async {
    final b = seededBackend()
      ..json('GET', '/api/auth/me', {...meJson()}..remove('entitlements'))
      ..json('GET', '/api/billing', {'isPaidPlan': false, 'enabledApps': ['social-media'], 'isExpired': false})
      ..json('GET', '/api/feature-flags', {'disabledApps': [], 'flags': {}});
    await pumpApp(tester, b);
    expect(b.calls('GET', '/api/billing'), hasLength(1));
    expect(find.byType(StudioDashboardScreen), findsOneWidget);
  });

  appTest('offline at launch restores the cached profile instead of signing out', (tester) async {
    final b = seededBackend();
    final store = {...signedInStore(), 'auth.cachedProfile': '{"user":{"id":"u1","name":"Riya"},"company":{"_id":"co1"}}'};
    b.networkError('GET', '/api/auth/me');
    b.networkError('GET', '$sm/projects');
    await pumpApp(tester, b, store: store);
    expect(find.byType(StudioDashboardScreen), findsOneWidget);
    expect(find.text('You are offline'), findsOneWidget);
  });

  appTest('unknown workspace section explains itself instead of crashing', (tester) async {
    await pumpApp(tester, seededBackend(), location: '/projects/p1/nope');
    expect(find.textContaining('Unknown section'), findsOneWidget);
  });

  appTest('bottom navigation displays dynamic unread notification badge on Inbox icon', (tester) async {
    final b = seededBackend();
    b.json('GET', '$sm/projects/:id/dashboard', {
      'success': true,
      'dashboard': {
        'metrics': {
          'postsScheduledThisWeek': 2,
          'postsAwaitingApproval': 3,
          'editingTasksInProgress': 0,
          'postsPublishedThisMonth': 4,
          'overdueTasks': 0,
          'publishingFailures': 0,
          'unreadInboxCount': 26,
        },
        'attentionItems': [
          {
            'id': 'unread-convs',
            'type': 'unread_inbox',
            'title': '26 Unread Social Inquiries',
            'description': 'Comments or messages awaiting community team response.',
            'priority': 'medium',
            'actionLink': '/social-projects/p1?tab=inbox'
          }
        ],
        'upcomingContent': [],
      },
    });

    await pumpApp(tester, b);
    expect(find.byType(StudioDashboardScreen), findsOneWidget);

    // Verify '26' badge on Inbox destination in bottom navigation bar
    final navBar = find.byType(NavigationBar);
    final inboxBadge = find.descendant(of: navBar, matching: find.text('26'));
    expect(inboxBadge, findsOneWidget);

    // Verify '3' badge on Planner destination for pending approvals
    final plannerBadge = find.descendant(of: navBar, matching: find.text('3'));
    expect(plannerBadge, findsOneWidget);

    // Tapping the Inbox destination with badge navigates to Inbox
    b.json('GET', '$sm/inbox/conversations', {'success': true, 'conversations': []});
    await tester.tap(find.descendant(of: navBar, matching: find.text('Inbox')));
    await settle(tester);
    expect(find.byType(InboxScreen), findsOneWidget);

    // In InboxScreen, filter chip also highlights the unread count '26'
    await tester.drag(find.byType(ListView).first, const Offset(-100, 0));
    await settle(tester);
    expect(find.text('Unread (26)'), findsOneWidget);
  });
}
