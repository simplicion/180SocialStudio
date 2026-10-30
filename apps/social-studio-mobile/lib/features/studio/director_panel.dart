import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import 'studio_controller.dart';

/// Conversational AI Director: a chat with a friendly editor. It looks at the clip, recommends a direction,
/// confirms a short plan, then edits the same timeline as the manual tools (every change can be undone).
class DirectorPanel extends StatefulWidget {
  const DirectorPanel({super.key, required this.controller});
  final StudioController controller;

  @override
  State<DirectorPanel> createState() => _DirectorPanelState();
}

class _DirectorPanelState extends State<DirectorPanel> {
  final _input = TextEditingController();
  final _focus = FocusNode();
  final _scroll = ScrollController();
  final Set<int> _expanded = {};
  String _hint = 'Message your editor';
  int _seenMessages = 0;
  bool _seenBusy = false;

  StudioController get c => widget.controller;

  static const _starters = ['Edit this video', 'Cut the pauses', 'Add captions', 'Make it a punchy reel'];

  @override
  void initState() {
    super.initState();
    c.addListener(_changed);
    _seenMessages = c.messages.length;
    _seenBusy = c.directorBusy;
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToEnd(animate: false));
  }

  @override
  void dispose() {
    c.removeListener(_changed);
    _input.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    final grew = c.messages.length != _seenMessages || c.directorBusy != _seenBusy;
    _seenMessages = c.messages.length;
    _seenBusy = c.directorBusy;
    setState(() {});
    if (grew) WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToEnd());
  }

  void _scrollToEnd({bool animate = true}) {
    if (!mounted || !_scroll.hasClients) return;
    final end = _scroll.position.maxScrollExtent;
    if (animate) {
      _scroll.animateTo(end, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    } else {
      _scroll.jumpTo(end);
    }
  }

  void _send([String? text]) {
    final t = (text ?? _input.text).trim();
    if (t.isEmpty || c.directorBusy) return;
    _input.clear();
    setState(() => _hint = 'Message your editor');
    c.askDirector(t);
  }

  /// "Do it" on a plan card: a proposal that already carries the edited timeline is applied here;
  /// a plan the director only described is confirmed in the chat, and the director then makes it.
  void _accept(int index) {
    final r = c.messages[index].response;
    if (r != null && r.appliedOperations.isNotEmpty && !c.messages[index].applied) {
      c.applyProposal(index);
    } else {
      _send('Yes, do it');
    }
  }

  void _changeSomething() {
    setState(() => _hint = 'What should I change?');
    _focus.requestFocus();
  }

  void _retry() => c.retryLastDirectorTurn();

  int get _lastDirectorIndex {
    for (var i = c.messages.length - 1; i >= 0; i--) {
      if (!c.messages[i].fromUser) return i;
    }
    return -1;
  }

  @override
  Widget build(BuildContext context) {
    final msgs = c.messages;
    final lastDirector = _lastDirectorIndex;
    final waitingForDirector = msgs.isNotEmpty && msgs.last.fromUser;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          _Header(busy: c.directorBusy, onClose: () => Navigator.pop(context)),
          if (c.transcriptState != TranscriptState.ready) _transcriptNote(context),
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              children: [
                if (msgs.isEmpty) ...[
                  const _DirectorBubble(
                    child: Text("Hey! I'm your editor. Tell me what you're going for, or just say \"edit this video\" and I'll take a look first."),
                  ),
                  if (!c.directorBusy) _Chips(labels: _starters, onTap: _send),
                ],
                for (var i = 0; i < msgs.length; i++)
                  ..._messageWidgets(context, i, isLatest: i == lastDirector && !waitingForDirector),
                if (c.directorBusy) const _TypingIndicator(),
              ],
            ),
          ),
          _composer(),
        ]),
      ),
    );
  }

  List<Widget> _messageWidgets(BuildContext context, int i, {required bool isLatest}) {
    final m = c.messages[i];
    if (m.fromUser) return [_UserBubble(text: m.text)];

    final r = m.response;
    final failed = m.failed || (r == null && _isFailure(m.text));
    final text = r != null ? (r.message.isNotEmpty ? r.message : m.text) : (failed ? _friendlyFailure(m.text) : m.text);
    final hasPlan = r != null && r.isProposal && !m.applied;
    final hasEdits = r != null && r.appliedOperations.isNotEmpty;
    final needsApply = hasEdits && !m.applied && !hasPlan;
    final details = <String>[
      ...?r?.appliedOperations,
      for (final x in r?.rejectedOperations ?? const <String>[]) "Couldn't do: $x",
      ...?r?.warnings,
    ];
    final showChips = isLatest && !c.directorBusy && !hasPlan;
    final chips = failed ? const ['Try again'] : (r?.quickReplies ?? const <String>[]);

    return [
      _DirectorBubble(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(text),
          if (hasPlan) ...[
            const SizedBox(height: 10),
            _PlanCard(
              steps: r.proposedPlan,
              enabled: isLatest && !c.directorBusy,
              onAccept: () => _accept(i),
              onChange: _changeSomething,
            ),
          ],
          if (needsApply) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                onPressed: () => c.applyProposal(i),
                icon: const Icon(Icons.check_rounded, size: 18),
                label: const Text('Apply to timeline'),
              ),
            ),
          ],
          if (hasEdits && m.applied)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.check_circle_rounded, size: 14, color: AppTheme.success),
                const SizedBox(width: 4),
                Flexible(
                  child: Text('On your timeline · Undo is in the top bar', style: TextStyle(fontSize: 11, color: AppTheme.success)),
                ),
              ]),
            ),
          if (details.isNotEmpty) _Details(
            label: hasEdits ? '${r.appliedOperations.length} change${r.appliedOperations.length == 1 ? '' : 's'}' : 'Details',
            lines: details,
            expanded: _expanded.contains(i),
            onToggle: () => setState(() => _expanded.contains(i) ? _expanded.remove(i) : _expanded.add(i)),
          ),
        ]),
      ),
      if (showChips && chips.isNotEmpty)
        _Chips(labels: chips, onTap: (s) => s == 'Try again' && failed ? _retry() : _send(s)),
    ];
  }

  Widget _transcriptNote(BuildContext context) {
    final running = c.transcriptState == TranscriptState.running;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 8, 4),
      child: Row(children: [
        Icon(running ? Icons.hearing_rounded : Icons.info_outline_rounded, size: 14, color: AppTheme.textMuted),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            running ? 'Listening to your video… captions and speech edits unlock in a moment.' : "I couldn't hear any speech. Got a script? Add it for captions.",
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
        ),
        if (!running)
          TextButton(
            style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
            onPressed: () async {
              final text = await promptText(
                context,
                title: 'Your script',
                label: 'Paste what is said in the video',
                action: 'Use script',
                maxLines: 5,
              );
              if (text != null && text.trim().isNotEmpty) c.attachScript(text.trim());
            },
            child: const Text('Add script', style: TextStyle(fontSize: 12)),
          ),
      ]),
    );
  }

  Widget _composer() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        decoration: BoxDecoration(border: Border(top: BorderSide(color: AppTheme.border))),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _input,
              focusNode: _focus,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              textCapitalization: TextCapitalization.sentences,
              onSubmitted: (_) => _send(),
              decoration: fieldDecoration(_hint),
            ),
          ),
          IconButton(
            tooltip: 'Send',
            onPressed: c.directorBusy ? null : _send,
            icon: Icon(Icons.send_rounded, color: c.directorBusy ? AppTheme.textMuted : AppTheme.primary),
          ),
        ]),
      ),
    );
  }

  /// Turn failures the controller reports as raw text (`I could not do that: <exception>`).
  static bool _isFailure(String text) => text.startsWith('I could not do that:');

  static String _friendlyFailure(String raw) {
    final t = raw.toLowerCase();
    if (t.contains('socket') || t.contains('network') || t.contains('connection') || t.contains('timed out') || t.contains('timeout')) {
      return 'I lost the connection for a second. Want me to try that again?';
    }
    if (t.contains('credit') || t.contains('quota') || t.contains('limit')) {
      return "I've hit my usage limit for now, so I can't edit this one. Try again a bit later?";
    }
    return 'Hmm, something went wrong on my side. Want me to try that again?';
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.busy, required this.onClose});
  final bool busy;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 8),
      child: Row(children: [
        const _Avatar(size: 32),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('AI Director', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 17)),
            Text(busy ? 'typing…' : 'Your video editor', style: TextStyle(fontSize: 12, color: busy ? AppTheme.primary : AppTheme.textMuted)),
          ]),
        ),
        IconButton(onPressed: onClose, icon: const Icon(Icons.close_rounded)),
      ]),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({this.size = 26});
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.15), shape: BoxShape.circle),
      child: Icon(Icons.auto_awesome_rounded, size: size * 0.55, color: AppTheme.primary),
    );
  }
}

