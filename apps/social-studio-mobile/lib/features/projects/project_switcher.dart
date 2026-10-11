import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/project.dart';
import 'project_provider.dart';

/// Persistent project (client/brand) switcher shown in every workspace app bar.
class ProjectSwitcher extends ConsumerWidget {
  const ProjectSwitcher({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = ref.watch(activeProjectProvider);
    final name = active.valueOrNull?.name ?? (active.isLoading ? 'Loading…' : 'Select project');
    return InkWell(
      key: Key('projectSwitcher'),
      borderRadius: BorderRadius.circular(10),
      onTap: () => showProjectSwitcherSheet(context, ref),
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(Icons.business_rounded, color: AppTheme.primary, size: 16),
          ),
          SizedBox(width: 10),
          Flexible(child: Text(name, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
          Icon(Icons.expand_more_rounded, color: AppTheme.textSecondary),
        ]),
      ),
    );
  }
}

Future<void> showProjectSwitcherSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet(
    context: context,
    backgroundColor: AppTheme.surface,
    isScrollControlled: true,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) => Consumer(builder: (ctx, ref, _) {
      final projects = ref.watch(allProjectsProvider);
      final activeId = ref.watch(activeProjectProvider).valueOrNull?.id;
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            SizedBox(height: 12),
            Container(width: 40, height: 4, decoration: BoxDecoration(color: AppTheme.border, borderRadius: BorderRadius.circular(2))),
            ListTile(
              title: Text('Projects', style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('One project per client or brand'),
              trailing: TextButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  context.push('/projects');
                },
                child: Text('Manage'),
              ),
            ),
            Flexible(
              child: projects.when(
                loading: () => Padding(padding: EdgeInsets.all(24), child: LoadingView()),
                error: (e, _) => ErrorView(error: e, compact: true, onRetry: () => ref.invalidate(allProjectsProvider)),
                data: (list) => ListView(shrinkWrap: true, children: [
                  for (final Project p in list)
                    ListTile(
                      leading: Icon(Icons.circle, size: 12, color: p.status.color),
                      title: Text(p.name),
                      subtitle: Text('${p.socialAccounts.length} channels · ${p.metrics.scheduledPosts} scheduled'),
                      trailing: p.id == activeId ? Icon(Icons.check_rounded, color: AppTheme.primary) : null,
                      onTap: () {
                        ref.read(activeProjectIdProvider.notifier).select(p.id);
                        Navigator.pop(ctx);
                      },
                    ),
                ]),
              ),
            ),
            ListTile(
              leading: Icon(Icons.add_circle_outline_rounded, color: AppTheme.primary),
              title: Text('New project'),
              onTap: () {
                Navigator.pop(ctx);
                context.push('/projects/new');
              },
            ),
          ]),
        ),
      );
    }),
  );
}
