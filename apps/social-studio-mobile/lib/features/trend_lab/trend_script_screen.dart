import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/autopilot.dart';
import '../../data/models/content_calendar.dart';
import '../../data/models/trend_report.dart';
import '../../data/models/vault_item.dart';
import '../command_center/cc_widgets.dart';
import '../library/vault_provider.dart';
import '../planner/calendar_detail_screen.dart' show TrendEvidenceCard;
import '../studio/teleprompter_setup_sheet.dart';
import 'trend_lab_providers.dart';

/// A Trend Lab script: generating -> ready, with Save to Library, Shoot with teleprompter and the full shooting plan.
class TrendScriptScreen extends ConsumerStatefulWidget {
  const TrendScriptScreen({super.key, required this.projectId, required this.pieceId, this.pollInterval});
  final String projectId;
  final String pieceId;
  final Duration? pollInterval;

  @override
  ConsumerState<TrendScriptScreen> createState() => _TrendScriptScreenState();
}

class _TrendScriptScreenState extends ConsumerState<TrendScriptScreen> with JobPoller<TrendScriptScreen, TrendScriptJob> {
  bool _saving = false;

  @override
  Duration? get interval => widget.pollInterval;

  @override
  Future<TrendScriptJob> fetchJob() => ref.read(socialApiProvider).getTrendScript(widget.projectId, widget.pieceId);

  @override
  bool isFinished(TrendScriptJob job) => job.status != 'generating';

  @override
  void initState() {
    super.initState();
    startPolling();
  }

  String _scriptText(CalendarPiece p, PieceBrief? b) => b?.hasScript == true ? b!.teleprompterText : (b?.carouselSlides.isNotEmpty == true
      ? b!.carouselSlides.map((s) => [s.headline, if (s.body != null) s.body!].join('\n')).join('\n\n')
      : p.adCopyFull);

  /// Saves the script as a named Library folder with a script note, so it can be reopened and shot later.
  Future<void> _save(CalendarPiece p, PieceBrief? b) async {
    final name = await promptText(context, title: 'Save to Library', label: 'Name', initial: p.headline, action: 'Save');
    if (name == null || name.trim().isEmpty) return;
    setState(() => _saving = true);
    try {
      final folder = await ref.read(vaultFoldersProvider.notifier).createFolder(name: name.trim());
      await ref.read(vaultItemsProvider.notifier).addItem(
            folderId: folder.id,
            name: b?.spokenHook ?? p.headline,
            type: VaultItemType.note,
            noteContent: _scriptText(p, b),
            noteCategory: VaultNoteCategory.script,
            tags: const ['trend-lab'],
            pieceId: p.id,
          );
      if (mounted) showSuccess(context, 'Saved to Library as "${name.trim()}"');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final j = job;
    return Scaffold(
      appBar: AppBar(title: const Text('Your script')),
      body: j == null
          ? (pollError != null ? ErrorView(error: pollError!, onRetry: startPolling) : const LoadingView())
          : j.status == 'failed'
              ? ErrorView(error: j.errorMessage ?? 'The script could not be written.', onRetry: () => Navigator.of(context).maybePop())
              : j.status == 'generating' || j.piece == null
                  ? ListView(padding: const EdgeInsets.all(24), children: [
                      const LinearProgressIndicator(),
                      const SizedBox(height: 16),
                      Text('Writing your script', style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 6),
                      Text('Writer, Hook Lab, copywriter, platform craft and quality-review agents are working on it. About a minute.',
                          style: TextStyle(color: AppTheme.textSecondary)),
                    ])
                  : _Ready(piece: j.piece!, saving: _saving, onSave: _save, projectId: widget.projectId),
    );
  }
}

class _Ready extends StatelessWidget {
  const _Ready({required this.piece, required this.saving, required this.onSave, required this.projectId});
  final CalendarPiece piece;
  final bool saving;
  final Future<void> Function(CalendarPiece, PieceBrief?) onSave;
  final String projectId;

  @override
  Widget build(BuildContext context) {
    final b = PieceBrief.parse(piece.videoScriptOrHooks);
    final isVideo = b?.hasScript == true;
    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
      Text(piece.headline, style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 8),
      Wrap(spacing: 6, runSpacing: 6, children: [
        StatusChip(label: piece.contentType, color: AppTheme.accent),
        if (piece.mood != null) StatusChip(label: piece.mood!.replaceAll('_', ' '), color: AppTheme.accentBlue, icon: Icons.mood_rounded),
        if (b?.durationSec != null) StatusChip(label: '${b!.durationSec}s', color: AppTheme.textSecondary, icon: Icons.timer_rounded),
        if (piece.criticSkipped) StatusChip(label: 'Not reviewed', color: AppTheme.warning, icon: Icons.rule_rounded),
      ]),
      const SizedBox(height: 12),
      if (b?.spokenHook != null)
        SectionCard(
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('HOOK', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppTheme.textMuted)),
                const SizedBox(height: 4),
                Text(b!.spokenHook!, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                if (b.onScreenHook != null) Text('On screen: ${b.onScreenHook}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              ]),
            ),
            if (b.hookScore != null) ScoreBadge(score: b.hookScore!, label: 'hook'),
          ]),
        ),
      if (isVideo) ...[
        SectionHeader('Script'),
        for (var i = 0; i < b!.body.length; i++) Padding(padding: const EdgeInsets.only(bottom: 6), child: Text('${i + 1}. ${b.body[i].beat}')),
        if (b.retentionLoop != null) Text('Loop: ${b.retentionLoop}', style: TextStyle(color: AppTheme.textSecondary)),
        if (b.cta != null) Text('CTA: ${b.cta}', style: const TextStyle(fontWeight: FontWeight.w600)),
      ] else if (b?.carouselSlides.isNotEmpty == true) ...[
        SectionHeader('Slides'),
        for (var i = 0; i < b!.carouselSlides.length; i++)
          Padding(padding: const EdgeInsets.only(bottom: 6), child: Text('${i + 1}. ${b.carouselSlides[i].headline}${b.carouselSlides[i].body != null ? ' — ${b.carouselSlides[i].body}' : ''}')),
      ],
      if (piece.adCopyFull.isNotEmpty) ...[
        SectionHeader('Caption'),
        Text(piece.adCopyFull),
      ],
      if (piece.trend != null) ...[const SizedBox(height: 12), TrendEvidenceCard(trend: piece.trend!)],
      const SizedBox(height: 20),
      if (isVideo)
        FilledButton.icon(
          icon: const Icon(Icons.videocam_rounded),
          label: const Text('Shoot with teleprompter'),
          onPressed: () => showTeleprompterSetupSheet(context, projectId: projectId, prefillScript: b!.teleprompterText, prefillHook: b.spokenHook, pieceId: piece.id),
        ),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        icon: saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.bookmark_add_rounded),
        label: const Text('Save to Library'),
        onPressed: saving ? null : () => onSave(piece, b),
      ),
      const SizedBox(height: 8),
      TextButton.icon(
        icon: const Icon(Icons.menu_book_rounded),
        label: Text(isVideo ? 'Full script & shooting plan' : 'Open in planner'),
        onPressed: () => context.push('/planner/script?calendarId=${piece.calendarId}&pieceId=${piece.id}', extra: {'piece': piece}),
      ),
    ]);
  }
}
