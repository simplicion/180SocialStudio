import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import 'platform.dart';

/// `SocialPost.status` exactly as the backend stores it.
enum PostStatus {
  draft('draft', 'Draft'),
  scheduled('scheduled', 'Scheduled'),
  inEditing('in_editing', 'In editing'),
  inReview('in_review', 'In review'),
  pendingReview('pending_review', 'Pending review'),
  approved('approved', 'Approved'),
  ready('ready', 'Ready'),
  publishing('publishing', 'Publishing'),
  published('published', 'Published'),
  partiallyPublished('partially_published', 'Partially published'),
  failed('failed', 'Failed'),
  unknown('unknown', 'Unknown');

  const PostStatus(this.id, this.label);
  final String id;
  final String label;

  Color get color {
    switch (this) {
      case PostStatus.draft: return AppTheme.textSecondary;
      case PostStatus.scheduled: return AppTheme.accentBlue;
      case PostStatus.inEditing: return AppTheme.accent;
      case PostStatus.inReview: return AppTheme.warning;
      case PostStatus.pendingReview: return AppTheme.warning;
      case PostStatus.approved: return AppTheme.success;
      case PostStatus.ready: return AppTheme.success;
      case PostStatus.publishing: return AppTheme.accentBlue;
      case PostStatus.published: return AppTheme.success;
      case PostStatus.partiallyPublished: return AppTheme.warning;
      case PostStatus.failed: return AppTheme.error;
      case PostStatus.unknown: return AppTheme.textMuted;
    }
  }

  /// Statuses offered in the content list filter (parity with ContentListTab).
  static const filterable = [draft, inEditing, inReview, approved, scheduled, published];

  static PostStatus parse(Object? raw) =>
      PostStatus.values.firstWhere((s) => s.id == raw, orElse: () => PostStatus.unknown);
}

class PostVariant {
  PostVariant({
    this.id,
    required this.platform,
    this.customContent,
    this.firstComment,
    this.status,
    this.publishedUrl,
    this.errorMessage,
    this.platformMeta = const {},
    this.externalId,
    this.socialAccountId,
    this.accountName,
    this.username,
    this.profileImageUrl,
  });

  final String? id;
  final SocialPlatform platform;
  final String? customContent;
  final String? firstComment;
  final String? status;
  final String? publishedUrl;
  final String? errorMessage;
  final Json platformMeta;
  final String? externalId;
  final String? socialAccountId;
  final String? accountName;
  final String? username;
  final String? profileImageUrl;

  /// Produced by the server's sandbox (SIMULATE_SOCIAL_PUBLISHING, never in production): nothing reached the
  /// platform and [publishedUrl] is a placeholder. The UI must label it and must not offer "View live post".
  bool get isSimulated => (externalId?.startsWith('sim_') ?? false) || (errorMessage?.startsWith('Simulated publish') ?? false);

  /// A published / processing variant can carry a non-fatal note (e.g. first comment failed); it is not an error.
  bool get isFailed => status == 'failed';

  PostVariant copyWith({
    String? id,
    SocialPlatform? platform,
    String? customContent,
    String? firstComment,
    String? status,
    String? publishedUrl,
    String? errorMessage,
    Json? platformMeta,
    String? externalId,
    String? socialAccountId,
    String? accountName,
    String? username,
    String? profileImageUrl,
  }) =>
      PostVariant(
        id: id ?? this.id,
        platform: platform ?? this.platform,
        customContent: customContent ?? this.customContent,
        firstComment: firstComment ?? this.firstComment,
        status: status ?? this.status,
        publishedUrl: publishedUrl ?? this.publishedUrl,
        errorMessage: errorMessage ?? this.errorMessage,
        platformMeta: platformMeta ?? this.platformMeta,
        externalId: externalId ?? this.externalId,
        socialAccountId: socialAccountId ?? this.socialAccountId,
        accountName: accountName ?? this.accountName,
        username: username ?? this.username,
        profileImageUrl: profileImageUrl ?? this.profileImageUrl,
      );

  factory PostVariant.fromJson(Json j) {
    final account = jMapOrNull(j['socialAccount']);
    return PostVariant(
      id: jStr(j['id']),
      platform: SocialPlatform.parse(j['platform']),
      customContent: jStr(j['customContent']),
      firstComment: jStr(j['firstComment']),
      status: jStr(j['publishStatus']) ?? jStr(j['status']),
      publishedUrl: jStr(j['externalUrl']) ?? jStr(j['publishedUrl']),
      errorMessage: jStr(j['lastError']) ?? jStr(j['errorMessage']),
      platformMeta: jMap(j['platformMeta']),
      externalId: jStr(j['externalId']),
      socialAccountId: jStr(j['socialAccountId']) ?? jStr(jMap(j['platformMeta'])['socialAccountId']),
      accountName: account != null ? (jStr(account['accountName']) ?? jStr(account['username'])) : null,
      username: account != null ? jStr(account['username']) : null,
      profileImageUrl: account != null ? jStr(account['profileImageUrl']) : null,
    );
  }

