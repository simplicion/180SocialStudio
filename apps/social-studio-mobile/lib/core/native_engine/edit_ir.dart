import 'media_engine_exception.dart';
import 'overlay_layer.dart';

export 'overlay_layer.dart';

/// Dart model of the `mobile-editir/1` timeline returned by `POST /media-editor/ai-direct`
/// (docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md §3). All times are integer milliseconds.
///
/// Only the fields the on-device renderer consumes are modelled. Parsing is strict: a missing
/// required field throws [MediaEngineException] with code `INVALID_EDIT_IR`.
class MobileEditIr {
  MobileEditIr({
    required this.projectId,
    required this.canvas,
    required this.durationMs,
    required this.clips,
    this.sources = const [],
    this.overlays = const [],
    this.captions = const [],
    this.zooms = const [],
    this.audio = const EditIrAudio(),
    this.watermark,
    this.effects = const [],
  });

  static const schemaVersion = 'mobile-editir/1';

  final String projectId;
  final EditIrCanvas canvas;
  final int durationMs;
  final List<EditIrClip> clips;

  /// Source media metadata. Required by the server when this timeline is sent back as
  /// `currentEditIR`, so it must survive a parse → edit → serialize round trip.
  final List<EditIrSource> sources;
  final List<EditIrOverlay> overlays;
  final List<EditIrCaption> captions;
  final List<EditIrZoom> zooms;
  final EditIrAudio audio;

  /// Brand logo drawn over the whole output (contract §3.9); null = none.
  final EditIrWatermark? watermark;

  /// Timeline effects (flash, shake, …); omitted from JSON when empty.
  final List<EditIrEffect> effects;

  /// Same timeline with a different (or no) watermark.
  MobileEditIr withWatermark(EditIrWatermark? w) => MobileEditIr(
        projectId: projectId,
        canvas: canvas,
        durationMs: durationMs,
        clips: clips,
        sources: sources,
        overlays: overlays,
        captions: captions,
        zooms: zooms,
        audio: audio,
        watermark: w,
        effects: effects,
      );

  /// Copy with some parts replaced; every other field (including ones added later) is kept.
  MobileEditIr copyWith({
    EditIrCanvas? canvas,
    int? durationMs,
    List<EditIrClip>? clips,
    List<EditIrSource>? sources,
    List<EditIrOverlay>? overlays,
    List<EditIrCaption>? captions,
    List<EditIrZoom>? zooms,
    EditIrAudio? audio,
    EditIrWatermark? watermark,
    bool clearWatermark = false,
    List<EditIrEffect>? effects,
  }) =>
      MobileEditIr(
        projectId: projectId,
        canvas: canvas ?? this.canvas,
        durationMs: durationMs ?? this.durationMs,
        clips: clips ?? this.clips,
        sources: sources ?? this.sources,
        overlays: overlays ?? this.overlays,
        captions: captions ?? this.captions,
        zooms: zooms ?? this.zooms,
        audio: audio ?? this.audio,
        watermark: clearWatermark ? null : (watermark ?? this.watermark),
        effects: effects ?? this.effects,
      );

  factory MobileEditIr.fromMap(Map<String, dynamic> map) => MobileEditIr.fromJson(map);

  factory MobileEditIr.fromJson(Map<String, dynamic> json) {
    final version = json['schemaVersion'];
    if (version != schemaVersion) {
      throw MediaEngineException('UNSUPPORTED_SCHEMA', "schemaVersion '$version' is not supported (expected $schemaVersion)");
    }
    return MobileEditIr(
      projectId: (json['projectId'] as String?) ?? '',
      canvas: EditIrCanvas.fromJson(_obj(json, 'canvas')),
      durationMs: _int(json, 'durationMs'),
      clips: _list(json, 'clips', EditIrClip.fromJson, required: true),
      sources: _list(json, 'sources', EditIrSource.fromJson),
      overlays: _list(json, 'overlays', EditIrOverlay.fromJson),
      captions: _list(json, 'captions', EditIrCaption.fromJson),
      zooms: _list(json, 'zooms', EditIrZoom.fromJson),
      audio: json['audio'] == null ? EditIrAudio() : EditIrAudio.fromJson(_obj(json, 'audio')),
      watermark: json['watermark'] == null ? null : EditIrWatermark.fromJson(_obj(json, 'watermark')),
      effects: _list(json, 'effects', EditIrEffect.fromJson),
    );
  }

  Map<String, dynamic> toMap() => toJson();

