import '../../core/util/json.dart';
import 'platform.dart';

class InboxMessage {
  InboxMessage({required this.id, required this.senderType, required this.content, this.createdAt});
  final String id;

  /// `participant`, `agent` or `ai_bot`.
  final String senderType;
  final String content;
  final DateTime? createdAt;

  bool get isOutbound => senderType == 'agent' || senderType == 'ai_bot';

  factory InboxMessage.fromJson(Json j) => InboxMessage(
        id: jStrOr(j['id'], ''),
        senderType: jStrOr(j['senderType'], 'participant'),
        content: jStrOr(j['content'], ''),
        createdAt: jDate(j['createdAt']),
      );
}

class Conversation {
  Conversation({
    required this.id,
    required this.platform,
    required this.participantName,
    this.participantHandle,
    this.participantAvatar,
    this.lastMessageSnippet,
    this.lastMessageAt,
    this.isRead = false,
    this.convertedLeadId,
    this.projectId,
    this.projectName,
    this.accountName,
    this.aiAgentActive = false,
    this.isHumanTakeover = false,
    this.leadScore,
    this.leadStage,
    this.accountAiMode = 'off',
    this.messages = const [],
  });

  final String id;
  final SocialPlatform platform;
  final String participantName;
  final String? participantHandle;
  final String? participantAvatar;
  final String? lastMessageSnippet;
  final DateTime? lastMessageAt;
  final bool isRead;
  final String? convertedLeadId;
  final String? projectId;
  final String? projectName;
  final String? accountName;
  final bool aiAgentActive;
  final bool isHumanTakeover;
  /// AI inbox qualification: 0-100 and new | engaged | qualified | disqualified | handoff (null = not qualified yet).
  final int? leadScore;
  final String? leadStage;
  final List<InboxMessage> messages;

  /// The account's AI inbox mode (off | reply | qualify).
  final String accountAiMode;

  bool get isHotLead => leadStage == 'qualified' || leadStage == 'handoff';

  /// Whether the AI answers this thread: on via its own switch or the account mode, unless a person took it over.
  bool get aiAnswers => !isHumanTakeover && (aiAgentActive || accountAiMode != 'off');

  /// Construct the profile URL for this user on the platform (Instagram, Facebook, LinkedIn).
  String? get profileWebUrl {
    final handle = (participantHandle ?? '').replaceAll('@', '').trim();
    final target = handle.isNotEmpty && handle != 'anonymous' && handle != 'unknown'
        ? handle
        : participantName.replaceAll('@', '').trim();
    if (target.isEmpty || target == 'anonymous' || target == 'unknown' || target.startsWith('User ')) return null;
    return switch (platform) {
      SocialPlatform.instagram => 'https://www.instagram.com/$target/',
      SocialPlatform.facebook => 'https://www.facebook.com/$target',
      SocialPlatform.linkedin => target.startsWith('urn:li:')
          ? 'https://www.linkedin.com/feed/'
          : 'https://www.linkedin.com/in/$target',
      _ => null,
    };
  }

  /// Native app deep-link URI
  String? get profileAppUri {
    final handle = (participantHandle ?? '').replaceAll('@', '').trim();
    final target = handle.isNotEmpty && handle != 'anonymous' && handle != 'unknown'
        ? handle
        : participantName.replaceAll('@', '').trim();
    if (target.isEmpty || target == 'anonymous' || target == 'unknown' || target.startsWith('User ')) return null;
    return switch (platform) {
      SocialPlatform.instagram => 'instagram://user?username=$target',
      SocialPlatform.facebook => 'fb://facewebmodal/f?href=https://www.facebook.com/$target',
      SocialPlatform.linkedin => 'linkedin://in/$target',
      _ => null,
    };
  }

