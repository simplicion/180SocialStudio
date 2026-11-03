import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import 'cc_widgets.dart';

/// Result of `POST /platform-team/:platform/check/reaction`: outlook, craft signals and the simulated panel.
class ReactionResult extends StatelessWidget {
  const ReactionResult({super.key, required this.data});
  final Json data;

  @override
  Widget build(BuildContext context) {
    final outlook = jMap(data['outlook']);
    final craft = jMap(data['craft']);
    final hook = jMap(craft['hook']);
    final panel = jMap(data['panel']);
    final label = jStrOr(outlook['label'], 'around');
    final color = label == 'above' ? AppTheme.success : label == 'below' ? AppTheme.warning : AppTheme.accentBlue;
    final fromHistory = outlook['method'] == 'own_history';
    final actions = jMap(panel['actions']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10), border: Border.all(color: color.withValues(alpha: 0.4))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(
            label == 'above' ? 'Likely above your usual' : label == 'below' ? 'Likely below your usual' : 'Likely around your usual',
            style: TextStyle(fontWeight: FontWeight.w800, color: color),
          ),
          const SizedBox(height: 4),
          Text(jStrOr(outlook['note'], ''), style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          const SizedBox(height: 6),
          StatusChip(
            label: fromHistory ? 'Learned from your posts · ${jStrOr(outlook['confidence'], '')} confidence' : 'Early estimate · low confidence',
            color: fromHistory ? AppTheme.success : AppTheme.textMuted,
          ),
        ]),
      ),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ScoreBadge(score: jInt(craft['score']) ?? 0, label: 'craft'),
        ScoreBadge(score: jInt(hook['score']) ?? 0, label: 'hook'),
        if (jInt(craft['humanScore']) case final h?) ScoreBadge(score: h, label: 'human'),
      ]),
      for (final r in jStrList(hook['recommendations'])) Padding(padding: const EdgeInsets.only(top: 4), child: Text('• $r', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
      for (final f in jStrList(craft['lintFails'])) Padding(padding: const EdgeInsets.only(top: 4), child: Text('• $f', style: TextStyle(fontSize: 12, color: AppTheme.warning))),
      const SizedBox(height: 12),
      if (panel.isEmpty)
        Text(jStrOr(data['panelError'], 'The audience panel did not run.'), style: TextStyle(fontSize: 12, color: AppTheme.textMuted))
      else ...[
        Text('Simulated audience panel', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textMuted)),
        const SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 8, children: [
          StatTile(label: 'would stop', value: '${jDouble(panel['scrollStop']) ?? 0}/5'),
          StatTile(label: 'would finish', value: '${jDouble(panel['readThrough']) ?? 0}/5'),
          StatTile(label: 'would skip', value: '${jInt(actions['skip']) ?? 0}%'),
          StatTile(label: 'would save/share', value: '${(jInt(actions['save']) ?? 0) + (jInt(actions['share']) ?? 0)}%'),
        ]),
        if ((jDouble(panel['disagreement']) ?? 0) >= 1.3)
          Padding(padding: const EdgeInsets.only(top: 6), child: Text('Your audience is split on this one: it will polarise.', style: TextStyle(fontSize: 12, color: AppTheme.accent))),
        const SizedBox(height: 8),
        for (final p in jList(panel['personas'], (m) => m))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${jStrOr(p['persona'], '')} · stop ${jInt(p['scrollStop']) ?? 0}/5 · ${jStrOr(p['action'], '')}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              Text(jStrOr(p['reason'], ''), style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              if (jStrOr(p['comment'], '').isNotEmpty) Text('Would comment: "${jStr(p['comment'])}"', style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic)),
            ]),
          ),
        for (final c in jStrList(panel['confusions'])) Text('Confusing: $c', style: TextStyle(fontSize: 12, color: AppTheme.warning)),
      ],
    ]);
  }
}

/// Result of `POST /platform-team/:platform/profile/audit-connected`: rubric audit + content consistency.
class ConnectedAuditResult extends StatelessWidget {
  const ConnectedAuditResult({super.key, required this.data});
  final Json data;

  @override
  Widget build(BuildContext context) {
    final audit = jMap(data['audit']);
    final content = jMap(data['content']);
    final fields = jMap(data['fields']);
    final mix = jMap(content['formatMix']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('@${jStrOr(fields['handle'], '')}${jInt(data['followers']) != null ? ' · ${jInt(data['followers'])} followers' : ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ScoreBadge(score: jInt(audit['totalScore']) ?? 0, label: 'profile'),
        if (jInt(content['score']) case final s?) ScoreBadge(score: s, label: 'content'),
      ]),
      const SizedBox(height: 10),
      for (final a in jStrList(audit['prioritizedActionPlan']).take(4)) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('• $a', style: const TextStyle(fontSize: 13))),
      const SizedBox(height: 8),
      Text('Last ${jInt(content['postsAnalyzed']) ?? 0} posts', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textMuted)),
      const SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (jDouble(content['postsPerWeek']) case final w?) StatTile(label: 'posts / week', value: '$w'),
        if (jInt(content['cadenceRegularity']) case final r?) StatTile(label: 'steadiness', value: '$r/100'),
        if (jInt(content['avgHookScore']) case final h?) StatTile(label: 'avg hook', value: '$h/100'),
        if (jDouble(content['engagementRatePct']) case final e?) StatTile(label: 'engagement', value: '$e%'),
      ]),
      if (mix.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text('Mix: ${mix.entries.map((e) => '${e.key} ${e.value}%').join(' · ')}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
        ),
      for (final f in jStrList(content['findings'])) Padding(padding: const EdgeInsets.only(top: 6), child: Text('• $f', style: const TextStyle(fontSize: 13))),
    ]);
  }
}
