import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import 'caption_catalog.dart';
import 'caption_template_apply.dart';
import 'safe_zone_guide.dart';

/// The Customize sheet: ONLY the fields the template lets a user change (CaptionTemplate.canEdit). Colours (brand
/// colours first), size within the template's range, position presets or a drag inside the safe zone, case, words
/// per line, motion intensity. Everything else is the template's signature and is not shown.
class CaptionCustomizeSheet extends StatefulWidget {
  const CaptionCustomizeSheet({
    super.key,
    required this.template,
    required this.initial,
    required this.onApply,
    required this.onReset,
    this.brandColors = const [],
    this.safeZone = SafeZonePlatform.tiktok,
    this.sampleText = 'Your captions here',
    this.scopeLabel = 'all captions',
  });

  final CaptionTemplate template;

  /// The overrides the captions have now (shown as the starting values).
  final CaptionOverrides initial;

  /// The changed overrides and the safe zone captions must stay inside.
  final void Function(CaptionOverrides overrides, SafeZonePlatform safeZone) onApply;
  final VoidCallback onReset;

  /// Brand kit colours (`#RRGGBB`), offered before the standard palette.
  final List<String> brandColors;
  final SafeZonePlatform safeZone;

  /// Used to size the block for the drag clamp.
  final String sampleText;
  final String scopeLabel;

  @override
  State<CaptionCustomizeSheet> createState() => _CaptionCustomizeSheetState();
}

class _CaptionCustomizeSheetState extends State<CaptionCustomizeSheet> {
  late CaptionOverrides o = widget.initial;
  late SafeZonePlatform zone = widget.safeZone;

  static const palette = ['#FFFFFF', '#000000', '#FFE600', '#FACC15', '#22C55E', '#22D3EE', '#3B82F6', '#F472B6', '#EF4444', '#A855F7'];

  CaptionTemplate get t => widget.template;
  Map<String, dynamic> get legacy => CaptionTemplateApply.baseStyle(t);

  double get _templateSize => ((legacy['fontSizePx'] as num?)?.toDouble() ?? 64).clamp(t.sizeRangePx.min, t.sizeRangePx.max);

  void _set(CaptionOverrides changes) => setState(() => o = o.merge(changes));

  /// The colour roles this template draws.
  List<(String, String)> get _roles => [
    ('text', 'Text'),
    ('active', 'Spoken word'),
    if (((legacy['strokeWidthPx'] as num?) ?? 0) > 0) ('stroke', 'Outline'),
    if (legacy['background'] is Map) ('background', 'Background'),
    ('emphasis', 'Key word'),
  ];

  String? _templateColor(String role) => switch (role) {
    'text' => legacy['textColor'] as String?,
    'active' => legacy['highlightColor'] as String?,
    'stroke' => legacy['strokeColor'] as String?,
    'background' => (legacy['background'] as Map?)?['color'] as String?,
    _ => null,
  };

  static Color _color(String hex) {
    final h = hex.replaceFirst('#', '');
    return Color(int.parse(h.length == 8 ? h.substring(6) + h.substring(0, 6) : 'FF$h', radix: 16));
  }

