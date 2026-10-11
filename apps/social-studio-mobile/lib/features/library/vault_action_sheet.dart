import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/vault_item.dart';
import 'vault_provider.dart';

const List<int> _folderColors = [
  0xFF4F46E5, // Indigo
  0xFF10B981, // Emerald
  0xFFF59E0B, // Amber
  0xFF06B6D4, // Cyan
  0xFF8B5CF6, // Purple
  0xFFEC4899, // Pink
  0xFFEF4444, // Red
  0xFF3B82F6, // Blue
];

void showVaultActionSheet(BuildContext context, WidgetRef ref) {
  showModalBottomSheet(
    context: context,
    backgroundColor: AppTheme.surfaceElevated,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(Icons.add_to_photos_rounded, color: AppTheme.primary, size: 18),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    'Add to Library Vault',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ],
              ),
            ),
            const Divider(height: 16),
            _ActionTile(
              icon: Icons.create_new_folder_rounded,
              color: const Color(0xFF4F46E5),
              title: 'New Folder',
              subtitle: 'Create a categorized collection for clips, notes & scripts',
              onTap: () {
                Navigator.pop(ctx);
                showCreateFolderDialog(context, ref);
              },
            ),
            _ActionTile(
              icon: Icons.video_library_rounded,
              color: const Color(0xFF10B981),
              title: 'Import Videos & Photos',
              subtitle: 'Add raw footage and images directly from your device',
              onTap: () {
                Navigator.pop(ctx);
                _pickMediaFiles(context, ref);
              },
            ),
            _ActionTile(
              icon: Icons.edit_note_rounded,
              color: const Color(0xFFF59E0B),
              title: 'Create Note, Hook or Script',
              subtitle: 'Store viral hooks, hashtag banks, keywords and voiceover scripts',
              onTap: () {
                Navigator.pop(ctx);
                showCreateNoteDialog(context, ref);
              },
            ),
            _ActionTile(
              icon: Icons.description_rounded,
              color: const Color(0xFF06B6D4),
              title: 'Import Document (PDF / TXT)',
              subtitle: 'Attach project briefs, shoot lists and creative guidelines',
              onTap: () {
                Navigator.pop(ctx);
                _pickDocuments(context, ref);
              },
            ),
          ],
        ),
      ),
    ),
  );
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Icon(icon, color: color, size: 22),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
      subtitle: Text(subtitle, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11)),
      onTap: onTap,
    );
  }
}

Future<void> _pickMediaFiles(BuildContext context, WidgetRef ref) async {
  try {
    final picker = ImagePicker();
    final mediaList = await picker.pickMultipleMedia();
    if (mediaList.isEmpty || !context.mounted) return;

    final activeFolderId = ref.read(activeFolderIdProvider);
    var addedCount = 0;

    for (final file in mediaList) {
      final isVideo = file.name.endsWith('.mp4') ||
          file.name.endsWith('.mov') ||
          file.name.endsWith('.webm') ||
          file.name.endsWith('.m4v') ||
          file.mimeType?.startsWith('video/') == true;

      final length = await file.length();

      await ref.read(vaultItemsProvider.notifier).addItem(
            folderId: activeFolderId,
            name: file.name,
            type: isVideo ? VaultItemType.video : VaultItemType.image,
            localPath: file.path,
            fileSizeBytes: length,
            tags: [isVideo ? 'video' : 'photo', 'local-media'],
          );
      addedCount++;
    }

    if (context.mounted) {
      showSuccess(context, 'Imported $addedCount media file${addedCount > 1 ? 's' : ''} to Vault');
    }
  } catch (e) {
    if (context.mounted) showError(context, 'Failed to import media: $e');
  }
}

Future<void> _pickDocuments(BuildContext context, WidgetRef ref) async {
  try {
    final result = await FilePickerPlatform.instance.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'],
    );
    if (result.isEmpty || !context.mounted) return;

    final activeFolderId = ref.read(activeFolderIdProvider);
    var addedCount = 0;

    for (final file in result) {
      var size = 0;
      if (file.path != null) {
        try {
          size = await XFile(file.path!).length();
        } catch (_) {}
      }
      await ref.read(vaultItemsProvider.notifier).addItem(
            folderId: activeFolderId,
            name: file.name,
            type: VaultItemType.document,
            localPath: file.path,
            fileSizeBytes: size,
            tags: ['document', if (file.extension != null) file.extension!],
          );
      addedCount++;
    }

    if (context.mounted) {
      showSuccess(context, 'Imported $addedCount document${addedCount > 1 ? 's' : ''}');
    }
  } catch (e) {
    if (context.mounted) showError(context, 'Failed to import documents: $e');
  }
}

