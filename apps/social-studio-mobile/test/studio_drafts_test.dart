import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/studio/studio_drafts_service.dart';

Map<String, dynamic> _draftJson({int? unitsVersion}) => {
  'unitsVersion': ?unitsVersion,
  'id': 'd1',
  'title': 'Draft',
  'sourcePath': '/tmp/a.mp4',
  'updatedAt': '2026-01-01T00:00:00Z',
  'ir': {
    'schemaVersion': 'mobile-editir/1',
    'canvas': {'aspect': '9:16', 'width': 1080, 'height': 1920, 'fps': 30, 'background': '#000000'},
    'durationMs': 5000,
    'clips': [],
    'captions': [
      {
        'id': 'txt1',
        'kind': 'text',
        'startMs': 0,
        'endMs': 2000,
        'text': 'Hello',
        'words': [{'text': 'Hello', 'startMs': 0, 'endMs': 2000}],
        'style': {
          'fontSizePx': 24,
          'strokeWidthPx': 2,
          'background': {'color': '#000000B3', 'paddingPx': 8, 'radiusPx': 4},
        },
      },
      {
        'id': 'cap1',
        'kind': 'caption',
        'startMs': 2000,
        'endMs': 3000,
        'text': 'speech',
        'words': [{'text': 'speech', 'startMs': 2000, 'endMs': 3000}],
        'style': {'fontSizePx': 24},
      },
    ],
  },
};

void main() {
  test('legacy drafts scale old Text-tool title sizes to canvas pixels; speech captions untouched', () {
    final draft = StudioDraft.fromJson(_draftJson());
    final title = draft.ir.captions.firstWhere((c) => c.id == 'txt1');
    final speech = draft.ir.captions.firstWhere((c) => c.id == 'cap1');
    expect((title.style['fontSizePx'] as num).toDouble(), 72);
    expect((title.style['strokeWidthPx'] as num).toDouble(), 6);
    expect(((title.style['background'] as Map)['paddingPx'] as num).toDouble(), 24);
    expect((speech.style['fontSizePx'] as num).toDouble(), 24);
  });

  test('current drafts are not migrated and round-trip with the units version', () {
    final draft = StudioDraft.fromJson(_draftJson(unitsVersion: StudioDraft.unitsVersion));
    final title = draft.ir.captions.firstWhere((c) => c.id == 'txt1');
    expect((title.style['fontSizePx'] as num).toDouble(), 24);
    expect(draft.toJson()['unitsVersion'], StudioDraft.unitsVersion);
    final again = StudioDraft.fromJson(draft.toJson());
    expect((again.ir.captions.firstWhere((c) => c.id == 'txt1').style['fontSizePx'] as num).toDouble(), 24);
  });
}
