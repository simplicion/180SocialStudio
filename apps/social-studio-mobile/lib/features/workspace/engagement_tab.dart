import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/social_account.dart';
import '../../data/models/engagement_rule.dart';
import '../../data/models/platform.dart';
import '../../data/models/project.dart';
import '../posts/post_providers.dart';
import 'account_media_picker.dart';
import 'accounts_tab.dart';

final engagementRulesProvider = FutureProvider.autoDispose.family<List<EngagementRule>, String>((ref, projectId) {
  return ref.watch(socialApiProvider).listEngagementRules(projectId: projectId);
});

final engagementStatsProvider = FutureProvider.autoDispose.family<EngagementStats, String>((ref, projectId) {
  return ref.watch(socialApiProvider).getEngagementStats(projectId: projectId);
});

final livePlatformMetricsProvider = FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, projectId) {
  return ref.watch(socialApiProvider).getLivePlatformMetrics(projectId);
});

/// 180 Engagement Automation Tab for Projects
class EngagementTab extends ConsumerWidget {
  const EngagementTab({super.key, required this.project});
  final Project project;

  void _openCreateRuleSheet(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => _EngagementRuleFormSheet(projectId: project.id),
    );
  }

  void _openDryRunSheet(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => _DryRunTesterSheet(projectId: project.id),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rulesAsync = ref.watch(engagementRulesProvider(project.id));
    final statsAsync = ref.watch(engagementStatsProvider(project.id));

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openCreateRuleSheet(context, ref),
        icon: Icon(Icons.bolt_rounded),
        label: Text('New Automation'),
        backgroundColor: AppTheme.primary,
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(engagementRulesProvider(project.id));
          ref.invalidate(engagementStatsProvider(project.id));
        },
        child: ListView(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 100),
          children: [
            // Stats summary card
            statsAsync.when(
              data: (stats) => _buildStatsRow(context, stats),
              loading: () => SizedBox(height: 84, child: UniversalSkeleton(type: SkeletonType.metrics)),
              error: (err, _) => ErrorView(
                error: err,
                compact: true,
                onRetry: () => ref.invalidate(engagementStatsProvider(project.id)),
              ),
            ),
            _buildLiveMetricsCard(context, ref),
            SizedBox(height: 20),

            SectionHeader(
              'Active Funnels & Triggers',
              trailing: TextButton.icon(
                onPressed: () => _openDryRunSheet(context, ref),
                icon: Icon(Icons.science_rounded, size: 16, color: AppTheme.primary),
                label: Text('Test Matcher', style: TextStyle(fontSize: 12, color: AppTheme.primary)),
              ),
            ),
            SizedBox(height: 8),

            rulesAsync.when(
              data: (rules) {
                if (rules.isEmpty) {
                  return EmptyView(
                    icon: Icons.bolt_rounded,
                    title: 'No Automation Rules',
                    message: 'Create a comment-to-DM lead magnet or auto-reply funnel to convert comments into customers.',
                    actionLabel: 'Create Rule',
                    onAction: () => _openCreateRuleSheet(context, ref),
                  );
                }
                return ListView.separated(
                  shrinkWrap: true,
                  physics: NeverScrollableScrollPhysics(),
                  itemCount: rules.length,
                  separatorBuilder: (_, _) => SizedBox(height: 12),
                  itemBuilder: (_, i) => _RuleCard(rule: rules[i], projectId: project.id),
                );
              },
              loading: () => UniversalSkeleton(type: SkeletonType.table),
              error: (err, _) => ErrorView(
                error: err,
                compact: true,
                onRetry: () => ref.invalidate(engagementRulesProvider(project.id)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsRow(BuildContext context, EngagementStats stats) {
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.insights_rounded, color: AppTheme.primary, size: 20),
              SizedBox(width: 8),
              Text('Automation Telemetry', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
            ],
          ),
          SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _metricTile('Triggers', '${stats.totalTriggered}', Icons.touch_app_rounded, AppTheme.primary),
              _metricTile('DMs Sent', '${stats.totalDmsSent}', Icons.send_rounded, AppTheme.primary),
              _metricTile('Likes', '${stats.totalLiked}', Icons.favorite_rounded, AppTheme.primary),
              _metricTile('Leads', '${stats.totalLeadsGenerated}', Icons.person_pin_rounded, AppTheme.success),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metricTile(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, size: 20, color: color),
        SizedBox(height: 4),
        Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
      ],
    );
  }

  Widget _buildLiveMetricsCard(BuildContext context, WidgetRef ref) {
    final metricsAsync = ref.watch(livePlatformMetricsProvider(project.id));
    return metricsAsync.when(
      data: (metrics) {
        if (metrics.isEmpty) return SizedBox.shrink();
        return Padding(
          padding: EdgeInsets.only(top: 14),
          child: Container(
            padding: EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.borderSubtle),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.sensors_rounded, color: AppTheme.success, size: 18),
                    SizedBox(width: 8),
                    Text(
                      'Network metrics',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                SizedBox(height: 10),
                for (final m in metrics) ...[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (m['platform'] as String? ?? 'channel').toUpperCase(),
                        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
                      ),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _metricLine(m),
                          textAlign: TextAlign.end,
                          overflow: TextOverflow.ellipsis,
                          maxLines: 2,
                          style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 4),
                ],
              ],
            ),
          ),
        );
      },
      loading: () => SizedBox.shrink(),
      error: (_, _) => SizedBox.shrink(),
    );
  }
}

