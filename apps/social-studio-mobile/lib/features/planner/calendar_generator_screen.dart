import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/widgets/common.dart';
import '../../data/models/content_calendar.dart';
import '../../data/models/project.dart';
import '../projects/project_provider.dart';
import 'autopilot_generator.dart';
import 'planner_providers.dart';

/// Autopilot calendar for the active project ([AutopilotGenerator]). The classic three-step generator
/// (`POST /content-calendar/create`) remains for extending a calendar or on request; it is prefilled from the
/// active project's brand voice, or from the calendar being extended.
class CalendarGeneratorScreen extends ConsumerStatefulWidget {
  const CalendarGeneratorScreen({super.key, this.extendFrom});
  final ContentCalendar? extendFrom;

  @override
  ConsumerState<CalendarGeneratorScreen> createState() => _CalendarGeneratorScreenState();
}

class _CalendarGeneratorScreenState extends ConsumerState<CalendarGeneratorScreen> {
  late final CalendarConfig _c = widget.extendFrom == null ? CalendarConfig() : CalendarConfig.extend(widget.extendFrom!);
  int _step = 0;
  bool _generating = false;
  bool _prefilled = false;
  bool _classic = false;

  late final _brand = TextEditingController(text: _c.brandName);
  late final _industry = TextEditingController(text: _c.industry);
  late final _audience = TextEditingController(text: _c.targetAudience);
  late final _pillars = TextEditingController(text: _c.contentPillars.join(', '));
  late final _voice = TextEditingController(text: _c.brandVoice);
  late final _goal = TextEditingController(text: _c.engagementGoal);
  late final _competitors = TextEditingController(text: _c.competitors.join(', '));

  @override
  void dispose() {
    for (final c in [_brand, _industry, _audience, _pillars, _voice, _goal, _competitors]) {
      c.dispose();
    }
    super.dispose();
  }

  void _prefillFromProject(Project p) {
    if (_prefilled || widget.extendFrom != null) return;
    _prefilled = true;
    final bv = p.brandVoice;
    if (_brand.text.isEmpty) _brand.text = p.name;
    if (bv != null) {
      if (_audience.text.isEmpty) _audience.text = bv.targetAudience;
      if (_pillars.text.isEmpty) _pillars.text = bv.contentPillars.join(', ');
      if (_voice.text.isEmpty) _voice.text = bv.tone;
    }
    final platforms = {
      for (final a in p.socialAccounts)
        ...CalendarConfig.platformOptions.where((o) => o.toLowerCase().startsWith(a.platform.id.substring(0, 4))),
    };
    if (_c.platforms.isEmpty) _c.platforms = platforms.toList();
    _c.timezone = p.settings.defaultTimezone;
    _c.projectId = p.id;
  }

  String? _validate() {
    if (_step == 0) {
      if (_brand.text.trim().isEmpty) return 'Enter a brand name.';
      if (_industry.text.trim().isEmpty) return 'Enter the industry.';
      if (_audience.text.trim().isEmpty) return 'Describe the target audience.';
    }
    if (_step == 1 && _c.platforms.isEmpty) return 'Choose at least one platform.';
    return null;
  }

  Future<void> _generate() async {
    _c
      ..brandName = _brand.text
      ..industry = _industry.text
      ..targetAudience = _audience.text
      ..contentPillars = splitList(_pillars.text)
      ..brandVoice = _voice.text
      ..engagementGoal = _goal.text
      ..competitors = splitList(_competitors.text)
      ..projectId ??= ref.read(activeProjectProvider).valueOrNull?.id;
    setState(() => _generating = true);
    final r = await guarded(context, () => ref.read(socialApiProvider).createCalendar(_c));
    if (!mounted) return;
    setState(() => _generating = false);
    if (r == null) return;
    ref.invalidate(calendarsProvider);
    showInfo(context, r.message ?? 'Generated ${r.totalPieces} pieces');
    context.pushReplacement('/planner/${r.calendarId}');
  }

