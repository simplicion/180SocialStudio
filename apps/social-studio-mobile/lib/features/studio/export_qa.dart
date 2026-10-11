import 'dart:math' as math;

import '../../core/native_engine/edit_ir.dart';
import '../../core/native_engine/media_intelligence.dart';

enum QaSeverity { critical, warning, info }

/// What the export sheet offers for an issue.
enum QaFix {
  /// The timeline itself is at fault: send the issue to the AI Director (with `lastExportQa`).
  askDirector,

  /// The render went wrong, not the edit: export again.
  exportAgain,
}

class QaIssue {
  QaIssue({
    required this.id,
    required this.severity,
    required this.title,
    required this.detail,
    required this.fix,
    this.timeRangeMs,
    this.directorPrompt,
  });

  final String id;
  final QaSeverity severity;
  final String title;
  final String detail;
  final QaFix fix;

  /// Where on the exported timeline the problem is (for seeking), when it has a place.
  final (int, int)? timeRangeMs;

  /// The instruction sent to the AI Director for [QaFix.askDirector].
  final String? directorPrompt;
}

/// Thresholds of the post-export quality check. Social platforms normalise to roughly -14 LUFS.
class QaThresholds {
  static const durationToleranceMs = 500;
  static const durationTolerancePct = 0.03;
  static const sizeTolerancePx = 16;
  static const minBlackMs = 400;
  static const criticalBlackMs = 2000;
  static const minFrozenMs = 1000;
  static const quietLufs = -20.0;
  static const loudLufs = -9.0;
  static const maxTruePeakDb = -1.0;
  static const maxClippingPct = 0.1;
}

String _t(int ms) => '${ms ~/ 60000}:${((ms ~/ 1000) % 60).toString().padLeft(2, '0')}';

/// Whether the timeline should produce an audio track at all.
bool timelineExpectsAudio(MobileEditIr ir, {required bool sourceHasAudio}) =>
    ir.audio.music.isNotEmpty ||
    ir.audio.sfx.isNotEmpty ||
    (sourceHasAudio && ir.audio.originalVolumeDb > -60 && ir.clips.any((c) => c.volumeDb > -60));

