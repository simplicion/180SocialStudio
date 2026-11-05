import 'dart:io';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/gestures.dart' show DragStartBehavior;
import 'package:flutter/material.dart';

import '../../core/native_engine/media_engine_service.dart';
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
    this.ghost = false,
  });

  final EditIrOverlay overlay;
  final int playheadMs;
  final double mediaAspect;
  final StudioController controller;
  final VoidCallback onTap;

  /// The media, filling its box.
  final Widget child;

  /// Handles only (the native preview draws the picture): an invisible box that still takes the gestures and shows
  /// the selection border while it is being moved.
  final bool ghost;

  @override
  State<LayerPlacement> createState() => _LayerPlacementState();
}

/// Native preview handle for a picture-in-picture / sticker layer: the same box the export places (sized from the
/// media's aspect, read once per file), invisible, taking tap / drag / pinch / rotate.
class GhostLayerHandle extends StatefulWidget {
  const GhostLayerHandle({super.key, required this.overlay, required this.playheadMs, required this.controller, required this.onTap});
  final EditIrOverlay overlay;
  final int playheadMs;
  final StudioController controller;
  final VoidCallback onTap;

  @override
  State<GhostLayerHandle> createState() => _GhostLayerHandleState();
}

/// Media aspect (w/h) per local file, so a handle is sized like the export without loading the media.
final Map<String, Future<double?>> _aspects = {};

Future<double?> _aspectOf(String path, bool image) => _aspects.putIfAbsent(path, () async {
      try {
        if (image) {
          final img = await decodeImageFromList(await File(path).readAsBytes());
          return img.height == 0 ? null : img.width / img.height;
        }
        final info = await MediaEngineService.getVideoInfo(path);
        return info.displayHeight == 0 ? null : info.displayWidth / info.displayHeight;
      } catch (_) {
        return null;
      }
    });

class _GhostLayerHandleState extends State<GhostLayerHandle> {
  double? _aspect;
  String? _for;

  void _load() {
    final path = kIsWeb ? null : widget.controller.localOverlayPath(widget.overlay.source);
    if (path == null || path == _for) return;
    _for = path;
    _aspectOf(path, widget.overlay.isImage).then((a) {
      if (mounted && a != null && a != _aspect) setState(() => _aspect = a);
    });
  }

  @override
  Widget build(BuildContext context) {
    _load();
    return LayerPlacement(
      overlay: widget.overlay,
      playheadMs: widget.playheadMs,
      mediaAspect: _aspect ?? (widget.overlay.isImage ? 1 : 16 / 9),
      controller: widget.controller,
      onTap: widget.onTap,
      ghost: true,
      child: const SizedBox.shrink(),
    );
  }
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

  /// The layer's pose when the gesture started: pinch scale / rotation are relative to it.
  ({double x, double y, double scale, double rotation})? _start;
  // The gesture starts after the touch slop: the distance moved before that is added once, so the layer stays under
  // the finger. Then the deltas are summed (they stay continuous when a second finger joins).
  Offset? _downAt;
  Offset _moved = Offset.zero;

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
          child: Listener(
            onPointerDown: (e) {
              if (_start == null) _downAt = e.position;
            },
            child: GestureDetector(
            dragStartBehavior: DragStartBehavior.down,
            onTap: widget.onTap,
            // One finger moves the layer; two fingers also resize (pinch) and rotate it (CapCut).
            onScaleStart: (d) {
              widget.controller.beginLiveEdit();
              _start = (x: pose.x, y: pose.y, scale: pose.scale, rotation: pose.rotation);
              _moved = _downAt == null ? Offset.zero : d.focalPoint - _downAt!;
              setState(() => _dragging = true);
            },
            onScaleUpdate: (d) {
              final s0 = _start;
              if (s0 == null || canvas.width <= 0 || canvas.height <= 0) return;
              _moved += d.focalPointDelta;
              final nx = (s0.x + _moved.dx / canvas.width).clamp(-0.4, 1.4).toDouble();
              final ny = (s0.y + _moved.dy / canvas.height).clamp(-0.4, 1.4).toDouble();
              final pinch = d.pointerCount >= 2;
              final ns = pinch ? (s0.scale * d.scale).clamp(0.05, 3.0).toDouble() : null;
              final nr = pinch ? (s0.rotation + d.rotation * 180 / 3.141592653589793).clamp(-720.0, 720.0).toDouble() : null;
              // A layer whose pose is keyframed is changed by editing the keyframe at the playhead (CapCut);
              // otherwise the gesture changes its base pose.
              final keyed = layer.keyframes.any((k) => k.x != null || k.y != null || k.scale != null || k.rotation != null);
              widget.controller.applyWithoutHistory((ir) => keyed
                  ? TimelineOps.setLayerKeyframe(ir, o.id, widget.playheadMs, x: nx, y: ny, scale: ns, rotation: nr)
                  : TimelineOps.updateOverlay(ir, o.id, layer: layer.copyWith(x: nx, y: ny, scale: ns, rotation: nr)));
            },
            // The whole gesture is one undo step back to where the layer was before it.
            onScaleEnd: (_) {
              _start = null;
              setState(() => _dragging = false);
              widget.controller.endLiveEdit();
            },
            child: Transform.rotate(
              angle: pose.rotation * 3.141592653589793 / 180,
              child: Opacity(
                opacity: widget.ghost ? (_dragging ? 1 : 0) : pose.opacity,
                child: DecoratedBox(
                  position: DecorationPosition.foreground,
                  decoration: BoxDecoration(border: _dragging ? Border.all(color: AppTheme.primary, width: 2) : null),
                  child: widget.ghost
                      // Hit area only: the native frame shows the layer underneath.
                      ? const ColoredBox(color: Color(0x01000000), child: SizedBox.expand())
                      : _shape(
                          o.mask,
                          size,
                          widget.overlay.chromaKey == null ? widget.child : ChromaKeyed(keyed: widget.overlay.chromaKey!, child: widget.child),
                        ),
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
