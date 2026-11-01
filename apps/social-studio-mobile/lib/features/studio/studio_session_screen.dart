import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart' show DragStartBehavior;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:video_player/video_player.dart';

import '../../core/native_engine/color_grade.dart';
import '../../core/native_engine/edit_ir.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/vault_item.dart';
import '../library/vault_provider.dart';
import 'caption_fonts.dart';
import 'clip_vignette.dart';
import 'director_panel.dart';
import 'export_sheet.dart';
import 'studio_controller.dart';
import 'studio_drafts_service.dart';
import 'studio_timeline.dart';
import 'studio_tools.dart';
import 'text_motion.dart';
import 'layer_placement.dart';
import 'timeline_ops.dart';
import 'video_thumbnails.dart';

String timecode(int ms) {
  final t = ms < 0 ? 0 : ms;
  final m = t ~/ 60000;
  final s = (t ~/ 1000) % 60;
  final f = (t % 1000) ~/ 100;
  return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}.$f';
}

/// The editor: preview, timeline, manual tools and the AI Director on one timeline.
class StudioSessionScreen extends ConsumerStatefulWidget {
  const StudioSessionScreen({
    super.key,
    this.sourcePath,
    this.sourcePaths = const [],
    this.postId,
    this.projectId,
    this.pieceId,
    this.hook,
    this.script,
    this.folderId,
    this.folderName,
    this.draftId,
    this.draft,
  });
  final String? sourcePath;
  /// Several clips opened together (e.g. every take of a calendar piece), in timeline order.
  final List<String> sourcePaths;
  final String? postId;
  final String? projectId;
  final String? pieceId;
  final String? hook;
  final String? script;
  final String? folderId;
  final String? folderName;
  final String? draftId;
  final StudioDraft? draft;

  @override
  ConsumerState<StudioSessionScreen> createState() => _StudioSessionScreenState();
}

class _StudioSessionScreenState extends ConsumerState<StudioSessionScreen> {
  late final StudioController c = StudioController(
    director: ref.read(aiDirectorServiceProvider),
    transcriber: ref.read(transcriptionServiceProvider),
    projectId: widget.projectId,
    postId: widget.postId,
    pieceId: widget.pieceId,
    hook: widget.hook,
    script: widget.script,
    draftId: widget.draftId ?? widget.draft?.id,
  );
  /// Two-slot controller pool for zero-jitter multi-clip transitions and background proxy hot-swapping.
  VideoPlayerController? _slotA;
  VideoPlayerController? _slotB;
  String? _slotAPath;
  String? _slotBPath;
  bool _isSlotAPrimary = true;
  final Map<String, String> _loadedProxyPaths = {};

  VideoPlayerController? get _player => _isSlotAPrimary ? _slotA : _slotB;

  final Map<String, VideoPlayerController> _players = {};
  String _activeAsset = 'primary';
  Object? _loadError;
  bool _loading = false;
  bool _playing = false;
  Timer? _tick;

  /// One audio player per voiceover recording (keyed by asset id), started / stopped as the playhead crosses it.
  final Map<String, VideoPlayerController> _voPlayers = {};
  int _voFrame = 0;

  /// Second player for true crossfades: the other side of the cut, faded over the main picture (as in the export).
  VideoPlayerController? _xfPlayer;
  String? _xfPath;
  ({int clipIndex, int sourceMs, double opacity})? _xf;
  bool _xfBusy = false;
  final Stopwatch _playbackStopwatch = Stopwatch();
  bool _dismissedProposal = false;

  @override
  void initState() {
    super.initState();
    c.addListener(_onChange);
    c.onPreviewPlayback = (play) {
      if (mounted && play != _playing) _togglePlay();
    };
    if (widget.draft != null) {
      _loadDraft(widget.draft!);
    } else if (widget.draftId != null) {
      _loadDraftById(widget.draftId!);
    } else if (widget.sourcePaths.isNotEmpty) {
      _loadMany(widget.sourcePaths);
    } else if (widget.sourcePath != null && widget.sourcePath!.isNotEmpty) {
      _load(widget.sourcePath!);
    } else if (widget.folderId != null) {
      _loadFromFolder(widget.folderId!);
    }
  }

  /// Every video of the folder, in take order (then recording order), one after another on the timeline.
  Future<void> _loadFromFolder(String folderId) async {
    final allItems = ref.read(vaultItemsProvider).valueOrNull ?? [];
    final videos = allItems
        .where((i) => i.folderId == folderId && i.type == VaultItemType.video && (i.localPath?.isNotEmpty ?? false))
        .toList()
      ..sort((a, b) {
        final t = (a.takeIndex ?? 1 << 30).compareTo(b.takeIndex ?? 1 << 30);
        return t != 0 ? t : a.createdAt.compareTo(b.createdAt);
      });
    await _loadMany([for (final v in videos) v.localPath!]);
  }

  /// First path becomes the original video; the rest are appended as clips.
  Future<void> _loadMany(List<String> paths) async {
    if (paths.isEmpty) return;
    await _load(paths.first);
    if (_loadError != null) return;
    for (final path in paths.skip(1)) {
      try {
        await c.addVideoClip(path);
      } catch (e) {
        if (mounted) showError(context, 'One clip could not be added: ${errorText(e)}');
      }
    }
  }

