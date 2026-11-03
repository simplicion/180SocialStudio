import '../../core/util/json.dart';
import 'content_calendar.dart';

/// Trend Lab research report (`/projects/:id/trend-lab/reports/:reportId`).
/// Every number here was computed by the server from source data; the app only formats it.

class TrendLabLane {
  const TrendLabLane({required this.lane, required this.on, this.hint});
  final String lane;
  final bool on;
  final String? hint;

  factory TrendLabLane.fromJson(Json j) => TrendLabLane(lane: jStrOr(j['lane'], ''), on: j['on'] == true, hint: jStr(j['hint']));
}

class TrendReportJob {
  const TrendReportJob({required this.reportId, required this.topic, required this.status, required this.stage, required this.progress, this.detail, this.errorCode, this.errorMessage, this.report});
  final String reportId;
  final String topic;

  /// queued | running | done | failed
  final String status;

  /// planning | gathering | social_pulse | platform_signal | web_news | analyst | done | failed
  final String stage;
  final int progress;
  final String? detail;
  final String? errorCode;
  final String? errorMessage;
  final TrendReport? report;

  bool get isDone => status == 'done';
  bool get isFailed => status == 'failed';
  bool get isRunning => !isDone && !isFailed;

  factory TrendReportJob.fromJson(Json j) {
    final err = jMap(j['error']);
    final rep = jMap(j['report']);
    return TrendReportJob(
      reportId: jStrOr(j['reportId'], ''),
      topic: jStrOr(j['topic'], ''),
      status: jStrOr(j['status'], 'queued'),
      stage: jStrOr(j['stage'], 'queued'),
      progress: jInt(j['progress']) ?? 0,
      detail: jStr(j['detail']),
      errorCode: jStr(err['code']),
      errorMessage: jStr(err['message']),
      report: rep.isEmpty ? null : TrendReport.fromJson(rep),
    );
  }
}

class TrendReportSummary {
  const TrendReportSummary({required this.reportId, required this.topic, required this.status, this.createdAt, this.topTrendTitle, this.topVerdict, this.topOpportunity});
  final String reportId;
  final String topic;
  final String status;
  final DateTime? createdAt;
  final String? topTrendTitle;
  final String? topVerdict;
  final int? topOpportunity;

  factory TrendReportSummary.fromJson(Json j) {
    final top = jMap(j['topTrend']);
    return TrendReportSummary(
      reportId: jStrOr(j['reportId'], ''),
      topic: jStrOr(j['topic'], ''),
      status: jStrOr(j['status'], ''),
      createdAt: jDate(j['createdAt']),
      topTrendTitle: jStr(top['title']),
      topVerdict: jStr(top['verdict']),
      topOpportunity: jInt(top['opportunityScore']),
    );
  }
}

class TrendSourceStatus {
  const TrendSourceStatus({required this.agent, required this.source, required this.status, required this.items, this.detail});
  final String agent;
  final String source;

  /// ok | empty | skipped | error
  final String status;
  final int items;
  final String? detail;

  factory TrendSourceStatus.fromJson(Json j) => TrendSourceStatus(
        agent: jStrOr(j['agent'], ''),
        source: jStrOr(j['source'], ''),
        status: jStrOr(j['status'], ''),
        items: jInt(j['items']) ?? 0,
        detail: jStr(j['detail']),
      );
}

class TrendSentiment {
  const TrendSentiment({this.positive = 0, this.negative = 0, this.mixed = 0, this.neutral = 0, this.n = 0});
  final int positive, negative, mixed, neutral, n;
  factory TrendSentiment.fromJson(Json j) => TrendSentiment(
        positive: jInt(j['positive']) ?? 0,
        negative: jInt(j['negative']) ?? 0,
        mixed: jInt(j['mixed']) ?? 0,
        neutral: jInt(j['neutral']) ?? 0,
        n: jInt(j['n']) ?? 0,
      );
}

