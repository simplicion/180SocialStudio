import '../../core/util/json.dart';

/// A linked external asset (`GET /assets`). These are link records; nothing is uploaded.
class LinkedAsset {
  LinkedAsset({
    required this.id,
    required this.url,
    required this.type,
    this.title,
    this.description,
    this.tags = const [],
    this.createdAt,
  });

  final String id;
  final String url;
  final String type;
  final String? title;
  final String? description;
  final List<String> tags;
  final DateTime? createdAt;

  static const types = ['image', 'video', 'folder', 'other'];

  /// The assets and saved-banks endpoints share one table; hashtag/hook rows are not assets.
  bool get isBankItem => type == 'hashtag' || type == 'hook';

  factory LinkedAsset.fromJson(Json j) => LinkedAsset(
        id: jStrOr(j['id'], ''),
        url: jStr(j['url']) ?? jStr(j['content']) ?? '',
        type: jStrOr(j['type'], 'other'),
        title: jStr(j['title']) ?? jStr(j['name']),
        description: jStr(j['description']),
        tags: jStrList(j['tags']),
        createdAt: jDate(j['createdAt']),
      );
}

/// Hashtag or hook bank entry (`GET /saved-banks`).
class SavedBankItem {
  SavedBankItem({
    required this.id,
    required this.type,
    required this.name,
    required this.content,
    this.tags = const [],
    this.createdAt,
  });

  final String id;
  final String type;
  final String name;
  final String content;
  final List<String> tags;
  final DateTime? createdAt;

  factory SavedBankItem.fromJson(Json j) => SavedBankItem(
        id: jStrOr(j['id'], ''),
        type: jStrOr(j['type'], ''),
        name: jStrOr(j['name'], ''),
        content: jStrOr(j['content'], ''),
        tags: jStrList(j['tags']),
        createdAt: jDate(j['createdAt']),
      );
}

class EvergreenSlot {
  EvergreenSlot({
    required this.id,
    required this.projectId,
    required this.dayOfWeek,
    required this.timeSlotUtc,
    required this.category,
    this.isActive = true,
  });

  final String id;
  final String projectId;

  /// 0 = Sunday … 6 = Saturday.
  final int dayOfWeek;
  final String timeSlotUtc;
  final String category;
  final bool isActive;

  static const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  static const categoryPresets = ['Educational', 'Testimonial', 'Behind the scenes', 'Promotional', 'Evergreen tip'];

  String get dayName => dayOfWeek >= 0 && dayOfWeek < 7 ? dayNames[dayOfWeek] : 'Day $dayOfWeek';

  factory EvergreenSlot.fromJson(Json j) => EvergreenSlot(
        id: jStrOr(j['id'], ''),
        projectId: jStrOr(j['projectId'], ''),
        dayOfWeek: jInt(j['dayOfWeek']) ?? 0,
        timeSlotUtc: jStrOr(j['timeSlotUtc'], '00:00'),
        category: jStrOr(j['category'], ''),
        isActive: jBool(j['isActive'], true),
      );
}

/// A brand-voice content idea (`POST /brand-voice/:projectId/ideas`, proposed endpoint).
class ContentIdea {
  ContentIdea({required this.title, this.hook, this.caption, this.platform, this.pillar});
  final String title;
  final String? hook;
  final String? caption;
  final String? platform;
  final String? pillar;

  factory ContentIdea.fromJson(Json j) => ContentIdea(
        title: jStr(j['title']) ?? jStr(j['headline']) ?? '',
        hook: jStr(j['hook']),
        caption: jStr(j['caption']) ?? jStr(j['content']),
        platform: jStr(j['platform']),
        pillar: jStr(j['pillar']),
      );
}
