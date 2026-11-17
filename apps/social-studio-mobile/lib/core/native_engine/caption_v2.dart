import 'dart:math' as math;

import 'package:characters/characters.dart';
import 'package:flutter/painting.dart';

/// Caption Style Spec v2 (packages/video-contracts/src/caption-style-v2.ts) for the Flutter preview: the spec model
/// with the schema defaults, the pure helpers and the text engine rules. Mirrors CaptionV2.kt (Android export) line
/// for line, so the preview lays out and animates a caption exactly like the export.

/* ───────────────────────────── spec model ───────────────────────────── */

sealed class V2Easing {
  const V2Easing();
}

class V2Linear extends V2Easing {
  const V2Linear();
}

class V2Cubic extends V2Easing {
  const V2Cubic([this.mode = 'out']);
  final String mode;
}

class V2Back extends V2Easing {
  const V2Back([this.overshoot = 1.70158]);
  final double overshoot;
}

class V2Spring extends V2Easing {
  const V2Spring([this.stiffness = 300, this.damping = 18]);
  final double stiffness, damping;
}

class V2Stroke {
  const V2Stroke(this.color, this.widthPx);
  final int color;
  final double widthPx;
}

class V2Shadow {
  const V2Shadow(this.xPx, this.yPx, this.blurPx, this.color);
  final double xPx, yPx, blurPx;
  final int color;
}

class V2Glow {
  const V2Glow(this.radiusPx, this.color, this.strength);
  final double radiusPx, strength;
  final int color;
}

class V2Background {
  const V2Background({this.mode = 'none', this.color = 0xFF000000, this.paddingPx = 12, this.radiusPx = 12, this.opacity = 1});
  final String mode;
  final int color;
  final double paddingPx, radiusPx, opacity;
}

class V2WordBox {
  const V2WordBox(this.color, [this.paddingPx = 8, this.radiusPx = 10]);
  final int color;
  final double paddingPx, radiusPx;
}

class V2WordState {
  const V2WordState({this.color, this.scale = 1, this.opacity = 1, this.yOffsetPx = 0, this.background, this.blurPx = 0});
  final int? color;
  final double scale, opacity, yOffsetPx, blurPx;
  final V2WordBox? background;
}

class V2GroupMotion {
  const V2GroupMotion({this.type = 'none', this.durationMs = 200, this.easing = const V2Cubic()});
  final String type;
  final int durationMs;
  final V2Easing easing;
}

class V2WordEnter {
  const V2WordEnter({this.type = 'none', this.staggerMs = 0, this.durationMs = 150, this.easing = const V2Cubic()});
  final String type;
  final int staggerMs, durationMs;
  final V2Easing easing;
}

class V2ActiveWord {
  const V2ActiveWord({this.type = 'none', this.durationMs = 160, this.easing = const V2Spring()});
  final String type;
  final int durationMs;
  final V2Easing easing;
}

const kDefaultScriptFonts = <String, String>{
  'latin': 'Inter',
  'devanagari': 'Noto Sans Devanagari',
  'bengali': 'Noto Sans Bengali',
  'tamil': 'Noto Sans Tamil',
  'telugu': 'Noto Sans Telugu',
  'gujarati': 'Noto Sans Gujarati',
  'gurmukhi': 'Noto Sans Gurmukhi',
  'kannada': 'Noto Sans Kannada',
  'malayalam': 'Noto Sans Malayalam',
  'odia': 'Noto Sans Oriya',
  'arabic': 'Noto Sans Arabic',
  'cjk-sc': 'Noto Sans SC',
  'cjk-jp': 'Noto Sans JP',
  'korean': 'Noto Sans KR',
  'thai': 'Noto Sans Thai',
  'cyrillic': 'Inter',
  'fallback': 'Noto Sans',
};

const kPositionPresetY = <String, double>{'lower-third': 0.68, 'center': 0.5, 'upper-third': 0.3};

/// UI-covered margins on a 1080×1920 frame (caption-style-v2.ts SAFE_ZONES_1080x1920): top, bottom, left, right.
const kSafeZones = <String, List<double>>{
  'tiktok': [220, 480, 60, 140],
  'reels': [270, 670, 65, 120],
  'shorts': [240, 600, 60, 140],
  'none': [0, 0, 0, 0],
};