  Json toCreateJson() => compact({
        'platform': platform.id,
        'customContent': customContent ?? '',
        'firstComment': firstComment,
        'platformMeta': platformMeta.isNotEmpty ? platformMeta : null,
        'socialAccountId': socialAccountId,
      });

  Json toUpdateJson() => compact({
        if (id != null) 'id': id,
        'platform': platform.id,
        'customContent': customContent ?? '',
        'firstComment': firstComment,
        'platformMeta': platformMeta.isNotEmpty ? platformMeta : null,
        'socialAccountId': socialAccountId,
      });
}

class ReviewComment {
  ReviewComment({
    required this.id,
    required this.text,
    this.authorName,
    this.authorType,
    this.resolved = false,
    this.createdAt,
  });

  final String id;
  final String text;
  final String? authorName;
  final String? authorType;
  final bool resolved;
  final DateTime? createdAt;

  factory ReviewComment.fromJson(Json j) => ReviewComment(
        id: jStrOr(j['id'], ''),
        text: jStr(j['commentText']) ?? jStr(j['content']) ?? jStr(j['text']) ?? '',
        authorName: jStr(j['authorName']),
        authorType: jStr(j['authorType']),
        resolved: jBool(j['resolved']),
        createdAt: jDate(j['createdAt']),
      );
}

class ExternalLink {
  ExternalLink({required this.url, this.provider, this.label, this.submittedAt});
  final String url;
  final String? provider;
  final String? label;
  final DateTime? submittedAt;

  factory ExternalLink.fromJson(Json j) => ExternalLink(
        url: jStrOr(j['url'], ''),
        provider: jStr(j['provider']),
        label: jStr(j['label']),
        submittedAt: jDate(j['submittedAt']),
      );

  Json toJson() => compact({
        'url': url,
        'provider': provider ?? detectProvider(url),
        'label': label,
        'submittedAt': isoOrNull(submittedAt ?? DateTime.now()),
      });

  static String detectProvider(String url) {
    final u = url.toLowerCase();
    if (u.contains('drive.google') || u.contains('docs.google')) return 'google_drive';
    if (u.contains('dropbox')) return 'dropbox';
    if (u.contains('box.com')) return 'box';
    if (u.contains('onedrive') || u.contains('sharepoint') || u.contains('1drv')) return 'onedrive';
    if (u.contains('wetransfer')) return 'wetransfer';
    return 'link';
  }
}

