import 'dart:math' as math;

/// CapCut-style text motion: an enter animation, an exit animation and a looping animation per caption/text.
///
/// Stored in the caption style map (contract `MobileCaptionStyleSchema`):
///   `enter: {type, durationMs}`, `exit: {type, durationMs}`, `loop: {type, periodMs}`.
/// [textMotionAt] is mirrored line for line by `TextMotion.at` in the Android renderer (VideoEffects.kt), so the
/// preview and the exported video move the same way.
class TextMotion {
  const TextMotion({this.opacity = 1, this.dx = 0, this.dy = 0, this.scale = 1, this.rotationDeg = 0, this.reveal = 1});

  /// 0…1 multiplier on the text's alpha.
  final double opacity;

  /// Offset as a fraction of the canvas width / height.
  final double dx, dy;
  final double scale;
  final double rotationDeg;

  /// Fraction of characters shown (typewriter); 1 = all.
  final double reveal;

  static const none = TextMotion();
}

const textEnterTypes = ['fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'pop', 'typewriter'];
const textExitTypes = ['fade', 'slide_up', 'slide_down', 'slide_left', 'slide_right', 'pop'];
const textLoopTypes = ['pulse', 'wiggle', 'bounce', 'float'];

const textMotionLabels = {
  'fade': 'Fade',
  'slide_up': 'Slide up',
  'slide_down': 'Slide down',
  'slide_left': 'Slide left',
  'slide_right': 'Slide right',
  'pop': 'Pop',
  'typewriter': 'Typewriter',
  'pulse': 'Pulse',
  'wiggle': 'Wiggle',
  'bounce': 'Bounce',
  'float': 'Float',
};

const _slideY = 0.08;
const _slideX = 0.15;

double _easeOutCubic(double p) => 1 - math.pow(1 - p, 3).toDouble();
double _easeOutBack(double p) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * math.pow(p - 1, 3) + c1 * math.pow(p - 1, 2);
}

({String type, int ms})? _motion(Object? raw, String durKey, List<String> allowed) {
  if (raw is! Map) return null;
  final type = raw['type'];
  final ms = raw[durKey];
  if (type is! String || !allowed.contains(type) || ms is! num || ms <= 0) return null;
  return (type: type, ms: ms.toInt());
}

/// Motion of a caption shown from [startMs] to [endMs] at timeline time [tMs], from its [style] map.
TextMotion textMotionAt(Map<String, dynamic> style, int startMs, int endMs, int tMs) {
  final enter = _motion(style['enter'], 'durationMs', textEnterTypes);
  final exit = _motion(style['exit'], 'durationMs', textExitTypes);
  final loop = _motion(style['loop'], 'periodMs', textLoopTypes);
  if (enter == null && exit == null && loop == null) return TextMotion.none;

  final length = math.max(1, endMs - startMs);
  final elapsed = (tMs - startMs).clamp(0, length);
  final remaining = (endMs - tMs).clamp(0, length);
  // Enter and exit share the caption's time so a short caption still finishes both.
  final enterMs = enter == null ? 0 : math.min(enter.ms, length ~/ 2);
  final exitMs = exit == null ? 0 : math.min(exit.ms, length - enterMs);

  var opacity = 1.0, dx = 0.0, dy = 0.0, scale = 1.0, rot = 0.0, reveal = 1.0;

  if (enter != null && enterMs > 0 && elapsed < enterMs) {
    final p = elapsed / enterMs;
    final e = _easeOutCubic(p);
    switch (enter.type) {
      case 'fade':
        opacity *= e;
      case 'slide_up':
        dy += (1 - e) * _slideY;
        opacity *= e;
      case 'slide_down':
        dy -= (1 - e) * _slideY;
        opacity *= e;
      case 'slide_left':
        dx += (1 - e) * _slideX;
        opacity *= e;
      case 'slide_right':
        dx -= (1 - e) * _slideX;
        opacity *= e;
      case 'pop':
        scale *= 0.6 + 0.4 * _easeOutBack(p);
        opacity *= math.min(1.0, p * 2);
      case 'typewriter':
        reveal = p;
    }
  }

  if (exit != null && exitMs > 0 && remaining < exitMs) {
    final q = remaining / exitMs;
    final e = _easeOutCubic(q);
    switch (exit.type) {
      case 'fade':
        opacity *= e;
      case 'slide_up':
        dy -= (1 - e) * _slideY;
        opacity *= e;
      case 'slide_down':
        dy += (1 - e) * _slideY;
        opacity *= e;
      case 'slide_left':
        dx -= (1 - e) * _slideX;
        opacity *= e;
      case 'slide_right':
        dx += (1 - e) * _slideX;
        opacity *= e;
      case 'pop':
        scale *= 0.6 + 0.4 * e;
        opacity *= e;
    }
  }

  if (loop != null) {
    final phase = (elapsed % loop.ms) / loop.ms;
    final s = math.sin(2 * math.pi * phase);
    switch (loop.type) {
      case 'pulse':
        scale *= 1 + 0.06 * s;
      case 'wiggle':
        rot += 4 * s;
      case 'bounce':
        dy -= 0.02 * s.abs();
      case 'float':
        dy += 0.01 * s;
    }
  }

  return TextMotion(opacity: opacity.clamp(0.0, 1.0), dx: dx, dy: dy, scale: scale, rotationDeg: rot, reveal: reveal.clamp(0.0, 1.0));
}

