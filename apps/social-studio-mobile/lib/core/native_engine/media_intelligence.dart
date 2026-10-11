/// Results of the on-device media intelligence and export QA tools (Android: ML Kit text
/// recognition, frame-difference scene cuts, EBU R128-style loudness, black/frozen frame scans).
/// All values are measured on the device; nothing here is estimated or invented.
library;

List<List<int>> _ranges(Object? v) => [
      for (final r in (v as List?) ?? [])
        if (r is List && r.length == 2 && r[0] is num && r[1] is num) [(r[0] as num).toInt(), (r[1] as num).toInt()],
    ];

double? _d(Object? v) => v is num && v.isFinite ? v.toDouble() : null;

/// On-screen text seen in [startMs, endMs) of the source (sent as `media.ocr`).
class OcrSpan {
  OcrSpan({required this.startMs, required this.endMs, required this.text});
  final int startMs;
  final int endMs;
  final String text;

  factory OcrSpan.fromMap(Map<String, dynamic> m) =>
      OcrSpan(startMs: (m['startMs'] as num).toInt(), endMs: (m['endMs'] as num).toInt(), text: '${m['text'] ?? ''}');

  Map<String, dynamic> toJson() => {'startMs': startMs, 'endMs': endMs, 'text': text};
}

/// Loudness of an audio track: integrated loudness (LUFS, ITU-R BS.1770 K-weighted with the
/// EBU R128 gates), true peak (dBTP, 4x oversampled estimate) and the share of clipped samples.
/// [integratedLufs] is null when the audio is entirely below the absolute gate (silence).
class LoudnessStats {
  LoudnessStats({this.integratedLufs, this.truePeakDb, this.clippingPct});
  final double? integratedLufs;
  final double? truePeakDb;
  final double? clippingPct;

  factory LoudnessStats.fromMap(Map<String, dynamic> m) => LoudnessStats(
        integratedLufs: _d(m['integratedLufs']),
        truePeakDb: _d(m['truePeakDb']),
        clippingPct: _d(m['clippingPct']),
      );

  /// `media.loudness` (only measured values).
  Map<String, dynamic>? toJson() {
    if (integratedLufs == null) return null; // the contract requires integratedLufs
    return {
      'integratedLufs': integratedLufs,
      'truePeakDb': ?truePeakDb,
      'clippingPct': ?clippingPct,
    };
  }
}

/// What the picture shows in [startMs, endMs) of the source: on-device ML Kit labels (sent as `media.labels`).
class SceneLabelSpan {
  SceneLabelSpan({required this.startMs, required this.endMs, required this.labels});
  final int startMs, endMs;
  final List<String> labels;

  factory SceneLabelSpan.fromMap(Map<String, dynamic> m) => SceneLabelSpan(
        startMs: (m['startMs'] as num).toInt(),
        endMs: (m['endMs'] as num).toInt(),
        labels: [for (final l in (m['labels'] as List? ?? [])) '$l'],
      );

  Map<String, dynamic> toJson() => {'startMs': startMs, 'endMs': endMs, 'labels': labels};
}

/// A cached on-device analysis of one source file (OCR, scene cuts, scene labels, loudness).
class MediaIntelligence {
  MediaIntelligence({this.scenesMs, this.ocr, this.loudness, this.labels});
  final List<int>? scenesMs;
  final List<OcrSpan>? ocr;
  final LoudnessStats? loudness;
  final List<SceneLabelSpan>? labels;

  bool get isEmpty => scenesMs == null && ocr == null && loudness == null && labels == null;

  MediaIntelligence merge({List<int>? scenesMs, List<OcrSpan>? ocr, LoudnessStats? loudness, List<SceneLabelSpan>? labels}) => MediaIntelligence(
        scenesMs: scenesMs ?? this.scenesMs,
        ocr: ocr ?? this.ocr,
        loudness: loudness ?? this.loudness,
        labels: labels ?? this.labels,
      );

  Map<String, dynamic> toJson() => {
        'scenesMs': ?scenesMs,
        if (ocr != null) 'ocr': [for (final o in ocr!) o.toJson()],
        if (labels != null) 'labels': [for (final l in labels!) l.toJson()],
        if (loudness != null)
          'loudness': {
            'integratedLufs': loudness!.integratedLufs,
            'truePeakDb': loudness!.truePeakDb,
            'clippingPct': loudness!.clippingPct,
          },
      };

  factory MediaIntelligence.fromJson(Map<String, dynamic> j) => MediaIntelligence(
        scenesMs: (j['scenesMs'] as List?)?.whereType<num>().map((e) => e.toInt()).toList(),
        ocr: (j['ocr'] as List?)?.whereType<Map>().map((m) => OcrSpan.fromMap(m.cast<String, dynamic>())).toList(),
        loudness: j['loudness'] is Map ? LoudnessStats.fromMap((j['loudness'] as Map).cast<String, dynamic>()) : null,
        labels: (j['labels'] as List?)?.whereType<Map>().map((m) => SceneLabelSpan.fromMap(m.cast<String, dynamic>())).toList(),
      );
}

/// Measured facts about an exported file (`lastExportQa` in the `/ai-direct` request).
class ExportQa {
  ExportQa({
    required this.durationMs,
    required this.width,
    required this.height,
    required this.hasAudio,
    this.fps,
    this.audioChannels,
    this.blackRangesMs = const [],
    this.frozenRangesMs = const [],
    this.integratedLufs,
    this.truePeakDb,
    this.clippingPct,
  });

  final int durationMs;
  final int width;
  final int height;
  final double? fps;
  final bool hasAudio;
  final int? audioChannels;
  final List<List<int>> blackRangesMs;
  final List<List<int>> frozenRangesMs;
  final double? integratedLufs;
  final double? truePeakDb;
  final double? clippingPct;

  factory ExportQa.fromMap(Map<String, dynamic> m) => ExportQa(
        durationMs: (m['durationMs'] as num).toInt(),
        width: (m['width'] as num).toInt(),
        height: (m['height'] as num).toInt(),
        fps: _d(m['fps']),
        hasAudio: m['hasAudio'] == true,
        audioChannels: (m['audioChannels'] as num?)?.toInt(),
        blackRangesMs: _ranges(m['blackRangesMs']),
        frozenRangesMs: _ranges(m['frozenRangesMs']),
        integratedLufs: _d(m['integratedLufs']),
        truePeakDb: _d(m['truePeakDb']),
        clippingPct: _d(m['clippingPct']),
      );

  /// Wire form of `lastExportQa` (contract fields only; unmeasured values are omitted).
  Map<String, dynamic> toJson() => {
        'durationMs': durationMs,
        'width': width,
        'height': height,
        'fps': ?fps,
        'hasAudio': hasAudio,
        'audioChannels': ?audioChannels,
        'blackRangesMs': blackRangesMs,
        'frozenRangesMs': frozenRangesMs,
        'integratedLufs': ?integratedLufs,
        'clippingPct': ?clippingPct,
      };

  /// Local persistence form (includes true peak).
  Map<String, dynamic> toStorageJson() => {...toJson(), 'truePeakDb': ?truePeakDb};
}
