import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

Map<String, dynamic> _cluster() => {
      'id': 'c1',
      'title': 'Creatine for women over 40',
      'summary': 'Women over 40 are asking whether creatine helps strength.',
      'whyNow': 'New studies and a wave of posts this week.',
      'audienceQuestions': ['Does creatine cause bloating?'],
      'brandFit': 'strong',
      'brandFitReason': 'Directly serves your audience.',
      'metrics': {
        'volume': {'reddit': 4, 'youtube': 3},
        'totalItems': 7,
        'engagementIndex': 70,
        'momentum': 2.1,
        'momentumLabel': 'rising',
        'saturation': {'youtubeUploads30d': 150, 'youtubeMedianViews': 42000, 'youtubeSampled': 3, 'label': 'low'},
        'sentiment': {'positive': 60, 'negative': 20, 'mixed': 20, 'neutral': 0, 'n': 10},
        'brandFit': 85,
        'opportunityScore': 78,
        'confidence': 90,
        'verdict': 'create_now',
        'verdictReasons': ['Rising: 2.1x more posts per day this week than earlier in the month.'],
      },
      'items': [
        {'id': 'p1', 'source': 'reddit', 'url': 'https://www.reddit.com/r/x/1', 'title': 'I started creatine at 45', 'publishedAt': '2026-11-01', 'engagement': {'primary': 812, 'upvotes': 812, 'views': null, 'likes': null, 'comments': 240}},
      ],
      'reactionQuotes': [
        {'quote': 'the bloating went away after a week', 'source': 'reddit', 'url': 'https://www.reddit.com/r/x/1'},
      ],
      'angles': [
        {'id': 'c1-a1', 'title': 'The bloating myth', 'tension': 'Women fear the scale going up', 'draftHook': 'Creatine bloat is a week-one problem', 'format': 'reel', 'hookScore': 72, 'hookGrade': 'STRONG'},
      ],
    };

Map<String, dynamic> _report({String status = 'done', int progress = 100, String stage = 'done', List<Map<String, dynamic>>? clusters}) => {
      'success': true,
      'reportId': 'r1',
      'topic': 'creatine for women',
      'status': status,
      'stage': stage,
      'progress': progress,
      'detail': status == 'running' ? '1/3 research agents finished' : null,
      'error': status == 'failed' ? {'code': 'AI_NOT_CONFIGURED', 'message': 'Trend Lab needs an AI provider key.'} : null,
      'report': status != 'done'
          ? null
          : {
              'topic': 'creatine for women',
              'windowDays': 30,
              'clusters': clusters ?? [_cluster()],
              'statuses': [
                {'agent': 'social_pulse', 'source': 'reddit', 'status': 'ok', 'items': 4},
                {'agent': 'platform_signal', 'source': 'instagram', 'status': 'skipped', 'items': 0},
              ],
              'outlook': {'available': false, 'basedOnPosts': 3, 'byFormat': [], 'note': 'Not enough history yet: 3 of 10 published posts with metrics.'},
              'methodology': ['Opportunity (0-100) = 35% engagement index + ...'],
            },
    };

final _script = {
  'success': true,
  'pieceId': 'pc1',
  'calendarId': 'cal-tl',
  'status': 'done',
  'error': null,
  'piece': {
    'id': 'pc1',
    'calendarId': 'cal-tl',
    'headline': 'The bloating myth',
    'contentType': 'Reel',
    'platform': 'instagram',
    'adCopyFull': 'Creatine bloat is real for a week. Here is what happens next.',
    'status': 'ready',
    'mood': 'storytelling',
    'trend': {'title': 'Creatine for women over 40', 'whyNow': 'A wave of posts', 'signal': 'rising · opportunity 78/100 · 7 posts', 'audienceQuestions': [], 'sourceUrls': ['https://www.reddit.com/r/x/1']},
    'videoScriptOrHooks':
        '{"schema":"autopilot.v1","format":"reel","spokenHook":"Your creatine bloat ends in week two","onScreenHook":"CREATINE BLOAT?","hookScore":74,"script":{"hook":"Your creatine bloat ends in week two","body":[{"beat":"Water moves into muscle first"},{"beat":"Most women feel it for 7 days"}],"retentionLoop":"Week two pays off","cta":"DM START","estimatedDurationSec":45}}',
  },
};

