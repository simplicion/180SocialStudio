import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/providers.dart';
import 'package:social_studio_mobile/core/widgets/sync_indicator.dart';
import 'package:social_studio_mobile/core/widgets/universal_skeleton.dart';
import 'package:social_studio_mobile/features/posts/post_detail_screen.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

Future<void> _fillComposer(WidgetTester tester) async {
  await tester.enterText(find.widgetWithText(TextField, 'Caption *'), 'Our new drop lands Friday.');
  await tapVisible(tester, find.widgetWithText(FilterChip, 'Instagram'));
  if (find.text('Save Instagram Settings').evaluate().isNotEmpty) {
    await tapVisible(tester, find.text('Save Instagram Settings'));
  }
}

Future<void> _tapCreate(WidgetTester tester) async {
  final nextBtn = find.widgetWithText(ElevatedButton, 'Next: Schedule & Funnel');
  final createBtn = find.widgetWithText(ElevatedButton, 'Create post');

  try {
    await tapVisible(tester, nextBtn);
  } catch (_) {}

  try {
    await tapVisible(tester, createBtn);
  } catch (_) {}
}

void main() {
  appTest('Composer: create sends projectId, clientId, variants and metadata, then opens the post', (tester) async {
    final b = seededBackend()
      ..json('POST', '$sm/posts', {'success': true, 'post': postJson(id: 'post9', title: 'New drop')}, status: 201)
      ..json('GET', '$sm/posts/post9', {'success': true, 'post': postJson(id: 'post9', title: 'New drop')});
    await pumpApp(tester, b, location: '/posts/new?projectId=p1');
    await _fillComposer(tester);
    await _tapCreate(tester);

    final req = b.last('POST', '$sm/posts')!;
    expect(req.json['projectId'], 'p1');
    expect(req.json['clientId'], 'c1');
    expect(req.json['content'], 'Our new drop lands Friday.');
    expect(req.json['mediaType'], 'video');
    expect(req.json['variants'], [
      {'platform': 'instagram', 'customContent': ''},
    ]);
    expect(req.json['metadata'], {'visibility': 'public'});
    expect(req.idempotencyKey, isNotEmpty);
    expect(find.byType(PostDetailScreen), findsOneWidget);
    expect(find.text('New drop'), findsWidgets);
  });

  appTest('Composer: empty caption is rejected locally, nothing is sent', (tester) async {
    final b = seededBackend();
    await pumpApp(tester, b, location: '/posts/new?projectId=p1');
    await _tapCreate(tester);
    expect(find.text('The caption cannot be empty.'), findsOneWidget);
    expect(b.calls('POST', '$sm/posts'), isEmpty);
  });

  appTest('Composer: a 400 {success:false,error} is shown verbatim and the form stays', (tester) async {
    final b = seededBackend()..fail('POST', '$sm/posts', 400, 'socialAccountId does not belong to this project');
    await pumpApp(tester, b, location: '/posts/new?projectId=p1');
    await _fillComposer(tester);
    await _tapCreate(tester);
    expect(find.text('socialAccountId does not belong to this project'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Create post'), findsOneWidget);
  });

  appTest('Offline: a create while offline is queued, shown on the sync badge, and replayed with the same key', (tester) async {
    final b = seededBackend()..networkError('POST', '$sm/posts');
    final h = await pumpApp(tester, b);
    h.router.push('/posts/new?projectId=p1');
    await settle(tester);
    await _fillComposer(tester);
    await _tapCreate(tester);

    expect(find.text('Saved offline. It will sync when you are back online.'), findsOneWidget);
    final outbox = h.container.read(outboxProvider);
    expect(outbox.pendingCount, 1);
    expect(h.outboxStorage.rows.single['path'], '$sm/posts');
    // Back on Home: the app-bar sync indicator shows the queued write.
    final badge = find.descendant(of: find.byType(SyncIndicator), matching: find.text('1'));
    expect(badge, findsOneWidget);

    await tester.tap(find.byType(SyncIndicator));
    await settle(tester);
    expect(find.text('Create post'), findsOneWidget);
    expect(find.text('Offline'), findsOneWidget);

    final firstKey = b.last('POST', '$sm/posts')!.idempotencyKey;
    b.json('POST', '$sm/posts', {'success': true, 'post': postJson(id: 'post9')}, status: 201);
    await tester.tap(find.byTooltip('Sync now'));
    await settle(tester);
    expect(b.last('POST', '$sm/posts')!.idempotencyKey, firstKey);
    expect(outbox.pendingCount, 0);
    expect(find.text('Everything is synced.'), findsOneWidget);
  });

  appTest('Offline: a replay rejected by the server is kept for attention, not dropped', (tester) async {
    final b = seededBackend()..networkError('POST', '$sm/posts');
    final h = await pumpApp(tester, b);
    h.router.push('/posts/new?projectId=p1');
    await settle(tester);
    await _fillComposer(tester);
    await _tapCreate(tester);
    b.fail('POST', '$sm/posts', 400, 'content is required');
    await drive(tester, h.container.read(outboxProvider).drain(force: true));
    await settle(tester);
    final outbox = h.container.read(outboxProvider);
    expect(outbox.attentionCount, 1);
    expect(outbox.mine.single.lastError, 'content is required');
  });

  appTest('Post detail: skeleton, then content; 404 shows retry and Go to Home', (tester) async {
    final b = seededBackend();
    final gate = b.hold('GET', '$sm/posts/post1', {'success': true, 'post': postJson()});
    final h = await pumpApp(tester, b, location: '/posts/post1');
    expect(find.byType(UniversalSkeleton), findsWidgets);
    gate.complete();
    await settle(tester);
    expect(find.text('Launch teaser'), findsWidgets);
    expect(find.text('Wait for it'), findsOneWidget);

    b.fail('GET', '$sm/posts/gone', 404, 'Post not found');
    h.router.go('/posts/gone');
    await settle(tester);
    expect(find.text('Post not found'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Go to Home'), findsOneWidget);
    await tester.tap(find.text('Go to Home'));
    await settle(tester);
    expect(h.router.routerDelegate.currentConfiguration.uri.path, '/home');
  });

  appTest('Post detail: publish validates first and shows the server result verbatim', (tester) async {
    final b = seededBackend()
      ..json('GET', '$sm/posts/:id/validate-publish', {'success': true, 'isReady': true, 'issues': []})
      ..json('POST', '$sm/posts/:id/publish', {
        'success': true,
        'status': 'partially_published',
        'message': '1 of 2 platforms published',
        'publishedLinks': {'instagram': 'https://instagram.com/p/1'},
        'errors': {'linkedin': 'Token expired'},
      });
    await pumpApp(tester, b, location: '/posts/post1');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Publish'));
    await settle(tester);
    await tester.tap(find.text('Auto-Publish (1-Click)'));
    await settle(tester);
    expect(find.text('Publish now?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Publish'));
    await settle(tester);
    expect(b.calls('POST', '$sm/posts/post1/publish'), hasLength(1));
    expect(find.text('Publish: partially_published'), findsOneWidget);
    expect(find.text('✗ linkedin: Token expired'), findsOneWidget);
  });

  appTest('Post detail: not-ready posts never reach the publish endpoint', (tester) async {
    final b = seededBackend()
      ..json('GET', '$sm/posts/:id/validate-publish', {'success': true, 'isReady': false, 'issues': ['No media attached']});
    await pumpApp(tester, b, location: '/posts/post1');
    await tester.tap(find.widgetWithText(ElevatedButton, 'Publish'));
    await settle(tester);
    await tester.tap(find.text('Auto-Publish (1-Click)'));
    await settle(tester);
    expect(find.text('Not ready to publish'), findsOneWidget);
    expect(find.textContaining('No media attached'), findsOneWidget);
    expect(b.calls('POST', '$sm/posts/post1/publish'), isEmpty);
  });
}
