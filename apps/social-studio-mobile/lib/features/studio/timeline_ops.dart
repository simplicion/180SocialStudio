import 'dart:math' as math;

import 'package:uuid/uuid.dart';

import '../../core/native_engine/edit_ir.dart';
import '../../core/native_engine/media_engine_exception.dart';
import '../../core/network/audio_transcription_service.dart';
import 'caption_tools.dart';

/// Manual editing operations on a `mobile-editir/1` timeline.
///
/// Every operation is pure: it returns a new, valid timeline (see [MobileEditIr.validate]) and
/// never mutates its input, which gives the editor undo/redo for free. The AI Director edits
/// the same structure, so manual and AI edits compose in either order.
///
/// Main-track changes (split, delete, trim, reorder, speed) ripple **every** other track —
/// captions and their word timings, zooms, B-roll, music and speech ranges — through one
/// old-timeline → new-timeline mapping, so nothing drifts out of sync with the speech.
class TimelineOps {
  TimelineOps._();

  static const minClipMs = 100;
  static const _uuid = Uuid();
  static String _id(String prefix) => '${prefix}_${_uuid.v4().substring(0, 8)}';

  static const aspects = ['9:16', '1:1', '4:5', '16:9'];

  static EditIrCanvas canvasFor(
    String aspect, {
    num fps = 30,
    String background = '#000000',
  }) => switch (aspect) {
    '16:9' => EditIrCanvas(
      aspect: aspect,
      width: 1920,
      height: 1080,
      fps: fps,
      background: background,
    ),
    '1:1' => EditIrCanvas(
      aspect: aspect,
      width: 1080,
      height: 1080,
      fps: fps,
      background: background,
    ),
    '4:5' => EditIrCanvas(
      aspect: aspect,
      width: 1080,
      height: 1350,
      fps: fps,
      background: background,
    ),
    _ => EditIrCanvas(
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: fps,
      background: background,
    ),
  };

  /// Crop of a [srcW]×[srcH] (display-oriented) source that fills [canvas], centred on [focus]
  /// (0..1 source fractions, e.g. the speaker's face) and kept inside the frame; the frame centre
  /// when [focus] is null. Null when the aspect ratios already match (no crop needed).
  static EditIrCrop? centerCrop(
    int srcW,
    int srcH,
    EditIrCanvas canvas, {
    ({double x, double y})? focus,
  }) {
    if (srcW <= 0 || srcH <= 0) return null;
    final src = srcW / srcH;
    final dst = canvas.width / canvas.height;
    if ((src - dst).abs() < 0.01) return null;
    final fx = focus?.x ?? 0.5;
    final fy = focus?.y ?? 0.5;
    if (src > dst) {
      final w = dst / src;
      return EditIrCrop(
        x: _r((fx - w / 2).clamp(0.0, 1 - w)),
        y: 0,
        width: _r(w),
        height: 1,
      );
    }
    final h = src / dst;
    return EditIrCrop(
      x: 0,
      y: _r((fy - h / 2).clamp(0.0, 1 - h)),
      width: 1,
      height: _r(h),
    );
  }

