import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/util/poll_backoff.dart';
import '../../data/models/trend_report.dart';

/// Recent research of a project (reopen without paying again).
final trendReportsProvider = FutureProvider.autoDispose.family<List<TrendReportSummary>, String>(
    (ref, projectId) => ref.watch(socialApiProvider).listTrendReports(projectId));

/// Which research lanes are live on the server.
final trendLanesProvider = FutureProvider.autoDispose.family<({bool configured, List<TrendLabLane> lanes}), String>(
    (ref, projectId) => ref.watch(socialApiProvider).trendLabLanes(projectId));

/// Polls a server job with the app's backoff until [isFinished] returns true or the widget goes away.
/// Tests pass [interval] to poll quickly.
mixin JobPoller<W extends StatefulWidget, T> on State<W> {
  T? job;
  Object? pollError;
  Timer? _timer;
  int _polls = 0;

  Future<T> fetchJob();
  bool isFinished(T job);
  Duration? get interval => null;

  void startPolling() {
    _timer?.cancel();
    _polls = 0;
    _tick();
  }

  Future<void> _tick() async {
    try {
      final next = await fetchJob();
      if (!mounted) return;
      setState(() {
        job = next;
        pollError = null;
      });
      if (isFinished(next)) return;
    } catch (e) {
      if (!mounted) return;
      setState(() => pollError = e);
      // Keep polling through transient network errors, but slower.
    }
    _timer = Timer(pollDelay(_polls++, override: interval), _tick);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
