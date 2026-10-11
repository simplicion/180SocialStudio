import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../projects/project_provider.dart';
import 'all_channels_overview.dart';
import 'cc_widgets.dart';
import 'create_tab.dart';
import 'check_tab.dart';
import 'insights_sections.dart';

/// `GET /platform-team/:platform/overview` for the active project. Only stored and live numbers; nothing sampled.
final platformOverviewProvider = FutureProvider.autoDispose.family<Json, ({String platform, String projectId})>(
    (ref, k) => ref.watch(socialApiProvider).platformOverview(k.platform, k.projectId));

/// Command Center: unified growth engine and multi-platform cockpit.
/// 'all' = cross-channel intelligence overview, monthly script quotas, and 24h agent pulse.
/// platform-specific = Monitor (live metrics & queue), Create (AI drafts), Check (scoring tools).
class PlatformCommandScreen extends ConsumerStatefulWidget {
  const PlatformCommandScreen({super.key, this.initialPlatform});
  final String? initialPlatform;

  @override
  ConsumerState<PlatformCommandScreen> createState() => _PlatformCommandScreenState();
}

class _PlatformCommandScreenState extends ConsumerState<PlatformCommandScreen> {
  late String _platform = commandPlatforms.any((p) => p.id == widget.initialPlatform) ? widget.initialPlatform! : commandPlatforms.first.id;

  @override
  void didUpdateWidget(PlatformCommandScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialPlatform != null &&
        widget.initialPlatform != _platform &&
        commandPlatforms.any((p) => p.id == widget.initialPlatform)) {
      setState(() => _platform = widget.initialPlatform!);
    }
  }

  @override
  Widget build(BuildContext context) {
    final project = ref.watch(activeProjectProvider);
    final isAll = _platform == 'all';

    final scaffold = Scaffold(
      appBar: AppBar(
        title: Text(isAll ? 'Command Center & Analytics' : 'Command Center · ${platformLabel(_platform)}'),
        bottom: PreferredSize(
          preferredSize: Size.fromHeight(isAll ? 56 : 104),
          child: Column(children: [
            SizedBox(
              height: 56,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                children: [
                  for (final p in commandPlatforms)
                    Padding(
                      padding: EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        materialTapTargetSize: MaterialTapTargetSize.padded,
                        avatar: Icon(p.icon, size: 16, color: _platform == p.id ? AppTheme.primary : AppTheme.textSecondary),
                        label: Text(p.label),
                        selected: _platform == p.id,
                        onSelected: (_) => setState(() => _platform = p.id),
                      ),
                    ),
                ],
              ),
            ),
            if (!isAll)
              TabBar(tabs: const [Tab(text: 'Monitor'), Tab(text: 'Create'), Tab(text: 'Check')]),
          ]),
        ),
      ),
      body: project.when(
        loading: () => Padding(padding: EdgeInsets.all(16), child: UniversalSkeleton(type: SkeletonType.metrics, itemCount: 4)),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(allProjectsProvider)),
        data: (p) => p == null
            ? EmptyView(
                icon: Icons.folder_open_rounded,
                title: 'Create a project to monitor',
                message: 'Monitoring reads the accounts, posts and inbox of a project.',
                actionLabel: 'New project',
                onAction: () => context.push('/projects/new'),
              )
            : isAll
                ? AllChannelsOverview(
                    project: p,
                    onSelectPlatform: (id) => setState(() => _platform = id),
                  )
                : TabBarView(children: [
                    _MonitorTab(key: ValueKey('$_platform-${p.id}'), platform: _platform, projectId: p.id, projectName: p.name),
                    CreateTab(key: ValueKey('create-$_platform'), platform: _platform, projectId: p.id),
                    CheckTab(key: ValueKey('check-$_platform'), platform: _platform),
                  ]),
      ),
    );

    return isAll ? scaffold : DefaultTabController(length: 3, child: scaffold);
  }
}