class TrendMetrics {
  const TrendMetrics({
    required this.volume,
    required this.totalItems,
    required this.engagementIndex,
    this.momentum,
    required this.momentumLabel,
    this.youtubeUploads,
    this.youtubeMedianViews,
    required this.saturationLabel,
    required this.sentiment,
    required this.brandFit,
    required this.opportunityScore,
    required this.confidence,
    required this.verdict,
    required this.verdictReasons,
  });
  final Map<String, int> volume;
  final int totalItems;
  final int engagementIndex;
  final double? momentum;

  /// rising | steady | cooling | unknown
  final String momentumLabel;
  final int? youtubeUploads;
  final int? youtubeMedianViews;

  /// low | medium | high | unknown
  final String saturationLabel;
  final TrendSentiment sentiment;
  final int brandFit;
  final int opportunityScore;
  final int confidence;

  /// create_now | sharpen_angle | wait | skip
  final String verdict;
  final List<String> verdictReasons;

  factory TrendMetrics.fromJson(Json j) {
    final sat = jMap(j['saturation']);
    final vol = jMap(j['volume']);
    return TrendMetrics(
      volume: {for (final e in vol.entries) e.key: jInt(e.value) ?? 0},
      totalItems: jInt(j['totalItems']) ?? 0,
      engagementIndex: jInt(j['engagementIndex']) ?? 0,
      momentum: jDouble(j['momentum']),
      momentumLabel: jStrOr(j['momentumLabel'], 'unknown'),
      youtubeUploads: jInt(sat['youtubeUploads30d']),
      youtubeMedianViews: jInt(sat['youtubeMedianViews']),
      saturationLabel: jStrOr(sat['label'], 'unknown'),
      sentiment: TrendSentiment.fromJson(jMap(j['sentiment'])),
      brandFit: jInt(j['brandFit']) ?? 0,
      opportunityScore: jInt(j['opportunityScore']) ?? 0,
      confidence: jInt(j['confidence']) ?? 0,
      verdict: jStrOr(j['verdict'], 'wait'),
      verdictReasons: jStrList(j['verdictReasons']),
    );
  }
}

class TrendItem {
  const TrendItem({required this.source, required this.url, required this.title, this.publishedAt, this.engagement, this.engagementUnit});
  final String source;
  final String url;
  final String title;
  final String? publishedAt;
  final int? engagement;

  /// views | upvotes | likes | engagements
  final String? engagementUnit;

  factory TrendItem.fromJson(Json j) {
    final e = jMap(j['engagement']);
    final unit = jInt(e['views']) != null
        ? 'views'
        : jInt(e['upvotes']) != null
            ? 'upvotes'
            : jInt(e['likes']) != null
                ? 'likes'
                : 'engagements';
    return TrendItem(
      source: jStrOr(j['source'], ''),
      url: jStrOr(j['url'], ''),
      title: jStrOr(j['title'], ''),
      publishedAt: jStr(j['publishedAt']),
      engagement: jInt(e['primary']),
      engagementUnit: jInt(e['primary']) == null ? null : unit,
    );
  }
}

class TrendQuote {
  const TrendQuote({required this.quote, required this.source, required this.url});
  final String quote, source, url;
  factory TrendQuote.fromJson(Json j) => TrendQuote(quote: jStrOr(j['quote'], ''), source: jStrOr(j['source'], ''), url: jStrOr(j['url'], ''));
}

class TrendAngle {
  const TrendAngle({required this.id, required this.title, required this.tension, required this.draftHook, required this.format, required this.hookScore, required this.hookGrade});
  final String id, title, tension, draftHook, format, hookGrade;
  final int hookScore;
  factory TrendAngle.fromJson(Json j) => TrendAngle(
        id: jStrOr(j['id'], ''),
        title: jStrOr(j['title'], ''),
        tension: jStrOr(j['tension'], ''),
        draftHook: jStrOr(j['draftHook'], ''),
        format: jStrOr(j['format'], 'reel'),
        hookScore: jInt(j['hookScore']) ?? 0,
        hookGrade: jStrOr(j['hookGrade'], ''),
      );
}

