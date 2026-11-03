import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/platform.dart';
import '../../data/models/trend_report.dart';
import '../projects/project_provider.dart';

/// Formats each platform accepts (mirrors the server's PLATFORM_RULES).
const trendFormatSupport = <String, Set<String>>{
  'instagram': {'video', 'carousel'},
  'facebook': {'video', 'carousel', 'text'},
  'youtube': {'video'},
  'linkedin': {'video', 'carousel', 'text'},
};

const trendMoods = {
  'energetic': 'Energetic',
  'calm_educational': 'Calm & educational',
  'storytelling': 'Storytelling',
  'funny': 'Funny',
  'authoritative': 'Authoritative',
  'emotional': 'Emotional',
};

void showCreateScriptSheet(BuildContext context, {required String projectId, required String reportId, required TrendCluster cluster}) {
  showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    backgroundColor: AppTheme.surfaceElevated,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
      child: CreateScriptSheet(projectId: projectId, reportId: reportId, cluster: cluster),
    ),
  );
}

class CreateScriptSheet extends ConsumerStatefulWidget {
  const CreateScriptSheet({super.key, required this.projectId, required this.reportId, required this.cluster});
  final String projectId;
  final String reportId;
  final TrendCluster cluster;

  @override
  ConsumerState<CreateScriptSheet> createState() => _CreateScriptSheetState();
}

class _CreateScriptSheetState extends ConsumerState<CreateScriptSheet> {
  late String? _angleId = widget.cluster.angles.firstOrNull?.id;
  late final Set<String> _platforms = _defaultPlatforms();
  late String _format = _formatFromAngle();
  int _duration = 45;
  String? _mood;
  final _notes = TextEditingController();
  bool _busy = false;

  Set<String> _defaultPlatforms() {
    final project = ref.read(activeProjectProvider).valueOrNull;
    final connected = (project?.socialAccounts ?? const []).where((a) => a.isActive).map((a) => a.platform.id).where(trendFormatSupport.containsKey).toSet();
    return connected.isNotEmpty ? connected : {'instagram'};
  }

  String _formatFromAngle() {
    final f = widget.cluster.angles.firstOrNull?.format;
    return f == 'carousel' ? 'carousel' : f == 'text' ? 'text' : 'video';
  }

  /// Platforms that can take the chosen format.
  Iterable<String> get _usable => _platforms.where((p) => trendFormatSupport[p]!.contains(_format));

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _customDuration() async {
    final v = await promptText(context, title: 'Video length (seconds)', label: '15 to 180', initial: '$_duration', action: 'Use');
    final n = int.tryParse((v ?? '').trim());
    if (n != null && n >= 15 && n <= 180) setState(() => _duration = n);
  }

  Future<void> _create() async {
    if (_angleId == null) return;
    final platforms = _usable.toList();
    if (platforms.isEmpty) {
      showError(context, 'None of the selected platforms takes ${_format == 'text' ? 'text posts' : '${_format}s'}. Add Facebook or LinkedIn, or pick another format.');
      return;
    }
    setState(() => _busy = true);
    try {
      final pieceId = await ref.read(socialApiProvider).createTrendScript(
            widget.projectId,
            widget.reportId,
            clusterId: widget.cluster.id,
            angleId: _angleId!,
            platforms: platforms,
            format: _format,
            durationSec: _format == 'video' ? _duration : null,
            mood: _mood,
            notes: _notes.text,
          );
      if (!mounted) return;
      final router = GoRouter.of(context);
      Navigator.of(context).pop();
      router.push('/trend-lab/scripts/$pieceId?projectId=${widget.projectId}');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final label = TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textMuted);
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: AppTheme.border, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 16),
          Text('Create a script', style: Theme.of(context).textTheme.titleLarge),
          Text(widget.cluster.title, style: TextStyle(color: AppTheme.textSecondary)),
          const SizedBox(height: 16),
          Text('Angle', style: label),
          RadioGroup<String>(
            groupValue: _angleId,
            onChanged: (v) => setState(() => _angleId = v),
            child: Column(children: [
              for (final a in widget.cluster.angles)
                RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  value: a.id,
                  title: Text(a.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(a.tension, maxLines: 2, overflow: TextOverflow.ellipsis),
                ),
            ]),
          ),
          const SizedBox(height: 8),
          Text('Where will you post?', style: label),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final p in SocialPlatform.connectable)
              FilterChip(
                avatar: Icon(p.icon, size: 16, color: p.color),
                label: Text(p.label),
                selected: _platforms.contains(p.id),
                onSelected: (on) => setState(() => on ? _platforms.add(p.id) : (_platforms.length > 1 ? _platforms.remove(p.id) : null)),
              ),
          ]),
          const SizedBox(height: 14),
          Text('Format', style: label),
          const SizedBox(height: 6),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'video', label: Text('Video'), icon: Icon(Icons.videocam_rounded)),
              ButtonSegment(value: 'carousel', label: Text('Carousel'), icon: Icon(Icons.view_carousel_rounded)),
              ButtonSegment(value: 'text', label: Text('Text'), icon: Icon(Icons.notes_rounded)),
            ],
            selected: {_format},
            onSelectionChanged: (s) => setState(() => _format = s.first),
          ),
          if (_usable.length < _platforms.length)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'Skipped for this format: ${_platforms.where((p) => !trendFormatSupport[p]!.contains(_format)).map((p) => SocialPlatform.parse(p).label).join(', ')}',
                style: TextStyle(fontSize: 12, color: AppTheme.warning),
              ),
            ),
          if (_format == 'video') ...[
            const SizedBox(height: 14),
            Text('Video length', style: label),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final s in const [15, 30, 45, 60, 90])
                ChoiceChip(label: Text('${s}s'), selected: _duration == s, onSelected: (_) => setState(() => _duration = s)),
              ChoiceChip(
                label: Text(const [15, 30, 45, 60, 90].contains(_duration) ? 'Custom' : 'Custom · ${_duration}s'),
                selected: !const [15, 30, 45, 60, 90].contains(_duration),
                onSelected: (_) => _customDuration(),
              ),
            ]),
          ],
          const SizedBox(height: 14),
          Text('Mood', style: label),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final e in trendMoods.entries)
              ChoiceChip(label: Text(e.value), selected: _mood == e.key, onSelected: (on) => setState(() => _mood = on ? e.key : null)),
          ]),
          const SizedBox(height: 14),
          TextField(
            controller: _notes,
            maxLength: 600,
            minLines: 2,
            maxLines: 4,
            decoration: fieldDecoration('Notes (optional)', hint: 'Anything to include: your offer, a story, a product name'),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _busy || _angleId == null ? null : _create,
            icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_awesome_rounded),
            label: Text(_busy ? 'Starting…' : 'Create script'),
          ),
        ]),
      ),
    );
  }
}
