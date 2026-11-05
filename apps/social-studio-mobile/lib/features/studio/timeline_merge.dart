import 'dart:convert';
import 'dart:math' as math;

import '../../core/native_engine/edit_ir.dart';

/// Outcome of merging an AI Director response computed on an older timeline into the creator's current one.
class MergeResult {
  MergeResult({required this.ir, required this.conflicts, required this.structuralConflict});

  /// The merged timeline. On a structural conflict this is the creator's own timeline, unchanged.
  final MobileEditIr ir;

  /// Plain-language notes on items both sides changed (the creator's version was kept).
  final List<String> conflicts;

  /// Both the creator and the Director changed the cuts (clip list): nothing was merged, the creator decides.
  final bool structuralConflict;
}

/// Three-way merge of timelines (audit F-01, F-02, F-05).
///
/// [base] is the timeline the Director request was made from, [mine] the creator's timeline now (manual edits made
/// while the Director was thinking, or before a proposal is applied), [theirs] the Director's response.
///
/// - Item lanes are keyed by id: what the Director added, removed or changed since [base] is applied onto [mine].
///   An item both sides changed keeps the creator's version (with a conflict note). An item the Director removed but
///   the creator changed is kept.
/// - Main clips: whichever side changed them wins; when both did, nothing is merged ([MergeResult.structuralConflict])
///   so no work is lost silently.
/// - When the Director's cuts are taken, the creator's own new or changed items are re-timed through those cuts
///   (by source time, like `TimelineOps` does for secondary lanes).
/// - Scalars (canvas, original audio level, watermark): the side that changed them; both = the creator's.
class TimelineMerge {
  static MergeResult merge({required MobileEditIr base, required MobileEditIr mine, required MobileEditIr theirs}) {
    final b = base.toJson();
    final m = mine.toJson();
    final t = theirs.toJson();
    if (_same(m, b)) return MergeResult(ir: theirs, conflicts: const [], structuralConflict: false);
    if (_same(t, b)) return MergeResult(ir: mine, conflicts: const [], structuralConflict: false);

    final clipsMine = !_same(m['clips'], b['clips']);
    final clipsTheirs = !_same(t['clips'], b['clips']);
    if (clipsMine && clipsTheirs) {
      return MergeResult(
        ir: mine,
        conflicts: const ['You and the Director both changed the cuts.'],
        structuralConflict: true,
      );
    }
    final conflicts = <String>[];
    // Times of the creator's items live on [base]'s cuts; when the Director's cuts are taken they are re-timed.
    final retime = clipsTheirs ? _Retimer(base, theirs) : null;
    final out = <String, dynamic>{...m};
    if (clipsTheirs) {
      out['clips'] = t['clips'];
      out['durationMs'] = t['durationMs'];
    }

    out['sources'] = _mergeSources(m['sources'] as List, t['sources'] as List);
    // Provenance / locks: the Director's entries (items it added), then the creator's (they win).
    final meta = <String, dynamic>{...((t['itemMeta'] as Map?) ?? const {}), ...((m['itemMeta'] as Map?) ?? const {})};
    if (meta.isEmpty) {
      out.remove('itemMeta');
    } else {
      out['itemMeta'] = meta;
    }
    out['canvas'] = _scalar('canvas size', b['canvas'], m['canvas'], t['canvas'], conflicts);
    if (b.containsKey('watermark') || m.containsKey('watermark') || t.containsKey('watermark')) {
      final w = _scalar('watermark', b['watermark'], m['watermark'], t['watermark'], conflicts);
      if (w == null) {
        out.remove('watermark');
      } else {
        out['watermark'] = w;
      }
    }

    for (final lane in _lanes) {
      final merged = _mergeLane(
        lane,
        _items(b, lane.path),
        _items(m, lane.path),
        _items(t, lane.path),
        conflicts,
        retime,
      );
      _setItems(out, lane.path, merged);
    }

    final audio = Map<String, dynamic>.from(out['audio'] as Map);
    audio['originalTrack'] = _scalar(
      'original sound level',
      (b['audio'] as Map)['originalTrack'],
      (m['audio'] as Map)['originalTrack'],
      (t['audio'] as Map)['originalTrack'],
      conflicts,
    );
    // Speech ranges follow the cuts they were computed for.
    audio['speechRangesMs'] = clipsTheirs ? (t['audio'] as Map)['speechRangesMs'] : (m['audio'] as Map)['speechRangesMs'];
    out['audio'] = audio;

    final ir = _clampToDuration(MobileEditIr.fromJson(out));
    return MergeResult(ir: ir, conflicts: conflicts, structuralConflict: false);
  }

