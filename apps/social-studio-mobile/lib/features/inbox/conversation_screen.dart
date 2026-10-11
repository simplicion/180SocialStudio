import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/inbox.dart';
import '../projects/project_provider.dart';
import 'inbox_screen.dart';

/// One conversation: thread, reply box, brand-voice AI suggestions, convert to lead.
class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({super.key, required this.conversationId});
  final String conversationId;

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _reply = TextEditingController();
  bool _sending = false;
  bool _suggesting = false;
  List<ReplySuggestion>? _suggestions;

  /// Replies accepted by the server or queued offline, shown until the thread reloads.
  final List<InboxMessage> _pending = [];

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    final outcome = await guarded(context, () => ref.read(socialApiProvider).sendMessage(widget.conversationId, text));
    if (!mounted) return;
    setState(() => _sending = false);
    if (outcome == null) return;
    _reply.clear();
    if (outcome.queued) {
      setState(() => _pending.add(InboxMessage(id: 'pending.${_pending.length}', senderType: 'agent', content: text)));
      showMutation(context, outcome, '');
    } else {
      setState(() {
        _pending.clear();
        _suggestions = null;
      });
      ref.invalidate(conversationProvider(widget.conversationId));
      ref.invalidate(conversationsProvider);
      final pId = ref.read(activeProjectIdProvider);
      if (pId != null) {
        ref.invalidate(projectDashboardProvider(pId));
      }
    }
  }

  Future<void> _suggest() async {
    setState(() => _suggesting = true);
    final r = await guarded(context, () => ref.read(socialApiProvider).aiSuggestions(widget.conversationId));
    if (!mounted) return;
    setState(() {
      _suggesting = false;
      if (r != null) _suggestions = r.suggestions;
    });
    if (r != null && r.suggestions.isEmpty) showInfo(context, 'No suggestions came back for this conversation.');
  }

  Future<void> _convert(Conversation c) async {
    if (!await confirm(context, title: 'Convert to lead?', message: '${c.participantName} is added to the CRM as a new lead.', action: 'Convert')) {
      return;
    }
    if (!mounted) return;
    final r = await guarded(context, () => ref.read(socialApiProvider).convertToLead(c.id));
    if (r == null || !mounted) return;
    showInfo(context, 'Lead created', color: AppTheme.success);
    ref.invalidate(conversationProvider(widget.conversationId));
  }

  Future<void> _toggleAiAgent(Conversation c) async {
    final next = !c.aiAnswers;
    final res = await guarded(
      context,
      () => ref.read(socialApiProvider).toggleConversationAiAgent(c.id, active: next),
    );
    if (res != null && mounted) {
      showInfo(
        context,
        next ? 'The AI answers this chat' : 'AI off: you handle this chat',
        color: next ? AppTheme.accent : AppTheme.textSecondary,
      );
      ref.invalidate(conversationProvider(widget.conversationId));
      ref.invalidate(conversationsProvider);
    }
  }

  Future<void> _takeoverAiAgent(Conversation c) async {
    final res = await guarded(
      context,
      () => ref.read(socialApiProvider).takeoverConversation(c.id),
    );
    if (res != null && mounted) {
      showInfo(context, '👤 Human Takeover active. AI agent will not respond.', color: AppTheme.warning);
      ref.invalidate(conversationProvider(widget.conversationId));
      ref.invalidate(conversationsProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final conv = ref.watch(conversationProvider(widget.conversationId));
    final c = conv.valueOrNull;
    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          if (c != null) ...[Icon(c.platform.icon, color: c.platform.color, size: 18), SizedBox(width: 8)],
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c?.participantName ?? 'Conversation', overflow: TextOverflow.ellipsis),
              if (c?.participantHandle != null) Text('@${c!.participantHandle}', style: Theme.of(context).textTheme.labelSmall),
            ]),
          ),
        ]),
        actions: [
          if (c != null) ...[
            if (c.aiAnswers)
              IconButton(
                tooltip: 'AI Agent is Active. Tap to take over.',
                icon: Icon(Icons.smart_toy_rounded, color: AppTheme.accent),
                onPressed: () => _takeoverAiAgent(c),
              )
            else if (c.isHumanTakeover)
              IconButton(
                tooltip: 'Human Takeover active. Tap to re-enable AI.',
                icon: Icon(Icons.person_pin_rounded, color: AppTheme.warning),
                onPressed: () => _toggleAiAgent(c),
              )
            else
              IconButton(
                tooltip: 'Enable AI Agent for this thread',
                icon: Icon(Icons.smart_toy_outlined),
                onPressed: () => _toggleAiAgent(c),
              ),
            if (c.convertedLeadId == null)
              IconButton(tooltip: 'Convert to lead', icon: Icon(Icons.person_add_alt_1_rounded), onPressed: () => _convert(c)),
          ],
        ],
      ),
      body: Column(children: [
        Expanded(
          child: AsyncBody<Conversation>(
            value: conv,
            skeleton: SkeletonType.chat,
            onRetry: () => ref.invalidate(conversationProvider(widget.conversationId)),
            builder: (c) {
              final msgs = [...c.messages, ..._pending];
              if (msgs.isEmpty) return EmptyView(icon: Icons.chat_bubble_outline_rounded, title: 'No messages yet');
              return ListView.builder(
                reverse: true,
                padding: EdgeInsets.all(12),
                itemCount: msgs.length,
                itemBuilder: (_, i) => _Bubble(message: msgs[msgs.length - 1 - i], pending: msgs[msgs.length - 1 - i].id.startsWith('pending.')),
              );
            },
          ),
        ),
        if (_suggestions != null && _suggestions!.isNotEmpty)
          SizedBox(
            height: 64,
            child: ListView(scrollDirection: Axis.horizontal, padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8), children: [
              for (final s in _suggestions!)
                Padding(
                  padding: EdgeInsets.only(right: 8),
                  child: ActionChip(
                    label: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: 260),
                      child: Text(s.text, maxLines: 2, overflow: TextOverflow.ellipsis),
                    ),
                    onPressed: () => setState(() => _reply.text = s.text),
                  ),
                ),
            ]),
          ),
        SafeArea(
          top: false,
          child: Container(
            padding: EdgeInsets.fromLTRB(8, 8, 8, 8),
            decoration: BoxDecoration(color: AppTheme.surface, border: Border(top: BorderSide(color: AppTheme.border))),
            child: Row(children: [
              IconButton(
                tooltip: 'Suggest replies in brand voice',
                onPressed: _suggesting ? null : _suggest,
                icon: _suggesting
                    ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(Icons.auto_awesome_rounded, color: AppTheme.primary),
              ),
              Expanded(
                child: TextField(
                  controller: _reply,
                  minLines: 1,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: fieldDecoration('Reply'),
                ),
              ),
              IconButton(
                tooltip: 'Send',
                onPressed: _sending ? null : _send,
                icon: Icon(Icons.send_rounded, color: AppTheme.primary),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, this.pending = false});
  final InboxMessage message;
  final bool pending;

  @override
  Widget build(BuildContext context) {
    final out = message.isOutbound;
    return Align(
      alignment: out ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: EdgeInsets.symmetric(vertical: 4),
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: out ? AppTheme.primary.withValues(alpha: pending ? 0.35 : 0.85) : AppTheme.surfaceElevated,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(crossAxisAlignment: out ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
          Text(message.content),
          SizedBox(height: 2),
          Text(
            pending ? 'Waiting to send' : [if (message.senderType == 'ai_bot') 'AI', timeAgo(message.createdAt)].where((s) => s.isNotEmpty).join(' · '),
            style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
          ),
        ]),
      ),
    );
  }
}
