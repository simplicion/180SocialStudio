import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../network/api_client.dart';
import '../network/api_exception.dart';
import '../util/json.dart';

/// Mirrors the concepts of `apps/frontend/lib/offline/sync-engine.ts` for the mobile app:
///
/// * mutations made while offline are queued (FIFO) with a client-generated idempotency key,
///   sent as the `Idempotency-Key` header so a replay is safe;
/// * network down → stays queued, no retry budget consumed;
/// * 401 → paused until the same user signs in again;
/// * 429 / 5xx / timeout → exponential backoff with jitter, order preserved;
/// * 409 → conflict, 4xx → rejected: surfaced to the user, never dropped silently.
enum OutboxStatus { queued, inFlight, conflict, rejected }

enum SyncState { idle, syncing, offline, error, authRequired }

class OutboxMutation {
  OutboxMutation({
    required this.id,
    required this.clientMutationId,
    required this.userId,
    required this.method,
    required this.path,
    required this.label,
    this.body,
    DateTime? createdAt,
    this.retryCount = 0,
    DateTime? nextAttemptAt,
    this.status = OutboxStatus.queued,
    this.lastError,
  })  : createdAt = createdAt ?? DateTime.now(),
        nextAttemptAt = nextAttemptAt ?? DateTime.now();

  final String id;
  final String clientMutationId;
  final String userId;
  final String method;
  final String path;
  final String label;
  final Object? body;
  final DateTime createdAt;
  int retryCount;
  DateTime nextAttemptAt;
  OutboxStatus status;
  String? lastError;

  bool get needsAttention => status == OutboxStatus.conflict || status == OutboxStatus.rejected;

  Json toJson() => {
        'id': id,
        'clientMutationId': clientMutationId,
        'userId': userId,
        'method': method,
        'path': path,
        'label': label,
        'body': body,
        'createdAt': createdAt.millisecondsSinceEpoch,
        'retryCount': retryCount,
        'nextAttemptAt': nextAttemptAt.millisecondsSinceEpoch,
        'status': status.name,
        'lastError': lastError,
      };

  factory OutboxMutation.fromJson(Json j) {
    final status = OutboxStatus.values.firstWhere((s) => s.name == j['status'], orElse: () => OutboxStatus.queued);
    return OutboxMutation(
      id: j['id'] as String,
      clientMutationId: j['clientMutationId'] as String,
      userId: j['userId'] as String,
      method: j['method'] as String,
      path: j['path'] as String,
      label: (j['label'] as String?) ?? j['path'] as String,
      body: j['body'],
      createdAt: DateTime.fromMillisecondsSinceEpoch(jInt(j['createdAt']) ?? 0),
      retryCount: jInt(j['retryCount']) ?? 0,
      nextAttemptAt: DateTime.fromMillisecondsSinceEpoch(jInt(j['nextAttemptAt']) ?? 0),
      // A crash mid-push leaves rows in flight; the idempotency key makes re-sending safe.
      status: status == OutboxStatus.inFlight ? OutboxStatus.queued : status,
      lastError: j['lastError'] as String?,
    );
  }
}

abstract class OutboxStorage {
  Future<List<Json>> load();
  Future<void> save(List<Json> rows);
}

class FileOutboxStorage implements OutboxStorage {
  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/outbox.json');
  }

  @override
  Future<List<Json>> load() async {
    try {
      final f = await _file();
      if (!await f.exists()) return [];
      final decoded = jsonDecode(await f.readAsString());
      return decoded is List ? decoded.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : [];
    } catch (e) {
      debugPrint('[Outbox] load failed: $e');
      return [];
    }
  }

  @override
  Future<void> save(List<Json> rows) async {
    final f = await _file();
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(jsonEncode(rows), flush: true);
    await tmp.rename(f.path);
  }
}

class MemoryOutboxStorage implements OutboxStorage {
  List<Json> rows = [];

  @override
  Future<List<Json>> load() async => rows.map((r) => Map<String, dynamic>.from(r)).toList();

  @override
  Future<void> save(List<Json> rows) async => this.rows = rows.map((r) => Map<String, dynamic>.from(r)).toList();
}

class Outbox extends ChangeNotifier {
  Outbox({
    required ApiClient api,
    required OutboxStorage storage,
    required String? Function() currentUserId,
    Duration heartbeat = const Duration(seconds: 20),
    Random? random,
  })  : _api = api,
        _storage = storage,
        _currentUserId = currentUserId,
        _heartbeatInterval = heartbeat,
        _random = random ?? Random();

  final ApiClient _api;
  final OutboxStorage _storage;
  final String? Function() _currentUserId;
  final Duration _heartbeatInterval;
  final Random _random;
  final _uuid = Uuid();

  final List<OutboxMutation> _items = [];
  bool _loaded = false;
  bool _draining = false;
  bool online = true;
  SyncState state = SyncState.idle;
  DateTime? lastSyncedAt;
  Timer? _timer;

