import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../core/storage/key_value_store.dart';
import '../../core/util/json.dart';

/// What a [StudioJob] does. Every long-running Studio task (AI Director turn, on-device analysis,
/// export, upload) goes through the same state machine, so the UI shows and cancels them the same way.
enum StudioJobKind {
  director('AI Director'),
  analysis('Media analysis'),
  export('Export'),
  upload('Upload');

  StudioJobKind(this.label);
  final String label;
}

/// QUEUED → ANALYZING → PLANNING → EDITING → RENDERING → CRITIQUING → REPAIRING → COMPLETED/FAILED/CANCELLED.
enum StudioJobPhase {
  queued,
  analyzing,
  planning,
  editing,
  rendering,
  critiquing,
  repairing,
  completed,
  failed,
  cancelled;

  bool get isTerminal => this == completed || this == failed || this == cancelled;

  /// Wire name (`QUEUED`, …), matching the desktop and server job vocabulary.
  String get wire => name.toUpperCase();

  static StudioJobPhase? fromWire(String? s) {
    if (s == null) return null;
    for (final p in values) {
      if (p.wire == s || p.name == s) return p;
    }
    return null;
  }
}

/// Thrown for a transition the state machine does not allow (a programming error, never user-facing).
class IllegalJobTransition extends StateError {
  IllegalJobTransition(StudioJobPhase from, StudioJobPhase to) : super('Studio job cannot go from ${from.wire} to ${to.wire}');
}

/// Pure transition rules.
///
/// - Terminal phases are final.
/// - Any live phase may fail or be cancelled; QUEUED may also complete directly (nothing to do).
/// - Work moves forward through the pipeline and may skip phases (an export goes QUEUED → RENDERING).
/// - REPAIRING loops back to EDITING, RENDERING or CRITIQUING (a bounded repair cycle).
/// - Repeating the current live phase is a progress update, not a transition.
class StudioJobMachine {
  StudioJobMachine._();

  static const _pipeline = [
    StudioJobPhase.queued,
    StudioJobPhase.analyzing,
    StudioJobPhase.planning,
    StudioJobPhase.editing,
    StudioJobPhase.rendering,
    StudioJobPhase.critiquing,
    StudioJobPhase.repairing,
  ];

  static bool canTransition(StudioJobPhase from, StudioJobPhase to) {
    if (from.isTerminal) return false;
    if (to == StudioJobPhase.failed || to == StudioJobPhase.cancelled || to == StudioJobPhase.completed) return true;
    if (from == to) return true;
    if (from == StudioJobPhase.repairing) {
      return to == StudioJobPhase.editing || to == StudioJobPhase.rendering || to == StudioJobPhase.critiquing;
    }
    return _pipeline.indexOf(to) > _pipeline.indexOf(from);
  }
}

class StudioJob {
  StudioJob({
    required this.id,
    required this.kind,
    required this.phase,
    required this.createdAt,
    required this.updatedAt,
    this.progress,
    this.stage,
    this.errorCode,
    this.errorMessage,
    this.meta = const {},
  });

  final String id;
  final StudioJobKind kind;
  final StudioJobPhase phase;

  /// 0..1 when known; null shows an indeterminate bar.
  final double? progress;

  /// Short human status ("Downloading B-roll…").
  final String? stage;
  final String? errorCode;
  final String? errorMessage;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// Kind-specific data needed to recover after a restart (export: `outputPath`, `nativeJobId`).
  final Json meta;

  bool get isActive => !phase.isTerminal;

  /// Phase shown to the user, worded for the job kind.
  String get phaseLabel => switch (phase) {
        StudioJobPhase.queued => 'Queued',
        StudioJobPhase.analyzing => 'Analyzing',
        StudioJobPhase.planning => 'Planning',
        StudioJobPhase.editing => 'Editing',
        StudioJobPhase.rendering => kind == StudioJobKind.upload ? 'Uploading' : 'Rendering',
        StudioJobPhase.critiquing => kind == StudioJobKind.export ? 'Checking quality' : 'Critiquing',
        StudioJobPhase.repairing => 'Repairing',
        StudioJobPhase.completed => 'Done',
        StudioJobPhase.failed => 'Failed',
        StudioJobPhase.cancelled => 'Cancelled',
      };

