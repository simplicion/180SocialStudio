import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../core/providers.dart';
import '../../core/util/json.dart';
import '../../data/models/vault_item.dart';
import '../projects/project_provider.dart';

final librarySyncProvider = Provider<LibrarySync>((ref) => LibrarySync(ref));

/// Keeps the library's metadata (folders, clip names, take order, calendar-piece links, notes) in the database while
/// the media files stay on this phone. Pushes go through the offline outbox; pulls merge into the local cache.
/// The library keeps working offline: a failed sync leaves the local copy untouched and is retried next time.
class LibrarySync {
  LibrarySync(this._ref);
  final Ref _ref;
  static const _deviceKey = 'studio_library_device_id';
  String? _deviceId;

  String? get _projectId => _ref.read(activeProjectProvider).valueOrNull?.id;

  /// Stable id of this install: other devices know a clip's file is not on them.
  Future<String> deviceId() async {
    if (_deviceId != null) return _deviceId!;
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_deviceKey);
    if (id == null) {
      id = const Uuid().v4();
      await prefs.setString(_deviceKey, id);
    }
    return _deviceId = id;
  }

  Future<void> push({
    List<VaultFolder> folders = const [],
    List<VaultItem> items = const [],
    List<String> deletedFolderIds = const [],
    List<String> deletedItemIds = const [],
  }) async {
    if (folders.isEmpty && items.isEmpty && deletedFolderIds.isEmpty && deletedItemIds.isEmpty) return;
    try {
      await _ref.read(socialApiProvider).pushStudioLibrary({
        'projectId': ?_projectId,
        'deviceId': await deviceId(),
        'folders': [for (final f in folders) f.toJson()],
        'items': [for (final i in items) i.toJson()],
        'deletedFolderIds': deletedFolderIds,
        'deletedItemIds': deletedItemIds,
      });
    } catch (e) {
      // Network failures are already queued by the outbox; anything else is retried with the next change.
      debugPrint('[LibrarySync] push failed: $e');
    }
  }

  /// Server rows for this project, or null when the server cannot be reached (the local library is used as is).
  Future<({List<Json> folders, List<Json> items})?> pull() async {
    try {
      return await _ref.read(socialApiProvider).pullStudioLibrary(projectId: _projectId);
    } catch (e) {
      debugPrint('[LibrarySync] pull failed: $e');
      return null;
    }
  }

  /// Merges server items into [local]: newer server metadata wins, but a file path is only kept for clips recorded on
  /// this phone. Server deletions are applied. Local items the server has never seen are pushed.
  Future<List<VaultItem>> mergeItems(List<VaultItem> local, List<Json> server) async {
    final me = await deviceId();
    final byId = {for (final i in local) i.id: i};
    final seen = <String>{};
    for (final row in server) {
      final id = jStrOr(row['id'], '');
      if (id.isEmpty) continue;
      seen.add(id);
      if (row['deletedAt'] != null) {
        byId.remove(id);
        continue;
      }
      final mine = jStr(row['deviceId']) == me;
      final remote = VaultItem.fromJson({...row, if (!mine) 'localPath': null});
      final existing = byId[id];
      if (existing == null) {
        byId[id] = remote;
      } else if (remote.updatedAt.isAfter(existing.updatedAt)) {
        byId[id] = remote.copyWith(localPath: existing.localPath);
      }
    }
    final unsynced = local.where((i) => !seen.contains(i.id)).toList();
    if (unsynced.isNotEmpty) await push(items: unsynced);
    return byId.values.toList();
  }

  Future<List<VaultFolder>> mergeFolders(List<VaultFolder> local, List<Json> server) async {
    final byId = {for (final f in local) f.id: f};
    final seen = <String>{};
    for (final row in server) {
      final id = jStrOr(row['id'], '');
      if (id.isEmpty) continue;
      seen.add(id);
      if (row['deletedAt'] != null) {
        byId.remove(id);
        continue;
      }
      final remote = VaultFolder.fromJson(row);
      final existing = byId[id];
      if (existing == null || remote.updatedAt.isAfter(existing.updatedAt)) byId[id] = remote;
    }
    final unsynced = local.where((f) => !seen.contains(f.id)).toList();
    if (unsynced.isNotEmpty) await push(folders: unsynced);
    return byId.values.toList();
  }
}