class CaptionSpecV2 {
  const CaptionSpecV2({
    required this.fonts,
    this.weight = 700,
    required this.sizePx,
    this.letterSpacingEm = 0,
    this.lineHeight = 1.15,
    this.textCase = 'none',
    this.fillColor = 0xFFFFFFFF,
    this.gradientTop,
    this.gradientBottom,
    this.strokes = const [],
    this.shadow,
    this.glow,
    this.background = const V2Background(),
    this.resting = const V2WordState(),
    this.active = const V2WordState(),
    this.spoken = const V2WordState(),
    this.emphasis = const V2WordState(),
    this.groupEnter = const V2GroupMotion(),
    this.groupExit = const V2GroupMotion(),
    this.wordEnter = const V2WordEnter(),
    this.activeWord = const V2ActiveWord(),
    this.intensity = 1,
    this.position = 'lower-third',
    this.x = 0.5,
    this.y = 0.68,
    this.maxWidthFraction = 0.86,
    this.maxLines = 2,
    this.align = 'center',
    this.safeZone = 'tiktok',
    this.faceAvoid = true,
    this.balance = 'bottom-heavy',
    this.emphasisColor = 0xFFF7C204,
  });

  final Map<String, String> fonts;
  final int weight;
  final double sizePx, letterSpacingEm, lineHeight;
  final String textCase;
  final int fillColor;
  final int? gradientTop, gradientBottom;
  final List<V2Stroke> strokes;
  final V2Shadow? shadow;
  final V2Glow? glow;
  final V2Background background;
  final V2WordState resting, active, spoken, emphasis;
  final V2GroupMotion groupEnter, groupExit;
  final V2WordEnter wordEnter;
  final V2ActiveWord activeWord;
  final double intensity;
  final String position;
  final double x, y, maxWidthFraction;
  final int maxLines;
  final String align, safeZone, balance;
  final bool faceAvoid;
  final int emphasisColor;

  /// The family for a script: the stack's entry, else the readable default (DEFAULT_SCRIPT_FONTS).
  String fontFor(String script) => fonts[script] ?? kDefaultScriptFonts[script] ?? fonts['latin'] ?? 'Inter';

