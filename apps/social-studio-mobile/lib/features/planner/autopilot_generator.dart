import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/util/json.dart';
import '../../core/util/poll_backoff.dart';
import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/autopilot.dart';
import '../../data/models/project.dart';
import 'planner_providers.dart';

/// Autopilot calendar: the server's research → strategy → hooks & scripts → captions → critic agents,
/// grounded in the project's brand consciousness. Starts a job and follows it until the calendar is saved.
class AutopilotGenerator extends ConsumerStatefulWidget {
  const AutopilotGenerator({super.key, required this.project, required this.onUseClassic, this.pollInterval});
  final Project project;
  final VoidCallback onUseClassic;

  /// Test hook; defaults to 2 s.
  final Duration? pollInterval;

  @override
  ConsumerState<AutopilotGenerator> createState() => _AutopilotGeneratorState();
}

class _AutopilotGeneratorState extends ConsumerState<AutopilotGenerator> {
  static const _platformIds = BrandConsciousness.platforms;

  late final _name = TextEditingController(text: '${widget.project.name} Content Sprint');
  final _structureDirectives = TextEditingController();
  final _referenceInspirations = TextEditingController();
  final _goals = TextEditingController();

  int _days = 30;
  DateTime _start = DateTime.now().add(Duration(days: 1));
  late final Set<String> _platforms = {
    for (final a in widget.project.socialAccounts)
      for (final id in _platformIds.keys)
        if (a.platform.id.toLowerCase().startsWith(id.substring(0, 4)) ||
            (id == 'twitter' && a.platform.id.toLowerCase() == 'x'))
          id,
  };

  String _mixPreset = 'daily_1_reel';
  int _customReels = 1;
  int _customCarousels = 2;
  int _targetReelDurationSec = 60;
  int _carouselSlideCount = 5;

  bool _starting = false;
  String? _jobId;
  AutopilotJob? _job;
  Object? _pollError;
  Timer? _timer;
  int _polls = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final active = ref.read(activeAutopilotJobProvider(widget.project.id));
      if (active != null && active.isNotEmpty && _jobId == null) {
        _follow(active);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _name.dispose();
    _structureDirectives.dispose();
    _referenceInspirations.dispose();
    _goals.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _mixPayload => <String, dynamic>{
    'mode': _mixPreset == 'custom' ? 'custom' : 'preset',
    'preset': _mixPreset,
    'dailyReels': _mixPreset == 'custom'
        ? _customReels
        : (_mixPreset == 'daily_2_carousels_1_reel'
            ? 1
            : (_mixPreset == 'daily_1_carousel' ? 0 : 1)),
    'dailyCarousels': _mixPreset == 'custom'
        ? _customCarousels
        : (_mixPreset == 'daily_2_carousels_1_reel'
            ? 2
            : (_mixPreset == 'daily_1_carousel' || _mixPreset == 'daily_1_reel_1_carousel' ? 1 : 0)),
    'targetReelDurationSec': _targetReelDurationSec,
    'carouselSlideCount': _carouselSlideCount,
  };

  /// Shows how many AI calls this plan makes and its output-token ceiling, before anything is generated.
  Future<void> _showEstimate() async {
    if (_platforms.isEmpty) return showError(context, 'Choose at least one platform.');
    final r = await guarded(context, () => ref.read(socialApiProvider).estimateAutopilot(widget.project.id, days: _days, platforms: _platforms.toList(), contentMix: _mixPayload));
    if (r == null || !mounted) return;
    final budget = jMap(r['budget']);
    const names = {
      'research': 'Research', 'strategist': 'Strategy', 'hook_script': 'Hooks and scripts', 'hook_lab': 'Hook Lab',
      'copy': 'Captions', 'craft': 'Platform Craft', 'critic': 'Quality review',
    };
    final usd = jDouble(r['outputCeilingUsd']);
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('AI usage for this plan'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${jInt(budget['pieces']) ?? 0} pieces across ${jInt(budget['platforms']) ?? 0} platform(s), up to ${jInt(budget['calls']) ?? 0} AI calls.', style: TextStyle(fontWeight: FontWeight.w600)),
            SizedBox(height: 12),
            for (final a in jList(budget['agents'], (m) => m))
              Padding(
                padding: EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  Expanded(child: Text('${names[jStr(a['agent'])] ?? jStrOr(a['agent'], '')}${jBool(a['conditional']) ? ' (only if needed)' : ''}', style: TextStyle(fontSize: 13))),
                  Text('${jBool(a['conditional']) ? 'up to ' : ''}${jInt(a['calls']) ?? 0}', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                ]),
              ),
            SizedBox(height: 8),
            Text('Output ceiling: ${jInt(budget['maxOutputTokens']) ?? 0} tokens${usd == null ? '' : ' (up to \$${usd.toStringAsFixed(2)} of output)'}. Real usage is usually lower; the finished calendar records what was used.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text('Close'))],
      ),
    );
  }

