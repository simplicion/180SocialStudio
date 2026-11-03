import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/trend_report.dart';
import '../command_center/cc_widgets.dart';
import 'create_script_sheet.dart';
import 'trend_lab_providers.dart';

/// Live research progress, then the Trend Report. Every number shown was computed on the server from source data.
class TrendReportScreen extends ConsumerStatefulWidget {
  const TrendReportScreen({super.key, required this.projectId, required this.reportId, this.pollInterval});
  final String projectId;
  final String reportId;
  final Duration? pollInterval;

  @override
  ConsumerState<TrendReportScreen> createState() => _TrendReportScreenState();
}

class _TrendReportScreenState extends ConsumerState<TrendReportScreen> with JobPoller<TrendReportScreen, TrendReportJob> {
  String? _clusterId;

  @override
  Duration? get interval => widget.pollInterval;

  @override
  Future<TrendReportJob> fetchJob() => ref.read(socialApiProvider).getTrendReport(widget.projectId, widget.reportId);

  @override
  bool isFinished(TrendReportJob job) => !job.isRunning;

  @override
  void initState() {
    super.initState();
    startPolling();
  }

  @override
  Widget build(BuildContext context) {
    final j = job;
    final report = j?.report;
    final clusters = report?.clusters ?? const <TrendCluster>[];
    final selected = clusters.where((c) => c.id == _clusterId).firstOrNull ?? clusters.firstOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(j?.topic.isNotEmpty == true ? j!.topic : 'Trend Report', maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: j == null
          ? (pollError != null ? ErrorView(error: pollError!, onRetry: startPolling) : const LoadingView())
          : j.isFailed
              ? ErrorView(error: j.errorMessage ?? 'The research could not finish.', onRetry: () => Navigator.of(context).maybePop())
              : j.isRunning
                  ? _ResearchProgress(job: j)
                  : clusters.isEmpty
                      ? _NoTrends(report: report!)
                      : ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
                          if (clusters.length > 1) ...[
                            SectionHeader('Trends found'),
                            Wrap(spacing: 6, runSpacing: 6, children: [
                              for (final c in clusters)
                                ChoiceChip(
                                  label: Text('${c.title} · ${c.metrics.opportunityScore}', overflow: TextOverflow.ellipsis),
                                  selected: c.id == selected!.id,
                                  onSelected: (_) => setState(() => _clusterId = c.id),
                                ),
                            ]),
                            const SizedBox(height: 8),
                          ],
                          _ClusterReport(cluster: selected!, report: report!),
                        ]),
      bottomNavigationBar: selected == null || j?.isDone != true
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: FilledButton.icon(
                  icon: const Icon(Icons.edit_note_rounded),
                  label: const Text('Create script from this'),
                  onPressed: () => showCreateScriptSheet(context, projectId: widget.projectId, reportId: widget.reportId, cluster: selected),
                ),
              ),
            ),
    );
  }
}

// ------------------------------------------------------------------ progress

class _ResearchProgress extends StatelessWidget {
  const _ResearchProgress({required this.job});
  final TrendReportJob job;

  static const _steps = [
    ('Planning searches for your topic', 5),
    ('Social pulse agent: communities and comments', 33),
    ('Platform agent: YouTube and Instagram', 51),
    ('Web & news agent: articles in full', 69),
    ('Analyst agent: stories, reactions and angles', 99),
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(24), children: [
      Text('Researching the last 30 days', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 6),
      Text('This usually takes 1–2 minutes. You can leave this screen; the report is saved.', style: TextStyle(color: AppTheme.textSecondary)),
      const SizedBox(height: 20),
      LinearProgressIndicator(value: job.progress / 100),
      const SizedBox(height: 20),
      for (var i = 0; i < _steps.length; i++)
        _Step(
          label: _steps[i].$1,
          state: job.progress >= _steps[i].$2 ? _StepState.done : (i == 0 || job.progress >= _steps[i - 1].$2) ? _StepState.active : _StepState.waiting,
        ),
      if (job.detail != null) ...[
        const SizedBox(height: 12),
        Text(job.detail!, style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
      ],
    ]);
  }
}

enum _StepState { waiting, active, done }

