import 'dart:io';


import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/social_post.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../posts/post_providers.dart';
import '../projects/project_provider.dart';
import 'studio_drafts_service.dart';
import 'teleprompter_setup_sheet.dart';
import 'video_thumbnails.dart';

/// The on-device video engine exists for Android only; iOS shows this instead of failing later.
bool get studioSupported => defaultTargetPlatform != TargetPlatform.iOS;

/// Studio tab: shoot, edit, and the active project's posts that still need a video.
class StudioScreen extends ConsumerWidget {
  const StudioScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectId = ref.watch(activeProjectProvider).valueOrNull?.id;
    final posts = projectId == null ? null : ref.watch(projectPostsProvider(PostQuery(projectId: projectId)));
    final allDrafts = ref.watch(studioDraftsProvider);
    final drafts = projectId == null
        ? <StudioDraft>[]
        : allDrafts.where((d) => d.projectId == projectId).toList();

    return Scaffold(
      appBar: workspaceAppBar(context, ref),
      body: !studioSupported
          ? EmptyView(
              icon: Icons.phone_iphone_rounded,
              title: 'Video editing is Android-only for now',
              message: 'The on-device editor is coming to iPhone. You can still plan, write, review and publish from here.',
            )
          : ListView(padding: EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
              Row(children: [
                Expanded(
                  child: _Action(
                    icon: Icons.videocam_rounded,
                    label: 'Shoot',
                    hint: 'Teleprompter camera',
                    onTap: () => showTeleprompterSetupSheet(context, projectId: projectId),
                  ),
                ),
                SizedBox(width: 10),
                Expanded(
                  child: _Action(
                    icon: Icons.movie_edit,
                    label: 'Edit a video',
                    hint: 'From your gallery',
                    onTap: () => context.push('/studio/session${projectId == null ? '' : '?projectId=$projectId'}'),
                  ),
                ),
              ]),

              // Saved Video Drafts
              if (drafts.isNotEmpty) ...[
                SizedBox(height: 10),
                SectionHeader(
                  'Drafts (${drafts.length})',
                  trailing: Text(
                    'Tap to resume editing',
                    style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
                  ),
                ),
                SizedBox(
                  height: 154,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: drafts.length,
                    separatorBuilder: (_, index) => SizedBox(width: 12),
                    itemBuilder: (context, idx) {
                      final draft = drafts[idx];
                      return _DraftCard(
                        draft: draft,
                        onResume: () => context.push('/studio/session', extra: {'draft': draft}),
                        onDelete: () async {
                          final ok = await confirm(
                            context,
                            title: 'Delete draft?',
                            message: 'This video draft will be removed from your device.',
                            action: 'Delete',
                            destructive: true,
                          );
                          if (ok) ref.read(studioDraftsProvider.notifier).delete(draft.id);
                        },
                      );
                    },
                  ),
                ),
              ],

              SectionHeader('Needs a video'),
              if (posts == null)
                SectionCard(child: Text('Pick a project on Home to see posts waiting for footage.'))
              else
                posts.when(
                  loading: () => Padding(padding: EdgeInsets.all(24), child: LoadingView()),
                  error: (e, _) => ErrorView(error: e, compact: true, onRetry: () => ref.invalidate(projectPostsProvider(PostQuery(projectId: projectId!)))),
                  data: (list) {
                    final todo = list
                        .where((p) =>
                            (p.mediaType == null || p.mediaType == 'video') &&
                            p.finalVideoUrl == null &&
                            {PostStatus.draft, PostStatus.inEditing, PostStatus.scheduled, PostStatus.approved}.contains(p.status))
                        .toList()
                      ..sort((a, b) => (a.scheduledFor ?? DateTime(9999)).compareTo(b.scheduledFor ?? DateTime(9999)));
                    if (todo.isEmpty) return SectionCard(child: Text('Every video post has its final video. Nice.'));
                    return Column(children: [
                      for (final p in todo)
                        PostTile(
                          post: p,
                          trailing: IconButton(
                            tooltip: 'Shoot for this post',
                            icon: Icon(Icons.videocam_rounded, color: AppTheme.primary),
                            onPressed: () => showTeleprompterSetupSheet(
                              context,
                              projectId: projectId,
                              postId: p.id,
                              prefillHook: p.hook ?? p.displayTitle,
                              prefillScript: p.content,
                            ),
                          ),
                        ),
                    ]);
                  },
                ),
            ]),
    );
  }
}

