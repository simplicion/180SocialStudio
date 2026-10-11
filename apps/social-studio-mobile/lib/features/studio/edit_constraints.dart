import 'dart:convert';
import 'dart:math' as math;

import '../../core/native_engine/edit_ir.dart';
import 'timeline_ops.dart';

/// Tracks the user can lock so the AI Director must leave them alone (wire names of
/// `constraints.lockedTracks` in the `/ai-direct` request).
enum LockableTrack {
  music('Music'),
  captions('Captions'),
  broll('B-roll'),
  sfx('Sound FX'),
  effects('Effects & zooms'),
  text('Text');

  LockableTrack(this.label);
  final String label;

  /// The lock that covers timeline track [k]; null for tracks that can only be range-locked
  /// (the video clips and the speech they carry).
  static LockableTrack? of(TrackKind k) => switch (k) {
        TrackKind.music => LockableTrack.music,
        TrackKind.captions => LockableTrack.captions,
        TrackKind.broll => LockableTrack.broll,
        TrackKind.sfx => LockableTrack.sfx,
        TrackKind.effect || TrackKind.zoom => LockableTrack.effects,
        TrackKind.text => LockableTrack.text,
        TrackKind.video || TrackKind.voice || TrackKind.voiceover => null,
      };

  List<TrackKind> get kinds => [for (final k in TrackKind.values) if (of(k) == this) k];
}

/// A locked stretch of source media. Locks are anchored to the source (not the timeline) so they
/// stay on the same footage when earlier parts of the timeline are cut, moved or sped up.
class SourceRange {
  SourceRange(this.assetId, this.startMs, this.endMs);
  final String assetId;
  final int startMs;
  final int endMs;

  int get lengthMs => endMs - startMs;

  @override
  bool operator ==(Object other) =>
      other is SourceRange && other.assetId == assetId && other.startMs == startMs && other.endMs == endMs;

  @override
  int get hashCode => Object.hash(assetId, startMs, endMs);
}

/// The user's "don't touch this" rules for the AI Director. Sent as `constraints` with every turn,
/// and re-checked on the phone before any director result is applied (defense in depth: the server
/// validator rejects violating operations too).
class EditLocks {
  EditLocks({this.tracks = const {}, this.ranges = const []});

  final Set<LockableTrack> tracks;
  final List<SourceRange> ranges;

  bool get isEmpty => tracks.isEmpty && ranges.isEmpty;

  EditLocks withTrack(LockableTrack t, bool locked) =>
      EditLocks(tracks: locked ? {...tracks, t} : ({...tracks}..remove(t)), ranges: ranges);

  EditLocks withRanges(List<SourceRange> added) => EditLocks(tracks: tracks, ranges: _mergeSource([...ranges, ...added]));

  EditLocks withoutRange(SourceRange r) => EditLocks(tracks: tracks, ranges: [...ranges]..remove(r));

  /// Locks timeline [startMs, endMs) of [ir] (a selected clip, item or range).
  EditLocks lockTimelineRange(MobileEditIr ir, int startMs, int endMs) => withRanges(sourceRangesFor(ir, startMs, endMs));

  /// Locked ranges on the timeline of [ir], merged and sorted.
  List<(int, int)> timelineRanges(MobileEditIr ir) => timelineRangesFor(ir, ranges);

  /// `constraints` for the `/ai-direct` request, or null when nothing is locked.
  Map<String, dynamic>? toRequest(MobileEditIr ir) {
    if (isEmpty) return null;
    final locked = timelineRanges(ir);
    return {
      if (locked.isNotEmpty) 'lockedRanges': [for (final (s, e) in locked) [s, e]],
      if (tracks.isNotEmpty) 'lockedTracks': [for (final t in LockableTrack.values) if (tracks.contains(t)) t.name],
    };
  }

  /// Whether the AI may not change [it] on [ir]: its track is locked or it overlaps a locked range.
  bool isItemLocked(MobileEditIr ir, TimelineItem it) {
    final t = LockableTrack.of(it.kind);
    if (t != null && tracks.contains(t)) return true;
    return timelineRanges(ir).any((r) => it.startMs < r.$2 && r.$1 < it.endMs);
  }

  /// Human-readable reasons why [after] (a director result) breaks these locks relative to
  /// [before] (the timeline the director was given). Empty means it is safe to apply.
  List<String> violations(MobileEditIr before, MobileEditIr after) {
    final out = <String>[];
    // Locked tracks: same items with the same content. Times may shift only when the cut changed.
    final sameCut = before.durationMs == after.durationMs && _clipShape(before) == _clipShape(after);
    for (final t in LockableTrack.values) {
      if (!tracks.contains(t)) continue;
      if (_trackSignature(before, t, withTiming: sameCut) != _trackSignature(after, t, withTiming: sameCut)) {
        out.add('Changed the locked ${t.label.toLowerCase()} track');
      }
    }
    // Locked ranges: the footage must survive at the same speed, with no items removed or added over it.
    for (final r in ranges) {
      final label = '${_fmt(r.startMs)}–${_fmt(r.endMs)} of the source';
      final beforeCover = _coverage(before, r);
      final afterCover = _coverage(after, r);
      if (afterCover.ms < math.min(r.lengthMs, beforeCover.ms) - 50) {
        out.add('Cut footage inside the locked range ($label)');
        continue;
      }
      if (beforeCover.speeds.isNotEmpty && afterCover.speeds.difference(beforeCover.speeds).isNotEmpty) {
        out.add('Changed the speed inside the locked range ($label)');
      }
      final beforeIds = _itemsOver(before, timelineRangesFor(before, [r]));
      final afterIds = _itemsOver(after, timelineRangesFor(after, [r]));
      final removed = beforeIds.difference(TimelineOps.items(after).map((i) => '${i.kind.name}:${i.id}').toSet());
      final added = afterIds.difference(TimelineOps.items(before).map((i) => '${i.kind.name}:${i.id}').toSet());
      if (removed.isNotEmpty) out.add('Removed ${removed.length} item(s) inside the locked range ($label)');
      if (added.isNotEmpty) out.add('Added ${added.length} item(s) inside the locked range ($label)');
    }
    return out;
  }