class _RuleCard extends ConsumerWidget {
  const _RuleCard({required this.rule, required this.projectId});
  final EngagementRule rule;
  final String projectId;

  String _formatTriggerLabel() {
    if (rule.triggerType == 'comment_any') {
      return 'Any Comment on Post';
    } else if (rule.triggerType == 'dm_inbound') {
      return 'Inbound Direct Message';
    }
    return 'Comment Keyword';
  }

  String _formatGoalLabel() {
    switch (rule.aiAgentGoal) {
      case 'qualify_lead':
        return 'Lead Qualification';
      case 'book_demo':
        return 'Book Demo/Call';
      case 'answer_support':
        return 'Customer Support';
      case 'deliver_resource':
        return 'Deliver Resource';
      default:
        return 'AI Assistant';
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isGlobalAccount = rule.socialAccountId == null;
    final isGlobalPost = rule.postId == null && rule.platformMediaId == null;

    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: rule.isActive ? AppTheme.primary.withValues(alpha: 0.3) : AppTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                rule.actionEnableAiAgent ? Icons.smart_toy_rounded : Icons.bolt_rounded,
                color: rule.isActive ? AppTheme.primary : AppTheme.textSecondary,
                size: 20,
              ),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  rule.name,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Switch.adaptive(
                value: rule.isActive,
                activeTrackColor: AppTheme.primary,
                onChanged: (v) async {
                  await ref.read(socialApiProvider).toggleEngagementRule(rule.id);
                  ref.invalidate(engagementRulesProvider(projectId));
                  ref.invalidate(engagementStatsProvider(projectId));
                },
              ),
            ],
          ),
          SizedBox(height: 8),

          // Scope Badges (Target Account & Target Post)
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              Container(
                padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: isGlobalAccount ? AppTheme.surfaceElevated : AppTheme.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: isGlobalAccount ? AppTheme.border : AppTheme.primary.withValues(alpha: 0.3)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.hub_rounded, size: 11, color: isGlobalAccount ? AppTheme.textSecondary : AppTheme.primary),
                    SizedBox(width: 4),
                    Text(
                      isGlobalAccount ? 'All Connected Accounts' : 'Specific Account',
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: isGlobalAccount ? AppTheme.textSecondary : AppTheme.primary),
                    ),
                  ],
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: isGlobalPost ? AppTheme.surfaceElevated : AppTheme.accent.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: isGlobalPost ? AppTheme.border : AppTheme.accent.withValues(alpha: 0.3)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.video_collection_rounded, size: 11, color: isGlobalPost ? AppTheme.textSecondary : AppTheme.accent),
                    SizedBox(width: 4),
                    Text(
                      isGlobalPost ? 'All Videos & Posts' : 'Linked to Specific Post/Reel',
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: isGlobalPost ? AppTheme.textSecondary : AppTheme.accent),
                    ),
                  ],
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceElevated,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: AppTheme.border),
                ),
                child: Text(
                  _formatTriggerLabel(),
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                ),
              ),
            ],
          ),
          SizedBox(height: 8),

          // Keywords (if keyword trigger)
          if (rule.triggerType == 'comment_keyword' && rule.triggerKeywords.isNotEmpty)
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final kw in rule.triggerKeywords)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '# $kw',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.primary),
                    ),
                  ),
              ],
            ),
          SizedBox(height: 8),

          // Details summary
          Wrap(
            spacing: 0,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (rule.actionAutoLike) ...[
                Icon(Icons.favorite_rounded, size: 14, color: AppTheme.accent),
                SizedBox(width: 4),
                Text('Auto-Like', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                SizedBox(width: 12),
              ],
              if (rule.actionSendDm) ...[
                Icon(Icons.chat_bubble_rounded, size: 14, color: AppTheme.accent),
                SizedBox(width: 4),
                Text('Auto-DM Deliverable', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                SizedBox(width: 12),
              ],
              if (rule.actionEnableAiAgent) ...[
                Icon(Icons.auto_awesome, size: 14, color: AppTheme.warning),
                SizedBox(width: 4),
                Text('AI: ${_formatGoalLabel()}', style: TextStyle(fontSize: 12, color: AppTheme.warning, fontWeight: FontWeight.w600)),
              ],
            ],
          ),

          if (rule.actionDmDeliverableUrl != null && rule.actionDmDeliverableUrl!.isNotEmpty) ...[
            SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.link_rounded, size: 14, color: AppTheme.textSecondary),
                SizedBox(width: 4),
                Expanded(
                  child: Text(
                    'Deliverable: ${rule.actionDmDeliverableUrl!}',
                    style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, decoration: TextDecoration.underline),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],

          Divider(height: 20, color: AppTheme.borderSubtle),

          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${rule.totalTriggered} triggered · ${rule.totalDmsSent} DMs sent',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              IconButton(
                icon: Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.error),
                onPressed: () async {
                  final ok = await confirm(context, title: 'Delete rule?', message: 'This automation rule will be permanently deleted.', action: 'Delete');
                  if (ok) {
                    await ref.read(socialApiProvider).deleteEngagementRule(rule.id);
                    ref.invalidate(engagementRulesProvider(projectId));
                    ref.invalidate(engagementStatsProvider(projectId));
                  }
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EngagementRuleFormSheet extends ConsumerStatefulWidget {
  const _EngagementRuleFormSheet({required this.projectId});
  final String projectId;

  @override
  ConsumerState<_EngagementRuleFormSheet> createState() => _EngagementRuleFormSheetState();
}

class _EngagementRuleFormSheetState extends ConsumerState<_EngagementRuleFormSheet> {
  final _nameCtl = TextEditingController();
  final _keywordsCtl = TextEditingController();
  final _dmTemplateCtl = TextEditingController(
    text: 'Hey {name}! Thanks for your comment. Here is your access link: {link}',
  );
  final _deliverableUrlCtl = TextEditingController();
  final _publicReplyCtl = TextEditingController(text: 'Sent to your DMs! Check your messages');
  final _aiPromptOverrideCtl = TextEditingController();

  String _triggerType = 'comment_keyword'; // 'comment_keyword', 'comment_any', 'dm_inbound'
  String _aiAgentGoal = 'qualify_lead'; // 'qualify_lead', 'book_demo', 'answer_support', 'deliver_resource'
  String? _selectedAccountId; // null = all connected accounts (e.g. all 5 accounts)
  String? _selectedPostId; // null = all posts & reels
  /// An existing platform post picked from the account (published outside the app); excludes [_selectedPostId].
  AccountMediaItem? _selectedMedia;
  bool _autoLike = true;
  final bool _sendDm = true;
  bool _enableAiAgent = true;
  final String _matchMode = 'contains';
  bool _saving = false;
  String? _selectedPreset;

  @override
  void dispose() {
    _nameCtl.dispose();
    _keywordsCtl.dispose();
    _dmTemplateCtl.dispose();
    _deliverableUrlCtl.dispose();
    _publicReplyCtl.dispose();
    _aiPromptOverrideCtl.dispose();
    super.dispose();
  }

  void _applyPreset(String preset) {
    setState(() => _selectedPreset = preset);
    if (preset == 'blueprint') {
      _nameCtl.text = 'Free Blueprint Lead Magnet';
      _triggerType = 'comment_keyword';
      _keywordsCtl.text = 'BLUEPRINT, GUIDE, LINK, SEND';
      _dmTemplateCtl.text = 'Hey {name}! Here is your VIP Blueprint link: {link} Let me know if you have any questions!';
      _deliverableUrlCtl.clear(); // the creator's own link, never a placeholder
      _publicReplyCtl.text = 'Sent to your DMs, {handle}! Check your inbox';
      _aiAgentGoal = 'qualify_lead';
      _aiPromptOverrideCtl.text = 'Ask what business/niche they are running and collect their best email to send follow-up growth assets.';
      setState(() {
        _autoLike = true;
        _enableAiAgent = true;
      });
    } else if (preset == 'any_comment') {
      _nameCtl.text = 'Auto-DM on Any Reel Comment';
      _triggerType = 'comment_any';
      _keywordsCtl.clear();
      _dmTemplateCtl.text = 'Hey {name}! Thanks for checking out our video! Here is the link you requested: {link}';
      _deliverableUrlCtl.clear(); // the creator's own link, never a placeholder
      _publicReplyCtl.text = 'Just sent you a DM with the details!';
      _aiAgentGoal = 'qualify_lead';
      _aiPromptOverrideCtl.text = 'Check if they watched the full breakdown and ask if they would like help implementing it.';
      setState(() {
        _autoLike = true;
        _enableAiAgent = true;
      });
    } else if (preset == 'dm_bot') {
      _nameCtl.text = 'Global Multi-Account DM Assistant';
      _triggerType = 'dm_inbound';
      _keywordsCtl.clear();
      _dmTemplateCtl.text = 'Hi {name}! Thanks for reaching out. Here is our official portal: {link} How can we help you today?';
      _deliverableUrlCtl.clear(); // the creator's own link, never a placeholder
      _publicReplyCtl.clear();
      _aiAgentGoal = 'qualify_lead';
      _aiPromptOverrideCtl.text = 'Qualify the inbound prospect: ask what services they are interested in and capture their email/phone number.';
      setState(() {
        _autoLike = false;
        _enableAiAgent = true;
        _selectedAccountId = null; // Applies across all connected accounts
      });
    } else if (preset == 'support') {
      _nameCtl.text = 'AI Customer Support Bot';
      _triggerType = 'comment_keyword';
      _keywordsCtl.text = 'HELP, SUPPORT, PRICING, COST';
      _dmTemplateCtl.text = 'Hi {name}! I am the 180 AI Assistant. How can I help you today? Check our options here: {link}';
      _deliverableUrlCtl.clear(); // the creator's own link, never a placeholder
      _publicReplyCtl.text = 'Just messaged you with details!';
      _aiAgentGoal = 'answer_support';
      _aiPromptOverrideCtl.text = 'Answer product and pricing questions accurately according to our brand context. If unsure, escalate to human.';
      setState(() {
        _autoLike = true;
        _enableAiAgent = true;
      });
    } else if (preset == 'promo') {
      _nameCtl.text = 'VIP Discount Promo Code';
      _triggerType = 'comment_keyword';
      _keywordsCtl.text = 'DISCOUNT, PROMO, CODE, VIP';
      _dmTemplateCtl.text = 'Hey {name}! Use code VIP20 for 20% off your next purchase: {link}';
      _deliverableUrlCtl.clear(); // the creator's own link, never a placeholder
      _publicReplyCtl.text = 'Code sent to your DM! Enjoy';
      _aiAgentGoal = 'deliver_resource';
      _aiPromptOverrideCtl.clear();
      setState(() {
        _autoLike = true;
        _enableAiAgent = false;
      });
    }
  }

  void _insertToken(String token) {
    final text = _dmTemplateCtl.text;
    final selection = _dmTemplateCtl.selection;
    if (selection.isValid && selection.start >= 0 && selection.end >= 0) {
      final newText = text.replaceRange(selection.start, selection.end, token);
      _dmTemplateCtl.text = newText;
      _dmTemplateCtl.selection = TextSelection.collapsed(offset: selection.start + token.length);
    } else {
      _dmTemplateCtl.text = '$text $token'.trim();
      _dmTemplateCtl.selection = TextSelection.collapsed(offset: _dmTemplateCtl.text.length);
    }
    setState(() {});
  }

  /// Picks one of the account's real, already-published posts (Instagram/Facebook) as the rule target.
  Future<void> _pickExistingPost() async {
    final accounts = ref.read(allAccountsProvider).valueOrNull ?? const <SocialAccount>[];
    final account = accounts.where((a) => a.id == _selectedAccountId).firstOrNull;
    if (account == null) {
      showError(context, 'Choose the Instagram or Facebook account first, then pick one of its posts.');
      return;
    }
    if (account.platform != SocialPlatform.instagram && account.platform != SocialPlatform.facebook) {
      showError(context, 'Picking an existing post works for Instagram and Facebook. For ${account.platform.label}, keep "All videos & posts".');
      return;
    }
    final picked = await showModalBottomSheet<AccountMediaItem>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      builder: (_) => AccountMediaPickerSheet(account: account),
    );
    if (picked != null && mounted) {
      setState(() {
        _selectedMedia = picked;
        _selectedPostId = null;
      });
    }
  }

  Future<void> _submit() async {
    final name = _nameCtl.text.trim();
    if (name.isEmpty) {
      showError(context, 'Rule name is required.');
      return;
    }

    final allAccs = ref.read(allAccountsProvider).valueOrNull ?? [];
    final selectedAcc = allAccs.where((a) => a.id == _selectedAccountId).firstOrNull;
    final isLinkedIn = selectedAcc?.platform == SocialPlatform.linkedin;

    List<String> rawKeywords = [];
    if (_triggerType == 'comment_keyword') {
      rawKeywords = _keywordsCtl.text
          .split(RegExp(r'[,\n]'))
          .map((k) => k.trim())
          .where((k) => k.isNotEmpty)
          .toList();
      if (rawKeywords.isEmpty) {
        showError(context, 'Please specify at least one trigger keyword.');
        return;
      }
    }

    final dmTemplate = _dmTemplateCtl.text.trim();
    if (!isLinkedIn && dmTemplate.isEmpty) {
      showError(context, 'Direct Message Template is required.');
      return;
    }

    if (isLinkedIn && !_autoLike && _publicReplyCtl.text.trim().isEmpty) {
      showError(context, 'Please enable Auto-Like or provide a Public Comment Reply for LinkedIn.');
      return;
    }

    setState(() => _saving = true);
    final data = {
      'name': name,
      'projectId': widget.projectId,
      'socialAccountId': _selectedAccountId,
      'postId': _selectedMedia == null ? _selectedPostId : null,
      'platformMediaId': _selectedMedia?.id,
      'platformMediaPermalink': _selectedMedia?.permalink,
      'platformMediaThumbnail': (_selectedMedia?.thumbnailUrl?.startsWith('https://') ?? false) ? _selectedMedia!.thumbnailUrl : null,
      'triggerType': _triggerType,
      'triggerKeywords': rawKeywords,
      'matchMode': _matchMode,
      'actionAutoLike': _triggerType == 'dm_inbound' ? false : _autoLike,
      'actionPublicReplies': _triggerType == 'dm_inbound' || _publicReplyCtl.text.trim().isEmpty ? [] : [_publicReplyCtl.text.trim()],
      'actionSendDm': isLinkedIn ? false : _sendDm,
      // LinkedIn sends no DM; the brand's words are never invented for it.
      'actionDmTemplate': dmTemplate,
      'actionDmDeliverableUrl': _deliverableUrlCtl.text.trim().isEmpty ? null : _deliverableUrlCtl.text.trim(),
      'actionEnableAiAgent': _enableAiAgent,
      'aiAgentGoal': _aiAgentGoal,
      'aiAgentPromptOverride': _aiPromptOverrideCtl.text.trim().isEmpty ? null : _aiPromptOverrideCtl.text.trim(),
    };

    final rule = await guarded(context, () => ref.read(socialApiProvider).createEngagementRule(data));
    if (!mounted) return;
    setState(() => _saving = false);
    if (rule != null) {
      showInfo(context, 'Automation rule created!', color: AppTheme.success);
      ref.invalidate(engagementRulesProvider(widget.projectId));
      ref.invalidate(engagementStatsProvider(widget.projectId));
      Navigator.of(context).pop();
    }
  }

  Widget _buildPresetButton(String id, String label, IconData icon) {
    final isSelected = _selectedPreset == id;
    return InkWell(
      onTap: () => _applyPreset(id),
      borderRadius: BorderRadius.circular(10),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primary.withValues(alpha: 0.15) : AppTheme.surfaceElevated,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isSelected ? AppTheme.primary : AppTheme.border,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 15,
              color: isSelected ? AppTheme.primary : AppTheme.textSecondary,
            ),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                color: isSelected ? AppTheme.primary : AppTheme.textPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionCard({
    required IconData icon,
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: AppTheme.primary),
              const SizedBox(width: 8),
              Text(
                title.toUpperCase(),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                  color: AppTheme.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          ...children,
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final accountsAsync = ref.watch(allAccountsProvider);
    final postsAsync = ref.watch(projectPostsProvider(PostQuery(projectId: widget.projectId)));

    return Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.9),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 10, bottom: 8),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
                  ),
                  child: Icon(Icons.bolt_rounded, color: AppTheme.primary, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Create Engagement Funnel',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Automate comments, DMs & lead qualification across your accounts',
                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close_rounded, size: 20, color: AppTheme.textSecondary),
                  onPressed: () => Navigator.of(context).pop(),
                  tooltip: 'Close',
                ),
              ],
            ),
          ),
          Divider(height: 1, color: AppTheme.border),

          // Scrollable Form Body
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 16,
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Presets header
                  Text(
                    'QUICK TEMPLATES',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.8,
                      color: AppTheme.textMuted,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _buildPresetButton('blueprint', 'Blueprint Giveaway', Icons.card_giftcard_rounded),
                        const SizedBox(width: 8),
                        _buildPresetButton('any_comment', 'Any Comment Auto-DM', Icons.mark_chat_read_rounded),
                        const SizedBox(width: 8),
                        _buildPresetButton('dm_bot', 'Global 5-Account DM Bot', Icons.hub_rounded),
                        const SizedBox(width: 8),
                        _buildPresetButton('support', 'Support Bot', Icons.smart_toy_rounded),
                        const SizedBox(width: 8),
                        _buildPresetButton('promo', 'VIP Promo Code', Icons.local_offer_rounded),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Section 1: Scope (Accounts & Target Content)
                  _buildSectionCard(
                    icon: Icons.tune_rounded,
                    title: 'Target Channel & Content',
                    children: [
                      TextField(
                        controller: _nameCtl,
                        decoration: fieldDecoration(
                          'Rule Name *',
                          hint: 'e.g. Reel Blueprint Lead Magnet',
                          prefix: Icon(Icons.drive_file_rename_outline_rounded, size: 18, color: AppTheme.textSecondary),
                        ),
                      ),
                      const SizedBox(height: 14),

                      // Social Account Selection (Filtered to Meta: Instagram & Facebook)
                      Row(
                        children: [
                          Text(
                            'Target Social Account(s)',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppTheme.primary.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(color: AppTheme.primary.withValues(alpha: 0.25)),
                            ),
                            child: Text(
                              'Instagram, Facebook & LinkedIn',
                              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppTheme.primary),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      accountsAsync.when(
                        data: (allAccs) {
                          final accounts = allAccs.where((a) =>
                              a.projectId == widget.projectId &&
                              (a.platform == SocialPlatform.instagram ||
                               a.platform == SocialPlatform.facebook ||
                               a.platform == SocialPlatform.linkedin)
                          ).toList();

                          if (accounts.isEmpty) {
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: AppTheme.surfaceElevated,
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: AppTheme.border),
                              ),
                              child: Row(
                                children: [
                                  Icon(Icons.info_outline_rounded, size: 18, color: AppTheme.warning),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      'No Instagram, Facebook, or LinkedIn accounts linked to this project. Connect an account in Channels to enable automation.',
                                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }
                          return DropdownButtonFormField<String?>(
                            initialValue: _selectedAccountId,
                            dropdownColor: AppTheme.surfaceElevated,
                            decoration: fieldDecoration(
                              'Select Target Account',
                              prefix: Icon(Icons.account_circle_outlined, size: 18, color: AppTheme.primary),
                              helper: 'Automate comments & DMs on Instagram/Facebook, or auto-like & public replies on LinkedIn.',
                            ),
                            items: [
                              DropdownMenuItem<String?>(
                                value: null,
                                child: Text('🌐 All Supported Channels (${accounts.length})'),
                              ),
                              for (final acc in accounts)
                                DropdownMenuItem<String?>(
                                  value: acc.id,
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(acc.platform.icon, size: 16, color: acc.platform.color),
                                      const SizedBox(width: 8),
                                      Flexible(
                                        child: Text(
                                          '${acc.platform.label}: @${acc.username != null && acc.username!.isNotEmpty ? acc.username! : acc.accountName}',
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                            ],
                            onChanged: (val) => setState(() {
                              _selectedAccountId = val;
                              _selectedMedia = null; // a picked post belongs to the previous account
                            }),
                          );
                        },
                        loading: () => const LinearProgressIndicator(),
                        error: (_, _) => DropdownButtonFormField<String?>(
                          initialValue: null,
                          items: const [DropdownMenuItem(value: null, child: Text('All Linked Accounts'))],
                          onChanged: (_) {},
                        ),
                      ),
                      const SizedBox(height: 14),

                      // Target Post Selection (All Posts vs Specific Reel / Video)
                      Row(
                        children: [
                          Text(
                            'Target Video / Post',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                          ),
                          const Spacer(),
                          TextButton.icon(
                            onPressed: _pickExistingPost,
                            icon: Icon(Icons.grid_view_rounded, size: 15, color: AppTheme.primary),
                            label: Text('Pick existing post', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.primary)),
                            style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      if (_selectedMedia != null)
                        SelectedMediaCard(item: _selectedMedia!, onClear: () => setState(() => _selectedMedia = null))
                      else
                      postsAsync.when(
                        data: (posts) {
                          return DropdownButtonFormField<String?>(
                            initialValue: _selectedPostId,
                            dropdownColor: AppTheme.surfaceElevated,
                            decoration: fieldDecoration(
                              'Select Target Video/Post',
                              prefix: Icon(Icons.video_collection_outlined, size: 18, color: AppTheme.accent),
                              helper: 'Link to an existing Instagram video/reel or LinkedIn post, or apply to all posts.',
                            ),
                            items: [
                              const DropdownMenuItem<String?>(
                                value: null,
                                child: Text('🎬 All Videos & Posts (Existing & Future)'),
                              ),
                              for (final post in posts)
                                DropdownMenuItem<String?>(
                                  value: post.id,
                                  child: Text(
                                    (post.title != null && post.title!.isNotEmpty)
                                        ? post.title!
                                        : (post.content.length > 25 ? '${post.content.substring(0, 25)}...' : post.content),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                            ],
                            onChanged: (val) => setState(() => _selectedPostId = val),
                          );
                        },
                        loading: () => const LinearProgressIndicator(),
                        error: (_, _) => DropdownButtonFormField<String?>(
                          initialValue: null,
                          items: const [DropdownMenuItem(value: null, child: Text('All Videos & Posts'))],
                          onChanged: (_) {},
                        ),
                      ),
                      Container(
                        margin: const EdgeInsets.only(top: 8),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppTheme.primary.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.lightbulb_outline_rounded, size: 16, color: AppTheme.primary),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Choose "All Videos & Posts" to run on every past and future post of the account, or tap "Pick existing post" to run on one Reel or post you already published.',
                                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.35),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Section 2: Trigger Rules
                  _buildSectionCard(
                    icon: Icons.sensors_rounded,
                    title: 'Trigger Rules',
                    children: [
                      Text(
                        'Trigger Type',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          ChoiceChip(
                            avatar: Icon(Icons.tag_rounded, size: 16),
                            label: Text('Keyword Match'),
                            selected: _triggerType == 'comment_keyword',
                            selectedColor: AppTheme.primary.withValues(alpha: 0.15),
                            onSelected: (v) => setState(() => _triggerType = 'comment_keyword'),
                          ),
                          ChoiceChip(
                            avatar: Icon(Icons.comment_rounded, size: 16),
                            label: Text('Any Comment on Post'),
                            selected: _triggerType == 'comment_any',
                            selectedColor: AppTheme.primary.withValues(alpha: 0.15),
                            onSelected: (v) => setState(() => _triggerType = 'comment_any'),
                          ),
                          ChoiceChip(
                            avatar: Icon(Icons.chat_bubble_rounded, size: 16),
                            label: Text('Inbound DM Auto-Reply'),
                            selected: _triggerType == 'dm_inbound',
                            selectedColor: AppTheme.primary.withValues(alpha: 0.15),
                            onSelected: (v) => setState(() => _triggerType = 'dm_inbound'),
                          ),
                        ],
                      ),
                      if (_triggerType == 'comment_keyword') ...[
                        const SizedBox(height: 14),
                        TextField(
                          controller: _keywordsCtl,
                          decoration: fieldDecoration(
                            'Trigger Keywords (comma separated) *',
                            hint: 'e.g. BLUEPRINT, GUIDE, SCALE, SEND',
                            helper: 'Triggers when a comment contains any of these keywords',
                            prefix: Icon(Icons.tag_rounded, size: 18, color: AppTheme.textSecondary),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Section 3: Automation Actions & Deliverables
                  _buildSectionCard(
                    icon: Icons.flash_on_rounded,
                    title: 'Automation Actions & DM',
                    children: [
                      // LinkedIn Mode Banner
                      if (accountsAsync.valueOrNull?.where((a) => a.id == _selectedAccountId).firstOrNull?.platform == SocialPlatform.linkedin)
                        Container(
                          margin: const EdgeInsets.only(bottom: 14),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFF0A66C2).withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFF0A66C2).withValues(alpha: 0.3)),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.info_outline_rounded, size: 18, color: Color(0xFF0A66C2)),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('LinkedIn Mode: Likes & Public Replies Active', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF0A66C2))),
                                    const SizedBox(height: 2),
                                    Text('LinkedIn official API supports auto-likes and public threaded replies. Direct Messages (DMs) are restricted by LinkedIn. Your deliverable link ({link}) will be delivered directly via the public reply!', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.35)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),

                      // Auto-Like Container (only if comment trigger)
                      if (_triggerType != 'dm_inbound') ...[
                        Container(
                          decoration: BoxDecoration(
                            color: AppTheme.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppTheme.border),
                          ),
                          child: SwitchListTile.adaptive(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                            value: _autoLike,
                            activeTrackColor: AppTheme.primary,
                            title: Text(
                              'Auto-Like Comment',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                            ),
                            subtitle: Text(
                              'Likes the comment immediately to increase algorithmic reach',
                              style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                            ),
                            onChanged: (v) => setState(() => _autoLike = v),
                          ),
                        ),
                        const SizedBox(height: 14),

                        TextField(
                          controller: _publicReplyCtl,
                          decoration: fieldDecoration(
                            'Public Comment Reply',
                            hint: 'e.g. Thanks {name}! Here is your access link: {link}',
                            helper: 'Visible comment reply posted under their comment with deliverable link',
                            prefix: Icon(Icons.chat_bubble_outline_rounded, size: 18, color: AppTheme.textSecondary),
                          ),
                        ),
                        const SizedBox(height: 14),
                      ],

                      // Deliverable Explanation & Input
                      TextField(
                        controller: _deliverableUrlCtl,
                        decoration: fieldDecoration(
                          'Deliverable / Link URL',
                          hint: 'https://yoursite.com/free-blueprint',
                          helper: 'The resource/link delivered in the response (PDF guide, Notion doc, webinar, or booking page)',
                          prefix: Icon(Icons.link_rounded, size: 18, color: AppTheme.textSecondary),
                        ),
                      ),
                      const SizedBox(height: 14),

                      if (accountsAsync.valueOrNull?.where((a) => a.id == _selectedAccountId).firstOrNull?.platform != SocialPlatform.linkedin) ...[
                        TextField(
                          controller: _dmTemplateCtl,
                          maxLines: 3,
                          decoration: fieldDecoration(
                            'Direct Message Template *',
                            hint: 'Hey {name}! Here is your link: {link} Let me know if you have any questions!',
                            prefix: Icon(Icons.mark_chat_unread_outlined, size: 18, color: AppTheme.textSecondary),
                          ),
                        ),
                        const SizedBox(height: 8),

                        // Interactive Token Pills
                        Row(
                          children: [
                            Text('Insert token: ', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
                            const SizedBox(width: 4),
                            Wrap(
                              spacing: 6,
                              children: [
                                for (final token in ['{name}', '{handle}', '{link}'])
                                  InkWell(
                                    onTap: () => _insertToken(token),
                                    borderRadius: BorderRadius.circular(6),
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: AppTheme.surface,
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(color: AppTheme.border),
                                      ),
                                      child: Text(
                                        '+ $token',
                                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.primary),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ] else ...[
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          decoration: BoxDecoration(
                            color: AppTheme.surfaceElevated,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppTheme.border),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.shield_outlined, size: 18, color: AppTheme.primary),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Automated DMs disabled for LinkedIn per API platform policies. Public comment replies and auto-likes are 100% active.',
                                  style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Section 4: Autonomous AI Agent & Lead Qualification
                  _buildSectionCard(
                    icon: Icons.psychology_outlined,
                    title: 'Autonomous AI Lead Qualification',
                    children: [
                      Container(
                        decoration: BoxDecoration(
                          color: AppTheme.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: SwitchListTile.adaptive(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                          value: _enableAiAgent,
                          activeTrackColor: AppTheme.primary,
                          title: Row(
                            children: [
                              Text(
                                'Enable AI Multi-Turn Agent',
                                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                              ),
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                decoration: BoxDecoration(
                                  color: AppTheme.primary.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(
                                  'PRO',
                                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.primary),
                                ),
                              ),
                            ],
                          ),
                          subtitle: Text(
                            'Autonomous AI continues conversation after the DM deliverable to qualify leads & answer queries',
                            style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                          ),
                          onChanged: (v) => setState(() => _enableAiAgent = v),
                        ),
                      ),

                      if (_enableAiAgent) ...[
                        const SizedBox(height: 14),
                        Text(
                          'AI Agent Goal',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                        ),
                        const SizedBox(height: 6),
                        DropdownButtonFormField<String>(
                          initialValue: _aiAgentGoal,
                          dropdownColor: AppTheme.surfaceElevated,
                          decoration: fieldDecoration('Select Goal', prefix: Icon(Icons.flag_rounded, size: 18, color: AppTheme.warning)),
                          items: const [
                            DropdownMenuItem(
                              value: 'qualify_lead',
                              child: Text('🎯 Qualify Lead (Extract Need, Email & Phone into CRM)'),
                            ),
                            DropdownMenuItem(
                              value: 'book_demo',
                              child: Text('📅 Book Demo / Call (Guide to Booking Link)'),
                            ),
                            DropdownMenuItem(
                              value: 'answer_support',
                              child: Text('💬 Answer Support (Product FAQ with Brand Voice)'),
                            ),
                            DropdownMenuItem(
                              value: 'deliver_resource',
                              child: Text('📦 Deliver Resource (Confirm Receipt & Follow Up)'),
                            ),
                          ],
                          onChanged: (v) => setState(() => _aiAgentGoal = v ?? 'qualify_lead'),
                        ),
                        const SizedBox(height: 14),

                        TextField(
                          controller: _aiPromptOverrideCtl,
                          maxLines: 2,
                          decoration: fieldDecoration(
                            'Custom Qualification Guidelines (Optional)',
                            hint: 'e.g. Ask for their monthly ad budget, team size, and email address to qualify them before booking.',
                            prefix: Icon(Icons.tune_rounded, size: 18, color: AppTheme.textSecondary),
                          ),
                        ),
                        const SizedBox(height: 12),

                        // Explanatory Callout
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.primary.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.info_outline_rounded, size: 16, color: AppTheme.primary),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Lead Qualification Workflow: 1) Initial DM delivers the link. 2) If prospect replies, AI answers questions grounded in Brand Voice. 3) When prospect provides an email or phone, 180 Workspace automatically creates a qualified CRM Lead.',
                                  style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.4),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 24),

                  // Submit Action Button
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _submit,
                      icon: _saving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : const Icon(Icons.bolt_rounded, size: 20),
                      label: Text(
                        _saving ? 'Creating Funnel...' : 'Activate Automation Funnel',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                      ),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.primary,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DryRunTesterSheet extends ConsumerStatefulWidget {
  const _DryRunTesterSheet({required this.projectId});
  final String projectId;

  @override
  ConsumerState<_DryRunTesterSheet> createState() => _DryRunTesterSheetState();
}

class _DryRunTesterSheetState extends ConsumerState<_DryRunTesterSheet> {
  final _commentCtl = TextEditingController(text: 'Can you send me the free blueprint please?');
  String _selectedPlatform = 'instagram';
  bool _testing = false;
  Map<String, dynamic>? _testResult;

  @override
  void dispose() {
    _commentCtl.dispose();
    super.dispose();
  }

  Future<void> _runSimulation() async {
    final text = _commentCtl.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _testing = true;
      _testResult = null;
    });

    final res = await guarded(
      context,
      () => ref.read(socialApiProvider).testEngagementMatch(
            platform: _selectedPlatform,
            text: text,
            senderHandle: 'prospect_jane',
          ),
    );

    if (mounted) {
      setState(() {
        _testing = false;
        _testResult = res;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final matched = _testResult != null && _testResult!['matched'] == true;
    final rule = _testResult?['rule'] as Map<String, dynamic>?;

    return Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.9),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 10, bottom: 8),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 8,
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: AppTheme.primary.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
                        ),
                        child: Icon(Icons.science_rounded, color: AppTheme.primary, size: 20),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Test Automation Matcher',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: Icon(Icons.close_rounded, size: 20, color: AppTheme.textSecondary),
                        onPressed: () => Navigator.of(context).pop(),
                        tooltip: 'Close',
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Simulate how incoming comments trigger auto-likes, public replies, and DMs before going live.',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                  const SizedBox(height: 16),

                  // Platform selector
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final p in ['instagram', 'youtube', 'linkedin', 'threads', 'x'])
                        ChoiceChip(
                          label: Text(p[0].toUpperCase() + p.substring(1)),
                          selected: _selectedPlatform == p,
                          selectedColor: AppTheme.primary.withValues(alpha: 0.15),
                          onSelected: (v) => setState(() => _selectedPlatform = p),
                        ),
                    ],
                  ),
                  const SizedBox(height: 14),

                  TextField(
                    controller: _commentCtl,
                    maxLines: 2,
                    decoration: fieldDecoration('Sample Incoming Comment', hint: 'e.g. Can you send me the blueprint?'),
                  ),
                  const SizedBox(height: 16),

                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton.icon(
                      onPressed: _testing ? null : _runSimulation,
                      icon: _testing
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : const Icon(Icons.play_arrow_rounded),
                      label: Text(_testing ? 'Evaluating Rules...' : 'Run Simulation'),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.primary,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  if (_testResult != null) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: matched ? AppTheme.success.withValues(alpha: 0.1) : AppTheme.error.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: matched ? AppTheme.success.withValues(alpha: 0.4) : AppTheme.error.withValues(alpha: 0.4)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(matched ? Icons.check_circle_rounded : Icons.cancel_rounded, color: matched ? AppTheme.success : AppTheme.error, size: 20),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  matched ? 'Rule Matched: ${rule?['name'] ?? 'Active Rule'}' : 'No Rule Matched',
                                  style: TextStyle(fontWeight: FontWeight.bold, color: matched ? AppTheme.success : AppTheme.error),
                                ),
                              ),
                            ],
                          ),
                          if (matched && rule != null) ...[
                            const SizedBox(height: 12),
                            Text('Automated Action Sequence:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                            const SizedBox(height: 6),
                            if (rule['actionAutoLike'] == true)
                              Row(children: [
                                Icon(Icons.favorite, size: 14, color: AppTheme.primary),
                                const SizedBox(width: 6),
                                Text('Auto-like (where the platform allows it)', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                              ]),
                            if (rule['actionPublicReplies'] != null && (rule['actionPublicReplies'] as List).isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Icon(Icons.reply, size: 14, color: AppTheme.primary),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    'Public Reply: "${(rule['actionPublicReplies'] as List).first.toString().replaceAll('{handle}', '@prospect_jane')}"',
                                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                  ),
                                ),
                              ]),
                            ],
                            if (rule['actionSendDm'] == true && rule['actionDmTemplate'] != null) ...[
                              const SizedBox(height: 4),
                              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Icon(Icons.send_rounded, size: 14, color: AppTheme.primary),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    'Private DM: "${rule['actionDmTemplate'].toString().replaceAll('{name}', 'Jane').replaceAll('{handle}', '@prospect_jane').replaceAll('{link}', rule['actionDmDeliverableUrl'] ?? '')}"',
                                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                  ),
                                ),
                              ]),
                            ],
                          ],
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One honest line per account: live numbers with their time, stored values labelled as such, or why they are unavailable.
String _metricLine(Map<String, dynamic> m) {
  String n(Object? v) => v is num ? v.toString() : '–';
  final parts = <String>['${n(m['followersCount'])} followers'];
  if (m['reach'] is num) parts.add('${n(m['reach'])} reach');
  if (m['views'] is num) parts.add('${n(m['views'])} views');
  if (m['engagements'] is num) parts.add('${n(m['engagements'])} engagements');
  final source = m['source'] as String? ?? 'stored';
  final at = DateTime.tryParse(m['fetchedAt'] as String? ?? '')?.toLocal();
  final when = at == null ? '' : ' · ${at.day}/${at.month} ${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
  final unavailable = m['unavailable'] is Map ? (m['unavailable'] as Map)['reason'] as String? : null;
  final label = source == 'live' ? 'live' : unavailable != null && unavailable != 'unsupported' ? 'unavailable: ${unavailable.replaceAll('_', ' ')}' : 'stored';
  return '${parts.join(' · ')} ($label$when)';
}
