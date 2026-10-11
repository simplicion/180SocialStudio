import 'package:flutter/material.dart';

import '../../core/native_engine/edit_ir.dart';
import '../../core/theme/app_theme.dart';
import 'chroma_keyed.dart';
import 'studio_controller.dart';
import 'timeline_ops.dart';

/// Size of a layer whose media has [aspect] (w/h) at scale 1: the largest box of that aspect inside the canvas.
/// The Android renderer sizes layers the same way (contain-to-canvas, then scale).
Size layerBaseSize(Size canvas, double aspect) {
  final a = aspect.isFinite && aspect > 0 ? aspect : canvas.width / canvas.height;
  final byWidth = Size(canvas.width, canvas.width / a);
  return byWidth.height <= canvas.height ? byWidth : Size(canvas.height * a, canvas.height);
}

/// Draws an overlay layer (PiP / sticker) where the export will put it at [playheadMs], and lets the creator drag it.
class LayerPlacement extends StatefulWidget {
  const LayerPlacement({
    super.key,
    required this.overlay,
    required this.playheadMs,
    required this.mediaAspect,
    required this.controller,
    required this.onTap,
    required this.child,
  });

  final EditIrOverlay overlay;
  final int playheadMs;
  final double mediaAspect;
  final StudioController controller;
  final VoidCallback onTap;

  /// The media, filling its box.
  final Widget child;

  @override
  State<LayerPlacement> createState() => _LayerPlacementState();
}

/// Same shapes as LayerMaskEffect in the renderer: a circle on the short side, or corners of radius × short side.
Widget _shape(EditIrMask? mask, Size size, Widget child) {
  if (mask == null) return ClipRect(child: child);
  final short = size.shortestSide;
  if (mask.shape == 'circle') {
    return ClipPath(clipper: _CircleClip(), child: child);
  }
  return ClipRRect(borderRadius: BorderRadius.circular(mask.radius * short), child: child);
}

class _CircleClip extends CustomClipper<Path> {
  @override
  Path getClip(Size size) => Path()..addOval(Rect.fromCircle(center: size.center(Offset.zero), radius: size.shortestSide / 2));

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

class _LayerPlacementState extends State<LayerPlacement> {
  bool _dragging = false;

  @override
  Widget build(BuildContext context) {
    final o = widget.overlay;
    final layer = o.layer!;
    final pose = layerAt(layer, widget.playheadMs - o.timelineStartMs, o.opacity);
    return LayoutBuilder(builder: (context, box) {
      final canvas = Size(box.maxWidth, box.maxHeight);
      final base = layerBaseSize(canvas, widget.mediaAspect);
      final size = Size(base.width * pose.scale, base.height * pose.scale);
      final left = pose.x * canvas.width - size.width / 2;
      final top = pose.y * canvas.height - size.height / 2;
      return Stack(children: [
        Positioned(
          left: left,
          top: top,
          width: size.width,
          height: size.height,
          child: GestureDetector(
            onTap: widget.onTap,
            onPanStart: (_) => setState(() => _dragging = true),
            onPanUpdate: (d) {
              if (canvas.width <= 0 || canvas.height <= 0) return;
              final nx = (pose.x + d.delta.dx / canvas.width).clamp(-0.4, 1.4);
              final ny = (pose.y + d.delta.dy / canvas.height).clamp(-0.4, 1.4);
              // A layer whose position is keyframed is moved by editing the keyframe at the playhead (CapCut);
              // otherwise the drag moves its base position.
              final keyed = layer.keyframes.any((k) => k.x != null || k.y != null);
              widget.controller.applyWithoutHistory((ir) => keyed
                  ? TimelineOps.setLayerKeyframe(ir, o.id, widget.playheadMs, x: nx, y: ny)
                  : TimelineOps.updateOverlay(ir, o.id, layer: layer.copyWith(x: nx, y: ny)));
            },
            onPanEnd: (_) {
              setState(() => _dragging = false);
              widget.controller.apply((ir) => TimelineOps.updateOverlay(ir, o.id, layer: layer));
            },
            onPanCancel: () => setState(() => _dragging = false),
            child: Transform.rotate(
              angle: pose.rotation * 3.141592653589793 / 180,
              child: Opacity(
                opacity: pose.opacity,
                child: DecoratedBox(
                  position: DecorationPosition.foreground,
                  decoration: BoxDecoration(border: _dragging ? Border.all(color: AppTheme.primary, width: 2) : null),
                  child: _shape(
                    o.mask,
                    size,
                    widget.overlay.chromaKey == null ? widget.child : ChromaKeyed(keyed: widget.overlay.chromaKey!, child: widget.child),
                  ),
                ),
              ),
            ),
          ),
        ),
      ]);
    });
  }
}
