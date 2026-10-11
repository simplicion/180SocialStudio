import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/widgets/common.dart';
import '../../data/models/project.dart';
import '../../data/models/social_post.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../posts/post_providers.dart';

/// Content list (web `tabs/ContentListTab.tsx`): search, status filter, version badge.
class ContentTab extends ConsumerStatefulWidget {
  const ContentTab({super.key, required this.project});
  final Project project;

  @override
  ConsumerState<ContentTab> createState() => _ContentTabState();
}

class _ContentTabState extends ConsumerState<ContentTab> {
  PostStatus? _status;
  String _search = '';

  @override
  Widget build(BuildContext context) {
    final q = PostQuery(projectId: widget.project.id, status: _status?.id);
    final posts = ref.watch(projectPostsProvider(q));
    return Column(children: [
      Padding(
        padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: TextField(
          onChanged: (v) => setState(() => _search = v.trim().toLowerCase()),
          decoration: fieldDecoration('Search content', suffix: Icon(Icons.search_rounded)),
        ),
      ),
      SizedBox(
        height: 52,
        child: ListView(scrollDirection: Axis.horizontal, padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8), children: [
          ChoiceChip(label: Text('All'), selected: _status == null, onSelected: (_) => setState(() => _status = null)),
          for (final s in PostStatus.filterable)
            Padding(
              padding: EdgeInsets.only(left: 8),
              child: ChoiceChip(label: Text(s.label), selected: _status == s, onSelected: (_) => setState(() => _status = s)),
            ),
        ]),
      ),
      Expanded(
        child: AsyncBody<List<SocialPost>>(
          value: posts,
          onRetry: () => ref.invalidate(projectPostsProvider(q)),
          builder: (all) {
            final list = _search.isEmpty
                ? all
                : all.where((p) => '${p.title ?? ''} ${p.content} ${p.hook ?? ''}'.toLowerCase().contains(_search)).toList();
            if (list.isEmpty) {
              return EmptyView(
                icon: Icons.article_rounded,
                title: all.isEmpty ? 'No content yet' : 'No matches',
                actionLabel: 'Create content',
                onAction: () => context.push('/posts/new?projectId=${widget.project.id}'),
              );
            }
            return RefreshIndicator(
              onRefresh: () async => ref.invalidate(projectPostsProvider(q)),
              child: ListView(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 96),
                children: [for (final p in list) PostTile(post: p)],
              ),
            );
          },
        ),
      ),
    ]);
  }
}
