import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

Map<String, dynamic> _ok(Object data) => {'success': true, 'data': data};

Map<String, dynamic> _overview({Map<String, dynamic>? ownPosts, List<Map<String, dynamic>> priority = const [], bool connected = true}) => {
      'platform': 'instagram',
      'connected': connected,
      'accounts': connected ? [{'id': 'a1', 'platform': 'instagram', 'accountName': 'Northwind', 'username': 'northwind', 'reauthRequired': false}] : [],
      'pipeline': {'published30d': 6, 'scheduledUpcoming': 0, 'failed30d': 0},
      'queue': [],
      'queueCraftScoreAvg': null,
      'inbox': {'unread': priority.length, 'sampled': priority.length, 'bucketCounts': {'LEAD': priority.length}, 'priority': priority},
      'metrics': [],
      'metricsError': null,
      'ownPosts': ownPosts ?? {'basis': 'views', 'baseline': null, 'published': 6, 'measured': 0, 'needsMore': 5, 'outliers': 0, 'provenFormulas': [], 'lastFetchedAt': null, 'top': []},
      'rewardedSignals': ['saves'],
      'playbook': ['Max 5 hashtags.'],
    };

const _ranked = {
  'basis': 'views',
  'baseline': 110,
  'published': 6,
  'measured': 6,
  'needsMore': 0,
  'outliers': 1,
  'provenFormulas': [{'formulaName': 'Nobody Tells You', 'count': 1}],
  'lastFetchedAt': '2026-10-07T10:00:00.000Z',
  'top': [
    {'postId': 'post5', 'hook': 'Nobody tells you your first 30 posts flop', 'outlierMultiple': 7.3, 'isOutlier': true, 'formulaName': 'Nobody Tells You', 'metrics': {'views': 800, 'likes': 40}},
    {'postId': 'post2', 'hook': 'A normal post', 'outlierMultiple': 1.1, 'isOutlier': false, 'formulaName': null, 'metrics': {'views': 120}},
  ],
};

const _radarEmpty = {'platform': 'instagram', 'supported': true, 'handles': [], 'scan': null, 'maxHandles': 10};

final monitorList = find.descendant(of: find.byKey(const Key('cc-monitor-list')), matching: find.byType(Scrollable)).first;

