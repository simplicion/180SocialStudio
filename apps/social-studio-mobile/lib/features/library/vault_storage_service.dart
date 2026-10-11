import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../../data/models/vault_item.dart';

class VaultStorageService {
  String _folderKey(String? companyId, String? projectId) =>
      '180_vault_folders_${companyId ?? 'global'}_${projectId ?? 'global'}_v3';
  String _itemsKey(String? companyId, String? projectId) =>
      '180_vault_items_${companyId ?? 'global'}_${projectId ?? 'global'}_v3';

  String _folderLegacyKey(String? companyId, String? projectId) =>
      '180_vault_folders_${companyId ?? 'global'}_${projectId ?? 'global'}_v2';
  String _itemsLegacyKey(String? companyId, String? projectId) =>
      '180_vault_items_${companyId ?? 'global'}_${projectId ?? 'global'}_v2';

  static const _legacyMockFolderIds = {'folder-reels', 'folder-hooks', 'folder-broll'};
  static const _legacyMockItemIds = {'item-hook-1', 'item-hashtag-1', 'item-script-1'};

  Future<List<VaultFolder>> loadFolders({String? companyId, String? projectId}) async {
    final prefs = await SharedPreferences.getInstance();
    var raw = prefs.getString(_folderKey(companyId, projectId));
    if (raw == null || raw.isEmpty) {
      raw = prefs.getString(_folderLegacyKey(companyId, projectId));
    }
    if (raw == null || raw.isEmpty) return const [];
    try {
      final list = jsonDecode(raw);
      if (list is List) {
        return list
            .map((e) => VaultFolder.fromJson((e as Map).cast<String, dynamic>()))
            .where((f) => !_legacyMockFolderIds.contains(f.id))
            .toList();
      }
    } catch (_) {}
    return const [];
  }

  Future<void> saveFolders(List<VaultFolder> folders, {String? companyId, String? projectId}) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = jsonEncode(folders.map((f) => f.toJson()).toList());
    await prefs.setString(_folderKey(companyId, projectId), raw);
  }

  Future<List<VaultItem>> loadItems({String? companyId, String? projectId}) async {
    final prefs = await SharedPreferences.getInstance();
    var raw = prefs.getString(_itemsKey(companyId, projectId));
    if (raw == null || raw.isEmpty) {
      raw = prefs.getString(_itemsLegacyKey(companyId, projectId));
    }
    if (raw == null || raw.isEmpty) return const [];
    try {
      final list = jsonDecode(raw);
      if (list is List) {
        return list
            .map((e) => VaultItem.fromJson((e as Map).cast<String, dynamic>()))
            .where((i) =>
                !_legacyMockItemIds.contains(i.id) &&
                !_legacyMockFolderIds.contains(i.folderId))
            .toList();
      }
    } catch (_) {}
    return const [];
  }

  Future<void> saveItems(List<VaultItem> items, {String? companyId, String? projectId}) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = jsonEncode(items.map((i) => i.toJson()).toList());
    await prefs.setString(_itemsKey(companyId, projectId), raw);
  }
}