  Map<String, dynamic> toJson() => {
        'schemaVersion': schemaVersion,
        'projectId': projectId,
        'canvas': canvas.toJson(),
        'durationMs': durationMs,
        'sources': sources.map((s) => s.toJson()).toList(),
        'clips': clips.map((c) => c.toJson()).toList(),
        'overlays': overlays.map((o) => o.toJson()).toList(),
        'captions': captions.map((c) => c.toJson()).toList(),
        'zooms': zooms.map((z) => z.toJson()).toList(),
        'audio': audio.toJson(),
        if (watermark != null) 'watermark': watermark!.toJson(),
        if (effects.isNotEmpty) 'effects': effects.map((e) => e.toJson()).toList(),
      };

  /// Checks the contract invariants the renderer relies on. Throws `INVALID_EDIT_IR`.
  void validate() {
    Never fail(String m) => throw MediaEngineException('INVALID_EDIT_IR', m);
    if (clips.isEmpty) fail('clips[] is empty — nothing to render');
    if (canvas.width.isOdd || canvas.height.isOdd) fail('canvas size must be even (H.264)');
    if (clips.first.timelineStartMs != 0) fail('clips[0] must start at 0');
    for (var i = 0; i < clips.length; i++) {
      final c = clips[i];
      if (!{0, 90, 180, 270}.contains(c.rotationDeg)) fail('clip ${c.id}: rotationDeg must be 0, 90, 180 or 270');
      if (c.speed < 0.25 || c.speed > 4) fail('clip ${c.id}: speed ${c.speed} outside (0.25..4]');
      if (c.sourceEndMs <= c.sourceStartMs) fail('clip ${c.id}: empty source range');
      final expected = ((c.sourceEndMs - c.sourceStartMs) / c.speed).round();
      if ((expected - (c.timelineEndMs - c.timelineStartMs)).abs() > 1) {
        fail('clip ${c.id}: timeline duration does not match source/speed');
      }
      if (i > 0 && c.timelineStartMs != clips[i - 1].timelineEndMs) fail('clip ${c.id}: clips are not contiguous');
    }
    if ((clips.last.timelineEndMs - durationMs).abs() > 1) fail('durationMs does not equal the last clip end');
    if (audio.music.length > 1) fail('at most one music item is allowed');
    for (final e in effects) {
      if (!EditIrEffect.types.containsKey(e.type)) fail('effect ${e.id}: unknown type ${e.type}');
      if (e.endMs <= e.startMs) fail('effect ${e.id}: empty range');
    }
  }

  /// Every local file id the renderer will ask for, so callers can resolve downloads first.
  Set<String> get assetIds => clips.map((c) => c.assetId).toSet();
}

class EditIrWatermark {
  EditIrWatermark({
    required this.imageUrl,
    this.position = 'top_right',
    this.opacityPct = 100,
    this.widthFraction = 0.14,
    this.localPath,
    this.x,
    this.y,
    this.width,
    this.height,
  });
  final String imageUrl;

  /// top_left | top_right | bottom_left | bottom_right
  final String position;
  final double opacityPct;
  final double widthFraction;
  final String? localPath;
  final double? x;
  final double? y;
  final double? width;
  final double? height;

  static const positions = ['top_left', 'top_right', 'bottom_left', 'bottom_right'];

  factory EditIrWatermark.fromJson(Map<String, dynamic> j) => EditIrWatermark(
        imageUrl: _str(j, 'imageUrl'),
        position: j['position'] as String? ?? 'top_right',
        opacityPct: (j['opacityPct'] as num?)?.toDouble() ?? 100,
        widthFraction: (j['widthFraction'] as num?)?.toDouble() ?? 0.14,
        localPath: j['localPath'] as String?,
        x: (j['x'] as num?)?.toDouble(),
        y: (j['y'] as num?)?.toDouble(),
        width: (j['width'] as num?)?.toDouble(),
        height: (j['height'] as num?)?.toDouble(),
      );

  factory EditIrWatermark.fromMap(Map<String, dynamic> m) => EditIrWatermark.fromJson(m);

  Map<String, dynamic> toJson() => {
        'imageUrl': imageUrl,
        'position': position,
        'opacityPct': opacityPct,
        'widthFraction': widthFraction,
        if (localPath != null) 'localPath': localPath,
        if (x != null) 'x': x,
        if (y != null) 'y': y,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
      };

  Map<String, dynamic> toMap() => toJson();
}

class EditIrSource {
  EditIrSource({this.assetId = 'primary', required this.durationMs, required this.width, required this.height});
  final String assetId;
  final int durationMs, width, height;

  factory EditIrSource.fromJson(Map<String, dynamic> j) => EditIrSource(
        assetId: j['assetId'] as String? ?? 'primary',
        durationMs: _int(j, 'durationMs'),
        width: _int(j, 'width'),
        height: _int(j, 'height'),
      );

  Map<String, dynamic> toJson() => {'assetId': assetId, 'durationMs': durationMs, 'width': width, 'height': height};
}

class EditIrCanvas {
  EditIrCanvas({this.aspect = '9:16', this.width = 1080, this.height = 1920, this.fps = 30, this.background = '#000000'});
  final String aspect;
  final int width;
  final int height;
  final num fps;
  final String background;

