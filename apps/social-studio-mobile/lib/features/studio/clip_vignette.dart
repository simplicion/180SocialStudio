import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Static clip vignette (filter.vignette 0..1), the same gradient as `ClipVignetteOverlay` in the Android renderer:
/// transparent to 55% of the half-diagonal, then to black at the corners, at 85% × strength.
class ClipVignette extends StatelessWidget {
  const ClipVignette({super.key, required this.strength});
  final double strength;

  @override
  Widget build(BuildContext context) => IgnorePointer(
        child: LayoutBuilder(builder: (context, box) {
          final w = box.maxWidth, h = box.maxHeight;
          if (!w.isFinite || !h.isFinite || w <= 0 || h <= 0) return const SizedBox.shrink();
          // Flutter's radius is a fraction of the shortest side; the renderer's is the half-diagonal.
          final radius = math.sqrt(w * w + h * h) / 2 / math.min(w, h);
          final a = (strength.clamp(0.0, 1.0) * 0.85);
          return DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                radius: radius,
                colors: [Colors.transparent, Colors.transparent, Colors.black.withValues(alpha: a)],
                stops: const [0, 0.55, 1],
              ),
            ),
          );
        }),
      );
}