  Future<void> _start_() async {
    if (_platforms.isEmpty) return showError(context, 'Choose at least one platform.');
    setState(() => _starting = true);
    try {
      final mixPayload = _mixPayload;

      final r = await ref.read(socialApiProvider).startAutopilot(
            widget.project.id,
            days: _days,
            startDate: _start,
            platforms: _platforms.toList(),
            goals: splitGoals(_goals.text),
            name: _name.text.trim().isNotEmpty ? _name.text.trim() : null,
            structureDirectives: _structureDirectives.text.trim().isNotEmpty ? _structureDirectives.text.trim() : null,
            referenceInspirations: _referenceInspirations.text.trim().isNotEmpty ? _referenceInspirations.text.trim() : null,
            contentMix: mixPayload,
            targetReelDurationSec: _targetReelDurationSec,
            carouselSlideCount: _carouselSlideCount,
          );
      if (!mounted) return;
      _follow(r.jobId);
    } on ApiException catch (e) {
      if (!mounted) return;
      final running = e.kind == ApiErrorKind.conflict ? _runningJobId(e) : null;
      if (running != null) {
        showInfo(context, 'A calendar is already being written for this project. Showing its progress.');
        _follow(running);
      } else {
        showError(context, e);
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  static String? _runningJobId(ApiException e) {
    final body = e.data;
    if (body is! Map) return null;
    final details = body['details'];
    final id = details is Map ? details['jobId'] : null;
    return id is String && id.isNotEmpty ? id : null;
  }

  static List<String> splitGoals(String text) =>
      text.split(RegExp(r'[\n,]')).map((g) => g.trim()).where((g) => g.isNotEmpty).take(5).toList();

  void _follow(String jobId) {
    ref.read(activeAutopilotJobProvider(widget.project.id).notifier).setActiveJob(jobId);
    setState(() {
      _jobId = jobId;
      _job = null;
      _pollError = null;
    });
    _poll();
  }

  Future<void> _poll() async {
    _timer?.cancel();
    final id = _jobId;
    if (id == null) return;
    try {
      final job = await ref.read(socialApiProvider).getAutopilotJob(widget.project.id, id);
      if (!mounted) return;
      setState(() {
        _job = job;
        _pollError = null;
      });
      if (job.isDone) {
        ref.read(activeAutopilotJobProvider(widget.project.id).notifier).clearActiveJob();
        ref.invalidate(calendarsProvider);
        showInfo(context, 'Calendar ready: ${job.totalPieces ?? 0} pieces');
        context.pushReplacement('/planner/${job.calendarId}');
        return;
      }
      if (job.isFailed) {
        ref.read(activeAutopilotJobProvider(widget.project.id).notifier).clearActiveJob();
        return;
      }
    } catch (e) {
      if (!mounted) return;
      // Network blips while following a job are not fatal: show the error and keep trying.
      setState(() => _pollError = e);
      if (e is ApiException && !e.isTransient) return;
    }
    _timer = Timer(pollDelay(_polls++, override: widget.pollInterval), _poll);
  }

  @override
  Widget build(BuildContext context) {
    if (_jobId != null) return _progress(context);
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
      SectionCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.auto_awesome_rounded, color: AppTheme.accent, size: 20),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Master SOP Creative Studio',
                style: Theme.of(context).textTheme.titleMedium,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ]),
          SizedBox(height: 6),
          Text(
            'Autonomous 4-agent swarm researches psychological tension, builds strategic reels and carousels, and crafts shoot-ready briefs grounded in brand consciousness.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ]),
      ),
      SectionHeader('Campaign Name'),
      TextField(
        controller: _name,
        decoration: fieldDecoration('Campaign Name', hint: 'e.g. October 2026 AI Growth Campaign'),
      ),
      SectionHeader('Length & Start Date'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ChoiceChip(
          label: Text('7 days'),
          selected: _days == 7,
          onSelected: (_) => setState(() => _days = 7),
        ),
        ChoiceChip(
          label: Text('14 days'),
          selected: _days == 14,
          onSelected: (_) => setState(() => _days = 14),
        ),
        ChoiceChip(
          label: Text('30 days'),
          selected: _days == 30,
          onSelected: (_) => setState(() => _days = 30),
        ),
      ]),
      SizedBox(height: 12),
      OutlinedButton.icon(
        icon: Icon(Icons.event_rounded),
        label: Text('Starts ${fmtDate(_start)}'),
        onPressed: () async {
          final d = await showDatePicker(
            context: context,
            initialDate: _start,
            firstDate: DateTime.now().subtract(Duration(days: 1)),
            lastDate: DateTime.now().add(Duration(days: 365)),
          );
          if (d != null) setState(() => _start = d);
        },
      ),
      SectionHeader('Content Cadence & Mix'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ChoiceChip(
          label: Text('Daily 1 Reel'),
          selected: _mixPreset == 'daily_1_reel',
          onSelected: (_) => setState(() {
            _mixPreset = 'daily_1_reel';
            _customReels = 1;
            _customCarousels = 0;
          }),
        ),
        ChoiceChip(
          label: Text('Daily 1 Carousel'),
          selected: _mixPreset == 'daily_1_carousel',
          onSelected: (_) => setState(() {
            _mixPreset = 'daily_1_carousel';
            _customReels = 0;
            _customCarousels = 1;
          }),
        ),
        ChoiceChip(
          label: Text('Daily 1 Reel + 1 Carousel'),
          selected: _mixPreset == 'daily_1_reel_1_carousel',
          onSelected: (_) => setState(() {
            _mixPreset = 'daily_1_reel_1_carousel';
            _customReels = 1;
            _customCarousels = 1;
          }),
        ),
        ChoiceChip(
          label: Text('Daily 2 Carousels + 1 Reel'),
          selected: _mixPreset == 'daily_2_carousels_1_reel',
          onSelected: (_) => setState(() {
            _mixPreset = 'daily_2_carousels_1_reel';
            _customReels = 1;
            _customCarousels = 2;
          }),
        ),
        ChoiceChip(
          label: Text('Alternate Days (Reel / Carousel)'),
          selected: _mixPreset == 'alternate',
          onSelected: (_) => setState(() {
            _mixPreset = 'alternate';
            _customReels = 1;
            _customCarousels = 1;
          }),
        ),
        ChoiceChip(
          label: Text('Custom Mix'),
          selected: _mixPreset == 'custom',
          onSelected: (_) => setState(() => _mixPreset = 'custom'),
        ),
      ]),
      SizedBox(height: 12),
      SectionCard(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text('Daily Cadence Stepper',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: AppTheme.textSecondary)),
              ),
              if (_mixPreset != 'custom')
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppTheme.accent.withValues(alpha: 0.3)),
                  ),
                  child: Text('Preset Active (Prioritized)',
                      style: TextStyle(fontSize: 10, color: AppTheme.accent, fontWeight: FontWeight.w700)),
                )
              else
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppTheme.success.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppTheme.success.withValues(alpha: 0.3)),
                  ),
                  child: Text('Custom Mode Active',
                      style: TextStyle(fontSize: 10, color: AppTheme.success, fontWeight: FontWeight.w700)),
                ),
            ],
          ),
          SizedBox(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Expanded(child: Text('Reels per day:', style: TextStyle(fontWeight: FontWeight.w600))),
            Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(
                icon: Icon(Icons.remove_circle_outline),
                onPressed: _customReels > 0
                    ? () => setState(() {
                          _customReels--;
                          _mixPreset = 'custom';
                        })
                    : null,
              ),
              SizedBox(
                width: 24,
                child: Text('$_customReels', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              ),
              IconButton(
                icon: Icon(Icons.add_circle_outline),
                onPressed: _customReels < 5
                    ? () => setState(() {
                          _customReels++;
                          _mixPreset = 'custom';
                        })
                    : null,
              ),
            ]),
          ]),
          Divider(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Expanded(child: Text('Carousels per day:', style: TextStyle(fontWeight: FontWeight.w600))),
            Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(
                icon: Icon(Icons.remove_circle_outline),
                onPressed: _customCarousels > 0
                    ? () => setState(() {
                          _customCarousels--;
                          _mixPreset = 'custom';
                        })
                    : null,
              ),
              SizedBox(
                width: 24,
                child: Text('$_customCarousels', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              ),
              IconButton(
                icon: Icon(Icons.add_circle_outline),
                onPressed: _customCarousels < 5
                    ? () => setState(() {
                          _customCarousels++;
                          _mixPreset = 'custom';
                        })
                    : null,
              ),
            ]),
          ]),
        ]),
      ),
      SizedBox(height: 14),
      Text('Target Reel Duration', style: Theme.of(context).textTheme.labelMedium),
      SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ChoiceChip(
          label: Text('30s (Fast Hook)'),
          selected: _targetReelDurationSec == 30,
          onSelected: (_) => setState(() => _targetReelDurationSec = 30),
        ),
        ChoiceChip(
          label: Text('60s (Standard)'),
          selected: _targetReelDurationSec == 60,
          onSelected: (_) => setState(() => _targetReelDurationSec = 60),
        ),
        ChoiceChip(
          label: Text('90s (In-depth)'),
          selected: _targetReelDurationSec == 90,
          onSelected: (_) => setState(() => _targetReelDurationSec = 90),
        ),
      ]),
      SizedBox(height: 14),
      Text('Target Carousel Slides', style: Theme.of(context).textTheme.labelMedium),
      SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ChoiceChip(
          label: Text('5 slides (Standard SOP)'),
          selected: _carouselSlideCount == 5,
          onSelected: (_) => setState(() => _carouselSlideCount = 5),
        ),
        ChoiceChip(
          label: Text('7 slides (Deep Dive)'),
          selected: _carouselSlideCount == 7,
          onSelected: (_) => setState(() => _carouselSlideCount = 7),
        ),
      ]),
      SectionHeader('Structure & Weekly Themes (Optional)'),
      TextField(
        controller: _structureDirectives,
        minLines: 2,
        maxLines: 4,
        decoration: fieldDecoration('Structure Directives',
            hint: 'e.g. Week 1: Problem awareness, Week 2: Mythbusting, Week 3: Actionable frameworks, Week 4: Case studies & CTA',
            helper: 'Guide the narrative sequence across the calendar period.'),
      ),
      SectionHeader('Reference / Inspirations Box (Optional)'),
      TextField(
        controller: _referenceInspirations,
        minLines: 2,
        maxLines: 5,
        decoration: fieldDecoration('Inspiration, Notes or Competitor Links',
            hint: 'Paste notes, article links, transcripts or raw ideas. Our Neuromarketing Agent will neutralize boring inputs into viral psychological hooks.',
            helper: 'If left empty, AI generates purely from project brand consciousness.'),
      ),
      SectionHeader('Platforms'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final e in _platformIds.entries)
          FilterChip(
            label: Text(e.value),
            selected: _platforms.contains(e.key),
            onSelected: (on) => setState(() => on ? _platforms.add(e.key) : _platforms.remove(e.key)),
          ),
      ]),
      SectionHeader('Campaign Goals'),
      TextField(
        controller: _goals,
        minLines: 1,
        maxLines: 3,
        decoration: fieldDecoration('What should this campaign achieve?',
            hint: 'e.g. 50 trial sign-ups, grow authority reels, increase saveability',
            helper: 'Optional. Up to 5 goals, comma or line separated.'),
      ),
              ],
            ),
          ),
        ),
        Container(
          padding: EdgeInsets.fromLTRB(16, 10, 16, 16),
          decoration: BoxDecoration(
            color: AppTheme.surface,
            border: Border(top: BorderSide(color: AppTheme.border)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ElevatedButton.icon(
                onPressed: _starting ? null : _start_,
                icon: Icon(Icons.auto_awesome_rounded),
                label: Text(_starting ? 'Starting Swarm…' : 'Generate $_days-day calendar'),
              ),
              SizedBox(height: 4),
              TextButton(onPressed: _starting ? null : _showEstimate, child: Text('See AI usage for this plan')),
              TextButton(onPressed: widget.onUseClassic, child: Text('Use the classic generator instead')),
            ],
          ),
        ),
      ],
    );
  }

  Widget _progress(BuildContext context) {
    final job = _job;
    if (job != null && job.isFailed) {
      return Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline_rounded, size: 48, color: AppTheme.error),
              SizedBox(height: 16),
              Text(
                'The calendar could not be finished',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: 12),
              Container(
                constraints: BoxConstraints(maxHeight: 200),
                padding: EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.error.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.error.withValues(alpha: 0.2)),
                ),
                child: SingleChildScrollView(
                  child: Text(
                    job.errorMessage ?? 'The server stopped at "${job.stageLabel}".',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    textAlign: TextAlign.left,
                  ),
                ),
              ),
              SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: () {
                  ref.read(activeAutopilotJobProvider(widget.project.id).notifier).clearActiveJob();
                  setState(() => _jobId = null);
                },
                icon: Icon(Icons.refresh_rounded),
                label: Text('Try again'),
              ),
              SizedBox(height: 8),
              TextButton(
                onPressed: () {
                  ref.read(activeAutopilotJobProvider(widget.project.id).notifier).clearActiveJob();
                  widget.onUseClassic();
                },
                child: Text('Use the classic generator'),
              ),
            ],
          ),
        ),
      );
    }
    final pct = job?.progress ?? 0;
    final stage = job?.stage ?? 'queued';

    // Agent badge helper
    String agentName = 'Initializing Swarm';
    IconData agentIcon = Icons.auto_awesome_rounded;
    Color agentColor = AppTheme.accent;

    if (stage == 'research') {
      agentName = 'Agent 1: Neuromarketing & Audience Psychology';
      agentIcon = Icons.psychology_rounded;
      agentColor = AppTheme.accent;
    } else if (stage == 'strategy') {
      agentName = 'Agent 2: Cadence & Content Flow Planner';
      agentIcon = Icons.route_rounded;
      agentColor = AppTheme.accentBlue;
    } else if (stage == 'hooks_scripts') {
      agentName = 'Agent 3: Master SOP Creative Brief Writer';
      agentIcon = Icons.edit_note_rounded;
      agentColor = AppTheme.success;
    } else if (stage == 'copy') {
      agentName = 'Agent 3: Native Platform Copywriter';
      agentIcon = Icons.text_fields_rounded;
      agentColor = AppTheme.success;
    } else if (stage == 'critic') {
      agentName = 'Agent 4: Quality Control & Brand Auditor';
      agentIcon = Icons.verified_user_rounded;
      agentColor = AppTheme.warning;
    } else if (stage == 'saving' || stage == 'done') {
      agentName = 'Swarm Assembly: Storing Calendar Pieces';
      agentIcon = Icons.save_rounded;
      agentColor = AppTheme.accent;
    }

    return Padding(
      padding: EdgeInsets.all(24),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: agentColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: agentColor.withValues(alpha: 0.3)),
          ),
          child: Row(children: [
            Icon(agentIcon, color: agentColor, size: 24),
            SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(agentName, style: TextStyle(color: agentColor, fontWeight: FontWeight.w700, fontSize: 13)),
                SizedBox(height: 2),
                Text(job?.stageLabel ?? 'Processing…', style: TextStyle(color: AppTheme.textPrimary, fontSize: 14)),
              ]),
            ),
          ]),
        ),
        SizedBox(height: 24),
        Semantics(
          label: 'Calendar progress',
          value: '$pct percent',
          child: LinearProgressIndicator(value: pct / 100, minHeight: 8, borderRadius: BorderRadius.circular(4)),
        ),
        SizedBox(height: 8),
        Text('$pct%', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700)),
        if (job?.detail != null) ...[
          SizedBox(height: 8),
          Text(job!.detail!, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
        ],
        SizedBox(height: 16),
        Text(
          'Our 4-agent swarm runs asynchronously on the server. You can leave this screen; the calendar appears in Planner when finished.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_pollError != null) ...[
          SizedBox(height: 12),
          ErrorView(error: _pollError!, compact: true, onRetry: _poll),
        ],
        SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FilledButton.tonalIcon(
              onPressed: () {
                context.go('/planner');
                showInfo(context, 'Calendar generation is running in the background. Check your Planner for progress.');
              },
              icon: const Icon(Icons.arrow_downward_rounded, size: 16),
              label: const Text('Run in background'),
            ),
            const SizedBox(width: 8),
            TextButton(
              onPressed: () => context.go('/planner'),
              child: const Text('Back to Planner'),
            ),
          ],
        ),
      ]),
    );
  }
}
