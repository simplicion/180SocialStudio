import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/vault_item.dart';
import '../library/vault_provider.dart';
import '../projects/project_provider.dart';

/// Shows the dedicated Teleprompter & Library Folder setup sheet before shooting.
Future<void> showTeleprompterSetupSheet(
  BuildContext context, {
  String? projectId,
  VaultFolder? initialFolder,
  String? prefillScript,
  String? prefillHook,
  String? postId,
  String? pieceId,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => TeleprompterSetupSheet(
      projectId: projectId,
      initialFolder: initialFolder,
      prefillScript: prefillScript,
      prefillHook: prefillHook,
      postId: postId,
      pieceId: pieceId,
    ),
  );
}

class TeleprompterSetupSheet extends ConsumerStatefulWidget {
  const TeleprompterSetupSheet({
    super.key,
    this.projectId,
    this.initialFolder,
    this.prefillScript,
    this.prefillHook,
    this.postId,
    this.pieceId,
  });

  final String? projectId;
  final VaultFolder? initialFolder;
  final String? prefillScript;
  final String? prefillHook;
  final String? postId;
  final String? pieceId;

  @override
  ConsumerState<TeleprompterSetupSheet> createState() => _TeleprompterSetupSheetState();
}

class _TeleprompterSetupSheetState extends ConsumerState<TeleprompterSetupSheet> {
  late final TextEditingController _folderNameCtl;
  late final TextEditingController _hookCtl;
  late final TextEditingController _scriptCtl;

  bool _createNewFolder = true;
  String? _selectedFolderId;
  int _selectedColor = 0xFF4F46E5; // Indigo
  double _speed = 1.2;
  double _fontSize = 22.0;
  bool _saving = false;

  static const _palette = [
    0xFF4F46E5, // Indigo
    0xFF10B981, // Emerald
    0xFFF59E0B, // Amber
    0xFFEC4899, // Pink
    0xFF06B6D4, // Cyan
    0xFF8B5CF6, // Purple
  ];

  @override
  void initState() {
    super.initState();
    final nowFormatted = DateFormat('MMM d, h:mm a').format(DateTime.now());
    _folderNameCtl = TextEditingController(
      text: widget.initialFolder?.name ?? 'Take Shoot · $nowFormatted',
    );
    _hookCtl = TextEditingController(text: widget.prefillHook ?? '');
    _scriptCtl = TextEditingController(text: widget.prefillScript ?? '');

    if (widget.initialFolder != null) {
      _createNewFolder = false;
      _selectedFolderId = widget.initialFolder!.id;
      _selectedColor = widget.initialFolder!.colorValue;
    }
  }

  @override
  void dispose() {
    _folderNameCtl.dispose();
    _hookCtl.dispose();
    _scriptCtl.dispose();
    super.dispose();
  }

  int get _wordCount {
    final text = _scriptCtl.text.trim();
    if (text.isEmpty) return 0;
    return text.split(RegExp(r'\s+')).where((s) => s.isNotEmpty).length;
  }

  int get _estReadSeconds {
    final words = _wordCount;
    if (words == 0) return 0;
    // Average speaking speed ~ 130 words/min at 1.0x
    final baseSeconds = (words / 130) * 60;
    return (baseSeconds / _speed).round();
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData('text/plain');
    if (data?.text != null && mounted) {
      setState(() {
        _scriptCtl.text = data!.text!;
      });
      showInfo(context, 'Pasted from clipboard');
    }
  }

