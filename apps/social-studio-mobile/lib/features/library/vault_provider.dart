import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/storage/clip_store.dart';
import '../../data/models/vault_item.dart';
import '../auth/auth_provider.dart';
import '../projects/project_provider.dart';
import 'library_sync.dart';
import 'vault_storage_service.dart';

final vaultStorageServiceProvider = Provider<VaultStorageService>((ref) => VaultStorageService());
final clipStoreProvider = Provider<ClipStore>((ref) => ClipStore());

final activeFolderIdProvider = StateProvider<String?>((ref) => null);
final vaultSearchQueryProvider = StateProvider<String>((ref) => '');
final vaultTypeFilterProvider = StateProvider<String>((ref) => 'all');

final vaultFoldersProvider =
    AsyncNotifierProvider<VaultFoldersNotifier, List<VaultFolder>>(VaultFoldersNotifier.new);

class VaultFoldersNotifier extends AsyncNotifier<List<VaultFolder>> {
  VaultStorageService get _storage => ref.read(vaultStorageServiceProvider);
  String? get _companyId => ref.watch(sessionProvider).valueOrNull?.company.id;
  String? get _projectId => ref.watch(activeProjectProvider).valueOrNull?.id;

  LibrarySync get _sync => ref.read(librarySyncProvider);

  @override
  Future<List<VaultFolder>> build() async {
    final local = await _storage.loadFolders(companyId: _companyId, projectId: _projectId);
    final server = await _sync.pull();
    if (server == null) return local;
    final merged = await _sync.mergeFolders(local, server.folders);
    await _storage.saveFolders(merged, companyId: _companyId, projectId: _projectId);
    return merged;
  }

  Future<VaultFolder> createFolder({
    required String name,
    int colorValue = 0xFF4F46E5,
    String? parentId,
  }) async {
    final current = state.valueOrNull ?? [];
    final newFolder = VaultFolder(
      id: const Uuid().v4(),
      name: name.trim(),
      colorValue: colorValue,
      parentId: parentId,
    );
    final updated = [...current, newFolder];
    state = AsyncData(updated);
    await _storage.saveFolders(updated, companyId: _companyId, projectId: _projectId);
    _sync.push(folders: [newFolder]);
    return newFolder;
  }

  Future<void> renameFolder(String id, String newName, {int? colorValue}) async {
    final current = state.valueOrNull ?? [];
    final updated = current.map((f) {
      if (f.id == id) {
        return f.copyWith(
          name: newName.trim(),
          colorValue: colorValue ?? f.colorValue,
        );
      }
      return f;
    }).toList();
    state = AsyncData(updated);
    await _storage.saveFolders(updated, companyId: _companyId, projectId: _projectId);
    _sync.push(folders: updated.where((f) => f.id == id).toList());
  }

  Future<void> deleteFolder(String id) async {
    final current = state.valueOrNull ?? [];
    final updated = current.where((f) => f.id != id && f.parentId != id).toList();
    state = AsyncData(updated);
    await _storage.saveFolders(updated, companyId: _companyId, projectId: _projectId);
    _sync.push(deletedFolderIds: [for (final f in current) if (f.id == id || f.parentId == id) f.id]);

    // Delete or unassign items in this folder
    await ref.read(vaultItemsProvider.notifier).deleteItemsInFolder(id);

    // Reset active folder if it was the deleted one
    if (ref.read(activeFolderIdProvider) == id) {
      ref.read(activeFolderIdProvider.notifier).state = null;
    }
  }
}

final vaultItemsProvider =
    AsyncNotifierProvider<VaultItemsNotifier, List<VaultItem>>(VaultItemsNotifier.new);

class VaultItemsNotifier extends AsyncNotifier<List<VaultItem>> {
  VaultStorageService get _storage => ref.read(vaultStorageServiceProvider);
  String? get _companyId => ref.watch(sessionProvider).valueOrNull?.company.id;
  String? get _projectId => ref.watch(activeProjectProvider).valueOrNull?.id;

  LibrarySync get _sync => ref.read(librarySyncProvider);

  @override
  Future<List<VaultItem>> build() async {
    final items = await _rescueCachedTakes(await _storage.loadItems(companyId: _companyId, projectId: _projectId));
    final server = await _sync.pull();
    if (server == null) return items;
    final merged = await _sync.mergeItems(items, server.items);
    await _storage.saveItems(merged, companyId: _companyId, projectId: _projectId);
    return merged;
  }

  /// One-time move of takes recorded before clips were stored durably (they pointed into the OS cache).
  Future<List<VaultItem>> _rescueCachedTakes(List<VaultItem> items) async {
    var changed = false;
    final store = ref.read(clipStoreProvider);
    final out = <VaultItem>[];
    for (final it in items) {
      String? moved;
      try {
        moved = await store.rescueIfTemporary(it.localPath, projectId: _projectId);
      } catch (_) {
        moved = null; // Left in place; the next load retries.
      }
      if (moved != null) changed = true;
      out.add(moved == null ? it : it.copyWith(localPath: moved));
    }
    if (changed) await _storage.saveItems(out, companyId: _companyId, projectId: _projectId);
    return out;
  }

