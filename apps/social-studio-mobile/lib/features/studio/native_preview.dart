import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../core/native_engine/edit_ir.dart';
import 'timeline_ops.dart';

/// Which editor preview the studio shows (audit F-14).
///  - [dart]: video_player controllers plus captions, effects and crossfades redrawn in Flutter (the default).
///  - [native]: the Android renderer's own composition played by a Media3 CompositionPlayer, so the preview is the
///    export (CompositionFactory, mode PREVIEW). Selection / drag handles stay in Dart.
enum StudioPreviewMode { dart, native }

/// The preview in use. Defaults to [StudioPreviewMode.dart] until the native one is proven on low-end phones; build
/// with `--dart-define=STUDIO_PREVIEW=native` (or set this before opening the studio) to try the native preview.
StudioPreviewMode studioPreviewMode =
    const String.fromEnvironment('STUDIO_PREVIEW') == 'native' ? StudioPreviewMode.native : StudioPreviewMode.dart;

/// True when the native preview should be used on this device (Android only; everything else keeps the Dart one).
bool get useNativeStudioPreview => studioPreviewMode == StudioPreviewMode.native && !kIsWeb && Platform.isAndroid;

const _viewType = 'com.workspace180.socialmanager/media_engine_preview';
const _channelPrefix = 'com.workspace180.socialmanager/media_engine_preview_';

/// Local files of everything a preview timeline references (the preview never downloads anything).
class NativePreviewMedia {
  const NativePreviewMedia({
    this.assetPaths = const {},
    this.proxyPaths = const {},
    this.overlayPaths = const {},
    this.musicPaths = const {},
    this.sfxPaths = const {},
    this.fontPaths = const {},
    this.watermarkPath,
  });

  final Map<String, String> assetPaths, proxyPaths, overlayPaths, musicPaths, sfxPaths, fontPaths;
  final String? watermarkPath;

  Map<String, Object?> toArgs() => {
        'assetPaths': assetPaths,
        'proxyPaths': proxyPaths,
        'overlayPaths': overlayPaths,
        'musicPaths': musicPaths,
        'sfxPaths': sfxPaths,
        'fontPaths': fontPaths,
        'watermarkPath': watermarkPath,
      };
}

/// The timeline the native preview plays: [ir] with every item whose file is not on this phone left out (B-roll
/// still downloading, stock music not yet resolved), plus the files it needs. Overlapping cutaways are shortened
/// as the export does. [assetPath] resolves a clip / recording asset id, [localPath] an overlay / music / sfx source.
({Map<String, dynamic> json, NativePreviewMedia media, List<String> leftOut}) nativePreviewTimeline(
  MobileEditIr ir, {
  required String? Function(String assetId) assetPath,
  required String? Function(Map<String, dynamic> source) localPath,
  Map<String, String> proxyPaths = const {},
  Map<String, String> fontPaths = const {},
  bool Function(String path)? exists,
}) {
  bool ok(String? p) => p != null && p.isNotEmpty && (exists?.call(p) ?? true);
  final leftOut = <String>[];
  var working = ir;
  final overlayPaths = <String, String>{};
  for (final o in ir.overlays) {
    final p = o.source['kind'] == 'asset' && o.source['assetId'] == 'primary' ? assetPath('primary') : localPath(o.source);
    if (ok(p)) {
      overlayPaths[o.id] = p!;
    } else {
      leftOut.add(o.id);
      working = TimelineOps.removeOverlay(working, o.id);
    }
  }
  working = TimelineOps.resolveCutawayOverlaps(working).$1;

  final assetPaths = <String, String>{};
  for (final id in {...working.clips.map((c) => c.assetId), ...working.audio.voiceovers.map((v) => v.assetId)}) {
    final p = assetPath(id);
    if (ok(p)) assetPaths[id] = p!;
  }
  final json = working.toJson();
  final audio = Map<String, dynamic>.from(json['audio'] as Map);
  final musicPaths = <String, String>{};
  final sfxPaths = <String, String>{};
  List<dynamic> keep(String key, bool Function(Map<String, dynamic>) has) {
    final out = <dynamic>[];
    for (final raw in (audio[key] as List?) ?? const []) {
      if (raw is Map && has(raw.cast<String, dynamic>())) {
        out.add(raw);
      } else {
        leftOut.add('${raw is Map ? raw['id'] : raw}');
      }
    }
    return out;
  }

  for (final m in working.audio.music) {
    final p = localPath(m.source);
    if (ok(p)) musicPaths[m.id] = p!;
  }
  for (final s in working.audio.sfx) {
    final p = localPath(s.source);
    if (ok(p)) sfxPaths[s.id] = p!;
  }
  audio['music'] = keep('music', (m) => musicPaths.containsKey(m['id']));
  if (audio.containsKey('sfx')) audio['sfx'] = keep('sfx', (s) => sfxPaths.containsKey(s['id']));
  if (audio.containsKey('voiceovers')) {
    audio['voiceovers'] = keep('voiceovers', (v) => assetPaths.containsKey(((v['source'] as Map?) ?? const {})['assetId']));
  }
  json['audio'] = audio;

  String? watermarkPath;
  final wm = working.watermark;
  if (wm != null) {
    final p = ok(wm.localPath) ? wm.localPath : localPath({'kind': 'url', 'url': wm.imageUrl});
    if (ok(p)) {
      watermarkPath = p;
    } else {
      json.remove('watermark');
      leftOut.add('watermark');
    }
  }
  return (
    json: json,
    media: NativePreviewMedia(
      assetPaths: assetPaths,
      proxyPaths: {for (final e in proxyPaths.entries) if (assetPaths.containsKey(e.key) && ok(e.value)) e.key: e.value},
      overlayPaths: overlayPaths,
      musicPaths: musicPaths,
      sfxPaths: sfxPaths,
      fontPaths: fontPaths,
      watermarkPath: watermarkPath,
    ),
    leftOut: leftOut,
  );
}

