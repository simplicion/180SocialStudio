import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../../core/native_engine/media_engine_service.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/social_post.dart';
import '../../data/models/user_assisted_publish_package.dart';
import '../posts/finish_publishing_sheet.dart';
import '../posts/post_providers.dart';
import '../projects/project_provider.dart';
import 'studio_controller.dart';

Future<void> showExportSheet(BuildContext context, StudioController c) async {
  // Android 13+ hides the background-export progress notification without this permission.
  // Denial is fine: the export still runs, just without the notification.
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
    try {
      await Permission.notification.request();
    } catch (_) {}
  }
  if (!context.mounted) return;
  // The sheet opens on the export settings; the render starts from its Export button.
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    backgroundColor: AppTheme.surface,
    builder: (_) => _ExportSheet(controller: c),
  );
}

class _ExportSheet extends ConsumerStatefulWidget {
  const _ExportSheet({required this.controller});
  final StudioController controller;

  @override
  ConsumerState<_ExportSheet> createState() => _ExportSheetState();
}

class _ExportSheetState extends ConsumerState<_ExportSheet> {
  StudioController get c => widget.controller;
  VideoPlayerController? _player;
  bool _safeZones = true;
  double? _upload;

  @override
  void initState() {
    super.initState();
    c.addListener(_changed);
    _changed();
  }

  @override
  void dispose() {
    c.removeListener(_changed);
    _player?.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    final out = c.export?.result?.outputPath;
    if (out != null && _player == null) {
      final p = kIsWeb
          ? VideoPlayerController.networkUrl(Uri.parse(out))
          : VideoPlayerController.file(File(out));
      _player = p;
      p.initialize().then((_) {
        if (mounted) setState(() => p.setLooping(true));
      });
    }
    setState(() {});
  }

  Future<void> _submit(String? postId) async {
    final path = c.export!.result!.outputPath;
    setState(() => _upload = 0);
    void progress(int s, int t) {
      if (mounted && t > 0) setState(() => _upload = s / t);
    }

    final api = ref.read(socialApiProvider);
    // Opened from a calendar day: attach to that piece (its post is created if missing).
    final post = await guarded(
      context,
      () => c.pieceId != null
          ? api.uploadPieceFinalVideo(
              c.pieceId!,
              videoPath: path,
              onProgress: progress,
            )
          : api.submitForApproval(
              postId!,
              videoPath: path,
              onProgress: progress,
            ),
    );
    if (!mounted) return;
    setState(() => _upload = null);
    if (post == null) return;
    ref.refreshPost(post.id, projectId: post.projectId);
    showInfo(
      context,
      'Sent for review. The post is now ${post.status.label}.',
      color: AppTheme.success,
    );
    Navigator.pop(context);
    // Straight into the post editor with the video attached: add title/caption per platform, then publish.
    context.push(c.pieceId != null ? '/posts/${post.id}/edit' : '/posts/${post.id}');
  }

  Future<void> _pickPostAndSubmit() async {
    final projectId = c.projectId ?? ref.read(activeProjectIdProvider);
    if (projectId == null) {
      showError(context, 'Choose a project first (Home → project switcher).');
      return;
    }
    final post = await showModalBottomSheet<SocialPost>(
      context: context,
      backgroundColor: AppTheme.surface,
      builder: (_) => _PostPicker(projectId: projectId),
    );
    if (post != null) await _submit(post.id);
  }

