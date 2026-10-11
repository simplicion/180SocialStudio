import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/manager_chat.dart';

import '../projects/project_provider.dart';

/// Helper to show the 180 Manager AI Copilot from any screen.
void show180ManagerCopilot(BuildContext context, {String? projectId}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => ManagerCopilotSheet(projectId: projectId),
  );
}

class ManagerCopilotSheet extends ConsumerStatefulWidget {
  const ManagerCopilotSheet({super.key, this.projectId});
  final String? projectId;

  @override
  ConsumerState<ManagerCopilotSheet> createState() => _ManagerCopilotSheetState();
}

class _ManagerCopilotSheetState extends ConsumerState<ManagerCopilotSheet> {
  final _inputCtl = TextEditingController();
  final _scrollCtl = ScrollController();
  final List<ManagerChatMessage> _messages = [];
  bool _thinking = false;
  /// Assigned by the server on the first reply; null starts a new conversation.
  String? _conversationId;

  @override
  void initState() {
    super.initState();

    final pId = widget.projectId ?? ref.read(activeProjectProvider).valueOrNull?.id;
    final project = pId != null
        ? ref.read(allProjectsProvider).valueOrNull?.where((p) => p.id == pId).firstOrNull
        : null;
    final projectName = project?.name ?? 'your active project';
    final accounts = project?.socialAccounts ?? [];
    final accountsDesc = accounts.isNotEmpty
        ? 'your **${accounts.length} linked channel(s)** (${accounts.map((a) => a.platform.label).join(', ')})'
        : 'this project (no channels linked yet to $projectName)';

    _messages.add(
      ManagerChatMessage(
        senderType: 'manager',
        content: '👋 **Hello! I am your 180 Manager.**\n\n'
            'I answer from the real data of **$projectName**: $accountsDesc, the content calendar, inbox conversations and your editing preferences.\n\n'
            'Ask me anything or pick a quick command below:',
        suggestedActions: [
          ManagerActionModel(id: 'q1', label: '📊 Project Reach & Stats', type: 'quick_reply', payload: {'text': 'What is our total reach, engagement, and videos uploaded this month for $projectName?'}),
          ManagerActionModel(id: 'q2', label: '💼 Scan DMs for Deals', type: 'quick_reply', payload: {'text': 'Check my DMs and comments for business opportunities or leads in $projectName'}),
          ManagerActionModel(id: 'q3', label: '📅 Pivot Calendar', type: 'quick_reply', payload: {'text': 'Update our content calendar for the upcoming days using our winning format for $projectName'}),
          ManagerActionModel(id: 'q4', label: '🎬 Update Director Pacing', type: 'quick_reply', payload: {'text': 'Tell the AI Video Director to use fast pacing and high contrast captions for $projectName'}),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _inputCtl.dispose();
    _scrollCtl.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtl.hasClients) {
        _scrollCtl.animateTo(
          _scrollCtl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage(String text) async {
    final query = text.trim();
    if (query.isEmpty || _thinking) return;

    _inputCtl.clear();
    setState(() {
      _messages.add(ManagerChatMessage(senderType: 'user', content: query));
      _thinking = true;
    });
    _scrollToBottom();

    final effectiveProjectId = widget.projectId ?? ref.read(activeProjectProvider).valueOrNull?.id;
    try {
      final res = await ref.read(socialApiProvider).chatWithManager(
            message: query,
            projectId: effectiveProjectId,
            conversationId: _conversationId,
          );

      if (mounted) {
        setState(() {
          _thinking = false;
          if (res.conversationId.isNotEmpty) _conversationId = res.conversationId;
          _messages.add(
            ManagerChatMessage(
              senderType: 'manager',
              content: res.reply,
              intent: res.intent,
              delegatedAgents: res.delegatedAgents,
              suggestedActions: res.suggestedActions,
            ),
          );
        });
        _scrollToBottom();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _thinking = false;
          _messages.add(
            ManagerChatMessage(
              senderType: 'manager',
              // The server's own reason (e.g. no AI key configured, timeout); nothing is invented.
              content: '⚠️ ${errorText(e)}',
            ),
          );
        });
        _scrollToBottom();
      }
    }
  }

  Future<void> _handleAction(ManagerActionModel act) async {
    if (act.type == 'quick_reply') {
      final prompt = act.payload['text'] as String? ?? act.label;
      await _sendMessage(prompt);
      return;
    }

    if (act.type == 'open_inbox_conversation' || act.type == 'open_deal_inbox') {
      Navigator.of(context).pop();
      final convId = act.payload['conversationId'] as String?;
      if (convId != null && convId.isNotEmpty) {
        context.push('/inbox?conversationId=$convId');
      } else {
        context.push('/inbox');
      }
      return;
    }

    if (act.type == 'open_calendar') {
      Navigator.of(context).pop();
      final calId = act.payload['calendarId'] as String?;
      if (calId != null && calId.isNotEmpty) {
        context.push('/planner?calendarId=$calId');
      } else {
        context.push('/planner');
      }
      return;
    }

    // Writes need the user's consent first (proposal → confirm → apply).
    final ok = await confirm(
      context,
      title: act.label,
      message: act.type == 'update_calendar'
          ? "Rewrite this month's upcoming calendar pieces (from today, at most 12 per run) around \"${act.payload['format'] ?? ''}\"? Shot, in-review and published pieces are kept."
          : 'Save this editing rule for the AI Director: "${act.payload['rule'] ?? ''}"?',
      action: 'Apply',
    );
    if (!ok || !mounted) return;

    // Execute server action (e.g. calendar pivot, director rule)
    setState(() => _thinking = true);
    final res = await guarded(
      context,
      () => ref.read(socialApiProvider).executeManagerAction({
        'type': act.type,
        // The server already put the verified project in the payload; only fill it when missing.
        'payload': {
          ...act.payload,
          if (act.payload['projectId'] == null) 'projectId': widget.projectId ?? ref.read(activeProjectProvider).valueOrNull?.id,
        },
      }),
    );
    if (!mounted) return;
    setState(() => _thinking = false);

    if (res != null) {
      // Report what the server actually stored (e.g. the director rules), not a generic success line.
      final result = res['result'] is Map ? res['result'] as Map : const {};
      final applied = (result['rulesApplied'] as List?)?.map((e) => '$e').toList() ?? const <String>[];
      final updated = (result['updated'] as List?)?.whereType<Map>().map((u) => '${u['headline']}').toList();
      final failed = (result['failed'] as List?)?.length ?? 0;
      final remaining = (result['remaining'] as num?)?.toInt() ?? 0;
      showInfo(context, 'Done', color: AppTheme.success);
      setState(() {
        _messages.add(
          ManagerChatMessage(
            senderType: 'manager',
            content: updated != null
                ? '✅ Updated ${updated.length} calendar piece(s)${updated.isEmpty ? '' : ':\n• ${updated.join('\n• ')}'}'
                    '${failed > 0 ? '\n⚠️ $failed could not be rewritten (only autopilot pieces can be).' : ''}'
                    '${remaining > 0 ? '\n$remaining more remain: run the action again to continue.' : ''}'
                : applied.isEmpty
                    ? '✅ ${act.label}: done.'
                    : '✅ Saved for the AI Director:\n• ${applied.join('\n• ')}',
          ),
        );
      });
      _scrollToBottom();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.92,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        border: Border.all(color: AppTheme.borderSubtle),
      ),
      child: Column(
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 10, bottom: 6),
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.primary, AppTheme.accent],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.psychology_rounded, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '180 MANAGER AI',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, letterSpacing: 0.5),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Answers from your accounts, calendar, inbox and editing rules',
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                        overflow: TextOverflow.ellipsis,
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

          // Message Stream
          Expanded(
            child: ListView.builder(
              controller: _scrollCtl,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                return _buildMessageBubble(msg);
              },
            ),
          ),

          if (_thinking) ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(
                children: [
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '180 Manager consulting sub-agents (Calendar, Inbox, Telemetry)...',
                    style: TextStyle(fontSize: 11, fontStyle: FontStyle.italic, color: AppTheme.textSecondary),
                  ),
                ],
              ),
            ),
          ],

          // Input Bar
          Container(
            padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 8,
              bottom: MediaQuery.of(context).viewInsets.bottom + 12,
            ),
            decoration: BoxDecoration(
              color: AppTheme.surfaceElevated,
              border: Border(top: BorderSide(color: AppTheme.border)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _inputCtl,
                    onSubmitted: _sendMessage,
                    textInputAction: TextInputAction.send,
                    decoration: InputDecoration(
                      hintText: 'Ask 180 Manager (e.g. "What worked best this month?")...',
                      hintStyle: TextStyle(fontSize: 13, color: AppTheme.textMuted),
                      filled: true,
                      fillColor: AppTheme.surface,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: AppTheme.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: AppTheme.border),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: AppTheme.primary),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  icon: const Icon(Icons.send_rounded, size: 18),
                  style: IconButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () => _sendMessage(_inputCtl.text),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(ManagerChatMessage msg) {
    if (msg.isUser) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Container(
              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: AppTheme.primary,
                borderRadius: BorderRadius.circular(14).copyWith(bottomRight: Radius.zero),
              ),
              child: Text(
                msg.content,
                style: const TextStyle(fontSize: 13, color: Colors.white, height: 1.3),
              ),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 28,
                height: 28,
                margin: const EdgeInsets.only(top: 2),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
                ),
                child: Icon(Icons.psychology_rounded, color: AppTheme.primary, size: 16),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceElevated,
                    borderRadius: BorderRadius.circular(14).copyWith(topLeft: Radius.zero),
                    border: Border.all(color: AppTheme.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        msg.content,
                        style: TextStyle(fontSize: 13, color: AppTheme.textPrimary, height: 1.4),
                      ),

                      // Delegated Agent Badges
                      if (msg.delegatedAgents.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 6,
                          children: [
                            for (final a in msg.delegatedAgents)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppTheme.surface,
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(color: AppTheme.border),
                                ),
                                child: Text(
                                  '⚡ ${a.toUpperCase()} AGENT',
                                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),

          // Suggested Action Buttons
          if (msg.suggestedActions.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.only(left: 36, top: 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  for (final act in msg.suggestedActions)
                    ActionChip(
                      avatar: Icon(
                        act.type == 'open_inbox_conversation'
                            ? Icons.open_in_new_rounded
                            : act.type == 'update_calendar'
                                ? Icons.edit_calendar_rounded
                                : Icons.bolt_rounded,
                        size: 14,
                        color: AppTheme.primary,
                      ),
                      label: Text(
                        act.label,
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.primary),
                      ),
                      backgroundColor: AppTheme.primary.withValues(alpha: 0.1),
                      side: BorderSide(color: AppTheme.primary.withValues(alpha: 0.3)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      onPressed: () => _handleAction(act),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
