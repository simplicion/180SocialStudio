import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import 'studio_controller.dart';

/// Conversational AI Director. It edits the same timeline as the manual tools: every turn sends
/// the current timeline, and applied changes can be undone like any manual edit.
class DirectorPanel extends StatefulWidget {
  const DirectorPanel({super.key, required this.controller});
  final StudioController controller;

  @override
  State<DirectorPanel> createState() => _DirectorPanelState();
}

class _DirectorPanelState extends State<DirectorPanel> {
  final _input = TextEditingController();
  StudioController get c => widget.controller;

  static const _starters = [
    'Remove the pauses and filler words',
    'Add bold word-by-word captions',
    'Make it a punchy vertical reel',
    'Add upbeat background music under my voice',
    'Punch in on the key moments',
  ];

  @override
  void initState() {
    super.initState();
    c.addListener(_changed);
  }

  @override
  void dispose() {
    c.removeListener(_changed);
    _input.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _send([String? text]) {
    final t = (text ?? _input.text).trim();
    if (t.isEmpty || c.directorBusy) return;
    _input.clear();
    c.askDirector(t);
  }

  @override
  Widget build(BuildContext context) {
    final msgs = c.messages;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 8, 8),
            child: Row(children: [
              Icon(Icons.auto_awesome_rounded, color: AppTheme.primary),
              SizedBox(width: 8),
              Expanded(child: Text('AI Director', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 18))),
              IconButton(onPressed: () => Navigator.pop(context), icon: Icon(Icons.close_rounded)),
            ]),
          ),
          if (c.transcriptState != TranscriptState.ready)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      c.transcriptState == TranscriptState.running
                          ? 'Transcribing… Speech-based edits work once the transcript is ready.'
                          : 'No audio transcript. Provide a script for full speech & character consciousness.',
                      style: TextStyle(fontSize: 12, color: AppTheme.warning),
                    ),
                  ),
                  if (c.transcriptState != TranscriptState.running)
                    TextButton.icon(
                      style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                      icon: const Icon(Icons.description_rounded, size: 14),
                      label: const Text('Add Script', style: TextStyle(fontSize: 12)),
                      onPressed: () async {
                        final text = await promptText(
                          context,
                          title: 'Video Script / Speech',
                          label: 'Paste spoken script or dialogue for AI Director',
                          action: 'Apply Script',
                          maxLines: 5,
                        );
                        if (text != null && text.trim().isNotEmpty) {
                          c.attachScript(text.trim());
                        }
                      },
                    ),
                ],
              ),
            ),
          Expanded(
            child: msgs.isEmpty
                ? ListView(padding: EdgeInsets.all(16), children: [
                    Text('Describe the edit you want in plain words. The director uses your transcript, stock footage and music, then updates the timeline. You can undo anything.',
                        style: TextStyle(color: AppTheme.textSecondary)),
                    SizedBox(height: 16),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final s in _starters) ActionChip(label: Text(s), onPressed: () => _send(s)),
                    ]),
                  ])
                : ListView.builder(
                    padding: EdgeInsets.all(12),
                    itemCount: msgs.length + (c.directorBusy ? 1 : 0),
                    itemBuilder: (_, i) {
                      if (i == msgs.length) {
                        return Padding(
                          padding: EdgeInsets.all(12),
                          child: Row(children: [
                            SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                            SizedBox(width: 10),
                            Text('Directing…', style: TextStyle(color: AppTheme.textSecondary)),
                          ]),
                        );
                      }
                      return _MessageTile(message: msgs[i], onApply: () => c.applyProposal(i));
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: EdgeInsets.fromLTRB(12, 8, 8, 8),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: AppTheme.border))),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    decoration: fieldDecoration('Tell the director what to change'),
                  ),
                ),
                IconButton(
                  tooltip: 'Send',
                  onPressed: c.directorBusy ? null : _send,
                  icon: Icon(Icons.send_rounded, color: AppTheme.primary),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

class _MessageTile extends StatelessWidget {
  const _MessageTile({required this.message, required this.onApply});
  final DirectorMessage message;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    final m = message;
    final r = m.response;
    if (m.fromUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: EdgeInsets.symmetric(vertical: 4),
          padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
          decoration: BoxDecoration(color: AppTheme.primary, borderRadius: BorderRadius.circular(14)),
          child: Text(m.text),
        ),
      );
    }
    return Container(
      margin: EdgeInsets.symmetric(vertical: 4),
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppTheme.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(m.text),
        if (r != null && r.appliedOperations.isNotEmpty) ...[
          SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final op in r.appliedOperations) StatusChip(label: op, color: m.applied ? AppTheme.success : AppTheme.accentBlue),
          ]),
        ],
        if (r != null && r.rejectedOperations.isNotEmpty) ...[
          SizedBox(height: 6),
          Text('Could not apply: ${r.rejectedOperations.join(', ')}', style: TextStyle(fontSize: 12, color: AppTheme.warning)),
        ],
        for (final w in r?.warnings ?? const <String>[])
          Padding(padding: EdgeInsets.only(top: 4), child: Text('• $w', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
        if (r != null && r.isDeterministic && r.plannerReason != null)
          Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('Basic mode: ${r.plannerReason}', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
          ),
        if (r != null && !m.applied && r.appliedOperations.isNotEmpty)
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(onPressed: onApply, icon: Icon(Icons.check_rounded, size: 18), label: Text('Apply to timeline')),
          ),
        if (m.applied) Padding(padding: EdgeInsets.only(top: 6), child: Text('Applied · tap any item on the timeline to change it · Undo is in the top bar', style: TextStyle(fontSize: 11, color: AppTheme.success))),
      ]),
    );
  }
}