  factory EditIrCanvas.fromJson(Map<String, dynamic> j) => EditIrCanvas(
        aspect: j['aspect'] as String? ?? '9:16',
        width: _int(j, 'width'),
        height: _int(j, 'height'),
        fps: (j['fps'] as num?) ?? 30,
        background: j['background'] as String? ?? '#000000',
      );

  Map<String, dynamic> toJson() => {'aspect': aspect, 'width': width, 'height': height, 'fps': fps, 'background': background};
}

class EditIrCrop {
  EditIrCrop({required this.x, required this.y, required this.width, required this.height});
  final double x, y, width, height;

  factory EditIrCrop.fromJson(Map<String, dynamic> j) =>
      EditIrCrop(x: _dbl(j, 'x'), y: _dbl(j, 'y'), width: _dbl(j, 'width'), height: _dbl(j, 'height'));

  Map<String, dynamic> toJson() => {'x': x, 'y': y, 'width': width, 'height': height};
}

class EditIrFilter {
  EditIrFilter({
    this.preset = 'NORMAL',
    this.brightness = 1,
    this.contrast = 1,
    this.saturation = 1,
    this.exposure = 0,
    this.temperature = 0,
    this.tint = 0,
    this.vignette = 0,
  });
  final String preset;
  final double brightness, contrast, saturation;

  /// Stops (-2..2), cool/warm and green/magenta (-1..1), edge darkening (0..1). See color_grade.dart.
  final double exposure, temperature, tint, vignette;

  factory EditIrFilter.fromJson(Map<String, dynamic> j) => EditIrFilter(
        preset: j['preset'] as String? ?? 'NORMAL',
        brightness: (j['brightness'] as num?)?.toDouble() ?? 1,
        contrast: (j['contrast'] as num?)?.toDouble() ?? 1,
        saturation: (j['saturation'] as num?)?.toDouble() ?? 1,
        exposure: ((j['exposure'] as num?)?.toDouble() ?? 0).clamp(-2.0, 2.0),
        temperature: ((j['temperature'] as num?)?.toDouble() ?? 0).clamp(-1.0, 1.0),
        tint: ((j['tint'] as num?)?.toDouble() ?? 0).clamp(-1.0, 1.0),
        vignette: ((j['vignette'] as num?)?.toDouble() ?? 0).clamp(0.0, 1.0),
      );

  EditIrFilter copyWith({String? preset, double? brightness, double? contrast, double? saturation, double? exposure, double? temperature, double? tint, double? vignette}) =>
      EditIrFilter(
        preset: preset ?? this.preset,
        brightness: brightness ?? this.brightness,
        contrast: contrast ?? this.contrast,
        saturation: saturation ?? this.saturation,
        exposure: exposure ?? this.exposure,
        temperature: temperature ?? this.temperature,
        tint: tint ?? this.tint,
        vignette: vignette ?? this.vignette,
      );

  /// Nothing to apply (NORMAL preset, every adjustment neutral).
  bool get isNeutral =>
      preset == 'NORMAL' && brightness == 1 && contrast == 1 && saturation == 1 && exposure == 0 && temperature == 0 && tint == 0 && vignette == 0;

  Map<String, dynamic> toJson() => {
        'preset': preset,
        'brightness': brightness,
        'contrast': contrast,
        'saturation': saturation,
        if (exposure != 0) 'exposure': exposure,
        if (temperature != 0) 'temperature': temperature,
        if (tint != 0) 'tint': tint,
        if (vignette != 0) 'vignette': vignette,
      };
}

class EditIrTransition {
  EditIrTransition({this.type = 'CROSSFADE', required this.durationMs});
  final String type;
  final int durationMs;

  /// Mobile transition types (contract `MOBILE_TRANSITION_TYPES`) with user-facing names. Any other
  /// type is kept as-is for the round trip; the renderer draws it as a crossfade and warns.
  static const types = {
    'CUT': 'Hard cut',
    'CROSSFADE': 'Crossfade',
    'DISSOLVE': 'Dissolve',
    'DIP_BLACK': 'Fade through black',
    'DIP_WHITE': 'Fade through white',
    'ZOOM_SWOOSH': 'Zoom swoosh',
    'ZOOM_OUT': 'Zoom out',
    'GLITCH': 'Glitch',
  };

  bool get isKnown => types.containsKey(type);

  factory EditIrTransition.fromJson(Map<String, dynamic> j) =>
      EditIrTransition(type: j['type'] as String? ?? 'CROSSFADE', durationMs: _int(j, 'durationMs'));

  Map<String, dynamic> toJson() => {'type': type, 'durationMs': durationMs};
}