  Future<void> _loadDraft(StudioDraft draft) async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      await c.restoreFromDraft(draft);
      final path = draft.sourcePath;
      if (path.isNotEmpty) {
        await _disposePlayers();
        final previewPath = c.previewPathForAsset('primary') ?? path;
        final p = await _createControllerForPath(previewPath);
        _slotA = p;
        _slotAPath = previewPath;
        _isSlotAPrimary = true;
        _activeAsset = 'primary';
        _players['primary'] = p;
        final initialAsset = c.assetAtPlayhead;
        if (initialAsset != 'primary') {
          await _activateAsset(initialAsset);
        }
        await _player?.seekTo(Duration(milliseconds: c.sourcePositionMs));
      }
    } catch (e) {
      _loadError = e;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _loadDraftById(String draftId) async {
    final d = ref.read(studioDraftsProvider.notifier).getById(draftId);
    if (d != null) {
      await _loadDraft(d);
    } else if (widget.sourcePath != null) {
      await _load(widget.sourcePath!);
    }
  }

  Future<void> _saveDraft({bool popOnSuccess = false}) async {
    String? thumbPath;
    final firstClip = c.ir?.clips.firstOrNull;
    final vidPath = firstClip != null ? (c.sourcePaths[firstClip.assetId] ?? c.sourcePath) : c.sourcePath;
    if (vidPath != null && VideoThumbnails.isLocalVideo(vidPath)) {
      try {
        final at = c.playheadMs > 0 ? c.playheadMs : 1000;
        thumbPath = await VideoThumbnails.frameFor(vidPath, atMs: at);
      } catch (_) {}
    }

    final draft = c.createDraft(thumbnailUrl: thumbPath);
    if (!mounted) return;
    if (draft == null) {
      showError(context, 'No active timeline to save as draft.');
      return;
    }
    await ref.read(studioDraftsProvider.notifier).save(draft);
    if (!mounted) return;
    showInfo(context, 'Draft saved! You can resume from the Studio page.');
    if (popOnSuccess) {
      context.pop();
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    _playbackStopwatch.stop();
    c.removeListener(_onChange);
    c.dispose();
    _disposePlayers();
    for (final p in _voPlayers.values) {
      p.dispose();
    }
    _xfPlayer?.dispose();
    super.dispose();
  }

  /// Loads the crossfade player for [path] ahead of time (muted).
  Future<void> _prepareCrossfade(String path) async {
    if (_xfPath == path) return;
    final old = _xfPlayer;
    _xfPlayer = null;
    _xfPath = path;
    await old?.dispose();
    final p = VideoPlayerController.file(File(path));
    await p.initialize();
    await p.setVolume(0);
    if (!mounted || _xfPath != path) {
      await p.dispose();
      return;
    }
    _xfPlayer = p;
  }

  /// Shows / hides the crossfade layer for the playhead and keeps its player in step (`TimelineOps.crossfadeAt`).
  Future<void> _syncCrossfade() async {
    if (_xfBusy) return;
    _xfBusy = true;
    try {
      final ir = c.ir;
      final xf = ir == null || !_playing ? null : TimelineOps.crossfadeAt(ir, c.playheadMs, isStill: c.isStillAsset);
      if (xf == null) {
        if (_xf != null) {
          _xf = null;
          await _xfPlayer?.pause();
        }
        return;
      }
      final clip = ir!.clips[xf.clipIndex];
      if (!c.isStillAsset(clip.assetId)) {
        final path = c.pathForAsset(clip.assetId);
        if (path == null) return;
        await _prepareCrossfade(path);
        final p = _xfPlayer;
        if (p == null) return;
        if (p.value.playbackSpeed != clip.speed) await p.setPlaybackSpeed(clip.speed);
        if (!p.value.isPlaying || (p.value.position.inMilliseconds - xf.sourceMs).abs() > 150) {
          await p.seekTo(Duration(milliseconds: xf.sourceMs));
          await p.play();
        }
      }
      _xf = xf;
    } finally {
      _xfBusy = false;
    }
  }

  /// Keeps voiceover playback in step with the timeline preview (same volume and fades as the export).
  Future<void> _syncVoiceovers({bool stop = false}) async {
    final ir = c.ir;
    if (ir == null) return;
    for (final v in ir.audio.voiceovers) {
      final path = c.sourcePaths[v.assetId];
      if (path == null) continue;
      final rel = c.playheadMs - v.timelineStartMs;
      final inside = !stop && _playing && rel >= 0 && rel < v.durationMs;
      var p = _voPlayers[v.assetId];
      if (!inside) {
        if (p != null && p.value.isPlaying) await p.pause();
        continue;
      }
      if (p == null) {
        p = VideoPlayerController.file(File(path));
        _voPlayers[v.assetId] = p;
        await p.initialize();
      }
      double ramp(double t, double a, double b) => b <= a ? 1 : ((t - a) / (b - a)).clamp(0.0, 1.0);
      var g = math.pow(10, v.volumeDb / 20).toDouble();
      if (v.fadeInMs > 0) g *= ramp(rel.toDouble(), 0, v.fadeInMs.toDouble());
      if (v.fadeOutMs > 0) g *= 1 - ramp(rel.toDouble(), (v.durationMs - v.fadeOutMs).toDouble(), v.durationMs.toDouble());
      await p.setVolume(g.clamp(0.0, 1.0));
      if (!p.value.isPlaying) {
        await p.seekTo(Duration(milliseconds: v.sourceStartMs + rel));
        await p.play();
      }
    }
  }

  Future<void> _disposePlayers() async {
    final all = [_slotA, _slotB, ..._players.values].whereType<VideoPlayerController>().toSet().toList();
    _players.clear();
    _slotA = null;
    _slotB = null;
    _slotAPath = null;
    _slotBPath = null;
    _isSlotAPrimary = true;
    for (final p in all) {
      await p.dispose();
    }
  }

  Future<VideoPlayerController> _createControllerForPath(String path) async {
    final remote = kIsWeb || path.startsWith('http://') || path.startsWith('https://');
    final p = remote
        ? VideoPlayerController.networkUrl(Uri.parse(path))
        : VideoPlayerController.file(File(path));
    await p.initialize();
    return p;
  }

  String? get _activeSlotPath => _isSlotAPrimary ? _slotAPath : _slotBPath;

  Future<VideoPlayerController?> _ensureActiveSlot(String path) async {
    if (_isSlotAPrimary) {
      if (_slotA != null && _slotAPath == path && _slotA!.value.isInitialized) {
        return _slotA;
      }
      final old = _slotA;
      final p = await _createControllerForPath(path);
      if (!mounted) {
        await p.dispose();
        return null;
      }
      _slotA = p;
      _slotAPath = path;
      await old?.dispose();
      return p;
    } else {
      if (_slotB != null && _slotBPath == path && _slotB!.value.isInitialized) {
        return _slotB;
      }
      final old = _slotB;
      final p = await _createControllerForPath(path);
      if (!mounted) {
        await p.dispose();
        return null;
      }
      _slotB = p;
      _slotBPath = path;
      await old?.dispose();
      return p;
    }
  }

  /// Shows the video of [assetId] in the preview (lazy-initialises its player).
  Future<void> _activateAsset(String assetId) async {
    final path = c.previewPathForAsset(assetId);
    if (path == null || path.isEmpty) return;
    if (_activeAsset == assetId && _player != null && _activeSlotPath == path) return;
    final p = await _ensureActiveSlot(path);
    if (p == null || !mounted) return;
    setState(() {
      _activeAsset = assetId;
    });
  }

  void _checkProxyHotSwap() {
    for (final entry in c.proxyPaths.entries) {
      final assetId = entry.key;
      final proxyPath = entry.value;
      if (_loadedProxyPaths[assetId] == proxyPath) continue;
      _loadedProxyPaths[assetId] = proxyPath;
      unawaited(_hotSwapProxy(assetId, proxyPath));
    }
  }

  /// Swaps a slot playing the full-resolution file of [assetId] to its 720p proxy at the same position, speed and
  /// play state. The export keeps reading the original (StudioController._assetPathForExport).
  Future<void> _hotSwapProxy(String assetId, String proxyPath) async {
    if (!mounted) return;
    final originalPath = c.sourcePaths[assetId == 'primary' ? 'main' : assetId] ?? c.sourcePaths[assetId];
    if (originalPath == null) return;

    Future<VideoPlayerController?> swap(VideoPlayerController old, bool active) async {
      final VideoPlayerController next;
      try {
        next = VideoPlayerController.file(File(proxyPath));
        await next.initialize();
        await next.setPlaybackSpeed(old.value.playbackSpeed);
        await next.setVolume(old.value.volume);
        await next.seekTo(old.value.position);
        if (active && _playing && old.value.isPlaying) await next.play();
      } catch (_) {
        return null; // keep the full-resolution player; the proxy is only an optimisation
      }
      if (!mounted) {
        await next.dispose();
        return null;
      }
      return next;
    }

    final replaced = <VideoPlayerController, VideoPlayerController>{};
    final a = _slotA;
    if (a != null && _slotAPath == originalPath) {
      final next = await swap(a, _isSlotAPrimary);
      if (next != null && identical(_slotA, a)) {
        setState(() {
          _slotA = next;
          _slotAPath = proxyPath;
        });
        replaced[a] = next;
      }
    }
    final b = _slotB;
    if (b != null && _slotBPath == originalPath) {
      final next = await swap(b, !_isSlotAPrimary);
      if (next != null && identical(_slotB, b)) {
        setState(() {
          _slotB = next;
          _slotBPath = proxyPath;
        });
        replaced[b] = next;
      }
    }
    // `_players` may hold the very controller a slot used: point it at the replacement instead of disposing twice.
    _players.updateAll((_, v) => replaced[v] ?? v);
    for (final old in replaced.keys) {
      await old.pause();
      await old.dispose();
    }
  }

  void _onChange() {
    if (!mounted) return;
    _checkProxyHotSwap();
    setState(() {});
    if (_playing) return;
    final asset = c.assetAtPlayhead;
    if (c.isStillAsset(asset)) return; // stills are drawn from the file, no player
    final path = c.previewPathForAsset(asset);
    if (path != null) {
      _ensureActiveSlot(path).then((p) {
        if (p == null || !mounted || _playing) return;
        if (_activeAsset != asset) setState(() => _activeAsset = asset);
        // Only seek when the frame shown is not already the one under the playhead (a drag on the preview notifies
        // every frame without moving the playhead).
        final target = c.sourcePositionMs;
        if ((p.value.position.inMilliseconds - target).abs() > 20) p.seekTo(Duration(milliseconds: target));
      });
    }
  }

  Future<void> _load(String path) async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      await c.load(path);
      await _disposePlayers();
      final previewPath = c.previewPathForAsset('primary') ?? path;
      final p = await _createControllerForPath(previewPath);
      _slotA = p;
      _slotAPath = previewPath;
      _isSlotAPrimary = true;
      _activeAsset = 'primary';
      _players['primary'] = p;
    } catch (e) {
      _loadError = e;
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _pick() async {
    final f = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (f != null) await _load(f.path);
  }

  Future<void> _prewarmNextSlot(int nextIndex) async {
    final ir = c.ir;
    if (ir == null || nextIndex >= ir.clips.length || !_playing || !mounted) return;
    final nextClip = ir.clips[nextIndex];
    if (c.isStillAsset(nextClip.assetId)) return;
    final nextPath = c.previewPathForAsset(nextClip.assetId);
    if (nextPath == null || nextPath.isEmpty) return;

    if (_isSlotAPrimary) {
      if (_slotB == null || _slotBPath != nextPath || !_slotB!.value.isInitialized) {
        final old = _slotB;
        final p = await _createControllerForPath(nextPath);
        if (!mounted || !_playing) {
          await p.dispose();
          return;
        }
        _slotB = p;
        _slotBPath = nextPath;
        await old?.dispose();
      }
      if (_slotB != null && mounted && _playing) {
        await _slotB!.setVolume(0);
        await _slotB!.setPlaybackSpeed(nextClip.speed);
        await _slotB!.seekTo(Duration(milliseconds: nextClip.sourceStartMs));
        await _slotB!.pause();
      }
    } else {
      if (_slotA == null || _slotAPath != nextPath || !_slotA!.value.isInitialized) {
        final old = _slotA;
        final p = await _createControllerForPath(nextPath);
        if (!mounted || !_playing) {
          await p.dispose();
          return;
        }
        _slotA = p;
        _slotAPath = nextPath;
        await old?.dispose();
      }
      if (_slotA != null && mounted && _playing) {
        await _slotA!.setVolume(0);
        await _slotA!.setPlaybackSpeed(nextClip.speed);
        await _slotA!.seekTo(Duration(milliseconds: nextClip.sourceStartMs));
        await _slotA!.pause();
      }
    }
  }

  /// Plays the edited timeline clip by clip; a clip from another file switches the preview to that file's player.
  void _togglePlay() {
    final ir = c.ir;
    if (_player == null || ir == null) return;
    if (_playing) {
      _tick?.cancel();
      _playbackStopwatch.stop();
      _slotA?.pause();
      _slotB?.pause();
      setState(() => _playing = false);
      unawaited(_syncVoiceovers(stop: true));
      unawaited(_syncCrossfade());
      return;
    }
    if (c.playheadMs >= ir.durationMs - 50) c.seek(0);
    setState(() => _playing = true);
    _playClip(TimelineOps.clipIndexAt(ir, c.playheadMs), fromSourceMs: c.sourcePositionMs);
  }

  Future<void> _playClip(int clipIndex, {int? fromSourceMs}) async {
    _tick?.cancel();
    final ir = c.ir;
    if (ir == null || !_playing || !mounted) return;
    if (clipIndex >= ir.clips.length) {
      _playbackStopwatch.stop();
      _slotA?.pause();
      _slotB?.pause();
      unawaited(_syncVoiceovers(stop: true));
      c.seek(ir.durationMs);
      setState(() => _playing = false);
      return;
    }
    final clip = ir.clips[clipIndex];
    if (c.isStillAsset(clip.assetId)) {
      // A still has no player: hold it for its length, then carry on.
      _slotA?.pause();
      _slotB?.pause();
      final from = (c.playheadMs >= clip.timelineStartMs && c.playheadMs < clip.timelineEndMs) ? c.playheadMs : clip.timelineStartMs;
      final sw = Stopwatch()..start();
      _tick = Timer.periodic(const Duration(milliseconds: 16), (_) {
        if (!mounted || !_playing) return;
        final now = from + sw.elapsedMilliseconds;
        if (now >= clip.timelineEndMs) {
          _tick?.cancel();
          c.playheadMs = clip.timelineEndMs;
          _playClip(clipIndex + 1);
          return;
        }
        c.playheadMs = now;
        final cur = c.ir;
        if (_voFrame++ % 6 == 0 && cur != null && cur.audio.voiceovers.isNotEmpty) unawaited(_syncVoiceovers());
        setState(() {});
      });
      return;
    }

    final activePath = c.previewPathForAsset(clip.assetId);
    if (activePath == null || activePath.isEmpty) return;
    final p = await _ensureActiveSlot(activePath);
    if (p == null || !_playing || !mounted) return;
    _activeAsset = clip.assetId;

    // Load the other side of an upcoming crossfade before its window starts.
    final next = clipIndex + 1 < ir.clips.length ? ir.clips[clipIndex + 1] : null;
    if (next?.transitionIn != null && !c.isStillAsset(next!.assetId)) {
      final path = c.pathForAsset(next.assetId);
      if (path != null) unawaited(_prepareCrossfade(path));
    }

    final startMs = fromSourceMs ?? clip.sourceStartMs;
    await p.seekTo(Duration(milliseconds: startMs));
    await p.setPlaybackSpeed(clip.speed);
    final rel0 = (((startMs) - clip.sourceStartMs) / clip.speed).round();
    await p.setVolume(c.recordingVoiceover ? 0 : TimelineOps.clipPreviewGain(ir, clipIndex, rel0));
    await p.play();

    _playbackStopwatch.reset();
    _playbackStopwatch.start();

    // Pre-warm the inactive slot for the next clip
    unawaited(_prewarmNextSlot(clipIndex + 1));

    _startClipPlaybackLoop(clipIndex, startMs);
  }

  void _startClipPlaybackLoop(int clipIndex, int startMs) {
    _tick?.cancel();
    final p = _player;
    if (p == null) return;

    _tick = Timer.periodic(const Duration(milliseconds: 16), (_) {
      final cur = c.ir;
      if (cur == null || !mounted || clipIndex >= cur.clips.length) return;
      final cl = cur.clips[clipIndex];

      // High-precision timing via Stopwatch, calibrated with player position to prevent drift
      final elapsedMs = _playbackStopwatch.elapsedMilliseconds;
      final expectedSourceMs = startMs + (elapsedMs * cl.speed).round();
      final playerPosMs = p.value.position.inMilliseconds;
      final drift = (playerPosMs - expectedSourceMs).abs();
      final effectiveSourceMs = drift > 150 ? playerPosMs : expectedSourceMs;

      if (effectiveSourceMs >= cl.sourceEndMs - 20) {
        _tick?.cancel();
        _playbackStopwatch.stop();
        final nextIdx = clipIndex + 1;
        if (nextIdx < cur.clips.length) {
          c.playheadMs = cur.clips[nextIdx].timelineStartMs;
          final nextCl = cur.clips[nextIdx];
          final nextSlot = _isSlotAPrimary ? _slotB : _slotA;
          final prevSlot = _isSlotAPrimary ? _slotA : _slotB;

          // Only swap to a slot that was pre-warmed for THIS clip (right file, parked at its in-point); otherwise
          // fall back to loading it, rather than showing the wrong footage after the cut.
          final nextSlotPath = _isSlotAPrimary ? _slotBPath : _slotAPath;
          final ready = nextSlot != null &&
              nextSlot.value.isInitialized &&
              !c.isStillAsset(nextCl.assetId) &&
              nextSlotPath == c.previewPathForAsset(nextCl.assetId) &&
              (nextSlot.value.position.inMilliseconds - nextCl.sourceStartMs).abs() < 250;
          if (ready) {
            // Instantaneous zero-latency swap between slot A and slot B!
            _isSlotAPrimary = !_isSlotAPrimary;
            prevSlot?.pause();
            nextSlot.setPlaybackSpeed(nextCl.speed);
            nextSlot.setVolume(c.recordingVoiceover ? 0 : TimelineOps.clipPreviewGain(cur, nextIdx, 0));
            nextSlot.play();
            _activeAsset = nextCl.assetId;
            _playbackStopwatch.reset();
            _playbackStopwatch.start();
            _startClipPlaybackLoop(nextIdx, nextCl.sourceStartMs);
            unawaited(_prewarmNextSlot(nextIdx + 1));
            setState(() {});
            return;
          }
        }
        _playClip(nextIdx);
        return;
      }
      c.playheadMs = cl.timelineStartMs + ((effectiveSourceMs - cl.sourceStartMs).clamp(0, cl.sourceEndMs) / cl.speed).round();
      // Volume, clip fades and transition fades, as in the export.
      // Footage sound is muted while a voiceover records, so the microphone does not pick it up.
      p.setVolume(c.recordingVoiceover ? 0 : TimelineOps.clipPreviewGain(cur, clipIndex, c.playheadMs - cl.timelineStartMs));
      if (_voFrame++ % 6 == 0 && cur.audio.voiceovers.isNotEmpty) unawaited(_syncVoiceovers());
      unawaited(_syncCrossfade());
      setState(() {});
    });
  }

  void _stop() {
    if (_playing) _togglePlay();
  }

  /// Applies a manual edit; an invalid one changes nothing and says why. True when it was applied.
  bool _edit(MobileEditIr Function(MobileEditIr) op, {String? done}) {
    _stop();
    try {
      c.apply(op);
    } catch (e) {
      if (mounted) showError(context, e);
      return false;
    }
    if (done != null && mounted) showInfo(context, done);
    return true;
  }

  Future<void> _openTool(StudioTool tool) async {
    _stop();
    if (tool == StudioTool.director) {
      await showModalBottomSheet<void>(
        context: context,
    useRootNavigator: true,
        isScrollControlled: true,
        backgroundColor: AppTheme.surface,
        builder: (_) => DirectorPanel(controller: c),
      );
      return;
    }
    await showStudioTool(context, tool, c, onEdit: _edit);
  }

  Future<void> _promptLeaveOrSave() async {
    if (!c.canUndo && c.ir != null) {
      context.pop();
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
    useRootNavigator: true,
      backgroundColor: AppTheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(20, 20, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.bookmark_add_rounded, color: AppTheme.primary, size: 24),
                ),
                SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Save your draft?', style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                    SizedBox(height: 2),
                    Text('Resume editing from where you left off on Studio.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ]),
                ),
              ]),
              SizedBox(height: 20),
              FilledButton.icon(
                icon: Icon(Icons.bookmark_added_rounded),
                label: Text('Save as Draft & Leave'),
                onPressed: () async {
                  Navigator.pop(ctx);
                  await _saveDraft(popOnSuccess: true);
                },
              ),
              SizedBox(height: 10),
              OutlinedButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  context.pop();
                },
                style: OutlinedButton.styleFrom(foregroundColor: AppTheme.error),
                child: Text('Discard Edits & Leave'),
              ),
              SizedBox(height: 4),
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text('Keep Editing', style: TextStyle(color: AppTheme.textSecondary)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  int? get _unappliedProposalIndex {
    if (_dismissedProposal) return null;
    for (var i = c.messages.length - 1; i >= 0; i--) {
      final m = c.messages[i];
      if (!m.fromUser && m.response != null && !m.applied) {
        return i;
      }
    }
    return null;
  }

  Widget _buildProposalBanner(BuildContext context, int index) {
    final msg = c.messages[index];
    final reply = msg.response?.reply ?? msg.text;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.auto_awesome, color: AppTheme.primary, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              reply.isNotEmpty ? reply : 'AI Director prepared a brand-conscious cut for this script.',
              style: TextStyle(fontSize: 12, color: AppTheme.textPrimary, height: 1.3),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.tonal(
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              minimumSize: const Size(0, 32),
              visualDensity: VisualDensity.compact,
            ),
            onPressed: () {
              c.applyProposal(index);
              setState(() {});
            },
            child: const Text('Apply', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 4),
          IconButton(
            icon: Icon(Icons.close, size: 16, color: AppTheme.textSecondary),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 24, minHeight: 24),
            onPressed: () {
              setState(() => _dismissedProposal = true);
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ir = c.ir;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _promptLeaveOrSave();
      },
      child: Scaffold(
        backgroundColor: AppTheme.background,
        appBar: AppBar(
          backgroundColor: AppTheme.surface,
          leading: IconButton(
            icon: Icon(Icons.arrow_back),
            onPressed: _promptLeaveOrSave,
          ),
          title: Text('Studio'),
          actions: [
            IconButton(
              tooltip: 'Undo',
              onPressed: c.canUndo
                  ? () {
                      _stop();
                      c.undo();
                    }
                  : null,
              icon: Icon(Icons.undo_rounded),
            ),
            IconButton(
              tooltip: 'Redo',
              onPressed: c.canRedo
                  ? () {
                      _stop();
                      c.redo();
                    }
                  : null,
              icon: Icon(Icons.redo_rounded),
            ),
            if (ir != null)
              TextButton.icon(
                onPressed: () => _saveDraft(),
                icon: Icon(Icons.bookmark_border_rounded, size: 18),
                label: Text('Save Draft'),
              ),
            Padding(
              padding: EdgeInsets.only(right: 8),
              child: FilledButton(
                onPressed: ir == null
                    ? null
                    : () {
                        _stop();
                        showExportSheet(context, c);
                      },
                child: Text('Export'),
              ),
            ),
          ],
        ),
        body: _loading
            ? LoadingView(label: 'Opening video…')
            : ir == null
                ? _Empty(error: _loadError, onPick: _pick, onRecord: () => context.pushReplacement(
                    '/camera?projectId=${widget.projectId ?? ''}&postId=${widget.postId ?? ''}'))
                : Column(children: [
                    if (_unappliedProposalIndex case final idx?)
                      _buildProposalBanner(context, idx),
                    if (c.mediaDownload case final dl?)
                      _MediaDownloadBanner(state: dl, onRetry: () => c.prefetchRemoteMedia(), onDismiss: c.dismissMediaDownload),
                    Expanded(
                      child: _Preview(
                        controller: c,
                        player: _player,
                        crossfade: _xf == null ? null : (player: _xfPlayer, clipIndex: _xf!.clipIndex, opacity: _xf!.opacity),
                        playing: _playing,
                        onOpenTool: _openTool,
                        onEdit: _edit,
                      ),
                    ),
                    _TransportBar(controller: c, playing: _playing, onPlay: _togglePlay, onSplit: () => _edit((ir) => TimelineOps.split(ir, c.playheadMs))),
                    _TranscriptChip(controller: c),
                    StudioTimeline(
                      controller: c,
                      onScrub: (ms) {
                        _stop();
                        c.seek(ms);
                      },
                      onEdit: _edit,
                      onOpenTool: _openTool,
                    ),
                    if (c.selectedClip case final sel? when sel < ir.clips.length)
                      _ClipActions(
                        index: sel,
                        count: ir.clips.length,
                        onTool: _openTool,
                        onSplit: () => _edit((ir) => TimelineOps.split(ir, c.playheadMs)),
                        onMove: (to) {
                          if (_edit((ir) => TimelineOps.moveClip(ir, sel, to))) c.select(to);
                        },
                        onClose: () => c.select(null),
                      ),
                    _ToolBar(onTool: (t) {
                      // The toolbar's Text button adds a new title; tapping a text on the preview or timeline edits it.
                      if (t == StudioTool.text) c.clearItemSelection();
                      _openTool(t);
                    }),
                  ]),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.error, required this.onPick, required this.onRecord});
  final Object? error;
  final VoidCallback onPick;
  final VoidCallback onRecord;

  @override
  Widget build(BuildContext context) => Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (error != null) ...[ErrorView(error: error!, compact: true), SizedBox(height: 16)],
            Icon(Icons.movie_edit, size: 48, color: AppTheme.textSecondary),
            SizedBox(height: 12),
            Text('Choose a video to edit', style: Theme.of(context).textTheme.titleLarge),
            SizedBox(height: 20),
            FilledButton.icon(onPressed: onPick, icon: Icon(Icons.video_library_rounded), label: Text('Choose from gallery')),
            SizedBox(height: 8),
            OutlinedButton.icon(onPressed: onRecord, icon: Icon(Icons.videocam_rounded), label: Text('Record with teleprompter')),
          ]),
        ),
      );
}