  StudioJob _to(StudioJobPhase next, {double? progress, String? stage, String? errorCode, String? errorMessage, Json? meta, DateTime? now}) {
    if (!StudioJobMachine.canTransition(phase, next)) throw IllegalJobTransition(phase, next);
    return StudioJob(
      id: id,
      kind: kind,
      phase: next,
      createdAt: createdAt,
      updatedAt: now ?? DateTime.now(),
      progress: next == StudioJobPhase.completed ? 1 : progress,
      stage: stage ?? (next == phase ? this.stage : null),
      errorCode: errorCode,
      errorMessage: errorMessage,
      meta: meta ?? this.meta,
    );
  }

  StudioJob transition(StudioJobPhase next, {double? progress, String? stage, Json? meta, DateTime? now}) =>
      _to(next, progress: progress, stage: stage, meta: meta, now: now);

  StudioJob fail(String code, String message, {DateTime? now}) =>
      _to(StudioJobPhase.failed, errorCode: code, errorMessage: message, progress: progress, now: now);

  Json toJson() => {
        'id': id,
        'kind': kind.name,
        'phase': phase.wire,
        'progress': ?progress,
        'stage': ?stage,
        'errorCode': ?errorCode,
        'errorMessage': ?errorMessage,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'meta': meta,
      };

  static StudioJob? fromJson(Json j) {
    final kind = StudioJobKind.values.where((k) => k.name == j['kind']).firstOrNull;
    final phase = StudioJobPhase.fromWire(jStr(j['phase']));
    final id = jStr(j['id']);
    final created = jDate(j['createdAt']);
    if (kind == null || phase == null || id == null || created == null) return null;
    return StudioJob(
      id: id,
      kind: kind,
      phase: phase,
      progress: jDouble(j['progress']),
      stage: jStr(j['stage']),
      errorCode: jStr(j['errorCode']),
      errorMessage: jStr(j['errorMessage']),
      createdAt: created,
      updatedAt: jDate(j['updatedAt']) ?? created,
      meta: jMap(j['meta']),
    );
  }
}

/// How a persisted, unfinished export is resolved after the app restarts.
typedef ExportRecovery = Future<StudioJob> Function(StudioJob job);

/// Holds every Studio job, notifies the UI, routes cancel requests and persists jobs so an export
/// interrupted by an app restart is resumed or reported instead of silently vanishing.
class StudioJobStore extends ChangeNotifier {
  StudioJobStore({KeyValueStore? storage}) : _storage = storage;

  static const storageKey = 'studio_jobs_v1';
  static const _keepFinished = 20;

  final KeyValueStore? _storage;
  final List<StudioJob> _jobs = [];
  final Map<String, FutureOr<void> Function()> _cancellers = {};
  int _counter = 0;
  bool _disposed = false;

  List<StudioJob> get jobs => List.unmodifiable(_jobs);
  List<StudioJob> get active => _jobs.where((j) => j.isActive).toList();
  StudioJob? byId(String id) => _jobs.where((j) => j.id == id).firstOrNull;

  /// Most recent job of [kind], if any.
  StudioJob? latest(StudioJobKind kind) => _jobs.where((j) => j.kind == kind).lastOrNull;

  /// Creates a QUEUED job. [onCancel] runs when the user cancels it.
  StudioJob create(StudioJobKind kind, {String? stage, Json meta = const {}, FutureOr<void> Function()? onCancel}) {
    final now = DateTime.now();
    final job = StudioJob(
      id: '${kind.name}_${now.microsecondsSinceEpoch}_${_counter++}',
      kind: kind,
      phase: StudioJobPhase.queued,
      stage: stage,
      createdAt: now,
      updatedAt: now,
      meta: meta,
    );
    _jobs.add(job);
    if (onCancel != null) _cancellers[job.id] = onCancel;
    _changed();
    return job;
  }

