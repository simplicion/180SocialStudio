import 'dart:math' as math;

/// CapCut-style overlay layer (contract `OverlayLayerSchema`). `cutaway` replaces the main picture for the slot;
/// `overlay` is composited on top of it (PiP, sticker, layered B-roll).
///
/// x / y: the layer centre as canvas fractions from the top-left. scale: size relative to the largest size that fits
/// the canvas (1 = fits the canvas; 0.4 = a PiP). rotation in degrees. Keyframe times are relative to the overlay
/// start and animate any property linearly. [layerAt] is mirrored by `LayerMotion.at` in the Android renderer.
class EditIrLayer {
  const EditIrLayer({
    this.mode = 'overlay',
    this.x = 0.5,
    this.y = 0.5,
    this.scale = 1,
    this.rotation = 0,
    this.keyframes = const [],
  });

  final String mode;
  final double x, y, scale, rotation;
  final List<LayerKeyframe> keyframes;

  bool get isOverlay => mode == 'overlay';

  /// The PiP placement older drafts stored as `source.pip` (bottom-right, about a third of the canvas).
  static const legacyPip = EditIrLayer(x: 0.78, y: 0.78, scale: 0.36);

  EditIrLayer copyWith({String? mode, double? x, double? y, double? scale, double? rotation, List<LayerKeyframe>? keyframes}) => EditIrLayer(
        mode: mode ?? this.mode,
        x: x ?? this.x,
        y: y ?? this.y,
        scale: scale ?? this.scale,
        rotation: rotation ?? this.rotation,
        keyframes: keyframes ?? this.keyframes,
      );

  static EditIrLayer? fromJson(Object? raw) {
    if (raw is! Map) return null;
    double n(Object? v, double d) => (v is num && v.isFinite) ? v.toDouble() : d;
    return EditIrLayer(
      mode: raw['mode'] == 'cutaway' ? 'cutaway' : 'overlay',
      x: n(raw['x'], 0.5).clamp(-0.5, 1.5),
      y: n(raw['y'], 0.5).clamp(-0.5, 1.5),
      scale: n(raw['scale'], 1).clamp(0.05, 3),
      rotation: n(raw['rotation'], 0).clamp(-720, 720),
      keyframes: [
        for (final k in (raw['keyframes'] as List? ?? const []).whereType<Map>()) LayerKeyframe.fromJson(k),
      ]..sort((a, b) => a.atMs.compareTo(b.atMs)),
    );
  }

  Map<String, dynamic> toJson() => {
        'mode': mode,
        'x': _r(x),
        'y': _r(y),
        'scale': _r(scale),
        'rotation': _r(rotation),
        if (keyframes.isNotEmpty) 'keyframes': [for (final k in keyframes) k.toJson()],
      };
}

double _r(double v) => (v * 10000).roundToDouble() / 10000;

class LayerKeyframe {
  const LayerKeyframe({required this.atMs, this.x, this.y, this.scale, this.rotation, this.opacity});
  final int atMs;
  final double? x, y, scale, rotation, opacity;

  factory LayerKeyframe.fromJson(Map raw) {
    double? n(Object? v) => (v is num && v.isFinite) ? v.toDouble() : null;
    return LayerKeyframe(
      atMs: (raw['atMs'] as num?)?.toInt().clamp(0, 1 << 30) ?? 0,
      x: n(raw['x']),
      y: n(raw['y']),
      scale: n(raw['scale']),
      rotation: n(raw['rotation']),
      opacity: n(raw['opacity']),
    );
  }

  Map<String, dynamic> toJson() => {
        'atMs': atMs,
        if (x != null) 'x': _r(x!),
        if (y != null) 'y': _r(y!),
        if (scale != null) 'scale': _r(scale!),
        if (rotation != null) 'rotation': _r(rotation!),
        if (opacity != null) 'opacity': _r(opacity!),
      };
}

