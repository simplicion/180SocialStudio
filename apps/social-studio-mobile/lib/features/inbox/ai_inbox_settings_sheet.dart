import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/inbox.dart';
import '../../data/models/platform.dart';

final aiInboxSettingsProvider = FutureProvider.autoDispose.family<List<AiInboxAccount>, String?>(
  (ref, projectId) => ref.watch(socialApiProvider).aiInboxSettings(projectId: projectId),
);

const _modes = [
  ('off', 'Off', 'You answer every message yourself.'),
  ('reply', 'Reply', 'The AI answers every DM in your brand voice.'),
  ('qualify', 'Qualify leads', 'The AI answers, asks one qualifying question at a time and hands hot leads to you.'),
];

/// Opens the AI auto-reply settings: one switch per account plus "all Instagram accounts".
Future<void> showAiInboxSettings(BuildContext context, {String? projectId}) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      builder: (_) => AiInboxSettingsSheet(projectId: projectId),
    );

class AiInboxSettingsSheet extends ConsumerStatefulWidget {
  const AiInboxSettingsSheet({super.key, this.projectId});
  final String? projectId;

  @override
  ConsumerState<AiInboxSettingsSheet> createState() => _AiInboxSettingsSheetState();
}

class _AiInboxSettingsSheetState extends ConsumerState<AiInboxSettingsSheet> {
  final _busy = <String>{};

  Future<void> _setMode(AiInboxAccount a, String mode) async {
    setState(() => _busy.add(a.id));
    final ok = await guarded(context, () async {
      await ref.read(socialApiProvider).setAiInboxMode(a.id, mode);
      return true;
    });
    if (!mounted) return;
    setState(() => _busy.remove(a.id));
    if (ok == true) ref.invalidate(aiInboxSettingsProvider(widget.projectId));
  }

  Future<void> _setAll(String mode) async {
    setState(() => _busy.add('*'));
    final n = await guarded(context, () => ref.read(socialApiProvider).setAiInboxModeBulk(mode, platform: 'instagram', projectId: widget.projectId));
    if (!mounted) return;
    setState(() => _busy.remove('*'));
    if (n != null) {
      showInfo(context, mode == 'off' ? 'AI auto-reply turned off on $n Instagram account(s).' : 'AI auto-reply is on for $n Instagram account(s).',
          color: AppTheme.success);
      ref.invalidate(aiInboxSettingsProvider(widget.projectId));
    }
  }

  Future<void> _editInstructions(AiInboxAccount a) async {
    final ctl = TextEditingController(text: a.instructions ?? '');
    final saved = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Instructions for @${a.username ?? a.accountName}'),
        content: TextField(
          controller: ctl,
          minLines: 4,
          maxLines: 8,
          maxLength: 2000,
          decoration: fieldDecoration('What should the AI know?',
              hint: 'Our offer, prices you are happy to share, who is a good fit (e.g. budget above \$1,000, launching within 60 days), booking link.'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    ctl.dispose();
    if (saved == null || !mounted) return;
    final ok = await guarded(context, () async {
      await ref.read(socialApiProvider).setAiInboxMode(a.id, a.mode, instructions: saved);
      return true;
    });
    if (ok == true && mounted) ref.invalidate(aiInboxSettingsProvider(widget.projectId));
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(aiInboxSettingsProvider(widget.projectId));
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.85,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('AI auto-reply', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text('Answers Instagram and Facebook DMs. A conversation you take over is never answered by the AI.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            const SizedBox(height: 12),
            Expanded(
              child: AsyncBody<List<AiInboxAccount>>(
                value: settings,
                skeleton: SkeletonType.form,
                onRetry: () => ref.invalidate(aiInboxSettingsProvider(widget.projectId)),
                isEmpty: (l) => l.isEmpty,
                empty: EmptyView(
                  icon: Icons.link_off_rounded,
                  title: 'No connected accounts',
                  message: 'Connect an Instagram or Facebook account to let the AI answer DMs.',
                  actionLabel: 'Close',
                  onAction: () => Navigator.pop(context),
                ),
                builder: (accounts) {
                  final ig = accounts.where((a) => a.platform == SocialPlatform.instagram && a.dmSupported).toList();
                  return ListView(children: [
                    if (ig.length > 1) ...[
                      SectionCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('All ${ig.length} Instagram accounts', style: const TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 8, children: [
                            for (final m in _modes)
                              OutlinedButton(
                                style: OutlinedButton.styleFrom(minimumSize: const Size(44, 44)),
                                onPressed: _busy.contains('*') ? null : () => _setAll(m.$1),
                                child: Text(m.$2),
                              ),
                          ]),
                        ]),
                      ),
                      const SizedBox(height: 12),
                    ],
                    for (final a in accounts) _AccountRow(
                      account: a,
                      busy: _busy.contains(a.id),
                      onMode: (m) => _setMode(a, m),
                      onInstructions: () => _editInstructions(a),
                    ),
                  ]);
                },
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({required this.account, required this.busy, required this.onMode, required this.onInstructions});
  final AiInboxAccount account;
  final bool busy;
  final ValueChanged<String> onMode;
  final VoidCallback onInstructions;

  @override
  Widget build(BuildContext context) {
    final a = account;
    final desc = _modes.firstWhere((m) => m.$1 == a.mode, orElse: () => _modes.first).$3;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SectionCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Icon(a.platform.icon, color: a.platform.color, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text('@${a.username ?? a.accountName}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600))),
            if (a.dmSupported) IconButton(tooltip: 'AI instructions', onPressed: onInstructions, icon: const Icon(Icons.edit_note_rounded)),
          ]),
          if (!a.dmSupported)
            Text('${a.platform.label} DMs do not reach 180 Workspace, so the AI cannot answer them.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))
          else ...[
            if (a.reauthRequired)
              Text('Reconnect this account first: the AI cannot reply with an expired login.', style: TextStyle(fontSize: 12, color: AppTheme.error)),
            const SizedBox(height: 6),
            SegmentedButton<String>(
              segments: [for (final m in _modes) ButtonSegment(value: m.$1, label: Text(m.$2, maxLines: 1, overflow: TextOverflow.ellipsis))],
              selected: {a.mode},
              showSelectedIcon: false,
              onSelectionChanged: busy ? null : (s) => onMode(s.first),
            ),
            const SizedBox(height: 6),
            Text(desc, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ],
        ]),
      ),
    );
  }
}
