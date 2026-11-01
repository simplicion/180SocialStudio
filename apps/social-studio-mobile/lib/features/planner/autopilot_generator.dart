import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/poll_backoff.dart';
import '../../core/widgets/common.dart';
import '../../data/models/autopilot.dart';
import '../../data/models/content_calendar.dart';
import '../../data/models/project.dart';
import 'planner_providers.dart';

/// Autopilot calendar: the server's research -> strategy -> hooks & scripts -> captions -> critic agents,
/// grounded in the project's brand consciousness. Starts an autonomous job and follows it until ready.
class AutopilotGenerator extends ConsumerStatefulWidget {
  const AutopilotGenerator({
    super.key,
    required this.project,
    this.extendFrom,
    this.pollInterval,
  });

  final Project project;
  final ContentCalendar? extendFrom;

  /// Test hook; defaults to 2 s.
  final Duration? pollInterval;

  @override
  ConsumerState<AutopilotGenerator> createState() => _AutopilotGeneratorState();
}

class _AutopilotGeneratorState extends ConsumerState<AutopilotGenerator> {
  static const _platformIds = BrandConsciousness.platforms;
  static const _presetDays = [7, 14, 30, 60, 90];

  late final _name = TextEditingController(
    text: widget.extendFrom != null
        ? '${widget.extendFrom!.brandName} (Continued Sprint)'
        : '${widget.project.name} Content Sprint',
  );
  final _structureDirectives = TextEditingController();
  final _referenceInspirations = TextEditingController();
  final _goals = TextEditingController();

  int _days = 30;
  late DateTime _start = widget.extendFrom?.endDate != null
      ? widget.extendFrom!.endDate!.add(const Duration(days: 1))
      : DateTime.now().add(const Duration(days: 1));

  late final Set<String> _platforms = widget.extendFrom != null && widget.extendFrom!.platforms.isNotEmpty
      ? {
          for (final p in widget.extendFrom!.platforms)
            for (final id in _platformIds.keys)
              if (p.toLowerCase().startsWith(id.substring(0, 4))) id,
        }
      : {
          for (final a in widget.project.socialAccounts)
            for (final id in _platformIds.keys)
              if (a.platform.id.toLowerCase().startsWith(id.substring(0, 4))) id,
        };

