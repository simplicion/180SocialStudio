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
