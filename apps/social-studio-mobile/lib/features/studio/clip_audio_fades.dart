import 'dart:math' as math;

import '../../core/native_engine/edit_ir.dart';

/// Minimum fade on both sides of every clip-to-clip boundary, so hard cuts mid-waveform do not click.
const double declickFadeMs = 10;

/// Clips shorter than this (timeline ms) get no de-click fade.
const double declickMinClipMs = 40;

/// Fade-in / fade-out (ms) of clip [index]'s own sound. Mirrors `clipAudioFadesMs` in the Android renderer
/// (AudioEnvelope.kt): the longer of half the adjoining non-CUT transition and the clip's manual fade, raised to at
/// least [declickFadeMs] at every boundary with another clip (the timeline's very start and end are left alone). The
/// minimum never shortens a longer fade and is skipped for clips shorter than [declickMinClipMs] or muted ones.
(double, double) clipPreviewFadesMs(MobileEditIr ir, int index) {
  final c = ir.clips[index];
  final next = index + 1 < ir.clips.length ? ir.clips[index + 1] : null;
  double half(EditIrTransition? t) => t == null || t.type == 'CUT' ? 0 : t.durationMs / 2;
  var fadeIn = math.max(half(c.transitionIn), c.audioFadeInMs.toDouble());
  var fadeOut = math.max(half(next?.transitionIn), c.audioFadeOutMs.toDouble());
  final dur = (c.timelineEndMs - c.timelineStartMs).toDouble();
  final muted = c.volumeDb + ir.audio.originalVolumeDb <= -60;
  if (dur >= declickMinClipMs && !muted) {
    if (index > 0) fadeIn = math.max(fadeIn, declickFadeMs);
    if (next != null) fadeOut = math.max(fadeOut, declickFadeMs);
  }
  return (fadeIn, fadeOut);
}

/// Gain (0..1) of clip [index]'s own sound [relMs] into the clip: volume x fade in x fade out, with the same fades as
/// the export ([clipPreviewFadesMs]). The preview player cannot boost, so gain is capped at 1.
double clipPreviewGainWithDeclick(MobileEditIr ir, int index, int relMs) {
  final c = ir.clips[index];
  if (c.volumeDb <= -60 || ir.audio.originalVolumeDb <= -60) return 0;
  final dur = (c.timelineEndMs - c.timelineStartMs).toDouble();
  final (fadeIn, fadeOut) = clipPreviewFadesMs(ir, index);
  double ramp(double t, double a, double b) => b <= a ? (t >= a ? 1 : 0) : ((t - a) / (b - a)).clamp(0.0, 1.0);
  var g = math.pow(10, (c.volumeDb + ir.audio.originalVolumeDb) / 20).toDouble();
  if (fadeIn > 0) g *= ramp(relMs.toDouble(), 0, fadeIn);
  if (fadeOut > 0) g *= 1 - ramp(relMs.toDouble(), dur - fadeOut, dur);
  return g.clamp(0.0, 1.0);
}

// ── J-cut / L-cut in the preview (mirrors clipJlMs / clipAudioPlanMs in AudioEnvelope.kt) ───────────────────────

/// Effective J-cut lead / L-cut lag (timeline ms) of clip [index]: clamped to the source material before / after the
/// clip (a still has none), to half of the neighbouring clip; the first clip has no lead and the last no lag.
(double, double) clipJlMs(MobileEditIr ir, int index, {bool Function(String assetId)? isStill}) {
  final c = ir.clips[index];
  if (isStill?.call(c.assetId) ?? false) return (0, 0);
  final speed = math.max(0.01, c.speed);
  final prev = index > 0 ? ir.clips[index - 1] : null;
  final next = index + 1 < ir.clips.length ? ir.clips[index + 1] : null;
  final src = ir.sources.where((s) => s.assetId == c.assetId).firstOrNull;
  final before = c.sourceStartMs.toDouble();
  final after = src == null ? 0.0 : math.max(0, src.durationMs - c.sourceEndMs).toDouble();
  final lead = prev == null || c.audioLeadMs <= 0
      ? 0.0
      : [c.audioLeadMs.toDouble(), before / speed, (prev.timelineEndMs - prev.timelineStartMs) / 2.0].reduce(math.min);
  final lag = next == null || c.audioLagMs <= 0
      ? 0.0
      : [c.audioLagMs.toDouble(), after / speed, (next.timelineEndMs - next.timelineStartMs) / 2.0].reduce(math.min);
  return (lead.floorToDouble(), lag.floorToDouble());
}

