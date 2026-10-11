import 'dart:io';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/content_calendar.dart';
import '../../data/models/vault_item.dart';
import '../library/vault_provider.dart';
import 'planner_providers.dart';

final _defaultName = RegExp(r'^Clip \d+$');

/// The takes shot for one calendar piece, kept on this device in take order.
List<VaultItem> pieceClips(List<VaultItem> all, String pieceId) => all
    .where((i) => i.pieceId == pieceId && i.type == VaultItemType.video && (i.localPath?.isNotEmpty ?? false))
    .toList()
  ..sort((a, b) {
    final t = (a.takeIndex ?? 1 << 30).compareTo(b.takeIndex ?? 1 << 30);
    return t != 0 ? t : a.createdAt.compareTo(b.createdAt);
  });

/// Shoot → review clips → "Shooting done" → "Edit N clips in Studio", inside the calendar piece sheet.
class PieceClipsSection extends ConsumerWidget {
  const PieceClipsSection({
    super.key,
    required this.piece,
    required this.status,
    required this.projectId,
    required this.hook,
    required this.script,
    this.onStatusChanged,
  });

  final CalendarPiece piece;
  /// The piece's current status as shown in the sheet (may be newer than [piece]).
  final PieceStatus status;
  final String? projectId;
  final String hook;
  final String script;
  final ValueChanged<PieceStatus>? onStatusChanged;

  String get _folderName {
    final h = piece.headline.trim();
    final day = piece.dateScheduled == null ? '' : '${piece.dateScheduled!.month}/${piece.dateScheduled!.day} · ';
    return '$day${h.length > 40 ? '${h.substring(0, 40)}…' : h}'.trim();
  }

  /// Opens the teleprompter camera on top of this sheet; "Done" in the camera comes back here.
  Future<void> _shoot(BuildContext context, WidgetRef ref, List<VaultItem> clips) async {
    await context.push('/camera', extra: {
      'hook': hook,
      'script': script,
      'projectId': projectId,
      'pieceId': piece.id,
      if (clips.isNotEmpty && clips.first.folderId != null) 'folderId': clips.first.folderId,
      'folderName': _folderName,
    });
    if (status == PieceStatus.ready && context.mounted) {
      final all = ref.read(vaultItemsProvider).valueOrNull ?? const <VaultItem>[];
      if (pieceClips(all, piece.id).isNotEmpty) await _setStatus(context, ref, PieceStatus.inProgress, quiet: true);
    }
  }

  Future<void> _setStatus(BuildContext context, WidgetRef ref, PieceStatus s, {bool quiet = false}) async {
    final outcome = await guarded(context, () => ref.read(socialApiProvider).updatePiece(piece.calendarId, piece.id, {'status': s.id}));
    if (outcome == null || !context.mounted) return;
    ref.invalidate(calendarDetailProvider(piece.calendarId));
    onStatusChanged?.call(s);
    if (!quiet) showInfo(context, s == PieceStatus.shot ? 'Marked as shot. Edit the clips when you are ready.' : 'Status: ${s.label}', color: AppTheme.success);
  }

  /// Writes take order 1…N and renames untouched "Clip N" names to match.
  Future<void> _renumber(WidgetRef ref, List<VaultItem> ordered) async {
    final n = ref.read(vaultItemsProvider.notifier);
    for (var i = 0; i < ordered.length; i++) {
      final c = ordered[i];
      final name = _defaultName.hasMatch(c.name) ? 'Clip ${i + 1}' : c.name;
      if (c.takeIndex != i + 1 || name != c.name) await n.updateItem(c.copyWith(takeIndex: i + 1, name: name));
    }
  }

  Future<void> _move(WidgetRef ref, List<VaultItem> clips, int from, int to) async {
    final list = [...clips];
    final c = list.removeAt(from);
    list.insert(to, c);
    await _renumber(ref, list);
  }