  Future<void> _startShooting() async {
    final effectiveProjectId = widget.projectId ?? ref.read(activeProjectProvider).valueOrNull?.id;
    final scriptText = _scriptCtl.text.trim();
    final hookText = _hookCtl.text.trim();

    setState(() => _saving = true);

    String targetFolderId = '';
    String targetFolderName = '';

    try {
      final foldersNotifier = ref.read(vaultFoldersProvider.notifier);
      final itemsNotifier = ref.read(vaultItemsProvider.notifier);

      if (_createNewFolder || _selectedFolderId == null) {
        final folderName = _folderNameCtl.text.trim().isEmpty
            ? 'Shoot · ${DateFormat('MMM d').format(DateTime.now())}'
            : _folderNameCtl.text.trim();

        final created = await foldersNotifier.createFolder(
          name: folderName,
          colorValue: _selectedColor,
        );
        targetFolderId = created.id;
        targetFolderName = created.name;
      } else {
        targetFolderId = _selectedFolderId!;
        final existing = ref
            .read(vaultFoldersProvider)
            .valueOrNull
            ?.where((f) => f.id == targetFolderId)
            .firstOrNull;
        targetFolderName = existing?.name ?? 'Folder';
      }

      // Automatically save the script into this folder in the library
      if (scriptText.isNotEmpty || hookText.isNotEmpty) {
        await itemsNotifier.addItem(
          folderId: targetFolderId,
          name: hookText.isNotEmpty ? hookText : '$targetFolderName Script',
          type: VaultItemType.note,
          noteCategory: VaultNoteCategory.script,
          noteContent: scriptText.isNotEmpty ? scriptText : hookText,
        );
      }

      if (!mounted) return;
      Navigator.of(context).pop();

      // Launch the Teleprompter Camera with complete context
      context.push(
        '/camera',
        extra: {
          'projectId': effectiveProjectId,
          'folderId': targetFolderId,
          'folderName': targetFolderName,
          'script': scriptText,
          'hook': hookText,
          'speed': _speed,
          'fontSize': _fontSize,
          'postId': widget.postId,
          'pieceId': widget.pieceId,
        },
      );
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        showError(context, 'Could not set up shoot folder: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final existingFolders = ref.watch(vaultFoldersProvider).valueOrNull ?? [];
    final wordCount = _wordCount;
    final readSec = _estReadSeconds;

    return DraggableScrollableSheet(
      initialChildSize: 0.88,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (ctx, scroll) => Container(
        decoration: BoxDecoration(
          color: AppTheme.surfaceElevated,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          border: Border.all(color: AppTheme.border.withValues(alpha: 0.6)),
        ),
        child: ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            // Grab handle
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

            // Header with vibrant icon
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.primary, AppTheme.accent],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.videocam_rounded, color: Colors.white, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Teleprompter Camera',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Shoot takes, scroll script, and save all clips into a Library folder',
                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded, size: 20, color: Colors.white60),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Divider(color: AppTheme.border, height: 1),
            const SizedBox(height: 18),

            // ── SECTION 1: Library Folder Destination ──
            Row(
              children: [
                Icon(Icons.folder_special_rounded, color: AppTheme.accent, size: 18),
                const SizedBox(width: 8),
                Text(
                  'Library Folder for Clips',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
                ),
              ],
            ),
            const SizedBox(height: 10),

            if (existingFolders.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: ChoiceChip(
                        label: const Center(child: Text('Create New Folder')),
                        selected: _createNewFolder,
                        onSelected: (val) => setState(() => _createNewFolder = true),
                        selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                        labelStyle: TextStyle(
                          color: _createNewFolder ? AppTheme.primary : AppTheme.textSecondary,
                          fontWeight: _createNewFolder ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ChoiceChip(
                        label: const Center(child: Text('Existing Folder')),
                        selected: !_createNewFolder,
                        onSelected: (val) => setState(() {
                          _createNewFolder = false;
                          _selectedFolderId ??= existingFolders.first.id;
                        }),
                        selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                        labelStyle: TextStyle(
                          color: !_createNewFolder ? AppTheme.primary : AppTheme.textSecondary,
                          fontWeight: !_createNewFolder ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            if (_createNewFolder) ...[
              TextField(
                controller: _folderNameCtl,
                style: const TextStyle(fontSize: 14, color: Colors.white),
                decoration: fieldDecoration(
                  'Folder name (e.g. YouTube Reel · Hook A)',
                  prefix: const Icon(Icons.create_new_folder_rounded, size: 18),
                ),
              ),
              const SizedBox(height: 10),
              // Color selector
              Row(
                children: [
                  Text('Folder Color: ', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(width: 8),
                  for (final c in _palette)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: GestureDetector(
                        onTap: () => setState(() => _selectedColor = c),
                        child: Container(
                          width: 24,
                          height: 24,
                          decoration: BoxDecoration(
                            color: Color(c),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: _selectedColor == c ? Colors.white : Colors.transparent,
                              width: 2.5,
                            ),
                          ),
                          child: _selectedColor == c
                              ? const Icon(Icons.check, size: 14, color: Colors.white)
                              : null,
                        ),
                      ),
                    ),
                ],
              ),
            ] else ...[
              DropdownButtonFormField<String>(
                initialValue: _selectedFolderId ?? existingFolders.first.id,
                decoration: fieldDecoration('Select library folder', prefix: const Icon(Icons.folder_rounded, size: 18)),
                dropdownColor: AppTheme.surfaceElevated,
                items: existingFolders
                    .map((f) => DropdownMenuItem(
                          value: f.id,
                          child: Row(
                            children: [
                              Icon(Icons.folder_rounded, color: f.color, size: 18),
                              const SizedBox(width: 10),
                              Text(f.name, style: const TextStyle(fontSize: 14)),
                            ],
                          ),
                        ))
                    .toList(),
                onChanged: (id) => setState(() => _selectedFolderId = id),
              ),
            ],

            const SizedBox(height: 8),
            Text(
              'All takes recorded during this shoot will automatically be saved into this folder.',
              style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
            ),
            const SizedBox(height: 20),

            // ── SECTION 2: Script & Hook ──
            Row(
              children: [
                Icon(Icons.description_rounded, color: AppTheme.accent, size: 18),
                const SizedBox(width: 8),
                Text(
                  'Teleprompter Script',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _pasteFromClipboard,
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    minimumSize: Size.zero,
                  ),
                  icon: const Icon(Icons.content_paste_rounded, size: 14),
                  label: const Text('Paste', style: TextStyle(fontSize: 12)),
                ),
                if (_scriptCtl.text.isNotEmpty)
                  TextButton(
                    onPressed: () => setState(() => _scriptCtl.clear()),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      minimumSize: Size.zero,
                    ),
                    child: const Text('Clear', style: TextStyle(fontSize: 12, color: Colors.white54)),
                  ),
              ],
            ),
            const SizedBox(height: 8),

            TextField(
              controller: _hookCtl,
              style: const TextStyle(fontSize: 13, color: Colors.white),
              decoration: fieldDecoration(
                'Hook / Title (e.g. Stop scrolling if you want to scale...)',
                prefix: const Icon(Icons.bolt_rounded, size: 18, color: Color(0xFFF59E0B)),
              ),
            ),
            const SizedBox(height: 10),

            TextField(
              controller: _scriptCtl,
              maxLines: 6,
              onChanged: (_) => setState(() {}),
              style: const TextStyle(fontSize: 14, height: 1.45, color: Colors.white),
              decoration: InputDecoration(
                hintText: 'Paste or write your full teleprompter script here...\n\nWhen you hit Record, this text will smoothly scroll on the camera screen for you to read.',
                hintStyle: TextStyle(color: AppTheme.textMuted, fontSize: 13),
                filled: true,
                fillColor: AppTheme.surface,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.primary, width: 1.5)),
              ),
            ),
            const SizedBox(height: 6),

            // Word count & read time indicator
            Row(
              children: [
                Icon(Icons.timer_outlined, size: 14, color: AppTheme.textMuted),
                const SizedBox(width: 4),
                Text(
                  '$wordCount words · ~$readSec seconds at ${_speed.toStringAsFixed(1)}x speed',
                  style: TextStyle(fontSize: 11.5, color: AppTheme.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // ── SECTION 3: Teleprompter Scrolling Speed & Display ──
            Row(
              children: [
                Icon(Icons.speed_rounded, color: AppTheme.accent, size: 18),
                const SizedBox(width: 8),
                Text(
                  'Prompter Scrolling Speed',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '${_speed.toStringAsFixed(1)}x speed',
                    style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),

            Row(
              children: [
                const Text('Slow', style: TextStyle(fontSize: 11, color: Colors.white54)),
                Expanded(
                  child: Slider(
                    value: _speed,
                    min: 0.5,
                    max: 3.0,
                    divisions: 25,
                    activeColor: AppTheme.primary,
                    inactiveColor: Colors.white24,
                    onChanged: (val) => setState(() => _speed = val),
                  ),
                ),
                const Text('Fast', style: TextStyle(fontSize: 11, color: Colors.white54)),
              ],
            ),

            // Speed Presets
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                for (final (label, val) in [
                  ('0.8x Slow', 0.8),
                  ('1.2x Normal', 1.2),
                  ('1.6x Brisk', 1.6),
                  ('2.0x Fast', 2.0),
                ])
                  InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => setState(() => _speed = val),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: (_speed - val).abs() < 0.05
                            ? AppTheme.primary.withValues(alpha: 0.25)
                            : AppTheme.surface,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: (_speed - val).abs() < 0.05
                              ? AppTheme.primary
                              : AppTheme.border,
                        ),
                      ),
                      child: Text(
                        label,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: (_speed - val).abs() < 0.05 ? FontWeight.bold : FontWeight.normal,
                          color: (_speed - val).abs() < 0.05 ? AppTheme.primary : AppTheme.textSecondary,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),

            // Font Size Selection
            Row(
              children: [
                const Icon(Icons.format_size_rounded, color: Colors.white70, size: 18),
                const SizedBox(width: 8),
                const Text('Text Font Size', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                const Spacer(),
                Text('${_fontSize.toInt()} px', style: const TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final (label, size) in [
                    ('Small (18px)', 18.0),
                    ('Medium (22px)', 22.0),
                    ('Large (28px)', 28.0),
                    ('Extra (34px)', 34.0),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(label, style: const TextStyle(fontSize: 11)),
                        selected: (_fontSize - size).abs() < 1.0,
                        onSelected: (_) => setState(() => _fontSize = size),
                        selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                        backgroundColor: AppTheme.surfaceElevated,
                        labelStyle: TextStyle(
                          color: (_fontSize - size).abs() < 1.0 ? AppTheme.primary : Colors.white70,
                          fontWeight: (_fontSize - size).abs() < 1.0 ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // ── ACTION BUTTON: Launch Teleprompter Camera ──
            ElevatedButton.icon(
              onPressed: _saving ? null : _startShooting,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              icon: _saving
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Icon(Icons.videocam_rounded, size: 20),
              label: Text(
                _saving ? 'Preparing Folder...' : 'Open Teleprompter Camera',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