  // ── lanes ────────────────────────────────────────────────────────────────

  static const _lanes = <_Lane>[
    _Lane(['overlays'], 'B-roll / layer', ['timelineStartMs', 'timelineEndMs']),
    _Lane(['captions'], 'text', ['startMs', 'endMs'], words: true),
    _Lane(['zooms'], 'zoom', ['startMs', 'endMs']),
    _Lane(['effects'], 'effect', ['startMs', 'endMs']),
    _Lane(['audio', 'music'], 'music', ['timelineStartMs', 'timelineEndMs']),
    _Lane(['audio', 'sfx'], 'sound effect', ['timelineStartMs']),
    _Lane(['audio', 'voiceovers'], 'voiceover', ['timelineStartMs']),
  ];

  static List<Map<String, dynamic>> _items(Map<String, dynamic> ir, List<String> path) {
    dynamic v = ir;
    for (final p in path) {
      v = (v as Map?)?[p];
    }
    return ((v as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static void _setItems(Map<String, dynamic> ir, List<String> path, List<Map<String, dynamic>> items) {
    if (path.length == 1) {
      ir[path.first] = items;
      return;
    }
    final parent = Map<String, dynamic>.from(ir[path.first] as Map);
    parent[path[1]] = items;
    ir[path.first] = parent;
  }

  static List<Map<String, dynamic>> _mergeLane(
    _Lane lane,
    List<Map<String, dynamic>> base,
    List<Map<String, dynamic>> mine,
    List<Map<String, dynamic>> theirs,
    List<String> conflicts,
    _Retimer? retime,
  ) {
    final bById = {for (final x in base) x['id'] as String: x};
    final tById = {for (final x in theirs) x['id'] as String: x};
    final out = <Map<String, dynamic>>[];
    final seen = <String>{};
    for (final x in mine) {
      final id = x['id'] as String;
      seen.add(id);
      final bx = bById[id];
      final tx = tById[id];
      final mineChanged = bx == null || !_same(x, bx);
      if (bx == null) {
        // The creator added it after the request: theirs cannot know it. Re-time onto the Director's cuts if needed.
        out.add(retime == null ? x : retime.item(x, lane));
        continue;
      }
      if (tx == null) {
        // The Director removed it.
        if (mineChanged) {
          conflicts.add('The Director removed a ${lane.label} you had changed, so it was kept.');
          out.add(retime == null ? x : retime.item(x, lane));
        }
        continue;
      }
      final theirsChanged = !_same(tx, bx);
      if (!mineChanged) {
        out.add(tx);
      } else if (!theirsChanged) {
        out.add(retime == null ? x : retime.item(x, lane));
      } else {
        conflicts.add('You and the Director both changed a ${lane.label}; your version was kept.');
        out.add(retime == null ? x : retime.item(x, lane));
      }
    }
    // Added by the Director (and not removed by the creator in the meantime: those ids are in base).
    for (final tx in theirs) {
      final id = tx['id'] as String;
      if (seen.contains(id) || bById.containsKey(id)) continue;
      out.add(tx);
    }
    final key = lane.times.first;
    out.sort((a, c) => ((a[key] as num?) ?? 0).compareTo((c[key] as num?) ?? 0));
    return out;
  }

  static List<dynamic> _mergeSources(List mine, List theirs) {
    final ids = <String>{};
    final out = <dynamic>[];
    for (final s in [...mine, ...theirs]) {
      final id = (s as Map)['assetId'] as String;
      if (ids.add(id)) out.add(s);
    }
    return out;
  }

  static dynamic _scalar(String label, dynamic base, dynamic mine, dynamic theirs, List<String> conflicts) {
    final mineChanged = !_same(mine, base);
    final theirsChanged = !_same(theirs, base);
    if (mineChanged && theirsChanged && !_same(mine, theirs)) {
      conflicts.add('You and the Director both changed the $label; yours was kept.');
      return mine;
    }
    return theirsChanged ? theirs : mine;
  }

  /// Keeps every timed item inside the (possibly shorter) merged timeline.
  static MobileEditIr _clampToDuration(MobileEditIr ir) {
    final j = ir.toJson();
    final d = ir.durationMs;
    for (final lane in _lanes) {
      final items = _items(j, lane.path);
      final kept = <Map<String, dynamic>>[];
      for (final x in items) {
        final s = ((x[lane.times.first] as num?) ?? 0).toInt();
        if (s >= d) {
          // Past the end: pulled back inside rather than lost.
          final len = lane.times.length > 1 ? (((x[lane.times[1]] as num?) ?? s) - s).toInt() : 0;
          final ns = math.max(0, d - math.max(100, len));
          x[lane.times.first] = ns;
          if (lane.times.length > 1) x[lane.times[1]] = math.min(d, ns + math.max(100, len));
        } else if (lane.times.length > 1 && ((x[lane.times[1]] as num?) ?? 0) > d) {
          x[lane.times[1]] = d;
        }
        kept.add(x);
      }
      _setItems(j, lane.path, kept);
    }
    return MobileEditIr.fromJson(j);
  }

  static bool _same(dynamic a, dynamic b) => jsonEncode(a) == jsonEncode(b);
}

class _Lane {
  const _Lane(this.path, this.label, this.times, {this.words = false});
  final List<String> path;
  final String label;

  /// Timeline-ms fields: [start] or [start, end].
  final List<String> times;
  final bool words;
}

/// Maps times on [base]'s cuts onto [theirs]' cuts through source time (same asset, same source moment).
class _Retimer {
  _Retimer(this.base, this.theirs);
  final MobileEditIr base;
  final MobileEditIr theirs;

  int? _map(int t) {
    if (base.clips.isEmpty) return null;
    final tc = t.clamp(0, base.durationMs);
    EditIrClip? c;
    for (final x in base.clips) {
      if (tc >= x.timelineStartMs && tc < x.timelineEndMs) {
        c = x;
        break;
      }
    }
    c ??= tc >= base.durationMs ? base.clips.last : null;
    if (c == null) return null;
    final src = c.sourceStartMs + (tc - c.timelineStartMs) * c.speed;
    // Same clip first (a trim keeps the id), then any clip that plays this moment of the same source.
    final candidates = [
      ...theirs.clips.where((x) => x.id == c!.id),
      ...theirs.clips.where((x) => x.id != c!.id && x.assetId == c.assetId),
    ];
    for (final x in candidates) {
      if (x.assetId != c.assetId) continue;
      if (src >= x.sourceStartMs - 0.5 && src <= x.sourceEndMs + 0.5) {
        final clampedSrc = src.clamp(x.sourceStartMs.toDouble(), x.sourceEndMs.toDouble());
        return (x.timelineStartMs + (clampedSrc - x.sourceStartMs) / x.speed).round().clamp(0, theirs.durationMs);
      }
    }
    return null;
  }

  /// [t] on the new cuts; a moment that was cut out moves to the next moment that still exists.
  int at(int t) {
    final direct = _map(t);
    if (direct != null) return direct;
    var lo = t;
    for (var probe = t + 40; probe <= base.durationMs; probe += 40) {
      if (_map(probe) == null) {
        lo = probe;
        continue;
      }
      // The first surviving moment lies in (lo, probe]: narrow it to the millisecond.
      var hi = probe;
      while (hi - lo > 1) {
        final mid = (lo + hi) >> 1;
        if (_map(mid) == null) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      return _map(hi)!;
    }
    return theirs.durationMs;
  }

  Map<String, dynamic> item(Map<String, dynamic> x, _Lane lane) {
    final out = Map<String, dynamic>.from(x);
    final s0 = ((x[lane.times.first] as num?) ?? 0).toInt();
    final s = at(s0);
    out[lane.times.first] = s;
    if (lane.times.length > 1) {
      final e0 = ((x[lane.times[1]] as num?) ?? s0).toInt();
      var e = at(e0);
      // The creator chose this length; a cut inside it must not make it vanish.
      if (e <= s) e = math.min(theirs.durationMs, s + math.max(1, e0 - s0));
      out[lane.times[1]] = e;
    }
    if (lane.words && x['words'] is List) {
      out['words'] = [
        for (final w in x['words'] as List)
          {
            ...Map<String, dynamic>.from(w as Map),
            'startMs': at(((w['startMs'] as num?) ?? s0).toInt()),
            'endMs': math.max(at(((w['startMs'] as num?) ?? s0).toInt()), at(((w['endMs'] as num?) ?? s0).toInt())),
          },
      ];
    }
    return out;
  }
}
