import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

/// A platform's caption copy that was never edited follows later edits of the main caption (P2.9).
void main() {
  appTest('editing the main caption after opening a platform sheet does not publish the stale copy', (tester) async {
    final b = seededBackend()
      ..json('POST', '$sm/posts', {'success': true, 'post': postJson(id: 'post9', title: 'New drop')}, status: 201)
      ..json('GET', '$sm/posts/post9', {'success': true, 'post': postJson(id: 'post9', title: 'New drop')});
    await pumpApp(tester, b, location: '/posts/new?projectId=p1');
    final caption = find.widgetWithText(TextField, 'Caption *');
    await tester.enterText(caption, 'First draft');
    await tapVisible(tester, find.widgetWithText(FilterChip, 'Instagram'));
    if (find.text('Save Instagram Settings').evaluate().isNotEmpty) await tapVisible(tester, find.text('Save Instagram Settings'));
    await tester.enterText(caption, 'Final caption');
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Next: Schedule & Funnel'));
    await tapVisible(tester, find.widgetWithText(ElevatedButton, 'Create post'));
    final req = b.last('POST', '$sm/posts')!.json;
    expect(req['content'], 'Final caption');
    expect((req['variants'] as List).single['customContent'], '');
  });
}
