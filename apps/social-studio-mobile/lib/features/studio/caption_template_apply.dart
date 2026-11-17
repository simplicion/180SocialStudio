import 'dart:ui' show Size;

import 'dart:math' as math;

import '../../core/native_engine/edit_ir.dart';
import 'caption_catalog.dart';
import 'caption_languages.dart';
import 'safe_zone_guide.dart';
import 'timeline_ops.dart';

/// A user's light changes to a caption template (caption-style-v2.ts CaptionOverridesSchema). Every key maps to one
/// editable field; a template that does not list the field refuses it.
class CaptionOverrides {
  const CaptionOverrides({
    this.colors = const {},
    this.sizePx,
    this.position,
    this.x,
    this.y,
    this.textCase,
    this.maxWords,
    this.motionIntensity,
  });

  /// Colour roles → `#RRGGBB`: text, active, stroke, background, emphasis.
  final Map<String, String> colors;
  final double? sizePx;

  /// 'lower-third' | 'center' | 'upper-third' | 'custom' (then [x] / [y] are the block centre as frame fractions).
  final String? position;
  final double? x, y;

  /// 'none' | 'upper' | 'title'.
  final String? textCase;
  final int? maxWords;
  final double? motionIntensity;

  static const colorRoles = ['text', 'active', 'stroke', 'background', 'emphasis'];
  static const positionPresets = ['lower-third', 'center', 'upper-third', 'custom'];

  /// Vertical centre per position preset (caption-style-v2.ts POSITION_PRESET_Y).
  static const presetY = {'lower-third': 0.68, 'center': 0.5, 'upper-third': 0.3};

  bool get isEmpty =>
      colors.isEmpty &&
      sizePx == null &&
      position == null &&
      textCase == null &&
      maxWords == null &&
      motionIntensity == null;

  /// The editable field each set key belongs to.
  List<String> get fields => [
    if (colors.isNotEmpty) 'colors',
    if (sizePx != null) 'sizePx',
    if (position != null) 'position',
    if (textCase != null) 'case',
    if (maxWords != null) 'maxWords',
    if (motionIntensity != null) 'motionIntensity',
  ];

  /// [other]'s set values win; colours merge per role.
  CaptionOverrides merge(CaptionOverrides other) => CaptionOverrides(
    colors: {...colors, ...other.colors},
    sizePx: other.sizePx ?? sizePx,
    position: other.position ?? position,
    x: other.position != null ? other.x : x,
    y: other.position != null ? other.y : y,
    textCase: other.textCase ?? textCase,
    maxWords: other.maxWords ?? maxWords,
    motionIntensity: other.motionIntensity ?? motionIntensity,
  );

  Map<String, dynamic> toJson() => {
    if (colors.isNotEmpty) 'colors': colors,
    'sizePx': ?sizePx,
    if (position != null) 'position': {'preset': position, 'x': ?x, 'y': ?y},
    'case': ?textCase,
    'maxWords': ?maxWords,
    'motionIntensity': ?motionIntensity,
  };

  factory CaptionOverrides.fromJson(Object? j) {
    if (j is! Map) return const CaptionOverrides();
    final c = j['colors'];
    final p = j['position'];
    return CaptionOverrides(
      colors: c is Map ? {for (final e in c.entries) if (e.value is String) '${e.key}': e.value as String} : const {},
      sizePx: (j['sizePx'] as num?)?.toDouble(),
      position: p is Map ? p['preset'] as String? : null,
      x: p is Map ? (p['x'] as num?)?.toDouble() : null,
      y: p is Map ? (p['y'] as num?)?.toDouble() : null,
      textCase: j['case'] as String?,
      maxWords: (j['maxWords'] as num?)?.toInt(),
      motionIntensity: (j['motionIntensity'] as num?)?.toDouble(),
    );
  }
}

