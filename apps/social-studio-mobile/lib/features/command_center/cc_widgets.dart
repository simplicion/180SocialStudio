import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';

/// Platforms the Command Center covers, in tab order. `id` is the API path segment.
const commandPlatforms = <({String id, String label, IconData icon, bool carousel})>[
  (id: 'all', label: 'All', icon: Icons.hub_rounded, carousel: false),
  (id: 'instagram', label: 'Instagram', icon: Icons.camera_alt_outlined, carousel: true),
  (id: 'linkedin', label: 'LinkedIn', icon: Icons.work_outline_rounded, carousel: true),
  (id: 'youtube', label: 'YouTube', icon: Icons.smart_display_outlined, carousel: false),
  (id: 'x', label: 'X', icon: Icons.alternate_email_rounded, carousel: false),
  (id: 'facebook', label: 'Facebook', icon: Icons.facebook_rounded, carousel: true),
];

String platformLabel(String id) => id == 'all' ? 'All Channels' : commandPlatforms.where((p) => p.id == id).firstOrNull?.label ?? id;

Color scoreColor(num score) => score >= 70 ? AppTheme.success : score >= 50 ? AppTheme.warning : AppTheme.error;

Color statusColor(String status) => switch (status) { 'PASS' || 'FULL' => AppTheme.success, 'WARN' || 'PARTIAL' => AppTheme.warning, _ => AppTheme.error };

IconData statusIcon(String status) =>
    switch (status) { 'PASS' || 'FULL' => Icons.check_circle_rounded, 'WARN' || 'PARTIAL' => Icons.error_outline_rounded, _ => Icons.cancel_rounded };

void copyText(BuildContext context, String text, String what) {
  Clipboard.setData(ClipboardData(text: text));
  showSuccess(context, '$what copied');
}

/// A titled tool with its inputs and result.
class ToolCard extends StatelessWidget {
  const ToolCard({super.key, required this.title, required this.subtitle, required this.children});
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: SectionCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
            SizedBox(height: 2),
            Text(subtitle, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            SizedBox(height: 12),
            ...children,
          ]),
        ),
      );
}

class ScoreBadge extends StatelessWidget {
  const ScoreBadge({super.key, required this.score, this.label});
  final num score;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final c = scoreColor(score);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8), border: Border.all(color: c.withValues(alpha: 0.4))),
      child: Text('${score.round()}/100${label == null ? '' : ' · $label'}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: c)),
    );
  }
}

/// Renders a server `checks` list: `[{check|name, status, detail|feedback}]`.
class CheckList extends StatelessWidget {
  const CheckList({super.key, required this.checks});
  final List<Json> checks;

  @override
  Widget build(BuildContext context) => Column(children: [
        for (final c in checks)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(statusIcon(jStrOr(c['status'], 'FAIL')), size: 16, color: statusColor(jStrOr(c['status'], 'FAIL'))),
              SizedBox(width: 8),
              Expanded(child: Text(jStrOr(c['detail'] ?? c['feedback'], ''), style: TextStyle(fontSize: 13, color: AppTheme.textSecondary))),
            ]),
          ),
      ]);
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.color});
  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color ?? AppTheme.textPrimary)),
          Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
        ]),
      );
}

/// Runs one tool call and shows skeleton / error (retry + a second way out) / result.
class ToolRunner extends StatefulWidget {
  const ToolRunner({super.key, required this.label, required this.run, required this.result, this.icon = Icons.play_arrow_rounded, this.ai = false});

  final String label;
  final IconData icon;

  /// Returns null when the inputs are not ready (the caller has already told the user why).
  final Future<Json?> Function() run;
  final Widget Function(BuildContext context, Json data) result;

  /// AI tools get a "check AI settings" recovery path next to retry.
  final bool ai;

  @override
  State<ToolRunner> createState() => _ToolRunnerState();
}

class _ToolRunnerState extends State<ToolRunner> {
  Json? _data;
  Object? _error;
  bool _busy = false;

  Future<void> _go() async {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await widget.run();
      if (!mounted) return;
      setState(() => _data = data ?? _data);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: Size.fromHeight(44)),
          onPressed: _busy ? null : _go,
          icon: Icon(widget.icon, size: 18),
          label: Text(_busy ? 'Working…' : widget.label),
        ),
        if (_busy) Padding(padding: EdgeInsets.only(top: 12), child: UniversalSkeleton(type: SkeletonType.detail, itemCount: 2)),
        if (!_busy && _error != null) ...[
          ErrorView(error: _error!, onRetry: _go, compact: true),
          if (widget.ai)
            TextButton(onPressed: () => context.push('/settings'), child: Text('Check AI settings'))
          else
            TextButton(onPressed: () => setState(() => _error = null), child: Text('Dismiss')),
        ],
        if (!_busy && _error == null && _data != null) Padding(padding: EdgeInsets.only(top: 12), child: widget.result(context, _data!)),
      ]);
}