class _MonitorTab extends ConsumerWidget {
  const _MonitorTab({super.key, required this.platform, required this.projectId, required this.projectName});
  final String platform;
  final String projectId;
  final String projectName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final key = (platform: platform, projectId: projectId);
    final overview = ref.watch(platformOverviewProvider(key));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(platformOverviewProvider(key).future),
      child: overview.when(
        loading: () => ListView(padding: EdgeInsets.all(16), children: [UniversalSkeleton(type: SkeletonType.metrics, itemCount: 4)]),
        error: (e, _) => ListView(children: [
          ErrorView(error: e, onRetry: () => ref.invalidate(platformOverviewProvider(key)), compact: true),
          Center(child: TextButton(onPressed: () => context.push('/projects/$projectId/accounts'), child: Text('Open connected accounts'))),
        ]),
        data: (o) => _content(context, o, () => ref.invalidate(platformOverviewProvider(key))),
      ),
    );
  }

  Widget _content(BuildContext context, Json o, VoidCallback reload) {
    final label = platformLabel(platform);
    final accounts = jList(o['accounts'], (m) => m);
    final pipeline = jMap(o['pipeline']);
    final queue = jList(o['queue'], (m) => m);
    final inbox = jMap(o['inbox']);
    final buckets = jMap(inbox['bucketCounts']);
    final priority = jList(inbox['priority'], (m) => m);
    final metrics = jList(o['metrics'], (m) => m);
    final avg = jInt(o['queueCraftScoreAvg']);

    return ListView(
      key: const Key('cc-monitor-list'),
      padding: EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        Text('$projectName · $label', style: TextStyle(fontSize: 12, color: AppTheme.textMuted, fontWeight: FontWeight.w600)),
        SizedBox(height: 8),
        if (accounts.isEmpty)
          SectionCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('No $label account connected', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              SizedBox(height: 4),
              Text('Connect the account to see followers, reach, your publishing queue and inbox here.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
              SizedBox(height: 12),
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: Size.fromHeight(44)),
                onPressed: () => context.push('/projects/$projectId/accounts'),
                child: Text('Connect $label'),
              ),
            ]),
          )
        else
          for (final a in accounts)
            Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: SectionCard(
                padding: EdgeInsets.all(12),
                borderColor: jBool(a['reauthRequired']) ? AppTheme.warning : null,
                onTap: jBool(a['reauthRequired']) ? () => context.push('/projects/$projectId/accounts') : null,
                child: Row(children: [
                  Icon(Icons.account_circle_outlined, color: AppTheme.textSecondary),
                  SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(jStrOr(a['accountName'], jStrOr(a['username'], label)), style: TextStyle(fontWeight: FontWeight.w700)),
                      if (jStr(a['username']) case final u? when u.isNotEmpty) Text('@$u', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                    ]),
                  ),
                  StatusChip(
                    label: jBool(a['reauthRequired']) ? 'Reconnect' : 'Connected',
                    color: jBool(a['reauthRequired']) ? AppTheme.warning : AppTheme.success,
                  ),
                ]),
              ),
            ),

        for (final m in metrics) _MetricsCard(metric: m),
        if (jStr(o['metricsError']) case final err?)
          Padding(padding: EdgeInsets.only(top: 4), child: Text('Live metrics could not be loaded: $err', style: TextStyle(fontSize: 12, color: AppTheme.warning))),

        SectionHeader('24-Hour Agent Recommendations', trailing: StatusChip(label: '24h Monitor Active', color: AppTheme.success)),
        SectionCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(Icons.auto_awesome_rounded, color: AppTheme.accent, size: 16),
              SizedBox(width: 8),
              Expanded(
                child: Text('Autonomous Agent Intelligence ($label)', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              ),
            ]),
            SizedBox(height: 8),
            Text(
              accounts.isEmpty
                  ? 'Connect your $label account to let autonomous agents analyze reach, algorithm updates, and hook performance every 24 hours.'
                  : (o['rewardedSignals'] is List && (o['rewardedSignals'] as List).isNotEmpty)
                      ? '$label algorithms are currently prioritizing ${(o['rewardedSignals'] as List).join(' & ')}. Focus on hooks with strong pattern interrupts.'
                      : 'Background agents monitor reach velocity, audience signals, and queue craft scores every 24 hours.',
              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.35),
            ),
          ]),
        ),

        SectionHeader('Publishing, last 30 days'),
        Row(children: [
          Expanded(child: StatTile(label: 'Published', value: '${jInt(pipeline['published30d']) ?? 0}')),
          SizedBox(width: 8),
          Expanded(child: StatTile(label: 'Scheduled', value: '${jInt(pipeline['scheduledUpcoming']) ?? 0}')),
          SizedBox(width: 8),
          Expanded(
            child: StatTile(
              label: 'Failed',
              value: '${jInt(pipeline['failed30d']) ?? 0}',
              color: (jInt(pipeline['failed30d']) ?? 0) > 0 ? AppTheme.error : null,
            ),
          ),
        ]),

        OwnPostsSection(platform: platform, projectId: projectId, ownPosts: jMap(o['ownPosts']), connected: accounts.isNotEmpty, onRefreshed: reload),

        RadarSection(platform: platform, projectId: projectId),

        SectionHeader('Waiting to go out', trailing: avg == null ? null : ScoreBadge(score: avg, label: 'avg craft')),
        if (queue.isEmpty)
          SectionCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Nothing queued for $label.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
              SizedBox(height: 10),
              OutlinedButton(
                style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
                onPressed: () => DefaultTabController.of(context).animateTo(1),
                child: Text('Draft a $label post'),
              ),
            ]),
          )
        else
          for (final q in queue) _QueueCard(post: q),

        SectionHeader(
          'Inbox triage',
          trailing: (jInt(inbox['unread']) ?? 0) > 0 ? StatusChip(label: '${jInt(inbox['unread'])} unread', color: AppTheme.accent) : null,
        ),
        if ((jInt(inbox['sampled']) ?? 0) == 0)
          SectionCard(
            child: Text(
              accounts.isEmpty ? 'Messages and comments appear here once the account is connected.' : 'No messages yet. New DMs and comments are sorted into leads, questions and noise here.',
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
            ),
          )
        else ...[
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final b in const [('LEAD', 'Leads'), ('KEYWORD', 'Keyword'), ('QUESTION', 'Questions'), ('SUBSTANCE', 'Discussion'), ('SUPPORT', 'Support'), ('NOISE', 'Noise')])
              StatTile(label: b.$2, value: '${jInt(buckets[b.$1]) ?? 0}', color: b.$1 == 'LEAD' && (jInt(buckets[b.$1]) ?? 0) > 0 ? AppTheme.success : null),
          ]),
          SizedBox(height: 8),
          for (final c in priority)
            Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: SectionCard(
                padding: EdgeInsets.all(12),
                onTap: () => context.push('/inbox/${jStrOr(c['conversationId'], '')}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    StatusChip(label: jStrOr(c['bucket'], ''), color: jStr(c['bucket']) == 'LEAD' ? AppTheme.success : AppTheme.accent),
                    SizedBox(width: 8),
                    Expanded(child: Text(jStrOr(c['author'], ''), overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
                    Text(timeAgo(jDate(c['lastMessageAt'])), style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
                  ]),
                  SizedBox(height: 6),
                  Text(jStrOr(c['text'], ''), maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13)),
                  SizedBox(height: 4),
                  Text(jStrOr(c['nextStep'], ''), style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      style: TextButton.styleFrom(minimumSize: Size(44, 44)),
                      onPressed: () => showReplyDrafts(context,
                          platform: platform, projectId: projectId, conversationId: jStrOr(c['conversationId'], ''), author: jStrOr(c['author'], ''), message: jStrOr(c['text'], '')),
                      icon: Icon(Icons.auto_awesome_rounded, size: 16),
                      label: Text('Draft reply'),
                    ),
                  ),
                ]),
              ),
            ),
        ],

        SectionHeader('What $label rewards'),
        SectionCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 6, runSpacing: 6, children: [for (final s in jStrList(o['rewardedSignals'])) StatusChip(label: s, color: AppTheme.accent)]),
            SizedBox(height: 10),
            for (final rule in jStrList(o['playbook']))
              Padding(padding: EdgeInsets.only(bottom: 6), child: Text('• $rule', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
          ]),
        ),
      ],
    );
  }
}