/// Where and how a layer is drawn at one moment.
class LayerPose {
  const LayerPose(this.x, this.y, this.scale, this.rotation, this.opacity);
  final double x, y, scale, rotation, opacity;
}

/// Pose of [layer] at [relMs] after the overlay start, with [baseOpacity] (the overlay's own opacity).
LayerPose layerAt(EditIrLayer layer, int relMs, double baseOpacity) {
  double prop(double base, double? Function(LayerKeyframe) pick) {
    final ks = layer.keyframes.where((k) => pick(k) != null).toList();
    if (ks.isEmpty) return base;
    if (relMs <= ks.first.atMs) return pick(ks.first)!;
    if (relMs >= ks.last.atMs) return pick(ks.last)!;
    for (var i = 0; i < ks.length - 1; i++) {
      final a = ks[i], b = ks[i + 1];
      if (relMs >= a.atMs && relMs <= b.atMs) {
        final span = math.max(1, b.atMs - a.atMs);
        final t = (relMs - a.atMs) / span;
        return pick(a)! + (pick(b)! - pick(a)!) * t;
      }
    }
    return base;
  }

  return LayerPose(
    prop(layer.x, (k) => k.x),
    prop(layer.y, (k) => k.y),
    prop(layer.scale, (k) => k.scale).clamp(0.05, 3),
    prop(layer.rotation, (k) => k.rotation),
    prop(baseOpacity, (k) => k.opacity).clamp(0.0, 1.0),
  );
}

/// Green / blue screen key on an overlay layer (contract `chromaKey`). [similarity] widens what counts as the key
/// colour, [smoothness] softens the edge, [spill] greys out the key colour's tint on what remains.
class EditIrChromaKey {
  const EditIrChromaKey({this.color = '#00FF00', this.similarity = 0.3, this.smoothness = 0.1, this.spill = 0.5});
  final String color;
  final double similarity, smoothness, spill;

  static const green = EditIrChromaKey();
  static const blue = EditIrChromaKey(color: '#0047BB');

  EditIrChromaKey copyWith({String? color, double? similarity, double? smoothness, double? spill}) => EditIrChromaKey(
        color: color ?? this.color,
        similarity: similarity ?? this.similarity,
        smoothness: smoothness ?? this.smoothness,
        spill: spill ?? this.spill,
      );

  static EditIrChromaKey? fromJson(Object? j) {
    if (j is! Map) return null;
    double d(String k, double def) => ((j[k] as num?)?.toDouble() ?? def).clamp(0.0, 1.0);
    final c = j['color'];
    return EditIrChromaKey(
      color: c is String && RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch(c) ? c.toUpperCase() : '#00FF00',
      similarity: d('similarity', 0.3),
      smoothness: d('smoothness', 0.1),
      spill: d('spill', 0.5),
    );
  }

  Map<String, dynamic> toJson() => {'color': color, 'similarity': similarity, 'smoothness': smoothness, 'spill': spill};
}

/// Shape mask on a layer (contract `mask`): `circle` (fitted to the short side) or `rounded` corners with [radius] as
/// a fraction of the short side. Same shapes as `LayerMaskEffect` in the renderer.
class EditIrMask {
  const EditIrMask({required this.shape, this.radius = 0.15, this.feather = 0.01});
  final String shape;
  final double radius, feather;

  static const circle = EditIrMask(shape: 'circle');
  static const rounded = EditIrMask(shape: 'rounded');

  static EditIrMask? fromJson(Object? j) {
    if (j is! Map) return null;
    final shape = j['shape'];
    if (shape != 'circle' && shape != 'rounded') return null;
    return EditIrMask(
      shape: shape as String,
      radius: ((j['radius'] as num?)?.toDouble() ?? 0.15).clamp(0.0, 0.5),
      feather: ((j['feather'] as num?)?.toDouble() ?? 0.01).clamp(0.0, 0.2),
    );
  }

  Map<String, dynamic> toJson() => {'shape': shape, 'radius': radius, 'feather': feather};
}
