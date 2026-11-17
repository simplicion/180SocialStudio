// Caption template catalog (captions v2): the phone's view of packages/video-contracts/src/caption-templates.ts.
//
// CONTRACT (fixed; consumers code against this API):
//   CaptionCatalog.templates        every template, gallery order
//   CaptionCatalog.byId(id)         a template by its id OR a legacy id (old projects), else null
//   CaptionCatalog.canonicalId(id)  legacy id -> current id (unknown ids are returned unchanged)
//   CaptionTemplate fields below; `styleV2` is a CaptionStyleV2 JSON map (caption-style-v2.ts) and `legacyStyle` the
//   flat v1 caption style map older renderers read.
//
// DATA: caption_catalog.g.dart, generated from the TS catalog by scripts/gen-caption-catalog.ts (a TS test fails when
// it is stale). `thumbnail` previews are not generated yet (they need the real renderer).
part 'caption_catalog.g.dart';

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

  static final List<CaptionTemplate> templates = generatedCaptionTemplates;

  static CaptionTemplate? byId(String id) {
    final c = canonicalId(id);
    for (final t in templates) {
      if (t.id == c) return t;
    }
    return null;
  }

  static String canonicalId(String id) {
    final legacy = generatedLegacyCaptionIds[id];
    if (legacy != null) return legacy;
    for (final t in templates) {
      if (t.id == id || t.legacyIds.contains(id)) return t.id;
    }
    return id;
  }
}