Map<String, dynamic> _reaction({String method = 'heuristic'}) => {
      'success': true,
      'data': {
        'kind': 'hook',
        'platform': 'instagram',
        'craft': {'score': 72, 'hook': {'text': 'x', 'score': 70, 'grade': 'STRONG', 'formula': null, 'recommendations': ['Add a number']}, 'lintFails': [], 'humanScore': null},
        'panel': {
          'personas': [
            {'persona': 'Busy mum of two', 'scrollStop': 4, 'readThrough': 3, 'action': 'save', 'comment': 'Saving this', 'confusion': '', 'reason': 'Speaks to my evenings'},
            {'persona': 'Skeptical lifter', 'scrollStop': 2, 'readThrough': 2, 'action': 'skip', 'comment': '', 'confusion': 'What is a loading phase?', 'reason': 'Heard it before'},
          ],
          'scrollStop': 3.0,
          'readThrough': 2.5,
          'disagreement': 1.0,
          'actions': {'save': 50, 'share': 0, 'comment': 0, 'follow': 0, 'skip': 50},
          'confusions': ['What is a loading phase?'],
        },
        'panelError': null,
        'outlook': {
          'label': 'above',
          'method': method,
          'confidence': method == 'own_history' ? 'medium' : 'low',
          'probability': null,
          'basedOnPosts': 4,
          'modelAuc': null,
          'note': 'Early estimate from craft signals and the audience panel. With 26 more published posts with metrics, this will learn from your own results.',
        },
      },
    };

