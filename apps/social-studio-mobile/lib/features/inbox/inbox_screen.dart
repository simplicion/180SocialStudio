import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/engagement_rule.dart';
import '../../data/models/inbox.dart';
import 'ai_inbox_settings_sheet.dart';
import '../../data/models/platform.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../projects/project_provider.dart';

class InboxFilter {
  InboxFilter({this.projectId, this.platform, this.unreadOnly = false, this.search = ''});
  final String? projectId;
  final String? platform;
  final bool unreadOnly;
  final String search;

  @override
  bool operator ==(Object other) =>
      other is InboxFilter && other.projectId == projectId && other.platform == platform && other.unreadOnly == unreadOnly && other.search == search;

  @override
  int get hashCode => Object.hash(projectId, platform, unreadOnly, search);
}

final conversationsProvider = FutureProvider.autoDispose.family<List<Conversation>, InboxFilter>((ref, f) {
  return ref.watch(socialApiProvider).listConversations(
        projectId: f.projectId,
        platform: f.platform,
        isRead: f.unreadOnly ? false : null,
        search: f.search,
      );
});

final conversationProvider = FutureProvider.autoDispose.family<Conversation, String>((ref, id) {
  return ref.watch(socialApiProvider).getConversation(id);
});

/// Inbox tab: comments and DMs for the active project.
class InboxScreen extends ConsumerWidget {
  const InboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: workspaceAppBar(context, ref),
      body: ConversationList(projectId: ref.watch(activeProjectProvider).valueOrNull?.id),
    );
  }
}

/// Filterable conversation list; also used as the project workspace Inbox tab.
class ConversationList extends ConsumerStatefulWidget {
  const ConversationList({super.key, required this.projectId});
  final String? projectId;

  @override
  ConsumerState<ConversationList> createState() => _ConversationListState();
}

class _ConversationListState extends ConsumerState<ConversationList> {
  SocialPlatform? _platform;
  bool _unread = false;
  String _search = '';
  final _searchCtl = TextEditingController();
  bool _syncing = false;

