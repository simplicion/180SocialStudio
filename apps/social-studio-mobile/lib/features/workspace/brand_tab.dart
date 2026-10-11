import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/brand_voice.dart';
import '../../data/models/library.dart';
import '../../data/models/project.dart';
import '../projects/brand_voice_form.dart';
import '../projects/project_provider.dart';
import 'brand_identity_card.dart';

/// Brand identity editor plus AI content ideas grounded in it.
class BrandTab extends ConsumerWidget {
  const BrandTab({super.key, required this.project});
  final Project project;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AsyncBody<BrandVoice>(
      value: ref.watch(brandVoiceProvider(project.id)),
      onRetry: () => ref.invalidate(brandVoiceProvider(project.id)),
      builder: (voice) => _BrandEditor(project: project, initial: voice),
    );
  }
}

class _BrandEditor extends ConsumerStatefulWidget {
  const _BrandEditor({required this.project, required this.initial});
  final Project project;
  final BrandVoice initial;

  @override
  ConsumerState<_BrandEditor> createState() => _BrandEditorState();
}

class _BrandEditorState extends ConsumerState<_BrandEditor> {
  late BrandVoice _voice = widget.initial;
  bool _dirty = false;
  bool _saving = false;
  bool _ideasLoading = false;
  List<ContentIdea>? _ideas;
  Object? _ideasError;

  Future<void> _save() async {
    setState(() => _saving = true);
    final outcome = await guarded(context, () => ref.read(socialApiProvider).saveBrandVoice(widget.project.id, _voice));
    if (!mounted) return;
    setState(() => _saving = false);
    if (outcome == null) return;
    setState(() => _dirty = false);
    showMutation(context, outcome, 'Brand identity saved');
    if (!outcome.queued) ref.invalidate(brandVoiceProvider(widget.project.id));
  }

  Future<void> _uploadLogo() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery);
    if (file == null || !mounted) return;

    setState(() => _saving = true);
    final url = await guarded(
      context,
      () => ref.read(socialApiProvider).uploadBrandLogo(widget.project.id, file.path),
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (url != null) {
      setState(() {
        _voice = _voice.copyWith(logoUrl: url);
        _dirty = true;
      });
      showSuccess(context, 'Brand logo uploaded and saved!');
      ref.invalidate(brandVoiceProvider(widget.project.id));
    }
  }

  Future<void> _generateIdeas() async {
    setState(() {
      _ideasLoading = true;
      _ideasError = null;
    });
    try {
      final ideas = await ref.read(socialApiProvider).generateIdeas(widget.project.id, count: 5);
      if (mounted) setState(() => _ideas = ideas);
    } catch (e) {
      if (mounted) setState(() => _ideasError = e);
    } finally {
      if (mounted) setState(() => _ideasLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(padding: EdgeInsets.fromLTRB(16, 12, 16, 120), children: [
      if (_voice.isUnsaved)
        Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: StatusChip(label: 'Not saved yet: these are the server defaults', color: AppTheme.warning, icon: Icons.info_rounded),
        ),
      BrandVoiceForm(
        initial: _voice,
        onUploadLogo: _uploadLogo,
        onChanged: (v) => setState(() {
          _voice = v;
          _dirty = true;
        }),
      ),
      ElevatedButton(
        onPressed: _saving || !_dirty ? null : _save,
        child: _saving
            ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : Text('Save brand identity'),
      ),
      SizedBox(height: 16),
      BrandIdentityCard(projectId: widget.project.id),
      SectionHeader('Content ideas',
          trailing: TextButton.icon(
            onPressed: _ideasLoading ? null : _generateIdeas,
            icon: Icon(Icons.auto_awesome_rounded, size: 16),
            label: Text('Generate'),
          )),
      if (_ideasLoading) Padding(padding: EdgeInsets.all(16), child: LoadingView(label: 'Thinking up ideas…')),
      if (_ideasError != null) ErrorView(error: _ideasError!, compact: true, onRetry: _generateIdeas),
      if (_ideas != null && _ideas!.isEmpty) SectionCard(child: Text('The server returned no ideas.')),
      for (final idea in _ideas ?? const <ContentIdea>[])
        Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: SectionCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(idea.title, style: TextStyle(fontWeight: FontWeight.w700)),
              if (idea.hook != null) Text('Hook: ${idea.hook}', style: Theme.of(context).textTheme.bodyMedium),
              if (idea.caption != null) Padding(padding: EdgeInsets.only(top: 4), child: Text(idea.caption!, maxLines: 4, overflow: TextOverflow.ellipsis)),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => context.push('/posts/new?projectId=${widget.project.id}', extra: {
                    'title': idea.title,
                    'hook': idea.hook,
                    'content': idea.caption ?? idea.title,
                    'platforms': [?idea.platform],
                  }),
                  child: Text('Create post'),
                ),
              ),
            ]),
          ),
        ),
    ]);
  }
}
