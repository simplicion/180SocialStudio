import 'dart:convert';

import '../../core/util/json.dart';

/// `GET /projects/:id/autopilot/jobs/:jobId`. The server's multi-agent calendar run.
class AutopilotJob {
  AutopilotJob({
    required this.jobId,
    required this.calendarId,
    required this.status,
    required this.stage,
    required this.progress,
    this.detail,
    this.errorCode,
    this.errorMessage,
    this.totalPieces,
  });

  final String jobId;
  final String calendarId;

  /// queued | running | completed | failed
  final String status;

  /// queued | research | strategy | hooks_scripts | copy | critic | saving | done
  final String stage;

  /// 0–100.
  final int progress;
  final String? detail;
  final String? errorCode;
  final String? errorMessage;
  final int? totalPieces;

  bool get isDone => status == 'completed';
  bool get isFailed => status == 'failed';
  bool get isFinished => isDone || isFailed;

  static const stageLabels = {
    'queued': 'Waiting to start',
    'research': 'Researching your niche',
    'strategy': 'Planning the strategy',
    'hooks_scripts': 'Writing hooks and scripts',
    'hook_lab': 'Scoring and sharpening hooks',
    'copy': 'Writing captions',
    'craft': 'Checking platform rules',
    'critic': 'Reviewing quality',
    'saving': 'Saving your calendar',
    'done': 'Done',
  };

  String get stageLabel => stageLabels[stage] ?? stage;

  factory AutopilotJob.fromJson(Json j) {
    final err = jMap(j['error']);
    return AutopilotJob(
      jobId: jStrOr(j['jobId'], ''),
      calendarId: jStrOr(j['calendarId'], ''),
      status: jStrOr(j['status'], 'queued'),
      stage: jStrOr(j['stage'], 'queued'),
      progress: (jInt(j['progress']) ?? 0).clamp(0, 100).toInt(),
      detail: jStr(j['detail']),
      errorCode: jStr(err['code']),
      errorMessage: jStr(err['message']),
      totalPieces: jInt(j['totalPieces']),
    );
  }
}

class CreativeSlide {
  CreativeSlide({required this.index, required this.url, this.headline});
  final int index;
  final String url;
  final String? headline;
}

/// `GET /projects/:id/creative/jobs/:jobId` → `job`. Carousel or single static post render.
class CreativeJob {
  CreativeJob({
    required this.id,
    required this.kind,
    required this.status,
    required this.step,
    required this.done,
    required this.total,
    this.slides = const [],
    this.coverUrl,
    this.warnings = const [],
    this.errorCode,
    this.errorMessage,
    this.postId,
  });

  final String id;
  final String kind;
  final String status;
  final String step;
  final int done;
  final int total;
  final List<CreativeSlide> slides;
  final String? coverUrl;
  final List<String> warnings;
  final String? errorCode;
  final String? errorMessage;
  final String? postId;

  bool get isDone => status == 'completed';
  bool get isFailed => status == 'failed';
  bool get isFinished => isDone || isFailed;
  double? get fraction => total > 0 ? (done / total).clamp(0, 1).toDouble() : null;

  factory CreativeJob.fromJson(Json j) {
    final result = jMap(j['result']);
    final progress = jMap(j['progress']);
    final err = jMap(j['error']);
    final urls = jStrList(result['mediaUrls']);
    final rawSlides = result['slides'] is List ? result['slides'] as List : [];
    final slides = <CreativeSlide>[];
    for (var i = 0; i < rawSlides.length; i++) {
      final s = jMap(rawSlides[i]);
      final url = jStr(s['url']) ?? jStr(s['imageUrl']) ?? (i < urls.length ? urls[i] : null);
      if (url == null || url.isEmpty) continue;
      slides.add(CreativeSlide(index: jInt(s['index']) ?? i, url: url, headline: jStr(s['headline'])));
    }
    if (slides.isEmpty) {
      for (var i = 0; i < urls.length; i++) {
        slides.add(CreativeSlide(index: i, url: urls[i]));
      }
    }
    return CreativeJob(
      id: jStrOr(j['id'], ''),
      kind: jStrOr(j['kind'], 'carousel'),
      status: jStrOr(j['status'], 'queued'),
      step: jStrOr(j['step'], ''),
      done: jInt(progress['done']) ?? 0,
      total: jInt(progress['total']) ?? 0,
      slides: slides,
      coverUrl: jStr(result['coverUrl']),
      warnings: jStrList(j['warnings']),
      errorCode: jStr(err['code']),
      errorMessage: jStr(err['message']),
      postId: jStr(j['postId']),
    );
  }
}