  /// Parses a `styleV2` map with the Zod schema's defaults; null when it is not a v2 spec (the caption then renders
  /// through the v1 path exactly as before).
  static CaptionSpecV2? parse(Object? raw) {
    if (raw is! Map) return null;
    final m = raw.cast<String, dynamic>();
    if ((m['version'] as num?)?.toInt() != 2) return null;
    final ty = _obj(m['typography']);
    final paint = _obj(m['paint']);
    if (ty == null || paint == null) return null;
    final size = _num(ty['sizePx']);
    if (size == null) return null;
    final fonts = <String, String>{
      for (final e in (_obj(ty['fonts']) ?? const {}).entries)
        if (e.value is String && (e.value as String).trim().isNotEmpty) e.key: e.value as String,
    };
    fonts.putIfAbsent('latin', () => 'Inter');
    final fill = _obj(paint['fill']);
    final isGradient = fill?['type'] == 'gradient';
    final words = _obj(m['words']) ?? const {};
    final motion = _obj(m['motion']) ?? const {};
    final layout = _obj(m['layout']) ?? const {};
    final grouping = _obj(m['grouping']) ?? const {};
    final emphasis = _obj(m['emphasis']) ?? const {};
    final bg = _obj(paint['background']) ?? const {};
    final we = _obj(motion['wordEnter']);
    final aw = _obj(motion['activeWord']);
    String pick(Object? v, Set<String> allowed, String def) => v is String && allowed.contains(v) ? v : def;
    return CaptionSpecV2(
      fonts: fonts,
      weight: (_num(ty['weight']) ?? 700).toInt().clamp(100, 1000),
      sizePx: size.clamp(8, 400).toDouble(),
      letterSpacingEm: (_num(ty['letterSpacingEm']) ?? 0).clamp(-0.1, 0.5).toDouble(),
      lineHeight: (_num(ty['lineHeight']) ?? 1.15).clamp(0.8, 2).toDouble(),
      textCase: pick(ty['case'], const {'none', 'upper', 'title'}, 'none'),
      fillColor: !isGradient ? (_color(fill?['color']) ?? 0xFFFFFFFF) : 0xFFFFFFFF,
      gradientTop: isGradient ? _color(fill?['top']) : null,
      gradientBottom: isGradient ? _color(fill?['bottom']) : null,
      strokes: [
        for (final s in ((paint['strokes'] as List?) ?? const []).take(2))
          if (s is Map && (_num(s['widthPx']) ?? 0) > 0) V2Stroke(_color(s['color']) ?? 0xFF000000, _num(s['widthPx'])!),
      ],
      shadow: _obj(paint['shadow']) == null
          ? null
          : () {
              final s = _obj(paint['shadow'])!;
              return V2Shadow(_num(s['xPx']) ?? 0, _num(s['yPx']) ?? 0, _num(s['blurPx']) ?? 0, _color(s['color']) ?? 0xB3000000);
            }(),
      glow: _obj(paint['glow']) == null
          ? null
          : () {
              final g = _obj(paint['glow'])!;
              return V2Glow(_num(g['radiusPx']) ?? 0, _color(g['color']) ?? 0xFFFFFFFF, (_num(g['strength']) ?? 1).clamp(0, 1).toDouble());
            }(),
      background: V2Background(
        mode: pick(bg['mode'], const {'none', 'line', 'word', 'pill'}, 'none'),
        color: _color(bg['color']) ?? 0xFF000000,
        paddingPx: _num(bg['paddingPx']) ?? 12,
        radiusPx: _num(bg['radiusPx']) ?? 12,
        opacity: (_num(bg['opacity']) ?? 1).clamp(0, 1).toDouble(),
      ),
      resting: _wordState(_obj(words['resting'])),
      active: _wordState(_obj(words['active'])),
      spoken: _wordState(_obj(words['spoken'])),
      emphasis: _wordState(_obj(words['emphasis'])),
      groupEnter: _groupMotion(_obj(motion['groupEnter'])),
      groupExit: _groupMotion(_obj(motion['groupExit'])),
      wordEnter: V2WordEnter(
        type: (we?['type'] as String?) ?? 'none',
        staggerMs: (_num(we?['staggerMs']) ?? 0).toInt().clamp(0, 5000),
        durationMs: (_num(we?['durationMs']) ?? 150).toInt().clamp(0, 5000),
        easing: _easing(_obj(we?['easing']), const V2Cubic()),
      ),
      activeWord: V2ActiveWord(
        type: (aw?['type'] as String?) ?? 'none',
        durationMs: (_num(aw?['durationMs']) ?? 160).toInt().clamp(0, 5000),
        easing: _easing(_obj(aw?['easing']), const V2Spring()),
      ),
      intensity: (_num(motion['intensity']) ?? 1).clamp(0, 1).toDouble(),
      position: pick(layout['position'], const {'lower-third', 'center', 'upper-third', 'custom'}, 'lower-third'),
      x: (_num(layout['x']) ?? 0.5).clamp(0, 1).toDouble(),
      y: (_num(layout['y']) ?? 0.68).clamp(0, 1).toDouble(),
      maxWidthFraction: (_num(layout['maxWidthFraction']) ?? 0.86).clamp(0.05, 1).toDouble(),
      maxLines: (_num(layout['maxLines']) ?? 2).toInt().clamp(1, 2),
      align: pick(layout['align'], const {'start', 'center', 'end'}, 'center'),
      safeZone: pick(layout['safeZone'], kSafeZones.keys.toSet(), 'tiktok'),
      faceAvoid: layout['faceAvoid'] as bool? ?? true,
      balance: (grouping['balance'] as String?) ?? 'bottom-heavy',
      emphasisColor: _color(_obj(emphasis['colors'])?['emphasis']) ?? 0xFFF7C204,
    );
  }

  static V2WordState _wordState(Map<String, dynamic>? m) {
    if (m == null) return const V2WordState();
    final b = _obj(m['background']);
    final bc = _color(b?['color']);
    return V2WordState(
      color: _color(m['color']),
      scale: (_num(m['scale']) ?? 1).clamp(0.2, 3).toDouble(),
      opacity: (_num(m['opacity']) ?? 1).clamp(0, 1).toDouble(),
      yOffsetPx: (_num(m['yOffsetPx']) ?? 0).clamp(-400, 400).toDouble(),
      background: bc == null ? null : V2WordBox(bc, _num(b!['paddingPx']) ?? 8, _num(b['radiusPx']) ?? 10),
      blurPx: math.max(0, _num(m['blurPx']) ?? 0),
    );
  }

  static V2GroupMotion _groupMotion(Map<String, dynamic>? m) => m == null
      ? const V2GroupMotion()
      : V2GroupMotion(
          type: (m['type'] as String?) ?? 'none',
          durationMs: (_num(m['durationMs']) ?? 200).toInt().clamp(0, 5000),
          easing: _easing(_obj(m['easing']), const V2Cubic()),
        );

  static V2Easing _easing(Map<String, dynamic>? m, V2Easing def) => switch (m?['type']) {
        'linear' => const V2Linear(),
        'cubic' => V2Cubic((m!['mode'] as String?) ?? 'out'),
        'back' => V2Back(_num(m!['overshoot']) ?? 1.70158),
        'spring' => V2Spring((_num(m!['stiffness']) ?? 300).clamp(10, 2000).toDouble(), (_num(m['damping']) ?? 18).clamp(1, 200).toDouble()),
        _ => def,
      };