/// Applying a caption template (and the user's overrides) to caption styles. Mirrors `applyCaptionOverrides` in
/// packages/video-contracts/src/caption-style-v2.ts on the JSON form of the spec, and writes the template's flat v1
/// fields so renderers that do not read `styleV2` yet draw the same look.
class CaptionTemplateApply {
  CaptionTemplateApply._();

  /// Style keys this feature writes next to the v1 fields.
  static const templateKey = 'captionTemplate';
  static const overridesKey = 'captionOverrides';
  static const styleV2Key = 'styleV2';

  /// The template a caption style came from (by its template key, else its preset), or null.
  static CaptionTemplate? templateOf(Map<String, dynamic> style) {
    final id = style[templateKey] ?? style['preset'];
    return id is String ? CaptionCatalog.byId(id) : null;
  }

  static Map<String, dynamic> _deepCopy(Map<String, dynamic> m) => {
    for (final e in m.entries)
      e.key: switch (e.value) {
        final Map<String, dynamic> v => _deepCopy(v),
        final Map v => _deepCopy(Map<String, dynamic>.from(v)),
        final List v => [for (final x in v) x is Map ? _deepCopy(Map<String, dynamic>.from(x)) : x],
        final v => v,
      },
  };

  static Map<String, dynamic> _sub(Map<String, dynamic> m, String k) {
    final v = m[k];
    if (v is Map<String, dynamic>) return v;
    final n = v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
    m[k] = n;
    return n;
  }

  static double _clampSize(double v, ({double min, double max})? r) => r == null ? v : v.clamp(r.min, r.max).toDouble();

  /// [spec] (a CaptionStyleV2 JSON map) with [o] applied: overrides of fields not in [editable] are refused and
  /// listed in `rejected`; the size is clamped to [sizeRange] (else the spec's `typography.sizeRangePx`). The
  /// template's fonts, paint layers and motion types never change.
  static ({Map<String, dynamic> spec, List<String> rejected}) applyToSpec(
    Map<String, dynamic> spec,
    CaptionOverrides o, {
    List<String>? editable,
    ({double min, double max})? sizeRange,
  }) {
    final allowed = (editable ?? (spec['editable'] as List?)?.cast<String>() ?? captionEditableFields).toSet();
    final rejected = <String>[];
    final out = _deepCopy(spec);
    for (final field in o.fields) {
      if (!allowed.contains(field)) {
        rejected.add(field);
        continue;
      }
      switch (field) {
        case 'colors':
          final paint = _sub(out, 'paint');
          final c = o.colors;
          if (c['text'] != null) {
            final fill = _sub(paint, 'fill');
            if (fill['type'] == 'gradient') {
              fill['top'] = c['text'];
            } else {
              paint['fill'] = {'type': 'solid', 'color': c['text']};
            }
          }
          if (c['active'] != null) _sub(_sub(out, 'words'), 'active')['color'] = c['active'];
          final strokes = paint['strokes'];
          if (c['stroke'] != null && strokes is List && strokes.isNotEmpty) {
            paint['strokes'] = [
              for (final (i, s) in strokes.indexed) i == 0 ? {...(s as Map).cast<String, dynamic>(), 'color': c['stroke']} : s,
            ];
          }
          if (c['background'] != null) _sub(paint, 'background')['color'] = c['background'];
          if (c['emphasis'] != null) _sub(_sub(out, 'emphasis'), 'colors')['emphasis'] = c['emphasis'];
        case 'sizePx':
          final typo = _sub(out, 'typography');
          final r = typo['sizeRangePx'];
          final range = sizeRange ??
              (r is Map ? (min: (r['min'] as num).toDouble(), max: (r['max'] as num).toDouble()) : null);
          typo['sizePx'] = _clampSize(o.sizePx!, range);
        case 'position':
          final layout = _sub(out, 'layout');
          layout['position'] = o.position;
          if (o.position == 'custom') {
            if (o.x != null) layout['x'] = o.x;
            if (o.y != null) layout['y'] = o.y;
          }
        case 'case':
          _sub(out, 'typography')['case'] = o.textCase;
        case 'maxWords':
          _sub(out, 'grouping')['maxWords'] = o.maxWords;
        case 'motionIntensity':
          _sub(out, 'motion')['intensity'] = o.motionIntensity;
      }
    }
    return (spec: out, rejected: rejected);
  }