class EditIrClip {
  EditIrClip({
    required this.id,
    this.assetId = 'primary',
    required this.sourceStartMs,
    required this.sourceEndMs,
    required this.timelineStartMs,
    required this.timelineEndMs,
    this.speed = 1,
    this.volumeDb = 0,
    this.crop,
    this.filter,
    this.transitionIn,
    this.rotationDeg = 0,
    this.flipH = false,
    this.audioFadeInMs = 0,
    this.audioFadeOutMs = 0,
    this.voiceCleanup = false,
    this.process,
  });

  /// "Reduce background noise" on this clip's own sound (applied by the export).
  final bool voiceCleanup;

  /// `reverse` / `stabilize` queued by the AI Director; the phone runs it and swaps in the processed file.
  final String? process;

  final String id;
  final String assetId;

  /// Fade of the clip's own sound at its start / end (0 = none), on top of transition fades.
  final int audioFadeInMs, audioFadeOutMs;

  /// Clockwise rotation applied before crop: 0, 90, 180 or 270.
  final int rotationDeg;
  final bool flipH;
  final int sourceStartMs, sourceEndMs, timelineStartMs, timelineEndMs;
  final double speed;
  final double volumeDb;
  final EditIrCrop? crop;
  final EditIrFilter? filter;
  final EditIrTransition? transitionIn;

  factory EditIrClip.fromJson(Map<String, dynamic> j) => EditIrClip(
        id: _str(j, 'id'),
        assetId: j['assetId'] as String? ?? 'primary',
        sourceStartMs: _int(j, 'sourceStartMs'),
        sourceEndMs: _int(j, 'sourceEndMs'),
        timelineStartMs: _int(j, 'timelineStartMs'),
        timelineEndMs: _int(j, 'timelineEndMs'),
        speed: (j['speed'] as num?)?.toDouble() ?? 1,
        volumeDb: (j['volumeDb'] as num?)?.toDouble() ?? 0,
        crop: j['crop'] == null ? null : EditIrCrop.fromJson(_obj(j, 'crop')),
        filter: j['filter'] == null ? null : EditIrFilter.fromJson(_obj(j, 'filter')),
        transitionIn: j['transitionIn'] == null ? null : EditIrTransition.fromJson(_obj(j, 'transitionIn')),
        rotationDeg: (j['rotationDeg'] as num?)?.toInt() ?? 0,
        flipH: j['flipH'] as bool? ?? false,
        audioFadeInMs: (j['audioFadeInMs'] as num?)?.toInt() ?? 0,
        audioFadeOutMs: (j['audioFadeOutMs'] as num?)?.toInt() ?? 0,
        voiceCleanup: j['voiceCleanup'] as bool? ?? false,
        process: j['process'] == 'reverse' || j['process'] == 'stabilize' ? j['process'] as String : null,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'assetId': assetId,
        'sourceStartMs': sourceStartMs,
        'sourceEndMs': sourceEndMs,
        'timelineStartMs': timelineStartMs,
        'timelineEndMs': timelineEndMs,
        'speed': speed,
        'volumeDb': volumeDb,
        'crop': crop?.toJson(),
        'filter': filter?.toJson(),
        'transitionIn': transitionIn?.toJson(),
        // Optional fields: omitted at their defaults so older servers accept the timeline.
        if (rotationDeg != 0) 'rotationDeg': rotationDeg,
        if (flipH) 'flipH': true,
        if (audioFadeInMs > 0) 'audioFadeInMs': audioFadeInMs,
        if (audioFadeOutMs > 0) 'audioFadeOutMs': audioFadeOutMs,
        if (voiceCleanup) 'voiceCleanup': true,
        'process': ?process,
      };
}

class EditIrOverlay {
  EditIrOverlay({
    required this.id,
    required this.timelineStartMs,
    required this.timelineEndMs,
    this.sourceStartMs = 0,
    this.source = const {},
    this.opacity = 1,
    this.muted = true,
    this.mediaType = 'video',
    this.fit = 'cover',
    this.layer,
    this.chromaKey,
    this.mask,
    this.process,
  });

  /// `remove_background` queued by the AI Director; the phone cuts the person out and clears it.
  final String? process;

  /// Circle / rounded-corner shape (layers only).
  final EditIrMask? mask;

  final String id;
  final int timelineStartMs, timelineEndMs, sourceStartMs;

  /// Green-screen key (applied to layers; a keyed cutaway would show black).
  final EditIrChromaKey? chromaKey;
  /// `cover` crops to fill; `contain` keeps the whole frame.
  final String fit;
  /// Layer placement; null = full-frame cutaway (the original behaviour).
  final EditIrLayer? layer;
  bool get isLayer => layer?.isOverlay ?? false;

  /// `video` or `image` (a still photo held for the slot).
  final String mediaType;
  bool get isImage => mediaType == 'image';