class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(top: 6, bottom: 6, left: 48),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: const BoxDecoration(
          color: Color(0xFF0066FF),
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(18),
            topRight: Radius.circular(18),
            bottomLeft: Radius.circular(18),
            bottomRight: Radius.circular(4),
          ),
        ),
        child: Text(text, style: const TextStyle(color: Colors.white)),
      ),
    );
  }
}

class _DirectorBubble extends StatelessWidget {
  const _DirectorBubble({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        const _Avatar(),
        const SizedBox(width: 8),
        Flexible(
          child: Container(
            margin: const EdgeInsets.only(right: 36),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: AppTheme.surfaceElevated,
              border: Border.all(color: AppTheme.border),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(18),
                topRight: Radius.circular(18),
                bottomLeft: Radius.circular(4),
                bottomRight: Radius.circular(18),
              ),
            ),
            child: DefaultTextStyle.merge(style: TextStyle(color: AppTheme.textPrimary, height: 1.35), child: child),
          ),
        ),
      ]),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.steps, required this.enabled, required this.onAccept, required this.onChange});
  final List<String> steps;
  final bool enabled;
  final VoidCallback onAccept;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var i = 0; i < steps.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 20,
                height: 20,
                alignment: Alignment.center,
                margin: const EdgeInsets.only(right: 8, top: 1),
                decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.12), shape: BoxShape.circle),
                child: Text('${i + 1}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.primary)),
              ),
              Expanded(child: Text(steps[i])),
            ]),
          ),
        if (enabled) ...[
          const SizedBox(height: 8),
          Row(children: [
            FilledButton.icon(
              onPressed: onAccept,
              icon: const Icon(Icons.check_rounded, size: 18),
              label: const Text('Do it'),
            ),
            const SizedBox(width: 8),
            TextButton(onPressed: onChange, child: const Text('Change something')),
          ]),
        ],
      ]),
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.label, required this.lines, required this.expanded, required this.onToggle});
  final String label;
  final List<String> lines;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      InkWell(
        onTap: onToggle,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.only(top: 6, bottom: 2),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
            Icon(expanded ? Icons.expand_less_rounded : Icons.expand_more_rounded, size: 16, color: AppTheme.textMuted),
          ]),
        ),
      ),
      if (expanded)
        for (final l in lines.take(30))
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text('• $l', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          ),
    ]);
  }
}