  // ── Mapping between timeline and source time ────────────────────────────────

  /// Source ranges shown during timeline [startMs, endMs) of [ir].
  static List<SourceRange> sourceRangesFor(MobileEditIr ir, int startMs, int endMs) {
    final out = <SourceRange>[];
    for (final c in ir.clips) {
      final s = math.max(startMs, c.timelineStartMs);
      final e = math.min(endMs, c.timelineEndMs);
      if (e <= s) continue;
      final ss = c.sourceStartMs + ((s - c.timelineStartMs) * c.speed).round();
      final se = c.sourceStartMs + ((e - c.timelineStartMs) * c.speed).round();
      out.add(SourceRange(c.assetId, ss, math.min(se, c.sourceEndMs)));
    }
    return _mergeSource(out);
  }

  /// Where [ranges] appear on the timeline of [ir] (a source range used twice appears twice).
  static List<(int, int)> timelineRangesFor(MobileEditIr ir, List<SourceRange> ranges) {
    final out = <(int, int)>[];
    for (final c in ir.clips) {
      for (final r in ranges) {
        if (r.assetId != c.assetId) continue;
        final s = math.max(r.startMs, c.sourceStartMs);
        final e = math.min(r.endMs, c.sourceEndMs);
        if (e <= s) continue;
        final ts = c.timelineStartMs + ((s - c.sourceStartMs) / c.speed).round();
        final te = c.timelineStartMs + ((e - c.sourceStartMs) / c.speed).round();
        out.add((ts, math.min(te, c.timelineEndMs)));
      }
    }
    out.sort((a, b) => a.$1.compareTo(b.$1));
    final merged = <(int, int)>[];
    for (final r in out) {
      if (merged.isNotEmpty && r.$1 <= merged.last.$2) {
        merged[merged.length - 1] = (merged.last.$1, math.max(merged.last.$2, r.$2));
      } else {
        merged.add(r);
      }
    }
    return merged;
  }

  static List<SourceRange> _mergeSource(List<SourceRange> rs) {
    final sorted = [...rs.where((r) => r.endMs > r.startMs)]
      ..sort((a, b) => a.assetId == b.assetId ? a.startMs.compareTo(b.startMs) : a.assetId.compareTo(b.assetId));
    final out = <SourceRange>[];
    for (final r in sorted) {
      final last = out.lastOrNull;
      if (last != null && last.assetId == r.assetId && r.startMs <= last.endMs) {
        out[out.length - 1] = SourceRange(r.assetId, last.startMs, math.max(last.endMs, r.endMs));
      } else {
        out.add(r);
      }
    }
    return out;
  }

  static ({int ms, Set<double> speeds}) _coverage(MobileEditIr ir, SourceRange r) {
    var ms = 0;
    final speeds = <double>{};
    for (final c in ir.clips) {
      if (c.assetId != r.assetId) continue;
      final s = math.max(r.startMs, c.sourceStartMs);
      final e = math.min(r.endMs, c.sourceEndMs);
      if (e <= s) continue;
      ms += e - s;
      speeds.add(c.speed);
    }
    return (ms: math.min(ms, r.lengthMs), speeds: speeds);
  }

  static Set<String> _itemsOver(MobileEditIr ir, List<(int, int)> ranges) => {
        for (final it in TimelineOps.items(ir))
          if (it.kind != TrackKind.video && it.kind != TrackKind.voice && ranges.any((r) => it.startMs < r.$2 && r.$1 < it.endMs))
            '${it.kind.name}:${it.id}',
      };

  static String _clipShape(MobileEditIr ir) =>
      ir.clips.map((c) => '${c.assetId}:${c.sourceStartMs}-${c.sourceEndMs}@${c.speed}').join('|');

  static const _timingKeys = {'timelineStartMs', 'timelineEndMs', 'startMs', 'endMs', 'sourceStartMs', 'sourceEndMs'};

  static Object? _stripTiming(Object? v) {
    if (v is Map) {
      return {
        for (final e in v.entries)
          if (!_timingKeys.contains(e.key)) e.key: _stripTiming(e.value),
      };
    }
    if (v is List) return v.map(_stripTiming).toList();
    return v;
  }

  static String _trackSignature(MobileEditIr ir, LockableTrack t, {required bool withTiming}) {
    final j = ir.toJson();
    final audio = (j['audio'] as Map?) ?? {};
    final List<Object?> items = switch (t) {
      LockableTrack.music => (audio['music'] as List?) ?? [],
      LockableTrack.sfx => (audio['sfx'] as List?) ?? [],
      LockableTrack.broll => (j['overlays'] as List?) ?? [],
      LockableTrack.effects => [...(j['effects'] as List?) ?? [], ...(j['zooms'] as List?) ?? []],
      LockableTrack.captions => [for (final c in (j['captions'] as List?) ?? []) if ((c as Map)['kind'] != 'text') c],
      LockableTrack.text => [for (final c in (j['captions'] as List?) ?? []) if ((c as Map)['kind'] == 'text') c],
    };
    final encoded = [for (final i in items) jsonEncode(withTiming ? i : _stripTiming(i))]..sort();
    return encoded.join('\n');
  }

  static String _fmt(int ms) => '${ms ~/ 60000}:${((ms ~/ 1000) % 60).toString().padLeft(2, '0')}';
}