class TrendCluster {
  const TrendCluster({
    required this.id,
    required this.title,
    required this.summary,
    required this.whyNow,
    required this.audienceQuestions,
    required this.brandFit,
    required this.brandFitReason,
    required this.metrics,
    required this.items,
    required this.quotes,
    required this.angles,
  });
  final String id, title, summary, whyNow, brandFit, brandFitReason;
  final List<String> audienceQuestions;
  final TrendMetrics metrics;
  final List<TrendItem> items;
  final List<TrendQuote> quotes;
  final List<TrendAngle> angles;

  factory TrendCluster.fromJson(Json j) => TrendCluster(
        id: jStrOr(j['id'], ''),
        title: jStrOr(j['title'], ''),
        summary: jStrOr(j['summary'], ''),
        whyNow: jStrOr(j['whyNow'], ''),
        audienceQuestions: jStrList(j['audienceQuestions']),
        brandFit: jStrOr(j['brandFit'], 'partial'),
        brandFitReason: jStrOr(j['brandFitReason'], ''),
        metrics: TrendMetrics.fromJson(jMap(j['metrics'])),
        items: jList(j['items'], TrendItem.fromJson),
        quotes: jList(j['reactionQuotes'], TrendQuote.fromJson),
        angles: jList(j['angles'], TrendAngle.fromJson),
      );
}

class TrendOutlookFormat {
  const TrendOutlookFormat({required this.format, required this.posts, required this.medianMultiple, required this.label});
  final String format;
  final int posts;
  final double medianMultiple;

  /// above | around | below
  final String label;
  factory TrendOutlookFormat.fromJson(Json j) => TrendOutlookFormat(
        format: jStrOr(j['format'], ''),
        posts: jInt(j['posts']) ?? 0,
        medianMultiple: jDouble(j['medianMultiple']) ?? 1,
        label: jStrOr(j['label'], 'around'),
      );
}

class TrendReport {
  const TrendReport({required this.topic, required this.windowDays, required this.clusters, required this.statuses, required this.outlookAvailable, required this.outlookNote, required this.outlookByFormat, required this.methodology});
  final String topic;
  final int windowDays;
  final List<TrendCluster> clusters;
  final List<TrendSourceStatus> statuses;
  final bool outlookAvailable;
  final String outlookNote;
  final List<TrendOutlookFormat> outlookByFormat;
  final List<String> methodology;

  factory TrendReport.fromJson(Json j) {
    final o = jMap(j['outlook']);
    return TrendReport(
      topic: jStrOr(j['topic'], ''),
      windowDays: jInt(j['windowDays']) ?? 30,
      clusters: jList(j['clusters'], TrendCluster.fromJson),
      statuses: jList(j['statuses'], TrendSourceStatus.fromJson),
      outlookAvailable: o['available'] == true,
      outlookNote: jStrOr(o['note'], ''),
      outlookByFormat: jList(o['byFormat'], TrendOutlookFormat.fromJson),
      methodology: jStrList(j['methodology']),
    );
  }
}

/// `GET /trend-lab/scripts/:pieceId`.
class TrendScriptJob {
  const TrendScriptJob({required this.pieceId, required this.calendarId, required this.status, this.errorCode, this.errorMessage, this.piece});
  final String pieceId;
  final String calendarId;

  /// generating | done | failed
  final String status;
  final String? errorCode;
  final String? errorMessage;
  final CalendarPiece? piece;

  factory TrendScriptJob.fromJson(Json j) {
    final err = jMap(j['error']);
    final p = jMap(j['piece']);
    return TrendScriptJob(
      pieceId: jStrOr(j['pieceId'], ''),
      calendarId: jStrOr(j['calendarId'], ''),
      status: jStrOr(j['status'], 'generating'),
      errorCode: jStr(err['code']),
      errorMessage: jStr(err['message']),
      piece: p.isEmpty ? null : CalendarPiece.fromJson(p),
    );
  }
}