  Future<VaultItem> addItem({
    String? folderId,
    required String name,
    required VaultItemType type,
    String? localPath,
    int fileSizeBytes = 0,
    int durationMs = 0,
    String? noteContent,
    VaultNoteCategory noteCategory = VaultNoteCategory.general,
    List<String> tags = const [],
    String? pieceId,
    int? takeIndex,
  }) async {
    final current = state.valueOrNull ?? [];
    final newItem = VaultItem(
      id: const Uuid().v4(),
      folderId: folderId,
      name: name.trim(),
      type: type,
      localPath: localPath,
      fileSizeBytes: fileSizeBytes,
      durationMs: durationMs,
      noteContent: noteContent,
      noteCategory: noteCategory,
      tags: tags,
      pieceId: pieceId,
      takeIndex: takeIndex,
    );
    final updated = [newItem, ...current];
    state = AsyncData(updated);
    await _storage.saveItems(updated, companyId: _companyId, projectId: _projectId);
    _sync.push(items: [newItem]);
    return newItem;
  }

  Future<void> updateItem(VaultItem item) async {
    final current = state.valueOrNull ?? [];
    final updated = current.map((i) => i.id == item.id ? item : i).toList();
    state = AsyncData(updated);
    await _storage.saveItems(updated, companyId: _companyId, projectId: _projectId);
    _sync.push(items: [item]);
  }

  Future<void> deleteItem(String id) async {
    final current = state.valueOrNull ?? [];
    final removed = current.where((i) => i.id == id).toList();
    final updated = current.where((i) => i.id != id).toList();
    state = AsyncData(updated);
    await _storage.saveItems(updated, companyId: _companyId, projectId: _projectId);
    await _deleteOwnedFiles(removed);
    _sync.push(deletedItemIds: [for (final r in removed) r.id]);
  }

  Future<void> deleteItemsInFolder(String folderId) async {
    final current = state.valueOrNull ?? [];
    final removed = current.where((i) => i.folderId == folderId).toList();
    final updated = current.where((i) => i.folderId != folderId).toList();
    state = AsyncData(updated);
    await _storage.saveItems(updated, companyId: _companyId, projectId: _projectId);
    await _deleteOwnedFiles(removed);
    _sync.push(deletedItemIds: [for (final r in removed) r.id]);
  }

  /// Frees the space of deleted takes recorded in the app; files picked from the gallery are never touched.
  Future<void> _deleteOwnedFiles(List<VaultItem> removed) async {
    final store = ref.read(clipStoreProvider);
    for (final it in removed) {
      try {
        await store.deleteIfOwned(it.localPath);
      } catch (_) {
        // The item is already gone from the library; a leftover file only costs space.
      }
    }
  }

  Future<void> moveItem(String itemId, String? newFolderId) async {
    final current = state.valueOrNull ?? [];
    final updated = current.map((i) {
      if (i.id == itemId) {
        return i.copyWith(folderId: newFolderId);
      }
      return i;
    }).toList();
    state = AsyncData(updated);
    await _storage.saveItems(updated, companyId: _companyId, projectId: _projectId);
    _sync.push(items: updated.where((i) => i.id == itemId).toList());
  }
}

/// Filtered items based on active folder, search query, and type filter
final filteredVaultItemsProvider = Provider<List<VaultItem>>((ref) {
  final items = ref.watch(vaultItemsProvider).valueOrNull ?? [];
  final activeFolderId = ref.watch(activeFolderIdProvider);
  final search = ref.watch(vaultSearchQueryProvider).trim().toLowerCase();
  final typeFilter = ref.watch(vaultTypeFilterProvider);

  return items.where((item) {
    // If inside a folder and no search query active, restrict to this folder
    if (search.isEmpty) {
      if (activeFolderId != null && item.folderId != activeFolderId) {
        return false;
      }
    } else {
      // In global search, match against search query
      final matchesSearch = item.name.toLowerCase().contains(search) ||
          (item.noteContent?.toLowerCase().contains(search) ?? false) ||
          item.tags.any((t) => t.toLowerCase().contains(search));
      if (!matchesSearch) return false;
    }

    // Type filter
    if (typeFilter != 'all') {
      if (typeFilter == 'video' && item.type != VaultItemType.video) return false;
      if (typeFilter == 'image' && item.type != VaultItemType.image) return false;
      if (typeFilter == 'note' && item.type != VaultItemType.note) return false;
      if (typeFilter == 'document' && item.type != VaultItemType.document) return false;
    }

    return true;
  }).toList();
});

/// Folders for current view (root folders or subfolders)
final currentViewFoldersProvider = Provider<List<VaultFolder>>((ref) {
  final folders = ref.watch(vaultFoldersProvider).valueOrNull ?? [];
  final activeFolderId = ref.watch(activeFolderIdProvider);
  final search = ref.watch(vaultSearchQueryProvider).trim().toLowerCase();
  final typeFilter = ref.watch(vaultTypeFilterProvider);

  // If filtering for only media/notes, hide folders unless looking for all
  if (typeFilter != 'all' && typeFilter != 'folder') return [];

  return folders.where((f) {
    if (search.isNotEmpty) {
      return f.name.toLowerCase().contains(search);
    }
    return f.parentId == activeFolderId;
  }).toList();
});
