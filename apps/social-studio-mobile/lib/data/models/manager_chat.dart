import '../../core/util/json.dart';

class ManagerActionModel {
  ManagerActionModel({
    required this.id,
    required this.label,
    required this.type,
    this.payload = const {},
  });

  final String id;
  final String label;
  final String type;
  final Json payload;

  factory ManagerActionModel.fromJson(Json j) => ManagerActionModel(
        id: jStrOr(j['id'], ''),
        label: jStrOr(j['label'], 'Action'),
        type: jStrOr(j['type'], 'quick_reply'),
        payload: jMap(j['payload']),
      );
}

class ManagerChatMessage {
  ManagerChatMessage({
    required this.senderType,
    required this.content,
    this.intent,
    this.delegatedAgents = const [],
    this.suggestedActions = const [],
    this.createdAt,
  });

  final String senderType; // 'user' | 'manager' | 'system'
  final String content;
  final String? intent;
  final List<String> delegatedAgents;
  final List<ManagerActionModel> suggestedActions;
  final DateTime? createdAt;

  bool get isUser => senderType == 'user';
}

class ManagerTurnResponse {
  ManagerTurnResponse({
    required this.reply,
    required this.intent,
    this.delegatedAgents = const [],
    this.suggestedActions = const [],
    required this.conversationId,
  });

  final String reply;
  final String intent;
  final List<String> delegatedAgents;
  final List<ManagerActionModel> suggestedActions;
  final String conversationId;

  factory ManagerTurnResponse.fromJson(Json j) => ManagerTurnResponse(
        reply: jStrOr(j['reply'], ''),
        intent: jStrOr(j['intent'], 'general_query'),
        delegatedAgents: jStrList(j['delegatedAgents']),
        suggestedActions: jList(j['suggestedActions'], ManagerActionModel.fromJson),
        conversationId: jStrOr(j['conversationId'], ''),
      );
}
