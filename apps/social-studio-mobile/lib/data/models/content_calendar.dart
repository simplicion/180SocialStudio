import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';

enum CalendarStatus {
  draft('draft', 'Draft'),
  processing('processing', 'Processing'),
  active('active', 'Active'),
  archived('archived', 'Archived'),
  failed('failed', 'Failed'),
  unknown('unknown', 'Unknown');

  const CalendarStatus(this.id, this.label);
  final String id;
  final String label;

  Color get color {
    switch (this) {
      case CalendarStatus.draft: return AppTheme.textSecondary;
      case CalendarStatus.processing: return AppTheme.accentBlue;
      case CalendarStatus.active: return AppTheme.success;
      case CalendarStatus.archived: return AppTheme.textMuted;
      case CalendarStatus.failed: return AppTheme.error;
      case CalendarStatus.unknown: return AppTheme.textMuted;
    }
  }

  static const filters = [draft, processing, active, archived, failed];

  static CalendarStatus parse(Object? raw) =>
      CalendarStatus.values.firstWhere((s) => s.id == raw, orElse: () => CalendarStatus.unknown);
}

/// `CalendarContentPiece.status`, 1:1 with the backend enum.
enum PieceStatus {
  ready('ready', 'Ready'),
  inProgress('in_progress', 'In progress'),
  shot('shot', 'Shot, ready to edit'),
  pendingReview('pending_review', 'Pending review'),
  published('published', 'Published'),
  unknown('unknown', 'Unknown');

  const PieceStatus(this.id, this.label);
  final String id;
  final String label;

  Color get color {
    switch (this) {
      case PieceStatus.ready: return AppTheme.accentBlue;
      case PieceStatus.inProgress: return AppTheme.accent;
      case PieceStatus.shot: return AppTheme.primary;
      case PieceStatus.pendingReview: return AppTheme.warning;
      case PieceStatus.published: return AppTheme.success;
      case PieceStatus.unknown: return AppTheme.textMuted;
    }
  }

  static const settable = [ready, inProgress, shot, pendingReview, published];

  static PieceStatus parse(Object? raw) =>
      PieceStatus.values.firstWhere((s) => s.id == raw, orElse: () => PieceStatus.unknown);
}

class ContentCalendar {
  ContentCalendar({
    required this.id,
    required this.name,
    this.status = CalendarStatus.unknown,
    this.brandName,
    this.industry,
    this.subdomain,
    this.targetAudience,
    this.platforms = const [],
    this.calendarDuration,
    this.frequency,
    this.timezone,
    this.calendarType,
    this.brandVoice,
    this.contentPillars = const [],
    this.engagementGoal,
    this.hashtagStrategy,
    this.competitors = const [],
    this.totalPieces = 0,
    this.reelsCount = 0,
    this.postsCount = 0,
    this.carouselsCount = 0,
    this.isTemplate = false,
    this.templateName,
    this.projectId,
    this.clientId,
    this.startDate,
    this.endDate,
    this.createdAt,
    this.raw = const {},
    this.pieces = const [],
  });

  final String id;
  final String name;
  final CalendarStatus status;
  final String? brandName;
  final String? industry;
  final String? subdomain;
  final String? targetAudience;
  final List<String> platforms;
  final String? calendarDuration;
  final String? frequency;
  final String? timezone;
  final String? calendarType;
  final String? brandVoice;
  final List<String> contentPillars;
  final String? engagementGoal;
  final String? hashtagStrategy;
  final List<String> competitors;
  final int totalPieces;
  final int reelsCount;
  final int postsCount;
  final int carouselsCount;
  final bool isTemplate;
  final String? templateName;
  final String? projectId;
  final String? clientId;
  final DateTime? startDate;
  final DateTime? endDate;
  final DateTime? createdAt;
  final Json raw;
  final List<CalendarPiece> pieces;

  String get displayName => brandName?.isNotEmpty == true ? brandName! : name;