class ScriptBeat {
  ScriptBeat(this.beat, [this.retentionDevice]);
  final String beat;
  final String? retentionDevice;
}

/// One line of the script with its time on screen, from the server's `timedBeats` (computed from the words at the
/// platform's speaking pace). `role` is hook | body | loop | cta.
class TimedBeatModel {
  const TimedBeatModel({
    required this.index,
    required this.timecode,
    required this.startSec,
    required this.durationSec,
    required this.spokenWords,
    this.role = 'body',
    this.wordCount = 0,
    this.screenText,
    this.retentionDevice,
    this.flags = const [],
  });

  final int index;
  final String timecode;
  final double startSec;
  final double durationSec;
  final String spokenWords;
  final String role;
  final int wordCount;
  final String? screenText;
  final String? retentionDevice;

  /// Pacing problems for this line (hook over the window, a long line with no cut).
  final List<String> flags;

  factory TimedBeatModel.fromJson(Json j) => TimedBeatModel(
        index: jInt(j['index']) ?? 1,
        timecode: jStrOr(j['timecode'], ''),
        startSec: jDouble(j['startSec']) ?? 0.0,
        durationSec: jDouble(j['durationSec']) ?? 0.0,
        spokenWords: jStrOr(j['spokenWords'] ?? j['text'], ''),
        role: jStrOr(j['role'], 'body'),
        wordCount: jInt(j['wordCount']) ?? 0,
        screenText: jStr(j['screenText']),
        retentionDevice: jStr(j['retentionDevice']),
        flags: jStrList(j['flags']),
      );

  /// Times real script lines at [wpm] for pieces saved before the server stored `timedBeats`.
  /// Adds nothing but the clock: no invented text, cues or scores.
  static List<TimedBeatModel> fromLines(List<({String text, String role, String? device, String? screen})> lines, {double wpm = 165}) {
    final out = <TimedBeatModel>[];
    var clock = 0.0;
    for (final l in lines) {
      final words = l.text.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
      if (words == 0) continue;
      final dur = (words / (wpm / 60) * 10).round() / 10;
      final m = clock ~/ 60;
      out.add(TimedBeatModel(
        index: out.length + 1,
        timecode: '$m:${(clock % 60).toStringAsFixed(1).padLeft(4, '0')}',
        startSec: (clock * 10).round() / 10,
        durationSec: dur,
        spokenWords: l.text.trim(),
        role: l.role,
        wordCount: words,
        screenText: l.screen,
        retentionDevice: l.device,
        flags: [
          if (l.role == 'hook' && dur > 3) 'Hook takes ${dur}s; it has to land in under 3s.',
          if (l.role != 'hook' && dur > 4) '${dur}s on one line: plan a cut, B-roll or text pop inside it.',
        ],
      ));
      clock += dur;
    }
    return out;
  }
}

/// One scene of the shooting script (`productionScript.scenes`).
class ProductionScene {
  const ProductionScene({
    required this.index,
    required this.timecode,
    required this.durationSec,
    required this.purpose,
    required this.spokenLine,
    required this.shot,
    this.onScreenText = '',
    this.framing = '',
    this.action = '',
    this.bRoll = '',
    this.editCue = '',
    this.audioCue = '',
    this.delivery = '',
    this.flags = const [],
  });

  final int index;
  final String timecode;
  final double durationSec;
  final String purpose;
  final String spokenLine;
  final String shot;
  final String onScreenText;
  final String framing;
  final String action;
  final String bRoll;
  final String editCue;
  final String audioCue;
  final String delivery;
  final List<String> flags;

  String get shotLabel => shot.replaceAll('_', ' ');

  factory ProductionScene.fromJson(Json j) => ProductionScene(
        index: jInt(j['index']) ?? 1,
        timecode: jStrOr(j['timecode'], ''),
        durationSec: jDouble(j['durationSec']) ?? 0.0,
        purpose: jStrOr(j['purpose'], 'value'),
        spokenLine: jStrOr(j['spokenLine'], ''),
        shot: jStrOr(j['shot'], ''),
        onScreenText: jStrOr(j['onScreenText'], ''),
        framing: jStrOr(j['framing'], ''),
        action: jStrOr(j['action'], ''),
        bRoll: jStrOr(j['bRoll'], ''),
        editCue: jStrOr(j['editCue'], ''),
        audioCue: jStrOr(j['audioCue'], ''),
        delivery: jStrOr(j['delivery'], ''),
        flags: jStrList(j['flags']),
      );
}