  static Map<String, dynamic>? _obj(Object? v) => v is Map ? v.cast<String, dynamic>() : null;
  static double? _num(Object? v) => v is num && !v.isNaN ? v.toDouble() : null;
  static int? _color(Object? v) => v is String ? v2Color(v) : null;
}

/// #RRGGBB / #RRGGBBAA to ARGB (same as v2Color in Kotlin). Malformed = opaque white.
int v2Color(String hex) {
  final h = hex.trim().replaceFirst('#', '');
  final v = int.tryParse(h, radix: 16);
  if (v == null) return 0xFFFFFFFF;
  if (h.length == 6) return 0xFF000000 | v;
  if (h.length == 8) return ((v & 0xFF) << 24) | (v >> 8);
  return 0xFFFFFFFF;
}

/// Multiplies an ARGB colour's alpha by [k] (rounded like Kotlin's Math.round).
int withAlpha(int color, double k) {
  final a = ((color >> 24) & 0xFF) * k.clamp(0.0, 1.0);
  return ((a + 0.5).floor() << 24) | (color & 0x00FFFFFF);
}

/* ───────────────────────────── pure helpers ───────────────────────────── */

class CaptionV2Math {
  /// caption-style-v2.ts `easeAt`: time-based; a spring is forced to exactly 1 at durationMs.
  static double easeAt(V2Easing e, double elapsedMs, double durationMs) {
    if (elapsedMs <= 0) return 0;
    if (durationMs <= 0 || elapsedMs >= durationMs) return 1;
    final t = elapsedMs / durationMs;
    return switch (e) {
      V2Linear() => t,
      V2Cubic(:final mode) => mode == 'in'
          ? t * t * t
          : mode == 'inOut'
              ? (t < 0.5 ? 4 * t * t * t : 1 - math.pow(-2 * t + 2, 3) / 2)
              : 1 - math.pow(1 - t, 3).toDouble(),
      V2Back(:final overshoot) => 1 + (overshoot + 1) * math.pow(t - 1, 3) + overshoot * math.pow(t - 1, 2),
      V2Spring(:final stiffness, :final damping) => spring(stiffness, damping, elapsedMs / 1000),
    };
  }

  static double spring(double k, double c, double s) {
    final w0 = math.sqrt(k);
    final zeta = c / (2 * w0);
    if (zeta < 1) {
      final wd = w0 * math.sqrt(1 - zeta * zeta);
      return 1 - math.exp(-zeta * w0 * s) * (math.cos(wd * s) + ((zeta * w0) / wd) * math.sin(wd * s));
    }
    if (zeta == 1) return 1 - math.exp(-w0 * s) * (1 + w0 * s);
    final r1 = -w0 * (zeta - math.sqrt(zeta * zeta - 1));
    final r2 = -w0 * (zeta + math.sqrt(zeta * zeta - 1));
    return 1 - (r2 * math.exp(r1 * s) - r1 * math.exp(r2 * s)) / (r2 - r1);
  }

  static Rect safeRect(String profile, double w, double h) {
    final m = kSafeZones[profile] ?? kSafeZones['none']!;
    return Rect.fromLTRB(m[2] * w / 1080, m[0] * h / 1920, w - m[3] * w / 1080, h - m[1] * h / 1920);
  }

  static double _clamp(double v, double lo, double hi) => lo > hi ? (lo + hi) / 2 : math.min(hi, math.max(lo, v));

  /// caption-style-v2.ts `anchorInSafeZone`.
  static Offset anchor(CaptionSpecV2 spec, double w, double h, double blockW, double blockH) {
    final r = safeRect(spec.safeZone, w, h);
    final fx = spec.position == 'custom' ? spec.x : 0.5;
    final fy = spec.position == 'custom' ? spec.y : (kPositionPresetY[spec.position] ?? 0.68);
    return Offset(_clamp(fx * w, r.left + blockW / 2, r.right - blockW / 2), _clamp(fy * h, r.top + blockH / 2, r.bottom - blockH / 2));
  }