  Widget _label(String s) => Padding(
    padding: const EdgeInsets.only(top: 12, bottom: 4),
    child: Text(s, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
  );

  Widget _swatch(String role, String hex, {bool brand = false}) {
    final current = (o.colors[role] ?? _templateColor(role))?.toUpperCase();
    final on = current != null && current.startsWith(hex.toUpperCase());
    return Semantics(
      button: true,
      selected: on,
      label: '${brand ? 'Brand colour' : 'Colour'} $hex',
      child: GestureDetector(
        key: ValueKey('swatch-$role-$hex'),
        onTap: () => _set(CaptionOverrides(colors: {role: hex})),
        child: Container(
          width: 30,
          height: 30,
          margin: const EdgeInsets.only(right: 6),
          decoration: BoxDecoration(
            color: _color(hex),
            shape: brand ? BoxShape.rectangle : BoxShape.circle,
            borderRadius: brand ? BorderRadius.circular(6) : null,
            border: Border.all(color: on ? AppTheme.primary : AppTheme.border, width: on ? 3 : 1),
          ),
        ),
      ),
    );
  }

  Widget _colors() => Column(
    key: const ValueKey('customize-colors'),
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final (role, name) in _roles) ...[
        _label(name),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final b in widget.brandColors) _swatch(role, b, brand: true),
              if (widget.brandColors.isNotEmpty) const SizedBox(width: 8),
              for (final p in palette) _swatch(role, p),
            ],
          ),
        ),
      ],
    ],
  );

  Widget _size() {
    final r = t.sizeRangePx;
    final v = (o.sizePx ?? _templateSize).clamp(r.min, r.max);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label('Size: ${v.round()} px'),
        Slider(
          key: const ValueKey('customize-size'),
          value: v,
          min: r.min,
          max: r.max,
          onChanged: (x) => _set(CaptionOverrides(sizePx: x)),
        ),
      ],
    );
  }

  Widget _position() {
    final preset = o.position ?? (t.styleV2['layout'] is Map ? (t.styleV2['layout'] as Map)['position'] as String? : null) ?? 'lower-third';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label('Position'),
        SegmentedButton<String>(
          key: const ValueKey('customize-position'),
          segments: const [
            ButtonSegment(value: 'upper-third', label: Text('Top')),
            ButtonSegment(value: 'center', label: Text('Middle')),
            ButtonSegment(value: 'lower-third', label: Text('Bottom')),
          ],
          emptySelectionAllowed: true,
          selected: {if (preset != 'custom') preset},
          onSelectionChanged: (s) => s.isEmpty ? null : _set(CaptionOverrides(position: s.first)),
        ),
        const SizedBox(height: 8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CaptionDragPad(
              key: const ValueKey('caption-drag-pad'),
              zone: zone,
              x: o.position == 'custom' ? (o.x ?? 0.5) : 0.5,
              y: o.position == 'custom' ? (o.y ?? 0.68) : CaptionOverrides.presetY[preset] ?? 0.68,
              block: CaptionTemplateApply.blockSize(widget.sampleText, o.sizePx ?? _templateSize),
              onChanged: (p) => _set(CaptionOverrides(position: 'custom', x: p.dx, y: p.dy)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Drag to place. Captions stay inside the safe zone of:', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final z in SafeZonePlatform.values)
                        ChoiceChip(
                          label: Text(z.label),
                          selected: zone == z,
                          onSelected: (_) => setState(() => zone = z),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _case() {
    final v2Typo = t.styleV2['typography'];
    final current = o.textCase ?? (v2Typo is Map ? v2Typo['case'] as String? : null) ?? (legacy['uppercase'] == true ? 'upper' : 'none');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label('Case'),
        SegmentedButton<String>(
          key: const ValueKey('customize-case'),
          segments: const [
            ButtonSegment(value: 'none', label: Text('As spoken')),
            ButtonSegment(value: 'upper', label: Text('UPPER')),
            ButtonSegment(value: 'title', label: Text('Title')),
          ],
          selected: {current},
          onSelectionChanged: (s) => _set(CaptionOverrides(textCase: s.first)),
        ),
      ],
    );
  }

  Widget _words() {
    final g = t.styleV2['grouping'];
    final v = o.maxWords ?? (g is Map ? (g['maxWords'] as num?)?.toInt() : null) ?? 3;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label('Words per line: ${v.clamp(1, 6)}'),
        Slider(
          key: const ValueKey('customize-words'),
          value: v.clamp(1, 6).toDouble(),
          min: 1,
          max: 6,
          divisions: 5,
          onChanged: (x) => _set(CaptionOverrides(maxWords: x.round())),
        ),
      ],
    );
  }

  Widget _motion() {
    final m = t.styleV2['motion'];
    final v = o.motionIntensity ?? (m is Map ? (m['intensity'] as num?)?.toDouble() : null) ?? 1.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label('Motion: ${(v * 100).round()} %'),
        Slider(
          key: const ValueKey('customize-motion'),
          value: v.clamp(0.0, 1.0),
          onChanged: (x) => _set(CaptionOverrides(motionIntensity: x)),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final nothing = !captionEditableFields.any(t.canEdit);
    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Customize ${t.name}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          Text(
            'Changes ${widget.scopeLabel}. The template keeps its fonts, outline and motion style.',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
          if (nothing)
            const Padding(padding: EdgeInsets.only(top: 12), child: Text('This template has no adjustable settings.')),
          if (t.canEdit('colors')) _colors(),
          if (t.canEdit('sizePx')) _size(),
          if (t.canEdit('position')) _position(),
          if (t.canEdit('case')) _case(),
          if (t.canEdit('maxWords')) _words(),
          if (t.canEdit('motionIntensity')) _motion(),
          const SizedBox(height: 12),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            spacing: 8,
            children: [
              TextButton.icon(
                key: const ValueKey('customize-reset'),
                onPressed: widget.onReset,
                icon: const Icon(Icons.restart_alt_rounded),
                label: const Text('Reset to template'),
              ),
              FilledButton(
                key: const ValueKey('customize-apply'),
                onPressed: () => widget.onApply(o, zone),
                child: const Text('Apply'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A 9:16 mini frame: the safe zone of [zone] outlined, and a handle for the caption block's centre that can only
/// be dragged inside it (SafeZonePlatform.clampCentre with the block's size).
class CaptionDragPad extends StatelessWidget {
  const CaptionDragPad({
    super.key,
    required this.zone,
    required this.x,
    required this.y,
    required this.block,
    required this.onChanged,
    this.width = 96,
  });

  final SafeZonePlatform zone;
  final double x, y;

  /// Caption block size as frame fractions.
  final Size block;
  final ValueChanged<Offset> onChanged;
  final double width;

  @override
  Widget build(BuildContext context) {
    final h = width * 16 / 9;
    final r = zone.safeFraction;
    final c = zone.clampCentre(x, y, blockW: block.width, blockH: block.height);
    void move(Offset local) => onChanged(zone.clampCentre(local.dx / width, local.dy / h, blockW: block.width, blockH: block.height));
    return GestureDetector(
      onPanStart: (d) => move(d.localPosition),
      onPanUpdate: (d) => move(d.localPosition),
      onTapDown: (d) => move(d.localPosition),
      child: Container(
        width: width,
        height: h,
        decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppTheme.border)),
        child: Stack(
          children: [
            Positioned(
              left: r.left * width,
              top: r.top * h,
              width: r.width * width,
              height: r.height * h,
              child: Container(decoration: BoxDecoration(border: Border.all(color: const Color(0xFF00E5FF), width: 1))),
            ),
            Positioned(
              left: (c.dx - block.width / 2) * width,
              top: (c.dy - block.height / 2) * h,
              width: block.width * width,
              height: (block.height * h).clamp(6.0, h),
              child: Container(
                key: const ValueKey('caption-drag-handle'),
                decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.8), borderRadius: BorderRadius.circular(3)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
