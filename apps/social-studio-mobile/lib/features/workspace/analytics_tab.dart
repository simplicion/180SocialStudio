import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/util/json.dart';
import '../../data/models/project.dart';
import '../command_center/all_channels_overview.dart';

final projectAnalyticsProvider = FutureProvider.autoDispose.family<Json, (String, String)>(
    (ref, key) => ref.watch(socialApiProvider).projectAnalytics(key.$1, range: key.$2));

/// Unified Analytics Tab in Project Workspace.
/// Powered by AllChannelsOverview to provide cross-channel intelligence, monthly script capacity,
/// and 24-hour background AI agent monitoring with deep-dive navigation to platform cockpits.
class AnalyticsTab extends StatelessWidget {
  const AnalyticsTab({super.key, required this.project});
  final Project project;

  @override
  Widget build(BuildContext context) {
    return AllChannelsOverview(
      project: project,
      onSelectPlatform: (platformId) => context.push('/command-center?platform=$platformId'),
    );
  }
}