  /// Face avoidance (CaptionV2Math.avoidFaces in Kotlin): the new block centre y.
  static double avoidFaces(double cy, double blockH, double left, double right, List<Rect> faces, Rect safe, double h) {
    if (faces.isEmpty) return cy;
    final block = Rect.fromLTRB(left, cy - blockH / 2, right, cy + blockH / 2);
    bool hits(Rect a, Rect b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    final hit = faces.where((f) => hits(f, block)).toList();
    if (hit.isEmpty) return cy;
    final faceTop = hit.map((f) => f.top).reduce(math.min);
    final faceBottom = hit.map((f) => f.bottom).reduce(math.max);
    final margin = 0.02 * h;
    final candidates = [faceTop - margin - blockH / 2, faceBottom + margin + blockH / 2]
        .where((c) => c - blockH / 2 >= safe.top - 0.5 && c + blockH / 2 <= safe.bottom + 0.5)
        .where((c) => !faces.any((f) => hits(f, Rect.fromLTRB(left, c - blockH / 2, right, c + blockH / 2))))
        .toList()
      ..sort((a, b) => (a - cy).abs().compareTo((b - cy).abs()));
    return candidates.isEmpty ? cy : candidates.first;
  }
}

/* ───────────────────────────── scripts, case, direction ───────────────────────────── */

final _letter = RegExp(r'\p{L}', unicode: true);
final _letterOrNumber = RegExp(r'[\p{L}\p{N}]', unicode: true);
final _mark = RegExp(r'\p{M}', unicode: true);
final _otherSymbol = RegExp(r'\p{So}', unicode: true);

class CaptionScripts {
  static String? ofCodePoint(int c) {
    if (c >= 0x0900 && c <= 0x097f) return 'devanagari';
    if (c >= 0x0980 && c <= 0x09ff) return 'bengali';
    if (c >= 0x0a00 && c <= 0x0a7f) return 'gurmukhi';
    if (c >= 0x0a80 && c <= 0x0aff) return 'gujarati';
    if (c >= 0x0b00 && c <= 0x0b7f) return 'odia';
    if (c >= 0x0b80 && c <= 0x0bff) return 'tamil';
    if (c >= 0x0c00 && c <= 0x0c7f) return 'telugu';
    if (c >= 0x0c80 && c <= 0x0cff) return 'kannada';
    if (c >= 0x0d00 && c <= 0x0d7f) return 'malayalam';
    if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0x08a0 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfeff)) {
      return 'arabic';
    }
    if (c >= 0x0e00 && c <= 0x0e7f) return 'thai';
    if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0xac00 && c <= 0xd7af)) return 'korean';
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff)) return 'cjk-jp';
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) return 'cjk-sc';
    if (c >= 0x0400 && c <= 0x04ff) return 'cyrillic';
    return null;
  }

  static String of(String text) {
    for (final c in text.runes) {
      final s = ofCodePoint(c);
      if (s != null) return s;
    }
    return 'latin';
  }

  /// Han in a caption with kana (or in Japanese) uses the Japanese font (same rule as Kotlin).
  static String forToken(String token, String captionText, String? language) {
    final s = of(token);
    if (s != 'cjk-sc') return s;
    final lang = language?.toLowerCase().split('-').first;
    if (lang == 'ja') return 'cjk-jp';
    if (lang == 'ko') return 'korean';
    for (final c in captionText.runes) {
      if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff)) return 'cjk-jp';
    }
    return s;
  }

  static bool isCased(String text) {
    for (final c in text.runes) {
      if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f) || (c >= 0x370 && c <= 0x3ff) || (c >= 0x400 && c <= 0x4ff) || (c >= 0x1e00 && c <= 0x1eff)) {
        return true;
      }
    }
    return false;
  }

  static bool isRtlCodePoint(int c) => (c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);

  static const _rtlLangs = {'ar', 'ur', 'fa', 'sd', 'he', 'iw', 'ps', 'ug', 'yi', 'ckb', 'dv'};

  /// Paragraph direction: an RTL language wins; else the first strong letter (bidi P2–P3).
  static bool isRtlParagraph(String text, String? language) {
    final lang = language?.toLowerCase().split('-').first;
    if (lang != null && lang.isNotEmpty) {
      if (_rtlLangs.contains(lang)) return true;
      if (lang.length >= 2 && lang.length <= 3) return false;
    }
    for (final c in text.runes) {
      if (isRtlCodePoint(c)) return true;
      if (_letter.hasMatch(String.fromCharCode(c))) return false;
    }
    return false;
  }

  /// caption-style-v2.ts `applyCaptionCase`: locale-aware (Dart's toUpperCase is locale-independent, so the
  /// Turkish / Azeri dotted and dotless i are mapped explicitly, as Kotlin does).
  static String applyCase(String text, String mode, String? language) {
    if (mode == 'none' || !isCased(text)) return text;
    final lang = language?.toLowerCase().split('-').first;
    final turkic = lang == 'tr' || lang == 'az';
    // ß → SS: the full Unicode case mapping Kotlin's uppercase() applies (Dart keeps ß).
    String up(String s) => (turkic ? s.replaceAll('i', 'İ').replaceAll('ı', 'I') : s).toUpperCase().replaceAll('ß', 'SS');
    if (mode == 'upper') return up(text);
    final sb = StringBuffer();
    var start = true;
    for (final c in text.runes) {
      final ch = String.fromCharCode(c);
      if (ch.trim().isEmpty) {
        sb.write(ch);
        start = true;
      } else if (start && _letter.hasMatch(ch)) {
        sb.write(up(ch));
        start = false;
      } else {
        sb.write(ch);
        start = false;
      }
    }
    return sb.toString();
  }
}

