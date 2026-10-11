import '../../core/util/json.dart';

/// Per-project brand identity (`BrandVoiceProfile`).
///
/// The backend stores `tone, targetAudience, sampleViralPosts, forbiddenWords, defaultHashtags,
/// standardCtas, metadata`. Content pillars and the hook style have no column, so they live in
/// `metadata.contentPillars` / `metadata.hookStyle` / `metadata.hooks`.
class BrandVoice {
  BrandVoice({
    this.id,
    required this.projectId,
    this.tone = '',
    this.targetAudience = '',
    this.sampleViralPosts = const [],
    this.forbiddenWords = const [],
    this.defaultHashtags = const [],
    this.standardCtas = const [],
    this.contentPillars = const [],
    this.hookStyle = '',
    this.hooks = const [],
    this.logoUrl,
    this.primaryColor,
    this.accentColor,
    this.font,
    this.captionStylePreset,
    this.brandType,
    this.industry,
    this.mission,
    this.primaryGoal,
    this.metadata = const {},
  });

  final String? id;
  final String projectId;
  final String tone;
  final String targetAudience;
  final List<String> sampleViralPosts;
  final List<String> forbiddenWords;
  final List<String> defaultHashtags;
  final List<String> standardCtas;
  final List<String> contentPillars;
  final String hookStyle;
  final List<String> hooks;
  final String? logoUrl;
  final String? primaryColor;
  final String? accentColor;
  final String? font;
  final String? captionStylePreset;
  final String? brandType;
  final String? industry;
  final String? mission;
  final String? primaryGoal;
  final Json metadata;

  /// True when the server returned its synthetic default (no row yet).
  bool get isUnsaved => id == null;

  factory BrandVoice.fromJson(Json j, {String? projectId}) {
    final meta = jMap(j['metadata']);
    final brand = jMap(meta['brand']);
    final colors = jMap(j['colors'] ?? meta['colors'] ?? brand['colors']);
    final objectives = jMap(meta['objectives'] ?? brand['objectives']);
    return BrandVoice(
      id: jStr(j['id']),
      projectId: jStr(j['projectId']) ?? projectId ?? '',
      tone: jStr(j['tone'] ?? brand['tone']) ?? '',
      targetAudience: jStr(j['targetAudience'] ?? j['audience'] ?? brand['audience']) ?? '',
      sampleViralPosts: jStrList(j['sampleViralPosts']),
      forbiddenWords: jStrList(j['forbiddenWords']),
      defaultHashtags: jStrList(j['defaultHashtags']),
      standardCtas: jStrList(j['standardCtas']),
      contentPillars: jStrList(meta['contentPillars'] ?? brand['contentPillars'] ?? j['contentPillars']),
      hookStyle: jStr(meta['hookStyle']) ?? '',
      hooks: jStrList(meta['hooks']),
      logoUrl: jStr(j['logoUrl'] ?? meta['logoUrl'] ?? brand['logoUrl']),
      primaryColor: jStr(colors['primary'] ?? meta['primaryColor']),
      accentColor: jStr(colors['accent'] ?? colors['secondary'] ?? meta['accentColor']),
      font: jStr(j['font'] ?? meta['font'] ?? brand['font']),
      captionStylePreset: jStr(j['captionStylePreset'] ?? meta['captionStylePreset'] ?? brand['captionStylePreset']),
      brandType: jStr(j['brandType'] ?? meta['brandType'] ?? brand['brandType']),
      industry: jStr(j['industry'] ?? meta['industry'] ?? brand['industry']),
      mission: jStr(j['description'] ?? j['positioning'] ?? meta['mission'] ?? brand['description'] ?? brand['positioning']),
      primaryGoal: jStr(meta['primaryGoal'] ?? objectives['primary']),
      metadata: meta,
    );
  }