/// `POST /projects/:id/autopilot/pieces/:pieceId/shooting-script` -> `productionScript`.
class ProductionScript {
  const ProductionScript({
    required this.scenes,
    required this.totalSeconds,
    this.platform = '',
    this.aspect = '',
    this.logline = '',
    this.location = '',
    this.lighting = '',
    this.wardrobe = '',
    this.props = const [],
    this.captionStyle = '',
    this.musicMood = '',
    this.checklist = const [],
    this.flags = const [],
  });

  final List<ProductionScene> scenes;
  final double totalSeconds;
  final String platform;
  final String aspect;
  final String logline;
  final String location;
  final String lighting;
  final String wardrobe;
  final List<String> props;
  final String captionStyle;
  final String musicMood;
  final List<String> checklist;
  final List<String> flags;

  static ProductionScript? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final j = raw.cast<String, dynamic>();
    final scenes = jList(j['scenes'], ProductionScene.fromJson);
    if (scenes.isEmpty) return null;
    final setup = jMap(j['setup']);
    return ProductionScript(
      scenes: scenes,
      totalSeconds: jDouble(j['totalSeconds']) ?? 0.0,
      platform: jStrOr(j['platform'], ''),
      aspect: jStrOr(j['aspect'], ''),
      logline: jStrOr(j['logline'], ''),
      location: jStrOr(setup['location'], ''),
      lighting: jStrOr(setup['lighting'], ''),
      wardrobe: jStrOr(setup['wardrobe'], ''),
      props: jStrList(setup['props']),
      captionStyle: jStrOr(j['captionStyle'], ''),
      musicMood: jStrOr(j['musicMood'], ''),
      checklist: jStrList(j['checklist']),
      flags: jStrList(j['flags']),
    );
  }
}


/// The autopilot piece payload the server stores as JSON in `videoScriptOrHooks`.
/// [PieceBrief.parse] returns null for plain-text scripts (older calendars, user edits).
class PieceBrief {
  PieceBrief({
    this.format,
    this.spokenHook,
    this.onScreenHook,
    this.hook,
    this.body = const [],
    this.retentionLoop,
    this.cta,
    this.durationSec,
    this.shotNotes = const [],
    this.carouselTitle,
    this.carouselSlides = const [],
    this.visualBrief,
    this.psychologicalJob,
    this.designSystem,
    this.visualDirection,
    this.whatContentDelivers,
    this.hookScore,
    this.hookFormula,
    this.humanScore,
    this.timedBeats = const [],
    this.craftScore,
    this.craftBlocking = const [],
    this.craftAdvice = const [],
    this.productionScript,
    this.raw = const {},
  });

  final String? format;
  final String? spokenHook;
  final String? onScreenHook;
  final String? hook;
  final List<ScriptBeat> body;
  final String? retentionLoop;
  final String? cta;
  final int? durationSec;
  final List<String> shotNotes;
  final String? carouselTitle;
  final List<({String? role, String headline, String? body})> carouselSlides;
  final String? visualBrief;
  final String? psychologicalJob;
  final String? designSystem;
  final String? visualDirection;
  final String? whatContentDelivers;
  final int? hookScore;
  final String? hookFormula;
  final int? humanScore;
  final List<TimedBeatModel> timedBeats;

  /// Server craft report: 0-100, what must be fixed before posting, and softer advice. Null on older pieces.
  final int? craftScore;
  final List<String> craftBlocking;
  final List<String> craftAdvice;
  final ProductionScript? productionScript;
  final Json raw;