/* ───────────────────────────── text engine ───────────────────────────── */

/// The ICU services the engine needs. In Flutter they come from the engine's ICU through the text layout
/// (TextPainter); tests may replace them.
abstract class CaptionIcuApi {
  List<int> wordEnds(String text);
}

class FlutterCaptionIcu implements CaptionIcuApi {
  const FlutterCaptionIcu();

  @override
  List<int> wordEnds(String text) {
    final tp = TextPainter(text: TextSpan(text: text), textDirection: TextDirection.ltr)..layout();
    final out = <int>[];
    var i = 0;
    while (i < text.length) {
      final r = tp.getWordBoundary(TextPosition(offset: i));
      final end = r.end > i ? r.end : i + 1;
      out.add(end);
      i = end;
    }
    tp.dispose();
    return out;
  }
}

class CaptionTextEngine {
  static CaptionIcuApi icu = const FlutterCaptionIcu();
  static const lineBreak = '\n';

  static const _han = 1, _hira = 2, _kata = 3, _sea = 4, _punct = 5, _extend = 6, _other = 7;

  static int _cls(int c) {
    if (c >= 0x3040 && c <= 0x309f) return _hira;
    if ((c >= 0x30a0 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff) || (c >= 0xff66 && c <= 0xff9f)) return _kata;
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff) || c == 0x3005) return _han;
    if ((c >= 0x0e00 && c <= 0x0eff) || (c >= 0x1780 && c <= 0x17ff) || (c >= 0x1000 && c <= 0x109f)) return _sea;
    final ch = String.fromCharCode(c);
    if (c == 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0xe0100 && c <= 0xe01ef) || _mark.hasMatch(ch)) return _extend;
    if (!_letterOrNumber.hasMatch(ch) && !_otherSymbol.hasMatch(ch)) return _punct;
    return _other;
  }

  static bool isNoSpace(String text) {
    for (final c in text.runes) {
      final k = _cls(c);
      if (k == _han || k == _hira || k == _kata || k == _sea) return true;
    }
    return false;
  }

  /// Words of a space-free chunk (see CaptionText.segmentChunk in Kotlin for the rules).
  static List<String> segmentChunk(String chunk) {
    if (!isNoSpace(chunk)) return [chunk];
    final out = <StringBuffer>[];
    final runes = chunk.runes.toList();
    var prev = 0;
    var onlyPunct = true;
    var i = 0;
    while (i < runes.length) {
      final c = runes[i];
      final k = _cls(c);
      if (k == _sea) {
        var j = i;
        while (j < runes.length && (_cls(runes[j]) == _sea || _cls(runes[j]) == _extend)) {
          j++;
        }
        final run = String.fromCharCodes(runes.sublist(i, j));
        var s = 0;
        for (final e in icu.wordEnds(run)) {
          if (e <= s) continue;
          final piece = run.substring(s, e);
          final pieceIsPunct = piece.runes.every((r) => _cls(r) == _punct || String.fromCharCode(r).trim().isEmpty);
          if (out.isEmpty || (!pieceIsPunct && !onlyPunct)) out.add(StringBuffer());
          out.last.write(piece);
          if (!pieceIsPunct) onlyPunct = false;
          s = e;
        }
        prev = _sea;
        i = j;
        continue;
      }
      final bool boundary;
      if (out.isEmpty) {
        boundary = true;
      } else if (onlyPunct) {
        boundary = false;
      } else if (k == _punct || k == _extend) {
        boundary = false;
      } else if (prev == _punct) {
        boundary = true;
      } else if (k == _hira) {
        boundary = !(prev == _han || prev == _kata || prev == _hira);
      } else if (k == _han) {
        boundary = prev != _han;
      } else if (k == _kata) {
        boundary = prev != _kata;
      } else {
        boundary = prev != _other;
      }
      if (boundary) {
        out.add(StringBuffer());
        onlyPunct = true;
      }
      out.last.writeCharCode(c);
      if (k != _punct && k != _extend) onlyPunct = false;
      if (k != _extend) prev = k;
      i++;
    }
    return [for (final b in out) if (b.isNotEmpty) b.toString()];
  }

  static List<String> tokens(String text) {
    final out = <String>[];
    final lines = text.replaceAll('\r\n', '\n').split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) out.add(lineBreak);
      for (final chunk in lines[i].split(RegExp(r'\s+'))) {
        if (chunk.isNotEmpty) out.addAll(segmentChunk(chunk));
      }
    }
    while (out.isNotEmpty && out.first == lineBreak) {
      out.removeAt(0);
    }
    while (out.isNotEmpty && out.last == lineBreak) {
      out.removeLast();
    }
    return out;
  }

  static bool noGap(String a, String b) => isNoSpace(a) && isNoSpace(b);

  static String join(List<String> tokens) {
    final sb = StringBuffer();
    for (var i = 0; i < tokens.length; i++) {
      if (i > 0 && !noGap(tokens[i - 1], tokens[i])) sb.write(' ');
      sb.write(tokens[i]);
    }
    return sb.toString();
  }

  /// Grapheme cluster ends (UTF-16 offsets).
  static List<int> graphemeEnds(String text) {
    final out = <int>[];
    var o = 0;
    for (final g in text.characters) {
      o += g.length;
      out.add(o);
    }
    return out;
  }

  /// Grapheme-safe pieces no wider than [maxWidth] (same greedy rule as Kotlin).
  static List<String> splitToWidth(String text, double maxWidth, double Function(String) measure) {
    if (text.isEmpty || measure(text) <= maxWidth) return [text];
    final out = <String>[];
    var start = 0, prevEnd = 0;
    for (final e in graphemeEnds(text)) {
      if (prevEnd > start && measure(text.substring(start, e)) > maxWidth) {
        out.add(text.substring(start, prevEnd));
        start = prevEnd;
      }
      prevEnd = e;
    }
    if (start < text.length) out.add(text.substring(start));
    return out;
  }

  /// Visual (left-to-right) order of a line's tokens: the line is laid out as drawn by the engine's text layout,
  /// which runs the Unicode bidi algorithm (ICU), and the tokens are ordered by where their glyphs land.
  static List<int> visualOrder(List<String> tokens, bool rtl) {
    final idx = [for (var i = 0; i < tokens.length; i++) i];
    if (tokens.length <= 1) return idx;
    if (!rtl && !tokens.any((t) => t.runes.any(CaptionScripts.isRtlCodePoint))) return idx;
    final sb = StringBuffer();
    final starts = <int>[];
    for (var i = 0; i < tokens.length; i++) {
      if (i > 0 && !noGap(tokens[i - 1], tokens[i])) sb.write(' ');
      starts.add(sb.length);
      sb.write(tokens[i]);
    }
    final tp = TextPainter(text: TextSpan(text: sb.toString(), style: const TextStyle(fontSize: 20)), textDirection: rtl ? TextDirection.rtl : TextDirection.ltr)..layout();
    final xs = <double>[];
    for (var i = 0; i < tokens.length; i++) {
      final boxes = tp.getBoxesForSelection(TextSelection(baseOffset: starts[i], extentOffset: starts[i] + tokens[i].length));
      xs.add(boxes.isEmpty ? i.toDouble() : boxes.map((b) => b.left).reduce(math.min));
    }
    tp.dispose();
    idx.sort((a, b) => xs[a].compareTo(xs[b]));
    return idx;
  }

  /// Breaks measured items into ≤ [maxLines] lines (CaptionText.breakLines in Kotlin); null = does not fit.
  static List<List<CaptionItem>>? breakLines(List<CaptionItem> items, double maxWidth, int maxLines, double Function(CaptionItem, CaptionItem) gap, bool bottomHeavy) {
    double width(List<CaptionItem> line) {
      var w = 0.0;
      for (var i = 0; i < line.length; i++) {
        if (i > 0) w += gap(line[i - 1], line[i]);
        w += line[i].slot;
      }
      return w;
    }

    final paragraphs = <List<CaptionItem>>[[]];
    for (final it in items) {
      if (it.text == lineBreak) {
        paragraphs.add([]);
      } else {
        paragraphs.last.add(it);
      }
    }
    final paras = paragraphs.where((p) => p.isNotEmpty).toList();
    if (paras.isEmpty) return [];
    if (paras.length > maxLines) return null;
    if (paras.length > 1) return paras.every((p) => width(p) <= maxWidth + 0.01) ? paras : null;
    final all = paras[0];
    if (width(all) <= maxWidth + 0.01) return [all];
    if (maxLines < 2) return null;
    int? bestK;
    double? bestCost;
    final words = all.map((i) => i.wordIndex).toSet().length;
    for (var k = 1; k < all.length; k++) {
      final top = all.sublist(0, k), bottom = all.sublist(k);
      if (all[k - 1].wordIndex == all[k].wordIndex && width(all.where((i) => i.wordIndex == all[k].wordIndex).toList()) <= maxWidth) continue;
      final tw = width(top), bw = width(bottom);
      if (tw > maxWidth + 0.01 || bw > maxWidth + 0.01) continue;
      final topWords = top.map((i) => i.wordIndex).toSet().length;
      var cost = (bw - tw).abs();
      if (bottomHeavy) {
        if (tw > bw) cost += 10000 + (tw - bw);
        if (words >= 3 && topWords < 2) cost += 100000;
      }
      if (bestCost == null || cost < bestCost) {
        bestK = k;
        bestCost = cost;
      }
    }
    if (bestK == null) return null;
    return [all.sublist(0, bestK), all.sublist(bestK)];
  }
}

