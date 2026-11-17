import 'package:flutter/material.dart';

/// Social media safe zone profiles with published/conservative UI-covered margins on a 1080×1920 canvas.
enum SafeZonePlatform {
  none('Off'),
  tiktok('TikTok'),
  reels('Reels'),
  shorts('Shorts');

  const SafeZonePlatform(this.label);
  final String label;

  /// The profile name used in caption styles (`styleV2.layout.safeZone`, caption-style-v2.ts SAFE_ZONE_PROFILES).
  static SafeZonePlatform fromName(Object? name) => switch (name) {
    'tiktok' => SafeZonePlatform.tiktok,
    'reels' => SafeZonePlatform.reels,
    'shorts' => SafeZonePlatform.shorts,
    _ => SafeZonePlatform.none,
  };

  /// The safe rectangle as fractions of the frame (left, top, right, bottom), from the 1080×1920 margins.
  Rect get safeFraction {
    final m = SafeZoneOverlayGuide.margins[this]!;
    return Rect.fromLTRB(m.left / 1080, m.top / 1920, 1 - m.right / 1080, 1 - m.bottom / 1920);
  }

  /// Where a caption block of [blockW] × [blockH] (frame fractions) centred on ([x], [y]) must go to stay inside
  /// the safe rectangle: the same rule as `anchorInSafeZone` in caption-style-v2.ts (a block wider / taller than
  /// the safe area is centred in it).
  Offset clampCentre(double x, double y, {double blockW = 0, double blockH = 0}) {
    final r = safeFraction;
    double clamp(double v, double lo, double hi) => lo > hi ? (lo + hi) / 2 : v.clamp(lo, hi);
    return Offset(
      clamp(x, r.left + blockW / 2, r.right - blockW / 2),
      clamp(y, r.top + blockH / 2, r.bottom - blockH / 2),
    );
  }

  SafeZonePlatform next() => switch (this) {
    SafeZonePlatform.none => SafeZonePlatform.tiktok,
    SafeZonePlatform.tiktok => SafeZonePlatform.reels,
    SafeZonePlatform.reels => SafeZonePlatform.shorts,
    SafeZonePlatform.shorts => SafeZonePlatform.none,
  };
}

/// Overlay guide rendering platform-specific safe zones on top of the preview canvas.
///
/// Guidelines match exact contract numbers on a 1080×1920 frame:
/// - TikTok: top 220, bottom 480, left 60, right 140
/// - Instagram Reels: top 270, bottom 670, left 65, right 120
/// - YouTube Shorts: top 240, bottom 600, left 60, right 140
///
/// Wrapped in [IgnorePointer] so all user touch, tap and drag interactions pass through.
class SafeZoneOverlayGuide extends StatelessWidget {
  const SafeZoneOverlayGuide({super.key, required this.platform});

  final SafeZonePlatform platform;

  static const margins =
      <
        SafeZonePlatform,
        ({double top, double bottom, double left, double right})
      >{
        SafeZonePlatform.tiktok: (top: 220, bottom: 480, left: 60, right: 140),
        SafeZonePlatform.reels: (top: 270, bottom: 670, left: 65, right: 120),
        SafeZonePlatform.shorts: (top: 240, bottom: 600, left: 60, right: 140),
        SafeZonePlatform.none: (top: 0, bottom: 0, left: 0, right: 0),
      };

  @override
  Widget build(BuildContext context) {
    if (platform == SafeZonePlatform.none) return const SizedBox.shrink();
    final m = margins[platform]!;

    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final w = constraints.maxWidth;
          final h = constraints.maxHeight;

          // Scale 1080x1920 frame margins proportionally to current preview layout
          final topPx = (m.top / 1920.0) * h;
          final bottomPx = (m.bottom / 1920.0) * h;
          final leftPx = (m.left / 1080.0) * w;
          final rightPx = (m.right / 1080.0) * w;

          final safeW = (w - leftPx - rightPx).clamp(0.0, w);
          final safeH = (h - topPx - bottomPx).clamp(0.0, h);

          return Stack(
            fit: StackFit.expand,
            children: [
              // Top unsafe zone (search bar, tabs, notifications, audio pill)
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: topPx,
                child: Container(
                  color: Colors.redAccent.withValues(alpha: 0.12),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  alignment: Alignment.topCenter,
                  child: Text(
                    '${platform.label} Top Header',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: Colors.redAccent.withValues(alpha: 0.85),
                    ),
                  ),
                ),
              ),

              // Bottom unsafe zone (username, caption description, audio tag)
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                height: bottomPx,
                child: Container(
                  color: Colors.redAccent.withValues(alpha: 0.14),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  alignment: Alignment.bottomCenter,
                  child: Text(
                    '${platform.label} Bottom UI (Description & Audio)',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: Colors.redAccent.withValues(alpha: 0.85),
                    ),
                  ),
                ),
              ),

              // Right unsafe zone (Like, Comment, Share, Audio disk)
              Positioned(
                top: topPx,
                bottom: bottomPx,
                right: 0,
                width: rightPx,
                child: Container(
                  color: Colors.redAccent.withValues(alpha: 0.10),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  alignment: Alignment.center,
                  child: RotatedBox(
                    quarterTurns: 1,
                    child: Text(
                      '${platform.label} Actions',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w600,
                        color: Colors.redAccent.withValues(alpha: 0.75),
                      ),
                    ),
                  ),
                ),
              ),

              // Left unsafe margin
              Positioned(
                top: topPx,
                bottom: bottomPx,
                left: 0,
                width: leftPx,
                child: Container(
                  color: Colors.redAccent.withValues(alpha: 0.08),
                ),
              ),

              // Safe Area Guideline Box
              Positioned(
                left: leftPx,
                top: topPx,
                width: safeW,
                height: safeH,
                child: Container(
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: const Color(0xFF00E5FF).withValues(alpha: 0.7),
                      width: 1.5,
                    ),
                  ),
                  child: Align(
                    alignment: Alignment.topLeft,
                    child: Container(
                      margin: const EdgeInsets.all(4),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF00E5FF).withValues(alpha: 0.25),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '${platform.label} Safe Zone',
                        style: const TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF00E5FF),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