  @override
  Widget build(BuildContext context) {
    final e = c.export;
    final result = e?.result;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    e == null
                        ? 'Export'
                        : result != null
                        ? 'Export ready'
                        : e.error != null
                        ? 'Export failed'
                        : 'Exporting',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                if (e == null || result != null || e.error != null)
                  IconButton(
                    onPressed: () {
                      c.clearExport();
                      Navigator.pop(context);
                    },
                    icon: Icon(Icons.close_rounded),
                  ),
              ],
            ),
            SizedBox(height: 12),
            if (e == null)
              _ExportSettingsForm(c: c)
            else if (e.error != null) ...[
              ErrorView(
                error: e.error!,
                compact: true,
                onRetry: () {
                  c.clearExport();
                  c.startExport();
                },
              ),
            ] else if (result == null) ...[
              Text(
                e.stage,
                style: TextStyle(color: AppTheme.textSecondary),
              ),
              SizedBox(height: 8),
              LinearProgressIndicator(
                value: e.stage == 'Rendering…' ? e.progress : null,
              ),
              SizedBox(height: 4),
              if (e.stage == 'Rendering…')
                Text(
                  '${(e.progress * 100).round()}%',
                  textAlign: TextAlign.right,
                ),
              SizedBox(height: 8),
              Text(
                'Rendering happens on this phone. You can switch apps; progress shows in your notifications.',
                style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  FilledButton.tonalIcon(
                    onPressed: () {
                      Navigator.pop(context);
                      showInfo(context, 'Export running in background. Progress is shown in your status bar notifications.');
                    },
                    icon: const Icon(Icons.arrow_downward_rounded, size: 16),
                    label: const Text('Run in background'),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () async {
                      await c.cancelExport();
                      if (context.mounted) Navigator.pop(context);
                    },
                    child: const Text('Cancel'),
                  ),
                ],
              ),
            ] else ...[
              if (_player?.value.isInitialized ?? false)
                SizedBox(
                  height: MediaQuery.of(context).size.height * 0.42,
                  child: Center(
                    child: AspectRatio(
                      aspectRatio: _player!.value.aspectRatio,
                      child: GestureDetector(
                        onTap: () => setState(
                          () => _player!.value.isPlaying
                              ? _player!.pause()
                              : _player!.play(),
                        ),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            VideoPlayer(_player!),
                            if (_safeZones && _player!.value.aspectRatio < 0.7)
                              const _SafeZones(),
                            if (!_player!.value.isPlaying)
                              Center(
                                child: Icon(
                                  Icons.play_circle_fill_rounded,
                                  size: 56,
                                  color: Colors.white70,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              Row(
                children: [
                  Text(
                    '${(result.durationMs / 1000).toStringAsFixed(1)}s · ${result.width}×${result.height} · ${(result.fileSizeBytes / 1048576).toStringAsFixed(1)} MB',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  Spacer(),
                  Text('Safe zones', style: TextStyle(fontSize: 12)),
                  Switch(
                    value: _safeZones,
                    onChanged: (v) => setState(() => _safeZones = v),
                  ),
                ],
              ),
              for (final w in e.warnings)
                Text(
                  '• $w',
                  style: TextStyle(fontSize: 12, color: AppTheme.warning),
                ),
              if (e.credits.isNotEmpty)
                Container(
                  margin: EdgeInsets.only(top: 8),
                  padding: EdgeInsets.fromLTRB(12, 8, 4, 8),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceElevated,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.border),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              e.credits.length == 1
                                  ? 'Media credit: add this to the post caption'
                                  : 'Media credits: add these to the post caption',
                              style: TextStyle(
                                fontSize: 12,
                                color: AppTheme.textSecondary,
                              ),
                            ),
                            SizedBox(height: 2),
                            for (final c in e.credits)
                              Text(c, style: TextStyle(fontSize: 12)),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: 'Copy credits',
                        icon: Icon(Icons.copy_rounded, size: 18),
                        onPressed: () async {
                          await Clipboard.setData(
                            ClipboardData(text: e.credits.join('\n')),
                          );
                          if (context.mounted) {
                            showInfo(context, 'Credits copied');
                          }
                        },
                      ),
                    ],
                  ),
                ),
              if (_upload != null)
                Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: LinearProgressIndicator(value: _upload),
                ),
              SizedBox(height: 8),
              FilledButton.icon(
                onPressed: _upload != null
                    ? null
                    : () => c.pieceId != null || c.postId != null
                          ? _submit(c.postId)
                          : _pickPostAndSubmit(),
                icon: Icon(Icons.verified_rounded),
                label: Text(
                  c.pieceId != null
                      ? 'Attach to calendar day & send for approval'
                      : c.postId != null
                      ? 'Send for approval'
                      : 'Attach to a post & send for approval',
                ),
              ),
              if (c.pieceId == null && c.postId == null) ...[
                SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    context.push(
                      '/posts/new${c.projectId == null ? '' : '?projectId=${c.projectId}'}',
                      extra: {
                        'localMediaPath': result.outputPath,
                        'mediaType': 'video',
                        if (c.hook != null && c.hook!.trim().isNotEmpty) 'title': c.hook!.trim(),
                      },
                    );
                  },
                  icon: Icon(Icons.post_add_rounded),
                  label: Text('New post with this video'),
                ),
              ],
              SizedBox(height: 8),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.accentBlue,
                  foregroundColor: Colors.white,
                ),
                onPressed: () {
                  showModalBottomSheet(
                    context: context,
                    isScrollControlled: true,
                    backgroundColor: Colors.transparent,
                    builder: (ctx) => CentralizedManualPublishSheet(
                      package: UserAssistedPublishPackage(
                        id: c.postId ?? 'studio_${DateTime.now().millisecondsSinceEpoch}',
                        projectId: c.projectId ?? '',
                        mediaPath: result.outputPath,
                        mimeType: 'video/mp4',
                        title: 'Video created with 180 Studio',
                        caption: e.credits.isNotEmpty
                            ? 'Created with 180 Studio\n\n${e.credits.join('\n')}'
                            : 'Created with 180 Studio',
                        xPayload: XPublishPayload(
                          text: e.credits.isNotEmpty
                              ? 'Created with 180 Studio\n\n${e.credits.join('\n')}'
                              : 'Created with 180 Studio',
                          mediaPath: result.outputPath,
                          projectId: c.projectId,
                        ),
                      ),
                    ),
                  );
                },
                icon: Icon(Icons.send_rounded),
                label: Text('Manual publish hub'),
              ),
              SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () => SharePlus.instance.share(
                  ShareParams(
                    files: [XFile(result.outputPath, mimeType: 'video/mp4')],
                  ),
                ),
                icon: Icon(Icons.ios_share_rounded),
                label: Text('Share or save'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Platform UI areas on 9:16 video (caption/handle at the bottom, action buttons on the right).
/// Resolution, frame rate and quality, then Export. The render itself never changes the edit.
class _ExportSettingsForm extends StatefulWidget {
  const _ExportSettingsForm({required this.c});
  final StudioController c;

  @override
  State<_ExportSettingsForm> createState() => _ExportSettingsFormState();
}

class _ExportSettingsFormState extends State<_ExportSettingsForm> {
  late ExportSettings s = widget.c.exportSettings;

  @override
  Widget build(BuildContext context) {
    final canvas = widget.c.ir?.canvas;
    final short = canvas == null ? 1080 : (canvas.width < canvas.height ? canvas.width : canvas.height);
    final canvasFps = (canvas?.fps ?? 30).round();
    final sizes = [for (final p in const [1080, 720, 480]) if (p < short) p];
    Widget group(String label, List<Widget> chips) => Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: TextStyle(color: AppTheme.textSecondary)),
            SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 8, children: chips),
          ]),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      group('Resolution', [
        ChoiceChip(label: Text('${short}p (full)'), selected: s.maxShortSide == null, onSelected: (_) => setState(() => s = s.copyWith(clearMaxShortSide: true))),
        for (final p in sizes)
          ChoiceChip(label: Text('${p}p'), selected: s.maxShortSide == p, onSelected: (_) => setState(() => s = s.copyWith(maxShortSide: p))),
      ]),
      group('Frame rate', [
        ChoiceChip(label: Text('$canvasFps fps (project)'), selected: s.fps == null, onSelected: (_) => setState(() => s = s.copyWith(clearFps: true))),
        for (final f in const [24, 30, 60])
          if (f != canvasFps) ChoiceChip(label: Text('$f fps'), selected: s.fps == f, onSelected: (_) => setState(() => s = s.copyWith(fps: f))),
      ]),
      group('Quality', [
        ChoiceChip(label: Text('Standard'), selected: s.quality != 'high', onSelected: (_) => setState(() => s = s.copyWith(quality: 'standard'))),
        ChoiceChip(label: Text('High (bigger file)'), selected: s.quality == 'high', onSelected: (_) => setState(() => s = s.copyWith(quality: 'high'))),
      ]),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: Text('Platform loudness'),
        subtitle: Text('Brings the voice to ${ExportSettings.targetLufs.round()} LUFS like Reels and Shorts, without clipping'),
        value: s.normalizeLoudness,
        onChanged: (v) => setState(() => s = s.copyWith(normalizeLoudness: v)),
      ),
      SizedBox(
        height: 48,
        child: FilledButton.icon(
          onPressed: () {
            widget.c.exportSettings = s;
            widget.c.startExport();
          },
          icon: Icon(Icons.movie_creation_outlined),
          label: Text('Export video'),
        ),
      ),
    ]);
  }
}