  EditIrOverlay copyWith({
    int? timelineStartMs,
    int? timelineEndMs,
    int? sourceStartMs,
    double? opacity,
    bool? muted,
    String? fit,
    EditIrLayer? layer,
    bool clearLayer = false,
    Map<String, dynamic>? source,
    EditIrChromaKey? chromaKey,
    bool clearChromaKey = false,
    EditIrMask? mask,
    bool clearMask = false,
    bool clearProcess = false,
  }) =>
      EditIrOverlay(
        id: id,
        timelineStartMs: timelineStartMs ?? this.timelineStartMs,
        timelineEndMs: timelineEndMs ?? this.timelineEndMs,
        sourceStartMs: sourceStartMs ?? this.sourceStartMs,
        source: source ?? this.source,
        opacity: opacity ?? this.opacity,
        muted: muted ?? this.muted,
        mediaType: mediaType,
        fit: fit ?? this.fit,
        layer: clearLayer ? null : (layer ?? this.layer),
        chromaKey: clearChromaKey ? null : (chromaKey ?? this.chromaKey),
        mask: clearMask ? null : (mask ?? this.mask),
        process: clearProcess ? null : process,
      );

  /// `{kind:"url"|"asset"|"stock_query", ...}` — resolve to a local file before rendering.
  final Map<String, dynamic> source;
  final double opacity;
  final bool muted;

  factory EditIrOverlay.fromJson(Map<String, dynamic> j) {
    final source = (j['source'] as Map?)?.cast<String, dynamic>() ?? {};
    // Older drafts kept framing in the source map (`pip`, `fit`), which the export ignored; they become real fields.
    final legacyFit = source['fit'] == 'contain' ? 'contain' : null;
    final layer = EditIrLayer.fromJson(j['layer']) ?? (source['pip'] == true ? EditIrLayer.legacyPip : null);
    return EditIrOverlay(
      id: _str(j, 'id'),
      timelineStartMs: _int(j, 'timelineStartMs'),
      timelineEndMs: _int(j, 'timelineEndMs'),
      sourceStartMs: (j['sourceStartMs'] as num?)?.toInt() ?? 0,
      source: {...source}..remove('pip')..remove('fit'),
      opacity: (j['opacity'] as num?)?.toDouble() ?? 1,
      muted: j['muted'] as bool? ?? true,
      mediaType: j['mediaType'] == 'image' ? 'image' : 'video',
      fit: j['fit'] == 'contain' ? 'contain' : (legacyFit ?? 'cover'),
      layer: layer,
      chromaKey: EditIrChromaKey.fromJson(j['chromaKey']),
      mask: EditIrMask.fromJson(j['mask']),
      process: j['process'] == 'remove_background' ? 'remove_background' : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': 'broll',
        'timelineStartMs': timelineStartMs,
        'timelineEndMs': timelineEndMs,
        'sourceStartMs': sourceStartMs,
        'source': source,
        'fit': fit,
        'opacity': opacity,
        'muted': muted,
        if (isImage) 'mediaType': 'image',
        if (layer != null) 'layer': layer!.toJson(),
        if (chromaKey != null) 'chromaKey': chromaKey!.toJson(),
        if (mask != null) 'mask': mask!.toJson(),
        'process': ?process,
      };
}

class EditIrWord {
  EditIrWord({required this.text, required this.startMs, required this.endMs, this.highlight = false, this.color, this.scale = 1});
  final String text;
  final int startMs, endMs;
  final bool highlight;
  final String? color;
  final double scale;

  factory EditIrWord.fromJson(Map<String, dynamic> j) => EditIrWord(
        text: _str(j, 'text'),
        startMs: _int(j, 'startMs'),
        endMs: _int(j, 'endMs'),
        highlight: j['highlight'] as bool? ?? false,
        color: j['color'] as String?,
        scale: (j['scale'] as num?)?.toDouble() ?? 1,
      );

  Map<String, dynamic> toJson() =>
      {'text': text, 'startMs': startMs, 'endMs': endMs, 'highlight': highlight, 'color': color, 'scale': scale};
}

class EditIrCaption {
  EditIrCaption({
    required this.id,
    this.kind = 'caption',
    required this.startMs,
    required this.endMs,
    required this.text,
    this.words = const [],
    this.style = const {},
  });

  final String id;
  final String kind;
  final int startMs, endMs;
  final String text;
  final List<EditIrWord> words;

  /// Style object exactly as defined in contract §3.4 (preset, animation, fontSizePx, colours, ...).
  final Map<String, dynamic> style;