class CaptionItem {
  const CaptionItem(this.index, this.text, this.width, this.slot, this.wordIndex);
  final int index, wordIndex;
  final String text;
  final double width, slot;
}

/* ───────────────────────────── group motion ───────────────────────────── */

class CaptionGroupMotion {
  const CaptionGroupMotion(this.opacity, this.dy, this.scale, this.blurPx, this.reveal, this.wipe);
  final double opacity, dy, scale, blurPx, reveal, wipe;
}

/// Group enter / exit at one instant (CaptionV2Motion.group in Kotlin). [h] = frame height.
CaptionGroupMotion captionGroupMotion(CaptionSpecV2 spec, int startMs, int endMs, double t, double h) {
  final len = math.max(1, endMs - startMs).toDouble();
  final a = spec.intensity;
  var opacity = 1.0, dy = 0.0, scale = 1.0, blur = 0.0, reveal = -1.0, wipe = 1.0;
  final en = spec.groupEnter;
  final enterMs = math.min(en.durationMs.toDouble(), len / 2);
  if (en.type != 'none') {
    final el = t - startMs;
    final p = CaptionV2Math.easeAt(en.easing, el, enterMs);
    final lin = enterMs <= 0 ? 1.0 : (el / enterMs).clamp(0.0, 1.0);
    final pc = p.clamp(0.0, 1.0);
    switch (en.type) {
      case 'fade':
        opacity *= pc;
      case 'pop':
        scale *= 1 - 0.4 * a + 0.4 * a * p;
        opacity *= math.min(1.0, lin * 2);
      case 'spring-pop':
        scale *= 1 - 0.6 * a + 0.6 * a * p;
        opacity *= math.min(1.0, lin * 2.5);
      case 'slide-up':
        dy += (1 - p) * 0.06 * h * a;
        opacity *= pc;
      case 'slide-down':
        dy -= (1 - p) * 0.06 * h * a;
        opacity *= pc;
      case 'blur-in':
        blur += (1 - pc) * 12 * a;
        dy += (1 - p) * 0.02 * h * a;
        opacity *= pc;
      case 'scale-down-in':
        scale *= 1 + 0.4 * a * (1 - p);
        opacity *= pc;
      case 'typewriter':
        reveal = lin;
      case 'mask-wipe':
        wipe = pc;
    }
  }
  final ex = spec.groupExit;
  final exitMs = math.min(ex.durationMs.toDouble(), len - enterMs);
  if (ex.type != 'none' && exitMs > 0 && t > endMs - exitMs) {
    final q = CaptionV2Math.easeAt(ex.easing, t - (endMs - exitMs), exitMs);
    final k = q.clamp(0.0, 1.0);
    switch (ex.type) {
      case 'fade':
        opacity *= 1 - k;
      case 'pop' || 'spring-pop':
        scale *= 1 - 0.4 * a * q;
        opacity *= 1 - k;
      case 'slide-up':
        dy -= q * 0.06 * h * a;
        opacity *= 1 - k;
      case 'slide-down':
        dy += q * 0.06 * h * a;
        opacity *= 1 - k;
      case 'blur-in':
        blur += k * 12 * a;
        opacity *= 1 - k;
      case 'scale-down-in':
        scale *= 1 - 0.2 * a * q;
        opacity *= 1 - k;
      case 'typewriter':
        reveal = reveal < 0 ? 1 - k : math.min(reveal, 1 - k);
      case 'mask-wipe':
        wipe = math.min(wipe, 1 - k);
    }
  }
  return CaptionGroupMotion(opacity.clamp(0.0, 1.0), dy, math.max(0, scale), blur, reveal, wipe);
}
