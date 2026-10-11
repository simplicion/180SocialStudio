import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/platform.dart';
import '../../data/models/project.dart';
import '../workspace/analytics_tab.dart';
import 'cc_widgets.dart';

/// Unified All-Channels Overview & Intelligence Dashboard.
/// Consolidates macro workspace analytics, monthly script quotas, 24-hour AI agent intelligence,
/// cross-channel pipeline health, and direct operational shortcuts into a single cockpit.
class AllChannelsOverview extends ConsumerStatefulWidget {
  const AllChannelsOverview({
    super.key,
    required this.project,
    required this.onSelectPlatform,
  });

  final Project project;
  final ValueChanged<String> onSelectPlatform;

  @override
  ConsumerState<AllChannelsOverview> createState() => _AllChannelsOverviewState();
}

class _AllChannelsOverviewState extends ConsumerState<AllChannelsOverview> {
  String _range = '30d';

  Future<void> _handleRefresh() async {
    HapticFeedback.lightImpact();
    final key = (widget.project.id, _range);
    ref.invalidate(projectAnalyticsProvider(key));
    try {
      await ref.read(projectAnalyticsProvider(key).future);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final key = (widget.project.id, _range);
    final data = ref.watch(projectAnalyticsProvider(key));
    final m = widget.project.metrics;
    final accounts = widget.project.socialAccounts;
    final attentionAccounts = accounts.where((a) => a.needsAttention).toList();

    return RefreshIndicator(
      onRefresh: _handleRefresh,
      child: ListView(
        key: const Key('cc-all-channels-list'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
        children: [
          // ── Header & Subtitle ─────────────────────────────────────────────
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.project.name,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Cross-Channel Intelligence & Studio Analytics',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // ── Critical Token Attention Alert Banner ─────────────────────────
          if (attentionAccounts.isNotEmpty) ...[
            _buildAttentionBanner(context, attentionAccounts),
            const SizedBox(height: 12),
          ],

          // ── Time Range Selector ───────────────────────────────────────────
          Center(
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: '7d', label: Text('7 Days')),
                ButtonSegment(value: '30d', label: Text('30 Days')),
                ButtonSegment(value: '90d', label: Text('90 Days')),
              ],
              selected: {_range},
              onSelectionChanged: (s) => setState(() => _range = s.first),
            ),
          ),
          const SizedBox(height: 16),

          if (!data.hasValue && data.isLoading) ...[
            const Padding(
              padding: EdgeInsets.all(16),
              child: UniversalSkeleton(type: SkeletonType.metrics, itemCount: 6),
            ),
          ] else if (!data.hasValue && data.hasError) ...[
            ErrorView(
              error: data.error!,
              compact: true,
              onRetry: _handleRefresh,
            ),
          ] else ...[
            Builder(
              builder: (context) {
                final j = data.valueOrNull ?? const {};
                final a = jMap(j['analytics'] ?? j['data'] ?? j);
                final postsPublished = (a['postsPublished'] as num?)?.toInt() ?? 0;
                final postsCreated = (a['postsCreated'] as num?)?.toInt() ?? 0;
                final postsScheduledInRange = (a['postsScheduledInRange'] as num?)?.toInt() ?? 0;
                final postsScheduledUpcoming = (a['postsScheduledUpcoming'] as num?)?.toInt() ?? 0;
                final postsFailed = (a['postsFailed'] as num?)?.toInt() ?? 0;
                final postsAwaitingApproval = (a['postsAwaitingApproval'] as num?)?.toInt() ?? 0;

                // AI Engagement & Automation stats
                final engagementActiveRules = (a['engagementActiveRules'] as num?)?.toInt() ?? 0;
                final engagementInteractionsInRange = (a['engagementInteractionsInRange'] as num?)?.toInt() ?? 0;

                // Approval stats
                final sessionsSent = (a['reviewSessionsSent'] as num?)?.toInt() ?? 0;
                final sessionsApproved = (a['reviewSessionsApproved'] as num?)?.toInt() ?? 0;
                final sessionsPending = (a['reviewSessionsPending'] as num?)?.toInt() ?? 0;
                final sessionsRevisions = (a['reviewSessionsRevisionsRequested'] as num?)?.toInt() ?? 0;
                final avgHours = (a['approvalTurnaroundHoursAvg'] as num?)?.toDouble();
                final medianHours = (a['approvalTurnaroundHoursMedian'] as num?)?.toDouble();

                // Inbox / Leads
                final conversations = (a['inboxConversations'] as num?)?.toInt() ?? 0;
                final unread = (a['inboxUnread'] as num?)?.toInt() ?? 0;
                final convertedLeads = (a['inboxConvertedToLeads'] as num?)?.toInt() ?? 0;

                // Milestones & Viral Recognition
                final milestones = (a['milestones'] as List?) ?? const [];
                final topPostViews = (a['topPostViews'] as num?)?.toInt() ?? 0;
                final topPostTitle = (a['topPostTitle'] as String?) ?? '';

                // Platform distribution
                final platforms = <SocialPlatform, int>{};
                for (final p in SocialPlatform.values) {
                  final count = (a['published_${p.id}'] as num?)?.toInt() ?? 0;
                  if (count > 0) platforms[p] = count;
                }

                // Monthly script quotas (Target standard: 30 scripts/posts per month)
                const monthlyTarget = 30;
                final scriptsDone = postsCreated;
                final scriptsLeft = max(0, monthlyTarget - scriptsDone);
                final progress = (scriptsDone / monthlyTarget).clamp(0.0, 1.0);

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // ── SECTION 0: Creator Milestone & Algorithmic Momentum ──
                    _buildCreatorMilestoneCard(
                      context,
                      milestones: milestones,
                      topPostViews: topPostViews,
                      topPostTitle: topPostTitle,
                    ),
                    const SizedBox(height: 12),

                    // ── SECTION 1: Monthly Capacity & Scripts Quota Strip ───
                    _buildMonthlyCapacityCard(
                      scriptsDone: scriptsDone,
                      scriptsLeft: scriptsLeft,
                      target: monthlyTarget,
                      progress: progress,
                      scheduledUpcoming: postsScheduledUpcoming,
                      publishedTotal: postsPublished,
                    ),
                    const SizedBox(height: 12),

                    // ── SECTION 2: Quick Operations Bar ─────────────────────
                    _buildQuickOperationsBar(context),
                    const SizedBox(height: 16),

                  // ── Spotlight: Pending Approvals Warning ────────────────
                  if (postsAwaitingApproval > 0) ...[
                    _buildPendingReviewSpotlight(context, postsAwaitingApproval),
                    const SizedBox(height: 16),
                  ],

                  // ── SECTION 3: 24-Hour AI Agent Intelligence Pulse ──────
                  _buildAgentIntelligencePulse(
                    accounts: accounts,
                    postsPublished: postsPublished,
                    postsFailed: postsFailed,
                    postsAwaitingApproval: postsAwaitingApproval,
                    engagementActiveRules: engagementActiveRules,
                    engagementInteractionsInRange: engagementInteractionsInRange,
                    convertedLeads: convertedLeads,
                    unread: unread,
                  ),
                  const SizedBox(height: 16),

                  // ── SECTION 4: Cross-Channel Pipeline KPIs ──────────────
                  SectionHeader('Publishing Pipeline ($_range)'),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 1.8,
                    children: [
                      _kpiCard(
                        'Published ($_range)',
                        '$postsPublished',
                        Icons.rocket_launch_rounded,
                        AppTheme.success,
                        subtitle: '$postsCreated created in range',
                      ),
                      _kpiCard(
                        'Scheduled',
                        '$postsScheduledInRange',
                        Icons.calendar_today_rounded,
                        AppTheme.accentBlue,
                        subtitle: '$postsScheduledUpcoming upcoming in queue',
                      ),
                      _kpiCard(
                        'Created / Drafted',
                        '$postsCreated',
                        Icons.edit_note_rounded,
                        AppTheme.accent,
                        subtitle: '$scriptsLeft scripts to monthly goal',
                      ),
                      _kpiCard(
                        'Failed / Blocked',
                        '$postsFailed',
                        Icons.error_outline_rounded,
                        postsFailed > 0 ? AppTheme.error : AppTheme.textMuted,
                        subtitle: postsFailed > 0 ? 'Requires attention' : 'Clean pipeline',
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // ── SECTION 5: Channel Distribution & Cockpit Access ───
                  SectionHeader(
                    'Publishing by Channel',
                    trailing: Text(
                      'Tap channel to open cockpit',
                      style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
                    ),
                  ),
                  _buildChannelDistributionCard(
                    platforms: platforms,
                    totalPublished: postsPublished,
                    accounts: accounts,
                  ),
                  const SizedBox(height: 16),

                  // ── SECTION 6: Client Review Velocity ───────────────────
                  SectionHeader('Client Review Velocity'),
                  SectionCard(
                    child: Column(
                      children: [
                        _metricRow('Review Sessions Sent', '$sessionsSent'),
                        const Divider(height: 16),
                        _metricRow('Sessions Approved', '$sessionsApproved'),
                        if (sessionsPending > 0) ...[
                          const Divider(height: 16),
                          _metricRow('Pending Review', '$sessionsPending', highlightColor: AppTheme.warning),
                        ],
                        if (sessionsRevisions > 0) ...[
                          const Divider(height: 16),
                          _metricRow('Revisions Requested', '$sessionsRevisions', highlightColor: AppTheme.error),
                        ],
                        const Divider(height: 16),
                        _metricRow(
                          'Average Turnaround',
                          avgHours != null ? '${avgHours.toStringAsFixed(1)} hours' : 'N/A',
                        ),
                        if (medianHours != null) ...[
                          const Divider(height: 16),
                          _metricRow('Median Turnaround', '${medianHours.toStringAsFixed(1)} hours'),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),

                  // ── SECTION 7: Social CRM & Inbound Leads ───────────────
                  SectionHeader('Inquiries & Community Automation'),
                  SectionCard(
                    child: Column(
                      children: [
                        _metricRow('Total Conversations', '$conversations'),
                        const Divider(height: 16),
                        _metricRow(
                          'Unread Inbound Messages',
                          '$unread',
                          highlightColor: unread > 0 ? AppTheme.warning : null,
                        ),
                        const Divider(height: 16),
                        _metricRow(
                          'Converted to CRM Leads',
                          '$convertedLeads',
                          highlightColor: convertedLeads > 0 ? AppTheme.success : null,
                        ),
                        if (engagementActiveRules > 0) ...[
                          const Divider(height: 16),
                          _metricRow('Active AI Engagement Rules', '$engagementActiveRules'),
                        ],
                        if (engagementInteractionsInRange > 0) ...[
                          const Divider(height: 16),
                          _metricRow('AI Assisted Interactions', '$engagementInteractionsInRange', highlightColor: AppTheme.primary),
                        ],
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ],
        const SizedBox(height: 16),

          // ── SECTION 8: All-Time Project Summary ─────────────────
          SectionHeader('All-Time Project Summary'),
          SectionCard(
            child: Column(
              children: [
                _metricRow('Total posts', '${m.totalPosts}'),
                const Divider(height: 16),
                _metricRow('Published posts', '${m.publishedPosts}'),
                const Divider(height: 16),
                _metricRow('Scheduled posts', '${m.scheduledPosts}'),
                const Divider(height: 16),
                _metricRow('Pending approvals', '${m.pendingApprovals}'),
                const Divider(height: 16),
                _metricRow('Outstanding tasks', '${m.outstandingTasks}'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Critical Token Attention Alert Banner ──────────────────────────────────
  Widget _buildAttentionBanner(BuildContext context, List<dynamic> accounts) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.warning.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.warning_amber_rounded, color: AppTheme.warning, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${accounts.length} Channel Token(s) Need Reauthorization',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: AppTheme.warning),
                ),
                const SizedBox(height: 2),
                Text(
                  'Refresh tokens to prevent automated posting disruptions.',
                  style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
          TextButton(
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            onPressed: () => context.push('/projects/${widget.project.id}/accounts'),
            child: Text('Reconnect', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.warning)),
          ),
        ],
      ),
    );
  }

  // ── Quick Operations Bar ──────────────────────────────────────────────────
  Widget _buildQuickOperationsBar(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _actionButton(
            context,
            icon: Icons.add_circle_outline_rounded,
            label: 'New Post',
            onTap: () => context.push('/posts/new'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _actionButton(
            context,
            icon: Icons.calendar_month_rounded,
            label: 'Calendar',
            onTap: () => context.push('/projects/${widget.project.id}/calendar'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _actionButton(
            context,
            icon: Icons.forum_rounded,
            label: 'Inbox',
            onTap: () => context.push('/inbox'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _actionButton(
            context,
            icon: Icons.hub_rounded,
            label: 'Channels',
            onTap: () => context.push('/projects/${widget.project.id}/accounts'),
          ),
        ),
      ],
    );
  }

  Widget _actionButton(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        decoration: BoxDecoration(
          color: AppTheme.surfaceElevated,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.border),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: AppTheme.primary),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  // ── Pending Review Spotlight ──────────────────────────────────────────────
  Widget _buildPendingReviewSpotlight(BuildContext context, int count) {
    return SectionCard(
      padding: const EdgeInsets.all(12),
      borderColor: AppTheme.warning.withValues(alpha: 0.5),
      onTap: () => context.push('/projects/${widget.project.id}/content'),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppTheme.warning.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(Icons.rate_review_outlined, color: AppTheme.warning, size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$count post(s) awaiting approval',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                ),
                const SizedBox(height: 2),
                Text(
                  'Client review required before posts can enter the publishing queue.',
                  style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right_rounded, size: 18, color: AppTheme.textMuted),
        ],
      ),
    );
  }

  // ── Monthly Capacity Card ─────────────────────────────────────────────────
  Widget _buildMonthlyCapacityCard({
    required int scriptsDone,
    required int scriptsLeft,
    required int target,
    required double progress,
    required int scheduledUpcoming,
    required int publishedTotal,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.auto_stories_rounded, color: AppTheme.accent, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Monthly Content & Script Capacity',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$scriptsLeft scripts remaining for this month\'s target',
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: scriptsLeft == 0 ? AppTheme.success.withValues(alpha: 0.15) : AppTheme.primary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$scriptsDone / $target Target',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: scriptsLeft == 0 ? AppTheme.success : AppTheme.primary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: progress,
              backgroundColor: AppTheme.surfaceElevated,
              valueColor: AlwaysStoppedAnimation<Color>(
                progress >= 1.0 ? AppTheme.success : AppTheme.primary,
              ),
              minHeight: 8,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 4,
            children: [
              Text(
                '${(progress * 100).toInt()}% goal achieved',
                style: TextStyle(fontSize: 11, color: AppTheme.textMuted, fontWeight: FontWeight.w600),
              ),
              Text(
                '$scheduledUpcoming ready in queue · $publishedTotal live',
                style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── 24-Hour AI Agent Intelligence Pulse ───────────────────────────────────
  Widget _buildAgentIntelligencePulse({
    required List<dynamic> accounts,
    required int postsPublished,
    required int postsFailed,
    required int postsAwaitingApproval,
    required int engagementActiveRules,
    required int engagementInteractionsInRange,
    required int convertedLeads,
    required int unread,
  }) {
    final needsReauth = accounts.any((a) => jBool(a.reauthRequired) || a.needsAttention == true);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: AppTheme.success,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  '24-Hour AI Agent Intelligence Pulse',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              StatusChip(label: '24h Monitor Active', color: AppTheme.success),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Autonomous growth agents monitor your connected profiles every 24 hours to track reach momentum, detect errors, and surface optimization opportunities.',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.35),
          ),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),

          // Pulse bullet 1: Account Health
          _pulseItem(
            icon: needsReauth ? Icons.warning_amber_rounded : Icons.check_circle_outline_rounded,
            color: needsReauth ? AppTheme.warning : AppTheme.success,
            title: needsReauth ? 'Account Reauthorization Needed' : 'Account Connections Synced',
            subtitle: needsReauth
                ? 'One or more social tokens need refreshing to maintain automated posting.'
                : '${accounts.length} connected profile(s) actively monitored with zero auth blocks.',
          ),
          const SizedBox(height: 10),

          // Pulse bullet 2: Pipeline Hygiene
          _pulseItem(
            icon: postsFailed > 0
                ? Icons.error_outline_rounded
                : postsAwaitingApproval > 0
                    ? Icons.rate_review_outlined
                    : Icons.shield_outlined,
            color: postsFailed > 0
                ? AppTheme.error
                : postsAwaitingApproval > 0
                    ? AppTheme.warning
                    : AppTheme.accentBlue,
            title: postsFailed > 0
                ? 'Publishing Pipeline Blocked'
                : postsAwaitingApproval > 0
                    ? '$postsAwaitingApproval Post(s) Awaiting Review'
                    : 'Publishing Pipeline Healthy',
            subtitle: postsFailed > 0
                ? '$postsFailed post(s) failed recently. Open channel cockpits to resolve errors.'
                : postsAwaitingApproval > 0
                    ? 'Content in client review must be approved before entering the scheduled delivery queue.'
                    : 'Zero failed dispatches in the active window. Publishing queue running smoothly.',
          ),
          const SizedBox(height: 10),

          // Pulse bullet 3: Community Autopilot & Inbound Leads
          _pulseItem(
            icon: Icons.chat_bubble_outline_rounded,
            color: AppTheme.accent,
            title: 'Community AI Autopilot',
            subtitle: engagementInteractionsInRange > 0 || engagementActiveRules > 0
                ? 'Autopilot crew handled $engagementInteractionsInRange inbound interactions across $engagementActiveRules active response rules.'
                : convertedLeads > 0
                    ? '$convertedLeads qualified lead(s) captured from incoming DMs and comments.'
                    : 'Triage agent active: inbound comments and DMs are sorted into leads, questions, and support.',
          ),
          const SizedBox(height: 10),

          // Pulse bullet 4: Cross-Platform Algorithm Focus
          _pulseItem(
            icon: Icons.lightbulb_outline_rounded,
            color: AppTheme.warning,
            title: 'Algorithm Focus & Hook Recommendation',
            subtitle: _getAlgorithmGuidance(accounts),
          ),
        ],
      ),
    );
  }

  String _getAlgorithmGuidance(List<dynamic> accounts) {
    final hasIg = accounts.any((a) => (a.platform.id ?? '') == 'instagram');
    final hasLi = accounts.any((a) => (a.platform.id ?? '') == 'linkedin');
    final hasYt = accounts.any((a) => (a.platform.id ?? '') == 'youtube');

    if (hasIg && hasLi) {
      return 'Instagram algorithms reward Saves & DM shares; LinkedIn prioritizes deep comment threads. Pair carousel checklists with conversational discussion prompts.';
    }
    if (hasYt) {
      return 'YouTube audience drop-offs happen in the first 3 seconds. Lead with high-velocity visual hooks and clear payoff expectations.';
    }
    return 'Focus on short hooks (<4 seconds) and structured carousel breakdowns to maximize algorithm reach across channels.';
  }

  Widget _pulseItem({
    required IconData icon,
    required Color color,
    required String title,
    required String subtitle,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: TextStyle(fontSize: 11, color: AppTheme.textMuted, height: 1.25),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── Channel Distribution Card ─────────────────────────────────────────────
  Widget _buildChannelDistributionCard({
    required Map<SocialPlatform, int> platforms,
    required int totalPublished,
    required List<dynamic> accounts,
  }) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final p in commandPlatforms.where((cp) => cp.id != 'all')) ...[
            Builder(builder: (context) {
              final sp = SocialPlatform.values.where((s) => s.id == p.id).firstOrNull;
              final count = sp != null ? (platforms[sp] ?? 0) : 0;
              final percent = totalPublished > 0 ? (count / totalPublished) : 0.0;
              final isConnected = accounts.any((a) => (a.platform.id ?? '') == p.id);

              return InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => widget.onSelectPlatform(p.id),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Icon(p.icon, size: 18, color: AppTheme.primary),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  p.label,
                                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                Text(
                                  isConnected ? 'Connected' : 'Not linked',
                                  style: TextStyle(
                                    fontSize: 10,
                                    color: isConnected ? AppTheme.success : AppTheme.textMuted,
                                    fontWeight: isConnected ? FontWeight.w600 : FontWeight.normal,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Text(
                            '$count posts',
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                          ),
                          const SizedBox(width: 6),
                          Icon(Icons.chevron_right_rounded, size: 16, color: AppTheme.textMuted),
                        ],
                      ),
                      const SizedBox(height: 6),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: percent,
                          backgroundColor: AppTheme.surfaceElevated,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            sp?.color ?? AppTheme.primary,
                          ),
                          minHeight: 6,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          ],
        ],
      ),
    );
  }

  Widget _kpiCard(String label, String value, IconData icon, Color color, {String? subtitle}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.5),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: TextStyle(fontSize: 10, color: AppTheme.textMuted),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCreatorMilestoneCard(
    BuildContext context, {
    required List milestones,
    required int topPostViews,
    required String topPostTitle,
  }) {
    // If a post has crossed a milestone, celebrate it!
    final hasAchievedMilestone = milestones.isNotEmpty || topPostViews >= 10000;
    final latestMilestone = milestones.isNotEmpty ? (milestones.first as Map) : null;
    final milestoneLabel = latestMilestone != null
        ? (latestMilestone['label'] as String? ?? '10K Views Club')
        : (topPostViews >= 100000
            ? '100K Views Supernova'
            : (topPostViews >= 50000
                ? '50K Views Viral Wave'
                : (topPostViews >= 20000
                    ? '20K Views Milestone'
                    : '10K Views Milestone')));

    // Next milestone goal calculation
    final nextTarget = topPostViews >= 100000
        ? 250000
        : (topPostViews >= 50000
            ? 100000
            : (topPostViews >= 20000
                ? 50000
                : (topPostViews >= 10000
                    ? 20000
                    : 10000)));

    final targetProgress = (topPostViews / nextTarget).clamp(0.0, 1.0);
    final targetPercent = (targetProgress * 100).toInt();

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: hasAchievedMilestone
              ? [
                  const Color(0xFFE5A93C).withValues(alpha: 0.18),
                  AppTheme.accent.withValues(alpha: 0.08),
                  AppTheme.surface,
                ]
              : [
                  AppTheme.surfaceElevated,
                  AppTheme.surface,
                ],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: hasAchievedMilestone
              ? const Color(0xFFE5A93C).withValues(alpha: 0.4)
              : AppTheme.border,
          width: hasAchievedMilestone ? 1.5 : 1,
        ),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: hasAchievedMilestone
                      ? const Color(0xFFE5A93C).withValues(alpha: 0.2)
                      : AppTheme.accent.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  hasAchievedMilestone ? Icons.workspace_premium_rounded : Icons.trending_up_rounded,
                  color: hasAchievedMilestone ? const Color(0xFFE5A93C) : AppTheme.accent,
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          hasAchievedMilestone ? '🎉 $milestoneLabel!' : '🚀 Creator Viral Goal',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 14,
                            color: hasAchievedMilestone ? const Color(0xFFE5A93C) : AppTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.success.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            hasAchievedMilestone ? 'RISING' : 'TRACKING',
                            style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.success),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      topPostTitle.isNotEmpty
                          ? 'Asset: "$topPostTitle"'
                          : 'Next Milestone: ${nextTarget >= 1000 ? '${nextTarget ~/ 1000}K' : nextTarget} Views Target',
                      style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (topPostViews > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceElevated,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '${topPostViews >= 1000 ? '${(topPostViews / 1000).toStringAsFixed(1)}K' : topPostViews} views',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          // Progress to next milestone
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Next Milestone: ${nextTarget >= 1000 ? '${nextTarget ~/ 1000}K' : nextTarget} Views',
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
              ),
              Text(
                '$targetPercent%',
                style: TextStyle(fontSize: 11, color: AppTheme.textMuted, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: targetProgress,
              minHeight: 6,
              backgroundColor: AppTheme.border,
              color: hasAchievedMilestone ? const Color(0xFFE5A93C) : AppTheme.accent,
            ),
          ),
          const SizedBox(height: 10),
          // AI Algorithmic Momentum Coaching
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppTheme.surface.withValues(alpha: 0.6),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.border.withValues(alpha: 0.6)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.auto_awesome_rounded, size: 16, color: AppTheme.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    hasAchievedMilestone
                        ? 'Algorithm Surge: Your content is testing positively with non-followers. Pin your highest-voted comment & launch a follow-up story today to capture viral profile visits!'
                        : 'Growth Tip: Posts that maintain >40% average watch time in the first 3 seconds are 3.2x more likely to cross 10K views. Polish your hooks in Studio.',
                    style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.35),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              FilledButton.tonalIcon(
                onPressed: () => context.push('/studio'),
                icon: const Icon(Icons.movie_creation_outlined, size: 14),
                label: const Text('Create Follow-Up in Studio', style: TextStyle(fontSize: 11)),
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metricRow(String label, String value, {Color? highlightColor}) {
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 14,
            color: highlightColor,
          ),
        ),
      ],
    );
  }
}