  factory EditIrCaption.fromJson(Map<String, dynamic> j) => EditIrCaption(
        id: _str(j, 'id'),
        kind: j['kind'] as String? ?? 'caption',
        startMs: _int(j, 'startMs'),
        endMs: _int(j, 'endMs'),
        text: j['text'] as String? ?? '',
        words: _list(j, 'words', EditIrWord.fromJson),
        style: normaliseCaptionStyle((j['style'] as Map?)?.cast<String, dynamic>() ?? {}),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind,
        'startMs': startMs,
        'endMs': endMs,
        'text': text,
        'words': words.map((w) => w.toJson()).toList(),
        'style': style,
      };
}

class EditIrZoom {
  EditIrZoom({required this.id, required this.startMs, required this.endMs, this.scale = 1.3, this.centerX = 0.5, this.centerY = 0.5, this.rampMs = 250});
  final String id;
  final int startMs, endMs, rampMs;
  final double scale, centerX, centerY;

  factory EditIrZoom.fromJson(Map<String, dynamic> j) => EditIrZoom(
        id: _str(j, 'id'),
        startMs: _int(j, 'startMs'),
        endMs: _int(j, 'endMs'),
        scale: (j['scale'] as num?)?.toDouble() ?? 1.3,
        centerX: (j['centerX'] as num?)?.toDouble() ?? 0.5,
        centerY: (j['centerY'] as num?)?.toDouble() ?? 0.5,
        rampMs: (j['rampMs'] as num?)?.toInt() ?? 250,
      );

  Map<String, dynamic> toJson() =>
      {'id': id, 'startMs': startMs, 'endMs': endMs, 'scale': scale, 'centerX': centerX, 'centerY': centerY, 'rampMs': rampMs};
}

class EditIrDuck {
  EditIrDuck({this.enabled = true, this.duckDb = -12, this.attackMs = 120, this.releaseMs = 350});
  final bool enabled;
  final double duckDb;
  final int attackMs, releaseMs;

  factory EditIrDuck.fromJson(Map<String, dynamic> j) => EditIrDuck(
        enabled: j['enabled'] as bool? ?? false,
        duckDb: (j['duckDb'] as num?)?.toDouble() ?? -12,
        attackMs: (j['attackMs'] as num?)?.toInt() ?? 120,
        releaseMs: (j['releaseMs'] as num?)?.toInt() ?? 350,
      );

  Map<String, dynamic> toJson() => {'enabled': enabled, 'duckDb': duckDb, 'attackMs': attackMs, 'releaseMs': releaseMs};
}

class EditIrMusic {
  EditIrMusic({
    required this.id,
    required this.timelineStartMs,
    required this.timelineEndMs,
    this.sourceStartMs = 0,
    this.source = const {},
    this.volumeDb = -16,
    this.fadeInMs = 0,
    this.fadeOutMs = 0,
    this.duck,
  });

  final String id;
  final int timelineStartMs, timelineEndMs, sourceStartMs, fadeInMs, fadeOutMs;
  final Map<String, dynamic> source;
  final double volumeDb;
  final EditIrDuck? duck;

  factory EditIrMusic.fromJson(Map<String, dynamic> j) => EditIrMusic(
        id: _str(j, 'id'),
        timelineStartMs: _int(j, 'timelineStartMs'),
        timelineEndMs: _int(j, 'timelineEndMs'),
        sourceStartMs: (j['sourceStartMs'] as num?)?.toInt() ?? 0,
        source: (j['source'] as Map?)?.cast<String, dynamic>() ?? {},
        volumeDb: (j['volumeDb'] as num?)?.toDouble() ?? 0,
        fadeInMs: (j['fadeInMs'] as num?)?.toInt() ?? 0,
        fadeOutMs: (j['fadeOutMs'] as num?)?.toInt() ?? 0,
        duck: j['duck'] == null ? null : EditIrDuck.fromJson(_obj(j, 'duck')),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'timelineStartMs': timelineStartMs,
        'timelineEndMs': timelineEndMs,
        'sourceStartMs': sourceStartMs,
        'source': source,
        'volumeDb': volumeDb,
        'fadeInMs': fadeInMs,
        'fadeOutMs': fadeOutMs,
        // The contract requires a duck object; "no ducking" is enabled:false, never null.
        'duck': (duck ?? EditIrDuck(enabled: false)).toJson(),
      };
}

/// One-shot sound effect placed by the director (contract §3.6 `audio.sfx`).
class EditIrSfx {
  EditIrSfx({
    required this.id,
    required this.timelineStartMs,
    this.durationMs,
    this.source = const {},
    this.volumeDb = -12,
    this.credit,
  });

  final String id;
  final int timelineStartMs;
  final int? durationMs;

  /// `{kind:"url", url}` — downloaded before rendering.
  final Map<String, dynamic> source;
  final double volumeDb;

  /// Licence attribution to show in the post credits, if the source requires it.
  final String? credit;

  EditIrSfx moved(int start) =>
      EditIrSfx(id: id, timelineStartMs: start, durationMs: durationMs, source: source, volumeDb: volumeDb, credit: credit);

