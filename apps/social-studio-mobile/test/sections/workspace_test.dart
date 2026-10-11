import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/widgets/universal_skeleton.dart';
import 'package:social_studio_mobile/features/library/library_screen.dart';
import 'package:social_studio_mobile/features/posts/post_composer_screen.dart';
import 'package:social_studio_mobile/features/workspace/project_workspace_screen.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

void main() {
  appTest('Workspace: skeleton while the project loads; error offers retry and Go to Home', (tester) async {
    final b = seededBackend();
    final gate = b.hold('GET', '$sm/projects/p1', {'success': true, 'project': projectDetailJson()});
    final h = await pumpApp(tester, b);
    h.router.push('/projects/p1/content');
    await settle(tester);
    expect(find.byType(UniversalSkeleton), findsWidgets);
    gate.complete();
    await settle(tester);
    expect(find.text('Launch teaser'), findsOneWidget);

    b.fail('GET', '$sm/projects/p2', 404, 'Project not found');
    h.router.push('/projects/p2/brand');
    await settle(tester);
    expect(find.text('Project not found'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    await tester.tap(find.text('Go to Home'));
    await settle(tester);
    expect(h.router.routerDelegate.currentConfiguration.uri.path, '/home');
  });

  appTest('Content: empty list offers "Create content" which opens the composer', (tester) async {
    final b = seededBackend()..json('GET', '$sm/posts', {'success': true, 'posts': []});
    await pumpApp(tester, b, location: '/projects/p1/content');
    expect(find.text('No content yet'), findsOneWidget);
    await tester.tap(find.widgetWithText(ElevatedButton, 'Create content'));
    await settle(tester);
    expect(find.byType(PostComposerScreen), findsOneWidget);
    expect(b.last('GET', '$sm/posts')!.query['projectId'], 'p1');
  });

  appTest('Content: a list error keeps the section and offers retry', (tester) async {
    final b = seededBackend()..fail('GET', '$sm/posts', 400, 'Invalid status filter');
    await pumpApp(tester, b, location: '/projects/p1/content');
    expect(find.text('Invalid status filter'), findsOneWidget);
    b.json('GET', '$sm/posts', {'success': true, 'posts': [postJson()]});
    await tester.tap(find.text('Try again'));
    await settle(tester);
    expect(find.text('Launch teaser'), findsOneWidget);
  });

  appTest('Calendar: month list shows this month\'s posts and asks the server for the range', (tester) async {
    final now = DateTime.now();
    final at = DateTime(now.year, now.month, 15, 10).toUtc().toIso8601String();
    final b = seededBackend()..json('GET', '$sm/posts', {'success': true, 'posts': [postJson(status: 'scheduled', scheduledFor: at)]});
    await pumpApp(tester, b, location: '/projects/p1/calendar');
    await tester.tap(find.byTooltip('List view'));
    await settle(tester);
    expect(find.text('Launch teaser'), findsOneWidget);
    final q = b.last('GET', '$sm/posts')!.query;
    expect(q['from'], isNotNull);
    expect(q['to'], isNotNull);
  });

  appTest('Media: legacy /projects/:id/media redirects to dedicated Library screen', (tester) async {
    await pumpApp(tester, seededBackend(), location: '/projects/p1/media');
    await settle(tester);
    expect(find.byType(LibraryScreen), findsOneWidget);
  });

  appTest('Publishing: empty queue offers an action', (tester) async {
    await pumpApp(tester, seededBackend(), location: '/projects/p1/publishing');
    expect(find.text('Nothing in the publishing queue'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Open content'), findsOneWidget);
  });

  appTest('Analytics: a 404 says "not available" and never invents numbers', (tester) async {
    await pumpApp(tester, seededBackend(), location: '/projects/p1/analytics');
    expect(find.text('Not available on the server yet'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Total posts'), findsOneWidget); // real counts from the project
  });

  appTest('Brand: edit and save posts the brand voice to /brand-voice/:projectId', (tester) async {
    final b = seededBackend()..json('POST', '$sm/brand-voice/:projectId', {'success': true, 'profile': {'id': 'bv1', 'projectId': 'p1'}});
    await pumpApp(tester, b, location: '/projects/p1/brand');
    await tester.enterText(find.widgetWithText(TextField, 'Custom tone & persona nuances'), 'Bold, never salesy');
    await tester.pump();
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Save brand identity'));
    final body = b.last('POST', '$sm/brand-voice/p1')!.json;
    expect(body['tone'], 'Bold, never salesy');
    expect(body['targetAudience'], 'Small business owners');
    expect(body['forbiddenWords'], ['cheap']);
    expect((body['metadata'] as Map)['contentPillars'], ['Education']);
    expect(find.text('Brand identity saved'), findsOneWidget);
    expect(b.calls('GET', '$sm/brand-voice/p1').length, 2); // reloaded after save
  });

  appTest('Brand consciousness: shows what the AI still needs and PUTs identity fields', (tester) async {
    final b = seededBackend()
      ..json('PUT', '$sm/projects/:id/brand-consciousness', {'success': true, 'brand': brandConsciousnessJson()});
    await pumpApp(tester, b, location: '/projects/p1/brand');
    final list = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.text('The AI still needs: Brand type, Positioning'), 300, scrollable: list);
    await tapVisible(tester, find.widgetWithText(ChoiceChip, 'Creator'));
    final positioning = find.widgetWithText(TextField, 'Positioning');
    await tester.scrollUntilVisible(positioning, 200, scrollable: list);
    await tester.enterText(positioning, 'Home baristas who want café results');
    final bg = find.widgetWithText(TextField, 'Background colour');
    await tester.scrollUntilVisible(bg, 200, scrollable: list);
    await tester.enterText(bg, '#fafafa');
    await tester.pump();
    final save = find.widgetWithText(ElevatedButton, 'Save brand consciousness');
    await tester.ensureVisible(save);
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -400)); // collapse the outer header
    await settle(tester, frames: 6);
    await tester.tap(save);
    await settle(tester);
    final body = b.last('PUT', '$sm/projects/p1/brand-consciousness')!.json;
    expect(body['brandType'], 'creator');
    expect(body['positioning'], 'Home baristas who want café results');
    expect(body['colors'], {'background': '#FAFAFA', 'text': null});
    expect(body['targetPlatforms'], ['instagram']);
    expect(body.containsKey('logoUrl'), isFalse); // never touched from here
  });

  appTest('Brand: offline save is queued in the outbox', (tester) async {
    final b = seededBackend()..networkError('POST', '$sm/brand-voice/:projectId');
    final h = await pumpApp(tester, b, location: '/projects/p1/brand');
    await tester.enterText(find.widgetWithText(TextField, 'Custom tone & persona nuances'), 'Calm');
    await tester.pump();
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Save brand identity'));
    expect(find.text('Saved offline. It will sync when you are back online.'), findsOneWidget);
    expect(h.outboxStorage.rows.single['path'], '$sm/brand-voice/p1');
    expect(find.byTooltip('Sync status'), findsOneWidget);
  });

  appTest('Channels: accounts of other projects are never offered here (project isolation)', (tester) async {
    final b = seededBackend();
    await pumpApp(tester, b, location: '/projects/p1/accounts');
    expect(find.text('Acme LinkedIn'), findsNothing);
    expect(find.widgetWithText(TextButton, 'Link'), findsNothing);
    expect(b.calls('POST', '$sm/projects/p1/accounts'), isEmpty);
  });

  appTest('Evergreen: adding a slot posts it and reloads the slots', (tester) async {
    final b = seededBackend()
      ..json('POST', '$sm/evergreen/slots', {'success': true, 'slot': {'id': 's2', 'projectId': 'p1', 'dayOfWeek': 1, 'timeSlotUtc': '10:00', 'category': 'Educational'}}, status: 201);
    await pumpApp(tester, b, location: '/projects/p1/evergreen');
    expect(find.textContaining('Tuesday · 09:00 UTC'), findsOneWidget);
    await tester.tap(find.text('Add slot'));
    await settle(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Add'));
    await settle(tester);
    expect(b.last('POST', '$sm/evergreen/slots')!.json, {'projectId': 'p1', 'dayOfWeek': 1, 'timeSlotUtc': '10:00', 'category': 'Educational'});
    expect(b.calls('GET', '$sm/evergreen/p1/slots'), hasLength(2));
  });

  appTest('Settings: save sends name, status and socialSettings with PUT', (tester) async {
    final b = seededBackend()..json('PUT', '$sm/projects/:id', {'success': true, 'project': projectJson()});
    await pumpApp(tester, b, location: '/projects/p1/settings');
    await tester.enterText(find.widgetWithText(TextField, 'Project name'), 'Acme Relaunch');
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Save settings'));
    final body = b.last('PUT', '$sm/projects/p1')!.json;
    expect(body['name'], 'Acme Relaunch');
    expect(body['status'], 'in_progress');
    expect(body['socialSettings'], {'approvalRequired': true, 'defaultTimezone': 'UTC', 'storageRetentionDays': 30});
    expect(find.text('Settings saved'), findsOneWidget);
  });

  appTest('Inbox tab inside a project filters conversations by project', (tester) async {
    final b = seededBackend();
    await pumpApp(tester, b, location: '/projects/p1/inbox');
    expect(find.byType(ProjectWorkspaceScreen), findsOneWidget);
    expect(find.text('Jordan Fan'), findsOneWidget);
    expect(b.last('GET', '$sm/inbox/conversations')!.query['projectId'], 'p1');
  });
}