/// Source frame at the playhead, cropped/letterboxed like the export, with text and zoom
/// indicators. It is a guide, not a frame-accurate render: Export produces the real video.
class _Preview extends StatelessWidget {
  const _Preview({
    required this.controller,
    required this.player,
    this.crossfade,
    required this.playing,
    required this.onOpenTool,
    required this.onEdit,
  });

  final StudioController controller;
  final VideoPlayerController? player;

  /// The other side of a crossfade, drawn over the picture at [opacity] (same look as its clip).
  final ({VideoPlayerController? player, int clipIndex, double opacity})? crossfade;
  final bool playing;
  final ValueChanged<StudioTool> onOpenTool;
  final EditFn onEdit;

  @override
  Widget build(BuildContext context) {
    final ir = controller.ir!;
    final clip = ir.clips[TimelineOps.clipIndexAt(ir, controller.playheadMs)];
    final t = controller.playheadMs;
    final captions = ir.captions.where((c) => t >= c.startMs && t < c.endMs).toList();
    final zoom = ir.zooms.where((z) => t >= z.startMs && t < z.endMs).firstOrNull;
    // Every overlay active at the playhead, stacked in timeline order like the export (last = on top).
    final brolls = ir.overlays.where((o) => t >= o.timelineStartMs && t < o.timelineEndMs).toList();
    final broll = brolls.lastOrNull;
    final p = player;
    final canvasAspect = ir.canvas.width / ir.canvas.height;
    final stillPath = !kIsWeb && controller.isStillAsset(clip.assetId) ? controller.pathForAsset(clip.assetId) : null;
    final stillSrc = ir.sources.where((s) => s.assetId == clip.assetId).firstOrNull;
    Widget base() => _CroppedVideo(
          player: p,
          clip: clip,
          filter: clip.filter,
          stillPath: stillPath,
          stillSize: stillPath == null ? null : Size((stillSrc?.width ?? 1080).toDouble(), (stillSrc?.height ?? 1920).toDouble()),
        );

    return Container(
      color: AppTheme.background,
      padding: EdgeInsets.all(12),
      child: Center(
        child: AspectRatio(
          aspectRatio: canvasAspect,
          child: ClipRect(
            child: Container(
              color: _hex(ir.canvas.background),
              child: Stack(fit: StackFit.expand, children: [
                // Base primary video
                if (stillPath != null || (p != null && p.value.isInitialized))
                  Transform.scale(
                    scale: zoom?.scale ?? 1,
                    alignment: Alignment(((zoom?.centerX ?? 0.5) * 2) - 1, ((zoom?.centerY ?? 0.5) * 2) - 1),
                    child: Stack(fit: StackFit.expand, children: [
                      base(),
                      if ((clip.filter?.vignette ?? 0) > 0) ClipVignette(strength: clip.filter!.vignette),
                      if (crossfade case final xf? when xf.clipIndex < ir.clips.length)
                        () {
                          final other = ir.clips[xf.clipIndex];
                          final otherStill = !kIsWeb && controller.isStillAsset(other.assetId) ? controller.pathForAsset(other.assetId) : null;
                          final otherSrc = ir.sources.where((s) => s.assetId == other.assetId).firstOrNull;
                          if (otherStill == null && (xf.player == null || !xf.player!.value.isInitialized)) return const SizedBox.shrink();
                          return Opacity(
                            opacity: xf.opacity.clamp(0.0, 1.0),
                            child: Stack(fit: StackFit.expand, children: [
                              _CroppedVideo(
                                player: xf.player,
                                clip: other,
                                filter: other.filter,
                                stillPath: otherStill,
                                stillSize: otherStill == null ? null : Size((otherSrc?.width ?? 1080).toDouble(), (otherSrc?.height ?? 1920).toDouble()),
                              ),
                              if ((other.filter?.vignette ?? 0) > 0) ClipVignette(strength: other.filter!.vignette),
                            ]),
                          );
                        }(),
                    ]),
                  ),

                // B-roll Video or Image Overlay
                for (final o in brolls)
                  if (o.isImage)
                    _BrollOverlayImage(
                      key: ValueKey('ov_${o.id}'),
                      broll: o,
                      playheadMs: t,
                      controller: controller,
                      onTap: () => onOpenTool(StudioTool.broll),
                    )
                  else
                    _BrollOverlayVideo(
                      key: ValueKey('ov_${o.id}'),
                      broll: o,
                      playheadMs: t,
                      playing: playing,
                      controller: controller,
                      onTap: () => onOpenTool(StudioTool.broll),
                    ),
                if (broll != null) ...[

                  // Overlay status chip with mute indicator & shortcut
                  Positioned(
                    top: 8,
                    left: 8,
                    child: InkWell(
                      onTap: () => onOpenTool(StudioTool.broll),
                      borderRadius: BorderRadius.circular(16),
                      child: Container(
                        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.75),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppTheme.accentBlue.withValues(alpha: 0.5)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(broll.isImage ? Icons.photo_rounded : Icons.layers_rounded, size: 14, color: AppTheme.accentBlue),
                            SizedBox(width: 5),
                            ConstrainedBox(
                              constraints: BoxConstraints(maxWidth: 160),
                              child: Text(
                                '${broll.isImage ? 'Photo' : 'B-roll'}: ${broll.source['title'] ?? broll.source['query'] ?? broll.source['kind'] ?? 'Cutaway'}'
                                '${brolls.length > 1 ? ' +${brolls.length - 1}' : ''}',
                                style: TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.w600),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (!broll.isImage && broll.muted) ...[
                              SizedBox(width: 4),
                              Icon(Icons.volume_off_rounded, size: 12, color: AppTheme.warning),
                            ],
                            SizedBox(width: 4),
                            Icon(Icons.tune_rounded, size: 12, color: AppTheme.textMuted),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],

                // Draggable text / captions on top of the preview canvas
                for (final cap in captions)
                  _DraggableCaption(
                    key: ValueKey('cap_${cap.id}'),
                    caption: cap,
                    t: t,
                    canvasWidth: ir.canvas.width,
                    controller: controller,
                    // Tapping a title or a caption edits that one (text, style, timing, position).
                    onTap: () => onOpenTool(StudioTool.text),
                  ),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  static Color _hex(String hex) {
    final h = hex.replaceFirst('#', '');
    final v = int.tryParse(h.length == 6 ? 'FF$h' : h, radix: 16);
    return v == null ? Colors.black : Color(v);
  }
}

/// Photo overlay: a full-frame cutaway, or a layer (PiP / sticker) placed like the export places it.
class _BrollOverlayImage extends StatefulWidget {
  const _BrollOverlayImage({super.key, required this.broll, required this.playheadMs, required this.controller, required this.onTap});
  final EditIrOverlay broll;
  final int playheadMs;
  final StudioController controller;
  final VoidCallback onTap;

  @override
  State<_BrollOverlayImage> createState() => _BrollOverlayImageState();
}

class _BrollOverlayImageState extends State<_BrollOverlayImage> {
  double? _aspect;
  ImageStream? _stream;
  ImageStreamListener? _listener;

  String? _resolvedFor;
  String _sourceKey() => '${widget.broll.source}|${kIsWeb ? '' : widget.controller.localOverlayPath(widget.broll.source) ?? ''}';

  ImageProvider? _provider() {
    // Gallery photos and stickers are files on this phone; stock photos are URLs.
    final local = kIsWeb ? null : widget.controller.localOverlayPath(widget.broll.source);
    if (local != null) return ResizeImage.resizeIfNeeded(1080, null, FileImage(File(local)));
    final url = widget.broll.source['url'] as String?;
    if (url == null || url.isEmpty) return null;
    return ResizeImage.resizeIfNeeded(1080, null, NetworkImage(url));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolve();
  }

  @override
  void didUpdateWidget(covariant _BrollOverlayImage old) {
    super.didUpdateWidget(old);
    // Re-resolve when the source changes or its download finishes (remote URL → cached file).
    if (old.broll.source != widget.broll.source || _resolvedFor != _sourceKey()) _resolve();
  }

  void _resolve() {
    _resolvedFor = _sourceKey();
    final p = _provider();
    if (p == null) return;
    final next = p.resolve(createLocalImageConfiguration(context));
    if (_stream?.key == next.key) return;
    if (_listener != null) _stream?.removeListener(_listener!);
    _listener = ImageStreamListener((info, _) {
      if (mounted) setState(() => _aspect = info.image.width / info.image.height);
    }, onError: (_, _) {});
    _stream = next..addListener(_listener!);
  }

  @override
  void dispose() {
    if (_listener != null) _stream?.removeListener(_listener!);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final broll = widget.broll;
    final provider = _provider();
    if (provider == null) return SizedBox.shrink();
    Widget img(BoxFit fit) => Image(
          image: provider,
          fit: fit,
          errorBuilder: (_, o, s) => Container(color: Colors.black54, child: Icon(Icons.broken_image_rounded, color: AppTheme.textMuted)),
        );
    if (broll.isLayer) {
      return LayerPlacement(
        overlay: broll,
        playheadMs: widget.playheadMs,
        mediaAspect: _aspect ?? 1,
        controller: widget.controller,
        onTap: widget.onTap,
        child: img(BoxFit.fill),
      );
    }
    final content = Opacity(opacity: broll.opacity.clamp(0.05, 1.0), child: img(broll.fit == 'contain' ? BoxFit.contain : BoxFit.cover));
    return GestureDetector(onTap: widget.onTap, child: content);
  }
}

/// Synchronized B-roll Video Player with PiP, framing, cropping, volume and opacity controls
class _BrollOverlayVideo extends StatefulWidget {
  const _BrollOverlayVideo({
    super.key,
    required this.broll,
    required this.playheadMs,
    required this.playing,
    required this.controller,
    required this.onTap,
  });

  final EditIrOverlay broll;
  final int playheadMs;
  final bool playing;
  final StudioController controller;
  final VoidCallback onTap;

  @override
  State<_BrollOverlayVideo> createState() => _BrollOverlayVideoState();
}

class _BrollOverlayVideoState extends State<_BrollOverlayVideo> {
  VideoPlayerController? _controller;
  String? _loadedUrl;
  bool _initializing = false;

  @override
  void initState() {
    super.initState();
    _initPlayer();
  }

  @override
  void didUpdateWidget(_BrollOverlayVideo oldWidget) {
    super.didUpdateWidget(oldWidget);
    final url = _url();
    if (url != _loadedUrl) {
      _initPlayer();
    } else {
      _syncPlayback();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  /// Local file (gallery video) or remote URL for this overlay.
  String? _url() => (kIsWeb ? null : widget.controller.localOverlayPath(widget.broll.source)) ?? widget.broll.source['url'] as String?;

  Future<void> _initPlayer() async {
    final url = _url();
    if (url == null || url.isEmpty) return;
    setState(() {
      _initializing = true;
      _loadedUrl = url;
    });
    await _controller?.dispose();
    try {
      final isNet = url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || kIsWeb;
      final c = isNet
          ? VideoPlayerController.networkUrl(Uri.parse(url))
          : VideoPlayerController.file(File(url));
      await c.initialize();
      c.setLooping(true);
      if (!mounted) {
        await c.dispose();
        return;
      }
      _controller = c;
      _syncPlayback();
    } catch (e) {
      debugPrint('B-roll player error: $e');
    } finally {
      if (mounted) setState(() => _initializing = false);
    }
  }

  void _syncPlayback() {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    c.setVolume(widget.broll.muted ? 0.0 : 1.0);
    final targetMs = (widget.playheadMs - widget.broll.timelineStartMs).clamp(0, widget.broll.timelineEndMs - widget.broll.timelineStartMs) + widget.broll.sourceStartMs;
    final curMs = c.value.position.inMilliseconds;
    if ((curMs - targetMs).abs() > 200) {
      c.seekTo(Duration(milliseconds: targetMs));
    }
    if (widget.playing && !c.value.isPlaying) {
      c.play();
    } else if (!widget.playing && c.value.isPlaying) {
      c.pause();
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    final broll = widget.broll;
    final isPip = broll.isLayer;
    final boxFit = isPip ? BoxFit.fill : (broll.fit == 'contain' ? BoxFit.contain : BoxFit.cover);

    Widget content;
    if (c != null && c.value.isInitialized) {
      content = SizedBox.expand(
        child: FittedBox(
          fit: boxFit,
          clipBehavior: Clip.hardEdge,
          child: SizedBox(
            width: c.value.size.width,
            height: c.value.size.height,
            child: VideoPlayer(c),
          ),
        ),
      );
    } else {
      final thumb = broll.source['thumbnailUrl'] as String?;
      content = thumb != null
          ? Image.network(thumb, cacheWidth: 1080, fit: boxFit, errorBuilder: (_, o, s) => _placeholder())
          : _placeholder();
    }

    if (isPip) {
      final size = c?.value.isInitialized == true ? c!.value.size : null;
      return LayerPlacement(
        overlay: broll,
        playheadMs: widget.playheadMs,
        mediaAspect: size == null || size.height == 0 ? 16 / 9 : size.width / size.height,
        controller: widget.controller,
        onTap: widget.onTap,
        child: content,
      );
    }

    content = Opacity(
      opacity: broll.opacity.clamp(0.05, 1.0),
      child: content,
    );

    return GestureDetector(
      onTap: widget.onTap,
      child: content,
    );
  }

  Widget _placeholder() => Container(
        color: Colors.black87,
        child: Center(
          child: _initializing
              ? SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary))
              : Icon(Icons.movie_rounded, color: AppTheme.textMuted, size: 36),
        ),
      );
}

class _CroppedVideo extends StatelessWidget {
  const _CroppedVideo({this.player, required this.clip, this.filter, this.stillPath, this.stillSize});
  final VideoPlayerController? player;
  final EditIrClip clip;
  final EditIrFilter? filter;

  /// Photo clip / freeze frame shown instead of the player (same crop, rotation and grade as the export).
  final String? stillPath;
  final Size? stillSize;

  @override
  Widget build(BuildContext context) {
    final size = stillSize ?? (player?.value.isInitialized == true ? player!.value.size : const Size(1920, 1080));
    final sideways = clip.rotationDeg == 90 || clip.rotationDeg == 270;
    final srcW = sideways ? size.height : size.width;
    final srcH = sideways ? size.width : size.height;
    final crop = clip.crop ?? EditIrCrop(x: 0, y: 0, width: 1, height: 1);
    Widget video = Transform(
      alignment: Alignment.center,
      transform: Matrix4.identity()
        ..rotateZ(clip.rotationDeg * 3.1415926535 / 180)
        ..scaleByDouble(clip.flipH ? -1.0 : 1.0, 1.0, 1.0, 1.0),
      child: SizedBox(
        width: size.width,
        height: size.height,
        child: stillPath != null
            ? (!kIsWeb ? Image.file(File(stillPath!), fit: BoxFit.fill, gaplessPlayback: true) : const SizedBox.shrink())
            : (player != null && player!.value.isInitialized ? VideoPlayer(player!) : const SizedBox.shrink()),
      ),
    );
    video = SizedBox(width: srcW, height: srcH, child: FittedBox(child: video));
    final f = filter;
    // Same colour matrix as the export (color_grade.dart ⇄ ColorGrade.kt).
    if (f != null && !f.isNeutral) video = ColorFiltered(colorFilter: ColorFilter.matrix(gradeMatrix(f)), child: video);
    // Show only the crop rect, scaled to fill (crop) or fit (no crop) the canvas.
    return FittedBox(
      fit: clip.crop == null ? BoxFit.contain : BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: ClipRect(
        child: SizedBox(
          width: srcW * crop.width,
          height: srcH * crop.height,
          child: OverflowBox(
            alignment: Alignment.topLeft,
            maxWidth: srcW,
            maxHeight: srcH,
            child: Transform.translate(offset: Offset(-srcW * crop.x, -srcH * crop.y), child: video),
          ),
        ),
      ),
    );
  }
}

/// One title / caption as the preview draws it (draggable), on its own for tests.
@visibleForTesting
Widget captionPreviewLayer({
  Key? key,
  required EditIrCaption caption,
  required int t,
  required int canvasWidth,
  required StudioController controller,
  VoidCallback? onTap,
}) =>
    _DraggableCaption(key: key, caption: caption, t: t, canvasWidth: canvasWidth, controller: controller, onTap: onTap ?? () {});

/// CapCut-style draggable text overlay on top of the preview canvas. Laid out like the export: the text block is
/// centred on (positionX, positionY) of the canvas and wraps at maxWidthFraction of its width.
class _DraggableCaption extends StatefulWidget {
  const _DraggableCaption({
    super.key,
    required this.caption,
    required this.t,
    required this.canvasWidth,
    required this.controller,
    required this.onTap,
  });

  final EditIrCaption caption;
  final int t;

  /// Width of the edit canvas in canvas pixels (the unit of fontSizePx, strokeWidthPx and the background box).
  final int canvasWidth;
  final StudioController controller;
  final VoidCallback onTap;

  @override
  State<_DraggableCaption> createState() => _DraggableCaptionState();
}

class _DraggableCaptionState extends State<_DraggableCaption> {
  bool _active = false;

  /// Where the drag started: the finger (global) and the text's position then.
  ({Offset finger, double x, double y})? _dragFrom;

  void _endDrag() {
    _dragFrom = null;
    if (!_active) return;
    setState(() => _active = false);
    // The whole drag is one undo step back to where the text was before it.
    widget.controller.endLiveEdit();
  }

  @override
  void dispose() {
    // Removed mid-drag (e.g. its time range ended): still record the drag as one undo step.
    // After the frame: the tree is locked while widgets are disposed.
    if (_active) scheduleMicrotask(widget.controller.endLiveEdit);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final st = widget.caption.style;
    final posX = (st['positionX'] as num?)?.toDouble() ?? 0.5;
    final posY = (st['positionY'] as num?)?.toDouble() ?? 0.72;
    final maxWidthFraction = ((st['maxWidthFraction'] as num?)?.toDouble() ?? 0.86).clamp(0.1, 1.0);

    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth, h = box.maxHeight;
      if (!w.isFinite || !h.isFinite || w <= 0 || h <= 0) return const SizedBox.shrink();
      // Canvas pixels → preview pixels, exactly as the renderer scales canvas pixels to its frame.
      final scale = EditIrCaption.canvasPxScale(w, widget.canvasWidth);
      return Stack(clipBehavior: Clip.none, children: [
        Positioned(
          left: posX * w,
          top: posY * h,
          child: FractionalTranslation(
            translation: const Offset(-0.5, -0.5),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              // Start at the touch-down point: the text then follows the finger exactly (no lag by the drag slop).
              dragStartBehavior: DragStartBehavior.down,
              onTap: () {
                widget.controller.selectTrackItem(widget.caption.id, widget.caption.kind == 'text' ? TrackKind.text : TrackKind.captions);
                widget.onTap();
              },
              onPanStart: (d) {
                widget.controller.beginLiveEdit();
                _dragFrom = (finger: d.globalPosition, x: posX, y: posY);
                setState(() => _active = true);
              },
              onPanUpdate: (d) {
                final from = _dragFrom;
                if (from == null) return;
                final moved = d.globalPosition - from.finger;
                widget.controller.applyWithoutHistory((ir) => TimelineOps.updateCaptionPosition(
                      ir,
                      widget.caption.id,
                      positionX: (from.x + moved.dx / w).clamp(0.05, 0.95),
                      positionY: (from.y + moved.dy / h).clamp(0.05, 0.95),
                    ));
              },
              onPanEnd: (_) => _endDrag(),
              onPanCancel: _endDrag,
              child: DecoratedBox(
                position: DecorationPosition.foreground,
                decoration: BoxDecoration(
                  border: _active ? Border.all(color: AppTheme.primary, width: 1.5) : null,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: _withMotion(
                  Size(w, h),
                  _CaptionPreview(caption: widget.caption, t: widget.t, scale: scale, maxTextWidth: maxWidthFraction * w),
                ),
              ),
            ),
          ),
        ),
      ]);
    });
  }

  /// In / out / loop motion, identical to the Android renderer (text_motion.dart): moved, then rotated and scaled
  /// about the block's centre.
  Widget _withMotion(Size canvas, Widget child) {
    final m = textMotionAt(widget.caption.style, widget.caption.startMs, widget.caption.endMs, widget.t);
    if (identical(m, TextMotion.none)) return child;
    return Transform.translate(
      offset: Offset(m.dx * canvas.width, m.dy * canvas.height),
      child: Transform.rotate(
        angle: m.rotationDeg * math.pi / 180,
        child: Transform.scale(scale: m.scale, child: Opacity(opacity: m.opacity, child: child)),
      ),
    );
  }
}

/// Contract colour (#RRGGBB or #RRGGBBAA) → Flutter colour, [fallback] when missing or malformed.
Color _contractColor(Object? v, Color fallback) {
  if (v is! String) return fallback;
  final h = v.trim().replaceFirst('#', '');
  if (h.length != 6 && h.length != 8) return fallback;
  final n = int.tryParse(h.length == 6 ? 'FF$h' : h.substring(6) + h.substring(0, 6), radix: 16);
  return n == null ? fallback : Color(n);
}

/// One caption or title drawn like the export (VideoEffects.kt CaptionOverlay): font, size, outline, shadow / glow,
/// background box and per-word highlight / pop / box / reveal. Canvas-pixel sizes are multiplied by [scale].
class _CaptionPreview extends StatelessWidget {
  const _CaptionPreview({required this.caption, required this.t, required this.scale, required this.maxTextWidth});
  final EditIrCaption caption;
  final int t;

  /// Preview pixels per canvas pixel.
  final double scale;

  /// Lines wrap at this width (maxWidthFraction of the preview canvas).
  final double maxTextWidth;

  @override
  Widget build(BuildContext context) {
    final st = caption.style;
    final upper = st['uppercase'] == true;
    final text = _contractColor(st['textColor'], Colors.white);
    final hi = _contractColor(st['highlightColor'], caption.kind == 'text' ? text : const Color(0xFFFFE600));
    final strokeColor = _contractColor(st['strokeColor'], Colors.black);
    final anim = (st['animation'] as String?) ?? (caption.kind == 'text' ? 'none' : 'word_pop');
    final fontSize = math.max(1.0, ((st['fontSizePx'] as num?)?.toDouble() ?? 72) * scale);
    final strokeW = ((st['strokeWidthPx'] as num?)?.toDouble() ?? 0) * scale;
    final bgSpec = st['background'];
    final bg = bgSpec is Map ? _contractColor(bgSpec['color'], const Color(0xB3000000)) : null;
    final bgPad = bgSpec is Map ? ((bgSpec['paddingPx'] as num?)?.toDouble() ?? 16) * scale : 0.0;
    final bgRadius = bgSpec is Map ? ((bgSpec['radiusPx'] as num?)?.toDouble() ?? 16) * scale : 0.0;

    // Typewriter (enter motion): the same character count as the renderer, cut at that point.
    var words = caption.displayWords;
    final reveal = textMotionAt(st, caption.startMs, caption.endMs, t).reveal;
    if (reveal < 1) {
      var left = (words.fold<int>(0, (n, w) => n + (w.text == EditIrCaption.lineBreak ? 0 : w.text.length)) * reveal).ceil();
      final shown = <EditIrWord>[];
      for (final w in words) {
        if (left <= 0) break;
        if (w.text == EditIrCaption.lineBreak) {
          shown.add(w);
          continue;
        }
        final take = math.min(left, w.text.length);
        left -= take;
        shown.add(take == w.text.length
            ? w
            : EditIrWord(text: w.text.substring(0, take), startMs: w.startMs, endMs: w.endMs, highlight: w.highlight, color: w.color, scale: w.scale));
      }
      words = shown;
    }
    if (words.isEmpty) return const SizedBox.shrink();

    bool active(EditIrWord w) => t >= w.startMs && t < w.endMs;
    // Same rules as the renderer's styleFor().
    Color wordColor(EditIrWord w) {
      final activeColor = _contractColor(w.color, hi);
      final resting = w.highlight ? activeColor : text;
      return switch (anim) {
        'word_pop' => active(w) ? activeColor : resting,
        'karaoke' => active(w) ? activeColor : (t >= w.endMs ? hi : resting),
        'word_box' => active(w) ? text : resting,
        'word_reveal' => active(w) ? activeColor : resting,
        _ => resting,
      };
    }

    double pop(EditIrWord w) {
      if (anim != 'word_pop' || !active(w)) return 1;
      final p = ((t - w.startMs) / 120).clamp(0.0, 1.0);
      return 1 + (math.max(1.0, w.scale) - 1) * (1 - math.pow(1 - p, 3));
    }

    // The outline layer and the fill layer share one layout; only the paint differs.
    List<InlineSpan> spans({required bool outline}) {
      final out = <InlineSpan>[];
      for (var i = 0; i < words.length; i++) {
        final w = words[i];
        if (w.text == EditIrCaption.lineBreak) {
          out.add(const TextSpan(text: '\n'));
          continue;
        }
        final hidden = anim == 'word_reveal' && t < w.startMs;
        final label = upper ? w.text.toUpperCase() : w.text;
        final size = fontSize * pop(w);
        final boxed = anim == 'word_box' && active(w) && !outline;
        final Paint? stroke = outline
            ? (Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = strokeW * 2
              ..strokeJoin = StrokeJoin.round
              ..color = hidden ? Colors.transparent : strokeColor)
            : null;
        out.add(TextSpan(
          text: label,
          style: TextStyle(
            fontSize: size,
            color: outline ? null : (hidden ? Colors.transparent : wordColor(w)),
            foreground: stroke,
            background: boxed ? (Paint()..color = _contractColor(w.color, hi)) : null,
            shadows: outline || hidden ? const [] : null,
          ),
        ));
        final next = i + 1 < words.length ? words[i + 1] : null;
        if (next != null && next.text != EditIrCaption.lineBreak) out.add(const TextSpan(text: ' '));
      }
      return out;
    }

    final shadows = <Shadow>[
      if (st['glow'] == true)
        Shadow(blurRadius: fontSize * 0.25, color: hi)
      else if (st['shadow'] != false)
        Shadow(blurRadius: 6 * scale, offset: Offset(0, 4 * scale), color: const Color(0xA0000000)),
    ];
    final base = CaptionFonts.textStyle(st, fontSize: fontSize, shadows: shadows).copyWith(height: 1.1);

    Widget layer({required bool outline}) => Text.rich(
          TextSpan(children: spans(outline: outline)),
          textAlign: TextAlign.center,
          style: outline ? base.copyWith(shadows: const []) : base,
        );

    Widget textBlock = ConstrainedBox(
      constraints: BoxConstraints(maxWidth: math.max(fontSize, maxTextWidth)),
      child: strokeW > 0
          ? Stack(alignment: Alignment.center, children: [layer(outline: true), layer(outline: false)])
          : layer(outline: false),
    );
    if (bg != null) {
      textBlock = Container(
        padding: EdgeInsets.all(bgPad),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(bgRadius)),
        child: textBlock,
      );
    }
    return textBlock;
  }
}

class _TransportBar extends StatelessWidget {
  const _TransportBar({required this.controller, required this.playing, required this.onPlay, required this.onSplit});
  final StudioController controller;
  final bool playing;
  final VoidCallback onPlay;
  final VoidCallback onSplit;

  @override
  Widget build(BuildContext context) {
    final ir = controller.ir!;
    final mono = GoogleFonts.jetBrainsMono(fontSize: 13, color: AppTheme.textPrimary);
    return Container(
      color: AppTheme.surface,
      padding: EdgeInsets.symmetric(horizontal: 8),
      height: 48,
      child: Row(children: [
        IconButton(tooltip: playing ? 'Pause' : 'Play', onPressed: onPlay, icon: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded)),
        Text(timecode(controller.playheadMs), style: mono),
        Text(' / ${timecode(ir.durationMs)}', style: mono.copyWith(color: AppTheme.textMuted)),
        Spacer(),
        Text('${ir.canvas.aspect} · ${ir.clips.length} clip${ir.clips.length == 1 ? '' : 's'}',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
        IconButton(tooltip: 'Split at playhead', onPressed: onSplit, icon: Icon(Icons.content_cut_rounded)),
      ]),
    );
  }
}

class _TranscriptChip extends StatelessWidget {
  const _TranscriptChip({required this.controller});
  final StudioController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final (label, color, icon) = switch (c.transcriptState) {
      TranscriptState.running => ('Transcribing speech…', AppTheme.accentBlue, Icons.graphic_eq_rounded),
      TranscriptState.ready => ('Transcript ready · ${c.words.length} words', AppTheme.success, Icons.check_circle_rounded),
      TranscriptState.failed => ('No transcript: ${errorText(c.transcriptError ?? '')}', AppTheme.warning, Icons.info_rounded),
      TranscriptState.idle => ('', AppTheme.textMuted, Icons.info_rounded),
    };
    if (label.isEmpty) return SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: AppTheme.surface,
      padding: EdgeInsets.fromLTRB(12, 0, 4, 4),
      child: Row(children: [
        Icon(icon, size: 14, color: color),
        SizedBox(width: 6),
        Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: color))),
        if (c.transcriptState == TranscriptState.failed && (c.meta?.hasAudio ?? false))
          TextButton(onPressed: c.transcribe, child: Text('Retry')),
      ]),
    );
  }
}

/// Quick actions for the clip selected on the timeline (CapCut's clip bar): split at the playhead, trim, speed,
/// duplicate, move earlier / later and delete, all on that clip.
class _ClipActions extends StatelessWidget {
  const _ClipActions({
    required this.index,
    required this.count,
    required this.onTool,
    required this.onSplit,
    required this.onMove,
    required this.onClose,
  });
  final int index;
  final int count;
  final ValueChanged<StudioTool> onTool;
  final VoidCallback onSplit;
  final ValueChanged<int> onMove;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    Widget action(String label, IconData icon, VoidCallback? onTap, {Color? color}) => InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 60,
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(icon, size: 20, color: onTap == null ? AppTheme.textMuted : (color ?? AppTheme.textPrimary)),
              SizedBox(height: 2),
              Text(label, maxLines: 1, style: TextStyle(fontSize: 10, color: onTap == null ? AppTheme.textMuted : AppTheme.textSecondary)),
            ]),
          ),
        );
    return Container(
      height: 52,
      decoration: BoxDecoration(color: AppTheme.surfaceElevated, border: Border(top: BorderSide(color: AppTheme.primary.withValues(alpha: 0.5)))),
      child: Row(children: [
        Padding(
          padding: EdgeInsets.only(left: 12, right: 4),
          child: Text('Clip ${index + 1}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.primary)),
        ),
        Expanded(
          child: ListView(scrollDirection: Axis.horizontal, children: [
            action('Split', Icons.content_cut_rounded, onSplit),
            action('Trim', Icons.straighten_rounded, () => onTool(StudioTool.trim)),
            action('Speed', Icons.speed_rounded, () => onTool(StudioTool.speed)),
            action('Copy', Icons.copy_all_rounded, () => onTool(StudioTool.duplicate)),
            action('Earlier', Icons.arrow_back_rounded, index == 0 ? null : () => onMove(index - 1)),
            action('Later', Icons.arrow_forward_rounded, index >= count - 1 ? null : () => onMove(index + 1)),
            action('Delete', Icons.delete_outline_rounded, count < 2 ? null : () => onTool(StudioTool.delete), color: AppTheme.error),
          ]),
        ),
        IconButton(tooltip: 'Deselect clip', onPressed: onClose, icon: Icon(Icons.close_rounded, size: 18)),
      ]),
    );
  }
}