  Future<void> _rename(BuildContext context, WidgetRef ref, VaultItem c) async {
    final ctl = TextEditingController(text: c.name);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rename clip'),
        content: TextField(controller: ctl, autofocus: true, maxLength: 80, decoration: fieldDecoration('Clip name')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    ctl.dispose();
    if (name == null || name.isEmpty || name == c.name) return;
    await ref.read(vaultItemsProvider.notifier).updateItem(c.copyWith(name: name));
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, VaultItem c, List<VaultItem> clips) async {
    final yes = await confirm(context, title: 'Delete ${c.name}?', message: 'The video file is removed from this phone.', action: 'Delete', destructive: true);
    if (yes != true) return;
    await ref.read(vaultItemsProvider.notifier).deleteItem(c.id);
    await _renumber(ref, clips.where((x) => x.id != c.id).toList());
  }

  /// Records a replacement and puts it in the old clip's place; the old take is deleted only if a new one was saved.
  Future<void> _retake(BuildContext context, WidgetRef ref, VaultItem old, List<VaultItem> clips) async {
    final before = clips.map((c) => c.id).toSet();
    await _shoot(context, ref, clips);
    final now = pieceClips(ref.read(vaultItemsProvider).valueOrNull ?? const <VaultItem>[], piece.id);
    final fresh = now.where((c) => !before.contains(c.id)).toList();
    if (fresh.isEmpty || !context.mounted) return;
    final replacement = fresh.first;
    final order = now.where((c) => c.id != old.id && c.id != replacement.id).toList();
    order.insert(clips.indexWhere((c) => c.id == old.id).clamp(0, order.length), replacement);
    await ref.read(vaultItemsProvider.notifier).deleteItem(old.id);
    await _renumber(ref, order);
    if (context.mounted) showInfo(context, 'Retake saved as ${replacement.name}.', color: AppTheme.success);
  }

  void _openInStudio(BuildContext context, List<VaultItem> clips) {
    context.push('/studio/session', extra: {
      'sourcePaths': [for (final c in clips) c.localPath!],
      'projectId': projectId,
      'pieceId': piece.id,
      'hook': hook,
      'script': script,
    });
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final all = ref.watch(vaultItemsProvider).valueOrNull ?? const <VaultItem>[];
    final clips = pieceClips(all, piece.id);
    final shot = status == PieceStatus.shot;
    return SectionCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(Icons.video_library_rounded, size: 18, color: AppTheme.accent),
          const SizedBox(width: 8),
          Expanded(child: Text(clips.isEmpty ? 'Clips' : 'Clips (${clips.length})', style: const TextStyle(fontWeight: FontWeight.w700))),
          if (shot) StatusChip(label: 'Shot', color: AppTheme.primary, icon: Icons.check_rounded),
        ]),
        const SizedBox(height: 8),
        if (clips.isEmpty)
          Text('No clips yet. Shoot with the teleprompter: every take is saved here as Clip 1, Clip 2, …',
              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))
        else
          for (var i = 0; i < clips.length; i++)
            _ClipTile(
              clip: clips[i],
              canUp: i > 0,
              canDown: i < clips.length - 1,
              onPlay: () => showDialog<void>(context: context, builder: (_) => _ClipPlayerDialog(clip: clips[i])),
              onRename: () => _rename(context, ref, clips[i]),
              onRetake: () => _retake(context, ref, clips[i], clips),
              onDelete: () => _delete(context, ref, clips[i], clips),
              onUp: () => _move(ref, clips, i, i - 1),
              onDown: () => _move(ref, clips, i, i + 1),
            ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
          onPressed: () => _shoot(context, ref, clips),
          icon: const Icon(Icons.videocam_rounded, size: 18),
          label: Text(clips.isEmpty ? 'Shoot with teleprompter' : 'Shoot another clip'),
        ),
        if (clips.isNotEmpty) ...[
          const SizedBox(height: 8),
          if (!shot)
            FilledButton.tonalIcon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
              onPressed: () => _setStatus(context, ref, PieceStatus.shot),
              icon: const Icon(Icons.task_alt_rounded, size: 18),
              label: const Text('Shooting done'),
            ),
          const SizedBox(height: 8),
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44), backgroundColor: AppTheme.accent, foregroundColor: Colors.white),
            onPressed: () => _openInStudio(context, clips),
            icon: const Icon(Icons.movie_creation_rounded, size: 18),
            label: Text('Edit ${clips.length} clip${clips.length == 1 ? '' : 's'} in Studio'),
          ),
        ],
      ]),
    );
  }
}

class _ClipTile extends StatelessWidget {
  const _ClipTile({
    required this.clip,
    required this.canUp,
    required this.canDown,
    required this.onPlay,
    required this.onRename,
    required this.onRetake,
    required this.onDelete,
    required this.onUp,
    required this.onDown,
  });
  final VaultItem clip;
  final bool canUp, canDown;
  final VoidCallback onPlay, onRename, onRetake, onDelete, onUp, onDown;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: IconButton(tooltip: 'Play ${clip.name}', onPressed: onPlay, icon: Icon(Icons.play_circle_fill_rounded, color: AppTheme.accent)),
      title: Text(clip.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text([clip.formattedDuration, clip.formattedSize].where((s) => s.isNotEmpty).join(' · ')),
      trailing: PopupMenuButton<String>(
        tooltip: 'Clip actions',
        onSelected: (v) {
          switch (v) {
            case 'rename':
              onRename();
            case 'retake':
              onRetake();
            case 'up':
              onUp();
            case 'down':
              onDown();
            case 'delete':
              onDelete();
          }
        },
        itemBuilder: (_) => [
          const PopupMenuItem(value: 'rename', child: Text('Rename')),
          const PopupMenuItem(value: 'retake', child: Text('Retake')),
          if (canUp) const PopupMenuItem(value: 'up', child: Text('Move up')),
          if (canDown) const PopupMenuItem(value: 'down', child: Text('Move down')),
          const PopupMenuItem(value: 'delete', child: Text('Delete')),
        ],
      ),
    );
  }
}

class _ClipPlayerDialog extends StatefulWidget {
  const _ClipPlayerDialog({required this.clip});
  final VaultItem clip;

  @override
  State<_ClipPlayerDialog> createState() => _ClipPlayerDialogState();
}

class _ClipPlayerDialogState extends State<_ClipPlayerDialog> {
  VideoPlayerController? _c;
  Object? _error;

  @override
  void initState() {
    super.initState();
    final path = widget.clip.localPath!;
    final c = kIsWeb ? VideoPlayerController.networkUrl(Uri.parse(path)) : VideoPlayerController.file(File(path));
    c.initialize().then((_) {
      if (!mounted) return c.dispose();
      setState(() => _c = c);
      c.play();
    }, onError: (Object e) {
      c.dispose();
      if (mounted) setState(() => _error = e);
    });
  }

  @override
  void dispose() {
    _c?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    return AlertDialog(
      title: Text(widget.clip.name),
      content: _error != null
          ? Text('This clip cannot be played: ${errorText(_error!)}')
          : c == null
              ? const SizedBox(height: 120, child: Center(child: Icon(Icons.hourglass_top_rounded)))
              : AspectRatio(aspectRatio: c.value.aspectRatio, child: VideoPlayer(c)),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
    );
  }
}
