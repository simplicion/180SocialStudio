import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/autopilot.dart';

final brandConsciousnessProvider = FutureProvider.autoDispose.family<BrandConsciousness, String>(
  (ref, projectId) => ref.watch(socialApiProvider).getBrandConsciousness(projectId),
);

/// Who the brand is (`/brand-consciousness`): type, positioning, story, beliefs, extra colours, platforms.
/// Every AI agent (autopilot, carousels, AI Director, engagement) reads these. Nothing is prefilled or invented.
class BrandIdentityCard extends ConsumerWidget {
  const BrandIdentityCard({super.key, required this.projectId});
  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody<BrandConsciousness>(
        value: ref.watch(brandConsciousnessProvider(projectId)),
        onRetry: () => ref.invalidate(brandConsciousnessProvider(projectId)),
        builder: (b) => _IdentityEditor(key: ValueKey(b), projectId: projectId, initial: b),
      );
}

class _IdentityEditor extends ConsumerStatefulWidget {
  const _IdentityEditor({super.key, required this.projectId, required this.initial});
  final String projectId;
  final BrandConsciousness initial;

  @override
  ConsumerState<_IdentityEditor> createState() => _IdentityEditorState();
}

class _IdentityEditorState extends ConsumerState<_IdentityEditor> {
  static final _hex = RegExp(r'^#[0-9A-Fa-f]{6}$');

  late final BrandConsciousness b = widget.initial;
  late String? _type = b.brandType;
  late final Set<String> _platforms = {...b.targetPlatforms};
  late bool? _watermark = b.watermarkEnabled;
  late String? _editingAutonomy = b.editingAutonomy ?? 'ASSISTED';
  late final String _publishingAutonomy = b.publishingAutonomy ?? 'MANUAL';
  late final _name = TextEditingController(text: b.brandName);
  late final _website = TextEditingController(text: b.website);
  late final _industry = TextEditingController(text: b.industry);
  late final _country = TextEditingController(text: b.country);
  late final _language = TextEditingController(text: b.language);
  late final _positioning = TextEditingController(text: b.positioning);
  late final _tagline = TextEditingController(text: b.tagline);
  late final _description = TextEditingController(text: b.description);
  late final _ideation = TextEditingController(text: b.ideation);
  late final _ideology = TextEditingController(text: b.ideology);
  late final _bg = TextEditingController(text: b.backgroundColor);
  late final _text = TextEditingController(text: b.textColor);
  late final _secondary = TextEditingController(text: b.secondaryColor);
  late final _postsPerWeek = TextEditingController(text: b.postsPerWeek != null ? b.postsPerWeek.toString() : '');
  late final _guidelines = TextEditingController(text: b.customGuidelines);
  bool _dirty = false;
  bool _saving = false;

  List<TextEditingController> get _all => [
        _name,
        _website,
        _industry,
        _country,
        _language,
        _positioning,
        _tagline,
        _description,
        _ideation,
        _ideology,
        _bg,
        _text,
        _secondary,
        _postsPerWeek,
        _guidelines,
      ];

  @override
  void initState() {
    super.initState();
    for (final c in _all) {
      c.addListener(_markDirty);
    }
  }

  @override
  void dispose() {
    for (final c in _all) {
      c.dispose();
    }
    super.dispose();
  }

  void _markDirty() {
    if (!_dirty) setState(() => _dirty = true);
  }