/// A text's transform (contract style `rotationDeg`, `scale`, `transformKeyframes`; Phase 6.5): clockwise degrees,
/// size multiplier and centre (canvas fractions). Applied around the text centre, on top of [TextMotion].
class TextTransform {
  const TextTransform({required this.rotationDeg, required this.scale, required this.positionX, required this.positionY});
  final double rotationDeg, scale, positionX, positionY;

  @override
  bool operator ==(Object other) =>
      other is TextTransform && other.rotationDeg == rotationDeg && other.scale == scale && other.positionX == positionX && other.positionY == positionY;

  @override
  int get hashCode => Object.hash(rotationDeg, scale, positionX, positionY);

  @override
  String toString() => 'TextTransform(rot $rotationDeg, scale $scale, x $positionX, y $positionY)';
}

double? _num(Object? v) => v is num && v.isFinite ? v.toDouble() : null;

/// Transform of a text shown from [startMs] to [endMs] at timeline [tMs], from its [style] map. Keyframe `atMs` is
/// from the text's start; values interpolate linearly between keyframes and hold the first / last outside them; a
/// field a keyframe leaves out takes the style's value. Mirrored line for line by `TextTransform.at` in the Android
/// renderer (TimedTransforms.kt), so the preview and the export place the text identically.
TextTransform textTransformAt(Map<String, dynamic> style, int startMs, int endMs, num tMs) {
  final base = TextTransform(
    rotationDeg: (_num(style['rotationDeg']) ?? 0).clamp(-180.0, 180.0),
    scale: (_num(style['scale']) ?? 1).clamp(0.2, 4.0),
    positionX: _num(style['positionX']) ?? 0.5,
    positionY: _num(style['positionY']) ?? 0.72,
  );
  final raw = style['transformKeyframes'];
  if (raw is! List || raw.isEmpty) return base;
  final maps = raw.take(60).whereType<Map>().toList();
  final ks = [
    for (var n = 0; n < maps.length; n++)
      for (final k in [maps[n]])
        (
          order: n,
          atMs: math.max(0, _num(k['atMs'])?.toInt() ?? 0),
          value: TextTransform(
            rotationDeg: _num(k['rotationDeg'])?.clamp(-720.0, 720.0) ?? base.rotationDeg,
            scale: _num(k['scale'])?.clamp(0.2, 4.0) ?? base.scale,
            positionX: _num(k['positionX'])?.clamp(0.0, 1.0) ?? base.positionX,
            positionY: _num(k['positionY'])?.clamp(0.0, 1.0) ?? base.positionY,
          ),
        ),
  ];
  if (ks.isEmpty) return base;
  // Stable by time (ties keep their order), like Kotlin's sortedBy.
  ks.sort((a, b) => a.atMs != b.atMs ? a.atMs.compareTo(b.atMs) : a.order.compareTo(b.order));
  final length = math.max(1, endMs - startMs).toDouble();
  final e = (tMs - startMs).toDouble().clamp(0.0, length);
  if (e <= ks.first.atMs) return ks.first.value;
  if (e >= ks.last.atMs) return ks.last.value;
  var i = 1;
  while (ks[i].atMs < e) {
    i++;
  }
  final a = ks[i - 1], b = ks[i];
  final span = (b.atMs - a.atMs).toDouble();
  final p = span <= 0 ? 0.0 : (e - a.atMs) / span;
  double lerp(double x, double y) => x + (y - x) * p;
  return TextTransform(
    rotationDeg: lerp(a.value.rotationDeg, b.value.rotationDeg),
    scale: lerp(a.value.scale, b.value.scale),
    positionX: lerp(a.value.positionX, b.value.positionX),
    positionY: lerp(a.value.positionY, b.value.positionY),
  );
}
