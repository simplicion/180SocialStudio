import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/vault_item.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../projects/project_provider.dart';
import '../studio/teleprompter_setup_sheet.dart';
import 'vault_action_sheet.dart';
import 'vault_provider.dart';

class LibraryScreen extends ConsumerWidget {
  const LibraryScreen({super.key});

  void _openFolderInStudio(BuildContext context, WidgetRef ref, VaultFolder folder) {
    final allItems = ref.read(vaultItemsProvider).valueOrNull ?? [];
    final folderItems = allItems.where((i) => i.folderId == folder.id).toList();

    final videoClips = folderItems.where((i) => i.type == VaultItemType.video).toList();
    final scriptNotes = folderItems.where((i) => i.type == VaultItemType.note).toList();

    final script = scriptNotes.isNotEmpty ? scriptNotes.first.noteContent : null;
    final hook = scriptNotes.isNotEmpty ? scriptNotes.first.name : null;
    final activeProjectId = ref.read(activeProjectProvider).valueOrNull?.id;

    if (videoClips.isEmpty) {
      showTeleprompterSetupSheet(
        context,
        projectId: activeProjectId,
        initialFolder: folder,
        prefillHook: hook,
        prefillScript: script,
      );
      return;
    }

    // Clips synced from another phone have no file here; only local takes can be edited.
    if (!videoClips.any((c) => c.localPath?.isNotEmpty ?? false)) {
      showError(context, 'These clips were recorded on another device. Open this folder on that phone to edit them.');
      return;
    }

    // Studio loads every clip of the folder, in take order (folderId), not just the first one.
    context.push(
      '/studio/session${activeProjectId != null ? '?projectId=$activeProjectId' : ''}',
      extra: {
        'hook': hook,
        'script': script,
        'folderId': folder.id,
        'folderName': folder.name,
      },
    );
  }

  void _shootWithFolderTeleprompter(BuildContext context, WidgetRef ref, VaultFolder folder) {
    final activeProjectId = ref.read(activeProjectProvider).valueOrNull?.id;
    final allItems = ref.read(vaultItemsProvider).valueOrNull ?? [];
    final folderItems = allItems.where((i) => i.folderId == folder.id).toList();
    final scriptNotes = folderItems.where((i) => i.type == VaultItemType.note).toList();
    final script = scriptNotes.isNotEmpty ? scriptNotes.first.noteContent : null;
    final hook = scriptNotes.isNotEmpty ? scriptNotes.first.name : null;

    showTeleprompterSetupSheet(
      context,
      projectId: activeProjectId,
      initialFolder: folder,
      prefillHook: hook,
      prefillScript: script,
    );
  }

  void _openItemInStudio(BuildContext context, WidgetRef ref, VaultItem item) {
    final activeProjectId = ref.read(activeProjectProvider).valueOrNull?.id;

    if (item.type == VaultItemType.video || item.type == VaultItemType.image) {
      context.push(
        '/studio/session${activeProjectId != null ? '?projectId=$activeProjectId' : ''}',
        extra: {
          'sourcePath': item.localPath,
          'hook': item.name,
        },
      );
    } else if (item.type == VaultItemType.note) {
      context.push(
        '/studio/session${activeProjectId != null ? '?projectId=$activeProjectId' : ''}',
        extra: {
          'hook': item.name,
          'script': item.noteContent,
        },
      );
    }
  }

  void _shootWithTeleprompter(BuildContext context, WidgetRef ref, VaultItem item) {
    final activeProjectId = ref.read(activeProjectProvider).valueOrNull?.id;
    final allFolders = ref.read(vaultFoldersProvider).valueOrNull ?? [];
    final currentFolder = item.folderId != null
        ? allFolders.where((f) => f.id == item.folderId).firstOrNull
        : null;

    showTeleprompterSetupSheet(
      context,
      projectId: activeProjectId,
      initialFolder: currentFolder,
      prefillHook: item.name,
      prefillScript: item.noteContent,
    );
  }