  /// The dominant face centre: the largest face of each sample, then the median x/y over all
  /// samples, clamped to 0.1..0.9 (same rule as the server's `dominantFaceCenter`). Null without faces.
  static ({double x, double y})? faceFocus(List<FaceSample> faces) {
    if (faces.isEmpty) return null;
    final largest = <int, FaceSample>{};
    for (final f in faces) {
      final cur = largest[f.tMs];
      if (cur == null || f.w * f.h > cur.w * cur.h) largest[f.tMs] = f;
    }
    double median(Iterable<double> v) {
      final s = v.toList()..sort();
      final m = s.length ~/ 2;
      return s.length.isOdd ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    return (
      x: _r(median(largest.values.map((f) => f.x)).clamp(0.1, 0.9)),
      y: _r(median(largest.values.map((f) => f.y)).clamp(0.1, 0.9)),
    );
  }

  static double _r(double v) => (v * 10000).roundToDouble() / 10000;

  /// A one-clip timeline covering the whole source, reframed to [aspect] by centre crop.
  static MobileEditIr initial({
    required String projectId,
    required int durationMs,
    required int width,
    required int height,
    String aspect = '9:16',
    num fps = 30,
    List<TranscriptWord> words = const [],
    ({double x, double y})? focus,
  }) {
    if (durationMs < minClipMs) {
      throw MediaEngineException(
        'INVALID_SOURCE',
        'The video is too short to edit (${durationMs}ms).',
      );
    }
    final canvas = canvasFor(aspect, fps: fps);
    final clip = EditIrClip(
      id: _id('c'),
      sourceStartMs: 0,
      sourceEndMs: durationMs,
      timelineStartMs: 0,
      timelineEndMs: durationMs,
      crop: centerCrop(width, height, canvas, focus: focus),
    );
    final ir = MobileEditIr(
      projectId: projectId,
      canvas: canvas,
      durationMs: durationMs,
      sources: [
        EditIrSource(durationMs: durationMs, width: width, height: height),
      ],
      clips: [clip],
    );
    return _withAudio(ir, speechRangesMs: speechRanges(words, ir));
  }

  // ── Mapping helpers ────────────────────────────────────────────────────────

  /// Timeline time of a source time, or null when that source moment was cut.
  static int? sourceToTimeline(
    MobileEditIr ir,
    int sourceMs, {
    String assetId = 'primary',
  }) {
    for (final c in ir.clips) {
      if (c.assetId == assetId &&
          sourceMs >= c.sourceStartMs &&
          sourceMs < c.sourceEndMs) {
        return c.timelineStartMs +
            ((sourceMs - c.sourceStartMs) / c.speed).round();
      }
    }
    return null;
  }

  /// Speech intervals on the timeline from source-time transcript words (gaps < 300 ms merge).
  static List<List<int>> speechRanges(
    List<TranscriptWord> words,
    MobileEditIr ir,
  ) {
    final out = <List<int>>[];
    for (final w in words) {
      final s = sourceToTimeline(ir, w.startMs);
      final e = sourceToTimeline(ir, math.max(w.startMs, w.endMs - 1));
      if (s == null || e == null || e < s) continue;
      if (out.isNotEmpty && s - out.last[1] < 300 && s >= out.last[0]) {
        out.last[1] = math.max(out.last[1], e + 1);
      } else {
        out.add([s, e + 1]);
      }
    }
    out.sort((a, b) => a[0].compareTo(b[0]));
    final merged = <List<int>>[];
    for (final r in out) {
      if (merged.isNotEmpty && r[0] <= merged.last[1]) {
        merged.last[1] = math.max(merged.last[1], r[1]);
      } else {
        merged.add([r[0], math.min(r[1], ir.durationMs)]);
      }
    }
    return merged.where((r) => r[1] > r[0]).toList();
  }

  static List<EditIrClip> _relayout(List<EditIrClip> clips) {
    var t = 0;
    return [
      for (var i = 0; i < clips.length; i++)
        () {
          final c = clips[i];
          final len = ((c.sourceEndMs - c.sourceStartMs) / c.speed).round();
          final out = EditIrClip(
            id: c.id,
            assetId: c.assetId,
            sourceStartMs: c.sourceStartMs,
            sourceEndMs: c.sourceEndMs,
            timelineStartMs: t,
            timelineEndMs: t + len,
            speed: c.speed,
            volumeDb: c.volumeDb,
            crop: c.crop,
            filter: c.filter,
            transitionIn: i == 0 ? null : c.transitionIn,
            rotationDeg: c.rotationDeg,
            flipH: c.flipH,
            audioFadeInMs: c.audioFadeInMs,
            audioFadeOutMs: c.audioFadeOutMs,
            voiceCleanup: c.voiceCleanup,
            process: c.process,
          );
          t += len;
          return out;
        }(),
    ];
  }

  /// Replaces the main track and ripples every other track onto the new timing.
  static MobileEditIr _replaceClips(
    MobileEditIr ir,
    List<EditIrClip> newClips,
  ) {
    if (newClips.isEmpty) {
      throw MediaEngineException(
        'INVALID_EDIT',
        'A video needs at least one clip.',
      );
    }
    final laid = _relayout(newClips);
    final segs = <_Seg>[];
    for (final n in laid) {
      bool covers(EditIrClip o) => o.assetId == n.assetId && n.sourceStartMs >= o.sourceStartMs && n.sourceEndMs <= o.sourceEndMs;
      // Same clip id first: a duplicated clip shares its source with the original, so source alone is ambiguous.
      final old = ir.clips.where((o) => o.id == n.id && covers(o)).firstOrNull ?? ir.clips.where(covers).firstOrNull;
      if (old == null) {
        continue; // newly revealed source (trim extend): nothing to carry over
      }
      segs.add(
        _Seg(
          old.timelineStartMs +
              (n.sourceStartMs - old.sourceStartMs) / old.speed,
          old.timelineStartMs + (n.sourceEndMs - old.sourceStartMs) / old.speed,
          n.timelineStartMs.toDouble(),
          n.timelineEndMs.toDouble(),
        ),
      );
    }
    final duration = laid.last.timelineEndMs;
    final map = _Mapper(segs, duration);

    final captions = <EditIrCaption>[];
    for (final c in ir.captions) {
      final r = map.range(c.startMs, c.endMs);
      if (r == null) continue;
      final words = <EditIrWord>[];
      for (final w in c.words) {
        final wr = map.range(w.startMs, w.endMs);
        if (wr == null) continue;
        words.add(
          EditIrWord(
            text: w.text,
            startMs: math.max(wr.$1, r.$1),
            endMs: math.min(wr.$2, r.$2),
            highlight: w.highlight,
            color: w.color,
            scale: w.scale,
          ),
        );
      }
      if (c.kind == 'caption' && c.words.isNotEmpty && words.isEmpty) continue;
      captions.add(
        EditIrCaption(
          id: c.id,
          kind: c.kind,
          startMs: r.$1,
          endMs: r.$2,
          text: c.kind == 'caption' && words.isNotEmpty
              ? words.map((w) => w.text).join(' ')
              : c.text,
          words: c.kind == 'text'
              ? [EditIrWord(text: c.text, startMs: r.$1, endMs: r.$2)]
              : words,
          style: c.style,
        ),
      );
    }
    final zooms = <EditIrZoom>[];
    for (final z in ir.zooms) {
      final r = map.range(z.startMs, z.endMs);
      if (r == null || (zooms.isNotEmpty && r.$1 < zooms.last.endMs)) continue;
      zooms.add(
        EditIrZoom(
          id: z.id,
          startMs: r.$1,
          endMs: r.$2,
          scale: z.scale,
          centerX: z.centerX,
          centerY: z.centerY,
          rampMs: math.min(z.rampMs, (r.$2 - r.$1) ~/ 2),
        ),
      );
    }
    final overlays = <EditIrOverlay>[
      for (final o in ir.overlays)
        if (map.range(o.timelineStartMs, o.timelineEndMs) case final r?)
          o.copyWith(timelineStartMs: r.$1, timelineEndMs: r.$2),
    ];
    final effects = <EditIrEffect>[
      for (final e in ir.effects)
        if (map.range(e.startMs, e.endMs) case final r?)
          if (r.$2 - r.$1 >= 100) e.copyWith(startMs: r.$1, endMs: r.$2),
    ];
    final music = <EditIrMusic?>[
      for (final m in ir.audio.music)
        () {
          // Music under the whole video keeps covering the whole (new) video.
          final full =
              m.timelineStartMs == 0 && m.timelineEndMs >= ir.durationMs - 1;
          final r = full
              ? (0, duration)
              : map.range(m.timelineStartMs, m.timelineEndMs);
          return r == null ? null : _music(m, start: r.$1, end: r.$2);
        }(),
    ].whereType<EditIrMusic>().toList();
    final speech = <List<int>>[
      for (final s in ir.audio.speechRangesMs)
        if (s.length == 2)
          if (map.range(s[0], s[1]) case final r?) [r.$1, r.$2],
    ]..sort((a, b) => a[0].compareTo(b[0]));
    final mergedSpeech = <List<int>>[];
    for (final s in speech) {
      if (mergedSpeech.isNotEmpty && s[0] <= mergedSpeech.last[1]) {
        mergedSpeech.last[1] = math.max(mergedSpeech.last[1], s[1]);
      } else {
        mergedSpeech.add(s);
      }
    }
    final out = MobileEditIr(
      projectId: ir.projectId,
      canvas: ir.canvas,
      durationMs: duration,
      sources: ir.sources,
      watermark: ir.watermark,
      clips: laid,
      overlays: overlays,
      captions: captions..sort((a, b) => a.startMs.compareTo(b.startMs)),
      zooms: zooms,
      effects: effects,
      audio: EditIrAudio(
        originalVolumeDb: ir.audio.originalVolumeDb,
        music: music,
        speechRangesMs: mergedSpeech,
        // Effects follow the footage they were placed on; ones inside a cut are dropped.
        sfx: [
          for (final e in ir.audio.sfx)
            if (map.range(e.timelineStartMs, e.timelineStartMs + 1)
                case final r?)
              e.moved(r.$1),
        ],
        // Voiceovers stay where they start in the footage; one whose start was cut away is dropped.
        voiceovers: [
          for (final v in ir.audio.voiceovers)
            if (map.range(v.timelineStartMs, v.timelineStartMs + 1) case final r?)
              v.copyWith(timelineStartMs: r.$1, durationMs: math.min(v.durationMs, duration - r.$1)),
        ],
      ),
    );
    out.validate();
    return out;
  }

  /// Points the music bed at a resolved file (a search phrase became a real track); everything else is kept.
  static MobileEditIr setMusicSource(MobileEditIr ir, Map<String, dynamic> source) {
    final m = ir.audio.music.firstOrNull;
    if (m == null) return ir;
    return _withAudio(ir, music: [
      EditIrMusic(
        id: m.id,
        timelineStartMs: m.timelineStartMs,
        timelineEndMs: m.timelineEndMs,
        sourceStartMs: m.sourceStartMs,
        source: source,
        volumeDb: m.volumeDb,
        fadeInMs: m.fadeInMs,
        fadeOutMs: m.fadeOutMs,
        duck: m.duck,
      ),
    ]);
  }

  static EditIrMusic _music(
    EditIrMusic m, {
    int? start,
    int? end,
    double? volumeDb,
    int? fadeInMs,
    int? fadeOutMs,
    EditIrDuck? duck,
    bool clearDuck = false,
  }) => EditIrMusic(
    id: m.id,
    timelineStartMs: start ?? m.timelineStartMs,
    timelineEndMs: end ?? m.timelineEndMs,
    sourceStartMs: m.sourceStartMs,
    source: m.source,
    volumeDb: volumeDb ?? m.volumeDb,
    fadeInMs: fadeInMs ?? m.fadeInMs,
    fadeOutMs: fadeOutMs ?? m.fadeOutMs,
    duck: clearDuck ? null : (duck ?? m.duck),
  );

  static MobileEditIr _copy(
    MobileEditIr ir, {
    EditIrCanvas? canvas,
    List<EditIrClip>? clips,
    List<EditIrOverlay>? overlays,
    List<EditIrCaption>? captions,
    List<EditIrZoom>? zooms,
    EditIrAudio? audio,
    List<EditIrEffect>? effects,
  }) {
    final out = ir.copyWith(
      canvas: canvas,
      clips: clips,
      overlays: overlays,
      captions: captions,
      zooms: zooms,
      audio: audio,
      effects: effects,
    );
    out.validate();
    return out;
  }

  static MobileEditIr _withAudio(
    MobileEditIr ir, {
    double? originalVolumeDb,
    List<EditIrMusic>? music,
    List<List<int>>? speechRangesMs,
  }) => _copy(
    ir,
    audio: EditIrAudio(
      originalVolumeDb: originalVolumeDb ?? ir.audio.originalVolumeDb,
      music: music ?? ir.audio.music,
      speechRangesMs: speechRangesMs ?? ir.audio.speechRangesMs,
      sfx: ir.audio.sfx,
      voiceovers: ir.audio.voiceovers,
    ),
  );

  static EditIrClip _clip(
    EditIrClip c, {
    String? id,
    int? sourceStartMs,
    int? sourceEndMs,
    double? speed,
    double? volumeDb,
    EditIrCrop? crop,
    bool clearCrop = false,
    EditIrFilter? filter,
    bool clearFilter = false,
    EditIrTransition? transitionIn,
    bool clearTransition = false,
    int? rotationDeg,
    bool? flipH,
    int? audioFadeInMs,
    int? audioFadeOutMs,
    bool? voiceCleanup,
  }) => EditIrClip(
    id: id ?? c.id,
    assetId: c.assetId,
    sourceStartMs: sourceStartMs ?? c.sourceStartMs,
    sourceEndMs: sourceEndMs ?? c.sourceEndMs,
    timelineStartMs: c.timelineStartMs,
    timelineEndMs: c.timelineEndMs,
    speed: speed ?? c.speed,
    volumeDb: volumeDb ?? c.volumeDb,
    crop: clearCrop ? null : (crop ?? c.crop),
    filter: clearFilter ? null : (filter ?? c.filter),
    transitionIn: clearTransition ? null : (transitionIn ?? c.transitionIn),
    rotationDeg: rotationDeg ?? c.rotationDeg,
    flipH: flipH ?? c.flipH,
    audioFadeInMs: audioFadeInMs ?? c.audioFadeInMs,
    audioFadeOutMs: audioFadeOutMs ?? c.audioFadeOutMs,
    voiceCleanup: voiceCleanup ?? c.voiceCleanup,
    process: c.process,
  );

  static int clipIndexAt(MobileEditIr ir, int timelineMs) {
    for (var i = 0; i < ir.clips.length; i++) {
      if (timelineMs >= ir.clips[i].timelineStartMs &&
          timelineMs < ir.clips[i].timelineEndMs) {
        return i;
      }
    }
    return ir.clips.length - 1;
  }

  static Iterable<int> _targets(MobileEditIr ir, int? index) => index == null
      ? Iterable.generate(ir.clips.length)
      : [index.clamp(0, ir.clips.length - 1)];

  // ── Main track ─────────────────────────────────────────────────────────────

  /// Splits the clip under [timelineMs] into two at that point.
  static MobileEditIr split(MobileEditIr ir, int timelineMs) {
    final i = clipIndexAt(ir, timelineMs);
    final c = ir.clips[i];
    final at =
        c.sourceStartMs + ((timelineMs - c.timelineStartMs) * c.speed).round();
    if (at - c.sourceStartMs < minClipMs || c.sourceEndMs - at < minClipMs) {
      throw MediaEngineException(
        'INVALID_EDIT',
        'Move the playhead away from the clip edge to split.',
      );
    }
    final clips = [...ir.clips]
      ..replaceRange(i, i + 1, [
        _clip(c, sourceEndMs: at, audioFadeOutMs: 0),
        _clip(c, id: _id('c'), sourceStartMs: at, clearTransition: true, audioFadeInMs: 0),
      ]);
    return _replaceClips(ir, clips);
  }

  /// Source length recorded for a still: it can be stretched to any length a timeline needs.
  static const stillSourceMs = 600000;

  /// Freeze frame / photo clip: holds the still [assetId] for [durationMs] at [atMs] (splitting the clip there),
  /// with the look (crop, rotation, filter) of the clip it interrupts. Everything after moves later.
  static MobileEditIr insertStill(
    MobileEditIr ir, {
    required String assetId,
    required int atMs,
    required int durationMs,
    required int width,
    required int height,
  }) {
    if (durationMs < 300) throw MediaEngineException('INVALID_EDIT', 'A freeze frame needs at least 0.3 s.');
    var i = clipIndexAt(ir, atMs);
    var clips = ir.clips;
    var insertAt = i + 1;
    final c = clips[i];
    if (atMs - c.timelineStartMs < minClipMs) {
      insertAt = i; // at the very start of the clip: hold before it
    } else if (c.timelineEndMs - atMs >= minClipMs) {
      clips = split(ir, atMs).clips;
    }
    final look = clips[math.min(i, clips.length - 1)];
    final still = EditIrClip(
      id: _id('fz'),
      assetId: assetId,
      sourceStartMs: 0,
      sourceEndMs: durationMs,
      timelineStartMs: 0,
      timelineEndMs: durationMs,
      crop: look.crop,
      filter: look.filter,
      rotationDeg: look.rotationDeg,
      flipH: look.flipH,
    );
    final sources = [
      ...ir.sources,
      if (!ir.sources.any((s) => s.assetId == assetId)) EditIrSource(assetId: assetId, durationMs: stillSourceMs, width: width, height: height),
    ];
    return _replaceClips(ir.copyWith(sources: sources), [...clips]..insert(insertAt, still));
  }

  /// Inserts a copy of clip [index] right after it (same source, look and fades; no transition into the copy).
  /// Everything after moves later; captions and overlays stay with the original footage.
  static MobileEditIr duplicateClip(MobileEditIr ir, int index) {
    if (index < 0 || index >= ir.clips.length) throw MediaEngineException('INVALID_EDIT', 'No clip to duplicate.');
    final c = ir.clips[index];
    return _replaceClips(ir, [...ir.clips]..insert(index + 1, _clip(c, id: _id('c'), clearTransition: true)));
  }

  /// Ripple-deletes clip [index]; everything after moves up.
  static MobileEditIr deleteClip(MobileEditIr ir, int index) {
    if (ir.clips.length == 1) {
      throw MediaEngineException(
        'INVALID_EDIT',
        'This is the only clip. Trim it instead.',
      );
    }
    return _replaceClips(ir, [...ir.clips]..removeAt(index));
  }

  /// Ripple-deletes the timeline range [startMs, endMs) across the main track.
  static MobileEditIr removeRange(MobileEditIr ir, int startMs, int endMs) {
    final clips = <EditIrClip>[];
    for (final c in ir.clips) {
      if (endMs <= c.timelineStartMs || startMs >= c.timelineEndMs) {
        clips.add(c);
        continue;
      }
      final cutS =
          c.sourceStartMs +
          ((math.max(startMs, c.timelineStartMs) - c.timelineStartMs) * c.speed)
              .round();
      final cutE =
          c.sourceStartMs +
          ((math.min(endMs, c.timelineEndMs) - c.timelineStartMs) * c.speed)
              .round();
      if (cutS - c.sourceStartMs >= minClipMs) {
        clips.add(_clip(c, sourceEndMs: cutS));
      }
      if (c.sourceEndMs - cutE >= minClipMs) {
        clips.add(
          _clip(
            c,
            id: cutS - c.sourceStartMs >= minClipMs ? _id('c') : c.id,
            sourceStartMs: cutE,
          ),
        );
      }
    }
    if (clips.isEmpty) {
      throw MediaEngineException(
        'INVALID_EDIT',
        'That would remove the whole video.',
      );
    }
    return _replaceClips(ir, clips);
  }

  // ── One-tap cleanup from the transcript ────────────────────────────────────

  /// Default filler words / phrases for [removeFillers] ("you know" / "I mean" are only cut where the
  /// transcript has them; every occurrence is cut).
  static const defaultFillers = ['um', 'uh', 'uhm', 'umm', 'er', 'erm', 'ah', 'hmm', 'you know', 'i mean'];

  /// Cuts every pause between words longer than [minGapMs] (plus the silence before the first and after the last
  /// word), keeping [padMs] of air next to the words. Source-time [words]; works after splits and re-orders.
  static MobileEditIr removePauses(MobileEditIr ir, List<TranscriptWord> words, {int minGapMs = 500, int padMs = 100}) {
    if (words.isEmpty) throw MediaEngineException('NO_TRANSCRIPT', 'Removing pauses needs a transcript. Transcribe the video first.');
    final sorted = [...words]..sort((a, b) => a.startMs.compareTo(b.startMs));
    final cuts = <(int, int)>[];
    final srcEnd = ir.sources.isEmpty ? ir.durationMs : ir.sources.first.durationMs;
    if (sorted.first.startMs - padMs >= minGapMs ~/ 2) cuts.add((0, sorted.first.startMs - padMs));
    for (var i = 1; i < sorted.length; i++) {
      final gap = sorted[i].startMs - sorted[i - 1].endMs;
      if (gap >= minGapMs) cuts.add((sorted[i - 1].endMs + padMs, sorted[i].startMs - padMs));
    }
    if (srcEnd - sorted.last.endMs - padMs >= minGapMs ~/ 2) cuts.add((sorted.last.endMs + padMs, srcEnd));
    return _cutSourceRanges(ir, cuts, 'pause');
  }

  /// Cuts filler words / phrases ([fillers], case and punctuation ignored) found in the source-time [words].
  static MobileEditIr removeFillers(MobileEditIr ir, List<TranscriptWord> words, {List<String> fillers = defaultFillers}) {
    if (words.isEmpty) throw MediaEngineException('NO_TRANSCRIPT', 'Removing filler words needs a transcript. Transcribe the video first.');
    String norm(String w) => w.toLowerCase().replaceAll(RegExp(r"[^\p{L}\p{N}']", unicode: true), '');
    final sorted = [...words]..sort((a, b) => a.startMs.compareTo(b.startMs));
    final patterns = [for (final f in fillers) f.toLowerCase().split(RegExp(r'\s+')).map(norm).where((p) => p.isNotEmpty).toList()]
      ..removeWhere((p) => p.isEmpty)
      ..sort((a, b) => b.length.compareTo(a.length)); // longest phrase first
    final cuts = <(int, int)>[];
    for (var i = 0; i < sorted.length; i++) {
      for (final p in patterns) {
        if (i + p.length > sorted.length) continue;
        var ok = true;
        for (var k = 0; k < p.length && ok; k++) {
          ok = norm(sorted[i + k].text) == p[k];
        }
        if (!ok) continue;
        final last = sorted[i + p.length - 1];
        final next = i + p.length < sorted.length ? sorted[i + p.length].startMs : last.endMs;
        cuts.add((sorted[i].startMs, math.min(next, last.endMs + 150)));
        i += p.length - 1;
        break;
      }
    }
    if (cuts.isEmpty) throw MediaEngineException('NOTHING_TO_REMOVE', 'No filler words were found in the transcript.');
    return _cutSourceRanges(ir, cuts, 'filler');
  }

  /// Removes source-time ranges from the timeline wherever those moments play (any clip, any order). Cuts that
  /// leave less than 250 ms between them are joined so no sliver flashes on screen.
  static MobileEditIr _cutSourceRanges(MobileEditIr ir, List<(int, int)> source, String what) {
    final ranges = source.where((r) => r.$2 - r.$1 >= 40).toList()..sort((a, b) => a.$1.compareTo(b.$1));
    final merged = <(int, int)>[];
    for (final r in ranges) {
      if (merged.isNotEmpty && r.$1 - merged.last.$2 < 250) {
        merged[merged.length - 1] = (merged.last.$1, math.max(merged.last.$2, r.$2));
      } else {
        merged.add(r);
      }
    }
    final timeline = <(int, int)>[];
    for (final c in ir.clips.where((c) => c.assetId == 'primary')) {
      for (final r in merged) {
        final a = math.max(r.$1, c.sourceStartMs);
        final b = math.min(r.$2, c.sourceEndMs);
        if (b - a < 40) continue;
        timeline.add((
          c.timelineStartMs + ((a - c.sourceStartMs) / c.speed).round(),
          c.timelineStartMs + ((b - c.sourceStartMs) / c.speed).round(),
        ));
      }
    }
    if (timeline.isEmpty) throw MediaEngineException('NOTHING_TO_REMOVE', 'No ${what}s to remove in this edit.');
    timeline.sort((a, b) => b.$1.compareTo(a.$1)); // from the end, so earlier times stay valid
    var out = ir;
    final total = timeline.fold<int>(0, (s, r) => s + r.$2 - r.$1);
    if (total >= ir.durationMs - minClipMs) throw MediaEngineException('INVALID_EDIT', 'That would remove the whole video.');
    for (final r in timeline) {
      out = removeRange(out, r.$1, r.$2);
    }
    return out;
  }

  /// Sets the source in/out of clip [index] (bounded by the source length).
  static MobileEditIr trim(
    MobileEditIr ir,
    int index, {
    required int sourceStartMs,
    required int sourceEndMs,
  }) {
    final c = ir.clips[index];
    final srcLen =
        ir.sources
            .where((s) => s.assetId == c.assetId)
            .firstOrNull
            ?.durationMs ??
        c.sourceEndMs;
    final s = sourceStartMs.clamp(0, srcLen);
    final e = sourceEndMs.clamp(0, srcLen);
    if (e - s < minClipMs) {
      throw MediaEngineException(
        'INVALID_EDIT',
        'A clip must be at least ${minClipMs}ms long.',
      );
    }
    return _replaceClips(
      ir,
      [...ir.clips]..[index] = _clip(c, sourceStartMs: s, sourceEndMs: e),
    );
  }

  static MobileEditIr moveClip(MobileEditIr ir, int from, int to) {
    final clips = [...ir.clips];
    final c = clips.removeAt(from);
    clips.insert(to.clamp(0, clips.length), c);
    return _replaceClips(ir, clips);
  }

  /// Playback speed of clip [index], or of every clip when null. Range [0.25, 4].
  static MobileEditIr setSpeed(MobileEditIr ir, double speed, {int? index}) {
    final s = speed.clamp(0.25, 4.0);
    final targets = _targets(ir, index).toSet();
    return _replaceClips(ir, [
      for (var i = 0; i < ir.clips.length; i++)
        targets.contains(i) ? _clip(ir.clips[i], speed: s) : ir.clips[i],
    ]);
  }

  /// Clip audio gain in dB (≤ -60 mutes), for clip [index] or all clips.
  static MobileEditIr setClipVolume(MobileEditIr ir, double db, {int? index}) {
    final targets = _targets(ir, index).toSet();
    return _copy(
      ir,
      clips: [
        for (var i = 0; i < ir.clips.length; i++)
          targets.contains(i)
              ? _clip(ir.clips[i], volumeDb: db.clamp(-60.0, 12.0))
              : ir.clips[i],
      ],
    );
  }

  /// Gain (0..1) of clip [index]'s own sound [relMs] into the clip: volume × fade in × fade out. Mirrors
  /// `clipAudioProcessors` / `ClipAudioGainModel` in the Android renderer (fades = the longer of the clip's own fade and
  /// half the adjoining transition); the preview player cannot boost, so gain is capped at 1.
  static double clipPreviewGain(MobileEditIr ir, int index, int relMs) {
    final c = ir.clips[index];
    if (c.volumeDb <= -60 || ir.audio.originalVolumeDb <= -60) return 0;
    final dur = (c.timelineEndMs - c.timelineStartMs).toDouble();
    double half(EditIrTransition? t) => t == null || t.type == 'CUT' ? 0 : t.durationMs / 2;
    final fadeIn = math.max(half(c.transitionIn), c.audioFadeInMs.toDouble());
    final next = index + 1 < ir.clips.length ? ir.clips[index + 1] : null;
    final fadeOut = math.max(half(next?.transitionIn), c.audioFadeOutMs.toDouble());
    double ramp(double t, double a, double b) => b <= a ? (t >= a ? 1 : 0) : ((t - a) / (b - a)).clamp(0.0, 1.0);
    var g = math.pow(10, (c.volumeDb + ir.audio.originalVolumeDb) / 20).toDouble();
    if (fadeIn > 0) g *= ramp(relMs.toDouble(), 0, fadeIn);
    if (fadeOut > 0) g *= 1 - ramp(relMs.toDouble(), dur - fadeOut, dur);
    return g.clamp(0.0, 1.0);
  }

  /// Points clip [index] at a processed copy of its footage (reversed / background removed): same timeline slot,
  /// speed and look; only the file changes. The copy covers exactly the clip's old source range.
  static MobileEditIr replaceClipSource(MobileEditIr ir, int index, {required String assetId, required int durationMs, required int width, required int height}) {
    final c = ir.clips[index];
    final len = math.min(c.sourceEndMs - c.sourceStartMs, durationMs);
    final sources = [
      ...ir.sources.where((s) => s.assetId != assetId),
      EditIrSource(assetId: assetId, durationMs: durationMs, width: width, height: height),
    ];
    final clip = EditIrClip(
      id: c.id,
      assetId: assetId,
      sourceStartMs: 0,
      sourceEndMs: len,
      timelineStartMs: c.timelineStartMs,
      timelineEndMs: c.timelineStartMs + (len / c.speed).round(),
      speed: c.speed,
      volumeDb: c.volumeDb,
      crop: c.crop,
      filter: c.filter,
      transitionIn: c.transitionIn,
      // Frames are extracted upright like the original's display; the creator's own rotation still applies.
      rotationDeg: c.rotationDeg,
      flipH: c.flipH,
      audioFadeInMs: c.audioFadeInMs,
      audioFadeOutMs: c.audioFadeOutMs,
      voiceCleanup: c.voiceCleanup,
    );
    // Same length within a frame: everything else keeps its place.
    final clips = [...ir.clips]..[index] = clip;
    return ir.copyWith(sources: sources, clips: _relayout(clips), durationMs: _relayout(clips).last.timelineEndMs);
  }

  /// The crossfade layer on screen at [tMs], mirroring `crossfades` in the Android renderer: the incoming clip's
  /// footage from before its in-point fades in during [cut - d, cut]; without such footage the outgoing clip's
  /// footage after its out-point fades out during [cut, cut + d]. [isStill] tells photo clips apart (always enough
  /// footage). Null when no crossfade is drawn at [tMs].
  static ({int clipIndex, int sourceMs, double opacity})? crossfadeAt(MobileEditIr ir, int tMs, {bool Function(String assetId)? isStill}) {
    for (var i = 1; i < ir.clips.length; i++) {
      final a = ir.clips[i - 1], b = ir.clips[i];
      final tr = b.transitionIn;
      if (tr == null || !(tr.type == 'CROSSFADE' || tr.type == 'DISSOLVE' || !EditIrTransition.types.containsKey(tr.type))) continue;
      final cut = b.timelineStartMs;
      final d = math.min(tr.durationMs, math.min(a.timelineEndMs - a.timelineStartMs, b.timelineEndMs - b.timelineStartMs));
      if (d < 100 || tMs < cut - d || tMs >= cut + d) continue;
      final bStill = isStill?.call(b.assetId) ?? false;
      final aStill = isStill?.call(a.assetId) ?? false;
      final pre = bStill ? d : (b.sourceStartMs / b.speed).floor();
      final aDur = ir.sources.where((s) => s.assetId == a.assetId).firstOrNull?.durationMs ?? a.sourceEndMs;
      final post = aStill ? d : ((aDur - a.sourceEndMs) / a.speed).floor();
      if (pre >= 100) {
        final w = math.min(d, pre);
        if (tMs < cut - w || tMs >= cut) continue;
        final rel = tMs - (cut - w);
        return (clipIndex: i, sourceMs: bStill ? 0 : b.sourceStartMs - ((w - rel) * b.speed).round(), opacity: rel / w);
      }
      if (post >= 100) {
        final w = math.min(d, post);
        if (tMs < cut || tMs >= cut + w) continue;
        final rel = tMs - cut;
        return (clipIndex: i - 1, sourceMs: aStill ? 0 : a.sourceEndMs + (rel * a.speed).round(), opacity: 1 - rel / w);
      }
    }
    return null;
  }

  /// Speed-ramp presets: [share of the clip's source, speed] per part (same as SPEED_RAMP_PRESETS in the contract).
  static const speedRampPresets = <String, List<(double, double)>>{
    'montage': [(0.33, 2), (0.34, 1), (0.33, 2)],
    'hero': [(0.35, 1), (0.3, 0.4), (0.35, 1)],
    'bullet': [(0.4, 1), (0.2, 0.3), (0.4, 2)],
    'flash_in': [(0.25, 3), (0.75, 1)],
    'flash_out': [(0.75, 1), (0.25, 3)],
  };

  /// Splits clip [index] into the preset's parts, each at its own speed (relative to the clip's current speed).
  static MobileEditIr speedRamp(MobileEditIr ir, int index, String preset) {
    final shape = speedRampPresets[preset];
    if (shape == null) throw MediaEngineException('INVALID_EDIT', 'Unknown speed ramp "$preset".');
    final c = ir.clips[index];
    final len = c.sourceEndMs - c.sourceStartMs;
    if (len < shape.length * 400) throw MediaEngineException('INVALID_EDIT', 'This clip is too short for a speed ramp.');
    final parts = <EditIrClip>[];
    var at = c.sourceStartMs;
    for (var i = 0; i < shape.length; i++) {
      final end = i == shape.length - 1 ? c.sourceEndMs : at + (len * shape[i].$1).round();
      parts.add(_clip(
        c,
        id: i == 0 ? c.id : _id('c'),
        sourceStartMs: at,
        sourceEndMs: end,
        speed: (c.speed * shape[i].$2).clamp(0.25, 4.0),
        clearTransition: i > 0,
        audioFadeInMs: i == 0 ? c.audioFadeInMs : 0,
        audioFadeOutMs: i == shape.length - 1 ? c.audioFadeOutMs : 0,
      ));
      at = end;
    }
    return _replaceClips(ir, [...ir.clips]..replaceRange(index, index + 1, parts));
  }

  /// Turns "Reduce background noise" on or off for the clip(s)' own sound.
  static MobileEditIr setVoiceCleanup(MobileEditIr ir, bool on, {int? index}) {
    final targets = _targets(ir, index).toSet();
    return _copy(ir, clips: [for (var i = 0; i < ir.clips.length; i++) targets.contains(i) ? _clip(ir.clips[i], voiceCleanup: on) : ir.clips[i]]);
  }

  /// Fades the clip's own sound in / out (0 = off). Each fade is at most half the clip.
  static MobileEditIr setClipAudioFades(MobileEditIr ir, {required int fadeInMs, required int fadeOutMs, int? index}) {
    if (fadeInMs < 0 || fadeOutMs < 0) throw MediaEngineException('INVALID_EDIT', 'Fades cannot be negative.');
    final targets = _targets(ir, index).toSet();
    return _copy(
      ir,
      clips: [
        for (var i = 0; i < ir.clips.length; i++)
          if (targets.contains(i))
            () {
              final c = ir.clips[i];
              final half = (c.timelineEndMs - c.timelineStartMs) ~/ 2;
              return _clip(c, audioFadeInMs: math.min(fadeInMs, half), audioFadeOutMs: math.min(fadeOutMs, half));
            }()
          else
            ir.clips[i],
      ],
    );
  }

  static MobileEditIr setFilter(
    MobileEditIr ir,
    EditIrFilter? filter, {
    int? index,
  }) {
    final targets = _targets(ir, index).toSet();
    return _copy(
      ir,
      clips: [
        for (var i = 0; i < ir.clips.length; i++)
          targets.contains(i)
              ? _clip(ir.clips[i], filter: filter, clearFilter: filter == null)
              : ir.clips[i],
      ],
    );
  }

  /// Transition into clip [index] (≥ 1), or at every cut when null.
  static MobileEditIr setTransition(
    MobileEditIr ir,
    EditIrTransition? t, {
    int? index,
  }) {
    final targets = _targets(ir, index).where((i) => i > 0).toSet();
    return _copy(
      ir,
      clips: [
        for (var i = 0; i < ir.clips.length; i++)
          targets.contains(i)
              ? _clip(ir.clips[i], transitionIn: t, clearTransition: t == null)
              : ir.clips[i],
      ],
    );
  }

  /// Rotates clip [index] (or all clips) 90° clockwise and/or toggles horizontal flip.
  /// A 90/270 rotation swaps the effective source dimensions, so the crop is re-centred.
  static MobileEditIr rotate(
    MobileEditIr ir, {
    int? index,
    bool rotate90 = true,
    bool toggleFlip = false,
  }) {
    final targets = _targets(ir, index).toSet();
    return _copy(
      ir,
      clips: [
        for (var i = 0; i < ir.clips.length; i++)
          if (!targets.contains(i))
            ir.clips[i]
          else
            () {
              final c = ir.clips[i];
              final deg = rotate90 ? (c.rotationDeg + 90) % 360 : c.rotationDeg;
              final src = ir.sources
                  .where((s) => s.assetId == c.assetId)
                  .firstOrNull;
              final sideways = deg == 90 || deg == 270;
              final crop = src == null
                  ? c.crop
                  : centerCrop(
                      sideways ? src.height : src.width,
                      sideways ? src.width : src.height,
                      ir.canvas,
                    );
              return _clip(
                c,
                rotationDeg: deg,
                flipH: toggleFlip ? !c.flipH : c.flipH,
                crop: crop,
                clearCrop: crop == null,
              );
            }(),
      ],
    );
  }

  /// Normalized crop (source display coordinates) for clip [index] or all clips; null = fit.
  static MobileEditIr setCrop(MobileEditIr ir, EditIrCrop? crop, {int? index}) {
    if (crop != null &&
        (crop.x < 0 ||
            crop.y < 0 ||
            crop.width <= 0 ||
            crop.height <= 0 ||
            crop.x + crop.width > 1.0001 ||
            crop.y + crop.height > 1.0001)) {
      throw MediaEngineException(
        'INVALID_EDIT',
        'The crop must stay inside the frame.',
      );
    }
    final targets = _targets(ir, index).toSet();
    return _copy(
      ir,
      clips: [
        for (var i = 0; i < ir.clips.length; i++)
          targets.contains(i)
              ? _clip(ir.clips[i], crop: crop, clearCrop: crop == null)
              : ir.clips[i],
      ],
    );
  }

  /// Changes the output aspect. With [fill] every clip is cropped to fill the frame, centred on
  /// [focus] for the primary asset (the detected face) or the frame centre; otherwise the source
  /// is letterboxed on [background].
  static MobileEditIr setAspect(
    MobileEditIr ir,
    String aspect, {
    bool fill = true,
    String? background,
    ({double x, double y})? focus,
  }) {
    final canvas = canvasFor(
      aspect,
      fps: ir.canvas.fps,
      background: background ?? ir.canvas.background,
    );
    return _copy(
      ir,
      canvas: canvas,
      clips: [
        for (final c in ir.clips)
          () {
            final src = ir.sources
                .where((s) => s.assetId == c.assetId)
                .firstOrNull;
            final crop = fill && src != null
                ? centerCrop(
                    src.width,
                    src.height,
                    canvas,
                    focus: c.assetId == 'primary' ? focus : null,
                  )
                : null;
            return _clip(c, crop: crop, clearCrop: crop == null);
          }(),
      ],
    );
  }

  // ── Text & captions ────────────────────────────────────────────────────────

  /// Complete caption style objects (contract §3.4). The server rejects partial styles.
  /// [highlightColor] null keeps the preset's own highlight colour.
  static Map<String, dynamic> captionStyle(
    String preset, {
    String? highlightColor,
    double positionY = 0.72,
    double positionX = 0.5,
    double? fontSizePx,
  }) {
    final base = <String, dynamic>{
      'preset': preset,
      'animation': 'none',
      'fontFamily': 'Inter',
      'fontWeight': 800,
      'fontSizePx': 64,
      'textColor': '#FFFFFF',
      'highlightColor': '#FFE600',
      'strokeColor': '#000000',
      'strokeWidthPx': 6,
      'shadow': true,
      'background': null,
      'uppercase': false,
      'positionX': 0.5,
      'positionY': positionY,
      'maxWidthFraction': 0.86,
    };
    final style = switch (preset) {
      'BOLD_POP' => {
        ...base,
        'animation': 'word_pop',
        'fontSizePx': 72,
        'uppercase': true,
      },
      'KARAOKE' => {...base, 'animation': 'karaoke'},
      'BOXED' => {
        ...base,
        'strokeWidthPx': 0,
        'shadow': false,
        'fontWeight': 600,
        'background': {'color': '#000000B3', 'paddingPx': 16, 'radiusPx': 16},
      },
      'TITLE' => {...base, 'fontSizePx': 88, 'positionY': positionY, 'positionX': positionX},
      _ when viralCaptionPresets.containsKey(preset) => {
        ...base,
        ...viralCaptionPresets[preset]!.style,
        'preset': preset,
      },
      _ => {...base, 'preset': 'CLEAN', 'fontWeight': 600, 'strokeWidthPx': 4},
    };
    return {
      ...style,
      'highlightColor': ?highlightColor,
      'fontSizePx': ?fontSizePx,
    };
  }

  /// Creator templates: same ids and values as `CAPTION_TEMPLATES` in
  /// packages/video-contracts/src/caption-templates.ts (what the AI Director applies by name). The first
  /// eight also match `CAPTION_STYLE_PRESETS` in the desktop CaptionStudioModal.tsx. Font sizes and stroke
  /// widths are canvas pixels. `glow` is an optional style key: renderers that do not know it ignore it.
  static const viralCaptionPresets = <String, ({String name, String subtitle, Map<String, dynamic> style})>{
    'HORMOZI_BOUNCE': (
      name: 'Hormozi Viral',
      subtitle: 'Yellow / green bold',
      style: {
        'animation': 'word_pop', 'fontFamily': 'Anton', 'fontWeight': 400, 'fontSizePx': 52,
        'textColor': '#FACC15', 'highlightColor': '#22C55E', 'strokeWidthPx': 3, 'strokeColor': '#000000',
        'shadow': true, 'uppercase': true,
      },
    ),
    'MRBEAST_HYPE': (
      name: 'MrBeast Punch',
      subtitle: 'Red / white impact',
      style: {
        'animation': 'word_pop', 'fontFamily': 'Montserrat', 'fontWeight': 900, 'fontSizePx': 54,
        'textColor': '#FFFFFF', 'highlightColor': '#EF4444', 'strokeWidthPx': 4, 'strokeColor': '#000000',
        'shadow': true, 'uppercase': true,
      },
    ),
    'ALI_ABDAAL_CLEAN': (
      name: 'Abdaal Aesthetic',
      subtitle: 'Clean teal & white',
      style: {
        'animation': 'karaoke', 'fontFamily': 'Poppins', 'fontWeight': 600, 'fontSizePx': 44,
        'textColor': '#FFFFFF', 'highlightColor': '#14B8A6', 'strokeWidthPx': 0, 'shadow': true,
        'background': {'color': '#00000073', 'paddingPx': 6, 'radiusPx': 14},
      },
    ),
    'DAN_KOE_MINIMAL': (
      name: 'Dan Koe Clean',
      subtitle: 'Minimalist grotesque',
      style: {
        'animation': 'none', 'fontFamily': 'Syne', 'fontWeight': 700, 'fontSizePx': 40,
        'textColor': '#FFFFFF', 'highlightColor': '#94A3B8', 'strokeWidthPx': 0, 'shadow': false,
      },
    ),
    'CYBER_NEON': (
      name: 'Cyber Neon',
      subtitle: 'Cyan & magenta glow',
      style: {
        'animation': 'word_pop', 'fontFamily': 'Outfit', 'fontWeight': 800, 'fontSizePx': 48,
        'textColor': '#38BDF8', 'highlightColor': '#EC4899', 'strokeWidthPx': 1, 'strokeColor': '#0284C7',
        'shadow': false, 'glow': true,
      },
    ),
    'KARAOKE_FROSTED': (
      name: 'Frosted Pill',
      subtitle: 'Dark pill backdrop',
      style: {
        'animation': 'karaoke', 'fontFamily': 'Inter', 'fontWeight': 800, 'fontSizePx': 46,
        'textColor': '#FFFFFF', 'highlightColor': '#FBBF24', 'strokeWidthPx': 0, 'shadow': true,
        'background': {'color': '#0F172AD9', 'paddingPx': 10, 'radiusPx': 20},
      },
    ),
    'VOX_EXPLAINER': (
      name: 'Vox Explainer',
      subtitle: 'Yellow highlighter',
      style: {
        'animation': 'none', 'fontFamily': 'Roboto', 'fontWeight': 700, 'fontSizePx': 42,
        'textColor': '#0F172A', 'highlightColor': '#000000', 'strokeWidthPx': 0, 'shadow': false,
        'background': {'color': '#FACC15', 'paddingPx': 6, 'radiusPx': 6},
      },
    ),
    'CINEMATIC_SUBTITLE': (
      name: 'Cinema Subtitle',
      subtitle: 'Bebas Neue sans',
      style: {
        'animation': 'none', 'fontFamily': 'Bebas Neue', 'fontWeight': 400, 'fontSizePx': 48,
        'textColor': '#F8FAFC', 'highlightColor': '#F59E0B', 'strokeWidthPx': 1, 'strokeColor': '#0F172A',
        'shadow': true, 'uppercase': true,
      },
    ),
    'RAJ_SHAMANI_BOLD': (
      name: 'Shamani Bold',
      subtitle: 'White / yellow pop',
      style: {
        'animation': 'word_pop', 'fontFamily': 'Montserrat', 'fontWeight': 800, 'fontSizePx': 50,
        'textColor': '#FFFFFF', 'highlightColor': '#FFD60A', 'strokeWidthPx': 3, 'strokeColor': '#000000',
        'shadow': true,
      },
    ),
    'VARUN_MAYYA_BOX': (
      name: 'Mayya Box',
      subtitle: 'Box behind the spoken word',
      style: {
        'animation': 'word_box', 'fontFamily': 'Inter', 'fontWeight': 700, 'fontSizePx': 46,
        'textColor': '#FFFFFF', 'highlightColor': '#7C3AED', 'strokeWidthPx': 0, 'shadow': true,
      },
    ),
    'IMAN_GADZHI_LUXE': (
      name: 'Gadzhi Luxe',
      subtitle: 'Words appear as spoken',
      style: {
        'animation': 'word_reveal', 'fontFamily': 'Inter', 'fontWeight': 500, 'fontSizePx': 38,
        'textColor': '#FFFFFF', 'highlightColor': '#D4AF37', 'strokeWidthPx': 0, 'shadow': true,
      },
    ),
    'MUMBAI_BUBBLE': (
      name: 'Mumbai Bubble',
      subtitle: 'Rounded pill, orange box',
      style: {
        'animation': 'word_box', 'fontFamily': 'Baloo 2', 'fontWeight': 800, 'fontSizePx': 48,
        'textColor': '#FFFFFF', 'highlightColor': '#FF5A1F', 'strokeWidthPx': 0, 'shadow': false,
        'background': {'color': '#111827E6', 'paddingPx': 10, 'radiusPx': 22},
      },
    ),
    'ONE_WORD_PUNCH': (
      name: '1-Word Punch',
      subtitle: 'Big viral punch word',
      style: {
        'animation': 'word_pop', 'fontFamily': 'Montserrat', 'fontWeight': 900, 'fontSizePx': 60,
        'textColor': '#FFFFFF', 'highlightColor': '#F59E0B', 'strokeWidthPx': 5, 'strokeColor': '#000000',
        'shadow': true, 'uppercase': true,
      },
    ),
    'GOLDEN_LUXURY': (
      name: 'Golden Luxury',
      subtitle: 'Champagne gold high-end',
      style: {
        'animation': 'karaoke', 'fontFamily': 'Playfair Display', 'fontWeight': 700, 'fontSizePx': 46,
        'textColor': '#FFFBEB', 'highlightColor': '#F59E0B', 'strokeWidthPx': 2, 'strokeColor': '#78350F',
        'shadow': true,
        'background': {'color': '#1C1917E6', 'paddingPx': 8, 'radiusPx': 12},
      },
    ),
  };

  /// Every caption preset offered in the Captions sheet: the 4 classic ones, then the viral ones.
  static final captionPresets = <String, String>{
    'CLEAN': 'Clean',
    'BOLD_POP': 'Bold pop',
    'KARAOKE': 'Karaoke',
    'BOXED': 'Boxed',
    for (final e in viralCaptionPresets.entries) e.key: e.value.name,
  };

  /// Sentence-final punctuation across scripts (Latin, Devanagari danda, Arabic / Urdu, CJK).
  static final _sentenceEnd = RegExp(r'[.!?।॥؟۔。！？]$');

  /// Replaces the text of speech captions ([textById]: caption id → new text), e.g. after a translation.
  /// The new words share the caption's own time range in proportion to their length; its range, style and
  /// position do not change. Captions missing from [textById] are kept as they are.
  static MobileEditIr retextCaptions(MobileEditIr ir, Map<String, String> textById) {
    EditIrCaption retext(EditIrCaption c, String text) {
      final parts = text.trim().split(RegExp(r'\s+'));
      final pop = c.words.isEmpty
          ? (c.style['animation'] == 'word_pop' ? 1.15 : 1.0)
          : c.words.map((w) => w.scale).reduce(math.max);
      final total = parts.fold<int>(0, (n, p) => n + p.runes.length);
      final span = c.endMs - c.startMs;
      final words = <EditIrWord>[];
      var done = 0;
      // A correction with the same number of words keeps every word's own timing and emphasis.
      if (parts.length == c.words.length) {
        for (final (i, w) in c.words.indexed) {
          words.add(EditIrWord(text: parts[i], startMs: w.startMs, endMs: w.endMs, highlight: w.highlight, color: w.color, scale: w.scale));
        }
        parts.clear();
      }
      for (final p in parts) {
        final s = math.min(c.startMs + (span * done / total).round(), c.endMs - 1);
        done += p.runes.length;
        final e = c.startMs + (span * done / total).round();
        words.add(EditIrWord(text: p, startMs: s, endMs: e.clamp(s + 1, c.endMs), scale: pop));
      }
      final newText = words.map((w) => w.text).join(' ');
      return EditIrCaption(id: c.id, startMs: c.startMs, endMs: c.endMs, text: newText, words: words, style: _fontFitted(c.style, newText));
    }

    return _copy(
      ir,
      captions: [
        for (final c in ir.captions)
          c.kind == 'caption' && (textById[c.id]?.trim().isNotEmpty ?? false) ? retext(c, textById[c.id]!) : c,
      ],
    );
  }

  /// [style] with a font family that covers the script of [text] (Hindi, Tamil, … get their Noto Sans family).
  static Map<String, dynamic> _fontFitted(Map<String, dynamic> style, String text) {
    final current = style['fontFamily'] as String? ?? 'Inter';
    final fitted = CaptionTools.fontFor(text, current);
    return fitted == current ? style : {...style, 'fontFamily': fitted};
  }

  /// Marks one key word per speech caption as highlighted (a number, else its longest content word).
  /// Captions that already have an emphasised word are left alone, so running it again changes nothing.
  static MobileEditIr enhanceCaptions(MobileEditIr ir) {
    EditIrCaption enhance(EditIrCaption c) {
      if (c.kind != 'caption' || c.words.isEmpty) return c;
      var words = c.words;
      if (!words.any((w) => w.highlight)) {
        final k = CaptionTools.keywordIndex([for (final w in words) w.text]);
        if (k != null) {
          words = [
            for (final (i, w) in words.indexed)
              i == k ? EditIrWord(text: w.text, startMs: w.startMs, endMs: w.endMs, highlight: true, color: w.color, scale: w.scale) : w,
          ];
        }
      }
      if (identical(words, c.words)) return c;
      return EditIrCaption(id: c.id, startMs: c.startMs, endMs: c.endMs, text: words.map((w) => w.text).join(' '), words: words, style: c.style);
    }

    return _copy(ir, captions: [for (final c in ir.captions) enhance(c)]);
  }

  /// Word-synced captions from a source-time transcript, [wordsPerCaption] words each, breaking
  /// early on pauses and sentence ends. Replaces existing speech captions; titles are kept.
  static MobileEditIr autoCaptions(
    MobileEditIr ir,
    List<TranscriptWord> words, {
    String preset = 'BOLD_POP',
    int wordsPerCaption = 3,
    String? highlightColor,
    double positionY = 0.72,
    double? fontSizePx,
  }) {
    if (words.isEmpty) {
      throw MediaEngineException(
        'NO_TRANSCRIPT',
        'Captions need a transcript. Transcribe the video first.',
      );
    }
    final style = _fontFitted(
      captionStyle(preset, highlightColor: highlightColor, positionY: positionY, fontSizePx: fontSizePx),
      words.map((w) => w.text).join(' '),
    );
    // The spoken word grows a little in word_pop styles (same 1.15 as the AI Director's captions).
    final pop = style['animation'] == 'word_pop' ? 1.15 : 1.0;
    final mapped = <EditIrWord>[];
    for (final w in words) {
      final s = sourceToTimeline(ir, w.startMs);
      if (s == null) continue;
      var e = sourceToTimeline(ir, math.max(w.startMs, w.endMs - 1)) ?? s;
      // A word that straddles a cut (or a re-ordered clip) ends where its own clip ends.
      if (e < s || e - s > w.endMs - w.startMs + 50) {
        final clip = ir.clips[clipIndexAt(ir, s)];
        e = math.min(clip.timelineEndMs - 1, s + math.max(1, w.endMs - w.startMs));
      }
      mapped.add(
        EditIrWord(text: w.text, startMs: s, endMs: math.max(e + 1, s + 1), scale: pop),
      );
    }
    // Clips can be re-ordered, so source order is not timeline order.
    mapped.sort((a, b) => a.startMs.compareTo(b.startMs));
    final captions = <EditIrCaption>[];
    var group = <EditIrWord>[];
    void flush() {
      if (group.isEmpty) return;
      captions.add(
        EditIrCaption(
          id: _id('cap'),
          startMs: group.first.startMs,
          endMs: group.last.endMs,
          text: group.map((w) => w.text).join(' '),
          words: group,
          style: style,
        ),
      );
      group = [];
    }

    for (final w in mapped) {
      final gap = group.isEmpty ? 0 : w.startMs - group.last.endMs;
      if (group.length >= wordsPerCaption || gap > 600 || gap < 0) flush();
      group.add(w);
      if (_sentenceEnd.hasMatch(w.text)) flush();
    }
    flush();
    // Captions must not overlap each other.
    for (var i = 0; i < captions.length - 1; i++) {
      final a = captions[i], b = captions[i + 1];
      if (a.endMs > b.startMs) {
        captions[i] = EditIrCaption(
          id: a.id,
          startMs: a.startMs,
          endMs: b.startMs,
          text: a.text,
          words: [
            for (final w in a.words)
              EditIrWord(
                text: w.text,
                startMs: w.startMs,
                endMs: math.min(w.endMs, b.startMs),
                highlight: w.highlight,
                color: w.color,
                scale: w.scale,
              ),
          ],
          style: a.style,
        );
      }
    }
    return _copy(
      ir,
      captions: [...ir.captions.where((c) => c.kind == 'text'), ...captions.where((c) => c.endMs > c.startMs)]
        ..sort((a, b) => a.startMs.compareTo(b.startMs)),
    );
  }

  /// Restyles every speech caption.
  static MobileEditIr styleCaptions(
    MobileEditIr ir,
    String preset, {
    String? highlightColor,
    double? positionY,
    double? fontSizePx,
  }) {
    final style = _fontFitted(
      captionStyle(preset, highlightColor: highlightColor, positionY: positionY ?? 0.72, fontSizePx: fontSizePx),
      [for (final c in ir.captions) if (c.kind == 'caption') c.text].join(' '),
    );
    return _copy(
      ir,
      captions: [
        for (final c in ir.captions)
          c.kind == 'caption'
              ? EditIrCaption(
                  id: c.id,
                  startMs: c.startMs,
                  endMs: c.endMs,
                  text: c.text,
                  // Switching to / from a word_pop style turns the spoken-word pop on / off.
                  words: [
                    for (final w in c.words)
                      EditIrWord(text: w.text, startMs: w.startMs, endMs: w.endMs, highlight: w.highlight, color: w.color,
                          scale: style['animation'] == 'word_pop' ? (w.scale > 1 ? w.scale : 1.15) : 1.0),
                  ],
                  style: style,
                )
              : c,
      ],
    );
  }

  /// A title / lower third from [startMs] for [durationMs].
  static MobileEditIr addText(
    MobileEditIr ir,
    String text, {
    required int startMs,
    required int durationMs,
    double positionY = 0.2,
    double positionX = 0.5,
    Map<String, dynamic>? style,
  }) {
    final t = text.trim();
    if (t.isEmpty) {
      throw MediaEngineException('INVALID_EDIT', 'Type some text first.');
    }
    final s = startMs.clamp(0, math.max(0, ir.durationMs - minClipMs)).toInt();
    final e = math.min(ir.durationMs, s + math.max(durationMs, 300)).toInt();
    final cap = EditIrCaption(
      id: _id('txt'),
      kind: 'text',
      startMs: s,
      endMs: e,
      text: t,
      words: [EditIrWord(text: t, startMs: s, endMs: e)],
      style: style ?? captionStyle('TITLE', positionY: positionY, positionX: positionX),
    );
    return _copy(
      ir,
      captions: [...ir.captions, cap]
        ..sort((a, b) => a.startMs.compareTo(b.startMs)),
    );
  }

  static MobileEditIr removeCaption(MobileEditIr ir, String id) =>
      _copy(ir, captions: ir.captions.where((c) => c.id != id).toList());

  static MobileEditIr clearCaptions(MobileEditIr ir) =>
      _copy(ir, captions: ir.captions.where((c) => c.kind == 'text').toList());

  // ── Camera ─────────────────────────────────────────────────────────────────

  /// Punch-in zoom; rejected if it would overlap another zoom.
  static MobileEditIr addZoom(
    MobileEditIr ir, {
    required int startMs,
    int durationMs = 1500,
    double scale = 1.3,
    double centerX = 0.5,
    double centerY = 0.45,
  }) {
    final s = startMs.clamp(0, math.max(0, ir.durationMs - 300)).toInt();
    final e = math.min(ir.durationMs, s + math.max(durationMs, 300)).toInt();
    if (ir.zooms.any((z) => s < z.endMs && e > z.startMs)) {
      throw MediaEngineException(
        'INVALID_EDIT',
        'There is already a zoom here.',
      );
    }
    final z = EditIrZoom(
      id: _id('z'),
      startMs: s,
      endMs: e,
      scale: scale.clamp(1.0, 4.0),
      centerX: centerX,
      centerY: centerY,
      rampMs: math.min(250, (e - s) ~/ 2),
    );
    return _copy(
      ir,
      zooms: [...ir.zooms, z]..sort((a, b) => a.startMs.compareTo(b.startMs)),
    );
  }

  static MobileEditIr removeZoom(MobileEditIr ir, String id) =>
      _copy(ir, zooms: ir.zooms.where((z) => z.id != id).toList());

  // ── B-roll ─────────────────────────────────────────────────────────────────

  /// B-roll over [startMs, startMs+durationMs). [source] is `{kind:url,url}` or `{kind:asset,assetId}`.
  static MobileEditIr addBroll(
    MobileEditIr ir,
    Map<String, dynamic> source, {
    required int startMs,
    int durationMs = 3000,
    bool image = false,
  }) {
    final s = startMs.clamp(0, math.max(0, ir.durationMs - 300)).toInt();
    final e = math.min(ir.durationMs, s + math.max(durationMs, 300)).toInt();
    final o = EditIrOverlay(
      id: _id('b'),
      timelineStartMs: s,
      timelineEndMs: e,
      source: source,
      mediaType: image ? 'image' : 'video',
    );
    return _copy(
      ir,
      overlays: [...ir.overlays, o]
        ..sort((a, b) => a.timelineStartMs.compareTo(b.timelineStartMs)),
    );
  }

  /// Sticker spots (canvas fractions): upper corners, then mid sides (captions sit lower). Same as the contracts'
  /// `STICKER_SPOTS`, so manual and Director stickers land in the same places.
  static const stickerSpots = [(x: 0.74, y: 0.22), (x: 0.26, y: 0.22), (x: 0.78, y: 0.46), (x: 0.22, y: 0.46)];

  /// The sticker spot farthest from [face] (canvas fractions); the upper right without a face.
  static ({double x, double y}) stickerSpotAwayFrom(({double x, double y})? face) {
    if (face == null) return stickerSpots.first;
    var best = stickerSpots.first;
    var bestD = -1.0;
    for (final p in stickerSpots) {
      final d = math.pow(p.x - face.x, 2) + math.pow(p.y - face.y, 2);
      if (d > bestD + 1e-9) {
        best = p;
        bestD = d.toDouble();
      }
    }
    return best;
  }

  /// Where the speaker's face is on the canvas at [timelineMs] (canvas fractions), from the face track (source
  /// fractions) mapped through that clip's crop. Null without a face sample within 1.5 s or off-canvas.
  static ({double x, double y})? faceOnCanvas(MobileEditIr ir, List<FaceSample>? faces, int timelineMs) {
    if (faces == null || faces.isEmpty || ir.clips.isEmpty) return null;
    final c = ir.clips[clipIndexAt(ir, timelineMs)];
    final srcMs = c.sourceStartMs + ((timelineMs - c.timelineStartMs) * c.speed).round();
    FaceSample? near;
    for (final f in faces) {
      if ((f.tMs - srcMs).abs() <= 1500 && (near == null || (f.tMs - srcMs).abs() < (near.tMs - srcMs).abs())) near = f;
    }
    if (near == null) return null;
    final crop = c.crop;
    final x = crop == null ? near.x : (near.x - crop.x) / crop.width;
    final y = crop == null ? near.y : (near.y - crop.y) / crop.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return (x: x, y: y);
  }

  /// A sticker: a transparent image floating above the video (a quarter size, pops in), in the spot farthest from
  /// the speaker's face ([avoidFace], canvas fractions; upper right without one).
  static MobileEditIr addSticker(MobileEditIr ir, Map<String, dynamic> source,
      {required int startMs, int durationMs = 2500, ({double x, double y})? avoidFace}) {
    final s = startMs.clamp(0, math.max(0, ir.durationMs - 300)).toInt();
    final e = math.min(ir.durationMs, s + math.max(durationMs, 300)).toInt();
    final spot = stickerSpotAwayFrom(avoidFace);
    final base = EditIrLayer(x: spot.x, y: spot.y, scale: 0.26);
    final o = EditIrOverlay(
      id: _id('st'),
      timelineStartMs: s,
      timelineEndMs: e,
      source: source,
      mediaType: 'image',
      fit: 'contain',
      layer: base.copyWith(keyframes: layerEntrance(base, 'zoom_in', durationMs: 300)),
    );
    return _copy(ir, overlays: [...ir.overlays, o]..sort((a, b) => a.timelineStartMs.compareTo(b.timelineStartMs)));
  }

  static MobileEditIr clearOverlayProcess(MobileEditIr ir, String id) =>
      _copy(ir, overlays: [for (final o in ir.overlays) o.id == id ? o.copyWith(clearProcess: true) : o]);

  static MobileEditIr clearClipProcess(MobileEditIr ir, int index) {
    final c = ir.clips[index];
    final cleared = EditIrClip.fromJson({...c.toJson()}..remove('process'));
    return _copy(ir, clips: [...ir.clips]..[index] = cleared);
  }

  /// Replaces an overlay's whole source (a processed copy) — unlike `sourceUpdates`, old keys are not kept.
  static MobileEditIr replaceOverlaySource(MobileEditIr ir, String id, Map<String, dynamic> source) =>
      _copy(ir, overlays: [for (final o in ir.overlays) o.id == id ? o.copyWith(source: source) : o]);

  static MobileEditIr removeOverlay(MobileEditIr ir, String id) =>
      _copy(ir, overlays: ir.overlays.where((o) => o.id != id).toList());

  /// Updates overlay properties: muted, opacity, fit, crop, pip, volume, etc.
  static MobileEditIr updateOverlay(
    MobileEditIr ir,
    String id, {
    bool? muted,
    double? opacity,
    Map<String, dynamic>? sourceUpdates,
    int? sourceStartMs,
    String? fit,
    EditIrLayer? layer,
    bool clearLayer = false,
    EditIrChromaKey? chromaKey,
    bool clearChromaKey = false,
    EditIrMask? mask,
    bool clearMask = false,
  }) {
    if (!ir.overlays.any((o) => o.id == id)) throw MediaEngineException('INVALID_EDIT', 'That overlay no longer exists.');
    if (opacity != null && (opacity < 0 || opacity > 1)) throw MediaEngineException('INVALID_EDIT', 'Opacity must be between 0 and 100%.');
    if (fit != null && fit != 'cover' && fit != 'contain') throw MediaEngineException('INVALID_EDIT', 'Unknown fit "$fit".');
    final overlays = ir.overlays.map((o) {
      if (o.id != id) return o;
      return o.copyWith(
        source: sourceUpdates == null ? null : {...o.source, ...sourceUpdates},
        sourceStartMs: sourceStartMs,
        opacity: opacity,
        muted: muted,
        fit: fit,
        layer: layer,
        clearLayer: clearLayer,
        chromaKey: chromaKey,
        // A full-screen cutaway replaces the picture, so a key there would show black: keying keeps it a layer.
        clearChromaKey: clearChromaKey || (clearLayer && chromaKey == null),
        mask: mask,
        // Shapes apply to floating layers only.
        clearMask: clearMask || (clearLayer && mask == null),
      );
    }).toList();
    return _copy(ir, overlays: overlays);
  }

  /// Keyframes closer than this to the playhead are "the keyframe at the playhead" (edited, not duplicated).
  static const keyframeSnapMs = 40;

  /// [layer] with [k] added, replacing any keyframe within [keyframeSnapMs] of it.
  static EditIrLayer withKeyframe(EditIrLayer layer, LayerKeyframe k) => layer.copyWith(
        keyframes: [
          for (final e in layer.keyframes)
            if ((e.atMs - k.atMs).abs() > keyframeSnapMs) e,
          k,
        ]..sort((a, b) => a.atMs.compareTo(b.atMs)),
      );

  /// CapCut "add keyframe": records the layer's current pose (position, size, rotation, opacity) at the playhead.
  static MobileEditIr setLayerKeyframe(MobileEditIr ir, String id, int playheadMs, {double? x, double? y, double? scale, double? rotation, double? opacity}) {
    final o = ir.overlays.where((o) => o.id == id).firstOrNull;
    final layer = o?.layer;
    if (o == null || layer == null) throw MediaEngineException('INVALID_EDIT', 'Keyframes need a picture-in-picture or sticker layer.');
    final rel = playheadMs - o.timelineStartMs;
    if (rel < 0 || playheadMs > o.timelineEndMs) throw MediaEngineException('INVALID_EDIT', 'Move the playhead inside this overlay to add a keyframe.');
    final pose = layerAt(layer, rel, o.opacity);
    final k = LayerKeyframe(
      atMs: rel,
      x: x ?? pose.x,
      y: y ?? pose.y,
      scale: scale ?? pose.scale,
      rotation: rotation ?? pose.rotation,
      opacity: opacity ?? pose.opacity,
    );
    return updateOverlay(ir, id, layer: withKeyframe(layer, k));
  }

  static MobileEditIr removeLayerKeyframe(MobileEditIr ir, String id, int atMs) {
    final layer = ir.overlays.where((o) => o.id == id).firstOrNull?.layer;
    if (layer == null) return ir;
    return updateOverlay(ir, id, layer: layer.copyWith(keyframes: [for (final k in layer.keyframes) if (k.atMs != atMs) k]));
  }

  /// Entrance animations for a layer, as keyframes relative to the overlay start (CapCut "In" animations).
  static List<LayerKeyframe> layerEntrance(EditIrLayer layer, String kind, {int durationMs = 400}) {
    switch (kind) {
      case 'zoom_in':
        return [LayerKeyframe(atMs: 0, scale: layer.scale * 0.2, opacity: 0), LayerKeyframe(atMs: durationMs, scale: layer.scale, opacity: 1)];
      case 'slide_left':
        return [LayerKeyframe(atMs: 0, x: layer.x + 0.6), LayerKeyframe(atMs: durationMs, x: layer.x)];
      case 'slide_up':
        return [LayerKeyframe(atMs: 0, y: layer.y + 0.5), LayerKeyframe(atMs: durationMs, y: layer.y)];
      case 'fade':
        return [LayerKeyframe(atMs: 0, opacity: 0), LayerKeyframe(atMs: durationMs, opacity: 1)];
      case 'spin':
        return [LayerKeyframe(atMs: 0, rotation: layer.rotation - 180, scale: layer.scale * 0.3), LayerKeyframe(atMs: durationMs, rotation: layer.rotation, scale: layer.scale)];
      default:
        return const [];
    }
  }

  /// Adds a new video clip to the main timeline track (e.g. at the start as an intro or appended at the end).
  static MobileEditIr addTimelineClip(
    MobileEditIr ir, {
    required String assetId,
    required int durationMs,
    int width = 1080,
    int height = 1920,
    bool prepend = false,
    int? atIndex,
  }) {
    final clip = EditIrClip(
      id: _id('c'),
      assetId: assetId,
      sourceStartMs: 0,
      sourceEndMs: durationMs,
      timelineStartMs: 0,
      timelineEndMs: durationMs,
    );
    final clips = [...ir.clips];
    if (prepend) {
      clips.insert(0, clip);
    } else if (atIndex != null) {
      clips.insert(atIndex.clamp(0, clips.length), clip);
    } else {
      clips.add(clip);
    }
    final sources = [...ir.sources];
    if (!sources.any((s) => s.assetId == assetId)) {
      sources.add(EditIrSource(
        assetId: assetId,
        durationMs: durationMs,
        width: width,
        height: height,
      ));
    }
    final nextIr = ir.copyWith(sources: sources);
    return _replaceClips(nextIr, clips);
  }

  /// Updates caption position (positionX, positionY in normalized 0.05..0.95 coordinates).
  static MobileEditIr updateCaptionPosition(
    MobileEditIr ir,
    String captionId, {
    required double positionX,
    required double positionY,
  }) {
    final captions = ir.captions.map((c) {
      if (c.id != captionId) return c;
      final st = Map<String, dynamic>.from(c.style);
      st['positionX'] = positionX.clamp(0.05, 0.95);
      st['positionY'] = positionY.clamp(0.05, 0.95);
      return EditIrCaption(
        id: c.id,
        kind: c.kind,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
        words: c.words,
        style: st,
      );
    }).toList();
    return _copy(ir, captions: captions);
  }

  // ── Audio ──────────────────────────────────────────────────────────────────

  static MobileEditIr setOriginalVolume(MobileEditIr ir, double db) =>
      _withAudio(ir, originalVolumeDb: db.clamp(-60.0, 12.0));

  /// Background music under the whole video from an HTTPS [url] or local file path.
  static MobileEditIr setMusic(
    MobileEditIr ir, {
    required String url,
    String? title,
    double volumeDb = -16,
    int fadeInMs = 500,
    int fadeOutMs = 1000,
    bool duckUnderSpeech = true,
  }) {
    final uri = Uri.tryParse(url);
    final isHttp = uri != null && (uri.isScheme('https') || uri.isScheme('http'));
    final isLocal = url.startsWith('/') || url.contains(':\\') || url.startsWith('file://');
    if (!isHttp && !isLocal) {
      throw MediaEngineException('INVALID_EDIT', 'Music must be a valid file or URL.');
    }
    final m = EditIrMusic(
      id: ir.audio.music.firstOrNull?.id ?? _id('m'),
      timelineStartMs: 0,
      timelineEndMs: ir.durationMs,
      source: isHttp ? {'kind': 'url', 'url': url, 'query': ?title} : {'kind': 'file', 'path': url, 'query': ?title},
      volumeDb: volumeDb,
      fadeInMs: fadeInMs,
      fadeOutMs: fadeOutMs,
      duck: EditIrDuck(
        enabled: duckUnderSpeech && ir.audio.speechRangesMs.isNotEmpty,
      ),
    );
    return _withAudio(ir, music: [m]);
  }

  static MobileEditIr updateMusic(
    MobileEditIr ir, {
    double? volumeDb,
    int? fadeInMs,
    int? fadeOutMs,
    bool? duck,
  }) {
    final m = ir.audio.music.firstOrNull;
    if (m == null) {
      throw MediaEngineException('INVALID_EDIT', 'Add music first.');
    }
    return _withAudio(
      ir,
      music: [
        _music(
          m,
          volumeDb: volumeDb,
          fadeInMs: fadeInMs,
          fadeOutMs: fadeOutMs,
          duck: duck == null
              ? null
              : EditIrDuck(enabled: duck && ir.audio.speechRangesMs.isNotEmpty),
        ),
      ],
    );
  }

  static MobileEditIr removeMusic(MobileEditIr ir) =>
      _withAudio(ir, music: []);

  // ── Sound effects ──────────────────────────────────────────────────────────

  static const maxSfx = 40;

  /// One-shot sound effect at [startMs] from an HTTPS [url] or local file. [credit] is kept for export attribution.
  static MobileEditIr addSfx(
    MobileEditIr ir, {
    required String url,
    required int startMs,
    int? durationMs,
    double volumeDb = -8,
    String? credit,
    String? name,
  }) {
    final isHttp = url.startsWith('https://') || url.startsWith('http://');
    final isLocal = url.startsWith('/') || url.contains(':\\') || url.startsWith('file://');
    if (!isHttp && !isLocal) {
      throw MediaEngineException('INVALID_EDIT', 'Sound effect audio source is invalid.');
    }
    if (ir.audio.sfx.length >= maxSfx) {
      throw MediaEngineException('INVALID_EDIT', 'This video already has $maxSfx sound effects.');
    }
    final s = startMs.clamp(0, math.max(0, ir.durationMs - 100)).toInt();
    final e = EditIrSfx(
      id: _id('sfx'),
      timelineStartMs: s,
      durationMs: durationMs == null ? null : math.max(100, math.min(durationMs, ir.durationMs - s)),
      source: isHttp ? {'kind': 'url', 'url': url} : {'kind': 'file', 'path': url},
      volumeDb: volumeDb.clamp(-60.0, 12.0),
      credit: credit ?? name,
    );
    return _withSfx(ir, [...ir.audio.sfx, e]..sort((a, b) => a.timelineStartMs.compareTo(b.timelineStartMs)));
  }

  static MobileEditIr setSfxVolume(MobileEditIr ir, String id, double db) => _withSfx(ir, [
        for (final e in ir.audio.sfx)
          e.id == id
              ? EditIrSfx(id: e.id, timelineStartMs: e.timelineStartMs, durationMs: e.durationMs, source: e.source, volumeDb: db.clamp(-60.0, 12.0), credit: e.credit)
              : e,
      ]);

  static MobileEditIr removeSfx(MobileEditIr ir, String id) =>
      _withSfx(ir, ir.audio.sfx.where((e) => e.id != id).toList());

  static MobileEditIr _withSfx(MobileEditIr ir, List<EditIrSfx> sfx) => _copy(
        ir,
        audio: EditIrAudio(
          originalVolumeDb: ir.audio.originalVolumeDb,
          music: ir.audio.music,
          speechRangesMs: ir.audio.speechRangesMs,
          sfx: sfx,
          voiceovers: ir.audio.voiceovers,
        ),
      );

  static MobileEditIr _withVoiceovers(MobileEditIr ir, List<EditIrVoiceover> voiceovers) => _copy(
        ir,
        audio: EditIrAudio(
          originalVolumeDb: ir.audio.originalVolumeDb,
          music: ir.audio.music,
          speechRangesMs: ir.audio.speechRangesMs,
          sfx: ir.audio.sfx,
          voiceovers: [...voiceovers]..sort((a, b) => a.timelineStartMs.compareTo(b.timelineStartMs)),
        ),
      );

  /// Places a recording at [atMs] (clipped to the video end). Voiceovers may overlap each other.
  static MobileEditIr addVoiceover(MobileEditIr ir, {required String assetId, required int atMs, required int durationMs}) {
    final start = atMs.clamp(0, math.max(0, ir.durationMs - minClipMs)).toInt();
    final len = math.min(durationMs, ir.durationMs - start);
    if (len < 300) throw MediaEngineException('INVALID_EDIT', 'Move the playhead earlier: the voiceover needs at least 0.3 s before the end.');
    return _withVoiceovers(ir, [
      ...ir.audio.voiceovers,
      EditIrVoiceover(id: _id('vo'), assetId: assetId, timelineStartMs: start, durationMs: len, fadeInMs: 80, fadeOutMs: 120),
    ]);
  }

  static MobileEditIr updateVoiceover(MobileEditIr ir, String id, {double? volumeDb, int? fadeInMs, int? fadeOutMs}) {
    if (!ir.audio.voiceovers.any((v) => v.id == id)) throw MediaEngineException('INVALID_EDIT', 'That voiceover is no longer on the timeline.');
    return _withVoiceovers(ir, [
      for (final v in ir.audio.voiceovers)
        v.id == id ? v.copyWith(volumeDb: volumeDb?.clamp(-60.0, 12.0), fadeInMs: fadeInMs, fadeOutMs: fadeOutMs) : v,
    ]);
  }

  static MobileEditIr removeVoiceover(MobileEditIr ir, String id) =>
      _withVoiceovers(ir, [for (final v in ir.audio.voiceovers) if (v.id != id) v]);

  // ── Track mute (Voice = original audio, Music, Sound FX) ───────────────────

  /// Volume that counts as muted (the contract's minimum gain).
  static const mutedDb = -60.0;

  /// Tracks that have a mute toggle on the timeline.
  static const mutableTracks = {TrackKind.voice, TrackKind.music, TrackKind.sfx};

  /// Current gain of every item on an audio track, keyed by item id (`original` for the voice track).
  static Map<String, double> trackVolumes(MobileEditIr ir, TrackKind kind) => switch (kind) {
        TrackKind.voice => {'original': ir.audio.originalVolumeDb},
        TrackKind.music => {for (final m in ir.audio.music) m.id: m.volumeDb},
        TrackKind.sfx => {for (final e in ir.audio.sfx) e.id: e.volumeDb},
        _ => {},
      };

  /// True when every item on the track is at [mutedDb] (and the track has items).
  static bool isTrackMuted(MobileEditIr ir, TrackKind kind) {
    final v = trackVolumes(ir, kind).values;
    return v.isNotEmpty && v.every((db) => db <= mutedDb);
  }

  /// Mutes a track (every item to [mutedDb]) or unmutes it, restoring each item to [restoreDb] (the
  /// volumes captured with [trackVolumes] before muting) or, when unknown, to a sensible default.
  static MobileEditIr setTrackMuted(
    MobileEditIr ir,
    TrackKind kind,
    bool muted, {
    Map<String, double> restoreDb = const {},
  }) {
    double target(String id, double fallback) {
      if (muted) return mutedDb;
      final r = restoreDb[id];
      return r != null && r > mutedDb ? r : fallback;
    }

    switch (kind) {
      case TrackKind.voice:
        return setOriginalVolume(ir, target('original', 0));
      case TrackKind.music:
        return _withAudio(ir, music: [for (final m in ir.audio.music) _music(m, volumeDb: target(m.id, -16))]);
      case TrackKind.sfx:
        return _withSfx(ir, [
          for (final e in ir.audio.sfx)
            EditIrSfx(
              id: e.id,
              timelineStartMs: e.timelineStartMs,
              durationMs: e.durationMs,
              source: e.source,
              volumeDb: target(e.id, -8),
              credit: e.credit,
            ),
        ]);
      default:
        throw MediaEngineException('INVALID_EDIT', '${kind.label} has no audio to mute.');
    }
  }

  // ── Timeline items (what the multi-track timeline shows) ───────────────────

  /// Every placed item, per track, in timeline order. Clips are the video track.
  /// Edges a dragged item can snap to: 0, the end, every clip cut, the playhead and the other items' edges.
  static List<int> snapPoints(MobileEditIr ir, {int? playheadMs, String? excludeId}) => {
        0,
        ir.durationMs,
        for (final c in ir.clips) ...[c.timelineStartMs, c.timelineEndMs],
        ?playheadMs,
        for (final it in items(ir))
          if (it.id != excludeId) ...[it.startMs, it.endMs],
      }.toList()
        ..sort();

  /// The nearest of [points] within [thresholdMs] of [ms], or null.
  static int? snapMs(int ms, Iterable<int> points, int thresholdMs) {
    int? best;
    for (final p in points) {
      final d = (p - ms).abs();
      if (d <= thresholdMs && (best == null || d < (best - ms).abs())) best = p;
    }
    return best;
  }

  static List<TimelineItem> items(MobileEditIr ir) => [
        for (var i = 0; i < ir.clips.length; i++)
          TimelineItem(
            TrackKind.video,
            ir.clips[i].id,
            ir.clips[i].timelineStartMs,
            ir.clips[i].timelineEndMs,
            'Clip ${i + 1}',
          ),
        for (final o in ir.overlays)
          TimelineItem(
            TrackKind.broll,
            o.id,
            o.timelineStartMs,
            o.timelineEndMs,
            '${o.isImage ? 'Photo' : 'B-roll'}: ${o.source['title'] ?? o.source['query'] ?? 'Overlay'}',
            mediaUrl: (o.source['url'] ?? o.source['downloadUrl'] ?? o.source['path']) as String?,
            thumbnailUrl: (o.source['thumbnailUrl'] ?? o.source['previewUrl'] ?? (o.isImage ? o.source['url'] : null)) as String?,
            isImage: o.isImage,
          ),
        for (final e in ir.effects) TimelineItem(TrackKind.effect, e.id, e.startMs, e.endMs, e.label),
        for (final c in ir.captions)
          TimelineItem(c.kind == 'text' ? TrackKind.text : TrackKind.captions, c.id, c.startMs, c.endMs, c.text),
        for (final z in ir.zooms) TimelineItem(TrackKind.zoom, z.id, z.startMs, z.endMs, '${z.scale.toStringAsFixed(1)}x'),
        for (final (i, r) in ir.audio.speechRangesMs.indexed)
          if (r.length == 2) TimelineItem(TrackKind.voice, 'speech_$i', r[0], r[1], 'Speech'),
        for (final m in ir.audio.music)
          TimelineItem(TrackKind.music, m.id, m.timelineStartMs, m.timelineEndMs, '${m.source['title'] ?? m.source['query'] ?? 'Music'}'),
        for (final e in ir.audio.sfx)
          TimelineItem(TrackKind.sfx, e.id, e.timelineStartMs, e.timelineStartMs + (e.durationMs ?? 1000), e.credit ?? 'Sound effect'),
        for (final (i, v) in ir.audio.voiceovers.indexed)
          TimelineItem(TrackKind.voiceover, v.id, v.timelineStartMs, v.timelineEndMs, 'Voiceover ${i + 1}'),
      ];

  /// Moves an item so it starts at [startMs], keeping its length (clamped to the video). Captions keep their
  /// word timing relative to the caption. Video clips move with [moveClip] instead.
  static MobileEditIr moveItem(MobileEditIr ir, TrackKind kind, String id, int startMs) {
    int clampStart(int len) => startMs.clamp(0, math.max(0, ir.durationMs - len)).toInt();
    switch (kind) {
      case TrackKind.broll:
        return _copy(ir, overlays: [
          for (final o in ir.overlays)
            if (o.id != id)
              o
            else
              () {
                final len = o.timelineEndMs - o.timelineStartMs;
                final s = clampStart(len);
                return o.copyWith(timelineStartMs: s, timelineEndMs: s + len);
              }(),
        ]);
      case TrackKind.text:
      case TrackKind.captions:
        return _copy(ir, captions: [
          for (final c in ir.captions)
            if (c.id != id) c else _shiftCaption(c, clampStart(c.endMs - c.startMs) - c.startMs),
        ]..sort((a, b) => a.startMs.compareTo(b.startMs)));
      case TrackKind.zoom:
        final z = ir.zooms.firstWhere((z) => z.id == id);
        final s = clampStart(z.endMs - z.startMs);
        final moved = EditIrZoom(id: z.id, startMs: s, endMs: s + z.endMs - z.startMs, scale: z.scale, centerX: z.centerX, centerY: z.centerY, rampMs: z.rampMs);
        if (ir.zooms.any((o) => o.id != id && o.startMs < moved.endMs && moved.startMs < o.endMs)) {
          throw MediaEngineException('INVALID_EDIT', 'Zooms cannot overlap. Move the other zoom first.');
        }
        return _copy(ir, zooms: [for (final o in ir.zooms) o.id == id ? moved : o]..sort((a, b) => a.startMs.compareTo(b.startMs)));
      case TrackKind.sfx:
        return _withSfx(ir, [
          for (final e in ir.audio.sfx) e.id == id ? e.moved(clampStart(e.durationMs ?? 100)) : e,
        ]..sort((a, b) => a.timelineStartMs.compareTo(b.timelineStartMs)));
      case TrackKind.effect:
        return _copy(ir, effects: [
          for (final e in ir.effects)
            if (e.id != id) e else () {
              final s = clampStart(e.endMs - e.startMs);
              return e.copyWith(startMs: s, endMs: s + e.endMs - e.startMs);
            }(),
        ]..sort((a, b) => a.startMs.compareTo(b.startMs)));
      case TrackKind.voiceover:
        return _withVoiceovers(ir, [
          for (final v in ir.audio.voiceovers)
            if (v.id != id) v else () {
              final s = clampStart(math.min(v.durationMs, ir.durationMs));
              return v.copyWith(timelineStartMs: s, durationMs: math.min(v.durationMs, ir.durationMs - s));
            }(),
        ]);
      case TrackKind.music:
      case TrackKind.video:
      case TrackKind.voice:
        throw MediaEngineException('INVALID_EDIT', 'Use Trim for ${kind.label.toLowerCase()}.');
    }
  }

  /// Sets an item's start/end on the timeline (trim). Minimum 300 ms.
  static MobileEditIr setItemRange(MobileEditIr ir, TrackKind kind, String id, int startMs, int endMs) {
    if (kind == TrackKind.effect) {
      final s = startMs.clamp(0, math.max(0, ir.durationMs - 100)).toInt();
      final e = endMs.clamp(s + 100, ir.durationMs).toInt();
      return _copy(ir, effects: [for (final x in ir.effects) x.id == id ? x.copyWith(startMs: s, endMs: e) : x]);
    }
    final s = startMs.clamp(0, math.max(0, ir.durationMs - 300)).toInt();
    final e = endMs.clamp(s + 300, ir.durationMs).toInt();
    switch (kind) {
      case TrackKind.broll:
        return _copy(ir, overlays: [
          for (final o in ir.overlays)
            o.id != id
                ? o
                : o.copyWith(timelineStartMs: s, timelineEndMs: e, sourceStartMs: o.isImage ? 0 : o.sourceStartMs + math.max(0, s - o.timelineStartMs)),
        ]);
      case TrackKind.text:
      case TrackKind.captions:
        return _copy(ir, captions: [
          for (final c in ir.captions)
            c.id != id
                ? c
                : EditIrCaption(
                    id: c.id,
                    kind: c.kind,
                    startMs: s,
                    endMs: e,
                    text: c.text,
                    words: c.kind == 'text'
                        ? [EditIrWord(text: c.text, startMs: s, endMs: e)]
                        : [for (final w in c.words) if (w.endMs > s && w.startMs < e) EditIrWord(text: w.text, startMs: math.max(w.startMs, s), endMs: math.min(w.endMs, e), highlight: w.highlight, color: w.color, scale: w.scale)],
                    style: c.style,
                  ),
        ]..sort((a, b) => a.startMs.compareTo(b.startMs)));
      case TrackKind.zoom:
        final z = ir.zooms.firstWhere((z) => z.id == id);
        if (ir.zooms.any((o) => o.id != id && o.startMs < e && s < o.endMs)) {
          throw MediaEngineException('INVALID_EDIT', 'Zooms cannot overlap.');
        }
        return _copy(ir, zooms: [
          for (final o in ir.zooms)
            o.id == id ? EditIrZoom(id: z.id, startMs: s, endMs: e, scale: z.scale, centerX: z.centerX, centerY: z.centerY, rampMs: math.min(z.rampMs, (e - s) ~/ 2)) : o,
        ]);
      case TrackKind.music:
        final m = ir.audio.music.firstOrNull;
        if (m == null) throw MediaEngineException('INVALID_EDIT', 'Add music first.');
        return _withAudio(ir, music: [_music(m, start: s, end: e)]);
      case TrackKind.sfx:
        return _withSfx(ir, [
          for (final x in ir.audio.sfx)
            x.id == id ? EditIrSfx(id: x.id, timelineStartMs: s, durationMs: e - s, source: x.source, volumeDb: x.volumeDb, credit: x.credit) : x,
        ]);
      case TrackKind.voiceover:
        // A recording cannot be stretched: the start can reach back to the recording's beginning, the end no further
        // than where it already ends.
        final v = ir.audio.voiceovers.firstWhere((v) => v.id == id);
        final ns = math.max(s, v.timelineStartMs - v.sourceStartMs);
        final ne = math.min(e, v.timelineEndMs);
        if (ne - ns < 300) throw MediaEngineException('INVALID_EDIT', 'A voiceover needs at least 0.3 s.');
        return _withVoiceovers(ir, [
          for (final x in ir.audio.voiceovers)
            x.id == id ? x.copyWith(timelineStartMs: ns, durationMs: ne - ns, sourceStartMs: x.sourceStartMs + (ns - x.timelineStartMs)) : x,
        ]);
      case TrackKind.effect:
      case TrackKind.video:
      case TrackKind.voice:
        throw MediaEngineException('INVALID_EDIT', 'Use Trim on the clip.');
    }
  }

  /// Removes any non-video item.
  static MobileEditIr deleteItem(MobileEditIr ir, TrackKind kind, String id) => switch (kind) {
        TrackKind.broll => removeOverlay(ir, id),
        TrackKind.text || TrackKind.captions => removeCaption(ir, id),
        TrackKind.zoom => removeZoom(ir, id),
        TrackKind.music => removeMusic(ir),
        TrackKind.sfx => removeSfx(ir, id),
        TrackKind.voiceover => removeVoiceover(ir, id),
        TrackKind.effect => removeEffect(ir, id),
        TrackKind.video => deleteClip(ir, ir.clips.indexWhere((c) => c.id == id)),
        TrackKind.voice => throw MediaEngineException('INVALID_EDIT', 'Mute the voice track instead.'),
      };

  /// Replaces a text item's words and/or style (text templates, font, colours).
  static MobileEditIr editText(MobileEditIr ir, String id, {String? text, Map<String, dynamic>? style}) {
    final t = text?.trim();
    if (t != null && t.isEmpty) throw MediaEngineException('INVALID_EDIT', 'Type some text first.');
    return _copy(ir, captions: [
      for (final c in ir.captions)
        c.id != id
            ? c
            : EditIrCaption(
                id: c.id,
                kind: c.kind,
                startMs: c.startMs,
                endMs: c.endMs,
                text: t ?? c.text,
                words: t == null ? c.words : [EditIrWord(text: t, startMs: c.startMs, endMs: c.endMs)],
                style: style ?? c.style,
              ),
    ]);
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  static const maxEffects = 60;

  /// Adds a [type] effect (see [EditIrEffect.types]) at [startMs]; default length per type.
  static MobileEditIr addEffect(MobileEditIr ir, String type, {required int startMs, int? durationMs, double intensity = 0.6}) {
    final spec = EditIrEffect.types[type];
    if (spec == null) throw MediaEngineException('INVALID_EDIT', 'Unknown effect "$type".');
    if (ir.effects.length >= maxEffects) throw MediaEngineException('INVALID_EDIT', 'This video already has $maxEffects effects.');
    final len = math.max(100, durationMs ?? spec.$3);
    final s = startMs.clamp(0, math.max(0, ir.durationMs - 100)).toInt();
    final e = math.min(ir.durationMs, s + len).toInt();
    final fx = EditIrEffect(id: _id('fx'), type: type, startMs: s, endMs: e, intensity: intensity.clamp(0.0, 1.0));
    return _copy(ir, effects: [...ir.effects, fx]..sort((a, b) => a.startMs.compareTo(b.startMs)));
  }

  static MobileEditIr setEffectIntensity(MobileEditIr ir, String id, double intensity) =>
      _copy(ir, effects: [for (final e in ir.effects) e.id == id ? e.copyWith(intensity: intensity.clamp(0.0, 1.0)) : e]);

  static MobileEditIr removeEffect(MobileEditIr ir, String id) =>
      _copy(ir, effects: ir.effects.where((e) => e.id != id).toList());

  static EditIrCaption _shiftCaption(EditIrCaption c, int d) => EditIrCaption(
        id: c.id,
        kind: c.kind,
        startMs: c.startMs + d,
        endMs: c.endMs + d,
        text: c.text,
        words: [for (final w in c.words) EditIrWord(text: w.text, startMs: w.startMs + d, endMs: w.endMs + d, highlight: w.highlight, color: w.color, scale: w.scale)],
        style: c.style,
      );
}

/// Timeline tracks, top to bottom.
enum TrackKind {
  video('Video'),
  broll('B-roll'),
  text('Text'),
  captions('Captions'),
  zoom('Zoom'),
  effect('Effects'),
  voice('Voice'),
  voiceover('Voiceover'),
  music('Music'),
  sfx('Sound FX');

  TrackKind(this.label);
  final String label;
}

class TimelineItem {
  TimelineItem(
    this.kind,
    this.id,
    this.startMs,
    this.endMs,
    this.label, {
    this.mediaUrl,
    this.thumbnailUrl,
    this.isImage = false,
  });
  final TrackKind kind;
  final String id;
  final int startMs;
  final int endMs;
  final String label;
  final String? mediaUrl;
  final String? thumbnailUrl;
  final bool isImage;
}

class _Seg {
  const _Seg(this.oldStart, this.oldEnd, this.newStart, this.newEnd);
  final double oldStart, oldEnd, newStart, newEnd;

  double map(double t) {
    final oldLen = oldEnd - oldStart;
    if (oldLen <= 0) return newStart;
    return newStart + (t - oldStart) * (newEnd - newStart) / oldLen;
  }
}

/// Old-timeline → new-timeline mapping built from surviving source ranges.
class _Mapper {
  _Mapper(this.segs, this.duration);
  final List<_Seg> segs;
  final int duration;

  /// New range of old `[a, b)`, clipped to what survived; null if nothing survived.
  (int, int)? range(int a, int b) {
    if (b <= a) return null;
    double? ns, ne;
    // Earliest surviving moment inside [a, b).
    _Seg? first;
    for (final s in segs) {
      if (s.oldEnd <= a || s.oldStart >= b) continue;
      if (first == null ||
          math.max(s.oldStart, a.toDouble()) <
              math.max(first.oldStart, a.toDouble())) {
        first = s;
      }
    }
    _Seg? last;
    for (final s in segs) {
      if (s.oldEnd <= a || s.oldStart >= b) continue;
      if (last == null ||
          math.min(s.oldEnd, b.toDouble()) >
              math.min(last.oldEnd, b.toDouble())) {
        last = s;
      }
    }
    if (first == null || last == null) return null;
    ns = first.map(math.max(first.oldStart, a.toDouble()));
    ne = last.map(math.min(last.oldEnd, b.toDouble()));
    final s = ns.round().clamp(0, duration);
    final e = ne.round().clamp(0, duration);
    if (e - s < 1) return null;
    return (s, e);
  }
}