class _Step extends StatelessWidget {
  const _Step({required this.label, required this.state});
  final String label;
  final _StepState state;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [
          SizedBox(
            width: 22,
            height: 22,
            child: switch (state) {
              _StepState.done => Icon(Icons.check_circle_rounded, color: AppTheme.success, size: 22),
              _StepState.active => const Padding(padding: EdgeInsets.all(3), child: CircularProgressIndicator(strokeWidth: 2)),
              _StepState.waiting => Icon(Icons.radio_button_unchecked_rounded, color: AppTheme.textMuted, size: 22),
            },
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: TextStyle(color: state == _StepState.waiting ? AppTheme.textMuted : null))),
        ]),
      );
}

class _NoTrends extends StatelessWidget {
  const _NoTrends({required this.report});
  final TrendReport report;

  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(16), children: [
        const EmptyView(
          icon: Icons.search_off_rounded,
          title: 'No recent discussion found',
          message: 'Nobody engaged with this topic in the last 30 days on the sources we could read. Try a broader or differently worded topic.',
        ),
        _SourcesUsed(statuses: report.statuses),
      ]);
}

// ------------------------------------------------------------------ report

const _verdictText = {
  'create_now': ('Create now', 'Strong, timely and a fit for you.'),
  'sharpen_angle': ('Create with a sharper angle', 'Worth covering, but only with a specific point of view.'),
  'wait': ('Wait', 'Not enough engagement or evidence yet.'),
  'skip': ('Skip', 'Not worth your time right now.'),
};

Color _verdictColor(String v) => switch (v) {
      'create_now' => AppTheme.success,
      'sharpen_angle' => AppTheme.accent,
      'wait' => AppTheme.warning,
      _ => AppTheme.textMuted,
    };

String _compact(int n) => n >= 1000000 ? '${(n / 1000000).toStringAsFixed(1)}M' : n >= 1000 ? '${(n / 1000).toStringAsFixed(n >= 10000 ? 0 : 1)}K' : '$n';

void _open(String url) {
  final uri = Uri.tryParse(url);
  if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) launchUrl(uri, mode: LaunchMode.externalApplication).catchError((_) => false);
}

class _ClusterReport extends StatelessWidget {
  const _ClusterReport({required this.cluster, required this.report});
  final TrendCluster cluster;
  final TrendReport report;