  /// Reliable avatar URL: uses stored participantAvatar if present, or unavatar / dicebear initials
  String get displayAvatarUrl {
    if (participantAvatar != null && participantAvatar!.trim().isNotEmpty) {
      return participantAvatar!;
    }
    final handle = (participantHandle ?? '').replaceAll('@', '').trim();
    final target = handle.isNotEmpty && handle != 'anonymous' && handle != 'unknown'
        ? handle
        : participantName.replaceAll('@', '').trim();
    final cleanSeed = Uri.encodeComponent(target.isNotEmpty ? target : 'user');
    return switch (platform) {
      SocialPlatform.instagram => target.isNotEmpty && !target.startsWith('User ')
          ? 'https://unavatar.io/instagram/$target?fallback=https://api.dicebear.com/7.x/initials/png?seed=$cleanSeed'
          : 'https://api.dicebear.com/7.x/initials/png?seed=$cleanSeed',
      SocialPlatform.facebook => target.isNotEmpty && !target.startsWith('User ')
          ? 'https://unavatar.io/facebook/$target?fallback=https://api.dicebear.com/7.x/initials/png?seed=$cleanSeed'
          : 'https://api.dicebear.com/7.x/initials/png?seed=$cleanSeed',
      SocialPlatform.linkedin => target.isNotEmpty && !target.startsWith('User ') && !target.startsWith('urn:li:')
          ? 'https://unavatar.io/linkedin/$target?fallback=https://api.dicebear.com/7.x/initials/png?seed=$cleanSeed'
          : 'https://api.dicebear.com/7.x/initials/png?seed=$cleanSeed',
      _ => 'https://api.dicebear.com/7.x/initials/png?seed=$cleanSeed',
    };
  }

  factory Conversation.fromJson(Json j) {
    final account = jMapOrNull(j['socialAccount']);
    final project = jMapOrNull(j['project']);
    return Conversation(
      id: jStrOr(j['id'], ''),
      platform: SocialPlatform.parse(j['platform']),
      participantName: jStr(j['participantName']) ?? jStr(j['participantHandle']) ?? 'Unknown',
      participantHandle: jStr(j['participantHandle']),
      participantAvatar: jStr(j['participantAvatar']),
      lastMessageSnippet: jStr(j['lastMessageSnippet']),
      lastMessageAt: jDate(j['lastMessageAt']),
      isRead: jBool(j['isRead']),
      convertedLeadId: jStr(j['convertedLeadId']),
      projectId: jStr(j['projectId']),
      projectName: project == null ? null : jStr(project['name']),
      accountName: account == null ? null : jStr(account['accountName']),
      aiAgentActive: jBool(j['aiAgentActive']),
      isHumanTakeover: jBool(j['isHumanTakeover']),
      leadScore: (j['leadScore'] as num?)?.toInt(),
      leadStage: jStr(j['leadStage']),
      accountAiMode: account == null ? 'off' : jStrOr(account['aiInboxMode'], 'off'),
      messages: jList(j['messages'], InboxMessage.fromJson),
    );
  }
}

class ReplySuggestion {
  ReplySuggestion({required this.tone, required this.text});
  final String tone;
  final String text;

  factory ReplySuggestion.fromJson(Json j) =>
      ReplySuggestion(tone: jStrOr(j['tone'], ''), text: jStrOr(j['text'], ''));
}

/// One account's AI inbox setting (GET /inbox/ai-settings).
class AiInboxAccount {
  AiInboxAccount({
    required this.id,
    required this.platform,
    required this.accountName,
    this.username,
    this.mode = 'off',
    this.instructions,
    this.dmSupported = false,
    this.reauthRequired = false,
  });

  final String id;
  final SocialPlatform platform;
  final String accountName;
  final String? username;
  /// off | reply | qualify
  final String mode;
  final String? instructions;
  final bool dmSupported;
  final bool reauthRequired;

  factory AiInboxAccount.fromJson(Json j) => AiInboxAccount(
        id: jStrOr(j['id'], ''),
        platform: SocialPlatform.parse(j['platform']),
        accountName: jStrOr(j['accountName'], 'Account'),
        username: jStr(j['username']),
        mode: jStrOr(j['aiInboxMode'], 'off'),
        instructions: jStr(j['aiInboxInstructions']),
        dmSupported: jBool(j['dmSupported']),
        reauthRequired: jBool(j['reauthRequired']),
      );
}