  factory EditIrSfx.fromJson(Map<String, dynamic> j) => EditIrSfx(
        id: _str(j, 'id'),
        timelineStartMs: _int(j, 'timelineStartMs'),
        durationMs: (j['durationMs'] as num?)?.toInt(),
        source: (j['source'] as Map?)?.cast<String, dynamic>() ?? {},
        volumeDb: (j['volumeDb'] as num?)?.toDouble() ?? -12,
        credit: j['credit'] as String?,
      );

  factory EditIrSfx.fromMap(Map<String, dynamic> m) => EditIrSfx.fromJson(m);

  Map<String, dynamic> toMap() => toJson();

  Map<String, dynamic> toJson() => {
        'id': id,
        'timelineStartMs': timelineStartMs,
        if (durationMs != null) 'durationMs': durationMs,
        'source': source,
        'volumeDb': volumeDb,
        if (credit != null) 'credit': credit,
      };
}

/// Voiceover recorded on this phone (contract MobileVoiceoverSchema). [assetId] is a local asset (draft sourcePaths).
class EditIrVoiceover {
  EditIrVoiceover({
    required this.id,
    required this.timelineStartMs,
    required this.durationMs,
    required this.assetId,
    this.sourceStartMs = 0,
    this.volumeDb = 0,
    this.fadeInMs = 0,
    this.fadeOutMs = 0,
  });
  final String id, assetId;
  final int timelineStartMs, durationMs, sourceStartMs, fadeInMs, fadeOutMs;
  final double volumeDb;

  int get timelineEndMs => timelineStartMs + durationMs;

  EditIrVoiceover copyWith({int? timelineStartMs, int? durationMs, int? sourceStartMs, double? volumeDb, int? fadeInMs, int? fadeOutMs}) =>
      EditIrVoiceover(
        id: id,
        assetId: assetId,
        timelineStartMs: timelineStartMs ?? this.timelineStartMs,
        durationMs: durationMs ?? this.durationMs,
        sourceStartMs: sourceStartMs ?? this.sourceStartMs,
        volumeDb: volumeDb ?? this.volumeDb,
        fadeInMs: fadeInMs ?? this.fadeInMs,
        fadeOutMs: fadeOutMs ?? this.fadeOutMs,
      );

  factory EditIrVoiceover.fromJson(Map<String, dynamic> j) => EditIrVoiceover(
        id: _str(j, 'id'),
        timelineStartMs: _int(j, 'timelineStartMs'),
        durationMs: _int(j, 'durationMs'),
        sourceStartMs: (j['sourceStartMs'] as num?)?.toInt() ?? 0,
        assetId: _str(_obj(j, 'source'), 'assetId'),
        volumeDb: (j['volumeDb'] as num?)?.toDouble() ?? 0,
        fadeInMs: (j['fadeInMs'] as num?)?.toInt() ?? 0,
        fadeOutMs: (j['fadeOutMs'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'timelineStartMs': timelineStartMs,
        'durationMs': durationMs,
        'sourceStartMs': sourceStartMs,
        'source': {'kind': 'asset', 'assetId': assetId},
        'volumeDb': volumeDb,
        if (fadeInMs > 0) 'fadeInMs': fadeInMs,
        if (fadeOutMs > 0) 'fadeOutMs': fadeOutMs,
      };
}

class EditIrAudio {
  const EditIrAudio({
    this.originalVolumeDb = 0,
    this.music = const [],
    this.speechRangesMs = const [],
    this.sfx = const [],
    this.voiceovers = const [],
  });
  final double originalVolumeDb;
  final List<EditIrMusic> music;
  final List<EditIrSfx> sfx;
  final List<EditIrVoiceover> voiceovers;

  /// Sorted, non-overlapping `[startMs, endMs]` pairs on the timeline.
  final List<List<int>> speechRangesMs;

  factory EditIrAudio.fromMap(Map<String, dynamic> m) => EditIrAudio.fromJson(m);

  factory EditIrAudio.fromJson(Map<String, dynamic> j) => EditIrAudio(
        originalVolumeDb: ((j['originalTrack'] as Map?)?['volumeDb'] as num?)?.toDouble() ?? 0,
        music: _list(j, 'music', EditIrMusic.fromJson),
        sfx: _list(j, 'sfx', EditIrSfx.fromJson),
        voiceovers: _list(j, 'voiceovers', EditIrVoiceover.fromJson),
        speechRangesMs: ((j['speechRangesMs'] as List?) ?? [])
            .map((r) => (r as List).map((v) => (v as num).toInt()).toList())
            .toList(),
      );

  Map<String, dynamic> toMap() => toJson();

  Map<String, dynamic> toJson() => {
        'originalTrack': {'volumeDb': originalVolumeDb},
        'music': music.map((m) => m.toJson()).toList(),
        'speechRangesMs': speechRangesMs,
        if (sfx.isNotEmpty) 'sfx': sfx.map((e) => e.toJson()).toList(),
        if (voiceovers.isNotEmpty) 'voiceovers': voiceovers.map((e) => e.toJson()).toList(),
      };
}

// ---------------------------------------------------------------------------------------------

Never _bad(String field, String problem) => throw MediaEngineException('INVALID_EDIT_IR', "Field '$field' $problem");

Map<String, dynamic> _obj(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is Map) return v.cast<String, dynamic>();
  _bad(k, 'must be an object');
}

int _int(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is num) return v.toInt();
  _bad(k, 'must be a number');
}

double _dbl(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is num) return v.toDouble();
  _bad(k, 'must be a number');
}

