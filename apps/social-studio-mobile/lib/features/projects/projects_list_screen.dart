import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/project.dart';
import 'project_provider.dart';

/// Projects list (web `social-projects/page.tsx`): search, status chips, cards with counts.
class ProjectsListScreen extends ConsumerStatefulWidget {
  const ProjectsListScreen({super.key});

  @override
  ConsumerState<ProjectsListScreen> createState() => _ProjectsListScreenState();
}

class _ProjectsListScreenState extends ConsumerState<ProjectsListScreen> {
  String _search = '';
  String? _status;
  final _searchCtl = TextEditingController();

  @override
  void dispose() {
    _searchCtl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filter = ProjectFilter(search: _search, status: _status);
    final projects = ref.watch(projectListProvider(filter));
    final activeId = ref.watch(activeProjectProvider).valueOrNull?.id;
    return Scaffold(
      appBar: AppBar(title: Text('Projects')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'projects.new',
        onPressed: () => context.push('/projects/new'),
        icon: Icon(Icons.add_rounded),
        label: Text('New project'),
      ),
      body: Column(children: [
        Padding(
          padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: TextField(
            controller: _searchCtl,
            textInputAction: TextInputAction.search,
            onSubmitted: (v) => setState(() => _search = v),
            decoration: fieldDecoration('Search projects',
                suffix: IconButton(icon: Icon(Icons.search_rounded), onPressed: () => setState(() => _search = _searchCtl.text))),
          ),
        ),
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8), children: [
            ChoiceChip(label: Text('All'), selected: _status == null, onSelected: (_) => setState(() => _status = null)),
            for (final s in ProjectStatus.listFilters)
              Padding(
                padding: EdgeInsets.only(left: 8),
                child: ChoiceChip(label: Text(s.label), selected: _status == s.id, onSelected: (_) => setState(() => _status = s.id)),
              ),
          ]),
        ),
        Expanded(
          child: AsyncBody<List<Project>>(
            value: projects,
            onRetry: () => ref.invalidate(projectListProvider(filter)),
            isEmpty: (l) => l.isEmpty,
            empty: EmptyView(
              icon: Icons.folder_open_rounded,
              title: _search.isEmpty && _status == null ? 'No projects yet' : 'No matching projects',
              message: 'Create a project for each client or brand you manage.',
              actionLabel: 'New project',
              onAction: () => context.push('/projects/new'),
            ),
            builder: (list) => RefreshIndicator(
              onRefresh: () async => ref.invalidate(projectListProvider(filter)),
              child: ListView.separated(
                padding: EdgeInsets.fromLTRB(16, 4, 16, 96),
                itemCount: list.length,
                separatorBuilder: (_, _) => SizedBox(height: 10),
                itemBuilder: (_, i) => _ProjectCard(project: list[i], isActive: list[i].id == activeId),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}

class _ProjectCard extends ConsumerWidget {
  const _ProjectCard({required this.project, required this.isActive});
  final Project project;
  final bool isActive;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final m = project.metrics;
    return SectionCard(
      borderColor: isActive ? AppTheme.primary : null,
      onTap: () {
        ref.read(activeProjectIdProvider.notifier).select(project.id);
        context.go('/home');
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(project.name, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
          if (isActive) Padding(padding: EdgeInsets.only(right: 8), child: StatusChip(label: 'Active', color: AppTheme.primary)),
          StatusChip(label: project.status.label, color: project.status.color),
        ]),
        SizedBox(height: 4),
        Text(
          project.client?.name ?? (project.clientIds.isEmpty ? 'Internal project' : 'Client project'),
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        SizedBox(height: 10),
        Row(children: [
          for (final a in project.socialAccounts.take(5))
            Padding(padding: EdgeInsets.only(right: 6), child: Icon(a.platform.icon, size: 16, color: a.needsAttention ? AppTheme.error : a.platform.color)),
          if (project.socialAccounts.isEmpty) Text('No channels', style: Theme.of(context).textTheme.labelSmall),
          Spacer(),
          _Count(Icons.event_rounded, m.scheduledPosts, 'scheduled'),
          _Count(Icons.hourglass_top_rounded, m.pendingApprovals, 'pending review'),
          _Count(Icons.assignment_rounded, m.outstandingTasks, 'tasks'),
        ]),
      ]),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count(this.icon, this.value, this.tooltip);
  final IconData icon;
  final int value;
  final String tooltip;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: '$value $tooltip',
        child: Padding(
          padding: EdgeInsets.only(left: 12),
          child: Row(children: [
            Icon(icon, size: 14, color: AppTheme.textSecondary),
            SizedBox(width: 3),
            Text('$value', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ]),
        ),
      );
}
