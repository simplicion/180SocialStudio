import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

void main() {
  Future<void> openManager(WidgetTester tester) async {
    await tester.tap(find.byTooltip('180 Manager AI'));
    await settle(tester);
  }

  Future<void> send(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField).last, text);
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await settle(tester);
  }

  appTest('Manager: first message starts a server conversation and later turns reuse its id', (tester) async {
    final b = seededBackend()
      ..json('POST', '$sm/manager/chat', {
        'success': true,
        'reply': 'You published 3 posts this month.',
        'intent': 'analytics',
        'delegatedAgents': ['analytics'],
        'suggestedActions': [],
        'conversationId': 'conv-123',
      });
    await pumpApp(tester, b);
    await openManager(tester);
    await send(tester, 'How many posts this month?');
    expect(find.textContaining('You published 3 posts this month.'), findsOneWidget);
    expect(b.calls('POST', '$sm/manager/chat').first.json.containsKey('conversationId'), isFalse);
    await send(tester, 'And last week?');
    expect(b.last('POST', '$sm/manager/chat')!.json['conversationId'], 'conv-123');
  });

  appTest('Manager: no AI configured shows the server reason, not a canned answer', (tester) async {
    final b = seededBackend()
      ..fail('POST', '$sm/manager/chat', 503, 'No AI provider is configured for this workspace. Add one in Settings > AI.');
    await pumpApp(tester, b);
    await openManager(tester);
    await send(tester, 'How is engagement?');
    expect(find.textContaining('No AI provider is configured'), findsOneWidget);
  });
}
