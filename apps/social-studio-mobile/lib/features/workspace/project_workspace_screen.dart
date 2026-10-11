import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/sync_indicator.dart';
import '../../data/models/project.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../inbox/inbox_screen.dart';
import '../projects/project_provider.dart';
import '../manager/manager_copilot_sheet.dart';
import 'accounts_tab.dart';
import 'analytics_tab.dart';
import 'brand_tab.dart';
import 'calendar_tab.dart';
import 'content_tab.dart';
import 'engagement_tab.dart';
import 'evergreen_tab.dart';
import 'publishing_tab.dart';
import 'settings_tab.dart';

/// `/projects/:id/:tab`: one section of a project's workspace (web `/social-projects/:id?tab=`).
class ProjectWorkspaceScreen extends ConsumerWidget {
  const ProjectWorkspaceScreen({super.key, required this.projectId, required this.tab, this.query = const {}});
  final String projectId;
  final String tab;
  final Map<String, String> query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final section = ProjectSection.byTab(tab);
    final detail = ref.watch(projectDetailProvider(projectId));
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(section?.label ?? 'Project'),
          if (detail.valueOrNull != null)
            Text(detail.valueOrNull!.project.name, style: Theme.of(context).textTheme.labelSmall),
        ]),
        actions: [
          IconButton(
            icon: Icon(Icons.auto_awesome_rounded, color: AppTheme.accent),
            tooltip: '180 Manager AI',
            onPressed: () => show180ManagerCopilot(context, projectId: projectId),
          ),
          SyncIndicator(),
        ],
      ),
      body: section == null
          ? EmptyView(icon: Icons.help_outline_rounded, title: 'Unknown section "$tab"')
          : AsyncBody<ProjectDetail>(
              value: detail,
              onRetry: () => ref.invalidate(projectDetailProvider(projectId)),
              builder: (d) => _tabBody(d),
            ),
    );
  }

  Widget _tabBody(ProjectDetail d) => switch (tab) {
        'calendar' => CalendarTab(project: d.project),
        'content' => ContentTab(project: d.project),
        'publishing' => PublishingTab(project: d.project),
        'inbox' => ConversationList(projectId: d.project.id),
        'engagement' => EngagementTab(project: d.project),
        'analytics' => AnalyticsTab(project: d.project),
        'brand' => BrandTab(project: d.project),
        'accounts' => AccountsTab(project: d.project),
        'evergreen' => EvergreenTab(project: d.project),
        'settings' => SettingsTab(project: d.project),
        _ => SizedBox.shrink(),
      };
}
