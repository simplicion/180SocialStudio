import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/social_api_client.dart';
import '../../core/providers.dart';
import '../../core/widgets/common.dart';
import '../../data/models/brand_voice.dart';
import '../../data/models/project.dart';
import 'brand_voice_form.dart';
import 'project_provider.dart';

/// New project wizard for creators: channel basics → brand identity → create.
class CreateProjectScreen extends ConsumerStatefulWidget {
  const CreateProjectScreen({super.key});

  @override
  ConsumerState<CreateProjectScreen> createState() => _CreateProjectScreenState();
}

class _CreateProjectScreenState extends ConsumerState<CreateProjectScreen> {
  int _step = 0;
  bool _saving = false;
  final _name = TextEditingController();
  final _description = TextEditingController();
  BrandVoice _voice = BrandVoice(projectId: '');
  String? _pickedLogoPath;
  String _tz = 'UTC';

  @override
  void initState() {
    super.initState();
    final local = DateTime.now().timeZoneName;
    _tz = timezoneOptions.firstWhere((t) => t.endsWith(local), orElse: () => 'UTC');
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  String? _validate() {
    if (_step == 0) {
      if (_name.text.trim().isEmpty) return 'Give your channel or project a name.';
    }
    return null;
  }

  Future<void> _create() async {
    setState(() => _saving = true);
    final input = CreateProjectInput(
      name: _name.text,
      description: _description.text,
      clientId: null,
      clientName: null,
      clientEmail: null,
      socialServices: const ['content_calendar', 'short_form_video', 'publishing'],
      brandVoice: _voice,
      connectedAccountIds: const [],
      settings: ProjectSettings(approvalRequired: false, defaultTimezone: _tz),
    );
    final project = await guarded(context, () => ref.read(socialApiProvider).createProject(input));
    if (!mounted) return;
    if (project == null) {
      setState(() => _saving = false);
      return;
    }

    if (_pickedLogoPath != null) {
      try {
        await ref.read(socialApiProvider).uploadBrandLogo(project.id, _pickedLogoPath!);
      } catch (_) {
        // Upload failure should not prevent user from entering project; can be retried in Brand tab.
      }
    }

    setState(() => _saving = false);
    ref.invalidate(allProjectsProvider);
    ref.invalidate(projectListProvider);
    await ref.read(activeProjectIdProvider.notifier).select(project.id);
    if (!mounted) return;
    showInfo(context, '${project.name} created');
    context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('New Channel / Project')),
      body: Stepper(
        currentStep: _step,
        onStepTapped: (i) => i < _step ? setState(() => _step = i) : null,
        onStepCancel: _step == 0 ? null : () => setState(() => _step--),
        onStepContinue: () {
          final err = _validate();
          if (err != null) return showError(context, err);
          if (_step < 1) {
            setState(() => _step++);
          } else {
            _create();
          }
        },
        controlsBuilder: (context, d) => Padding(
          padding: EdgeInsets.only(top: 16),
          child: Row(children: [
            FilledButton(
              onPressed: _saving ? null : d.onStepContinue,
              child: _saving
                  ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(_step == 1 ? 'Create' : 'Next'),
            ),
            if (d.onStepCancel != null) TextButton(onPressed: d.onStepCancel, child: Text('Back')),
          ]),
        ),
        steps: [
          Step(
            title: Text('Channel Details'),
            isActive: _step >= 0,
            content: Column(children: [
              TextField(
                controller: _name,
                autofocus: true,
                decoration: fieldDecoration('Channel / Project name *', hint: 'e.g. Personal Brand, Tech Shorts, Podcast'),
              ),
              SizedBox(height: 12),
              TextField(
                controller: _description,
                minLines: 1,
                maxLines: 3,
                decoration: fieldDecoration('Description', hint: 'What is this channel or series about?'),
              ),
            ]),
          ),
          Step(
            title: Text('Style DNA & Voice'),
            subtitle: Text('Optional, and editable later'),
            isActive: _step >= 1,
            content: BrandVoiceForm(
              initial: _voice,
              onChanged: (v) => _voice = v,
              onLogoPicked: (path) => setState(() => _pickedLogoPath = path),
            ),
          ),
        ],
      ),
    );
  }
}
