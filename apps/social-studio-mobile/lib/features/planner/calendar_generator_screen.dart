import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/content_calendar.dart';
import '../projects/project_provider.dart';
import 'autopilot_generator.dart';

/// Streamlined generator entrypoint. Directly loads the AI Autopilot Generator.
/// When extending a calendar ([extendFrom]), it passes the continuation context
/// so the new sprint starts immediately after the previous calendar ends.
class CalendarGeneratorScreen extends ConsumerWidget {
  const CalendarGeneratorScreen({super.key, this.extendFrom});
  final ContentCalendar? extendFrom;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = ref.watch(activeProjectProvider).valueOrNull;
    if (active == null) {
      return Scaffold(
        appBar: AppBar(title: Text(extendFrom == null ? 'Generate calendar' : 'Extend calendar')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(extendFrom == null ? 'Generate calendar' : 'Extend calendar'),
      ),
      body: AutopilotGenerator(
        project: active,
        extendFrom: extendFrom,
      ),
    );
  }
}