class _SafeZones extends StatelessWidget {
  const _SafeZones();

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: LayoutBuilder(
      builder: (_, box) => Stack(
        children: [
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: box.maxHeight * 0.2,
            child: Container(color: AppTheme.error.withValues(alpha: 0.18)),
          ),
          Positioned(
            right: 0,
            top: box.maxHeight * 0.35,
            bottom: box.maxHeight * 0.2,
            width: box.maxWidth * 0.14,
            child: Container(color: AppTheme.warning.withValues(alpha: 0.18)),
          ),
        ],
      ),
    ),
  );
}

class _PostPicker extends ConsumerWidget {
  const _PostPicker({required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = PostQuery(projectId: projectId);
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.6,
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Which post is this video for?',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            Expanded(
              child: AsyncBody<List<SocialPost>>(
                value: ref.watch(projectPostsProvider(q)),
                onRetry: () => ref.invalidate(projectPostsProvider(q)),
                builder: (posts) {
                  final open = posts
                      .where(
                        (p) => !{
                          PostStatus.published,
                          PostStatus.publishing,
                        }.contains(p.status),
                      )
                      .toList();
                  if (open.isEmpty) {
                    return EmptyView(
                      icon: Icons.article_rounded,
                      title: 'No open posts',
                      message: 'Create a post first, then attach the video from its page.',
                    );
                  }
                  return ListView(
                    children: [
                      for (final p in open)
                        ListTile(
                          title: Text(
                            p.displayTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            '${p.status.label} · ${fmtDateTime(p.scheduledFor)}',
                          ),
                          onTap: () => Navigator.pop(context, p),
                        ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