  @override
  void dispose() {
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _handleSync({bool includeSample = false}) async {
    if (_syncing) return;
    setState(() => _syncing = true);
    final f = InboxFilter(projectId: widget.projectId, platform: _platform?.id, unreadOnly: _unread, search: _search);
    try {
      final res = await ref.read(socialApiProvider).syncInbox(
            projectId: widget.projectId,
            platform: _platform?.id,
            includeSample: includeSample,
          );
      ref.invalidate(conversationsProvider(f));
      if (widget.projectId != null) {
        ref.invalidate(projectDashboardProvider(widget.projectId!));
      }
      if (mounted) {
        if (res.synced > 0) {
          showSuccess(context, 'Synced ${res.synced} message${res.synced == 1 ? '' : 's'} from connected accounts');
        } else {
          showInfo(context, 'Inbox is up to date');
        }
      }
    } catch (e) {
      if (mounted) {
        showError(context, e);
      }
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  void _openAiReplyAllModal(BuildContext context, InboxFilter f) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surfaceElevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _AiReplyAllModal(
        projectId: widget.projectId,
        platform: _platform?.id,
        onSuccess: () {
          ref.invalidate(conversationsProvider(f));
          if (widget.projectId != null) {
            ref.invalidate(projectDashboardProvider(widget.projectId!));
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final f = InboxFilter(projectId: widget.projectId, platform: _platform?.id, unreadOnly: _unread, search: _search);
    final list = ref.watch(conversationsProvider(f));
    final unreadCount = ref.watch(unreadInboxCountProvider);
    return Column(children: [
      Padding(
        padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: TextField(
          controller: _searchCtl,
          textInputAction: TextInputAction.search,
          onSubmitted: (v) => setState(() => _search = v.trim()),
          decoration: fieldDecoration('Search people and messages',
              suffix: IconButton(icon: Icon(Icons.search_rounded), onPressed: () => setState(() => _search = _searchCtl.text.trim()))),
        ),
      ),
      SizedBox(
        height: 52,
        child: ListView(scrollDirection: Axis.horizontal, padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8), children: [
          ActionChip(
            avatar: _syncing
                ? SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent))
                : Icon(Icons.sync_rounded, size: 16, color: AppTheme.accent),
            label: Text(_syncing ? 'Syncing...' : 'Sync inbox'),
            tooltip: 'Pull recent DMs and comments from connected accounts',
            onPressed: _syncing ? null : () => _handleSync(),
          ),
          SizedBox(width: 8),
          ActionChip(
            avatar: Icon(Icons.smart_toy_outlined, size: 16, color: AppTheme.accent),
            label: Text('AI auto-reply'),
            tooltip: 'AI auto-reply settings',
            onPressed: () => showAiInboxSettings(context, projectId: widget.projectId),
          ),
          SizedBox(width: 8),
          FilterChip(
            label: Text(unreadCount > 0 ? 'Unread ($unreadCount)' : 'Unread'),
            selected: _unread,
            onSelected: (v) => setState(() => _unread = v),
          ),
          SizedBox(width: 8),
          ChoiceChip(label: Text('All channels'), selected: _platform == null, onSelected: (_) => setState(() => _platform = null)),
          for (final p in SocialPlatform.connectable)
            Padding(
              padding: EdgeInsets.only(left: 8),
              child: ChoiceChip(
                avatar: Icon(p.icon, size: 16, color: p.color),
                label: Text(p.label),
                selected: _platform == p,
                onSelected: (_) => setState(() => _platform = p),
              ),
            ),
        ]),
      ),

      // 1-Click AI Reply All Action Banner
      Padding(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: Container(
          padding: EdgeInsets.all(12),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                AppTheme.primary.withValues(alpha: 0.15),
                AppTheme.accent.withValues(alpha: 0.08),
              ],
            ),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
          ),
          child: Row(
            children: [
              Icon(Icons.auto_awesome, color: AppTheme.accent, size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 6,
                      runSpacing: 2,
                      children: [
                        const Text(
                          'AI Reply All',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                        if (unreadCount > 0)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: AppTheme.error.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: AppTheme.error.withValues(alpha: 0.4)),
                            ),
                            child: Text(
                              '$unreadCount awaiting',
                              style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.error),
                            ),
                          ),
                      ],
                    ),
                    Text(
                      'Reply to open messages in your brand voice',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ),
              FilledButton.tonalIcon(
                onPressed: () => _openAiReplyAllModal(context, f),
                icon: Icon(Icons.bolt_rounded, size: 16),
                label: Text('Reply All'),
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),

      Expanded(
        child: AsyncBody<List<Conversation>>(
          value: list,
          skeleton: SkeletonType.chat,
          onRetry: () => ref.invalidate(conversationsProvider(f)),
          isEmpty: (l) => l.isEmpty,
          empty: EmptyView(
            icon: Icons.forum_rounded,
            title: _unread || _platform != null || _search.isNotEmpty ? 'No matching conversations' : 'Inbox zero',
            message: 'Comments and DMs from linked channels appear here.',
            actionLabel: widget.projectId == null ? null : 'Manage channels',
            onAction: widget.projectId == null ? null : () => context.push('/projects/${widget.projectId}/accounts'),
          ),
          builder: (items) => RefreshIndicator(
            onRefresh: () async {
              await _handleSync();
              ref.invalidate(conversationsProvider(f));
            },
            child: ListView.separated(
              padding: EdgeInsets.fromLTRB(8, 0, 8, 96),
              itemCount: items.length,
              separatorBuilder: (_, _) => Divider(height: 1, color: AppTheme.borderSubtle),
              itemBuilder: (_, i) {
                final c = items[i];
                return ListTile(
                  minVerticalPadding: 12,
                  onTap: () => context.push('/inbox/${c.id}'),
                  leading: CircleAvatar(
                    backgroundColor: c.platform.color.withValues(alpha: 0.2),
                    foregroundImage: c.participantAvatar == null ? null : NetworkImage(c.participantAvatar!),
                    child: Icon(c.platform.icon, color: c.platform.color, size: 18),
                  ),
                  title: Row(
                    children: [
                      Expanded(
                        child: Text(
                          c.participantName,
                          style: TextStyle(fontWeight: c.isRead ? FontWeight.w500 : FontWeight.w800),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (c.aiAnswers)
                        Container(
                          padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.accent.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text('🤖 AI Active', style: TextStyle(fontSize: 10, color: AppTheme.accent, fontWeight: FontWeight.bold)),
                        ),
                      if (c.isHotLead)
                        Padding(
                          padding: EdgeInsets.only(right: 4),
                          child: Container(
                            padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(color: AppTheme.success.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(4)),
                            child: Text(
                              c.leadStage == 'handoff' ? 'Wants to talk' : 'Lead${c.leadScore == null ? '' : ' ${c.leadScore}'}',
                              style: TextStyle(fontSize: 10, color: AppTheme.success, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),
                      if (c.isHumanTakeover)
                        Container(
                          padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.warning.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text('👤 Takeover', style: TextStyle(fontSize: 10, color: AppTheme.warning, fontWeight: FontWeight.bold)),
                        ),
                    ],
                  ),
                  subtitle: Text(c.lastMessageSnippet ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
                  trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(timeAgo(c.lastMessageAt), style: Theme.of(context).textTheme.labelSmall),
                    if (!c.isRead) ...[
                      SizedBox(height: 4),
                      Container(width: 8, height: 8, decoration: BoxDecoration(color: AppTheme.primary, shape: BoxShape.circle)),
                    ],
                    if (c.convertedLeadId != null) Icon(Icons.person_pin_rounded, size: 14, color: AppTheme.success),
                  ]),
                );
              },
            ),
          ),
        ),
      ),
    ]);
  }
}

class _AiReplyAllModal extends ConsumerStatefulWidget {
  const _AiReplyAllModal({this.projectId, this.platform, required this.onSuccess});
  final String? projectId;
  final String? platform;
  final VoidCallback onSuccess;

  @override
  ConsumerState<_AiReplyAllModal> createState() => _AiReplyAllModalState();
}

class _AiReplyAllModalState extends ConsumerState<_AiReplyAllModal> {
  bool _loading = true;
  bool _dispatching = false;
  List<BatchAiReplySuggestion> _suggestions = const [];
  Object? _error;

  @override
  void initState() {
    super.initState();
    _fetchSuggestions();
  }

  Future<void> _fetchSuggestions() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await ref.read(socialApiProvider).getAiReplyAllSuggestions(
            projectId: widget.projectId,
            platform: widget.platform,
          );
      if (mounted) {
        setState(() {
          _suggestions = items;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _dispatch() async {
    final selected = _suggestions.where((s) => s.selected).toList();
    if (selected.isEmpty) {
      showError(context, 'No replies selected');
      return;
    }

    setState(() => _dispatching = true);
    try {
      final payload = selected
          .map((s) => {
                'conversationId': s.conversationId,
                'replyText': s.suggestedReply,
              })
          .toList();

      final res = await ref.read(socialApiProvider).dispatchAiReplyAll(payload);
      if (!mounted) return;
      final results = (res['results'] as List?)?.whereType<Map>().toList() ?? [];
      final notSent = <String, String>{};
      for (final r in results) {
        if (r['status'] == 'sent') continue;
        final retry = r['retryAfterMs'] is num ? ' (retry in ${((r['retryAfterMs'] as num) / 1000).ceil()}s)' : '';
        notSent['${r['conversationId']}'] = r['status'] == 'rate_limited' ? 'Rate limited$retry' : '${r['error'] ?? 'Not sent'}';
      }
      final sent = res['dispatched'] is num ? res['dispatched'] as num : 0;
      widget.onSuccess();
      if (notSent.isEmpty) {
        showInfo(context, 'Sent $sent replies', color: AppTheme.success);
        Navigator.of(context).pop();
      } else {
        // Keep what was not sent on screen with its reason so it can be edited and sent again.
        setState(() {
          _suggestions.removeWhere((s) => s.selected && !notSent.containsKey(s.conversationId));
          for (final s in _suggestions) {
            s.dispatchError = notSent[s.conversationId];
          }
        });
        showError(context, 'Sent $sent, ${notSent.length} not sent. Review them below.');
      }
    } catch (e) {
      if (mounted) showError(context, 'Failed to dispatch: $e');
    } finally {
      if (mounted) setState(() => _dispatching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedCount = _suggestions.where((s) => s.selected).length;

    return Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome, color: AppTheme.accent),
              SizedBox(width: 8),
              Text(
                'AI Reply All',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
              Spacer(),
              if (!_loading && _suggestions.isNotEmpty)
                TextButton(
                  onPressed: () {
                    final allSelected = _suggestions.every((s) => s.selected);
                    setState(() {
                      for (final s in _suggestions) {
                        s.selected = !allSelected;
                      }
                    });
                  },
                  child: Text(_suggestions.every((s) => s.selected) ? 'Deselect All' : 'Select All'),
                ),
            ],
          ),
          SizedBox(height: 8),
          Text(
            'The AI has analyzed unread inquiries using your project\'s Brand Voice DNA. Review and approve before sending.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.textSecondary),
          ),
          Divider(height: 24, color: AppTheme.borderSubtle),

          Expanded(
            child: _loading
                ? UniversalSkeleton(type: SkeletonType.chat)
                : _error != null
                    ? ErrorView(error: _error!, onRetry: _fetchSuggestions)
                    : _suggestions.isEmpty
                        ? EmptyView(
                            icon: Icons.mark_chat_read_rounded,
                            title: 'Nothing waiting for a reply',
                            message: 'Every conversation has been answered.',
                            actionLabel: 'Close',
                            onAction: () => Navigator.pop(context),
                          )
                        : ListView.separated(
                            itemCount: _suggestions.length,
                            separatorBuilder: (_, _) => SizedBox(height: 12),
                            itemBuilder: (_, i) {
                              final item = _suggestions[i];
                              return Container(
                                padding: EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: AppTheme.surface,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: item.selected ? AppTheme.primary.withValues(alpha: 0.4) : AppTheme.borderSubtle,
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Checkbox(
                                          value: item.selected,
                                          activeColor: AppTheme.primary,
                                          onChanged: (v) => setState(() => item.selected = v ?? false),
                                        ),
                                        Text('@${item.participantHandle}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                                        Spacer(),
                                        Container(
                                          padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: AppTheme.primary.withValues(alpha: 0.1),
                                            borderRadius: BorderRadius.circular(4),
                                          ),
                                          child: Text(item.tone, style: TextStyle(fontSize: 10, color: AppTheme.primary)),
                                        ),
                                      ],
                                    ),
                                    Padding(
                                      padding: EdgeInsets.only(left: 48, right: 8, bottom: 8),
                                      child: Text(
                                        'Inquiry: "${item.lastCustomerMessage}"',
                                        style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: AppTheme.textSecondary),
                                      ),
                                    ),
                                    Padding(
                                      padding: EdgeInsets.only(left: 48),
                                      child: TextFormField(
                                        initialValue: item.suggestedReply,
                                        maxLines: 2,
                                        onChanged: (v) => item.suggestedReply = v,
                                        style: TextStyle(fontSize: 12),
                                        decoration: fieldDecoration('Draft AI Reply'),
                                      ),
                                    ),
                                    if ((item.dispatchError ?? item.blockedReason) != null)
                                      Padding(
                                        padding: EdgeInsets.only(left: 48, top: 4),
                                        child: Text(
                                          item.dispatchError ?? 'Cannot send: ${item.blockedReason}',
                                          style: TextStyle(fontSize: 11, color: AppTheme.error),
                                        ),
                                      ),
                                  ],
                                ),
                              );
                            },
                          ),
          ),

          SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              onPressed: (_dispatching || _suggestions.isEmpty || selectedCount == 0) ? null : _dispatch,
              icon: _dispatching
                  ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : Icon(Icons.send_rounded),
              label: Text(_dispatching ? 'Sending...' : 'Approve & send ($selectedCount)'),
              style: FilledButton.styleFrom(backgroundColor: AppTheme.primary),
            ),
          ),
        ],
      ),
    );
  }
}