void main() {
  group('Command Center insights', () {
    appTest('own posts: unmeasured posts ask for a refresh; refresh calls the server and reloads the ranking', (tester) async {
      var loads = 0;
      final b = seededBackend()
        ..on('GET', '$sm/platform-team/:platform/overview', (_) => FakeResponse.json(_ok(_overview(ownPosts: ++loads > 1 ? _ranked : null))))
        ..json('GET', '$sm/platform-team/:platform/radar', _ok(_radarEmpty))
        ..json('POST', '$sm/platform-team/:platform/posts/refresh-metrics', _ok({'refresh': {'checked': 6, 'updated': 6, 'skippedFresh': 0, 'failed': []}, 'ranking': _ranked, 'remembered': 6}));
      await pumpApp(tester, b, location: '/command-center?platform=instagram');
      final list = monitorList;
      await tester.scrollUntilVisible(find.text('Refresh numbers'), 300, scrollable: list);
      expect(find.textContaining('6 published posts have no numbers yet'), findsOneWidget);
      expect(find.textContaining('7.3x'), findsNothing);

      await tester.tap(find.text('Refresh numbers'));
      await settle(tester);
      expect(b.last('POST', '$sm/platform-team/instagram/posts/refresh-metrics')!.json['projectId'], 'p1');
      await tester.scrollUntilVisible(find.text('7.3x'), 200, scrollable: list);
      expect(find.text('Nobody tells you your first 30 posts flop'), findsOneWidget);
      expect(find.textContaining('your median of 110 views'), findsOneWidget);
    });

    appTest('radar: add a handle, scan, and see ranked posts with per-account errors', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/platform-team/:platform/overview', _ok(_overview()))
        ..json('GET', '$sm/platform-team/:platform/radar', _ok(_radarEmpty))
        ..json('PUT', '$sm/platform-team/:platform/radar', _ok({..._radarEmpty, 'handles': ['rival']}))
        ..json('POST', '$sm/platform-team/:platform/radar/scan', _ok({
          ..._radarEmpty,
          'handles': ['rival'],
          'scan': {
            'fetchedAt': '2026-10-07T11:00:00.000Z',
            'accounts': [{'handle': 'rival', 'basis': 'engagements', 'baseline': 65, 'posts': 5, 'error': null}, {'handle': 'private_one', 'error': 'user is not a business account'}],
            'top': [{'account': 'rival', 'hook': 'Stop flossing less when your gums bleed', 'outlierMultiple': 9.3, 'isOutlier': true, 'likes': 600, 'comments': 5}],
            'outliers': 1,
            'provenFormulas': [],
          },
        }));
      await pumpApp(tester, b, location: '/command-center?platform=instagram');
      final list = monitorList;
      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'Add a handle'), 300, scrollable: list);
      await tester.enterText(find.widgetWithText(TextField, 'Add a handle'), '@rival');
      await tester.tap(find.byTooltip('Add account'));
      await settle(tester);
      expect(b.last('PUT', '$sm/platform-team/instagram/radar')!.json['handles'], ['@rival']);
      await tester.scrollUntilVisible(find.text('Scan their recent posts'), 200, scrollable: list);
      await tester.tap(find.text('Scan their recent posts'));
      await settle(tester);
      await tester.scrollUntilVisible(find.text('9.3x'), 200, scrollable: list);
      expect(find.text('Stop flossing less when your gums bleed'), findsOneWidget);
      expect(find.textContaining('not a business account'), findsOneWidget);
    });

    appTest('radar on a platform with no API explains why and offers the manual check', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/platform-team/:platform/overview', _ok(_overview()))
        ..json('GET', '$sm/platform-team/:platform/radar', _ok({'platform': 'linkedin', 'supported': false, 'handles': [], 'scan': null}));
      await pumpApp(tester, b, location: '/command-center?platform=linkedin');
      await tester.scrollUntilVisible(find.text('Check a post by hand'), 300, scrollable: monitorList);
      expect(find.textContaining('no way to read other accounts'), findsOneWidget);
    });

    appTest('reply drafts: shown for a triaged lead; sending needs a confirmation', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/platform-team/:platform/overview', _ok(_overview(priority: [
          {'conversationId': 'cv1', 'author': 'ana', 'text': 'What is the price for a cleaning?', 'bucket': 'LEAD', 'nextStep': 'Answer in public, then continue in DM.'},
        ])))
        ..json('GET', '$sm/platform-team/:platform/radar', _ok(_radarEmpty))
        ..json('POST', '$sm/platform-team/:platform/replies/draft', _ok({
          'bucket': 'LEAD',
          'nextStep': 'Answer in public, then continue in DM.',
          'suggestions': [{'tone': 'warm', 'text': 'Happy to help. I will send the details in a DM.'}],
        }));
      await pumpApp(tester, b, location: '/command-center?platform=instagram');
      await tester.scrollUntilVisible(find.text('Draft reply'), 500, scrollable: monitorList);
      await tester.tap(find.text('Draft reply'));
      await settle(tester);
      expect(find.text('Reply to @ana'), findsOneWidget);
      expect(find.text('Happy to help. I will send the details in a DM.'), findsOneWidget);
      expect(b.last('POST', '$sm/platform-team/instagram/replies/draft')!.json['conversationId'], 'cv1');

      await tester.tap(find.widgetWithText(FilledButton, 'Send'));
      await settle(tester);
      expect(find.text('Send this reply?'), findsOneWidget, reason: 'nothing is sent without a confirmation');
      expect(b.calls('POST', '$sm/inbox/conversations/cv1/messages'), isEmpty);
    });
  });
}
