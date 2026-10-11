import 'timeline_ops.dart';

/// Brand look applied on top of a template (only what the user set; null keeps the template's value).
class BrandLook {
  const BrandLook({this.font, this.primaryColor, this.accentColor});
  final String? font;
  final String? primaryColor;
  final String? accentColor;

  static const none = BrandLook();
}

/// A ready-made text style. Built only from caption-style fields the renderers already draw
/// (contract §3.4), so templates need no engine changes. Ids are shared with the desktop editor.
class TextTemplate {
  const TextTemplate({
    required this.id,
    required this.name,
    required this.sample,
    required this.positionY,
    required this.defaultSeconds,
    required this.build,
  });

  final String id;
  final String name;
  final String sample;
  final double positionY;
  final int defaultSeconds;
  final Map<String, dynamic> Function(BrandLook brand) build;

  Map<String, dynamic> style([BrandLook brand = BrandLook.none]) => build(brand);

  static Map<String, dynamic> _base(String preset, double y, BrandLook b) => {
        ...TimelineOps.captionStyle('TITLE', positionY: y),
        'preset': preset,
        if (b.font != null && b.font!.isNotEmpty) 'fontFamily': b.font,
      };

  static final all = <TextTemplate>[
    TextTemplate(
      id: 'bold_title',
      name: 'Bold title',
      sample: 'THE ONE MISTAKE',
      positionY: 0.22,
      defaultSeconds: 3,
      build: (b) => {..._base('TPL_BOLD_TITLE', 0.22, b), 'fontSizePx': 92, 'fontWeight': 900, 'uppercase': true},
    ),
    TextTemplate(
      id: 'lower_third',
      name: 'Lower third',
      sample: 'Jane Doe · Founder',
      positionY: 0.8,
      defaultSeconds: 4,
      build: (b) => {
        ..._base('TPL_LOWER_THIRD', 0.8, b),
        'fontSizePx': 44,
        'fontWeight': 700,
        'strokeWidthPx': 0,
        'shadow': false,
        'positionX': 0.5,
        'background': {'color': '${b.primaryColor ?? '#111111'}E6', 'paddingPx': 18, 'radiusPx': 10},
      },
    ),
    TextTemplate(
      id: 'subscribe_cta',
      name: 'Follow CTA',
      sample: 'Follow for part 2 →',
      positionY: 0.86,
      defaultSeconds: 3,
      build: (b) => {
        ..._base('TPL_CTA', 0.86, b),
        'fontSizePx': 52,
        'fontWeight': 800,
        'textColor': '#111111',
        'strokeWidthPx': 0,
        'shadow': false,
        'background': {'color': b.accentColor ?? '#FFE600', 'paddingPx': 20, 'radiusPx': 28},
      },
    ),
    TextTemplate(
      id: 'quote',
      name: 'Quote',
      sample: '“Make it simple.”',
      positionY: 0.45,
      defaultSeconds: 4,
      build: (b) => {..._base('TPL_QUOTE', 0.45, b), 'fontSizePx': 64, 'fontWeight': 600, 'strokeWidthPx': 0, 'shadow': true},
    ),
    TextTemplate(
      id: 'big_number',
      name: 'Big number',
      sample: '3X',
      positionY: 0.4,
      defaultSeconds: 2,
      build: (b) => {
        ..._base('TPL_BIG_NUMBER', 0.4, b),
        'fontSizePx': 180,
        'fontWeight': 900,
        'textColor': b.accentColor ?? '#FFE600',
        'strokeWidthPx': 8,
      },
    ),
    TextTemplate(
      id: 'minimal',
      name: 'Minimal',
      sample: 'Day 1 of 30',
      positionY: 0.12,
      defaultSeconds: 3,
      build: (b) => {..._base('TPL_MINIMAL', 0.12, b), 'fontSizePx': 40, 'fontWeight': 500, 'strokeWidthPx': 0, 'shadow': true},
    ),
    TextTemplate(
      id: 'boxed_label',
      name: 'Boxed label',
      sample: 'STEP 1',
      positionY: 0.3,
      defaultSeconds: 2,
      build: (b) => {
        ..._base('TPL_BOXED', 0.3, b),
        'fontSizePx': 48,
        'fontWeight': 800,
        'uppercase': true,
        'strokeWidthPx': 0,
        'shadow': false,
        'background': {'color': '#000000CC', 'paddingPx': 16, 'radiusPx': 8},
      },
    ),
    TextTemplate(
      id: 'highlight',
      name: 'Highlight',
      sample: 'Save this!',
      positionY: 0.55,
      defaultSeconds: 2,
      build: (b) => {
        ..._base('TPL_HIGHLIGHT', 0.55, b),
        'fontSizePx': 72,
        'fontWeight': 900,
        'textColor': b.primaryColor ?? '#FFFFFF',
        'strokeColor': '#000000',
        'strokeWidthPx': 8,
      },
    ),
  ];

  static TextTemplate? byId(String id) => all.where((t) => t.id == id).firstOrNull;
}