  String? _nn(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();

  Future<void> _save() async {
    for (final c in [_bg, _text, _secondary]) {
      final v = c.text.trim();
      if (v.isNotEmpty && !_hex.hasMatch(v)) return showError(context, 'Colours must look like #1F3A2E.');
    }
    final pw = int.tryParse(_postsPerWeek.text.trim());
    final next = BrandConsciousness(
      brandName: _nn(_name),
      brandType: _type,
      website: _nn(_website),
      industry: _nn(_industry),
      country: _nn(_country)?.toUpperCase(),
      language: _nn(_language),
      positioning: _nn(_positioning),
      tagline: _nn(_tagline),
      description: _nn(_description),
      ideation: _nn(_ideation),
      ideology: _nn(_ideology),
      backgroundColor: _nn(_bg)?.toUpperCase(),
      textColor: _nn(_text)?.toUpperCase(),
      secondaryColor: _nn(_secondary)?.toUpperCase(),
      targetPlatforms: _platforms.toList(),
      watermarkEnabled: _watermark,
      postsPerWeek: pw,
      editingAutonomy: _editingAutonomy,
      publishingAutonomy: _publishingAutonomy,
      customGuidelines: _nn(_guidelines),
    );
    setState(() => _saving = true);
    final saved = await guarded(
        context, () => ref.read(socialApiProvider).putBrandConsciousness(widget.projectId, next.toIdentityJson()));
    if (!mounted) return;
    setState(() => _saving = false);
    if (saved == null) return;
    showSuccess(context, 'Brand consciousness saved');
    ref.invalidate(brandConsciousnessProvider(widget.projectId));
  }

  Widget _field(TextEditingController c, String label, {String? hint, int maxLines = 1, int? maxLength}) => Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: TextField(
          controller: c,
          minLines: 1,
          maxLines: maxLines,
          maxLength: maxLength,
          decoration: fieldDecoration(label, hint: hint),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final missing = b.missingRequired.map((f) => BrandConsciousness.fieldLabels[f] ?? f).toList();
    return SectionCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: Text('Brand consciousness', style: Theme.of(context).textTheme.titleMedium)),
          Text('${b.percent}%', style: Theme.of(context).textTheme.labelLarge),
        ]),
        SizedBox(height: 8),
        LinearProgressIndicator(value: b.percent / 100, minHeight: 4),
        if (missing.isNotEmpty)
          Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('The AI still needs: ${missing.join(', ')}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.warning)),
          ),
        SizedBox(height: 16),
        _field(_name, 'Brand name', maxLength: 120),
        Text('Brand type'),
        SizedBox(height: 6),
        Wrap(spacing: 8, children: [
          for (final e in BrandConsciousness.brandTypes.entries)
            ChoiceChip(
              label: Text(e.value),
              selected: _type == e.key,
              onSelected: (on) => setState(() {
                _type = on ? e.key : null;
                _dirty = true;
              }),
            ),
        ]),
        SizedBox(height: 12),
        Row(children: [
          Expanded(child: _field(_website, 'Website', hint: 'https://example.com')),
          SizedBox(width: 12),
          Expanded(child: _field(_industry, 'Industry', hint: 'Technology / Retail')),
        ]),
        Row(children: [
          Expanded(child: _field(_country, 'Country code', hint: 'US, UK, IN')),
          SizedBox(width: 12),
          Expanded(child: _field(_language, 'Language', hint: 'en-US, hi-IN')),
        ]),
        _field(_positioning, 'Positioning', hint: 'Who it is for and why it is different', maxLines: 3, maxLength: 500),
        _field(_tagline, 'Tagline', maxLength: 160),
        _field(_description, 'What the brand does', maxLines: 5, maxLength: 2000),
        _field(_ideation, 'Big idea / story', maxLines: 5, maxLength: 2000),
        _field(_ideology, 'Beliefs and values', maxLines: 5, maxLength: 2000),
        Row(children: [
          Expanded(child: _field(_bg, 'Background colour', hint: '#FFFFFF')),
          SizedBox(width: 8),
          Expanded(child: _field(_text, 'Text colour', hint: '#111111')),
          SizedBox(width: 8),
          Expanded(child: _field(_secondary, 'Secondary colour', hint: '#E0E0E0')),
        ]),
        Text('Target platforms'),
        SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final e in BrandConsciousness.platforms.entries)
            FilterChip(
              label: Text(e.value),
              selected: _platforms.contains(e.key),
              onSelected: (on) => setState(() {
                on ? _platforms.add(e.key) : _platforms.remove(e.key);
                _dirty = true;
              }),
            ),
        ]),
        SizedBox(height: 12),
        Row(children: [
          Expanded(child: _field(_postsPerWeek, 'Target posts per week', hint: '5')),
          SizedBox(width: 12),
          Expanded(
            child: DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: _editingAutonomy,
              decoration: fieldDecoration('Editing autonomy'),
              items: [
                DropdownMenuItem(value: 'AUTO', child: Text('Auto', overflow: TextOverflow.ellipsis)),
                DropdownMenuItem(value: 'ASSISTED', child: Text('Assisted', overflow: TextOverflow.ellipsis)),
                DropdownMenuItem(value: 'MANUAL', child: Text('Manual', overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => setState(() {
                _editingAutonomy = v;
                _dirty = true;
              }),
            ),
          ),
        ]),
        DropdownButtonFormField<bool?>(
          isExpanded: true,
          initialValue: _watermark,
          decoration: fieldDecoration('Logo watermark on videos'),
          items: [
            DropdownMenuItem(value: null, child: Text('Not chosen', overflow: TextOverflow.ellipsis)),
            DropdownMenuItem(value: true, child: Text('Yes', overflow: TextOverflow.ellipsis)),
            DropdownMenuItem(value: false, child: Text('No', overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) => setState(() {
            _watermark = v;
            _dirty = true;
          }),
        ),
        SizedBox(height: 12),
        _field(_guidelines, 'Other guidelines for the AI', maxLines: 5, maxLength: 4000),
        ElevatedButton(
          onPressed: _saving || !_dirty ? null : _save,
          child: _saving
              ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : Text('Save brand consciousness'),
        ),
      ]),
    );
  }
}