  /// Body for `POST /brand-voice/:projectId` (and `brandProfile` in project create).
  Json toJson() => {
        'tone': tone,
        'targetAudience': targetAudience,
        'sampleViralPosts': sampleViralPosts,
        'forbiddenWords': forbiddenWords,
        'defaultHashtags': defaultHashtags,
        'standardCtas': standardCtas,
        'logoUrl': logoUrl,
        if (font != null) 'font': font,
        if (captionStylePreset != null) 'captionStylePreset': captionStylePreset,
        if (brandType != null && brandType!.isNotEmpty) 'brandType': brandType,
        if (industry != null && industry!.isNotEmpty) 'industry': industry,
        if (mission != null && mission!.isNotEmpty) ...{
          'description': mission,
          'positioning': mission,
        },
        if (primaryGoal != null && primaryGoal!.isNotEmpty)
          'objectives': {'primary': primaryGoal},
        'colors': {
          if (primaryColor != null) 'primary': primaryColor,
          if (accentColor != null) 'accent': accentColor,
        },
        'metadata': {
          ...metadata,
          'contentPillars': contentPillars,
          'hookStyle': hookStyle,
          'hooks': hooks,
          if (brandType != null && brandType!.isNotEmpty) 'brandType': brandType,
          if (industry != null && industry!.isNotEmpty) 'industry': industry,
          if (mission != null && mission!.isNotEmpty) 'mission': mission,
          if (primaryGoal != null && primaryGoal!.isNotEmpty) 'primaryGoal': primaryGoal,
          if (logoUrl != null) 'logoUrl': logoUrl,
          if (primaryColor != null) 'primaryColor': primaryColor,
          if (accentColor != null) 'accentColor': accentColor,
          if (font != null) 'font': font,
          if (captionStylePreset != null) 'captionStylePreset': captionStylePreset,
        },
      };

  BrandVoice copyWith({
    String? tone,
    String? targetAudience,
    List<String>? sampleViralPosts,
    List<String>? forbiddenWords,
    List<String>? defaultHashtags,
    List<String>? standardCtas,
    List<String>? contentPillars,
    String? hookStyle,
    List<String>? hooks,
    String? logoUrl,
    Object? primaryColor = _keep,
    Object? accentColor = _keep,
    Object? font = _keep,
    Object? captionStylePreset = _keep,
    Object? brandType = _keep,
    Object? industry = _keep,
    Object? mission = _keep,
    Object? primaryGoal = _keep,
  }) =>
      BrandVoice(
        id: id,
        projectId: projectId,
        tone: tone ?? this.tone,
        targetAudience: targetAudience ?? this.targetAudience,
        sampleViralPosts: sampleViralPosts ?? this.sampleViralPosts,
        forbiddenWords: forbiddenWords ?? this.forbiddenWords,
        defaultHashtags: defaultHashtags ?? this.defaultHashtags,
        standardCtas: standardCtas ?? this.standardCtas,
        contentPillars: contentPillars ?? this.contentPillars,
        hookStyle: hookStyle ?? this.hookStyle,
        hooks: hooks ?? this.hooks,
        logoUrl: logoUrl ?? this.logoUrl,
        primaryColor: identical(primaryColor, _keep) ? this.primaryColor : primaryColor as String?,
        accentColor: identical(accentColor, _keep) ? this.accentColor : accentColor as String?,
        font: identical(font, _keep) ? this.font : font as String?,
        captionStylePreset: identical(captionStylePreset, _keep) ? this.captionStylePreset : captionStylePreset as String?,
        brandType: identical(brandType, _keep) ? this.brandType : brandType as String?,
        industry: identical(industry, _keep) ? this.industry : industry as String?,
        mission: identical(mission, _keep) ? this.mission : mission as String?,
        primaryGoal: identical(primaryGoal, _keep) ? this.primaryGoal : primaryGoal as String?,
        metadata: metadata,
      );

  static const tonePresets = [
    'Professional & authoritative',
    'Friendly & conversational',
    'Bold & energetic',
    'Witty & playful',
    'Inspirational',
    'Educational',
  ];

  static const captionStylePresets = [
    'HORMOZI_BOUNCE',
    'ALI_ABDAAL_CLEAN',
    'MINIMAL_SUBTITLE',
    'BOLD_CENTER',
  ];

  static const fontPresets = [
    'Inter',
    'Outfit',
    'Poppins',
    'Montserrat',
    'Roboto',
    'Playfair Display',
  ];

  static const industryPresets = [
    'Tech & AI',
    'B2B SaaS & Startups',
    'E-Commerce & DTC',
    'Finance & Investing',
    'Fitness & Health',
    'Real Estate',
    'Coaching & Education',
    'Marketing & Agency',
    'Creator & Media',
    'Lifestyle & Fashion',
  ];

  static const primaryGoalPresets = [
    'Audience Growth & Virality',
    'Inbound Lead Generation',
    'Thought Leadership & Authority',
    'Community Building',
    'Direct Sales & Conversions',
  ];
}

/// Marks a copyWith argument as "not passed" (distinct from an explicit null).
const Object _keep = Object();
