import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/trend_report.dart';
import 'trend_lab_providers.dart';

/// "Create from Trends": type a topic, start research, land on the live report.
void showTrendTopicSheet(BuildContext context, {required String projectId}) {
  showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    backgroundColor: AppTheme.surfaceElevated,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
      child: TrendTopicSheet(projectId: projectId),
    ),
  );
}

const _examples = ['Creatine for women over 40', 'AI tools for small business', 'Skincare for sensitive skin in winter', 'First-time home buyers'];

class TrendTopicSheet extends ConsumerStatefulWidget {
  const TrendTopicSheet({super.key, required this.projectId});
  final String projectId;

  @override
  ConsumerState<TrendTopicSheet> createState() => _TrendTopicSheetState();
}

class _TrendTopicSheetState extends ConsumerState<TrendTopicSheet> {
  final _topic = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _topic.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final topic = _topic.text.trim();
    if (topic.length < 2) {
      showError(context, 'Type a topic to research first.');
      return;
    }
    setState(() => _busy = true);
    try {
      final id = await ref.read(socialApiProvider).startTrendReport(widget.projectId, topic);
      if (!mounted) return;
      final router = GoRouter.of(context);
      Navigator.of(context).pop();
      router.push('/trend-lab/reports/$id?projectId=${widget.projectId}');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _open(TrendReportSummary r) {
    final router = GoRouter.of(context);
    Navigator.of(context).pop();
    router.push('/trend-lab/reports/${r.reportId}?projectId=${widget.projectId}');
  }

  @override
  Widget build(BuildContext context) {
    final lanes = ref.watch(trendLanesProvider(widget.projectId)).valueOrNull;
    final recent = ref.watch(trendReportsProvider(widget.projectId)).valueOrNull ?? const <TrendReportSummary>[];
    final off = lanes?.lanes.where((l) => !l.on).toList() ?? const <TrendLabLane>[];
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppTheme.border, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 16),
          Row(children: [
            Icon(Icons.local_fire_department_rounded, color: AppTheme.accent),
            const SizedBox(width: 8),
            Text('Create from Trends', style: Theme.of(context).textTheme.titleLarge),
          ]),
          const SizedBox(height: 6),
          Text(
            'Four research agents read what your audience engaged with in the last 30 days, then tell you whether to post about it, how people feel, and the angles you can own.',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _topic,
            autofocus: true,
            maxLength: 200,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _busy ? null : _start(),
            decoration: fieldDecoration('Topic', hint: 'e.g. creatine for women over 40'),
          ),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final ex in _examples)
              ActionChip(label: Text(ex, style: const TextStyle(fontSize: 12)), onPressed: () => setState(() => _topic.text = ex)),
          ]),
          if (lanes != null && !lanes.configured) ...[
            const SizedBox(height: 12),
            Text('Trend research is not set up on the server yet.', style: TextStyle(fontSize: 12, color: AppTheme.warning)),
          ] else if (off.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Running without: ${off.map((l) => l.lane.replaceAll('_', ' ')).join(', ')}. Results use the sources that are on.',
                style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
          ],
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _busy || lanes?.configured == false ? null : _start,
            icon: _busy
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.travel_explore_rounded),
            label: Text(_busy ? 'Starting research…' : 'Research this topic'),
          ),
          if (recent.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text('Your recent research', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textMuted)),
            const SizedBox(height: 6),
            for (final r in recent.take(5))
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: Icon(r.status == 'done' ? Icons.insights_rounded : r.status == 'failed' ? Icons.error_outline_rounded : Icons.hourglass_top_rounded,
                    color: r.status == 'failed' ? AppTheme.warning : AppTheme.accent, size: 20),
                title: Text(r.topic, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                  [timeAgo(r.createdAt), if (r.topTrendTitle != null) r.topTrendTitle!].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12),
                ),
                onTap: () => _open(r),
              ),
          ],
        ]),
      ),
    );
  }
}
