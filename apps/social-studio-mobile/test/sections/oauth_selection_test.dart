import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/workspace/account_selection_sheet.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

void main() {
  appTest('page picker connects only the chosen pages', (tester) async {
    final b = seededBackend()
      ..json('GET', '$sm/accounts/oauth/selections/:id', {
        'success': true,
        'selectionId': 'sel1',
        'platform': 'facebook',
        'candidates': [
          {'candidateId': 'c1', 'kind': 'page', 'accountName': 'Acme Coffee'},
          {'candidateId': 'c2', 'kind': 'instagram_business', 'accountName': 'Acme IG', 'username': 'acme'},
        ],
      })
      ..json('POST', '$sm/accounts/oauth/selections/:id', {'success': true, 'accounts': [accountJson()]}, status: 201);
    final h = await pumpApp(tester, b);
    final ctx = tester.element(find.byType(Navigator).first);
    showAccountSelectionSheet(ctx, 'sel1');
    await settle(tester);
    expect(find.text('Facebook Page'), findsOneWidget);
    expect(find.text('Instagram account · @acme'), findsOneWidget);
    expect(tester.widget<ElevatedButton>(find.byType(ElevatedButton).last).onPressed, isNull);
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Acme IG'));
    await settle(tester);
    await tester.tap(find.text('Connect 1'));
    await settle(tester);
    expect(b.last('POST', '$sm/accounts/oauth/selections/sel1')!.json, {'candidateIds': ['c2']});
    expect(find.byType(AccountSelectionSheet), findsNothing);
    expect(h, isNotNull);
  });
}
