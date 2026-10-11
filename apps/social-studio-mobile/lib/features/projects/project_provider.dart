import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/providers.dart';
import '../../data/models/brand_voice.dart';
import '../../data/models/project.dart';

/// Filter of the projects list screen (search + status chip).
class ProjectFilter {
  ProjectFilter({this.search = '', this.status});
  final String search;
  final String? status;

  @override
  bool operator ==(Object other) => other is ProjectFilter && other.search == search && other.status == status;

  @override
  int get hashCode => Object.hash(search, status);
}

final projectListProvider = FutureProvider.autoDispose.family<List<Project>, ProjectFilter>((ref, f) {
  return ref.watch(socialApiProvider).listProjects(search: f.search, status: f.status);
});

/// All projects, for the persistent switcher.
final allProjectsProvider = FutureProvider<List<Project>>((ref) {
  ref.watch(currentUserIdProvider); // reload per user
  return ref.watch(socialApiProvider).listProjects(limit: 100);
});

/// The selected project id, remembered per user (not sensitive, so SharedPreferences).
final activeProjectIdProvider = NotifierProvider<ActiveProjectController, String?>(ActiveProjectController.new);

class ActiveProjectController extends Notifier<String?> {
  String _key(String? uid) => 'activeProject.${uid ?? 'anon'}';

  @override
  String? build() {
    final uid = ref.watch(currentUserIdProvider);
    _load(uid);
    return null;
  }

  Future<void> _load(String? uid) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_key(uid));
      if (saved != null && state == null) state = saved;
    } catch (_) {}
  }

  Future<void> select(String? projectId) async {
    state = projectId;
    try {
      final prefs = await SharedPreferences.getInstance();
      final k = _key(ref.read(currentUserIdProvider));
      if (projectId == null) {
        await prefs.remove(k);
      } else {
        await prefs.setString(k, projectId);
      }
    } catch (_) {}
  }
}

/// The active project, falling back to the first project when nothing (valid) is selected.
final activeProjectProvider = Provider<AsyncValue<Project?>>((ref) {
  final list = ref.watch(allProjectsProvider);
  final id = ref.watch(activeProjectIdProvider);
  return list.whenData((projects) {
    if (projects.isEmpty) return null;
    return projects.where((p) => p.id == id).firstOrNull ?? projects.first;
  });
});

final projectDetailProvider = FutureProvider.autoDispose.family<ProjectDetail, String>((ref, id) {
  return ref.watch(socialApiProvider).getProject(id);
});

final projectDashboardProvider = FutureProvider.autoDispose.family<ProjectDashboard, String>((ref, id) {
  return ref.watch(socialApiProvider).projectDashboard(id);
});

final projectActivityProvider = FutureProvider.autoDispose.family<List<ActivityItem>, String>((ref, id) {
  return ref.watch(socialApiProvider).projectActivity(id, limit: 10);
});

final brandVoiceProvider = FutureProvider.autoDispose.family<BrandVoice, String>((ref, projectId) {
  return ref.watch(socialApiProvider).getBrandVoice(projectId);
});

final projectLiveMetricsProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, id) {
  return ref.watch(socialApiProvider).getLivePlatformMetrics(id);
});

/// Invalidates everything derived from a project after a mutation.
extension WidgetRefInvalidate on WidgetRef {
  void refreshProjectData(String projectId) {
    invalidate(projectDetailProvider(projectId));
    invalidate(projectDashboardProvider(projectId));
    invalidate(projectActivityProvider(projectId));
    invalidate(projectLiveMetricsProvider(projectId));
    invalidate(allProjectsProvider);
  }
}

/// Reactive unread social inbox inquiries count for the active project.
final unreadInboxCountProvider = Provider<int>((ref) {
  final project = ref.watch(activeProjectProvider).valueOrNull;
  if (project == null) return 0;
  final dashboard = ref.watch(projectDashboardProvider(project.id)).valueOrNull;
  return dashboard?.metric('unreadInboxCount') ?? 0;
});

/// Reactive pending review & approvals count for the active project.
final pendingApprovalsCountProvider = Provider<int>((ref) {
  final project = ref.watch(activeProjectProvider).valueOrNull;
  if (project == null) return 0;
  final dashboard = ref.watch(projectDashboardProvider(project.id)).valueOrNull;
  return dashboard?.metric('postsAwaitingApproval') ?? 0;
});

/// Total number of high/medium attention items requiring action for the active project.
final actionRequiredCountProvider = Provider<int>((ref) {
  final project = ref.watch(activeProjectProvider).valueOrNull;
  if (project == null) return 0;
  final dashboard = ref.watch(projectDashboardProvider(project.id)).valueOrNull;
  return dashboard?.attentionItems.length ?? 0;
});
