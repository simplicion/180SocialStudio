import '../../core/util/json.dart';

class EngagementRule {
  EngagementRule({
    required this.id,
    required this.companyId,
    required this.name,
    this.projectId,
    this.socialAccountId,
    this.postId,
    this.platformMediaId,
    this.platformMediaPermalink,
    this.platformMediaThumbnail,
    this.status = 'active',
    required this.triggerType,
    this.triggerKeywords = const [],
    this.matchMode = 'contains',
    this.actionAutoLike = false,
    this.actionPublicReplies = const [],
    this.actionSendDm = true,
    required this.actionDmTemplate,
    this.actionDmDeliverableUrl,
    this.actionEnableAiAgent = false,
    this.aiAgentGoal = 'qualify_lead',
    this.aiAgentPromptOverride,
    this.totalTriggered = 0,
    this.totalDmsSent = 0,
    this.totalLiked = 0,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String companyId;
  final String name;
  final String? projectId;
  final String? socialAccountId;
  final String? postId;
  /// Existing platform post (published outside the app) this rule targets; see [AccountMediaItem].
  final String? platformMediaId;
  final String? platformMediaPermalink;
  final String? platformMediaThumbnail;
  final String status;
  final String triggerType;
  final List<String> triggerKeywords;
  final String matchMode;
  final bool actionAutoLike;
  final List<String> actionPublicReplies;
  final bool actionSendDm;
  final String actionDmTemplate;
  final String? actionDmDeliverableUrl;
  final bool actionEnableAiAgent;
  final String aiAgentGoal;
  final String? aiAgentPromptOverride;
  final int totalTriggered;
  final int totalDmsSent;
  final int totalLiked;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get isActive => status == 'active';

  factory EngagementRule.fromJson(Json j) => EngagementRule(
        id: jStrOr(j['id'], ''),
        companyId: jStrOr(j['companyId'], ''),
        name: jStrOr(j['name'], 'Engagement Rule'),
        projectId: jStr(j['projectId']),
        socialAccountId: jStr(j['socialAccountId']),
        postId: jStr(j['postId']),
        platformMediaId: jStr(j['platformMediaId']),
        platformMediaPermalink: jStr(j['platformMediaPermalink']),
        platformMediaThumbnail: jStr(j['platformMediaThumbnail']),
        status: jStrOr(j['status'], 'active'),
        triggerType: jStrOr(j['triggerType'], 'comment_keyword'),
        triggerKeywords: jStrList(j['triggerKeywords']),
        matchMode: jStrOr(j['matchMode'], 'contains'),
        actionAutoLike: jBool(j['actionAutoLike']),
        actionPublicReplies: jStrList(j['actionPublicReplies']),
        actionSendDm: jBool(j['actionSendDm'], true),
        actionDmTemplate: jStrOr(j['actionDmTemplate'], ''),
        actionDmDeliverableUrl: jStr(j['actionDmDeliverableUrl']),
        actionEnableAiAgent: jBool(j['actionEnableAiAgent']),
        aiAgentGoal: jStrOr(j['aiAgentGoal'], 'qualify_lead'),
        aiAgentPromptOverride: jStr(j['aiAgentPromptOverride']),
        totalTriggered: jInt(j['totalTriggered']) ?? 0,
        totalDmsSent: jInt(j['totalDmsSent']) ?? 0,
        totalLiked: jInt(j['totalLiked']) ?? 0,
        createdAt: jDate(j['createdAt']),
        updatedAt: jDate(j['updatedAt']),
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        if (projectId != null) 'projectId': projectId,
        if (socialAccountId != null) 'socialAccountId': socialAccountId,
        if (postId != null) 'postId': postId,
        if (platformMediaId != null) 'platformMediaId': platformMediaId,
        if (platformMediaPermalink != null) 'platformMediaPermalink': platformMediaPermalink,
        if (platformMediaThumbnail != null) 'platformMediaThumbnail': platformMediaThumbnail,
        'status': status,
        'triggerType': triggerType,
        'triggerKeywords': triggerKeywords,
        'matchMode': matchMode,
        'actionAutoLike': actionAutoLike,
        'actionPublicReplies': actionPublicReplies,
        'actionSendDm': actionSendDm,
        'actionDmTemplate': actionDmTemplate,
        if (actionDmDeliverableUrl != null) 'actionDmDeliverableUrl': actionDmDeliverableUrl,
        'actionEnableAiAgent': actionEnableAiAgent,
        'aiAgentGoal': aiAgentGoal,
        if (aiAgentPromptOverride != null) 'aiAgentPromptOverride': aiAgentPromptOverride,
      };
}

class EngagementStats {
  EngagementStats({
    this.totalRules = 0,
    this.activeRules = 0,
    this.totalTriggered = 0,
    this.totalDmsSent = 0,
    this.totalLiked = 0,
    this.totalLeadsGenerated = 0,
  });

  final int totalRules;
  final int activeRules;
  final int totalTriggered;
  final int totalDmsSent;
  final int totalLiked;
  final int totalLeadsGenerated;

  factory EngagementStats.fromJson(Json j) => EngagementStats(
        totalRules: jInt(j['totalRules']) ?? 0,
        activeRules: jInt(j['activeRules']) ?? 0,
        totalTriggered: jInt(j['totalTriggered']) ?? 0,
        totalDmsSent: jInt(j['totalDmsSent']) ?? 0,
        totalLiked: jInt(j['totalLiked']) ?? 0,
        totalLeadsGenerated: jInt(j['totalLeadsGenerated']) ?? 0,
      );
}

class BatchAiReplySuggestion {
  BatchAiReplySuggestion({
    required this.conversationId,
    required this.platform,
    required this.participantHandle,
    required this.lastCustomerMessage,
    required this.suggestedReply,
    required this.tone,
    this.selected = true,
    this.intent,
    this.canSend = true,
    this.blockedReason,
  });

  final String conversationId;
  final String platform;
  final String participantHandle;
  final String lastCustomerMessage;
  String suggestedReply;
  final String tone;
  bool selected;
  /// Classified intent (lead, question, support, praise, complaint, spam, other).
  final String? intent;
  /// False when the platform / messaging window does not allow this reply now.
  final bool canSend;
  final String? blockedReason;
  /// Set after a dispatch attempt that did not send this item (failure or rate limit).
  String? dispatchError;

  factory BatchAiReplySuggestion.fromJson(Json j) => BatchAiReplySuggestion(
        conversationId: jStrOr(j['conversationId'], ''),
        platform: jStrOr(j['platform'], 'instagram'),
        participantHandle: jStrOr(j['participantHandle'], 'user'),
        lastCustomerMessage: jStrOr(j['lastCustomerMessage'], ''),
        suggestedReply: jStrOr(j['suggestedReply'], ''),
        tone: jStrOr(j['intent'] ?? j['tone'], ''),
        selected: jBool(j['selected'], true),
        intent: jStr(j['intent']),
        canSend: jBool(j['canSend'], true),
        blockedReason: jStr(j['blockedReason']),
      );
}

/// A post already published on the platform (GET /accounts/:id/media), pickable as an automation target.
class AccountMediaItem {
  AccountMediaItem({
    required this.id,
    required this.platform,
    this.caption,
    this.mediaType,
    this.thumbnailUrl,
    this.permalink,
    this.timestamp,
    this.commentsCount,
  });

  final String id;
  final String platform;
  final String? caption;
  final String? mediaType;
  final String? thumbnailUrl;
  final String? permalink;
  final DateTime? timestamp;
  final int? commentsCount;

  factory AccountMediaItem.fromJson(Json j) => AccountMediaItem(
        id: jStrOr(j['id'], ''),
        platform: jStrOr(j['platform'], ''),
        caption: jStr(j['caption']),
        mediaType: jStr(j['mediaType']),
        thumbnailUrl: jStr(j['thumbnailUrl']),
        permalink: jStr(j['permalink']),
        timestamp: DateTime.tryParse(jStrOr(j['timestamp'], '')),
        commentsCount: (j['commentsCount'] as num?)?.toInt(),
      );
}
