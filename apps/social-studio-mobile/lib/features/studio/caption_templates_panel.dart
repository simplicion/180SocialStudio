import 'package:flutter/material.dart';

import '../../core/native_engine/edit_ir.dart';
import '../../core/theme/app_theme.dart';
import 'caption_catalog.dart';
import 'caption_customize_sheet.dart';
import 'caption_gallery.dart';
import 'caption_template_apply.dart';
import 'safe_zone_guide.dart';
import 'studio_controller.dart';
import 'timeline_ops.dart';

/// The template panel opened from the Captions tool: the live gallery (one tap applies a template to [captionIds],
/// all speech captions when null), then Customize (editable fields only) and Reset to template.
class CaptionTemplatesPanel extends StatefulWidget {
  const CaptionTemplatesPanel({
    super.key,
    required this.controller,
    required this.onEdit,
    this.captionIds,
    this.brandColors = const [],
    this.animate = true,
  });

  final StudioController controller;
  final void Function(MobileEditIr Function(MobileEditIr) op, {String? done}) onEdit;
  final Set<String>? captionIds;
  final List<String> brandColors;
  final bool animate;

  @override
  State<CaptionTemplatesPanel> createState() => _CaptionTemplatesPanelState();
}

class _CaptionTemplatesPanelState extends State<CaptionTemplatesPanel> {
  List<EditIrCaption> get _scope => [
    for (final x in widget.controller.ir?.captions ?? const <EditIrCaption>[])
      if (x.kind == 'caption' && (widget.captionIds == null || widget.captionIds!.contains(x.id))) x,
  ];

  late String? _selected = () {
    final first = _scope.firstOrNull;
    return first == null ? null : CaptionTemplateApply.templateOf(first.style)?.id;
  }();

  String get _scopeLabel {
    final ids = widget.captionIds;
    if (ids == null) return 'all captions';
    return '${ids.length} selected caption${ids.length == 1 ? '' : 's'}';
  }

  String? get _language {
    final c = widget.controller;
    final detected = c.transcript?.language;
    return detected != null && detected != 'und' ? detected : c.spokenLanguage;
  }

  void _apply(CaptionTemplate t) {
    setState(() => _selected = t.id);
    if (_scope.isEmpty) return;
    widget.onEdit(
      (ir) => TimelineOps.applyCaptionTemplate(ir, t.id, captionIds: widget.captionIds, languageCode: _language),
      done: '${t.name} applied to $_scopeLabel',
    );
  }

  void _reset() => widget.onEdit(
    (ir) => TimelineOps.resetCaptionsToTemplate(ir, captionIds: widget.captionIds),
    done: 'Captions reset to the template',
  );

  Future<void> _customize(CaptionTemplate t) async {
    final first = _scope.firstOrNull;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: SafeArea(
          child: CaptionCustomizeSheet(
            template: t,
            initial: CaptionOverrides.fromJson(first?.style[CaptionTemplateApply.overridesKey]),
            brandColors: widget.brandColors,
            safeZone: SafeZonePlatform.fromName(first?.style['safeZone'] ?? 'tiktok'),
            sampleText: first?.text ?? 'Your captions here',
            scopeLabel: _scopeLabel,
            onApply: (o, zone) {
              Navigator.of(ctx).pop();
              widget.onEdit(
                (ir) => TimelineOps.customizeCaptions(
                  ir,
                  o,
                  captionIds: widget.captionIds,
                  safeZone: zone,
                  languageCode: _language,
                ),
                done: 'Customized $_scopeLabel',
              );
            },
            onReset: () {
              Navigator.of(ctx).pop();
              _reset();
            },
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = _selected == null ? null : CaptionCatalog.byId(_selected!);
    final has = _scope.isNotEmpty;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Caption templates', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        Text(
          has
              ? 'Tap a template to apply it to $_scopeLabel. Previews play the first 3 s of your clip.'
              : 'Add captions first; previews show how they will look.',
          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
        ),
        const SizedBox(height: 10),
        CaptionGallery(controller: widget.controller, selectedId: _selected, onSelect: _apply, animate: widget.animate),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          children: [
            FilledButton.tonalIcon(
              key: const ValueKey('templates-customize'),
              onPressed: t == null || !has ? null : () => _customize(t),
              icon: const Icon(Icons.tune_rounded),
              label: const Text('Customize'),
            ),
            TextButton.icon(
              key: const ValueKey('templates-reset'),
              onPressed: t == null || !has ? null : _reset,
              icon: const Icon(Icons.restart_alt_rounded),
              label: const Text('Reset to template'),
            ),
          ],
        ),
      ],
    );
  }
}