class _DraftCard extends StatelessWidget {
  const _DraftCard({
    required this.draft,
    required this.onResume,
    required this.onDelete,
  });

  final StudioDraft draft;
  final VoidCallback onResume;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final clipCount = draft.ir.clips.length;
    final durText = timecode(draft.ir.durationMs);

    return Container(
      width: 170,
      decoration: BoxDecoration(
        color: AppTheme.surfaceElevated,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onResume,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Positioned.fill(
                    child: _DraftThumbnail(draft: draft),
                  ),
                  Positioned.fill(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.black.withValues(alpha: 0.40),
                            Colors.transparent,
                            Colors.black.withValues(alpha: 0.70),
                          ],
                          stops: const [0.0, 0.45, 1.0],
                        ),
                      ),
                    ),
                  ),
                  Center(
                    child: Container(
                      padding: EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white24),
                      ),
                      child: Icon(Icons.play_arrow_rounded, color: Colors.white, size: 20),
                    ),
                  ),
                  Positioned(
                    bottom: 6,
                    left: 6,
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.black87,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        durText,
                        style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                  Positioned(
                    top: 2,
                    right: 2,
                    child: IconButton(
                      icon: Icon(Icons.close_rounded, color: Colors.white70, size: 16),
                      tooltip: 'Delete draft',
                      visualDensity: VisualDensity.compact,
                      onPressed: onDelete,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.all(8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    draft.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        '$clipCount clip${clipCount == 1 ? '' : 's'}',
                        style: TextStyle(fontSize: 10, color: AppTheme.textMuted),
                      ),
                      Text(' · ', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                      Expanded(
                        child: Text(
                          timeAgo(draft.updatedAt),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 10, color: AppTheme.primary),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

}

class _DraftThumbnail extends StatelessWidget {
  const _DraftThumbnail({required this.draft});

  final StudioDraft draft;

  String? _resolveMedia() {
    if (draft.thumbnailUrl != null && draft.thumbnailUrl!.trim().isNotEmpty) {
      return draft.thumbnailUrl!.trim();
    }
    final firstClip = draft.ir.clips.firstOrNull;
    if (firstClip != null) {
      final p = draft.sourcePaths[firstClip.assetId];
      if (p != null && p.trim().isNotEmpty) return p.trim();
    }
    if (draft.sourcePath.trim().isNotEmpty) {
      return draft.sourcePath.trim();
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final media = _resolveMedia();
    if (media == null) return _fallback();

    // 1. Remote HTTP/HTTPS image
    if (media.startsWith('http://') || media.startsWith('https://')) {
      return Image.network(
        media,
        fit: BoxFit.cover,
        cacheWidth: 360,
        errorBuilder: (_, _, _) => _fallback(),
      );
    }

    // 2. Video file (local) -> extract frame or use cached frame via VideoThumbnails
    if (VideoThumbnails.isLocalVideo(media)) {
      final atMs = draft.playheadMs > 0 ? draft.playheadMs : 1000;
      return FutureBuilder<String?>(
        future: VideoThumbnails.frameFor(media, atMs: atMs),
        builder: (_, snap) {
          final frame = snap.data;
          if (frame != null && !kIsWeb) {
            return Image.file(
              File(frame),
              fit: BoxFit.cover,
              cacheWidth: 360,
              errorBuilder: (_, _, _) => _fallback(),
            );
          }
          return _fallback();
        },
      );
    }

    // 3. Image file (e.g. extracted frame or still asset)
    if (!kIsWeb) {
      try {
        final f = File(media);
        if (f.existsSync()) {
          return Image.file(
            f,
            fit: BoxFit.cover,
            cacheWidth: 360,
            errorBuilder: (_, _, _) => _fallback(),
          );
        }
      } catch (_) {}
    }

    return _fallback();
  }

  Widget _fallback() => Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              AppTheme.primary.withValues(alpha: 0.25),
              Colors.black87,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: const Center(
          child: Icon(Icons.movie_creation_outlined, color: Colors.white38, size: 28),
        ),
      );
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label, required this.hint, required this.onTap});
  final IconData icon;
  final String label;
  final String hint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SectionCard(
        onTap: onTap,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: AppTheme.primary, size: 28),
          SizedBox(height: 12),
          Text(label, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          Text(hint, style: Theme.of(context).textTheme.labelSmall),
        ]),
      );
}