  @override
  Widget build(BuildContext context) {
    final active = ref.watch(activeProjectProvider).valueOrNull;
    if (active != null) _prefillFromProject(active);
    if (widget.extendFrom == null && active != null && !_classic) {
      return Scaffold(
        appBar: AppBar(title: Text('Generate calendar')),
        body: AutopilotGenerator(project: active, onUseClassic: () => setState(() => _classic = true)),
      );
    }
    if (_generating) {
      return Scaffold(
        body: LoadingView(label: 'Writing your calendar…\nThis usually takes 30–90 seconds. Keep the app open.'),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(widget.extendFrom == null ? 'Generate calendar' : 'Extend calendar')),
      body: Stepper(
        currentStep: _step,
        onStepTapped: (i) => setState(() => _step = i),
        onStepCancel: _step == 0 ? null : () => setState(() => _step--),
        onStepContinue: () {
          final err = _validate();
          if (err != null) return showError(context, err);
          if (_step < 2) {
            setState(() => _step++);
          } else {
            _generate();
          }
        },
        controlsBuilder: (context, d) => Padding(
          padding: EdgeInsets.only(top: 16),
          child: Row(children: [
            ElevatedButton(onPressed: d.onStepContinue, child: Text(_step == 2 ? 'Generate' : 'Next')),
            if (d.onStepCancel != null) TextButton(onPressed: d.onStepCancel, child: Text('Back')),
          ]),
        ),
        steps: [
          Step(
            title: Text('Brand'),
            isActive: _step >= 0,
            content: Column(children: [
              Wrap(spacing: 8, children: [
                ChoiceChip(
                  label: Text('Business'),
                  selected: _c.calendarType == 'company',
                  onSelected: (_) => setState(() => _c.calendarType = 'company'),
                ),
                ChoiceChip(
                  label: Text('Personal brand'),
                  selected: _c.calendarType == 'personal',
                  onSelected: (_) => setState(() => _c.calendarType = 'personal'),
                ),
              ]),
              SizedBox(height: 12),
              TextField(controller: _brand, decoration: fieldDecoration('Brand name *')),
              SizedBox(height: 12),
              TextField(controller: _industry, decoration: fieldDecoration('Industry *', hint: 'e.g. Boutique fitness')),
              SizedBox(height: 12),
              TextField(controller: _audience, maxLines: 3, minLines: 1, decoration: fieldDecoration('Target audience *')),
            ]),
          ),
          Step(
            title: Text('Channels & cadence'),
            isActive: _step >= 1,
            content: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final p in CalendarConfig.platformOptions)
                  FilterChip(
                    label: Text(p),
                    selected: _c.platforms.contains(p),
                    onSelected: (on) => setState(() => on ? _c.platforms.add(p) : _c.platforms.remove(p)),
                  ),
              ]),
              SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: CalendarConfig.durationOptions.contains(_c.durationWords) ? _c.durationWords : null,
                decoration: fieldDecoration('Duration'),
                items: [for (final d in CalendarConfig.durationOptions) DropdownMenuItem(value: d, child: Text(d))],
                onChanged: (v) => setState(() => _c.durationWords = v ?? _c.durationWords),
              ),
              SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: CalendarConfig.frequencyOptions.contains(_c.frequency) ? _c.frequency : null,
                decoration: fieldDecoration('Posting frequency'),
                items: [for (final f in CalendarConfig.frequencyOptions) DropdownMenuItem(value: f, child: Text(f))],
                onChanged: (v) => setState(() => _c.frequency = v ?? _c.frequency),
              ),
              SizedBox(height: 12),
              OutlinedButton.icon(
                icon: Icon(Icons.event_rounded),
                label: Text('Starts ${fmtDate(_c.startDate)}'),
                onPressed: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _c.startDate,
                    firstDate: DateTime.now().subtract(Duration(days: 1)),
                    lastDate: DateTime.now().add(Duration(days: 365)),
                  );
                  if (d != null) setState(() => _c.startDate = d);
                },
              ),
            ]),
          ),
          Step(
            title: Text('Strategy'),
            isActive: _step >= 2,
            content: Column(children: [
              TextField(controller: _pillars, decoration: fieldDecoration('Content pillars', helper: 'Comma separated')),
              SizedBox(height: 12),
              TextField(controller: _voice, decoration: fieldDecoration('Brand voice')),
              SizedBox(height: 12),
              TextField(controller: _goal, decoration: fieldDecoration('Engagement goal', hint: 'e.g. 50 trial sign-ups')),
              SizedBox(height: 12),
              TextField(controller: _competitors, decoration: fieldDecoration('Competitors', helper: 'Comma separated, optional')),
            ]),
          ),
        ],
      ),
    );
  }
}