Future<void> showCreateFolderDialog(BuildContext context, WidgetRef ref, {VaultFolder? existing}) async {
  final isEdit = existing != null;
  final nameController = TextEditingController(text: existing?.name ?? '');
  var selectedColor = existing?.colorValue ?? _folderColors.first;

  final created = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        backgroundColor: AppTheme.surfaceElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(isEdit ? 'Edit Folder' : 'New Folder'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: nameController,
              autofocus: true,
              decoration: fieldDecoration('Folder Name', hint: 'e.g. October Reels, Product Launch'),
            ),
            const SizedBox(height: 16),
            Text('Folder Accent Color', style: Theme.of(ctx).textTheme.labelMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _folderColors.map((c) {
                final isSelected = selectedColor == c;
                return GestureDetector(
                  onTap: () => setState(() => selectedColor = c),
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: Color(c),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: isSelected ? Colors.white : Colors.transparent,
                        width: 2.5,
                      ),
                      boxShadow: isSelected
                          ? [BoxShadow(color: Color(c).withValues(alpha: 0.5), blurRadius: 6)]
                          : null,
                    ),
                    child: isSelected
                        ? const Icon(Icons.check, size: 16, color: Colors.white)
                        : null,
                  ),
                );
              }).toList(),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              if (nameController.text.trim().isEmpty) return;
              Navigator.pop(ctx, true);
            },
            child: Text(isEdit ? 'Save' : 'Create'),
          ),
        ],
      ),
    ),
  );

  if (created == true && context.mounted) {
    final name = nameController.text.trim();
    if (isEdit) {
      await ref.read(vaultFoldersProvider.notifier).renameFolder(
            existing.id,
            name,
            colorValue: selectedColor,
          );
      if (context.mounted) showSuccess(context, 'Folder updated');
    } else {
      final activeFolderId = ref.read(activeFolderIdProvider);
      await ref.read(vaultFoldersProvider.notifier).createFolder(
            name: name,
            colorValue: selectedColor,
            parentId: activeFolderId,
          );
      if (context.mounted) showSuccess(context, 'Folder "$name" created');
    }
  }
}

Future<void> showCreateNoteDialog(BuildContext context, WidgetRef ref, {VaultItem? existing}) async {
  final isEdit = existing != null;
  final titleController = TextEditingController(text: existing?.name ?? '');
  final contentController = TextEditingController(text: existing?.noteContent ?? '');
  final tagsController = TextEditingController(text: existing?.tags.join(', ') ?? '');
  var selectedCategory = existing?.noteCategory ?? VaultNoteCategory.hook;

  final saved = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => AlertDialog(
        backgroundColor: AppTheme.surfaceElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(isEdit ? 'Edit Note' : 'Create Note / Hook / Script'),
        content: SizedBox(
          width: double.maxFinite,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Category', style: Theme.of(ctx).textTheme.labelMedium),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: VaultNoteCategory.values.map((cat) {
                      final isSelected = selectedCategory == cat;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ChoiceChip(
                          label: Text(cat.label),
                          selected: isSelected,
                          selectedColor: cat.color.withValues(alpha: 0.25),
                          labelStyle: TextStyle(
                            color: isSelected ? cat.color : AppTheme.textSecondary,
                            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                            fontSize: 12,
                          ),
                          onSelected: (_) => setState(() => selectedCategory = cat),
                        ),
                      );
                    }).toList(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: titleController,
                  decoration: fieldDecoration('Title', hint: 'e.g. 3-Sec Pattern Interrupt, Core Hashtags'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: contentController,
                  maxLines: 5,
                  decoration: fieldDecoration(
                    'Content / Script / Hooks',
                    hint: selectedCategory == VaultNoteCategory.hashtag
                        ? '#reels #growth #contentcreator'
                        : 'Write hook ideas, keywords, or full video outline here...',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: tagsController,
                  decoration: fieldDecoration('Tags (comma-separated)', hint: 'viral, instagram, q4'),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              if (titleController.text.trim().isEmpty && contentController.text.trim().isEmpty) return;
              Navigator.pop(ctx, true);
            },
            child: Text(isEdit ? 'Save' : 'Create Note'),
          ),
        ],
      ),
    ),
  );

  if (saved == true && context.mounted) {
    final title = titleController.text.trim().isEmpty ? 'Untitled Note' : titleController.text.trim();
    final content = contentController.text.trim();
    final tags = splitList(tagsController.text);

    if (isEdit) {
      await ref.read(vaultItemsProvider.notifier).updateItem(
            existing.copyWith(
              name: title,
              noteContent: content,
              noteCategory: selectedCategory,
              tags: tags,
            ),
          );
      if (context.mounted) showSuccess(context, 'Note updated');
    } else {
      final activeFolderId = ref.read(activeFolderIdProvider);
      await ref.read(vaultItemsProvider.notifier).addItem(
            folderId: activeFolderId,
            name: title,
            type: VaultItemType.note,
            noteContent: content,
            noteCategory: selectedCategory,
            tags: tags,
          );
      if (context.mounted) showSuccess(context, 'Note "$title" saved');
    }
  }
}