/// Gain (0..1) of clip [index]'s own sound at TIMELINE time [timelineMs], J/L cuts included: the sound runs from
/// `start - lead` to `end + lag`; it fades out over the next clip's lead (plus its own lag) and in over the previous
/// clip's lag (plus its own lead), like the export. 0 outside that span. Without J/L cuts this is
/// [clipPreviewGainWithDeclick].
double clipPreviewGainJl(MobileEditIr ir, int index, int timelineMs, {bool Function(String assetId)? isStill}) {
  final c = ir.clips[index];
  if (c.volumeDb <= -60 || ir.audio.originalVolumeDb <= -60) return 0;
  final (lead, lag) = clipJlMs(ir, index, isStill: isStill);
  var (fadeIn, fadeOut) = clipPreviewFadesMs(ir, index);
  final prevLag = index > 0 ? clipJlMs(ir, index - 1, isStill: isStill).$2 : 0.0;
  final nextLead = index + 1 < ir.clips.length ? clipJlMs(ir, index + 1, isStill: isStill).$1 : 0.0;
  if (prevLag > 0) fadeIn = math.max(fadeIn, lead + prevLag);
  if (nextLead > 0) fadeOut = math.max(fadeOut, lag + nextLead);
  final itemStart = c.timelineStartMs - lead;
  final itemEnd = c.timelineEndMs + lag;
  final t = timelineMs.toDouble();
  if (t < itemStart || t >= itemEnd) return 0;
  final rel = t - itemStart;
  final dur = itemEnd - itemStart;
  double ramp(double x, double a, double b) => b <= a ? (x >= a ? 1 : 0) : ((x - a) / (b - a)).clamp(0.0, 1.0);
  var g = math.pow(10, (c.volumeDb + ir.audio.originalVolumeDb) / 20).toDouble();
  if (fadeIn > 0) g *= ramp(rel, 0, fadeIn);
  if (fadeOut > 0) g *= 1 - ramp(rel, dur - fadeOut, dur);
  return g.clamp(0.0, 1.0);
}

/// The neighbouring clip whose sound is heard at [timelineMs] outside its own picture (the next clip's J-cut lead,
/// or the previous clip's L-cut lag), with the source position and gain to play it at; null when there is none.
({int clipIndex, int sourceMs, double gain})? jlNeighbourAt(MobileEditIr ir, int timelineMs, {bool Function(String assetId)? isStill}) {
  if (ir.clips.isEmpty) return null;
  var k = ir.clips.indexWhere((c) => timelineMs >= c.timelineStartMs && timelineMs < c.timelineEndMs);
  if (k < 0) k = ir.clips.length - 1;
  for (final i in [k + 1, k - 1]) {
    if (i < 0 || i >= ir.clips.length) continue;
    final (lead, lag) = clipJlMs(ir, i, isStill: isStill);
    final c = ir.clips[i];
    final inLead = i == k + 1 && lead > 0 && timelineMs >= c.timelineStartMs - lead;
    final inLag = i == k - 1 && lag > 0 && timelineMs < c.timelineEndMs + lag;
    if (!inLead && !inLag) continue;
    final g = clipPreviewGainJl(ir, i, timelineMs, isStill: isStill);
    if (g <= 0) continue;
    return (clipIndex: i, sourceMs: (c.sourceStartMs + (timelineMs - c.timelineStartMs) * c.speed).round(), gain: g);
  }
  return null;
}
