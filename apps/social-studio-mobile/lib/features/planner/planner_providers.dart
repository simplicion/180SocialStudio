import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/providers.dart';
import '../../data/models/autopilot.dart';
import '../../data/models/content_calendar.dart';

import '../projects/project_provider.dart';

final projectCalendarsProvider = FutureProvider.autoDispose.family<List<ContentCalendar>, String>((ref, projectId) {
  ref.watch(currentUserIdProvider);
  return ref.watch(socialApiProvider).listCalendars(projectId: projectId);
});

final calendarsProvider = FutureProvider.autoDispose<List<ContentCalendar>>((ref) {
  ref.watch(currentUserIdProvider);
  final activeProject = ref.watch(activeProjectProvider).valueOrNull;
  if (activeProject != null) {
    return ref.watch(socialApiProvider).listCalendars(projectId: activeProject.id);
  }
  return const [];
});

final calendarDetailProvider = FutureProvider.autoDispose.family<ContentCalendar, String>((ref, id) {
  return ref.watch(socialApiProvider).getCalendar(id);
});

class ActiveAutopilotJobNotifier extends StateNotifier<String?> {
  final String projectId;
  ActiveAutopilotJobNotifier(this.projectId) : super(null) {
    _load();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final id = prefs.getString('autopilot_active_job_$projectId');
      if (id != null && id.isNotEmpty) {
        state = id;
      }
    } catch (_) {}
  }

  Future<void> setActiveJob(String jobId) async {
    state = jobId;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('autopilot_active_job_$projectId', jobId);
    } catch (_) {}
  }

  Future<void> clearActiveJob() async {
    state = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('autopilot_active_job_$projectId');
    } catch (_) {}
  }
}

final activeAutopilotJobProvider = StateNotifierProvider.family<ActiveAutopilotJobNotifier, String?, String>((ref, projectId) {
  return ActiveAutopilotJobNotifier(projectId);
});

final activeAutopilotJobStatusProvider = FutureProvider.autoDispose.family<AutopilotJob?, ({String projectId, String jobId})>((ref, arg) async {
  try {
    return await ref.watch(socialApiProvider).getAutopilotJob(arg.projectId, arg.jobId);
  } catch (_) {
    return null;
  }
});
