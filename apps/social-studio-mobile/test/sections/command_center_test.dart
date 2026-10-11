import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

Map<String, dynamic> _overview(Map<String, dynamic> data) => {'success': true, 'data': data};

const _empty = {
  'platform': 'instagram',
  'connected': false,
  'accounts': [],
  'pipeline': {'published30d': 0, 'scheduledUpcoming': 0, 'failed30d': 0},
  'queue': [],
  'queueCraftScoreAvg': null,
  'inbox': {'unread': 0, 'sampled': 0, 'bucketCounts': {}, 'priority': []},
  'metrics': [],
  'metricsError': null,
  'rewardedSignals': ['saves'],
  'playbook': ['Max 5 hashtags.'],
};

final monitorList = find.descendant(of: find.byKey(const Key('cc-monitor-list')), matching: find.byType(Scrollable)).first;

void main() {
  group('Command Center', () {
    appTest('All Channels overview: renders monthly script quota and 24h agent intelligence pulse', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/projects/:id/analytics', {
          'success': true,
          'analytics': {
            'postsPublished': 5,
            'postsCreated': 12,
            'postsScheduledInRange': 3,
            'postsScheduledUpcoming': 3,
            'postsFailed': 0,
            'published_instagram': 3,
            'published_linkedin': 2,
          },
        });
      await pumpApp(tester, b, location: '/command-center');
      expect(find.text('Command Center & Analytics'), findsOneWidget);
      expect(find.text('Monthly Content & Script Capacity'), findsOneWidget);
      expect(find.text('18 scripts remaining for this month\'s target'), findsOneWidget);
      expect(find.text('24-Hour AI Agent Intelligence Pulse'), findsOneWidget);
      expect(find.text('All'), findsOneWidget);
    });

    appTest('no account connected: an empty state with a connect action and no sample numbers', (tester) async {
      final b = seededBackend()..json('GET', '$sm/platform-team/:platform/overview', _overview(_empty));
      await pumpApp(tester, b, location: '/command-center?platform=instagram');
      expect(find.text('No Instagram account connected'), findsOneWidget);
      expect(find.text('Connect Instagram'), findsOneWidget);
      expect(find.textContaining('@scale_growth'), findsNothing);
      expect(b.last('GET', '$sm/platform-team/instagram/overview')!.query['projectId'], 'p1');
    });

    appTest('switching platform loads that platform; queue problems and inbox leads come from the server', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/platform-team/instagram/overview', _overview(_empty))
        ..json('GET', '$sm/platform-team/linkedin/overview', _overview({
          ..._empty,
          'platform': 'linkedin',
          'connected': true,
          'accounts': [{'id': 'a1', 'platform': 'linkedin', 'accountName': 'Northwind Dental', 'username': 'northwind', 'reauthRequired': true}],
          'pipeline': {'published30d': 4, 'scheduledUpcoming': 2, 'failed30d': 1},
          'queue': [
            {'postId': 'post1', 'title': 'Gum health', 'status': 'scheduled', 'craftScore': 59, 'feedCutout': 'Hello everyone', 'problems': ['4 hashtags; LinkedIn works best with at most 3.'], 'warnings': []},
          ],
          'queueCraftScoreAvg': 59,
          'inbox': {
            'unread': 1,
            'sampled': 2,
            'bucketCounts': {'LEAD': 1, 'SUPPORT': 1},
            'priority': [{'conversationId': 'cv1', 'author': 'ana', 'text': 'What is the price for a cleaning?', 'bucket': 'LEAD', 'nextStep': 'Answer in public, then continue in DM.'}],
          },
          'metrics': [{'socialAccountId': 'a1', 'source': 'unavailable', 'followersCount': null, 'unavailable': {'message': 'Missing permission r_organization_social'}}],
        }));
      await pumpApp(tester, b, location: '/command-center?platform=instagram');
      await tester.tap(find.text('LinkedIn'));
      await settle(tester);

      expect(find.text('Northwind Dental'), findsOneWidget);
      expect(find.text('Reconnect'), findsOneWidget);
      expect(find.text('Missing permission r_organization_social'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Gum health'), 300, scrollable: monitorList);
      expect(find.textContaining('4 hashtags'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('What is the price for a cleaning?'), 300, scrollable: monitorList);
      expect(find.text('LEAD'), findsOneWidget);
    });

    appTest('overview error: retry and a second way out', (tester) async {
      final b = seededBackend()..fail('GET', '$sm/platform-team/:platform/overview', 500, 'boom');
      await pumpApp(tester, b, location: '/command-center?platform=instagram');
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Open connected accounts'), findsOneWidget);
    });

    appTest('Check tab scores a hook with the server rules for the selected platform', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/platform-team/:platform/overview', _overview(_empty))
        ..json('POST', '$sm/platform-team/:platform/hooks/score', {
          'success': true,
          'data': {
            'spoken': true,
            'ranked': [
              {'hook': 'Stop flossing less when your gums bleed', 'totalScore': 74, 'grade': 'STRONG', 'formulaName': 'Negative Command', 'recommendations': ['Add an exact number, dollar cost, or named entity.']},
            ],
          },
        });
      await pumpApp(tester, b, location: '/command-center?platform=x');
      await tester.tap(find.text('Check'));
      await settle(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Hook or opening line'), 'Stop flossing less when your gums bleed');
      await tester.tap(find.text('Score'));
      await settle(tester);
      expect(find.text('74/100 · strong'), findsOneWidget);
      expect(find.text('Shape: Negative Command'), findsOneWidget);
      final call = b.last('POST', '$sm/platform-team/x/hooks/score')!;
      expect(call.json['hooks'], ['Stop flossing less when your gums bleed']);
    });

    appTest('Create tab: AI not configured shows the reason, retry and a path to settings', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/platform-team/:platform/overview', _overview(_empty))
        ..json('POST', '$sm/platform-team/:platform/draft', {'success': false, 'code': 'AI_NOT_CONFIGURED', 'error': 'No usable AI provider key for this workspace.'}, status: 503);
      await pumpApp(tester, b, location: '/command-center?platform=instagram');
      await tester.tap(find.text('Create'));
      await settle(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Your idea'), 'Why gums bleed when you floss');
      await tester.tap(find.text('Write it'));
      await settle(tester);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Check AI settings'), findsOneWidget);
    });
  });
}