  static const maxBackoff = Duration(minutes: 10);
  static const maxAge = Duration(days: 7);

  List<OutboxMutation> get items => List.unmodifiable(_items);

  List<OutboxMutation> get mine {
    final uid = _currentUserId();
    return _items.where((m) => m.userId == uid).toList();
  }

  int get pendingCount => mine.where((m) => !m.needsAttention).length;
  int get attentionCount => mine.where((m) => m.needsAttention).length;

  Future<void> init() async {
    if (_loaded) return;
    final rows = await _storage.load();
    _items
      ..clear()
      ..addAll(rows.map(OutboxMutation.fromJson));
    _loaded = true;
    _timer ??= Timer.periodic(_heartbeatInterval, (_) => drain());
    notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _persist() => _storage.save(_items.map((m) => m.toJson()).toList());

  /// Queues a mutation. The caller already tried it online and hit a network failure.
  Future<OutboxMutation> enqueue({
    required String method,
    required String path,
    required String label,
    Object? body,
    String? clientMutationId,
  }) async {
    await init();
    final uid = _currentUserId();
    if (uid == null) {
      throw ApiException(kind: ApiErrorKind.unauthorized, message: 'Sign in to save changes.');
    }
    final m = OutboxMutation(
      id: _uuid.v4(),
      clientMutationId: clientMutationId ?? _uuid.v4(),
      userId: uid,
      method: method,
      path: path,
      label: label,
      body: body,
    );
    _items.add(m);
    online = false;
    state = SyncState.offline;
    await _persist();
    notifyListeners();
    return m;
  }

  /// Called by the HTTP layer whenever a request did or did not reach the server.
  void reportReachable(bool reachable) {
    if (reachable == online) return;
    online = reachable;
    if (!reachable) {
      state = SyncState.offline;
    } else if (state == SyncState.offline) {
      state = SyncState.idle;
    }
    notifyListeners();
    if (reachable) unawaited(drain());
  }

  /// After the same user signs in again.
  void resumeAfterAuth() {
    if (state == SyncState.authRequired) state = SyncState.idle;
    notifyListeners();
    unawaited(drain());
  }

  Duration backoff(int retryCount) {
    final base = Duration(seconds: 2 << min(retryCount, 9));
    final capped = base > maxBackoff ? maxBackoff : base;
    final jitter = _random.nextDouble() * 0.3 * capped.inMilliseconds;
    return Duration(milliseconds: capped.inMilliseconds + jitter.round());
  }

  Future<void> drain({bool force = false}) async {
    await init();
    if (_draining || state == SyncState.authRequired) return;
    final uid = _currentUserId();
    if (uid == null) return;
    _draining = true;
    try {
      while (true) {
        final now = DateTime.now();
        final next = _items.where((m) => m.userId == uid && m.status == OutboxStatus.queued).firstOrNull;
        if (next == null) break;
        if (!force && next.nextAttemptAt.isAfter(now)) break; // order preserved: later ones wait
        if (now.difference(next.createdAt) > maxAge) {
          next.status = OutboxStatus.rejected;
          next.lastError = 'Expired: queued for more than 7 days without reaching the server.';
          await _persist();
          continue;
        }

        state = SyncState.syncing;
        next.status = OutboxStatus.inFlight;
        notifyListeners();
        try {
          await _api.send(next.method, next.path, body: next.body, idempotencyKey: next.clientMutationId);
          _items.remove(next);
          online = true;
          lastSyncedAt = DateTime.now();
          await _persist();
        } on ApiException catch (e) {
          next.lastError = e.message;
          if (e.isNetwork) {
            next.status = OutboxStatus.queued;
            online = false;
            state = SyncState.offline;
            await _persist();
            break;
          }
          if (e.kind == ApiErrorKind.unauthorized) {
            next.status = OutboxStatus.queued;
            state = SyncState.authRequired;
            await _persist();
            break;
          }
          if (e.isTransient) {
            next.status = OutboxStatus.queued;
            next.retryCount++;
            next.nextAttemptAt = DateTime.now().add(backoff(next.retryCount));
            state = SyncState.error;
            await _persist();
            break;
          }
          next.status = e.kind == ApiErrorKind.conflict ? OutboxStatus.conflict : OutboxStatus.rejected;
          await _persist();
        }
      }
      if (state == SyncState.syncing) state = SyncState.idle;
    } finally {
      _draining = false;
      notifyListeners();
    }
  }

  Future<void> retry(String id) async {
    final m = _items.where((x) => x.id == id).firstOrNull;
    if (m == null) return;
    m.status = OutboxStatus.queued;
    m.nextAttemptAt = DateTime.now();
    await _persist();
    notifyListeners();
    await drain(force: true);
  }

  Future<void> discard(String id) async {
    _items.removeWhere((x) => x.id == id);
    await _persist();
    notifyListeners();
  }
}