class _MetricsCard extends StatelessWidget {
  const _MetricsCard({required this.metric});
  final Json metric;

  @override
  Widget build(BuildContext context) {
    final source = jStrOr(metric['source'], 'unavailable');
    final unavailable = jMap(metric['unavailable']);
    final tiles = [
      for (final f in const [('followersCount', 'Followers'), ('reach', 'Reach'), ('views', 'Views'), ('impressions', 'Impressions'), ('engagements', 'Engagements')])
        if (jInt(metric[f.$1]) case final v?) StatTile(label: f.$2, value: '$v'),
    ];
    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: SectionCard(
        padding: EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('Account numbers', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
            Text(
              source == 'live'
                  ? 'Live${jInt(metric['periodDays']) == null ? '' : ' · last ${jInt(metric['periodDays'])} days'}'
                  : source == 'stored'
                      ? 'Saved ${timeAgo(jDate(metric['fetchedAt']))}'
                      : 'Unavailable',
              style: TextStyle(fontSize: 11, color: source == 'live' ? AppTheme.success : AppTheme.textMuted, fontWeight: FontWeight.w600),
            ),
          ]),
          SizedBox(height: 8),
          if (tiles.isNotEmpty) Wrap(spacing: 8, runSpacing: 8, children: tiles),
          if (tiles.isEmpty || source == 'unavailable')
            Text(
              jStr(unavailable['message']) ?? 'The platform did not report numbers for this account.',
              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
        ]),
      ),
    );
  }
}

class _QueueCard extends StatelessWidget {
  const _QueueCard({required this.post});
  final Json post;

  @override
  Widget build(BuildContext context) {
    final score = jInt(post['craftScore']);
    final problems = jStrList(post['problems']);
    final warnings = jStrList(post['warnings']);
    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: SectionCard(
        padding: EdgeInsets.all(12),
        borderColor: problems.isEmpty ? null : AppTheme.error.withValues(alpha: 0.5),
        onTap: () => context.push('/posts/${jStrOr(post['postId'], '')}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(jStrOr(post['title'], 'Untitled post'), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            if (score != null) ScoreBadge(score: score),
          ]),
          SizedBox(height: 2),
          Text(
            [jStrOr(post['status'], ''), if (jDate(post['scheduledFor']) case final d?) fmtDateTime(d)].where((s) => s.isNotEmpty).join(' · '),
            style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
          ),
          if (jStrOr(post['feedCutout'], '').isNotEmpty) ...[
            SizedBox(height: 8),
            Text('${jStrOr(post['feedCutout'], '')}…', maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13)),
          ],
          for (final p in problems)
            Padding(padding: EdgeInsets.only(top: 6), child: Text('• $p', style: TextStyle(fontSize: 12, color: AppTheme.error))),
          for (final w in warnings.take(2))
            Padding(padding: EdgeInsets.only(top: 6), child: Text('• $w', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
        ]),
      ),
    );
  }
}
