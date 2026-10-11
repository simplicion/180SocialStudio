import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/project.dart';
import '../projects/project_provider.dart';

/// Project settings (`PUT /projects/:id`: name, description, status, services, socialSettings).
class SettingsTab extends ConsumerStatefulWidget {
  const SettingsTab({super.key, required this.project, this.scrollable = true});
  final Project project;
  final bool scrollable;

  @override
  ConsumerState<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends ConsumerState<SettingsTab> {
  late final _name = TextEditingController(text: widget.project.name);
  late final _description = TextEditingController(text: widget.project.description ?? '');
  late ProjectStatus _status = widget.project.status == ProjectStatus.unknown ? ProjectStatus.inProgress : widget.project.status;
  late final Set<String> _services = {...widget.project.socialServices};
  late bool _approval = widget.project.settings.approvalRequired;
  late String _tz = widget.project.settings.defaultTimezone;
  late int _retention = widget.project.settings.storageRetentionDays;
  bool _saving = false;

  @override
  void didUpdateWidget(SettingsTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) {
      _name.text = widget.project.name;
      _description.text = widget.project.description ?? '';
      _status = widget.project.status == ProjectStatus.unknown ? ProjectStatus.inProgress : widget.project.status;
      _services
        ..clear()
        ..addAll(widget.project.socialServices);
      _approval = widget.project.settings.approvalRequired;
      _tz = widget.project.settings.defaultTimezone;
      _retention = widget.project.settings.storageRetentionDays;
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      showError(context, 'The project needs a name.');
      return;
    }
    setState(() => _saving = true);
    final settings = ProjectSettings(
      approvalRequired: _approval,
      defaultTimezone: _tz,
      storageRetentionDays: _retention,
      defaultReviewerId: widget.project.settings.defaultReviewerId,
    );
    final outcome = await guarded(
      context,
      () => ref.read(socialApiProvider).updateProject(widget.project.id, {
        'name': _name.text.trim(),
        'description': _description.text.trim(),
        'status': _status.id,
        'socialServices': _services.toList(),
        'socialSettings': settings.toJson(),
      }),
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (outcome == null) return;
    showMutation(context, outcome, 'Settings saved');
    ref.refreshProjectData(widget.project.id);
  }

  Future<void> _delete() async {
    final ok = await confirm(context,
        title: 'Delete ${widget.project.name}?',
        message: 'The project is archived for everyone in the workspace. Posts and calendars stay on the server.',
        action: 'Delete',
        destructive: true);
    if (!ok || !mounted) return;
    final done = await guarded(context, () async {
      await ref.read(socialApiProvider).deleteProject(widget.project.id);
      return true;
    });
    if (done != true || !mounted) return;
    if (ref.read(activeProjectIdProvider) == widget.project.id) await ref.read(activeProjectIdProvider.notifier).select(null);
    ref.invalidate(allProjectsProvider);
    if (mounted) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    final tzOptions = {...timezoneOptions, _tz}.toList();
    final children = [
      TextField(controller: _name, decoration: fieldDecoration('Project name')),
      SizedBox(height: 12),
      TextField(controller: _description, minLines: 2, maxLines: 5, decoration: fieldDecoration('Description')),
      SizedBox(height: 12),
      DropdownButtonFormField<ProjectStatus>(
        isExpanded: true,
        initialValue: _status,
        decoration: fieldDecoration('Status'),
        items: [for (final s in ProjectStatus.editable) DropdownMenuItem(value: s, child: Text(s.label, overflow: TextOverflow.ellipsis))],
        onChanged: (v) => setState(() => _status = v ?? _status),
      ),
      SectionHeader('Services'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final e in socialServiceOptions.entries)
          FilterChip(
            label: Text(e.value),
            selected: _services.contains(e.key),
            onSelected: (on) => setState(() => on ? _services.add(e.key) : _services.remove(e.key)),
          ),
      ]),
      SectionHeader('Workflow'),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        value: _approval,
        onChanged: (v) => setState(() => _approval = v),
        title: Text('Client approval required'),
        subtitle: Text('Posts must be approved before they publish'),
      ),
      DropdownButtonFormField<String>(
        isExpanded: true,
        initialValue: _tz,
        decoration: fieldDecoration('Default timezone'),
        items: [for (final t in tzOptions) DropdownMenuItem(value: t, child: Text(t, overflow: TextOverflow.ellipsis))],
        onChanged: (v) => setState(() => _tz = v ?? _tz),
      ),
      SizedBox(height: 12),
      DropdownButtonFormField<int>(
        isExpanded: true,
        initialValue: _retention,
        decoration: fieldDecoration('Keep raw footage for'),
        items: [for (final d in {7, 14, 30, 60, 90, _retention}) DropdownMenuItem(value: d, child: Text('$d days'))],
        onChanged: (v) => setState(() => _retention = v ?? _retention),
      ),
      SizedBox(height: 24),
      ElevatedButton(
        onPressed: _saving ? null : _save,
        child: _saving ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text('Save settings'),
      ),
      SectionHeader('Danger zone'),
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(foregroundColor: AppTheme.error, side: BorderSide(color: AppTheme.error)),
        onPressed: _delete,
        icon: Icon(Icons.delete_forever_rounded),
        label: Text('Delete project'),
      ),
    ];

    if (!widget.scrollable) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
    }

    return ListView(padding: EdgeInsets.fromLTRB(16, 12, 16, 96), children: children);
  }
}
