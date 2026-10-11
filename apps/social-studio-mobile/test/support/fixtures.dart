/// Canned payloads shaped like the real backend responses
/// (apps/backend/src/api/v1/social-media/*, identity/auth/auth.controller.ts getMe,
/// platform-billing/entitlements.ts computeEntitlements).
library;

import 'fake_backend.dart';

const sm = '/api/v1/social-media';

Map<String, dynamic> meJson({List<String> availableApps = const ['social-media'], String status = 'active'}) => {
      'user': {'id': 'u1', 'name': 'Riya Agent', 'email': 'riya@agency.test', 'role': 'admin', 'permissions': []},
      'role': 'admin',
      'permissions': [],
      'entitlements': {
        'subscriptionStatus': status,
        'isPaidPlan': true,
        'enabledApps': availableApps,
        'disabledByAdmin': <String>[],
        'availableApps': availableApps,
      },
      'company': {
        '_id': 'co1',
        'companyName': 'Northwind Agency',
        'slug': 'northwind',
        'logoUrl': null,
        'isSuspended': false,
        'metadata': {'enabledApps': availableApps},
        'enabledApps': availableApps,
        'enabledModules': [],
      },
    };

Map<String, dynamic> accountJson({
  String id = 'a1',
  String platform = 'instagram',
  String name = 'Acme IG',
  String? projectId = 'p1',
  String? projectName = 'Acme Launch',
  bool reauth = false,
}) =>
    {
      'id': id,
      'platform': platform,
      'accountName': name,
      'username': name.toLowerCase().replaceAll(' ', '_'),
      'projectId': projectId,
      'project': projectName == null ? null : {'id': projectId, 'name': projectName},
      'isActive': true,
      'reauthRequired': reauth,
      'tokenExpiresAt': null,
    };

Map<String, dynamic> projectJson({
  String id = 'p1',
  String name = 'Acme Launch',
  String? clientId = 'c1',
  List<Map<String, dynamic>>? accounts,
}) =>
    {
      'id': id,
      'name': name,
      'description': 'Q3 launch campaign',
      'status': 'in_progress',
      'priority': 'high',
      'startDate': '2026-09-01T00:00:00.000Z',
      'deadline': '2026-12-31T00:00:00.000Z',
      'clientIds': clientId == null ? <String>[] : [clientId],
      'memberIds': ['u1'],
      'socialServices': ['content_calendar', 'publishing'],
      'socialSettings': {'approvalRequired': true, 'defaultTimezone': 'UTC', 'storageRetentionDays': 30},
      'socialAccounts': accounts ?? [accountJson()],
      'metrics': {'scheduledPosts': 3, 'pendingApprovals': 1, 'outstandingTasks': 2, 'publishedPosts': 4, 'totalPosts': 10},
      'pendingReviewSessions': [],
      'client': clientId == null ? null : {'id': clientId, 'name': 'Acme Corp', 'email': 'marketing@acme.test'},
      'createdAt': '2026-08-20T10:00:00.000Z',
    };

Map<String, dynamic> postJson({
  String id = 'post1',
  String title = 'Launch teaser',
  String status = 'draft',
  String? scheduledFor,
  bool evergreen = false,
  String projectId = 'p1',
}) =>
    {
      'id': id,
      'title': title,
      'content': 'Something big is coming. #acme',
      'status': status,
      'mediaType': 'video',
      'mediaUrls': [],
      'rawMediaUrls': [],
      'externalStorageLinks': [],
      'scheduledFor': scheduledFor,
      'isEvergreen': evergreen,
      'reuseCount': 0,
      'versionNumber': 1,
      'metadata': {'hook': 'Wait for it'},
      'projectId': projectId,
      'project': {'id': projectId, 'name': 'Acme Launch'},
      'clientId': 'c1',
      'client': {'id': 'c1', 'name': 'Acme Corp'},
      'socialAccountId': 'a1',
      'socialAccount': {'id': 'a1', 'platform': 'instagram', 'accountName': 'Acme IG'},
      'variants': [
        {'id': 'v1', 'platform': 'instagram', 'customContent': '', 'status': 'pending'},
      ],
      'reviewComments': [],
      'createdAt': '2026-09-20T10:00:00.000Z',
      'updatedAt': '2026-09-20T10:00:00.000Z',
    };