  /// The complete v1 style the template starts from (the server rejects partial caption styles).
  static Map<String, dynamic> baseStyle(CaptionTemplate t) {
    final base = TimelineOps.captionPresets.containsKey(t.id)
        ? TimelineOps.captionStyle(t.id)
        : TimelineOps.captionStyle('CLEAN');
    return {...base, ...t.legacyStyle, 'preset': t.legacyStyle['preset'] ?? t.id};
  }

  /// Rough size of a caption block (frame fractions) for safe-zone clamping: the text set in [fontSizePx] canvas
  /// pixels on a [canvasW] × [canvasH] frame, wrapped at [maxWidthFraction], at most two lines.
  static Size blockSize(String text, double fontSizePx, {int canvasW = 1080, int canvasH = 1920, double maxWidthFraction = 0.86}) {
    final chars = math.max(1, text.runes.length);
    final lineW = chars * fontSizePx * 0.55 / canvasW;
    final w = math.min(lineW, maxWidthFraction);
    final lines = lineW > maxWidthFraction ? 2 : 1;
    return Size(w, lines * fontSizePx * 1.2 / canvasH);
  }

  /// The caption style for [t] with [overrides]: v1 fields (what every renderer reads today), the template id, the
  /// overrides themselves (so Customize and Reset can rebuild the look), and `styleV2` when the template has one.
  /// The position is moved inside [safeZone] for a block of [text].
  static ({Map<String, dynamic> style, List<String> rejected}) styleFor(
    CaptionTemplate t, {
    CaptionOverrides overrides = const CaptionOverrides(),
    SafeZonePlatform? safeZone,
    String text = '',
    String? languageCode,
    int canvasW = 1080,
    int canvasH = 1920,
  }) {
    final rejected = [for (final f in overrides.fields) if (!t.canEdit(f)) f];
    final o = CaptionOverrides(
      colors: t.canEdit('colors') ? overrides.colors : const {},
      sizePx: t.canEdit('sizePx') ? overrides.sizePx : null,
      position: t.canEdit('position') ? overrides.position : null,
      x: overrides.x,
      y: overrides.y,
      textCase: t.canEdit('case') ? overrides.textCase : null,
      maxWords: t.canEdit('maxWords') ? overrides.maxWords : null,
      motionIntensity: t.canEdit('motionIntensity') ? overrides.motionIntensity : null,
    );
    final st = baseStyle(t);
    final v2Layout = t.styleV2['layout'];
    final zone = safeZone ?? SafeZonePlatform.fromName(v2Layout is Map ? v2Layout['safeZone'] : 'tiktok');
    if (o.colors['text'] != null) st['textColor'] = o.colors['text'];
    if (o.colors['active'] != null) st['highlightColor'] = o.colors['active'];
    if (o.colors['stroke'] != null && ((st['strokeWidthPx'] as num?) ?? 0) > 0) st['strokeColor'] = o.colors['stroke'];
    if (o.colors['background'] != null && st['background'] is Map) {
      st['background'] = {...(st['background'] as Map).cast<String, dynamic>(), 'color': o.colors['background']};
    }
    if (o.colors['emphasis'] != null) st['emphasisColor'] = o.colors['emphasis'];
    if (o.sizePx != null) st['fontSizePx'] = _clampSize(o.sizePx!, t.sizeRangePx);
    if (o.textCase != null) {
      st['uppercase'] = o.textCase == 'upper';
      st['textCase'] = o.textCase;
      final lang = CaptionLanguages.byCode(languageCode);
      if (lang?.casingLocale != null) st['caseLocale'] = lang!.casingLocale;
    }
    if (o.maxWords != null) st['maxWords'] = o.maxWords;
    if (o.motionIntensity != null) st['motionIntensity'] = o.motionIntensity;

    // Position: the preset's (or the dragged) centre, kept inside the safe zone.
    var x = (st['positionX'] as num?)?.toDouble() ?? 0.5;
    var y = (st['positionY'] as num?)?.toDouble() ?? 0.72;
    if (o.position != null) {
      x = o.position == 'custom' ? (o.x ?? x) : 0.5;
      y = o.position == 'custom' ? (o.y ?? y) : CaptionOverrides.presetY[o.position] ?? y;
    }
    final block = blockSize(
      text,
      (st['fontSizePx'] as num?)?.toDouble() ?? 64,
      canvasW: canvasW,
      canvasH: canvasH,
      maxWidthFraction: (st['maxWidthFraction'] as num?)?.toDouble() ?? 0.86,
    );
    final c = zone.clampCentre(x, y, blockW: block.width, blockH: block.height);
    st['positionX'] = c.dx.clamp(0.05, 0.95);
    st['positionY'] = c.dy.clamp(0.05, 0.95);
    st['safeZone'] = zone.name;

    st[templateKey] = t.id;
    if (!o.isEmpty) st[overridesKey] = o.toJson();
    if (t.styleV2.isNotEmpty) {
      final v2 = applyToSpec(t.styleV2, o, editable: t.editable, sizeRange: t.sizeRangePx).spec;
      final layout = _sub(v2, 'layout');
      layout['safeZone'] = zone.name;
      if (o.position == 'custom') {
        layout['x'] = st['positionX'];
        layout['y'] = st['positionY'];
      }
      st[styleV2Key] = v2;
    }
    return (style: st, rejected: rejected);
  }