  factory ContentCalendar.fromJson(Json j, {List<CalendarPiece> pieces = const []}) => ContentCalendar(
        id: jStr(j['id']) ?? jStrOr(j['_id'], ''),
        name: jStr(j['name']) ?? 'Content calendar',
        status: CalendarStatus.parse(j['status']),
        brandName: jStr(j['brandName'] ?? j['brand_name']),
        industry: jStr(j['industry']),
        subdomain: jStr(j['subdomain']),
        targetAudience: jStr(j['targetAudience'] ?? j['target_audience']),
        platforms: jStrList(j['platforms']),
        calendarDuration: jStr(j['calendarDuration'] ?? j['durationWords']),
        frequency: jStr(j['frequency']),
        timezone: jStr(j['timezone']),
        calendarType: jStr(j['calendarType']),
        brandVoice: jStr(j['brandVoice'] ?? j['tone']),
        contentPillars: jStrList(j['contentPillars']),
        engagementGoal: jStr(j['engagementGoal']),
        hashtagStrategy: jStr(j['hashtagStrategy']),
        competitors: jStrList(j['competitors']),
        totalPieces: jInt(j['totalPieces']) ?? pieces.length,
        reelsCount: jInt(j['reelsCount']) ?? 0,
        postsCount: jInt(j['postsCount']) ?? 0,
        carouselsCount: jInt(j['carouselsCount']) ?? 0,
        isTemplate: jBool(j['isTemplate']),
        templateName: jStr(j['templateName']),
        projectId: jStr(j['projectId']),
        clientId: jStr(j['clientId']),
        startDate: jDate(j['startDate']),
        endDate: jDate(j['endDate']),
        createdAt: jDate(j['createdAt']),
        raw: j,
        pieces: pieces,
      );

  /// Pieces grouped by week number, ascending.
  Map<int, List<CalendarPiece>> get piecesByWeek {
    final out = <int, List<CalendarPiece>>{};
    for (final p in pieces) {
      out.putIfAbsent(p.weekNumber, () => []).add(p);
    }
    return Map.fromEntries(out.entries.toList()..sort((a, b) => a.key.compareTo(b.key)));
  }
}

class CalendarPiece {
  CalendarPiece({
    required this.id,
    required this.calendarId,
    this.weekNumber = 1,
    this.dateScheduled,
    this.platform = '',
    this.contentType = '',
    this.pillar = '',
    this.headline = '',
    this.adCopyFull = '',
    this.videoScriptOrHooks = '',
    this.visualAssetsBrief = '',
    this.hashtags = const [],
    this.callToAction = '',
    this.postingTimeTz = '',
    this.notes = '',
    this.status = PieceStatus.ready,
    this.viralScore,
    this.estimatedImpressions,
    this.estimatedEngagementPercent,
    this.rawMediaUrls = const [],
    this.finalVideoUrl,
    this.thumbnailUrl,
    this.psychologicalJob,
    this.designSystem,
    this.visualDirection,
    this.whatContentDelivers,
  });

  final String id;
  final String calendarId;
  final int weekNumber;
  final DateTime? dateScheduled;
  final String platform;
  final String contentType;
  final String pillar;
  final String headline;
  final String adCopyFull;
  final String videoScriptOrHooks;
  final String visualAssetsBrief;
  final List<String> hashtags;
  final String callToAction;
  final String postingTimeTz;
  final String notes;
  final PieceStatus status;
  final double? viralScore;

  /// Stored as a string column; shown as-is.
  final String? estimatedImpressions;
  final double? estimatedEngagementPercent;
  final List<String> rawMediaUrls;
  final String? finalVideoUrl;
  final String? thumbnailUrl;
  final String? psychologicalJob;
  final String? designSystem;
  final String? visualDirection;
  final String? whatContentDelivers;

  factory CalendarPiece.fromJson(Json j) {
    final target = jMap(j['engagementTarget']);
    final impressions = target['estimatedImpressions'] ?? j['engagementTargetEstimatedImpressions'];
    return CalendarPiece(
      id: jStr(j['id']) ?? jStrOr(j['_id'], ''),
      calendarId: jStrOr(j['calendarId'], ''),
      weekNumber: jInt(j['weekNumber']) ?? 1,
      dateScheduled: jDate(j['dateScheduled']),
      platform: jStrOr(j['platform'], ''),
      contentType: jStrOr(j['contentType'], ''),
      pillar: jStrOr(j['pillar'], ''),
      headline: jStrOr(j['headline'], ''),
      adCopyFull: jStrOr(j['adCopyFull'], ''),
      videoScriptOrHooks: jStrOr(j['videoScriptOrHooks'], ''),
      visualAssetsBrief: jStrOr(j['visualAssetsBrief'], ''),
      hashtags: j['hashtags'] != null ? jStrList(j['hashtags']) : jStrList(j['hashtagsResearched']),
      callToAction: jStrOr(j['callToAction'], ''),
      postingTimeTz: jStrOr(j['postingTimeTz'], ''),
      notes: jStrOr(j['notes'], ''),
      status: PieceStatus.parse(j['status']),
      viralScore: jDouble(j['viralScore']),
      estimatedImpressions: impressions == null || impressions == 0 ? null : '$impressions',
      estimatedEngagementPercent: jDouble(target['estimatedEngagementPercent'] ??
          j['engagementTargetEstimatedEngagementPercent']),
      rawMediaUrls: jStrList(j['rawMediaUrls']),
      finalVideoUrl: jStr(j['finalVideoUrl']),
      thumbnailUrl: jStr(j['thumbnailUrl']),
      psychologicalJob: jStr(j['psychologicalJob']),
      designSystem: jStr(j['designSystem']),
      visualDirection: jStr(j['visualDirection']),
      whatContentDelivers: jStr(j['whatContentDelivers']),
    );
  }
}