class _Chips extends StatelessWidget {
  const _Chips({required this.labels, required this.onTap});
  final List<String> labels;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 34, top: 2, bottom: 6),
      child: Wrap(spacing: 8, runSpacing: 6, children: [
        for (final s in labels)
          ActionChip(
            label: Text(s),
            visualDensity: VisualDensity.compact,
            side: BorderSide(color: AppTheme.primary.withValues(alpha: 0.4)),
            onPressed: () => onTap(s),
          ),
      ]),
    );
  }
}

/// Three bouncing dots in a director bubble while a turn runs.
class _TypingIndicator extends StatefulWidget {
  const _TypingIndicator();

  @override
  State<_TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<_TypingIndicator> with SingleTickerProviderStateMixin {
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat();

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _DirectorBubble(
      child: SizedBox(
        height: 16,
        child: AnimatedBuilder(
          animation: _anim,
          builder: (_, _) => Row(mainAxisSize: MainAxisSize.min, children: [
            for (var i = 0; i < 3; i++)
              Transform.translate(
                offset: Offset(0, -3 * _bounce((_anim.value - i * 0.18) % 1.0)),
                child: Container(
                  width: 7,
                  height: 7,
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: BoxDecoration(color: AppTheme.textMuted, shape: BoxShape.circle),
                ),
              ),
          ]),
        ),
      ),
    );
  }

  static double _bounce(double t) => t < 0.3 ? (t / 0.3) : (t < 0.6 ? 1 - (t - 0.3) / 0.3 : 0);
}