String _str(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is String) return v;
  _bad(k, 'must be a string');
}

List<T> _list<T>(Map<String, dynamic> j, String k, T Function(Map<String, dynamic>) parse, {bool required = false}) {
  final v = j[k];
  if (v == null) {
    if (required) _bad(k, 'is required');
    return [];
  }
  if (v is! List) _bad(k, 'must be an array');
  return v.map((e) => parse((e as Map).cast<String, dynamic>())).toList();
}

/// One detected face at source time [tMs]: box centre ([x], [y]) and size ([w], [h]) as 0..1
/// fractions of the display-oriented frame (the `/ai-direct` `media.faces` format).
class FaceSample {
  FaceSample({required this.tMs, required this.x, required this.y, required this.w, required this.h});
  final int tMs;
  final double x;
  final double y;
  final double w;
  final double h;

  factory FaceSample.fromMap(Map<String, dynamic> m) => FaceSample(
        tMs: (m['tMs'] as num).toInt(),
        x: (m['x'] as num).toDouble(),
        y: (m['y'] as num).toDouble(),
        w: (m['w'] as num).toDouble(),
        h: (m['h'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => {'tMs': tMs, 'x': x, 'y': y, 'w': w, 'h': h};
}

/// Timeline effect (contract VIDEO_EFFECT_TYPES). Drawn over the whole frame for [startMs, endMs).
class EditIrEffect {
  EditIrEffect({required this.id, required this.type, required this.startMs, required this.endMs, this.intensity = 0.6});

  final String id;
  final String type;
  final int startMs, endMs;

  /// 0..1
  final double intensity;

  /// Type → (label, one-line description, default length ms). Same ids as the server and desktop editor.
  static const types = <String, (String, String, int)>{
    'flash': ('Flash', 'Quick white flash on a cut or beat', 300),
    'fade_black': ('Dip to black', 'Fades to black and back between sections', 600),
    'shake': ('Shake', 'Camera shake for impact and energy', 500),
    'zoom_pulse': ('Zoom pulse', 'Fast punch in and out on the beat', 500),
    'black_white': ('Black & white', 'Removes colour for a flashback or contrast moment', 2000),
    'vignette': ('Vignette', 'Darkens the edges to focus attention', 3000),
  };

  String get label => types[type]?.$1 ?? type;

  EditIrEffect copyWith({int? startMs, int? endMs, double? intensity}) => EditIrEffect(
        id: id,
        type: type,
        startMs: startMs ?? this.startMs,
        endMs: endMs ?? this.endMs,
        intensity: intensity ?? this.intensity,
      );

  factory EditIrEffect.fromJson(Map<String, dynamic> j) => EditIrEffect(
        id: _str(j, 'id'),
        type: _str(j, 'type'),
        startMs: _int(j, 'startMs'),
        endMs: _int(j, 'endMs'),
        intensity: ((j['intensity'] as num?)?.toDouble() ?? 0.6).clamp(0.0, 1.0),
      );

  Map<String, dynamic> toJson() => {'id': id, 'type': type, 'startMs': startMs, 'endMs': endMs, 'intensity': intensity};
}

/// `animation` only allows word_pop | karaoke | word_box | word_reveal | none (contract + renderer). Older text styles stored motion there
/// (fade_in, slide_up, typewriter, pulse), which the export ignored and the server rejected; they become the
/// `enter` / `loop` motion fields that both the preview and the renderer apply.
Map<String, dynamic> normaliseCaptionStyle(Map<String, dynamic> style) {
  const legacyEnter = {'fade_in': 'fade', 'slide_up': 'slide_up', 'typewriter': 'typewriter'};
  final anim = style['animation'];
  if (anim is! String || const {'word_pop', 'karaoke', 'word_box', 'word_reveal', 'none'}.contains(anim)) return style;
  final out = {...style, 'animation': 'none'};
  if (legacyEnter.containsKey(anim)) {
    out['enter'] ??= {'type': legacyEnter[anim], 'durationMs': anim == 'typewriter' ? 1200 : 400};
  } else if (anim == 'pulse') {
    out['loop'] ??= {'type': 'pulse', 'periodMs': 1200};
  }
  return out;
}