  static PieceBrief? parse(String text) {
    final t = text.trim();
    if (!t.startsWith('{')) return null;
    Object? decoded;
    try {
      decoded = jsonDecode(t);
    } catch (_) {
      return null;
    }
    if (decoded is! Map) return null;
    final j = decoded.cast<String, dynamic>();
    final script = jMap(j['script']);
    final carousel = jMap(j['carouselBrief']);
    final body = <ScriptBeat>[];
    for (final b in script['body'] is List ? script['body'] as List : []) {
      if (b is String && b.trim().isNotEmpty) {
        body.add(ScriptBeat(b.trim()));
      } else if (b is Map) {
        final m = b.cast<String, dynamic>();
        final beat = jStr(m['beat']);
        if (beat != null && beat.isNotEmpty) body.add(ScriptBeat(beat, jStr(m['retentionDevice'])));
      }
    }
    final visual = j['visualBrief'];
    final shotNotes = jStrList(j['shotNotes']);
    var timedBeats = <TimedBeatModel>[
      for (final tb in j['timedBeats'] is List ? j['timedBeats'] as List : [])
        if (tb is Map) TimedBeatModel.fromJson(tb.cast<String, dynamic>()),
    ];
    final opening = jStr(j['spokenHook']) ?? jStr(script['hook']);
    if (timedBeats.isEmpty && body.isNotEmpty) {
      timedBeats = TimedBeatModel.fromLines([
        if (opening != null) (text: opening, role: 'hook', device: null, screen: jStr(j['onScreenHook'])),
        for (final b in body) (text: b.beat, role: 'body', device: b.retentionDevice, screen: null),
        if (jStr(script['retentionLoop']) case final loop?) (text: loop, role: 'loop', device: null, screen: null),
        if (jStr(script['cta']) case final cta?) (text: cta, role: 'cta', device: null, screen: null),
      ]);
    }
    final craft = jMap(j['craft']);

    return PieceBrief(
      format: jStr(j['format']),
      spokenHook: jStr(j['spokenHook']),
      onScreenHook: jStr(j['onScreenHook']),
      hook: jStr(script['hook']),
      body: body,
      retentionLoop: jStr(script['retentionLoop']),
      cta: jStr(script['cta']),
      durationSec: jInt(script['estimatedDurationSec']),
      shotNotes: shotNotes,
      carouselTitle: jStr(carousel['title']),
      carouselSlides: [
        for (final s in jList(carousel['slides'], (m) => m))
          (role: jStr(s['role']), headline: jStrOr(s['headline'], ''), body: jStr(s['body'])),
      ],
      visualBrief: visual is String ? visual : (visual is Map ? jStr(visual['summary']) ?? jsonEncode(visual) : null),
      psychologicalJob: jStr(j['psychologicalJob']) ?? jStr(script['psychologicalJob']) ?? jStr(carousel['psychologicalJob']),
      designSystem: jStr(j['designSystem']) ?? jStr(carousel['designSystem']),
      visualDirection: jStr(j['visualDirection']) ?? jStr(script['visualDirection']) ?? jStr(carousel['visualDirection']),
      whatContentDelivers: jStr(j['whatContentDelivers']) ?? jStr(script['whatContentDelivers']) ?? jStr(carousel['whatContentDelivers']),
      hookScore: jInt(j['hookScore']),
      hookFormula: jStr(j['hookFormula']),
      humanScore: jInt(j['humanScore']),
      timedBeats: timedBeats,
      craftScore: jInt(craft['score']),
      craftBlocking: jStrList(craft['blocking']),
      craftAdvice: jStrList(craft['advice']),
      productionScript: ProductionScript.tryParse(j['productionScript']),
      raw: j,
    );
  }

  /// Spoken length of the whole script in seconds, from the timed beats.
  double get spokenSeconds => timedBeats.isEmpty ? 0 : timedBeats.last.startSec + timedBeats.last.durationSec;

  /// The best line to open a recording with.
  String? get openingHook => spokenHook ?? hook ?? onScreenHook;

  bool get hasScript => openingHook != null || body.isNotEmpty || cta != null;

  /// Plain words for the teleprompter: hook, beats, loop, CTA. No labels, nothing the creator shouldn't say.
  String get teleprompterText {
    return [
      ?openingHook,
      for (final b in body) b.beat,
      ?retentionLoop,
      ?cta,
    ].where((s) => s.trim().isNotEmpty).join('\n\n');
  }
}

/// `GET/PUT /projects/:id/brand-consciousness` → `brand`. Only what the user entered; nulls are "not set".
class BrandConsciousness {
  BrandConsciousness({
    this.brandName,
    this.brandType,
    this.website,
    this.industry,
    this.country,
    this.language,
    this.positioning,
    this.tagline,
    this.description,
    this.ideation,
    this.ideology,
    this.backgroundColor,
    this.textColor,
    this.secondaryColor,
    this.targetPlatforms = const [],
    this.watermarkEnabled,
    this.customGuidelines,
    this.postsPerWeek,
    this.claimsToAvoid = const [],
    this.primaryObjective,
    this.editingAutonomy,
    this.publishingAutonomy,
    this.percent = 0,
    this.missingRequired = const [],
  });

