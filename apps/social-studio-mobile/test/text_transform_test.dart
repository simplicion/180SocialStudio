import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/native_preview.dart';
import 'package:social_studio_mobile/features/studio/text_motion.dart';

void main() {
  // Same cases as Phase6MathTest.kt (Android renderer), so the preview and the export place text identically.
  group('textTransformAt', () {
    test('no transform fields: style position, no rotation, scale 1', () {
      expect(textTransformAt({'positionX': 0.4, 'positionY': 0.3}, 0, 1000, 500),
          const TextTransform(rotationDeg: 0, scale: 1, positionX: 0.4, positionY: 0.3));
    });

    test('static rotation and scale come from the style', () {
      expect(textTransformAt({'rotationDeg': 15, 'scale': 1.5, 'positionX': 0.5, 'positionY': 0.2}, 1000, 3000, 2000),
          const TextTransform(rotationDeg: 15, scale: 1.5, positionX: 0.5, positionY: 0.2));
    });

    test('keyframes interpolate from the text start and hold at the ends; missing fields take the style value', () {
      final style = {
        'rotationDeg': 10,
        'scale': 2,
        'positionX': 0.5,
        'positionY': 0.2,
        'transformKeyframes': [
          {'atMs': 1000, 'rotationDeg': 90, 'scale': 1},
          {'atMs': 0, 'rotationDeg': 0, 'positionX': 0.2},
        ],
      };
      final mid = textTransformAt(style, 5000, 8000, 5500);
      expect(mid.rotationDeg, closeTo(45, 1e-9));
      expect(mid.scale, closeTo(1.5, 1e-9));
      expect(mid.positionX, closeTo(0.35, 1e-9));
      expect(mid.positionY, closeTo(0.2, 1e-9));
      expect(textTransformAt(style, 5000, 8000, 4000), const TextTransform(rotationDeg: 0, scale: 2, positionX: 0.2, positionY: 0.2));
      expect(textTransformAt(style, 5000, 8000, 7900), const TextTransform(rotationDeg: 90, scale: 1, positionX: 0.5, positionY: 0.2));
    });

    test('out-of-range values are clamped like the renderer', () {
      final t = textTransformAt({'rotationDeg': 400, 'scale': 9}, 0, 1000, 0);
      expect(t.rotationDeg, 180);
      expect(t.scale, 4);
    });
  });

  group('nativePreviewTimeline', () {
    MobileEditIr ir() => MobileEditIr.fromJson({
          'schemaVersion': 'mobile-editir/1',
          'projectId': 'p',
          'canvas': {'aspect': '9:16', 'width': 1080, 'height': 1920, 'fps': 30},
          'durationMs': 4000,
          'clips': [
            {'id': 'c1', 'assetId': 'primary', 'sourceStartMs': 0, 'sourceEndMs': 4000, 'timelineStartMs': 0, 'timelineEndMs': 4000},
          ],
          'overlays': [
            {'id': 'local', 'kind': 'broll', 'timelineStartMs': 0, 'timelineEndMs': 1000, 'source': {'kind': 'asset', 'assetId': 'x'}},
            {'id': 'remote', 'kind': 'broll', 'timelineStartMs': 2000, 'timelineEndMs': 3000, 'source': {'kind': 'url', 'url': 'https://e.com/a.mp4'}},
          ],
          'captions': [],
          'zooms': [],
          'audio': {
            'originalTrack': {'volumeDb': 0},
            'music': [
              {'id': 'm1', 'timelineStartMs': 0, 'timelineEndMs': 2000, 'source': {'kind': 'asset', 'assetId': 'song'}},
              {'id': 'm2', 'timelineStartMs': 2000, 'timelineEndMs': 4000, 'source': {'kind': 'stock_query', 'query': 'lofi', 'url': null}},
            ],
            'speechRangesMs': [],
          },
        });

    test('keeps what is on the phone, leaves out what is not, and passes proxies', () {
      final r = nativePreviewTimeline(
        ir(),
        assetPath: (id) => {'primary': '/v/main.mp4', 'x': '/v/x.mp4', 'song': '/a/song.m4a'}[id],
        localPath: (src) => src['kind'] == 'asset' ? {'x': '/v/x.mp4', 'song': '/a/song.m4a'}[src['assetId']] : null,
        proxyPaths: {'primary': '/v/main_720.mp4'},
      );
      expect(r.media.assetPaths, {'primary': '/v/main.mp4'});
      expect(r.media.proxyPaths, {'primary': '/v/main_720.mp4'});
      expect(r.media.overlayPaths, {'local': '/v/x.mp4'});
      expect(r.media.musicPaths, {'m1': '/a/song.m4a'});
      expect([for (final o in r.json['overlays'] as List) (o as Map)['id']], ['local']);
      expect([for (final m in (r.json['audio'] as Map)['music'] as List) (m as Map)['id']], ['m1']);
      expect(r.leftOut, containsAll(['remote', 'm2']));
    });
  });
}