  /// Registers or replaces the cancel handler of a live job.
  void onCancel(String id, FutureOr<void> Function() cancel) => _cancellers[id] = cancel;

  /// Moves a job to [phase]. Ignored when the job is unknown or already terminal (a late event
  /// after a cancel), so callers do not need to race-check.
  StudioJob? update(String id, StudioJobPhase phase, {double? progress, String? stage, Json? meta}) {
    final i = _jobs.indexWhere((j) => j.id == id);
    if (i < 0 || _jobs[i].phase.isTerminal) return null;
    final next = _jobs[i].transition(phase, progress: progress, stage: stage, meta: meta == null ? null : {..._jobs[i].meta, ...meta});
    _jobs[i] = next;
    if (next.phase.isTerminal) _cancellers.remove(id);
    _changed();
    return next;
  }

  StudioJob? complete(String id, {Json? meta}) => update(id, StudioJobPhase.completed, meta: meta);

  StudioJob? fail(String id, String code, String message) {
    final i = _jobs.indexWhere((j) => j.id == id);
    if (i < 0 || _jobs[i].phase.isTerminal) return null;
    _jobs[i] = _jobs[i].fail(code, message);
    _cancellers.remove(id);
    _changed();
    return _jobs[i];
  }

  /// Cancels a live job: runs its cancel handler, then marks it CANCELLED.
  Future<void> cancel(String id) async {
    final job = byId(id);
    if (job == null || job.phase.isTerminal) return;
    final c = _cancellers.remove(id);
    // Mark first so events arriving while the native side stops are ignored.
    update(id, StudioJobPhase.cancelled);
    if (c != null) await c();
  }

  /// Removes a finished job from the list (the user dismissed it).
  void dismiss(String id) {
    _jobs.removeWhere((j) => j.id == id && j.phase.isTerminal);
    _changed();
  }

  void _changed() {
    if (_disposed) return;
    notifyListeners();
    unawaited(_persist());
  }

  Future<void> _persist() async {
    final s = _storage;
    if (s == null) return;
    final finished = _jobs.where((j) => j.phase.isTerminal).toList();
    final keep = [
      ..._jobs.where((j) => j.isActive),
      ...finished.skip(finished.length > _keepFinished ? finished.length - _keepFinished : 0),
    ];
    try {
      await s.write(storageKey, jsonEncode([for (final j in keep) j.toJson()]));
    } catch (_) {
      // Persistence is best effort: the live UI state is still correct.
    }
  }

  /// Loads persisted jobs after a restart. Unfinished exports go through [recoverExport] (reattach to
  /// the still-running native render, accept a finished output file, or fail with INTERRUPTED).
  /// Every other unfinished job cannot survive a restart and is reported as INTERRUPTED.
  Future<void> restore({ExportRecovery? recoverExport}) async {
    final s = _storage;
    if (s == null) return;
    String? raw;
    try {
      raw = await s.read(storageKey);
    } catch (_) {
      return;
    }
    if (raw == null || raw.isEmpty) return;
    List<Object?> list;
    try {
      list = jsonDecode(raw) as List<Object?>;
    } catch (_) {
      return;
    }
    for (final e in list.whereType<Map>()) {
      final job = StudioJob.fromJson(e.cast<String, dynamic>());
      if (job == null || byId(job.id) != null) continue;
      if (job.phase.isTerminal) {
        _jobs.add(job);
        continue;
      }
      StudioJob resolved;
      if (job.kind == StudioJobKind.export && recoverExport != null) {
        try {
          resolved = await recoverExport(job);
        } catch (err) {
          resolved = job.fail('INTERRUPTED', 'The export stopped when the app closed. Export again.');
        }
      } else {
        resolved = job.fail('INTERRUPTED', '${job.kind.label} stopped when the app closed. Run it again.');
      }
      _jobs.add(resolved);
    }
    _changed();
  }

  /// Replaces a restored job (used when a recovered export reattaches and later finishes).
  void put(StudioJob job) {
    final i = _jobs.indexWhere((j) => j.id == job.id);
    if (i < 0) {
      _jobs.add(job);
    } else {
      _jobs[i] = job;
    }
    _changed();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