  static EditIrCaption _restyle(EditIrCaption c, Map<String, dynamic> style) => EditIrCaption(
    id: c.id,
    kind: c.kind,
    startMs: c.startMs,
    endMs: c.endMs,
    text: c.text,
    words: [
      for (final w in c.words)
        EditIrWord(
          text: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          highlight: w.highlight,
          color: w.color,
          // The spoken word grows only in word_pop styles (as TimelineOps.styleCaptions).
          scale: style['animation'] == 'word_pop' ? (w.scale > 1 ? w.scale : 1.15) : 1.0,
        ),
    ],
    style: style,
  );

  static bool _inScope(EditIrCaption c, Set<String>? ids) => c.kind == 'caption' && (ids == null || ids.contains(c.id));

  /// Speech captions in [captionIds] (all when null) get template [templateId] with [overrides]; text, words and
  /// timing stay. Unknown template ids change nothing.
  static MobileEditIr applyTemplate(
    MobileEditIr ir,
    String templateId, {
    Set<String>? captionIds,
    CaptionOverrides overrides = const CaptionOverrides(),
    SafeZonePlatform? safeZone,
    String? languageCode,
  }) {
    final t = CaptionCatalog.byId(templateId);
    if (t == null) return ir;
    return ir.copyWith(
      captions: [
        for (final c in ir.captions)
          _inScope(c, captionIds)
              ? _restyle(
                  c,
                  styleFor(
                    t,
                    overrides: overrides,
                    safeZone: safeZone,
                    text: c.text,
                    languageCode: languageCode,
                    canvasW: ir.canvas.width,
                    canvasH: ir.canvas.height,
                  ).style,
                )
              : c,
      ],
    );
  }

  /// Merges [changes] into each selected caption's own overrides and rebuilds its look from its template. Fields the
  /// template locks are ignored. A new words-per-line value regroups the selected captions' words.
  static MobileEditIr customize(
    MobileEditIr ir,
    CaptionOverrides changes, {
    Set<String>? captionIds,
    SafeZonePlatform? safeZone,
    String? languageCode,
  }) {
    var out = ir.copyWith(
      captions: [
        for (final c in ir.captions)
          if (_inScope(c, captionIds) && templateOf(c.style) != null)
            _restyle(
              c,
              styleFor(
                templateOf(c.style)!,
                overrides: CaptionOverrides.fromJson(c.style[overridesKey]).merge(changes),
                safeZone: safeZone ?? (c.style['safeZone'] != null ? SafeZonePlatform.fromName(c.style['safeZone']) : null),
                text: c.text,
                languageCode: languageCode,
                canvasW: ir.canvas.width,
                canvasH: ir.canvas.height,
              ).style,
            )
          else
            c,
      ],
    );
    if (changes.maxWords != null) out = regroup(out, changes.maxWords!, captionIds: captionIds, languageCode: languageCode);
    return out;
  }