  int _customReels = 1;
  int _customCarousels = 1;
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
        'mode': 'custom',
        'dailyReels': _customReels,
        'dailyCarousels': _customCarousels,
        'targetReelDurationSec': _targetReelDurationSec,
        'carouselSlideCount': _carouselSlideCount,
      };

  Future<void> _pickCustomDuration() async {
    final ctl = TextEditingController(text: '$_days');
    final result = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Custom Duration'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter the number of days for this calendar sprint (1–365):',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: ctl,
              keyboardType: TextInputType.number,
              autofocus: true,
              decoration: fieldDecoration('Duration (Days)', hint: 'e.g. 21, 45, 120'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final val = int.tryParse(ctl.text.trim());
              if (val != null && val >= 1 && val <= 365) {
                Navigator.pop(ctx, val);
              } else {
                showError(ctx, 'Please enter a valid number of days between 1 and 365.');
              }
            },
            child: const Text('Set Duration'),
          ),
        ],
      ),
    );
    if (result != null && mounted) {
      setState(() => _days = result);
    }
  }

  Future<void> _start_() async {
    if (_platforms.isEmpty) return showError(context, 'Choose at least one platform.');
    if (_customReels + _customCarousels == 0) return showError(context, 'Choose at least one reel or carousel per day.');
    final supportsCarousel = _platforms.any((p) => p == 'instagram' || p == 'facebook' || p == 'linkedin');
    if (_customCarousels > 0 && !supportsCarousel) {
      return showError(context, 'None of the selected platforms publishes carousels. Adjust carousels per day to 0 or choose Instagram, Facebook, or LinkedIn.');
    }
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
            fallbackToBuiltin: true,
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
      setState(() => _pollError = e);
      if (e is ApiException && !e.isTransient) return;
    }
    _timer = Timer(pollDelay(_polls++, override: widget.pollInterval), _poll);
  }

  @override
  Widget build(BuildContext context) {
    if (_jobId != null) return _progress(context);

    final isCustomDays = !_presetDays.contains(_days);

    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.extendFrom != null) ...[
                  Container(
                    margin: const EdgeInsets.only(bottom: 14),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.fast_forward_rounded, color: AppTheme.primary, size: 20),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Extending Calendar: ${widget.extendFrom!.brandName}',
                                style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 13),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Continues automatically starting on ${fmtDate(_start)} (day after previous calendar ends).',
                                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.35),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                SectionCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Icon(Icons.auto_awesome_rounded, color: AppTheme.accent, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Master SOP Creative Studio',
                          style: Theme.of(context).textTheme.titleMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ]),
                    const SizedBox(height: 6),
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
                SectionHeader('Length & Date Range'),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final d in _presetDays)
                      ChoiceChip(
                        label: Text('$d days'),
                        selected: _days == d,
                        onSelected: (_) => setState(() => _days = d),
                      ),
                    ChoiceChip(
                      avatar: isCustomDays ? const Icon(Icons.check, size: 16) : const Icon(Icons.edit_calendar_rounded, size: 16),
                      label: Text(isCustomDays ? 'Custom ($_days days)' : 'Custom...'),
                      selected: isCustomDays,
                      onSelected: (_) => _pickCustomDuration(),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    alignment: Alignment.centerLeft,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  icon: const Icon(Icons.event_rounded),
                  label: Text(
                    'Starts ${fmtDate(_start)}  →  Ends ${fmtDate(_start.add(Duration(days: _days - 1)))} ($_days days)',
                    overflow: TextOverflow.ellipsis,
                  ),
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _start,
                      firstDate: DateTime.now().subtract(const Duration(days: 1)),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (d != null) setState(() => _start = d);
                  },
                ),
                SectionHeader('Content Cadence & Mix'),
                SectionCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text('Daily Cadence Stepper',
                              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: AppTheme.textSecondary)),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppTheme.primary.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
                          ),
                          child: Text(
                            '${_customReels + _customCarousels} / day',
                            style: TextStyle(fontSize: 10, color: AppTheme.primary, fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      const Expanded(child: Text('Reels per day:', style: TextStyle(fontWeight: FontWeight.w600))),
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(
                          icon: const Icon(Icons.remove_circle_outline),
                          onPressed: _customReels > 0 && (_customReels + _customCarousels > 1)
                              ? () => setState(() => _customReels--)
                              : null,
                        ),
                        SizedBox(
                          width: 24,
                          child: Text('$_customReels', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        ),
                        IconButton(
                          icon: const Icon(Icons.add_circle_outline),
                          onPressed: _customReels < 5 ? () => setState(() => _customReels++) : null,
                        ),
                      ]),
                    ]),
                    const Divider(height: 8),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      const Expanded(child: Text('Carousels per day:', style: TextStyle(fontWeight: FontWeight.w600))),
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        IconButton(
                          icon: const Icon(Icons.remove_circle_outline),
                          onPressed: _customCarousels > 0 && (_customReels + _customCarousels > 1)
                              ? () => setState(() => _customCarousels--)
                              : null,
                        ),
                        SizedBox(
                          width: 24,
                          child: Text('$_customCarousels', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                        ),
                        IconButton(
                          icon: const Icon(Icons.add_circle_outline),
                          onPressed: _customCarousels < 5 ? () => setState(() => _customCarousels++) : null,
                        ),
                      ]),
                    ]),
                  ]),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<int>(
                  initialValue: _targetReelDurationSec,
                  isExpanded: true,
                  dropdownColor: AppTheme.surfaceElevated,
                  decoration: fieldDecoration('Target Reel Duration', helper: 'Recommended duration for generated reel scripts & hooks'),
                  items: const [
                    DropdownMenuItem(value: 15, child: Text('15s (Micro Hook)', overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 30, child: Text('30s (Fast Hook)', overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 45, child: Text('45s (Punchy Story)', overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 60, child: Text('60s (1 min — Standard)', overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 90, child: Text('90s (1.5 min — In-depth)', overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 120, child: Text('120s (2 min — Extended)', overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 150, child: Text('150s (2.5 min — Long-form)', overflow: TextOverflow.ellipsis)),
                    DropdownMenuItem(value: 180, child: Text('180s (3 min — Deep Dive)', overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (val) {
                    if (val != null) setState(() => _targetReelDurationSec = val);
                  },
                ),
                const SizedBox(height: 14),
                Text('Target Carousel Slides', style: Theme.of(context).textTheme.labelMedium),
                const SizedBox(height: 6),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  ChoiceChip(
                    label: const Text('5 slides (Standard SOP)'),
                    selected: _carouselSlideCount == 5,
                    onSelected: (_) => setState(() => _carouselSlideCount = 5),
                  ),
                  ChoiceChip(
                    label: const Text('7 slides (Deep Dive)'),
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
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          decoration: BoxDecoration(
            color: AppTheme.surface,
            border: Border(top: BorderSide(color: AppTheme.border)),
          ),
          child: SafeArea(
            top: false,
            child: SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton.icon(
                onPressed: _starting ? null : _start_,
                icon: _starting
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Icon(Icons.auto_awesome_rounded),
                label: Text(
                  _starting ? 'Starting AI Swarm…' : 'Generate $_days-Day Calendar',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ),
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
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline_rounded, size: 48, color: AppTheme.error),
              const SizedBox(height: 16),
              Text(
                'The calendar could not be finished',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Container(
                constraints: const BoxConstraints(maxHeight: 200),
                padding: const EdgeInsets.all(12),
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
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () {
                  ref.read(activeAutopilotJobProvider(widget.project.id).notifier).clearActiveJob();
                  setState(() => _jobId = null);
                },
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try again'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
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
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: agentColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: agentColor.withValues(alpha: 0.3)),
          ),
          child: Row(children: [
            Icon(agentIcon, color: agentColor, size: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(agentName, style: TextStyle(color: agentColor, fontWeight: FontWeight.w700, fontSize: 13)),
                const SizedBox(height: 2),
                Text(job?.stageLabel ?? 'Processing…', style: TextStyle(color: AppTheme.textPrimary, fontSize: 14)),
              ]),
            ),
          ]),
        ),
        const SizedBox(height: 24),
        Semantics(
          label: 'Calendar progress',
          value: '$pct percent',
          child: LinearProgressIndicator(value: pct / 100, minHeight: 8, borderRadius: BorderRadius.circular(4)),
        ),
        const SizedBox(height: 8),
        Text('$pct%', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
        if (job?.detail != null) ...[
          const SizedBox(height: 8),
          Text(job!.detail!, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
        ],
        const SizedBox(height: 16),
        Text(
          'Our 4-agent swarm runs asynchronously on the server. You can leave this screen; the calendar appears in Planner when finished.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_pollError != null) ...[
          const SizedBox(height: 12),
          ErrorView(error: _pollError!, compact: true, onRetry: _poll),
        ],
        const SizedBox(height: 16),
        Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          runSpacing: 4,
          children: [
            FilledButton.tonalIcon(
              onPressed: () {
                context.go('/planner');
                showInfo(context, 'Calendar generation is running in the background. Check your Planner for progress.');
              },
              icon: const Icon(Icons.arrow_downward_rounded, size: 16),
              label: const Text('Run in background'),
            ),
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
