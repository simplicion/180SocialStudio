import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import 'brand_voice.dart';
import 'content_calendar.dart';
import 'inbox.dart';
import 'review.dart';
import 'social_account.dart';
import 'social_post.dart';
import 'task.dart';

enum ProjectStatus {
  inProgress('in_progress', 'In progress'),
  inReview('in_review', 'In review'),
  paused('paused', 'Paused'),
  completed('completed', 'Completed'),
  unknown('unknown', 'Unknown');

  const ProjectStatus(this.id, this.label);
  final String id;
  final String label;
  
  Color get color {
    switch (this) {
      case ProjectStatus.inProgress: return AppTheme.accent;
      case ProjectStatus.inReview: return AppTheme.warning;
      case ProjectStatus.paused: return AppTheme.textMuted;
      case ProjectStatus.completed: return AppTheme.success;
      case ProjectStatus.unknown: return AppTheme.textMuted;
    }
  }


  static const editable = [inProgress, inReview, paused, completed];
  static const listFilters = [inProgress, inReview, completed];

  static ProjectStatus parse(Object? raw) =>
      ProjectStatus.values.firstWhere((s) => s.id == raw, orElse: () => ProjectStatus.unknown);
}

/// Services a project can include (create wizard step 2).
const socialServiceOptions = <String, String>{
  'content_calendar': 'Content calendar',
  'short_form_video': 'Short-form video',
  'static_posts': 'Static posts',
  'publishing': 'Publishing',
  'inbox': 'Inbox management',
  'analytics': 'Analytics',
};

const timezoneOptions = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Asia/Kolkata',
  'Australia/Sydney',
];

class ProjectMetrics {
  const ProjectMetrics({
    this.scheduledPosts = 0,
    this.pendingApprovals = 0,
    this.outstandingTasks = 0,
    this.publishedPosts = 0,
    this.totalPosts = 0,
  });

  final int scheduledPosts;
  final int pendingApprovals;
  final int outstandingTasks;
  final int publishedPosts;
  final int totalPosts;

  factory ProjectMetrics.fromJson(Json j) => ProjectMetrics(
        scheduledPosts: jInt(j['scheduledPosts']) ?? 0,
        pendingApprovals: jInt(j['pendingApprovals']) ?? 0,
        outstandingTasks: jInt(j['outstandingTasks']) ?? 0,
        publishedPosts: jInt(j['publishedPosts']) ?? 0,
        totalPosts: jInt(j['totalPosts']) ?? 0,
      );
}

class ProjectSettings {
  const ProjectSettings({
    this.approvalRequired = false,
    this.defaultTimezone = 'UTC',
    this.storageRetentionDays = 30,
    this.defaultReviewerId,
  });

  final bool approvalRequired;
  final String defaultTimezone;
  final int storageRetentionDays;
  final String? defaultReviewerId;

  factory ProjectSettings.fromJson(Json j) => ProjectSettings(
        approvalRequired: jBool(j['approvalRequired'], false),
        defaultTimezone: jStr(j['defaultTimezone']) ?? 'UTC',
        storageRetentionDays: jInt(j['storageRetentionDays']) ?? 30,
        defaultReviewerId: jStr(j['defaultReviewerId']),
      );

  Json toJson() => compact({
        'approvalRequired': approvalRequired,
        'defaultTimezone': defaultTimezone,
        'storageRetentionDays': storageRetentionDays,
        'defaultReviewerId': defaultReviewerId,
      });
}

class ClientRef {
  ClientRef({required this.id, required this.name, this.email});
  final String id;
  final String name;
  final String? email;

  factory ClientRef.fromJson(Json j) => ClientRef(
        id: jStrOr(j['id'] ?? j['_id'], ''),
        name: jStr(j['name']) ?? jStr(j['companyName']) ?? jStr(j['clientName']) ?? 'Unnamed client',
        email: jStr(j['email']),
      );
}

class Project {
  Project({
    required this.id,
    required this.name,
    this.description,
    this.status = ProjectStatus.inProgress,
    this.priority,
    this.startDate,
    this.deadline,
    this.clientIds = const [],
    this.memberIds = const [],
    this.socialServices = const [],
    this.settings = const ProjectSettings(),
    this.socialAccounts = const [],
    this.brandVoice,
    this.metrics = const ProjectMetrics(),
    this.pendingReviewSessions = 0,
    this.client,
    this.createdAt,
  });

  final String id;
  final String name;
  final String? description;
  final ProjectStatus status;
  final String? priority;
  final DateTime? startDate;
  final DateTime? deadline;
  final List<String> clientIds;
  final List<String> memberIds;
  final List<String> socialServices;
  final ProjectSettings settings;
  final List<SocialAccount> socialAccounts;
  final BrandVoice? brandVoice;
  final ProjectMetrics metrics;
  final int pendingReviewSessions;
  final ClientRef? client;
  final DateTime? createdAt;