void main() {
  group('Check My Content', () {
    appTest('tool list opens a single tool with a platform switcher', (tester) async {
      final b = seededBackend();
      await pumpApp(tester, b, location: '/trend-lab/check?projectId=p1');
      expect(find.text('Score your hook'), findsOneWidget);
      expect(find.text('How will people react?'), findsOneWidget);
      await tester.tap(find.text('Caption check'));
      await settle(tester);
      expect(find.textContaining('caption check'), findsWidgets);
      expect(find.text('Hook score'), findsNothing);
      expect(find.text('Instagram'), findsOneWidget);
    });

    appTest('reaction simulator: sends kind, text and project; shows outlook, panel and the honest confidence label', (tester) async {
      final b = seededBackend()..json('POST', '$sm/platform-team/:platform/check/reaction', _reaction());
      await pumpApp(tester, b, location: '/trend-lab/check/reaction?projectId=p1');
      await tester.enterText(find.byType(TextField).first, 'Creatine bloat is a week-one problem');
      await tester.tap(find.text('Simulate reactions'));
      await settle(tester);
      final req = b.last('POST', '$sm/platform-team/instagram/check/reaction')!.json;
      expect(req['kind'], 'hook');
      expect(req['projectId'], 'p1');
      expect(find.text('Likely above your usual'), findsOneWidget);
      expect(find.text('Early estimate · low confidence'), findsOneWidget);
      final list = find.byType(Scrollable).first;
      await tester.scrollUntilVisible(find.textContaining('Busy mum of two'), 200, scrollable: list);
      expect(find.textContaining('Would comment: "Saving this"'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Confusing: What is a loading phase?'), 200, scrollable: list);
    });

    appTest('profile audit can use the connected account', (tester) async {
      final b = seededBackend()
        ..json('POST', '$sm/platform-team/:platform/profile/audit-connected', {
          'success': true,
          'data': {
            'source': 'connected_account',
            'fields': {'handle': 'northwind'},
            'followers': 1000,
            'audit': {'totalScore': 64, 'items': [], 'prioritizedActionPlan': ['Add a clear call to action to your bio']},
            'content': {'postsAnalyzed': 12, 'postsPerWeek': 1.5, 'cadenceRegularity': 40, 'formatMix': {'reel': 25, 'static': 75}, 'avgHookScore': 48, 'engagementRatePct': 0.8, 'score': 45, 'findings': ['Your posting is bursty.']},
          },
        });
      await pumpApp(tester, b, location: '/trend-lab/check/profile?projectId=p1');
      await tester.tap(find.text('Use my connected account'));
      await settle(tester);
      expect(b.last('POST', '$sm/platform-team/instagram/profile/audit-connected')!.json['projectId'], 'p1');
      expect(find.text('@northwind · 1000 followers'), findsOneWidget);
      final list = find.byType(Scrollable).first;
      await tester.scrollUntilVisible(find.text('• Your posting is bursty.'), 200, scrollable: list);
      expect(find.text('• Add a clear call to action to your bio'), findsOneWidget);
      // LinkedIn has no profile API: only manual entry.
      await tester.drag(find.text('Instagram'), const Offset(-400, 0));
      await settle(tester);
      await tester.tap(find.text('LinkedIn'));
      await settle(tester);
      expect(find.text('LinkedIn profile audit'), findsOneWidget);
      expect(find.text('Use my connected account'), findsNothing);
    });
  });

  group('Trend Lab', () {
    appTest('report: verdict, code-computed numbers, verbatim quotes, angles and sources', (tester) async {
      final b = seededBackend()..json('GET', '$sm/projects/p1/trend-lab/reports/r1', _report());
      await pumpApp(tester, b, location: '/trend-lab/reports/r1?projectId=p1');
      expect(find.text('Create now'), findsOneWidget);
      expect(find.text('78/100'), findsOneWidget);
      expect(find.text('Confidence 90%'), findsOneWidget);
      final list = find.byType(Scrollable).first;
      await tester.scrollUntilVisible(find.textContaining('the bloating went away after a week'), 300, scrollable: list);
      expect(find.textContaining('60% positive'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('The bloating myth'), 300, scrollable: list);
      expect(find.textContaining('Creatine bloat is a week-one problem'), findsOneWidget);
      await tester.scrollUntilVisible(find.textContaining('Not enough history yet'), 300, scrollable: list);
      await tester.scrollUntilVisible(find.text('instagram · skipped'), 300, scrollable: list);
      expect(find.text('Create script from this'), findsOneWidget);
    });

    appTest('progress shows the research agents, then the finished report', (tester) async {
      var polls = 0;
      final b = seededBackend()
        ..on('GET', '$sm/projects/p1/trend-lab/reports/r1',
            (_) => FakeResponse.json(++polls == 1 ? _report(status: 'running', progress: 33, stage: 'social_pulse') : _report()));
      await pumpApp(tester, b, location: '/trend-lab/reports/r1?projectId=p1');
      expect(find.text('Researching the last 30 days'), findsOneWidget);
      expect(find.text('Analyst agent: stories, reactions and angles'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await settle(tester);
      expect(find.text('Create now'), findsOneWidget);
    });

    appTest('a failed report explains why', (tester) async {
      final b = seededBackend()..json('GET', '$sm/projects/p1/trend-lab/reports/r1', _report(status: 'failed', stage: 'failed'));
      await pumpApp(tester, b, location: '/trend-lab/reports/r1?projectId=p1');
      expect(find.textContaining('Trend Lab needs an AI provider key'), findsOneWidget);
    });

    appTest('no trends found shows which sources were read', (tester) async {
      final b = seededBackend()..json('GET', '$sm/projects/p1/trend-lab/reports/r1', _report(clusters: const []));
      await pumpApp(tester, b, location: '/trend-lab/reports/r1?projectId=p1');
      expect(find.text('No recent discussion found'), findsOneWidget);
      expect(find.text('reddit · 4'), findsOneWidget);
    });

    appTest('create script: format/platform rules, request body, then the ready script with its actions', (tester) async {
      final b = seededBackend()
        ..json('GET', '$sm/projects/p1/trend-lab/reports/r1', _report())
        ..json('POST', '$sm/projects/p1/trend-lab/reports/r1/scripts', {'success': true, 'pieceId': 'pc1', 'calendarId': 'cal-tl', 'status': 'generating'}, status: 202)
        ..json('GET', '$sm/projects/p1/trend-lab/scripts/pc1', _script);
      await pumpApp(tester, b, location: '/trend-lab/reports/r1?projectId=p1');
      await tester.tap(find.text('Create script from this'));
      await settle(tester);
      expect(find.text('Create a script'), findsOneWidget);

      // Text posts are not possible on Instagram/YouTube: the sheet says which platforms are skipped.
      await tester.tap(find.text('Text'));
      await settle(tester);
      expect(find.textContaining('Skipped for this format'), findsOneWidget);
      await tester.tap(find.text('Video'));
      await settle(tester);
      final sheet = find.byType(Scrollable).last;
      await tester.scrollUntilVisible(find.text('60s'), 150, scrollable: sheet);
      await tester.tap(find.text('60s'));
      await tester.scrollUntilVisible(find.text('Storytelling'), 150, scrollable: sheet);
      await tester.tap(find.text('Storytelling'));
      await settle(tester);
      await tester.scrollUntilVisible(find.text('Create script'), 200, scrollable: sheet);
      await tester.tap(find.text('Create script'));
      await settle(tester);

      final body = b.last('POST', '$sm/projects/p1/trend-lab/reports/r1/scripts')!.json;
      expect(body['clusterId'], 'c1');
      expect(body['angleId'], 'c1-a1');
      expect(body['format'], 'video');
      expect(body['durationSec'], 60);
      expect(body['mood'], 'storytelling');

      expect(find.text('Your creatine bloat ends in week two'), findsOneWidget);
      expect(find.text('1. Water moves into muscle first'), findsOneWidget);
      final list = find.byType(Scrollable).first;
      await tester.scrollUntilVisible(find.text('WHY THIS IS TIMELY'), 300, scrollable: list);
      await tester.scrollUntilVisible(find.text('Save to Library'), 300, scrollable: list);
      expect(find.text('Shoot with teleprompter'), findsOneWidget);
      expect(find.text('Full script & shooting plan'), findsOneWidget);
    });
  });
}
