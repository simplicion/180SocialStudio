import '../../core/util/json.dart';
import 'platform.dart';

/// Generic, universal payload for manual pre-filled publishing across any SocialPlatform.
class UniversalPlatformPayload {
  UniversalPlatformPayload({
    required this.platform,
    required this.caption,
    this.title,
    this.hashtags = const [],
    this.mediaPath,
    this.mimeType = 'video/mp4',
    this.subreddit,
    this.extraMetadata = const {},
    this.sourceContentId,
    this.calendarItemId,
    this.projectId,
  });

  final SocialPlatform platform;
  final String caption;
  final String? title;
  final List<String> hashtags;
  final String? mediaPath;
  final String mimeType;
  final String? subreddit;
  final Map<String, dynamic> extraMetadata;
  final String? sourceContentId;
  final String? calendarItemId;
  final String? projectId;

  /// Returns full formatted text including hashtags if provided
  String get fullText {
    final tagsText = hashtags.isNotEmpty
        ? '\n\n${hashtags.map((t) => t.startsWith('#') ? t : '#$t').join(' ')}'
        : '';
    return '$caption$tagsText'.trim();
  }

  /// Converts to legacy XPublishPayload
  XPublishPayload toXPayload() => XPublishPayload(
        text: fullText,
        mediaPath: mediaPath,
        mimeType: mimeType,
        sourceContentId: sourceContentId,
        calendarItemId: calendarItemId,
        projectId: projectId,
      );

  /// Converts to legacy RedditPublishPayload
  RedditPublishPayload toRedditPayload() => RedditPublishPayload(
        subreddit: subreddit,
        title: title ?? (caption.length > 80 ? '${caption.substring(0, 77)}...' : caption),
        body: caption,
        mediaPath: mediaPath,
        mimeType: mimeType,
        sourceContentId: sourceContentId,
        calendarItemId: calendarItemId,
        projectId: projectId,
      );

  factory UniversalPlatformPayload.fromPlatform({
    required SocialPlatform platform,
    required String caption,
    String? title,
    List<String> hashtags = const [],
    String? mediaPath,
    String mimeType = 'video/mp4',
    String? subreddit,
    Map<String, dynamic> extraMetadata = const {},
    String? sourceContentId,
    String? calendarItemId,
    String? projectId,
  }) {
    return UniversalPlatformPayload(
      platform: platform,
      caption: caption,
      title: title,
      hashtags: hashtags,
      mediaPath: mediaPath,
      mimeType: mimeType,
      subreddit: subreddit,
      extraMetadata: extraMetadata,
      sourceContentId: sourceContentId,
      calendarItemId: calendarItemId,
      projectId: projectId,
    );
  }

  factory UniversalPlatformPayload.fromJson(Json j) {
    final plat = SocialPlatform.parse(j['platform']);
    return UniversalPlatformPayload(
      platform: plat,
      caption: jStrOr(j['caption'] ?? j['text'], ''),
      title: jStr(j['title']),
      hashtags: (j['hashtags'] as List?)?.map((e) => e.toString()).toList() ?? [],
      mediaPath: jStr(j['mediaPath']) ?? jStr(j['mediaUri']),
      mimeType: jStrOr(j['mimeType'], 'video/mp4'),
      subreddit: jStr(j['subreddit']),
      extraMetadata: (j['extraMetadata'] is Map) ? Map<String, dynamic>.from(j['extraMetadata'] as Map) : {},
      sourceContentId: jStr(j['sourceContentId']),
      calendarItemId: jStr(j['calendarItemId']),
      projectId: jStr(j['projectId']),
    );
  }

  Json toJson() => compact({
        'platform': platform.id,
        'caption': caption,
        'title': title,
        'hashtags': hashtags.isNotEmpty ? hashtags : null,
        'mediaPath': mediaPath,
        'mimeType': mimeType,
        'subreddit': subreddit,
        'extraMetadata': extraMetadata.isNotEmpty ? extraMetadata : null,
        'sourceContentId': sourceContentId,
        'calendarItemId': calendarItemId,
        'projectId': projectId,
      });
}

/// Payload prepared specifically for X (Twitter) user-assisted handoff.
class XPublishPayload {
  XPublishPayload({
    required this.text,
    this.mediaPath,
    this.mimeType = 'video/mp4',
    this.sourceContentId,
    this.calendarItemId,
    this.projectId,
  });

  final String text;
  final String? mediaPath;
  final String mimeType;
  final String? sourceContentId;
  final String? calendarItemId;
  final String? projectId;

  factory XPublishPayload.fromJson(Json j) => XPublishPayload(
        text: jStrOr(j['text'], ''),
        mediaPath: jStr(j['mediaPath']) ?? jStr(j['mediaUri']),
        mimeType: jStrOr(j['mimeType'], 'video/mp4'),
        sourceContentId: jStr(j['sourceContentId']),
        calendarItemId: jStr(j['calendarItemId']),
        projectId: jStr(j['projectId']),
      );