Map<String, dynamic> projectDetailJson({List<Map<String, dynamic>>? posts, List<Map<String, dynamic>>? sessions, String? clientId = 'c1'}) => {
      ...projectJson(clientId: clientId),
      'contentCalendars_ProjectContentCalendars': [],
      'socialPosts': posts ?? [postJson()],
      'tasks': [],
      'clientReviewSessions': sessions ?? [],
      'socialConversations': [],
    };

Map<String, dynamic> conversationJson({String id = 'conv1', bool withMessages = false}) => {
      'id': id,
      'platform': 'instagram',
      'participantName': 'Jordan Fan',
      'participantHandle': 'jordan.fan',
      'lastMessageSnippet': 'Do you ship to Canada?',
      'lastMessageAt': '2026-09-24T09:00:00.000Z',
      'isRead': false,
      'projectId': 'p1',
      'project': {'id': 'p1', 'name': 'Acme Launch'},
      'socialAccount': {'id': 'a1', 'accountName': 'Acme IG'},
      if (withMessages)
        'messages': [
          {'id': 'm1', 'senderType': 'participant', 'content': 'Do you ship to Canada?', 'createdAt': '2026-09-24T09:00:00.000Z'},
        ],
    };

Map<String, dynamic> calendarJson({String id = 'cal1', String status = 'active'}) => {
      'id': id,
      'name': 'October plan',
      'brandName': 'Acme',
      'status': status,
      'industry': 'Retail',
      'platforms': ['Instagram', 'LinkedIn'],
      'calendarDuration': '1 month',
      'frequency': '3x a week',
      'totalPieces': 1,
      'projectId': 'p1',
      'startDate': '2026-10-01',
      'endDate': '2026-10-31',
    };

Map<String, dynamic> pieceJson() => {
      'id': 'piece1',
      'calendarId': 'cal1',
      'weekNumber': 1,
      'dateScheduled': '2026-10-02',
      'platform': 'Instagram',
      'contentType': 'Reel',
      'pillar': 'Education',
      'headline': '3 myths about shipping',
      'adCopyFull': 'Myth one…',
      'videoScriptOrHooks': 'Hook: you have been lied to',
      'hashtags': ['#shipping'],
      'callToAction': 'Follow for more',
      'status': 'ready',
    };

Map<String, dynamic> brandConsciousnessJson() => {
      'projectId': 'p1',
      'brandName': 'Acme',
      'brandType': null,
      'positioning': null,
      'colors': {'primary': '#1F3A2E', 'accent': null, 'background': null, 'text': null},
      'targetPlatforms': ['instagram'],
      'watermarkEnabled': null,
      'completeness': {'percent': 40, 'isComplete': false, 'missingRequired': ['brandType', 'positioning'], 'missingRecommended': []},
    };

