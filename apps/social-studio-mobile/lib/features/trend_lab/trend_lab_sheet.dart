import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import 'trend_topic_sheet.dart';

/// Trend Lab entry (home tile): Create from Trends, or Check My Content.
void showTrendLabSheet(BuildContext context, {required String projectId}) {
  showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    backgroundColor: AppTheme.surfaceElevated,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) => TrendLabSheet(projectId: projectId),
  );
}

class TrendLabSheet extends StatelessWidget {
  const TrendLabSheet({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppTheme.border, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 16),
          Row(children: [
            Icon(Icons.local_fire_department_rounded, color: AppTheme.accent),
            const SizedBox(width: 8),
            Text('Trend Lab', style: Theme.of(context).textTheme.titleLarge),
          ]),
          const SizedBox(height: 16),
          _BigCard(
            icon: Icons.travel_explore_rounded,
            color: AppTheme.accent,
            title: 'Create from Trends',
            subtitle: 'Research what your audience engaged with in the last 30 days, see if it is worth posting, then turn it into a script.',
            onTap: () {
              Navigator.of(context).pop();
              showTrendTopicSheet(context, projectId: projectId);
            },
          ),
          const SizedBox(height: 12),
          _BigCard(
            icon: Icons.fact_check_rounded,
            color: AppTheme.accentBlue,
            title: 'Check My Content',
            subtitle: 'Score a hook, see how your audience would react, check a caption or script, and audit your profile.',
            onTap: () {
              final router = GoRouter.of(context);
              Navigator.of(context).pop();
              router.push('/trend-lab/check?projectId=$projectId');
            },
          ),
          const SizedBox(height: 16),
          Text('More ways to create', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textMuted)),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.edit_note_rounded, color: AppTheme.accent),
            title: const Text('Draft a post from an idea'),
            subtitle: const Text('Or repurpose a transcript, article or newsletter'),
            trailing: Icon(Icons.chevron_right_rounded, color: AppTheme.textMuted),
            onTap: () {
              final router = GoRouter.of(context);
              Navigator.of(context).pop();
              router.push('/trend-lab/create-more?projectId=$projectId');
            },
          ),
        ]),
      ),
    );
  }
}

class _BigCard extends StatelessWidget {
  const _BigCard({required this.icon, required this.color, required this.title, required this.subtitle, required this.onTap});
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: color.withValues(alpha: 0.4))),
            child: Row(children: [
              Icon(icon, color: color, size: 32),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  Text(subtitle, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                ]),
              ),
              Icon(Icons.chevron_right_rounded, color: AppTheme.textMuted),
            ]),
          ),
        ),
      );
}