  /// Back to the template: the selected captions lose their overrides (the safe zone they were kept in stays).
  static MobileEditIr reset(MobileEditIr ir, {Set<String>? captionIds}) => ir.copyWith(
    captions: [
      for (final c in ir.captions)
        if (_inScope(c, captionIds) && templateOf(c.style) != null)
          _restyle(
            c,
            styleFor(
              templateOf(c.style)!,
              safeZone: c.style['safeZone'] != null ? SafeZonePlatform.fromName(c.style['safeZone']) : null,
              text: c.text,
              canvasW: ir.canvas.width,
              canvasH: ir.canvas.height,
            ).style,
          )
        else
          c,
    ],
  );

  static final _sentenceEnd = RegExp(r'[.!?।॥؟۔。！？]$');
  static var _seq = 0;

  /// Regroups the words of each run of neighbouring selected speech captions into captions of at most [maxWords]
  /// words, breaking on pauses over 600 ms, sentence ends and the language's two-line character limit. Word texts
  /// and times never change; each new caption takes the style of the caption its first word came from.
  static MobileEditIr regroup(MobileEditIr ir, int maxWords, {Set<String>? captionIds, String? languageCode}) {
    final n = maxWords.clamp(1, 20);
    final lang = CaptionLanguages.byCode(languageCode);
    final charLimit = (lang?.maxCharsPerLine ?? 42) * 2;
    final sorted = [...ir.captions]..sort((a, b) => a.startMs.compareTo(b.startMs));
    final out = <EditIrCaption>[];
    var run = <EditIrCaption>[];

    void flushRun() {
      if (run.isEmpty) return;
      final words = <(EditIrWord, Map<String, dynamic>)>[for (final c in run) for (final w in c.words) (w, c.style)];
      if (words.isEmpty) {
        out.addAll(run);
        run = [];
        return;
      }
      var group = <(EditIrWord, Map<String, dynamic>)>[];
      void flush() {
        if (group.isEmpty) return;
        final ws = [for (final g in group) g.$1];
        out.add(
          EditIrCaption(
            id: 'cap_rg${DateTime.now().microsecondsSinceEpoch}_${_seq++}',
            startMs: ws.first.startMs,
            endMs: ws.last.endMs,
            text: EditIrCaption.joinWordsForScript([for (final w in ws) w.text]),
            words: ws,
            style: group.first.$2,
          ),
        );
        group = [];
      }

      for (final g in words) {
        if (group.isNotEmpty) {
          final gap = g.$1.startMs - group.last.$1.endMs;
          final joined = EditIrCaption.joinWordsForScript([for (final x in [...group, g]) x.$1.text]);
          if (group.length >= n || gap > 600 || gap < 0 || joined.runes.length > charLimit) flush();
        }
        group.add(g);
        if (_sentenceEnd.hasMatch(g.$1.text)) flush();
      }
      flush();
      run = [];
    }

    for (final c in sorted) {
      if (_inScope(c, captionIds) && c.words.isNotEmpty) {
        run.add(c);
      } else {
        // A caption outside the selection (or a title) between two selected ones ends the run only when it is a
        // speech caption; titles never split speech.
        if (c.kind == 'caption') flushRun();
        out.add(c);
      }
    }
    flushRun();
    out.sort((a, b) => a.startMs.compareTo(b.startMs));
    return ir.copyWith(captions: out);
  }
}