/// Main track as proportional blocks, with caption / zoom / B-roll / music lanes and a scrubber.
class _ToolBar extends StatelessWidget {
  const _ToolBar({required this.onTool});
  final ValueChanged<StudioTool> onTool;

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(color: AppTheme.surface, border: Border(top: BorderSide(color: AppTheme.border))),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 68,
            child: ListView(scrollDirection: Axis.horizontal, padding: EdgeInsets.symmetric(horizontal: 4), children: [
              for (final t in StudioTool.values)
                InkWell(
                  onTap: () => onTool(t),
                  child: SizedBox(
                    width: 64,
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(t.icon, color: t == StudioTool.director ? AppTheme.primary : AppTheme.textPrimary, size: 22),
                      SizedBox(height: 4),
                      Text(t.label, style: TextStyle(fontSize: 10, color: AppTheme.textSecondary), maxLines: 1),
                    ]),
                  ),
                ),
            ]),
          ),
        ),
      );
}

/// Progress of the timeline's online media (Director picks / reopened drafts) and a retry when some failed.
class _MediaDownloadBanner extends StatelessWidget {
  const _MediaDownloadBanner({required this.state, required this.onRetry, required this.onDismiss});
  final ({int done, int total, Map<String, String> failed}) state;
  final VoidCallback onRetry;