  Future<void> _showMoveDialog(BuildContext context, WidgetRef ref, VaultItem item) async {
    final folders = ref.read(vaultFoldersProvider).valueOrNull ?? [];
    final selectedFolderId = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.surfaceElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Move to Folder'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView(
            shrinkWrap: true,
            children: [
              ListTile(
                leading: const Icon(Icons.folder_off_rounded, color: Colors.white70),
                title: const Text('Vault Root (No folder)'),
                selected: item.folderId == null,
                onTap: () => Navigator.pop(ctx, ''),
              ),
              const Divider(),
              ...folders.map(
                (f) => ListTile(
                  leading: Icon(Icons.folder_rounded, color: f.color),
                  title: Text(f.name),
                  selected: item.folderId == f.id,
                  onTap: () => Navigator.pop(ctx, f.id),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, null), child: const Text('Cancel')),
        ],
      ),
    );

    if (selectedFolderId != null && context.mounted) {
      final newFolderId = selectedFolderId.isEmpty ? null : selectedFolderId;
      await ref.read(vaultItemsProvider.notifier).moveItem(item.id, newFolderId);
      if (context.mounted) showSuccess(context, 'Moved "${item.name}"');
    }
  }

  void _showNoteModal(BuildContext context, WidgetRef ref, VaultItem item) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surfaceElevated,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.4,
        maxChildSize: 0.9,
        expand: false,
        builder: (ctx, scroll) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: ListView(
            controller: scroll,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: item.noteCategory.color.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      item.noteCategory.label.toUpperCase(),
                      style: TextStyle(
                        color: item.noteCategory.color,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Edit Note',
                    icon: const Icon(Icons.edit_outlined, size: 20),
                    onPressed: () {
                      Navigator.pop(ctx);
                      showCreateNoteDialog(context, ref, existing: item);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                item.name,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppTheme.background,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.border.withValues(alpha: 0.5)),
                ),
                child: SelectableText(
                  item.noteContent ?? '(Empty note)',
                  style: const TextStyle(fontSize: 14, height: 1.5, color: Colors.white),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('Copy Text'),
                      onPressed: () async {
                        if (item.noteContent != null && item.noteContent!.isNotEmpty) {
                          await Clipboard.setData(ClipboardData(text: item.noteContent!));
                          if (context.mounted) {
                            showSuccess(context, 'Copied note content to clipboard');
                          }
                        }
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
                      icon: const Icon(Icons.videocam_rounded, size: 18),
                      label: const Text('Teleprompter'),
                      onPressed: () {
                        Navigator.pop(ctx);
                        _shootWithTeleprompter(context, ref, item);
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primary),
                icon: const Icon(Icons.movie_creation_rounded, size: 18),
                label: const Text('Open & Sequence in Video Studio'),
                onPressed: () {
                  Navigator.pop(ctx);
                  _openItemInStudio(context, ref, item);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final activeFolderId = ref.watch(activeFolderIdProvider);
    final allFolders = ref.watch(vaultFoldersProvider).valueOrNull ?? [];
    final currentFolder = activeFolderId != null
        ? allFolders.where((f) => f.id == activeFolderId).firstOrNull
        : null;

    final folders = ref.watch(currentViewFoldersProvider);
    final items = ref.watch(filteredVaultItemsProvider);
    final allItems = ref.watch(vaultItemsProvider).valueOrNull ?? [];
    final search = ref.watch(vaultSearchQueryProvider);
    final activeFilter = ref.watch(vaultTypeFilterProvider);

    return Scaffold(
      appBar: workspaceAppBar(
        context,
        ref,
        actions: [
          if (currentFolder != null) ...[
            IconButton(
              tooltip: 'Shoot with Teleprompter for this folder',
              icon: const Icon(Icons.videocam_rounded, color: Color(0xFF3B82F6)),
              onPressed: () => _shootWithFolderTeleprompter(context, ref, currentFolder),
            ),
            IconButton(
              tooltip: 'Edit all folder clips in Video Studio',
              icon: const Icon(Icons.movie_creation_rounded, color: Color(0xFF10B981)),
              onPressed: () => _openFolderInStudio(context, ref, currentFolder),
            ),
          ],
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'library.vault.fab',
        icon: const Icon(Icons.add_rounded, size: 24),
        label: const Text('Add to Vault', style: TextStyle(fontWeight: FontWeight.w700)),
        backgroundColor: AppTheme.primary,
        onPressed: () => showVaultActionSheet(context, ref),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(vaultFoldersProvider);
          ref.invalidate(vaultItemsProvider);
        },
        child: CustomScrollView(
          slivers: [
            // ── Search & Filter Header ──
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Search Bar
                    TextField(
                      onChanged: (v) => ref.read(vaultSearchQueryProvider.notifier).state = v,
                      decoration: InputDecoration(
                        hintText: 'Search clips, folders, hooks, notes...',
                        prefixIcon: const Icon(Icons.search_rounded, size: 20),
                        suffixIcon: search.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.close_rounded, size: 18),
                                onPressed: () => ref.read(vaultSearchQueryProvider.notifier).state = '',
                              )
                            : null,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        filled: true,
                        fillColor: AppTheme.surfaceElevated,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: AppTheme.border),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: AppTheme.border),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: AppTheme.primary),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),

                    // Filter Pills
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          _FilterChip(
                            label: 'All',
                            icon: Icons.dashboard_rounded,
                            selected: activeFilter == 'all',
                            onTap: () => ref.read(vaultTypeFilterProvider.notifier).state = 'all',
                          ),
                          _FilterChip(
                            label: 'Folders',
                            icon: Icons.folder_rounded,
                            selected: activeFilter == 'folder',
                            onTap: () => ref.read(vaultTypeFilterProvider.notifier).state = 'folder',
                          ),
                          _FilterChip(
                            label: 'Videos',
                            icon: Icons.videocam_rounded,
                            selected: activeFilter == 'video',
                            onTap: () => ref.read(vaultTypeFilterProvider.notifier).state = 'video',
                          ),
                          _FilterChip(
                            label: 'Notes & Hooks',
                            icon: Icons.edit_note_rounded,
                            selected: activeFilter == 'note',
                            onTap: () => ref.read(vaultTypeFilterProvider.notifier).state = 'note',
                          ),
                          _FilterChip(
                            label: 'Photos',
                            icon: Icons.image_rounded,
                            selected: activeFilter == 'image',
                            onTap: () => ref.read(vaultTypeFilterProvider.notifier).state = 'image',
                          ),
                          _FilterChip(
                            label: 'Docs',
                            icon: Icons.description_rounded,
                            selected: activeFilter == 'document',
                            onTap: () => ref.read(vaultTypeFilterProvider.notifier).state = 'document',
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // ── Breadcrumb Navigation ──
            if (activeFolderId != null && currentFolder != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceElevated,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppTheme.border),
                    ),
                    child: Row(
                      children: [
                        InkWell(
                          onTap: () => ref.read(activeFolderIdProvider.notifier).state = null,
                          child: Row(
                            children: [
                              const Icon(Icons.arrow_back_rounded, size: 16, color: Colors.white70),
                              const SizedBox(width: 6),
                              Text('Vault Root', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.w600, fontSize: 13)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Icon(Icons.chevron_right_rounded, size: 16, color: Colors.white38),
                        const SizedBox(width: 8),
                        Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(color: currentFolder.color, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            currentFolder.name,
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        IconButton(
                          tooltip: 'Shoot clips with Teleprompter',
                          icon: const Icon(Icons.videocam_rounded, size: 20, color: Color(0xFF3B82F6)),
                          visualDensity: VisualDensity.compact,
                          onPressed: () => _shootWithFolderTeleprompter(context, ref, currentFolder),
                        ),
                        IconButton(
                          tooltip: 'Edit in Video Studio',
                          icon: const Icon(Icons.movie_creation_rounded, size: 20, color: Color(0xFF10B981)),
                          visualDensity: VisualDensity.compact,
                          onPressed: () => _openFolderInStudio(context, ref, currentFolder),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // ── Folders Section ──
            if (folders.isNotEmpty) ...[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: SectionHeader(
                    activeFolderId != null ? 'Sub-folders' : 'Folders & Collections',
                    trailing: Text(
                      '${folders.length} folder${folders.length > 1 ? 's' : ''}',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 1.15,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (ctx, i) {
                      final folder = folders[i];
                      final folderItemCount = allItems.where((it) => it.folderId == folder.id).length;
                      final videoCount = allItems.where((it) => it.folderId == folder.id && it.type == VaultItemType.video).length;

                      return _FolderCard(
                        folder: folder,
                        itemCount: folderItemCount,
                        videoCount: videoCount,
                        onTap: () => ref.read(activeFolderIdProvider.notifier).state = folder.id,
                        onEditInStudio: () => _openFolderInStudio(context, ref, folder),
                        onShootTeleprompter: () => _shootWithFolderTeleprompter(context, ref, folder),
                        onAddNote: () => showCreateNoteDialog(context, ref),
                        onEdit: () => showCreateFolderDialog(context, ref, existing: folder),
                        onDelete: () async {
                          final ok = await confirm(
                            context,
                            title: 'Delete folder "${folder.name}"?',
                            message: 'This will remove the folder and unassign its items.',
                            action: 'Delete',
                            destructive: true,
                          );
                          if (ok && context.mounted) {
                            await ref.read(vaultFoldersProvider.notifier).deleteFolder(folder.id);
                            if (context.mounted) showSuccess(context, 'Folder deleted');
                          }
                        },
                      );
                    },
                    childCount: folders.length,
                  ),
                ),
              ),
            ],

            // ── Items Section ──
            if (items.isNotEmpty || folders.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                  child: SectionHeader(
                    activeFolderId != null ? 'Folder Files & Notes' : 'Files, Media & Notes',
                    trailing: Text(
                      '${items.length} item${items.length > 1 ? 's' : ''}',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                ),
              ),

            if (items.isEmpty && folders.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: EmptyView(
                  icon: Icons.video_collection_rounded,
                  title: search.isNotEmpty ? 'No matching items' : 'Vault is empty',
                  message: search.isNotEmpty
                      ? 'Try searching with different keywords or tags.'
                      : 'Store raw video clips, B-roll, hooks, scripts, and PDFs locally.',
                  actionLabel: 'Add to Vault',
                  onAction: () => showVaultActionSheet(context, ref),
                ),
              )
            else if (items.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Center(
                    child: Text(
                      'No media or notes in this view yet.',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.textSecondary),
                    ),
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (ctx, i) {
                      final item = items[i];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _VaultItemTile(
                          item: item,
                          onTap: item.type == VaultItemType.note
                              ? () => _showNoteModal(context, ref, item)
                              : () => _openItemInStudio(context, ref, item),
                          onOpenInStudio: () => _openItemInStudio(context, ref, item),
                          onTeleprompter: item.type == VaultItemType.note
                              ? () => _shootWithTeleprompter(context, ref, item)
                              : null,
                          onMove: () => _showMoveDialog(context, ref, item),
                          onEdit: item.type == VaultItemType.note
                              ? () => showCreateNoteDialog(context, ref, existing: item)
                              : null,
                          onDelete: () async {
                            final ok = await confirm(
                              context,
                              title: 'Delete "${item.name}"?',
                              message: 'This will remove the item from your Vault.',
                              action: 'Delete',
                              destructive: true,
                            );
                            if (ok && context.mounted) {
                              await ref.read(vaultItemsProvider.notifier).deleteItem(item.id);
                              if (context.mounted) showSuccess(context, 'Item deleted');
                            }
                          },
                        ),
                      );
                    },
                    childCount: items.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        avatar: Icon(icon, size: 14, color: selected ? AppTheme.primary : AppTheme.textSecondary),
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        selectedColor: AppTheme.primary.withValues(alpha: 0.18),
        checkmarkColor: AppTheme.primary,
        labelStyle: TextStyle(
          color: selected ? AppTheme.primary : AppTheme.textSecondary,
          fontWeight: selected ? FontWeight.bold : FontWeight.normal,
          fontSize: 12,
        ),
        backgroundColor: AppTheme.surfaceElevated,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(
            color: selected ? AppTheme.primary.withValues(alpha: 0.4) : AppTheme.border,
          ),
        ),
      ),
    );
  }
}

class _FolderCard extends StatelessWidget {
  const _FolderCard({
    required this.folder,
    required this.itemCount,
    required this.videoCount,
    required this.onTap,
    required this.onEditInStudio,
    required this.onShootTeleprompter,
    required this.onAddNote,
    required this.onEdit,
    required this.onDelete,
  });

  final VaultFolder folder;
  final int itemCount;
  final int videoCount;
  final VoidCallback onTap;
  final VoidCallback onEditInStudio;
  final VoidCallback onShootTeleprompter;
  final VoidCallback onAddNote;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.surfaceElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: folder.color.withValues(alpha: 0.35), width: 1.2),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: folder.color.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(7),
                    ),
                    child: Icon(Icons.folder_rounded, color: folder.color, size: 16),
                  ),
                  const Spacer(),
                  PopupMenuButton<String>(
                    padding: EdgeInsets.zero,
                    iconSize: 18,
                    icon: const Icon(Icons.more_vert_rounded, color: Colors.white60),
                    color: AppTheme.surfaceElevated,
                    onSelected: (v) {
                      if (v == 'studio') onEditInStudio();
                      if (v == 'prompter') onShootTeleprompter();
                      if (v == 'add_note') onAddNote();
                      if (v == 'edit') onEdit();
                      if (v == 'delete') onDelete();
                    },
                    itemBuilder: (_) => [
                      const PopupMenuItem(
                        value: 'studio',
                        child: Row(
                          children: [
                            Icon(Icons.movie_creation_rounded, size: 18, color: Color(0xFF10B981)),
                            SizedBox(width: 8),
                            Text('Edit in Video Studio'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'prompter',
                        child: Row(
                          children: [
                            Icon(Icons.videocam_rounded, size: 18, color: Color(0xFF3B82F6)),
                            SizedBox(width: 8),
                            Text('Shoot with Teleprompter'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'add_note',
                        child: Row(
                          children: [
                            Icon(Icons.note_add_rounded, size: 18, color: Color(0xFFF59E0B)),
                            SizedBox(width: 8),
                            Text('Add Note / Script inside'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'edit',
                        child: Row(
                          children: [
                            Icon(Icons.edit_rounded, size: 18),
                            SizedBox(width: 8),
                            Text('Rename Folder'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(Icons.delete_outline_rounded, size: 18, color: Colors.redAccent),
                            SizedBox(width: 8),
                            Text('Delete Folder', style: TextStyle(color: Colors.redAccent)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    folder.name,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 1),
                  Text(
                    '$itemCount item${itemCount != 1 ? 's' : ''}${videoCount > 0 ? ' · $videoCount clips' : ''}',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(fontSize: 10),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _VaultItemTile extends StatelessWidget {
  const _VaultItemTile({
    required this.item,
    required this.onTap,
    required this.onOpenInStudio,
    this.onTeleprompter,
    required this.onMove,
    this.onEdit,
    required this.onDelete,
  });

  final VaultItem item;
  final VoidCallback onTap;
  final VoidCallback onOpenInStudio;
  final VoidCallback? onTeleprompter;
  final VoidCallback onMove;
  final VoidCallback? onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final isNote = item.type == VaultItemType.note;
    final isVideo = item.type == VaultItemType.video;
    final isImage = item.type == VaultItemType.image;
    final isDoc = item.type == VaultItemType.document;

    return SectionCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Type Icon Badge
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: isNote
                      ? item.noteCategory.color.withValues(alpha: 0.18)
                      : isVideo
                          ? const Color(0xFF10B981).withValues(alpha: 0.18)
                          : isImage
                              ? const Color(0xFF3B82F6).withValues(alpha: 0.18)
                              : const Color(0xFF06B6D4).withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  isNote
                      ? Icons.edit_note_rounded
                      : isVideo
                          ? Icons.videocam_rounded
                          : isImage
                              ? Icons.image_rounded
                              : Icons.description_rounded,
                  color: isNote
                      ? item.noteCategory.color
                      : isVideo
                          ? const Color(0xFF10B981)
                          : isImage
                              ? const Color(0xFF3B82F6)
                              : const Color(0xFF06B6D4),
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),

              // Title & Meta Info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (isNote) ...[
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: item.noteCategory.color.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              item.noteCategory.label.toUpperCase(),
                              style: TextStyle(
                                color: item.noteCategory.color,
                                fontSize: 9,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                        ],
                        Expanded(
                          child: Text(
                            item.name,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      isVideo
                          ? '${item.formattedSize} · Local Video'
                          : isImage
                              ? '${item.formattedSize} · Image'
                              : isDoc
                                  ? '${item.formattedSize} · Document'
                                  : timeAgo(item.createdAt),
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(fontSize: 10),
                    ),
                  ],
                ),
              ),

              // Quick Actions
              if (isNote)
                IconButton(
                  tooltip: 'Copy Note Content',
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  onPressed: () async {
                    if (item.noteContent != null && item.noteContent!.isNotEmpty) {
                      await Clipboard.setData(ClipboardData(text: item.noteContent!));
                      if (context.mounted) showSuccess(context, 'Copied "${item.name}" to clipboard');
                    }
                  },
                ),

              if (isVideo || isNote)
                IconButton(
                  tooltip: 'Open in Video Studio',
                  icon: const Icon(Icons.movie_creation_outlined, size: 18, color: Color(0xFF10B981)),
                  onPressed: onOpenInStudio,
                ),

              PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert_rounded, size: 18, color: Colors.white60),
                color: AppTheme.surfaceElevated,
                onSelected: (v) {
                  if (v == 'studio') onOpenInStudio();
                  if (v == 'teleprompter' && onTeleprompter != null) onTeleprompter!();
                  if (v == 'move') onMove();
                  if (v == 'edit' && onEdit != null) onEdit!();
                  if (v == 'delete') onDelete();
                },
                itemBuilder: (_) => [
                  if (isVideo || isNote)
                    const PopupMenuItem(
                      value: 'studio',
                      child: Row(
                        children: [
                          Icon(Icons.movie_creation_rounded, size: 18, color: Color(0xFF10B981)),
                          SizedBox(width: 8),
                          Text('Open in Video Studio'),
                        ],
                      ),
                    ),
                  if (isNote && onTeleprompter != null)
                    const PopupMenuItem(
                      value: 'teleprompter',
                      child: Row(
                        children: [
                          Icon(Icons.videocam_rounded, size: 18, color: Color(0xFF10B981)),
                          SizedBox(width: 8),
                          Text('Shoot with Teleprompter'),
                        ],
                      ),
                    ),
                  const PopupMenuItem(
                    value: 'move',
                    child: Row(
                      children: [
                        Icon(Icons.drive_file_move_rounded, size: 18),
                        SizedBox(width: 8),
                        Text('Move to Folder'),
                      ],
                    ),
                  ),
                  if (onEdit != null)
                    const PopupMenuItem(
                      value: 'edit',
                      child: Row(
                        children: [
                          Icon(Icons.edit_rounded, size: 18),
                          SizedBox(width: 8),
                          Text('Edit Note'),
                        ],
                      ),
                    ),
                  const PopupMenuItem(
                    value: 'delete',
                    child: Row(
                      children: [
                        Icon(Icons.delete_outline_rounded, size: 18, color: Colors.redAccent),
                        SizedBox(width: 8),
                        Text('Delete Item', style: TextStyle(color: Colors.redAccent)),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),

          // Note Content Snippet preview
          if (isNote && item.noteContent != null && item.noteContent!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.background,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppTheme.border.withValues(alpha: 0.5)),
              ),
              child: Text(
                item.noteContent!,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Colors.white70,
                      fontSize: 12,
                      height: 1.3,
                    ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
