import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/project.dart';
import '../../data/models/social_post.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../posts/post_providers.dart';

/// Publishing pipeline: failures first, then what is queued, then what went out.
class PublishingTab extends ConsumerWidget {
  const PublishingTab({super.key, required this.project});
  final Project project;

  static final _groups = [
    ('Needs attention', [PostStatus.failed, PostStatus.partiallyPublished], AppTheme.error),
    ('Publishing now', [PostStatus.publishing], AppTheme.accentBlue),
    ('Ready to publish', [PostStatus.approved, PostStatus.ready], AppTheme.success),
    ('Scheduled', [PostStatus.scheduled], AppTheme.accentBlue),
    ('Published', [PostStatus.published], AppTheme.textSecondary),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = PostQuery(projectId: project.id);
    final posts = ref.watch(projectPostsProvider(q));
    final reauth = project.socialAccounts.where((a) => a.needsAttention).toList();
    return AsyncBody<List<SocialPost>>(
      value: posts,
      onRetry: () => ref.invalidate(projectPostsProvider(q)),
      builder: (all) => RefreshIndicator(
        onRefresh: () async => ref.invalidate(projectPostsProvider(q)),
        child: ListView(padding: EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
          if (reauth.isNotEmpty)
            SectionCard(
              borderColor: AppTheme.error.withValues(alpha: 0.5),
              child: Text('${reauth.map((a) => a.accountName).join(', ')} must be re-authorized before posts to them can publish.'),
            ),
          for (final (label, statuses, color) in _groups) ...() {
            final items = all.where((p) => statuses.contains(p.status)).toList()
              ..sort((a, b) => (a.scheduledFor ?? a.updatedAt ?? DateTime(0)).compareTo(b.scheduledFor ?? b.updatedAt ?? DateTime(0)));
            if (items.isEmpty) return const <Widget>[];
            return [
              SectionHeader('$label (${items.length})', trailing: Icon(Icons.circle, size: 10, color: color)),
              for (final p in label == 'Published' ? items.reversed.take(10) : items) PostTile(post: p),
            ];
          }(),
          if (all.every((p) => !_groups.any((g) => g.$2.contains(p.status))))
            Padding(
              padding: EdgeInsets.only(top: 48),
              child: EmptyView(
                icon: Icons.send_rounded,
                title: 'Nothing in the publishing queue',
                message: 'Approved and scheduled posts appear here.',
                actionLabel: 'Open content',
                onAction: () => context.push('/projects/${project.id}/content'),
              ),
            ),
        ]),
      ),
    );
  }
}