  /// Second way out: carry on; the export leaves the missing items out and says which.
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final failed = state.failed;
    final running = state.done < state.total;
    return Container(
      color: failed.isNotEmpty && !running ? AppTheme.error.withValues(alpha: 0.12) : AppTheme.surfaceElevated,
      padding: EdgeInsets.fromLTRB(12, 8, 8, 8),
      child: Row(children: [
        Icon(running ? Icons.cloud_download_rounded : Icons.cloud_off_rounded, size: 20, color: running ? AppTheme.primary : AppTheme.error),
        SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(
              running
                  ? 'Downloading media ${state.done}/${state.total}…'
                  : '${failed.length} item${failed.length == 1 ? '' : 's'} could not be downloaded: ${failed.keys.take(2).join(', ')}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 13),
            ),
            if (running) ...[
              SizedBox(height: 6),
              LinearProgressIndicator(value: state.total == 0 ? null : state.done / state.total),
            ] else
              Text(failed.values.first, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          ]),
        ),
        if (!running && failed.isNotEmpty) ...[
          SizedBox(height: 44, child: TextButton(onPressed: onRetry, child: Text('Retry'))),
          SizedBox(height: 44, child: TextButton(onPressed: onDismiss, child: Text('Continue without'))),
        ],
      ]),
    );
  }
}