  Json toJson() => compact({
        'platform': 'x',
        'text': text,
        'mediaPath': mediaPath,
        'mimeType': mimeType,
        'sourceContentId': sourceContentId,
        'calendarItemId': calendarItemId,
        'projectId': projectId,
      });
}

/// Payload prepared specifically for Reddit user-assisted handoff.
class RedditPublishPayload {
  RedditPublishPayload({
    this.subreddit,
    required this.title,
    this.body,
    this.mediaPath,
    this.mimeType = 'video/mp4',
    this.flairId,
    this.markNsfw = false,
    this.markSpoiler = false,
    this.sourceContentId,
    this.calendarItemId,
    this.projectId,
  });

  final String? subreddit;
  final String title;
  final String? body;
  final String? mediaPath;
  final String mimeType;
  final String? flairId;
  final bool markNsfw;
  final bool markSpoiler;
  final String? sourceContentId;
  final String? calendarItemId;
  final String? projectId;

  /// Returns normalized subreddit (without leading 'r/' or '/r/').
  String get normalizedSubreddit {
    final s = subreddit?.trim() ?? '';
    if (s.isEmpty) return '';
    return s.replaceFirst(RegExp(r'^/?r/'), '');
  }

  factory RedditPublishPayload.fromJson(Json j) => RedditPublishPayload(
        subreddit: jStr(j['subreddit']),
        title: jStrOr(j['title'], ''),
        body: jStr(j['body']),
        mediaPath: jStr(j['mediaPath']) ?? jStr(j['mediaUri']),
        mimeType: jStrOr(j['mimeType'], 'video/mp4'),
        flairId: jStr(j['flairId']),
        markNsfw: jBool(j['markNsfw']),
        markSpoiler: jBool(j['markSpoiler']),
        sourceContentId: jStr(j['sourceContentId']),
        calendarItemId: jStr(j['calendarItemId']),
        projectId: jStr(j['projectId']),
      );

  Json toJson() => compact({
        'platform': 'reddit',
        'subreddit': normalizedSubreddit.isNotEmpty ? normalizedSubreddit : null,
        'title': title,
        'body': body,
        'mediaPath': mediaPath,
        'mimeType': mimeType,
        'flairId': flairId,
        'markNsfw': markNsfw ? true : null,
        'markSpoiler': markSpoiler ? true : null,
        'sourceContentId': sourceContentId,
        'calendarItemId': calendarItemId,
        'projectId': projectId,
      });
}

/// Universal publishing package for user-assisted platform handoffs.
class UserAssistedPublishPackage {
  UserAssistedPublishPackage({
    required this.id,
    required this.projectId,
    this.calendarItemId,
    this.mediaPath,
    this.mimeType = 'video/mp4',
    this.title,
    this.caption,
    this.xPayload,
    this.redditPayload,
    this.platformPayloads = const {},
    this.status = 'ready',
    this.createdAt,
  });

  final String id;
  final String projectId;
  final String? calendarItemId;
  final String? mediaPath;
  final String mimeType;
  final String? title;
  final String? caption;
  final XPublishPayload? xPayload;
  final RedditPublishPayload? redditPayload;
  final Map<SocialPlatform, UniversalPlatformPayload> platformPayloads;
  final String status;
  final DateTime? createdAt;

  factory UserAssistedPublishPackage.fromJson(Json j) {
    final rawPlatformPayloads = j['platformPayloads'];
    final Map<SocialPlatform, UniversalPlatformPayload> payloads = {};
    if (rawPlatformPayloads is Map) {
      for (final entry in rawPlatformPayloads.entries) {
        final plat = SocialPlatform.parse(entry.key);
        if (plat != SocialPlatform.unknown && entry.value is Map) {
          payloads[plat] = UniversalPlatformPayload.fromJson(jMap(entry.value));
        }
      }
    }

    return UserAssistedPublishPackage(
      id: jStrOr(j['id'], ''),
      projectId: jStrOr(j['projectId'], ''),
      calendarItemId: jStr(j['calendarItemId']),
      mediaPath: jStr(j['mediaPath']) ?? jStr(j['mediaUri']),
      mimeType: jStrOr(j['mimeType'], 'video/mp4'),
      title: jStr(j['title']),
      caption: jStr(j['caption']),
      xPayload: j['xPayload'] is Map ? XPublishPayload.fromJson(jMap(j['xPayload'])) : null,
      redditPayload: j['redditPayload'] is Map ? RedditPublishPayload.fromJson(jMap(j['redditPayload'])) : null,
      platformPayloads: payloads,
      status: jStrOr(j['status'], 'ready'),
      createdAt: jDate(j['createdAt']),
    );
  }

  Json toJson() => compact({
        'id': id,
        'projectId': projectId,
        'calendarItemId': calendarItemId,
        'mediaPath': mediaPath,
        'mimeType': mimeType,
        'title': title,
        'caption': caption,
        'xPayload': xPayload?.toJson(),
        'redditPayload': redditPayload?.toJson(),
        'platformPayloads': platformPayloads.isNotEmpty
            ? platformPayloads.map((k, v) => MapEntry(k.id, v.toJson()))
            : null,
        'status': status,
        'createdAt': createdAt?.toIso8601String(),
      });
}