  String? get primaryClientId => client?.id ?? (clientIds.isEmpty ? null : clientIds.first);

  factory Project.fromJson(Json j) {
    final bv = jMapOrNull(j['brandVoiceProfile']);
    final client = jMapOrNull(j['client']);
    final pending = j['pendingReviewSessions'];
    return Project(
      id: jStrOr(j['id'], ''),
      name: jStr(j['name']) ?? 'Untitled project',
      description: jStr(j['description']),
      status: ProjectStatus.parse(j['status']),
      priority: jStr(j['priority']),
      startDate: jDate(j['startDate']),
      deadline: jDate(j['deadline'] ?? j['endDate']),
      clientIds: jStrList(j['clientIds']),
      memberIds: jStrList(j['memberIds']),
      socialServices: jStrList(j['socialServices']),
      settings: ProjectSettings.fromJson(jMap(j['socialSettings'])),
      socialAccounts: jList(j['socialAccounts'], SocialAccount.fromJson),
      brandVoice: bv == null ? null : BrandVoice.fromJson(bv, projectId: jStr(j['id'])),
      metrics: ProjectMetrics.fromJson(jMap(j['metrics'])),
      pendingReviewSessions: pending is List ? pending.length : (jInt(pending) ?? 0),
      client: client == null ? null : ClientRef.fromJson(client),
      createdAt: jDate(j['createdAt']),
    );
  }
}

/// `GET /projects/:id` — the project plus its related collections.
class ProjectDetail {
  ProjectDetail({
    required this.project,
    this.calendars = const [],
    this.posts = const [],
    this.tasks = const [],
    this.reviewSessions = const [],
    this.conversations = const [],
  });

  final Project project;
  final List<ContentCalendar> calendars;
  final List<SocialPost> posts;
  final List<EditingTask> tasks;
  final List<ReviewSession> reviewSessions;
  final List<Conversation> conversations;

  factory ProjectDetail.fromJson(Json j) => ProjectDetail(
        project: Project.fromJson(j),
        calendars: jList(j['contentCalendars_ProjectContentCalendars'], ContentCalendar.fromJson),
        posts: jList(j['socialPosts'], SocialPost.fromJson),
        tasks: jList(j['tasks'], EditingTask.fromJson),
        reviewSessions: jList(j['clientReviewSessions'], ReviewSession.fromJson),
        conversations: jList(j['socialConversations'], Conversation.fromJson),
      );
}

class AttentionItem {
  AttentionItem({
    required this.id,
    required this.type,
    required this.title,
    this.description,
    this.priority,
    this.actionLink,
  });

  final String id;
  final String type;
  final String title;
  final String? description;
  final String? priority;
  final String? actionLink;

  /// The project tab the web action link points at (`?tab=x`).
  String? get targetTab {
    final link = actionLink;
    if (link == null) return null;
    return Uri.tryParse(link)?.queryParameters['tab'];
  }

  factory AttentionItem.fromJson(Json j) => AttentionItem(
        id: jStrOr(j['id'], ''),
        type: jStrOr(j['type'], ''),
        title: jStrOr(j['title'], ''),
        description: jStr(j['description']),
        priority: jStr(j['priority']),
        actionLink: jStr(j['actionLink']),
      );
}

class ProjectDashboard {
  ProjectDashboard({
    required this.metrics,
    required this.attentionItems,
    required this.upcomingContent,
  });

  final Map<String, int> metrics;
  final List<AttentionItem> attentionItems;
  final List<SocialPost> upcomingContent;

  int metric(String key) => metrics[key] ?? 0;

  factory ProjectDashboard.fromJson(Json j) => ProjectDashboard(
        metrics: jMap(j['metrics']).map((k, v) => MapEntry(k, jInt(v) ?? 0)),
        attentionItems: jList(j['attentionItems'], AttentionItem.fromJson),
        upcomingContent: jList(j['upcomingContent'], SocialPost.fromJson),
      );
}

class ActivityItem {
  ActivityItem({
    required this.id,
    required this.type,
    required this.title,
    this.action,
    this.description,
    this.timestamp,
  });

  final String id;
  final String type;
  final String title;
  final String? action;
  final String? description;
  final DateTime? timestamp;

  factory ActivityItem.fromJson(Json j) => ActivityItem(
        id: jStrOr(j['id'], ''),
        type: jStrOr(j['type'], ''),
        title: jStrOr(j['title'], ''),
        action: jStr(j['action']),
        description: jStr(j['description']),
        timestamp: jDate(j['timestamp']),
      );
}