/// Talks to one native preview view: timeline updates, transport, and the playback position it reports back.
class NativePreviewController extends ChangeNotifier {
  MethodChannel? _channel;
  Map<String, Object?>? _pendingTimeline;
  String? _lastTimelineKey;

  /// Last position the player reported, timeline ms.
  int positionMs = 0;
  bool playing = false;
  int durationMs = 0;

  /// What the native composition simplified or left out (render warnings) for the current timeline.
  List<String> warnings = const [];

  /// Last native error (bad timeline, missing file, playback failure); cleared by the next good timeline.
  String? error;

  /// Called for every position report (about every 50 ms while playing, and on each state change).
  void Function(int ms, bool playing)? onPosition;

  bool get attached => _channel != null;

  void _attach(int viewId) {
    final ch = MethodChannel('$_channelPrefix$viewId');
    _channel = ch;
    ch.setMethodCallHandler(_onNative);
    final pending = _pendingTimeline;
    _pendingTimeline = null;
    if (pending != null) ch.invokeMethod<void>('setTimeline', pending);
  }

  Future<dynamic> _onNative(MethodCall call) async {
    final a = (call.arguments as Map?)?.cast<String, dynamic>() ?? const {};
    switch (call.method) {
      case 'position':
        positionMs = (a['ms'] as num?)?.toInt() ?? positionMs;
        playing = a['playing'] == true;
        onPosition?.call(positionMs, playing);
      case 'timeline':
        durationMs = (a['durationMs'] as num?)?.toInt() ?? durationMs;
        warnings = [for (final w in (a['warnings'] as List?) ?? const []) '$w'];
        error = null;
        notifyListeners();
      case 'error':
        error = '${a['message'] ?? a['code'] ?? 'Preview failed'}';
        notifyListeners();
    }
    return null;
  }

  /// Sends the timeline (native side debounces ~150 ms and keeps the playhead). Identical timelines are skipped.
  void setTimeline(Map<String, dynamic> editIrJson, NativePreviewMedia media) {
    final encoded = jsonEncode(editIrJson);
    final args = {'editIrJson': encoded, ...media.toArgs()};
    final key = '$encoded|${jsonEncode(media.toArgs())}';
    if (key == _lastTimelineKey) return;
    _lastTimelineKey = key;
    final ch = _channel;
    if (ch == null) {
      _pendingTimeline = args;
    } else {
      ch.invokeMethod<void>('setTimeline', args);
    }
  }

  Future<void> seek(int ms) async {
    positionMs = ms;
    await _channel?.invokeMethod<void>('seek', {'ms': ms});
  }

  Future<void> play() async => _channel?.invokeMethod<void>('play');

  Future<void> pause() async => _channel?.invokeMethod<void>('pause');

  /// Playback volume of the whole composition, 0..1 (muted while a voiceover records).
  Future<void> setVolume(double volume) async => _channel?.invokeMethod<void>('setVolume', {'volume': volume.clamp(0.0, 1.0)});

  @override
  void dispose() {
    _channel?.setMethodCallHandler(null);
    _channel = null;
    super.dispose();
  }
}

/// The native composition preview (Android platform view hosting a CompositionPlayer on a SurfaceView). Hybrid
/// composition, so Flutter widgets drawn above it (text handles, chips) stay on top and receive the touches.
class NativeCompositionPreview extends StatelessWidget {
  const NativeCompositionPreview({super.key, required this.controller});
  final NativePreviewController controller;

  @override
  Widget build(BuildContext context) => PlatformViewLink(
        viewType: _viewType,
        surfaceFactory: (context, view) => AndroidViewSurface(
          controller: view as AndroidViewController,
          gestureRecognizers: const <Factory<OneSequenceGestureRecognizer>>{},
          hitTestBehavior: PlatformViewHitTestBehavior.transparent,
        ),
        onCreatePlatformView: (params) => PlatformViewsService.initExpensiveAndroidView(
          id: params.id,
          viewType: _viewType,
          layoutDirection: TextDirection.ltr,
          creationParamsCodec: const StandardMessageCodec(),
          onFocus: () => params.onFocusChanged(true),
        )
          ..addOnPlatformViewCreatedListener(params.onPlatformViewCreated)
          ..addOnPlatformViewCreatedListener(controller._attach)
          ..create(),
      );
}