/// Pure evaluation of a measured export against the timeline that produced it. Returns issues
/// sorted by severity (critical first). An empty list means the export passed.
List<QaIssue> evaluateExportQa(ExportQa qa, {required MobileEditIr ir, required bool sourceHasAudio}) {
  final issues = <QaIssue>[];
  final expected = ir.durationMs;
  final tol = math.max(QaThresholds.durationToleranceMs, (expected * QaThresholds.durationTolerancePct).round());
  if ((qa.durationMs - expected).abs() > tol) {
    issues.add(QaIssue(
      id: 'duration_mismatch',
      severity: QaSeverity.critical,
      title: 'Wrong length',
      detail: 'The file is ${(qa.durationMs / 1000).toStringAsFixed(1)} s but the timeline is ${(expected / 1000).toStringAsFixed(1)} s.',
      fix: QaFix.exportAgain,
    ));
  }
  final canvas = ir.canvas;
  if ((qa.width - canvas.width).abs() > QaThresholds.sizeTolerancePx || (qa.height - canvas.height).abs() > QaThresholds.sizeTolerancePx) {
    issues.add(QaIssue(
      id: 'resolution_mismatch',
      severity: QaSeverity.warning,
      title: 'Different resolution',
      detail: 'Exported at ${qa.width}×${qa.height} instead of ${canvas.width}×${canvas.height} (the phone encoder may not support that size).',
      fix: QaFix.exportAgain,
    ));
  }
  final wantsAudio = timelineExpectsAudio(ir, sourceHasAudio: sourceHasAudio);
  if (wantsAudio && !qa.hasAudio) {
    issues.add(QaIssue(
      id: 'missing_audio',
      severity: QaSeverity.critical,
      title: 'No sound',
      detail: 'The timeline has audio but the exported file has no audio track.',
      fix: QaFix.exportAgain,
    ));
  } else if (wantsAudio && qa.hasAudio && qa.integratedLufs == null) {
    issues.add(QaIssue(
      id: 'silent_audio',
      severity: QaSeverity.critical,
      title: 'Silent audio',
      detail: 'The audio track is silent all the way through.',
      fix: QaFix.askDirector,
      directorPrompt: 'The exported video is silent. Check the voice and music volumes and fix the audio.',
    ));
  }
  for (final r in qa.blackRangesMs) {
    final len = r[1] - r[0];
    if (len < QaThresholds.minBlackMs) continue;
    issues.add(QaIssue(
      id: 'black_frames_${r[0]}',
      severity: len >= QaThresholds.criticalBlackMs ? QaSeverity.critical : QaSeverity.warning,
      title: 'Black frames at ${_t(r[0])}',
      detail: '${(len / 1000).toStringAsFixed(1)} s of black picture.',
      fix: QaFix.askDirector,
      timeRangeMs: (r[0], r[1]),
      directorPrompt: 'The export has ${(len / 1000).toStringAsFixed(1)} s of black frames at ${_t(r[0])}–${_t(r[1])}. Remove them or cover them.',
    ));
  }
  for (final r in qa.frozenRangesMs) {
    final len = r[1] - r[0];
    if (len < QaThresholds.minFrozenMs) continue;
    issues.add(QaIssue(
      id: 'frozen_frames_${r[0]}',
      severity: QaSeverity.warning,
      title: 'Frozen picture at ${_t(r[0])}',
      detail: 'The picture does not change for ${(len / 1000).toStringAsFixed(1)} s.',
      fix: QaFix.askDirector,
      timeRangeMs: (r[0], r[1]),
      directorPrompt: 'The export has a frozen picture for ${(len / 1000).toStringAsFixed(1)} s at ${_t(r[0])}–${_t(r[1])}. Fix or trim that part.',
    ));
  }
  final lufs = qa.integratedLufs;
  if (qa.hasAudio && lufs != null) {
    if (lufs < QaThresholds.quietLufs) {
      issues.add(QaIssue(
        id: 'too_quiet',
        severity: QaSeverity.warning,
        title: 'Too quiet',
        detail: 'Measured ${lufs.toStringAsFixed(1)} LUFS; social apps play best around -14 LUFS.',
        fix: QaFix.askDirector,
        directorPrompt: 'The export measured ${lufs.toStringAsFixed(1)} LUFS, which is too quiet. Raise the overall level towards -14 LUFS without clipping.',
      ));
    } else if (lufs > QaThresholds.loudLufs) {
      issues.add(QaIssue(
        id: 'too_loud',
        severity: QaSeverity.warning,
        title: 'Too loud',
        detail: 'Measured ${lufs.toStringAsFixed(1)} LUFS; platforms will turn it down and it may distort.',
        fix: QaFix.askDirector,
        directorPrompt: 'The export measured ${lufs.toStringAsFixed(1)} LUFS, which is too loud. Lower the levels towards -14 LUFS.',
      ));
    }
  }
  final clip = qa.clippingPct;
  if (qa.hasAudio && clip != null && clip > QaThresholds.maxClippingPct) {
    issues.add(QaIssue(
      id: 'clipping',
      severity: QaSeverity.warning,
      title: 'Audio clipping',
      detail: '${clip.toStringAsFixed(2)}% of samples are clipped.',
      fix: QaFix.askDirector,
      directorPrompt: 'The export audio clips (${clip.toStringAsFixed(2)}% of samples). Lower the music or voice level so it stops distorting.',
    ));
  } else if (qa.hasAudio && (qa.truePeakDb ?? -100) > QaThresholds.maxTruePeakDb) {
    issues.add(QaIssue(
      id: 'true_peak',
      severity: QaSeverity.info,
      title: 'Peaks near 0 dB',
      detail: 'True peak ${qa.truePeakDb!.toStringAsFixed(1)} dBTP; some platforms may distort it after re-encoding.',
      fix: QaFix.askDirector,
      directorPrompt: 'The export true peak is ${qa.truePeakDb!.toStringAsFixed(1)} dBTP. Lower the loudest parts slightly (below -1 dBTP).',
    ));
  }
  issues.sort((a, b) => a.severity.index.compareTo(b.severity.index));
  return issues;
}
