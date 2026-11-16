// Caption template catalog (captions v2): the phone's view of packages/video-contracts/src/caption-templates.ts.
//
// CONTRACT (fixed; consumers code against this API):
//   CaptionCatalog.templates        every template, gallery order
//   CaptionCatalog.byId(id)         a template by its id OR a legacy id (old projects), else null
//   CaptionCatalog.canonicalId(id)  legacy id -> current id (unknown ids are returned unchanged)
//   CaptionTemplate fields below; `styleV2` is a CaptionStyleV2 JSON map (caption-style-v2.ts) and `legacyStyle` the
//   flat v1 caption style map older renderers read.
//
// STUB: until the catalog generator replaces this file's data, the templates are built from
// TimelineOps.viralCaptionPresets with an empty styleV2.
import 'timeline_ops.dart';

/// Fields a user may change on a template (caption-style-v2.ts EDITABLE_FIELDS).
const captionEditableFields = ['colors', 'sizePx', 'position', 'case', 'maxWords', 'motionIntensity'];

class CaptionTemplate {
  const CaptionTemplate({
    required this.id,
    required this.name,
    required this.description,
    required this.bestFor,
    required this.energy,
    required this.editable,
    required this.sizeRangePx,
    required this.styleV2,
    required this.legacyStyle,
    this.legacyIds = const [],
  });

  final String id;
  final String name;
  final String description;
  final List<String> bestFor;

  /// 1 (calm) .. 5 (hype).
  final int energy;
  final List<String> editable;
  final ({double min, double max}) sizeRangePx;
  final Map<String, dynamic> styleV2;
  final Map<String, dynamic> legacyStyle;

  /// Older ids that open as this template.
  final List<String> legacyIds;

  bool canEdit(String field) => editable.contains(field);
}

class CaptionCatalog {
  CaptionCatalog._();

  static final List<CaptionTemplate> templates = [
    for (final e in TimelineOps.viralCaptionPresets.entries)
      CaptionTemplate(
        id: e.key,
        name: e.value.name,
        description: e.value.subtitle,
        bestFor: const [],
        energy: 3,
        editable: captionEditableFields,
        sizeRangePx: (
          min: ((e.value.style['fontSizePx'] as num?)?.toDouble() ?? 64) * 0.6,
          max: ((e.value.style['fontSizePx'] as num?)?.toDouble() ?? 64) * 1.6,
        ),
        styleV2: const {},
        legacyStyle: e.value.style,
      ),
  ];

  static CaptionTemplate? byId(String id) {
    final c = canonicalId(id);
    for (final t in templates) {
      if (t.id == c) return t;
    }
    return null;
  }

  static String canonicalId(String id) {
    for (final t in templates) {
      if (t.id == id || t.legacyIds.contains(id)) return t.id;
    }
    return id;
  }
}