/// Body of `POST /content-calendar/create` (`CalendarConfig`).
class CalendarConfig {
  CalendarConfig({
    this.calendarType = 'company',
    this.brandName = '',
    this.industry = '',
    this.subdomain = '',
    this.targetAudience = '',
    List<String>? platforms,
    this.durationWords = '1 month',
    this.frequency = '3x a week',
    DateTime? startDate,
    this.timezone = 'UTC',
    List<String>? contentPillars,
    this.brandVoice = '',
    this.engagementGoal = '',
    this.hashtagStrategy = '',
    List<String>? competitors,
    this.marketingBudget = '',
    this.personalGoals = '',
    this.projectId,
  })  : platforms = platforms ?? <String>[],
        contentPillars = contentPillars ?? <String>[],
        competitors = competitors ?? <String>[],
        startDate = startDate ?? DateTime.now();

  String calendarType;
  String brandName;
  String industry;
  String subdomain;
  String targetAudience;
  List<String> platforms;
  String durationWords;
  String frequency;
  DateTime startDate;
  String timezone;
  List<String> contentPillars;
  String brandVoice;
  String engagementGoal;
  String hashtagStrategy;
  List<String> competitors;
  String marketingBudget;
  String personalGoals;
  String? projectId;

  static const platformOptions = ['Instagram', 'LinkedIn', 'Twitter/X', 'Facebook', 'Threads', 'YouTube Shorts'];
  static const durationOptions = ['1 week', '2 weeks', '1 month'];
  static const frequencyOptions = ['1x a week', '3x a week', '5x a week', 'Daily'];

  /// Prefill from an existing calendar ("Extend for next month").
  factory CalendarConfig.extend(ContentCalendar c) {
    final nextStart = c.endDate ?? DateTime.now();
    return CalendarConfig(
      calendarType: c.calendarType ?? 'company',
      brandName: c.brandName ?? c.name,
      industry: c.industry ?? '',
      subdomain: c.subdomain ?? '',
      targetAudience: c.targetAudience ?? '',
      platforms: [...c.platforms],
      durationWords: c.calendarDuration ?? '1 month',
      frequency: c.frequency ?? '3x a week',
      startDate: nextStart.isBefore(DateTime.now()) ? DateTime.now() : nextStart,
      timezone: c.timezone ?? 'UTC',
      contentPillars: [...c.contentPillars],
      brandVoice: c.brandVoice ?? '',
      engagementGoal: c.engagementGoal ?? '',
      hashtagStrategy: c.hashtagStrategy ?? '',
      competitors: [...c.competitors],
      marketingBudget: jStr(c.raw['marketingBudget']) ?? '',
      personalGoals: jStr(c.raw['personalGoals']) ?? '',
      projectId: c.projectId,
    );
  }

  Json toJson() => {
        'calendarType': calendarType,
        'brand_name': brandName.trim(),
        'industry': industry.trim(),
        if (subdomain.trim().isNotEmpty) 'subdomain': subdomain.trim(),
        'target_audience': targetAudience.trim(),
        'platforms': platforms,
        'durationWords': durationWords,
        'frequency': frequency,
        'startDate': '${startDate.year.toString().padLeft(4, '0')}-${startDate.month.toString().padLeft(2, '0')}-${startDate.day.toString().padLeft(2, '0')}',
        'timezone': timezone,
        'contentPillars': contentPillars,
        'brandVoice': brandVoice.trim(),
        'engagementGoal': engagementGoal.trim(),
        'hashtagStrategy': hashtagStrategy.trim(),
        'competitors': competitors,
        if (calendarType == 'company' && marketingBudget.trim().isNotEmpty) 'marketingBudget': marketingBudget.trim(),
        if (calendarType == 'personal' && personalGoals.trim().isNotEmpty) 'personalGoals': personalGoals.trim(),
        if (projectId != null && projectId!.trim().isNotEmpty) 'projectId': projectId!.trim(),
      };
}
