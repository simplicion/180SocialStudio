import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/platform.dart';
import '../command_center/check_tab.dart';
import '../projects/project_provider.dart';

/// One entry per check tool (ids match [checkToolIds]).
class CheckToolInfo {
  const CheckToolInfo(this.id, this.title, this.subtitle, this.icon);
  final String id, title, subtitle;
  final IconData icon;
}

const contentCheckTools = [
  CheckToolInfo('hook', 'Score your hook', 'Specifics, stakes, front-loading; compare several', Icons.bolt_rounded),
  CheckToolInfo('reaction', 'How will people react?', 'A simulated audience panel, calibrated on your results', Icons.groups_rounded),
  CheckToolInfo('caption', 'Caption check', 'Fold, length, hashtags and the ask, per platform', Icons.short_text_rounded),
  CheckToolInfo('script', 'Script evaluation', 'Timing per beat, slow hook, missing loop', Icons.timer_rounded),
  CheckToolInfo('voice', 'Humanize text', 'Strip AI phrases and score how human it reads', Icons.record_voice_over_rounded),
  CheckToolInfo('profile', 'Profile audit', 'Instagram, Facebook, LinkedIn or YouTube', Icons.account_circle_rounded),
  CheckToolInfo('result', 'Post result check', 'Read a post\'s numbers against your usual', Icons.insights_rounded),
];

/// "Check My Content": the list of tools.
class ContentCheckScreen extends StatelessWidget {
  const ContentCheckScreen({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Check My Content')),
        body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 32), children: [
          for (final t in contentCheckTools)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SectionCard(
                padding: const EdgeInsets.all(14),
                onTap: () => context.push('/trend-lab/check/${t.id}?projectId=$projectId'),
                child: Row(children: [
                  Icon(t.icon, color: AppTheme.accentBlue),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(t.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(t.subtitle, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                    ]),
                  ),
                  Icon(Icons.chevron_right_rounded, color: AppTheme.textMuted),
                ]),
              ),
            ),
        ]),
      );
}

/// One check tool with a platform switcher (rules differ per platform).
class CheckToolScreen extends ConsumerStatefulWidget {
  const CheckToolScreen({super.key, required this.projectId, required this.tool});
  final String projectId;
  final String tool;

  @override
  ConsumerState<CheckToolScreen> createState() => _CheckToolScreenState();
}

class _CheckToolScreenState extends ConsumerState<CheckToolScreen> {
  late String _platform = _default();

  String _default() {
    final accounts = ref.read(activeProjectProvider).valueOrNull?.socialAccounts ?? const [];
    final connected = accounts.where((a) => a.isActive && SocialPlatform.connectable.contains(a.platform)).map((a) => a.platform.id);
    return connected.firstOrNull ?? 'instagram';
  }

  @override
  Widget build(BuildContext context) {
    final info = contentCheckTools.where((t) => t.id == widget.tool).firstOrNull;
    if (info == null) {
      return Scaffold(appBar: AppBar(), body: const EmptyView(icon: Icons.help_outline_rounded, title: 'Unknown tool', message: 'This check does not exist.'));
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(info.title),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: SizedBox(
            height: 52,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), children: [
              for (final p in SocialPlatform.connectable)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    avatar: Icon(p.icon, size: 16, color: p.color),
                    label: Text(p.label),
                    selected: _platform == p.id,
                    onSelected: (_) => setState(() => _platform = p.id),
                  ),
                ),
            ]),
          ),
        ),
      ),
      body: CheckTab(key: ValueKey('${widget.tool}-$_platform'), platform: _platform, tools: {widget.tool}, projectId: widget.projectId),
    );
  }
}