/// Every read the signed-in app makes on its happy path, with one project "p1".
FakeBackend seededBackend() {
  final b = FakeBackend()..validAccessToken = 'access-1';
  b.json('GET', '/api/auth/me', meJson());
  b.json('POST', '/api/auth/logout', {'success': true});
  b.json('GET', '$sm/projects', {'success': true, 'projects': [projectJson()], 'total': 1});
  b.json('GET', '$sm/projects/:id', {'success': true, 'project': projectDetailJson()});
  b.json('GET', '$sm/projects/:id/dashboard', {
    'success': true,
    'dashboard': {
      'metrics': {'postsScheduledThisWeek': 2, 'postsAwaitingApproval': 1, 'editingTasksInProgress': 0, 'postsPublishedThisMonth': 4, 'overdueTasks': 0, 'publishingFailures': 0},
      'attentionItems': [],
      'upcomingContent': [postJson(status: 'scheduled', scheduledFor: '2026-09-28T10:00:00.000Z')],
    },
  });
  b.json('GET', '$sm/projects/:id/platform-metrics', {
    'success': true,
    'metrics': [
      {'platform': 'instagram', 'followersCount': 12400, 'reach': 48500, 'views': 84200, 'engagements': 4200, 'source': 'live'},
      {'platform': 'youtube', 'followersCount': 8900, 'reach': 62000, 'views': 142800, 'engagements': 6100, 'source': 'live'},
      {'platform': 'linkedin', 'followersCount': 24000, 'reach': 110000, 'views': 211000, 'engagements': 14500, 'source': 'stored'},
    ],
  });
  b.json('GET', '$sm/projects/:id/activity', {'success': true, 'activity': []});
  b.json('GET', '$sm/posts', {'success': true, 'posts': [postJson()]});
  b.json('GET', '$sm/posts/:id', {'success': true, 'post': postJson()});
  b.json('GET', '$sm/projects/:id/brand-consciousness', {'success': true, 'brand': brandConsciousnessJson()});
  b.json('GET', '$sm/brand-voice/:projectId', {
    'success': true,
    'profile': {
      'id': 'bv1',
      'projectId': 'p1',
      'tone': 'Friendly & conversational',
      'targetAudience': 'Small business owners',
      'sampleViralPosts': [],
      'forbiddenWords': ['cheap'],
      'defaultHashtags': ['#acme'],
      'standardCtas': ['Shop now'],
      'metadata': {'contentPillars': ['Education'], 'hookStyle': 'Question-led', 'hooks': []},
    },
  });
  b.json('GET', '$sm/accounts', {'success': true, 'accounts': [accountJson(), accountJson(id: 'a2', platform: 'linkedin', name: 'Acme LinkedIn', projectId: null, projectName: null)]});
  b.json('GET', '$sm/content-calendar', {'calendars': [calendarJson()]});
  b.json('GET', '$sm/content-calendar/:id', {'calendar': calendarJson(), 'pieces': [pieceJson()]});
  b.json('GET', '$sm/inbox/conversations', {'success': true, 'conversations': [conversationJson()]});
  b.json('GET', '$sm/inbox/conversations/:id', {'success': true, 'conversation': conversationJson(withMessages: true)});
  b.json('GET', '$sm/assets', {'success': true, 'assets': [
    {'id': 'as1', 'url': 'https://drive.google.com/brandkit', 'type': 'folder', 'title': 'Brand kit', 'tags': []},
    {'id': 'bk1', 'type': 'hashtag', 'name': 'Core', 'content': '#a #b'},
  ]});
  b.json('GET', '$sm/saved-banks', {'success': true, 'banks': [
    {'id': 'bk1', 'type': 'hashtag', 'name': 'Core tags', 'content': '#acme #retail', 'tags': []},
    {'id': 'bk2', 'type': 'hook', 'name': 'Myth opener', 'content': 'Everyone gets this wrong…', 'tags': []},
  ]});
  b.json('GET', '$sm/evergreen/:projectId/slots', {'success': true, 'slots': [
    {'id': 's1', 'projectId': 'p1', 'dayOfWeek': 2, 'timeSlotUtc': '09:00', 'category': 'Educational', 'isActive': true},
  ]});
  b.json('GET', '/api/tasks', {'success': true, 'tasks': [
    {'id': 't1', 'title': 'Edit launch teaser', 'status': 'in_progress', 'priority': 'high', 'socialPostId': 'post1', 'assignee': {'id': 'u2', 'name': 'Eddie Editor'}},
  ]});
  b.json('GET', '/api/users', {'success': true, 'users': [
    {'id': 'u2', 'name': 'Eddie Editor', 'email': 'eddie@agency.test'},
  ]});
  return b;
}