class SocialPost {
  SocialPost({
    required this.id,
    required this.content,
    this.title,
    this.status = PostStatus.draft,
    this.mediaType,
    this.mediaUrls = const [],
    this.rawMediaUrls = const [],
    this.externalStorageLinks = const [],
    this.finalVideoUrl,
    this.thumbnailUrl,
    this.scheduledFor,
    this.publishedAt,
    this.publishedLinks = const {},
    this.errorMessage,
    this.isEvergreen = false,
    this.reuseCount = 0,
    this.versionNumber = 1,
    this.metadata = const {},
    this.revisionNotes,
    this.projectId,
    this.projectName,
    this.clientId,
    this.clientName,
    this.calendarId,
    this.calendarPieceId,
    this.socialAccountId,
    this.accountPlatform,
    this.accountName,
    this.variants = const [],
    this.reviewComments = const [],
    this.repurposedFromId,
    this.derivedPosts = const [],
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String? title;
  final String content;
  final PostStatus status;
  final String? mediaType;
  final List<String> mediaUrls;
  final List<String> rawMediaUrls;
  final List<ExternalLink> externalStorageLinks;
  final String? finalVideoUrl;
  final String? thumbnailUrl;
  final DateTime? scheduledFor;
  final DateTime? publishedAt;
  final Map<String, String> publishedLinks;
  final String? errorMessage;
  final bool isEvergreen;
  final int reuseCount;
  final int versionNumber;
  final Json metadata;
  final String? revisionNotes;
  final String? projectId;
  final String? projectName;
  final String? clientId;
  final String? clientName;
  final String? calendarId;
  final String? calendarPieceId;
  final String? socialAccountId;
  final SocialPlatform? accountPlatform;
  final String? accountName;
  final List<PostVariant> variants;
  final List<ReviewComment> reviewComments;
  final String? repurposedFromId;
  final List<Json> derivedPosts;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  String get displayTitle {
    final t = title?.trim();
    if (t != null && t.isNotEmpty) return t;
    final c = content.trim();
    if (c.isEmpty) return 'Untitled post';
    return c.length > 60 ? '${c.substring(0, 60)}…' : c;
  }

  String? get hook => jStr(metadata['hook']);
  String? get objective => jStr(metadata['objective']);
  String? get firstComment => jStr(metadata['firstComment']);

  /// Target platforms: variants first, else the linked account's platform.
  List<SocialPlatform> get platforms {
    final fromVariants = variants.map((v) => v.platform).toSet().toList();
    if (fromVariants.isNotEmpty) return fromVariants;
    if (accountPlatform != null) return [accountPlatform!];
    return [];
  }

  int get unresolvedComments => reviewComments.where((c) => !c.resolved).length;

  /// Per-platform publishing errors. `errorMessage` is a JSON string `{platform: message}`.
  Map<String, String> get platformErrors {
    final raw = errorMessage;
    if (raw == null || raw.isEmpty) return {};
    final m = jMap(raw);
    if (m.isEmpty) return {'error': raw};
    return m.map((k, v) => MapEntry(k, '$v'));
  }

  factory SocialPost.fromJson(Json j) {
    final project = jMapOrNull(j['project']);
    final client = jMapOrNull(j['client']);
    final account = jMapOrNull(j['socialAccount']);
    final links = jMap(j['publishedLinks']);
    final parsedVariants = jList(j['variants'], PostVariant.fromJson);
    final combinedLinks = <String, String>{
      ...links.map((k, v) => MapEntry(k, '$v')),
      for (final v in parsedVariants)
        if (v.publishedUrl != null && v.publishedUrl!.isNotEmpty)
          v.platform.label: v.publishedUrl!,
    };
    return SocialPost(
      id: jStrOr(j['id'], ''),
      title: jStr(j['title']),
      content: jStr(j['content']) ?? '',
      status: PostStatus.parse(j['status']),
      mediaType: jStr(j['mediaType']),
      mediaUrls: jStrList(j['mediaUrls']),
      rawMediaUrls: jStrList(j['rawMediaUrls']),
      externalStorageLinks: jList(j['externalStorageLinks'], ExternalLink.fromJson),
      finalVideoUrl: jStr(j['finalVideoUrl']),
      thumbnailUrl: jStr(j['thumbnailUrl']),
      scheduledFor: jDate(j['scheduledFor']),
      publishedAt: jDate(j['publishedAt']),
      publishedLinks: combinedLinks,
      errorMessage: jStr(j['errorMessage']),
      isEvergreen: jBool(j['isEvergreen']),
      reuseCount: jInt(j['reuseCount']) ?? 0,
      versionNumber: jInt(j['versionNumber']) ?? 1,
      metadata: jMap(j['metadata']),
      revisionNotes: jStr(j['revisionNotes']),
      projectId: jStr(j['projectId']) ?? (project == null ? null : jStr(project['id'])),
      projectName: project == null ? null : jStr(project['name']),
      clientId: jStr(j['clientId']),
      clientName: client == null ? null : jStr(client['name']),
      calendarId: jStr(j['calendarId']),
      calendarPieceId: jStr(j['calendarPieceId']),
      socialAccountId: jStr(j['socialAccountId']),
      accountPlatform: account == null ? null : SocialPlatform.parse(account['platform']),
      accountName: account == null ? null : jStr(account['accountName']),
      variants: parsedVariants,
      reviewComments: jList(j['reviewComments'], ReviewComment.fromJson),
      repurposedFromId: jStr(j['repurposedFromId']),
      derivedPosts: jList(j['derivedPosts'], (m) => m),
      createdAt: jDate(j['createdAt']),
      updatedAt: jDate(j['updatedAt']),
    );
  }
}

/// Result of `GET /posts/:id/validate-publish`.
class PublishReadiness {
  PublishReadiness({
    required this.isReady,
    required this.issues,
    this.schedulingBlockers = const [],
    this.approvalPending = false,
    this.warnings = const [],
  });
  final bool isReady;
  final List<String> issues;

  /// Problems that would make the publish fail (fix before scheduling). Excludes approval and collisions.
  final List<String> schedulingBlockers;

  /// Only the client/team approval is missing.
  final bool approvalPending;

  /// Non-blocking: duplicate caption, flagged brand words, near-limit captions…
  final List<String> warnings;

  factory PublishReadiness.fromJson(Json j) {
    final issues = jStrList(j['issues']);
    return PublishReadiness(
      isReady: jBool(j['isReady']),
      issues: issues,
      schedulingBlockers: j['schedulingBlockers'] is List ? jStrList(j['schedulingBlockers']) : issues,
      approvalPending: jBool(j['approvalPending']),
      warnings: [
        for (final w in (j['warnings'] is List ? j['warnings'] as List : []))
          if (w is String) w else if (w is Map && w['message'] is String) w['message'] as String,
      ],
    );
  }
}

/// Result of `POST /posts/:id/publish`, shown verbatim (including per-platform errors).
class PublishResult {
  PublishResult({
    required this.status,
    required this.message,
    required this.publishedLinks,
    required this.errors,
    this.post,
    this.simulated = false,
  });

  /// The server ran in sandbox mode: nothing was posted; links are placeholders.
  final bool simulated;

  final String status;
  final String message;
  final Map<String, String> publishedLinks;
  final Map<String, String> errors;
  final SocialPost? post;

  factory PublishResult.fromJson(Json j) => PublishResult(
        status: jStr(j['status']) ?? 'unknown',
        message: jStr(j['message']) ?? '',
        publishedLinks: jMap(j['publishedLinks']).map((k, v) => MapEntry(k, '$v')),
        errors: jMap(j['errors']).map((k, v) => MapEntry(k, '$v')),
        post: j['post'] is Map ? SocialPost.fromJson(jMap(j['post'])) : null,
        simulated: jBool(j['simulated']),
      );
}
