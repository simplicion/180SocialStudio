import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/inbox/conversation_screen.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

/// PRODUCTION_READINESS_PLAN P1 on the phone: inbox deep link, AI auto-reply settings, composer comment funnel.
void main() {
  appTest('Inbox deep link /inbox?conversationId= opens that conversation', (tester) async {
    final b = seededBackend();
    await pumpApp(tester, b, location: '/inbox?conversationId=conv1');
    expect(find.byType(ConversationScreen), findsOneWidget);
    expect(b.last('GET', '$sm/inbox/conversations/conv1'), isNotNull);
  });

  appTest('AI auto-reply: per-account mode and "all Instagram accounts" send the right requests', (tester) async {
    final igA = {'id': 'a1', 'platform': 'instagram', 'accountName': 'Acme IG', 'username': 'acme', 'aiInboxMode': 'off', 'dmSupported': true};
    final igB = {'id': 'a3', 'platform': 'instagram', 'accountName': 'Acme Shop', 'username': 'acmeshop', 'aiInboxMode': 'off', 'dmSupported': true};
    final li = {'id': 'a2', 'platform': 'linkedin', 'accountName': 'Acme LinkedIn', 'aiInboxMode': 'off', 'dmSupported': false};
    final b = seededBackend()
      ..json('GET', '$sm/inbox/ai-settings', {'success': true, 'accounts': [igA, igB, li]})
      ..json('PUT', '$sm/inbox/ai-settings/accounts/:id', {'success': true, 'account': {...igA, 'aiInboxMode': 'qualify'}})
      ..json('PUT', '$sm/inbox/ai-settings/bulk', {'success': true, 'updated': 2, 'mode': 'reply'});
    await pumpApp(tester, b, location: '/inbox');
    await tapVisible(tester, find.widgetWithText(ActionChip, 'AI auto-reply'));
    expect(find.text('All 2 Instagram accounts'), findsOneWidget);
    expect(find.textContaining('LinkedIn DMs do not reach'), findsOneWidget);

    await tapVisible(tester, find.widgetWithText(OutlinedButton, 'Reply'));
    expect(b.last('PUT', '$sm/inbox/ai-settings/bulk')!.json, {'mode': 'reply', 'platform': 'instagram', 'projectId': 'p1'}); // scoped to the active project
    expect(find.text('AI auto-reply is on for 2 Instagram account(s).'), findsOneWidget);

    await tapVisible(tester, find.descendant(of: find.byType(SegmentedButton<String>).first, matching: find.text('Qualify leads')));
    expect(b.last('PUT', '$sm/inbox/ai-settings/accounts/a1')!.json, {'mode': 'qualify'});
  });

  appTest('Composer funnel: no keyword answers every comment; the reply goes to actionPublicReplies; no AI follow-up', (tester) async {
    final b = seededBackend()
      ..json('POST', '$sm/posts', {'success': true, 'post': postJson(id: 'post9', title: 'New drop')}, status: 201)
      ..json('GET', '$sm/posts/post9', {'success': true, 'post': postJson(id: 'post9', title: 'New drop')})
      ..json('POST', '$sm/engagement/rules', {
        'success': true,
        'rule': {'id': 'r1', 'companyId': 'co', 'name': 'x', 'triggerType': 'comment_any', 'actionDmTemplate': 'Here: https://acme.test/g'},
      }, status: 201);
    await pumpApp(tester, b, location: '/posts/new?projectId=p1');
    await tester.enterText(find.widgetWithText(TextField, 'Caption *'), 'Our new drop lands Friday.');
    await tapVisible(tester, find.widgetWithText(FilterChip, 'Instagram'));
    if (find.text('Save Instagram Settings').evaluate().isNotEmpty) await tapVisible(tester, find.text('Save Instagram Settings'));
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Next: Schedule & Funnel'));
    await tapVisible(tester, find.text('Enable Auto-DM & Comment Funnel'));

    // DM text is required once the funnel is on: nothing is sent without it.
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Create post'));
    expect(b.calls('POST', '$sm/posts'), isEmpty);

    await tester.enterText(find.widgetWithText(TextField, 'Direct message *'), 'Here: https://acme.test/g');
    await tester.enterText(find.widgetWithText(TextField, 'Comment reply (optional)'), 'Sent it to your DMs!');
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Create post'));

    final rule = b.last('POST', '$sm/engagement/rules')!.json;
    expect(rule['postId'], 'post9');
    expect(rule['triggerType'], 'comment_any');
    expect(rule['triggerKeywords'], isEmpty);
    expect(rule['actionPublicReplies'], ['Sent it to your DMs!']);
    expect(rule['actionDmTemplate'], 'Here: https://acme.test/g');
    expect(rule['actionEnableAiAgent'], false);
  });
}