  @override
  Widget build(BuildContext context) {
    final m = cluster.metrics;
    final (title, line) = _verdictText[m.verdict] ?? ('Wait', '');
    final color = _verdictColor(m.verdict);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      // 1. Verdict
      SectionCard(
        borderColor: color.withValues(alpha: 0.5),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.flag_rounded, color: color),
            const SizedBox(width: 8),
            Expanded(child: Text(title, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color))),
            StatusChip(label: 'Confidence ${m.confidence}%', color: AppTheme.textSecondary),
          ]),
          const SizedBox(height: 6),
          Text(cluster.title, style: const TextStyle(fontWeight: FontWeight.w700)),
          if (line.isNotEmpty) Text(line, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          for (final r in m.verdictReasons) Padding(padding: const EdgeInsets.only(top: 4), child: Text('• $r', style: const TextStyle(fontSize: 13))),
        ]),
      ),
      // 2. Key numbers
      SectionHeader('Key numbers'),
      // Three per row at their natural height (a fixed-aspect grid clips the tiles on small phones).
      LayoutBuilder(builder: (context, c) {
        final w = (c.maxWidth - 16) / 3;
        final tiles = [
          StatTile(label: 'Opportunity', value: '${m.opportunityScore}/100', color: m.opportunityScore >= 65 ? AppTheme.success : null),
          StatTile(label: 'Momentum', value: m.momentumLabel == 'unknown' ? '—' : m.momentum != null ? '${m.momentumLabel} ${m.momentum}x' : m.momentumLabel),
          StatTile(label: 'Engagement', value: '${m.engagementIndex}/100'),
          StatTile(label: 'Saturation', value: m.saturationLabel == 'unknown' ? '—' : m.saturationLabel),
          StatTile(label: 'Brand fit', value: '${m.brandFit}/100'),
          StatTile(label: 'Posts read', value: '${m.totalItems}'),
        ];
        return Wrap(spacing: 8, runSpacing: 8, children: [for (final t in tiles) SizedBox(width: w, child: t)]);
      }),
      ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: Text('How we calculate this', style: TextStyle(fontSize: 13, color: AppTheme.accentBlue)),
        children: [for (final line in report.methodology) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(line, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)))],
      ),
      // 3. What & why now
      SectionHeader('What it is and why now'),
      Text(cluster.summary),
      const SizedBox(height: 6),
      Text(cluster.whyNow, style: TextStyle(color: AppTheme.textSecondary)),
      // 4. Reactions
      SectionHeader('How people are reacting'),
      if (m.sentiment.n > 0) _SentimentBar(s: m.sentiment) else Text('Not enough comments to read sentiment.', style: TextStyle(color: AppTheme.textMuted, fontSize: 13)),
      for (final q in cluster.quotes)
        InkWell(
          onTap: () => _open(q.url),
          child: Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.format_quote_rounded, size: 18, color: AppTheme.accent),
              const SizedBox(width: 6),
              Expanded(child: Text('"${q.quote}" · ${q.source}', style: const TextStyle(fontStyle: FontStyle.italic, fontSize: 13))),
            ]),
          ),
        ),
      // 5. Questions
      if (cluster.audienceQuestions.isNotEmpty) ...[
        SectionHeader('What people are asking'),
        for (final q in cluster.audienceQuestions) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('• $q')),
      ],
      // 6. Angles
      SectionHeader('Angles you can own'),
      for (final a in cluster.angles)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: SectionCard(
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(a.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(a.tension, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(height: 6),
                  Text('Hook: "${a.draftHook}"', style: const TextStyle(fontSize: 13, fontStyle: FontStyle.italic)),
                ]),
              ),
              const SizedBox(width: 8),
              ScoreBadge(score: a.hookScore, label: a.hookGrade.toLowerCase()),
            ]),
          ),
        ),
      // 7. Competition
      SectionHeader('Competition'),
      Text(
        m.youtubeUploads == null
            ? 'YouTube data was not available for this research.'
            : '${_compact(m.youtubeUploads!)} YouTube videos on this in the last ${report.windowDays} days'
                '${m.youtubeMedianViews != null ? '; the top ones have a median of ${_compact(m.youtubeMedianViews!)} views' : ''}. Saturation: ${m.saturationLabel}.',
        style: const TextStyle(fontSize: 13),
      ),
      // 8. Outlook
      SectionHeader('Prediction vs your usual'),
      if (report.outlookAvailable)
        for (final f in report.outlookByFormat)
          Text('• Your ${f.format}s get ${f.medianMultiple}x your usual (${f.label}, ${f.posts} posts)', style: const TextStyle(fontSize: 13))
      else
        Text(report.outlookNote, style: TextStyle(fontSize: 13, color: AppTheme.textMuted)),
      // 9. Sources
      SectionHeader('Sources'),
      for (final it in cluster.items)
        ListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: Text(it.title, maxLines: 2, overflow: TextOverflow.ellipsis),
          subtitle: Text([it.source, if (it.publishedAt != null) it.publishedAt!, if (it.engagement != null) '${_compact(it.engagement!)} ${it.engagementUnit}'].join(' · ')),
          trailing: const Icon(Icons.open_in_new_rounded, size: 16),
          onTap: () => _open(it.url),
        ),
      _SourcesUsed(statuses: report.statuses),
    ]);
  }
}

class _SentimentBar extends StatelessWidget {
  const _SentimentBar({required this.s});
  final TrendSentiment s;

  @override
  Widget build(BuildContext context) {
    final parts = [(s.positive, AppTheme.success, 'positive'), (s.mixed, AppTheme.accent, 'mixed'), (s.negative, AppTheme.error, 'negative'), (s.neutral, AppTheme.textMuted, 'neutral')]
        .where((p) => p.$1 > 0)
        .toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: SizedBox(height: 10, child: Row(children: [for (final p in parts) Expanded(flex: p.$1, child: Container(color: p.$2))])),
      ),
      const SizedBox(height: 6),
      Text('${parts.map((p) => '${p.$1}% ${p.$3}').join(' · ')}  (from ${s.n} comments and posts)', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
    ]);
  }
}

class _SourcesUsed extends StatelessWidget {
  const _SourcesUsed({required this.statuses});
  final List<TrendSourceStatus> statuses;

  @override
  Widget build(BuildContext context) {
    if (statuses.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(spacing: 6, runSpacing: 6, children: [
        for (final s in statuses)
          StatusChip(
            label: '${s.source}${s.status == 'ok' ? ' · ${s.items}' : ' · ${s.status}'}',
            color: s.status == 'ok' ? AppTheme.success : s.status == 'error' ? AppTheme.warning : AppTheme.textMuted,
          ),
      ]),
    );
  }
}