  final String? brandName;
  final String? brandType;
  final String? website;
  final String? industry;
  final String? country;
  final String? language;
  final String? positioning;
  final String? tagline;
  final String? description;
  final String? ideation;
  final String? ideology;
  final String? backgroundColor;
  final String? textColor;
  final String? secondaryColor;
  final List<String> targetPlatforms;
  final bool? watermarkEnabled;
  final String? customGuidelines;
  final int? postsPerWeek;
  final List<String> claimsToAvoid;
  final String? primaryObjective;
  final String? editingAutonomy;
  final String? publishingAutonomy;
  final int percent;
  final List<String> missingRequired;

  static const brandTypes = {'company': 'Company', 'creator': 'Creator', 'agency': 'Agency'};
  static const platforms = {
    'instagram': 'Instagram',
    'facebook': 'Facebook',
    'youtube': 'YouTube',
    'linkedin': 'LinkedIn',
    'twitter': 'X',
  };

  static const fieldLabels = {
    'brandType': 'Brand type',
    'positioning': 'Positioning',
    'description': 'What the brand does',
    'colors.primary': 'Primary colour',
    'tone': 'Tone',
    'audience': 'Audience',
    'targetPlatforms': 'Target platforms',
  };

  factory BrandConsciousness.fromJson(Json j) {
    final colors = jMap(j['colors']);
    final c = jMap(j['completeness']);
    final freq = jMap(j['postingFrequency']);
    final restr = jMap(j['restrictions']);
    final obj = jMap(j['objectives']);
    final aut = jMap(j['autonomy']);
    return BrandConsciousness(
      brandName: jStr(j['brandName']),
      brandType: jStr(j['brandType']),
      website: jStr(j['website']),
      industry: jStr(j['industry']),
      country: jStr(j['country']),
      language: jStr(j['language']),
      positioning: jStr(j['positioning']),
      tagline: jStr(j['tagline']),
      description: jStr(j['description']),
      ideation: jStr(j['ideation']),
      ideology: jStr(j['ideology']),
      backgroundColor: jStr(colors['background']),
      textColor: jStr(colors['text']),
      secondaryColor: jStr(colors['secondary']),
      targetPlatforms: jStrList(j['targetPlatforms']),
      watermarkEnabled: j['watermarkEnabled'] is bool ? j['watermarkEnabled'] as bool : null,
      customGuidelines: jStr(j['customGuidelines']),
      postsPerWeek: jInt(freq['perWeek']),
      claimsToAvoid: jStrList(restr['claimsToAvoid']),
      primaryObjective: jStr(obj['primary']),
      editingAutonomy: jStr(aut['editing']),
      publishingAutonomy: jStr(aut['publishing']),
      percent: jInt(c['percent']) ?? 0,
      missingRequired: jStrList(c['missingRequired']),
    );
  }

  /// Partial PUT body for the identity fields this screen owns. Empty strings clear a field on the server.
  Json toIdentityJson() => {
        'brandName': brandName ?? '',
        'brandType': brandType,
        if (website != null) 'website': website,
        if (industry != null) 'industry': industry,
        if (country != null) 'country': country,
        if (language != null) 'language': language,
        'positioning': positioning ?? '',
        'tagline': tagline ?? '',
        'description': description ?? '',
        'ideation': ideation ?? '',
        'ideology': ideology ?? '',
        'colors': {
          'background': backgroundColor,
          'text': textColor,
          if (secondaryColor != null) 'secondary': secondaryColor,
        },
        'targetPlatforms': targetPlatforms,
        'watermarkEnabled': watermarkEnabled,
        'customGuidelines': customGuidelines ?? '',
        if (postsPerWeek != null) 'postingFrequency': {'perWeek': postsPerWeek},
        if (claimsToAvoid.isNotEmpty) 'restrictions': {'claimsToAvoid': claimsToAvoid},
        if (primaryObjective != null) 'objectives': {'primary': primaryObjective},
        if (editingAutonomy != null || publishingAutonomy != null)
          'autonomy': {
            if (editingAutonomy != null) 'editing': editingAutonomy,
            if (publishingAutonomy != null) 'publishing': publishingAutonomy,
          },
      };
}
