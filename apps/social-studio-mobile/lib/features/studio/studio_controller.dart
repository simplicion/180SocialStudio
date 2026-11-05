import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:video_player/video_player.dart';

import '../../core/media/asset_cache.dart';
import '../../core/native_engine/media_engine_service.dart';
import '../../core/network/api_exception.dart';
import '../../core/network/audio_transcription_service.dart';
import '../director/ai_director_service.dart';
import 'caption_fonts.dart';
import 'caption_languages.dart';
import 'clip_analysis.dart';
import 'sticker_maker.dart';
import 'studio_drafts_service.dart';
import 'timeline_merge.dart';
import 'timeline_ops.dart';

enum TranscriptState { idle, running, ready, failed }

class DirectorMessage {
  DirectorMessage({
    required this.fromUser,
    required this.text,
    this.response,
    this.applied = false,
    this.error,
    this.baseIr,
    this.baseRevision,
    this.prompt,
    this.structuralConflict = false,
    this.appliedIr,
  });
  final bool fromUser;

  /// The timeline right after this turn was applied: when undo leaves it, the turn counts as undone (F-16).
  final MobileEditIr? appliedIr;

  /// The timeline the Director's response was computed from: a response applied after newer edits is merged onto
  /// them from this base, never swapped in wholesale (audit F-01, F-02).
  final MobileEditIr? baseIr;
  final int? baseRevision;

  /// What the creator asked for in this turn (to re-run it on the latest timeline).
  final String? prompt;

  /// The creator and the Director both changed the cuts: the response was not applied; the chat offers a choice.
  final bool structuralConflict;

  /// What the chat shows. For a failed turn this is a friendly sentence; the raw failure is in [error].
  final String text;
  final DirectorResponse? response;
  final bool applied;

  /// The exception behind a failed director turn (for logs / support); null for a normal message.
  final Object? error;

  /// A director turn that failed (the chat offers "Try again", see [StudioController.retryLastDirectorTurn]).
  bool get failed => error != null;

  DirectorMessage copyWith({bool? applied, bool? structuralConflict, MobileEditIr? appliedIr}) => DirectorMessage(
    fromUser: fromUser,
    text: text,
    response: response,
    applied: applied ?? this.applied,
    error: error,
    baseIr: baseIr,
    baseRevision: baseRevision,
    prompt: prompt,
    structuralConflict: structuralConflict ?? this.structuralConflict,
    appliedIr: appliedIr ?? this.appliedIr,
  );
}

class ExportState {
  ExportState({
    this.progress = 0,
    this.stage = '',
    this.result,
    this.error,
    this.warnings = const [],
    this.credits = const [],
  });

  /// Credit lines of the stock music, B-roll and SFX in the export (to paste into the post caption).
  final List<String> credits;
  final double progress;
  final String stage;
  final RenderResult? result;
  final Object? error;
  final List<String> warnings;
  bool get running => result == null && error == null;
}

/// One editing session: the source clip, its analysis, the timeline with undo/redo, the AI
/// Director conversation and the export. The UI only reads state and calls methods.
class StudioController extends ChangeNotifier {
  StudioController({
    required this.director,
    required this.transcriber,
    this.projectId,
    this.postId,
    this.pieceId,
    this.hook,
    this.script,
    this.aspect = '9:16',
    this.draftId,
  });

  final AiDirectorService director;
  final AudioTranscriptionService transcriber;
  final String? projectId;
  final String? postId;
  final String? pieceId;
  final String? hook;
  final String? script;
  final String aspect;
  String? draftId;

  TrackKind? selectedKind;
  String? selectedItemId;

  void selectTrackItem(String id, TrackKind kind) {
    selectedItemId = id;
    selectedKind = kind;
    _notify();
  }

  /// Forgets the selected timeline item (text / caption / overlay), e.g. before "Add text" from the toolbar so the
  /// Text tool adds a new title instead of editing the last one tapped.
  void clearItemSelection() {
    if (selectedItemId == null && selectedKind == null) return;
    selectedItemId = null;
    selectedKind = null;
    _notify();
  }

  /// The selected text / caption, or null when nothing (or something that no longer exists) is selected.
  EditIrCaption? get selectedCaption {
    final id = selectedItemId;
    if (id == null) return null;
    return _ir?.captions.where((c) => c.id == id).firstOrNull;
  }

  bool _greeted = false;

  /// Opening turn from a calendar piece or post: the server loads the brand and the piece's
  /// script and replies with a concrete proposal the user can Apply (nothing is applied here).
  Future<void> greet() async {
    final ir = _ir;
    if (_greeted ||
        ir == null ||
        directorBusy ||
        (projectId == null && pieceId == null && postId == null)) {
      return;
    }
    _greeted = true;
    directorBusy = true;
    final baseRevision = revision;
    _notify();
    try {
      final r = await director.direct(
        prompt: '',
        intent: 'greet',
        history: [],
        media: _analysis(),
        projectId: projectId,
        calendarPieceId: pieceId,
        postId: postId,
        currentEditIR: ir.toJson(),
        baseRevision: baseRevision,
      );
      r.editIr.validate();
      messages.add(
        DirectorMessage(fromUser: false, text: r.reply, response: r, baseIr: ir, baseRevision: baseRevision),
      );
    } catch (_) {
      // Optional opening turn: the user can still direct the edit themselves.
    } finally {
      directorBusy = false;
      _notify();
    }
  }

  static const _maxUndo = 50;

  String? sourcePath;
  final Map<String, String> sourcePaths = {};
  final Map<String, String> proxyPaths = {};
  VideoMetadata? meta;
  MobileEditIr? _irValue;

  /// Bumped on every timeline change (manual edit, gesture step, undo / redo, Director turn, draft load). A Director
  /// response made from an older revision is merged, not swapped in.
  int revision = 0;

  MobileEditIr? get _ir => _irValue;
  set _ir(MobileEditIr? v) {
    if (identical(v, _irValue)) return;
    _irValue = v;
    revision++;
  }
  final List<MobileEditIr> _undo = [];
  final List<MobileEditIr> _redo = [];

  TranscriptState transcriptState = TranscriptState.idle;
  Transcript? transcript;
  Object? transcriptError;

  /// Spoken language sent to the transcriber; `auto` lets the server detect it.
  String spokenLanguage = CaptionLanguages.auto;

  /// Changes the spoken language and transcribes again. Captions already on the timeline are kept
  /// until the creator regenerates them.
  Future<void> setSpokenLanguage(String code) async {
    if (code == spokenLanguage || transcriptState == TranscriptState.running) return;
    spokenLanguage = code;
    await transcribe();
  }

  /// The speech captions in another language or script (server AI, words only): caption id → new text.
  /// Apply the result with [TimelineOps.retextCaptions].
  Future<Map<String, String>> translateCaptions(String targetLanguage, {String script = 'native'}) =>
      transcriber.translateCaptions(
        {
          for (final c in _ir?.captions ?? const <EditIrCaption>[])
            if (c.kind == 'caption' && c.text.trim().isNotEmpty) c.id: c.text,
        },
        targetLanguage: targetLanguage,
        script: script,
      );

  /// Source-time silences from the on-device detector; lets the director cut pauses even
  /// when there is no transcript.
  List<SilenceRange>? silences;

  /// Licence credit lines by media URL (music, B-roll, SFX). CC BY / BY-SA items must be credited
  /// in the post caption; the others are credited as a courtesy.
  final Map<String, String> mediaCredits = {};

  /// On-device ML Kit face samples of the source (null until detected / when unavailable).
  List<FaceSample>? faces;

  /// On-device beat times of the source audio (source ms).
  List<int>? beatsMs;

  /// Where fill crops centre: the dominant detected face, else the frame centre.
  ({double x, double y})? get faceFocus =>
      faces == null ? null : TimelineOps.faceFocus(faces!);

  int playheadMs = 0;
  int? selectedClip;

  final List<DirectorMessage> messages = [];
  bool directorBusy = false;

  ExportState? export;
  StreamSubscription<RenderProgress>? _renderSub;
  bool _disposed = false;

  MobileEditIr? get ir => _ir;
  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;
  List<TranscriptWord> get words => transcript?.words ?? [];

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _renderSub?.cancel();
    super.dispose();
  }

  Future<VideoMetadata> _inspectVideoWithPlayer(String path) async {
    final remote = kIsWeb || path.startsWith('http://') || path.startsWith('https://');
    final controller = remote ? VideoPlayerController.networkUrl(Uri.parse(path)) : VideoPlayerController.file(File(path));
    // Never invented numbers (F-12): a timeline built on a guessed length or size exports truncated or fails.
    try {
      await controller.initialize();
    } catch (e) {
      throw MediaEngineException('PROBE_FAILED', 'This video could not be opened on this device ($e).');
    }
    try {
      final d = controller.value.duration.inMilliseconds;
      final w = controller.value.size.width.toInt();
      final h = controller.value.size.height.toInt();
      if (d <= 0 || w <= 0 || h <= 0) {
        throw MediaEngineException('PROBE_FAILED', 'The length or size of this video could not be read.');
      }
      return VideoMetadata(
        durationMs: d,
        width: w,
        height: h,
        rotation: 0,
        displayWidth: w,
        displayHeight: h,
        hasVideo: true,
        // The player cannot tell whether there is sound: it is tried, and transcription reports it if there is none.
        hasAudio: true,
        frameRate: null,
      );
    } finally {
      await controller.dispose();
    }
  }

  /// Loads a local or web video, builds the starting timeline and starts transcription in the background.
  Future<void> load(String path) async {
    if (!kIsWeb) {
      if (!await File(path).exists()) {
        throw MediaEngineException(
          'FILE_NOT_FOUND',
          'The video file is no longer on this device.',
        );
      }
    }
    VideoMetadata info;
    if (!kIsWeb) {
      try {
        info = await MediaEngineService.getVideoInfo(path);
      } catch (_) {
        info = await _inspectVideoWithPlayer(path);
      }
    } else {
      info = await _inspectVideoWithPlayer(path);
    }
    if (!info.hasVideo) {
      throw MediaEngineException(
        'NO_VIDEO_TRACK',
        'This file has no video track.',
      );
    }
    sourcePath = path;
    sourcePaths['main'] = path;
    meta = info;
    _ir = TimelineOps.initial(
      projectId: projectId ?? 'local',
      durationMs: info.durationMs,
      width: info.displayWidth,
      height: info.displayHeight,
      aspect: aspect,
      fps: info.frameRate == null ? 30 : info.frameRate!.clamp(24, 60).round(),
    );
    _undo.clear();
    _redo.clear();
    playheadMs = 0;
    selectedClip = null;
    _notify();
    if (!kIsWeb) {
      if (info.displayWidth > 1080 || info.displayHeight > 1080) {
        unawaited(_generateProxy('primary', path));
      }
      unawaited(_detectFaces(path));
      unawaited(_analyseVisuals(path, hasAudio: info.hasAudio));
      if (info.hasAudio) {
        unawaited(_detectSilences(path));
        unawaited(_detectBeats(path));
        unawaited(transcribe());
      } else if (script != null && script!.trim().isNotEmpty) {
        _populateTranscriptFromScript(script!, info.durationMs);
        _notify();
        unawaited(greet());
      } else if (hook != null && hook!.trim().isNotEmpty) {
        _populateTranscriptFromScript(hook!, info.durationMs);
        _notify();
        unawaited(greet());
      } else {
        transcriptState = TranscriptState.failed;
        transcriptError = 'This video has no audio, so there is nothing to transcribe. Captions and pause removal are unavailable.';
        _notify();
        unawaited(greet());
      }
    } else {
      if (script != null && script!.trim().isNotEmpty) {
        _populateTranscriptFromScript(script!, info.durationMs);
      } else if (hook != null && hook!.trim().isNotEmpty) {
        _populateTranscriptFromScript(hook!, info.durationMs);
      }
      _notify();
      unawaited(greet());
    }
  }

  /// Restores complete timeline and session state from a saved draft.
  Future<void> restoreFromDraft(StudioDraft draft) async {
    draftId = draft.id;
    sourcePath = draft.sourcePath;
    sourcePaths.clear();
    sourcePaths.addAll(draft.sourcePaths);
    if (!sourcePaths.containsKey('main') && draft.sourcePath.isNotEmpty) {
      sourcePaths['main'] = draft.sourcePath;
    }
    _ir = _migrateLocalOverlays(draft.ir);
    // Every other source of the draft is analysed again (the analysis is not stored in the draft).
    for (final id in _ir!.clips.map((c) => c.assetId).toSet()) {
      final p = pathForAsset(id);
      if (id != 'primary' && p != null) _queueClipAnalysis(id, p);
    }
    unawaited(prefetchRemoteMedia());
    unawaited(materializeEmojiStickers(_ir!).then((_) => _notify(), onError: (_) {}));
    playheadMs = draft.playheadMs.clamp(0, draft.ir.durationMs);
    _undo.clear();
    _redo.clear();
    selectedClip = null;
    selectedKind = null;
    selectedItemId = null;
    _notify();
  }

  /// Creates a draft representation of the current project and timeline.
  StudioDraft? createDraft({String? title, String? thumbnailUrl}) {
    final curIr = _ir;
    final path = sourcePath;
    if (curIr == null || path == null) return null;
    final dId = draftId ?? 'draft_${DateTime.now().millisecondsSinceEpoch}';
    draftId = dId;

    final defaultTitle = title ??
        (hook != null && hook!.trim().isNotEmpty ? hook!.trim() : null) ??
        (script != null && script!.trim().isNotEmpty
            ? (script!.trim().length > 30 ? '${script!.trim().substring(0, 30)}…' : script!.trim())
            : null) ??
        'Draft · ${timecode(curIr.durationMs)}';

    final firstClip = curIr.clips.firstOrNull;
    final primaryMedia = firstClip != null ? (sourcePaths[firstClip.assetId] ?? path) : path;
    final resolvedThumb = thumbnailUrl ??
        (curIr.overlays.firstOrNull?.source['thumbnailUrl'] as String?) ??
        primaryMedia;

    return StudioDraft(
      id: dId,
      title: defaultTitle,
      sourcePath: path,
      sourcePaths: Map<String, String>.from(sourcePaths),
      ir: curIr,
      playheadMs: playheadMs,
      updatedAt: DateTime.now(),
      projectId: projectId,
      postId: postId,
      pieceId: pieceId,
      hook: hook,
      script: script,
      thumbnailUrl: resolvedThumb,
    );
  }

  void _populateTranscriptFromScript(String scriptText, int totalDurationMs) {
    final clean = scriptText.replaceAll(RegExp(r'[\r\n]+'), ' ').trim();
    if (clean.isEmpty) return;
    final wordsList = clean.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (wordsList.isEmpty) return;

    final dur = totalDurationMs > 0 ? totalDurationMs : 15000;
    final wordDurationMs = (dur / wordsList.length).round().clamp(120, 600);
    final transcriptWords = <TranscriptWord>[];
    var currentMs = 250;

    for (var i = 0; i < wordsList.length; i++) {
      final w = wordsList[i];
      final startMs = currentMs;
      final endMs = (startMs + wordDurationMs).clamp(startMs + 50, dur);
      transcriptWords.add(TranscriptWord(text: w, startMs: startMs, endMs: endMs));
      currentMs = endMs + 40;
      if (currentMs >= dur) break;
    }

    transcript = Transcript(
      language: 'en',
      durationMs: dur,
      text: clean,
      words: transcriptWords,
    );
    transcriptState = TranscriptState.ready;
    transcriptError = null;

    final ir = _ir;
    if (ir != null) {
      _ir = MobileEditIr(
        projectId: ir.projectId,
        canvas: ir.canvas,
        durationMs: ir.durationMs,
        sources: ir.sources,
        watermark: ir.watermark,
        itemMeta: ir.itemMeta,
        clips: ir.clips,
        overlays: ir.overlays,
        captions: ir.captions,
        zooms: ir.zooms,
        effects: ir.effects,
        audio: EditIrAudio(
          originalVolumeDb: ir.audio.originalVolumeDb,
          music: ir.audio.music,
          speechRangesMs: TimelineOps.speechRangesAll({..._wordsByAsset, 'primary': transcriptWords}, ir),
          sfx: ir.audio.sfx,
          voiceovers: ir.audio.voiceovers,
        ),
      );
    }
  }

  /// Manually attach or update the video spoken script for AI Director consciousness.
  void attachScript(String scriptText) {
    _populateTranscriptFromScript(scriptText, _ir?.durationMs ?? 15000);
    _notify();
  }

  Future<void> _detectSilences(String path) async {
    try {
      final r = await MediaEngineService.detectSilences(sourcePath: path);
      silences = [for (final s in r) SilenceRange(s.startMs, s.endMs)];
    } catch (_) {
      silences =
          null; // optional analysis: the director falls back to transcript gaps
    }
  }

  /// Face track for smart reframe. While the user has not edited yet, the starting crop is re-centred
  /// on the dominant face. Optional: without it crops stay centred.
  Future<void> _detectFaces(String path) async {
    try {
      faces = await MediaEngineService.detectFaces(sourcePath: path);
    } catch (_) {
      faces = null;
      return;
    }
    final ir = _ir;
    final focus = faceFocus;
    if (ir == null ||
        focus == null ||
        _undo.isNotEmpty ||
        ir.clips.length != 1 ||
        _disposed) {
      return;
    }
    final src = ir.sources.firstOrNull;
    final crop = src == null
        ? null
        : TimelineOps.centerCrop(
            src.width,
            src.height,
            ir.canvas,
            focus: focus,
          );
    if (crop != null && ir.clips.single.crop != null) {
      _ir = TimelineOps.setCrop(ir, crop, index: 0);
      _notify();
    }
  }

  /// What the AI Director "sees", computed on the phone one after another (they share the decoder): scene cuts,
  /// scene labels, on-screen text and loudness. Each is optional; a failure only leaves that part out.
  MediaIntelligence intelligence = MediaIntelligence();

  Future<void> _analyseVisuals(String path, {required bool hasAudio}) async {
    Future<T?> attempt<T>(Future<T> Function() f) async {
      try {
        return await f();
      } catch (_) {
        return null;
      }
    }

    final scenes = await attempt(() => MediaEngineService.detectScenes(sourcePath: path));
    if (_disposed) return;
    intelligence = intelligence.merge(scenesMs: scenes);
    final labels = await attempt(() => MediaEngineService.labelScenes(sourcePath: path));
    if (_disposed) return;
    intelligence = intelligence.merge(labels: labels);
    final ocr = await attempt(() => MediaEngineService.recognizeText(sourcePath: path));
    if (_disposed) return;
    intelligence = intelligence.merge(ocr: ocr);
    if (hasAudio) {
      final loud = await attempt(() => MediaEngineService.measureLoudness(sourcePath: path));
      if (_disposed) return;
      intelligence = intelligence.merge(loudness: loud);
    }
  }

  Future<void> _detectBeats(String path) async {
    try {
      beatsMs = (await MediaEngineService.detectBeats(audioPath: path)).beatsMs;
    } catch (_) {
      beatsMs = null; // optional analysis
    }
  }

  Future<void> transcribe() async {
    final path = sourcePath;
    if (path == null || transcriptState == TranscriptState.running) return;
    transcriptState = TranscriptState.running;
    transcriptError = null;
    _notify();
    try {
      final audioPath = await MediaEngineService.getOutputAudioPath(
        'stt_${DateTime.now().millisecondsSinceEpoch}.m4a',
      );
      final audio = await MediaEngineService.extractAudio(
        sourcePath: path,
        destPath: audioPath,
      );
      if (audio.fileSizeBytes > AudioTranscriptionService.maxBytes) {
        throw MediaEngineException(
          'AUDIO_TOO_LARGE',
          'This video is too long to transcribe (audio over 25 MB). Trim it first.',
        );
      }
      final t = await transcriber.transcribe(audio.path, language: spokenLanguage);
      if (!kIsWeb) {
        unawaited(File(audio.path).delete().catchError((_) => File(audio.path)));
      }
      transcript = t;
      transcriptState = TranscriptState.ready;
      // Speech ranges drive music ducking; recompute them for the current cut.
      final ir = _ir;
      if (ir != null) {
        _ir = MobileEditIr(
          projectId: ir.projectId,
          canvas: ir.canvas,
          durationMs: ir.durationMs,
          sources: ir.sources,
          watermark: ir.watermark,
          itemMeta: ir.itemMeta,
          clips: ir.clips,
          overlays: ir.overlays,
          captions: ir.captions,
          zooms: ir.zooms,
          effects: ir.effects,
          audio: EditIrAudio(
            originalVolumeDb: ir.audio.originalVolumeDb,
            music: ir.audio.music,
            speechRangesMs: TimelineOps.speechRangesAll({..._wordsByAsset, 'primary': t.words}, ir),
            sfx: ir.audio.sfx,
            voiceovers: ir.audio.voiceovers,
          ),
        );
      }
    } catch (e) {
      if (script != null && script!.trim().isNotEmpty) {
        _populateTranscriptFromScript(script!, _ir?.durationMs ?? 15000);
      } else if (hook != null && hook!.trim().isNotEmpty) {
        _populateTranscriptFromScript(hook!, _ir?.durationMs ?? 15000);
      } else {
        transcriptState = TranscriptState.failed;
        transcriptError = e;
      }
    }
    _notify();
    unawaited(greet());
  }

  // ── Voiceover ──────────────────────────────────────────────────────────────

  /// Set by the editor screen: starts / stops the preview (voiceover records while the video plays, like CapCut).
  void Function(bool play)? onPreviewPlayback;

  /// Timeline position the current recording started at; null when not recording.
  int? voiceoverStartMs;
  bool get recordingVoiceover => voiceoverStartMs != null;

  /// Starts recording at the playhead. Throws `PERMISSION_DENIED` when the microphone is not allowed.
  Future<void> startVoiceover() async {
    if (_ir == null || recordingVoiceover) return;
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) {
      throw MediaEngineException('PERMISSION_DENIED', 'Allow microphone access to record a voiceover (Settings > Apps > permissions).');
    }
    final path = await MediaEngineService.getVoiceoverPath('vo_${DateTime.now().millisecondsSinceEpoch}.m4a');
    voiceoverStartMs = playheadMs;
    await MediaEngineService.startVoiceRecording(path);
    _notify();
    onPreviewPlayback?.call(true);
  }

  /// Stops and places the recording where it started. The file is kept with the draft.
  Future<void> stopVoiceover() async {
    final at = voiceoverStartMs;
    if (at == null) return;
    voiceoverStartMs = null;
    onPreviewPlayback?.call(false);
    _notify();
    final r = await MediaEngineService.stopVoiceRecording();
    final assetId = 'vo_asset_${DateTime.now().millisecondsSinceEpoch}';
    sourcePaths[assetId] = r.path;
    try {
      apply((ir) => TimelineOps.addVoiceover(ir, assetId: assetId, atMs: at, durationMs: r.durationMs));
    } catch (_) {
      sourcePaths.remove(assetId);
      try {
        File(r.path).deleteSync();
      } catch (_) {}
      rethrow;
    }
  }

  /// AI narration: [text] spoken by the phone's text-to-speech voice, placed at [atMs] (default: the playhead).
  Future<void> addNarration(String text, {int? atMs, double rate = 1}) async {
    if (_ir == null) return;
    final path = await MediaEngineService.getVoiceoverPath('tts_${DateTime.now().millisecondsSinceEpoch}.wav');
    final r = await MediaEngineService.synthesizeSpeech(text: text, outputPath: path, rate: rate);
    final assetId = 'tts_asset_${DateTime.now().millisecondsSinceEpoch}';
    sourcePaths[assetId] = r.path;
    final at = atMs ?? playheadMs;
    apply((ir) => TimelineOps.addVoiceover(ir, assetId: assetId, atMs: at, durationMs: r.durationMs));
  }

  /// Real lengths of narration the Director asked for (`tts:<text>` assets), measured after synthesis.
  final Map<String, int> _generatedDurations = {};

  /// Narration the AI Director placed references `tts:<text>`; it is spoken here, on the phone, before the edit is
  /// shown. A phone without a voice engine leaves it out with the engine's reason.
  Future<void> materializeNarration(MobileEditIr ir) async {
    if (kIsWeb) return;
    for (final v in ir.audio.voiceovers) {
      if (!v.assetId.startsWith('tts:')) continue;
      final existing = sourcePaths[v.assetId];
      if (existing != null && File(existing).existsSync()) continue;
      final path = await MediaEngineService.getVoiceoverPath('tts_${DateTime.now().microsecondsSinceEpoch}.wav');
      final r = await MediaEngineService.synthesizeSpeech(text: v.assetId.substring(4), outputPath: path);
      sourcePaths[v.assetId] = r.path;
      _generatedDurations[v.assetId] = r.durationMs;
    }
  }

  /// Freeze frames the AI Director placed reference `freeze:<assetId>@<sourceMs>`: the exact frame is captured here,
  /// on the phone, before the edit is shown (like the manual Freeze tool). Already-captured ones are reused.
  Future<void> materializeFreezeFrames(MobileEditIr ir) async {
    if (kIsWeb) return;
    for (final c in ir.clips) {
      final id = c.assetId;
      if (!id.startsWith('freeze:')) continue;
      final existing = sourcePaths[id];
      if (existing != null && File(existing).existsSync()) continue;
      final at = id.lastIndexOf('@');
      final from = at > 7 ? id.substring(7, at) : '';
      final ms = at > 0 ? int.tryParse(id.substring(at + 1)) : null;
      final path = pathForAsset(from);
      if (path == null || ms == null) {
        throw MediaEngineException('FILE_NOT_FOUND', 'The clip to freeze is no longer on this phone.');
      }
      final docs = await getApplicationDocumentsDirectory();
      final frames = await MediaEngineService.generateThumbnails(
        sourcePath: path,
        outputDir: '${docs.path}/stills/${DateTime.now().microsecondsSinceEpoch}',
        timesMs: [ms],
        maxWidth: 1920,
        exact: true,
      );
      if (frames.isEmpty) throw MediaEngineException('NATIVE_ERROR', 'The frame could not be captured.');
      sourcePaths[id] = frames.first;
    }
  }

  /// Corrects generated narration to its real spoken length (the server can only estimate it).
  MobileEditIr _withGeneratedDurations(MobileEditIr ir) {
    var out = ir;
    // Narration whose voice could not be made on this phone is left out (already reported in the chat).
    for (final v in ir.audio.voiceovers) {
      if (v.assetId.startsWith('tts:') && !sourcePaths.containsKey(v.assetId)) out = TimelineOps.removeVoiceover(out, v.id);
    }
    for (final v in ir.audio.voiceovers) {
      final real = _generatedDurations[v.assetId];
      if (real == null || real == v.durationMs) continue;
      out = TimelineOps.setItemRange(out, TrackKind.voiceover, v.id, v.timelineStartMs, math.min(ir.durationMs, v.timelineStartMs + real));
    }
    return out;
  }

  Future<void> cancelVoiceover() async {
    if (!recordingVoiceover) return;
    voiceoverStartMs = null;
    onPreviewPlayback?.call(false);
    _notify();
    await MediaEngineService.cancelVoiceRecording();
  }

  /// Applies a manual edit. Throws (without changing anything) if the edit is invalid.
  void apply(MobileEditIr Function(MobileEditIr ir) edit) {
    final current = _ir;
    if (current == null) return;
    final next = _markManual(current, edit(current));
    // A gesture still open (drag on the preview) is folded into this edit: one undo step restores the state before both.
    _push(_liveStart ?? current);
    _liveStart = null;
    _setTimeline(next);
  }

  /// Applies live update (e.g. dragging text on canvas) without cluttering the undo stack. Wrap a gesture in
  /// [beginLiveEdit] / [endLiveEdit] so the whole gesture becomes one undo step.
  void applyWithoutHistory(MobileEditIr Function(MobileEditIr ir) edit) {
    final current = _ir;
    if (current == null) return;
    _setTimeline(_markManual(current, edit(current)));
  }

  /// Items a manual edit created are the creator's own (`origin: manual`): the Director then changes them only when
  /// asked, and never sweeps them away (F-21).
  MobileEditIr _markManual(MobileEditIr before, MobileEditIr after) {
    final fresh = after.itemIds.difference(before.itemIds).where((id) => after.itemMeta[id]?.origin == null);
    if (fresh.isEmpty) return after;
    return after.copyWith(itemMeta: {
      ...after.itemMeta,
      for (final id in fresh) id: EditIrItemMeta(origin: 'manual', locked: after.itemMeta[id]?.locked ?? false),
    });
  }

  /// Locks or unlocks a timeline item: the AI Director will not change or remove a locked item.
  void toggleItemLock(String id) {
    final ir = _ir;
    if (ir == null || !ir.itemIds.contains(id)) return;
    apply((cur) => cur.withItemMeta(id, locked: !cur.isLocked(id)));
  }

  bool isItemLocked(String id) => _ir?.isLocked(id) ?? false;

  /// Director-applied timelines the creator has undone (identity), for the history the Director sees.
  final Set<MobileEditIr> _undoneDirectorStates = Set.identity();

  /// When each Director turn's result was applied (identity of the applied timeline), for the regret rate: a turn the
  /// creator undoes within 30 s is reported as such (Phase 7.2).
  final Map<MobileEditIr, ({DateTime at, DirectorResponse r})> _appliedTurns = Map.identity();

  void _reportApplied(DirectorResponse r, MobileEditIr applied, {int conflicts = 0}) {
    _appliedTurns[applied] = (at: DateTime.now(), r: r);
    final pid = projectId;
    if (pid == null || pid == 'local') return;
    unawaited(director.sendFeedback(
      projectId: pid,
      accepted: true,
      runId: r.runId,
      summary: conflicts > 0 ? 'applied, merged with the creator\'s edits ($conflicts conflict(s) kept theirs)' : 'applied',
      operations: [for (final o in r.operations) '${o['type'] ?? o['op'] ?? ''}'],
    ));
  }

  void _reportUndone(MobileEditIr undone) {
    final t = _appliedTurns[undone];
    final pid = projectId;
    if (t == null || pid == null || pid == 'local') return;
    final secs = DateTime.now().difference(t.at).inSeconds;
    unawaited(director.sendFeedback(
      projectId: pid,
      accepted: false,
      runId: t.r.runId,
      summary: secs <= 30 ? 'undone within 30 s of applying (regret)' : 'undone ${secs}s after applying',
      operations: [for (final o in t.r.operations) '${o['type'] ?? o['op'] ?? ''}'],
    ));
  }

  /// Timeline before the gesture in progress (drag on the preview); null when no gesture is open.
  MobileEditIr? _liveStart;

  /// Starts a live gesture: the following [applyWithoutHistory] updates are undone together.
  void beginLiveEdit() {
    _liveStart ??= _ir;
  }

  /// Ends a live gesture: records one undo step back to the state before [beginLiveEdit] (none if nothing changed).
  void endLiveEdit() {
    final start = _liveStart;
    _liveStart = null;
    if (start == null || _ir == null || identical(start, _ir)) return;
    _push(start);
    _notify();
  }

  void _setTimeline(MobileEditIr next) {
    _ir = next;
    playheadMs = playheadMs.clamp(0, next.durationMs);
    if (selectedClip != null && selectedClip! >= next.clips.length) {
      selectedClip = next.clips.isEmpty ? null : next.clips.length - 1;
    }
    final id = selectedItemId;
    if (id != null && !TimelineOps.items(next).any((i) => i.id == id)) {
      selectedItemId = null;
      selectedKind = null;
    }
    // A finished (or failed) export no longer matches a changed timeline: the export sheet must render again instead
    // of offering the old file. A render in progress keeps going (it renders the timeline it started with).
    if (export != null && !export!.running) export = null;
    _notify();
  }

  /// Adds a new video clip to the timeline (at start or end).
  Future<void> addVideoClip(String path, {bool prepend = false, int? atIndex, String? label}) async {
    VideoMetadata info;
    if (!kIsWeb) {
      try {
        info = await MediaEngineService.getVideoInfo(path);
      } catch (_) {
        info = await _inspectVideoWithPlayer(path);
      }
    } else {
      info = await _inspectVideoWithPlayer(path);
    }
    final assetId = 'asset_${DateTime.now().millisecondsSinceEpoch}';
    sourcePaths[assetId] = path;
    if (!kIsWeb && (info.displayWidth > 1080 || info.displayHeight > 1080)) {
      unawaited(_generateProxy(assetId, path));
    }
    // The DISPLAY size (rotation applied): portrait phone footage is registered as portrait (F-11).
    apply((ir) => TimelineOps.addTimelineClip(
      ir,
      assetId: assetId,
      durationMs: info.durationMs,
      width: info.displayWidth,
      height: info.displayHeight,
      prepend: prepend,
      atIndex: atIndex,
    ));
    // Analysed like the first clip, so the AI Director can caption, clean and frame it (F-10).
    _queueClipAnalysis(assetId, path, info: info);
  }

  // ── Analysis of every clip (Phase 4) ───────────────────────────────────────

  /// Analysis of each source other than the primary one, by assetId (one file can back several assets).
  final Map<String, ClipAnalysis> clipAnalyses = {};
  final Map<String, ClipAnalysis> _analysisByFile = {};
  final List<ClipAnalysis> _analysisQueue = [];
  int _analysesRunning = 0;
  static const _maxConcurrentAnalyses = 2;

  /// A Director turn is waiting for clip transcripts ("Listening to your clips…").
  bool waitingForClipAnalysis = false;

  /// Same file (path, size, modified time) = same analysis: a clip added twice is analysed once.
  static String? _fileKey(String path) {
    try {
      final st = File(path).statSync();
      return '$path|${st.size}|${st.modified.millisecondsSinceEpoch}';
    } catch (_) {
      return null;
    }
  }

  void _queueClipAnalysis(String assetId, String path, {VideoMetadata? info}) {
    if (kIsWeb || clipAnalyses.containsKey(assetId) || isStillAsset(assetId)) return;
    final key = _fileKey(path);
    final cached = key == null ? null : _analysisByFile[key];
    if (cached != null) {
      clipAnalyses[assetId] = cached;
      return;
    }
    final a = ClipAnalysis(path: path, info: info)..queued = true;
    clipAnalyses[assetId] = a;
    if (key != null) _analysisByFile[key] = a;
    _analysisQueue.add(a);
    _pumpAnalyses();
  }

  void _pumpAnalyses() {
    while (_analysesRunning < _maxConcurrentAnalyses && _analysisQueue.isNotEmpty && !_disposed) {
      final a = _analysisQueue.removeAt(0);
      _analysesRunning++;
      unawaited(_runClipAnalysis(a).whenComplete(() {
        _analysesRunning--;
        _pumpAnalyses();
      }));
    }
  }

  /// Silences, faces, picture, beats, then the transcript of one source (one after another: they share the decoder).
  /// Each part is optional; a failure leaves only that part out, and a failed transcript is reported, never guessed.
  Future<void> _runClipAnalysis(ClipAnalysis a) async {
    Future<T?> attempt<T>(Future<T> Function() f) async {
      try {
        return await f();
      } catch (_) {
        return null;
      }
    }

    a.queued = false;
    a.transcriptState = TranscriptState.running;
    _notify();
    a.info ??= await attempt(() => MediaEngineService.getVideoInfo(a.path));
    final hasAudio = a.info?.hasAudio ?? true;
    if (hasAudio) {
      final s = await attempt(() => MediaEngineService.detectSilences(sourcePath: a.path));
      a.silences = s == null ? null : [for (final x in s) SilenceRange(x.startMs, x.endMs)];
    }
    if (_disposed) return;
    a.faces = await attempt(() => MediaEngineService.detectFaces(sourcePath: a.path));
    if (_disposed) return;
    a.intelligence = a.intelligence.merge(scenesMs: await attempt(() => MediaEngineService.detectScenes(sourcePath: a.path)));
    a.intelligence = a.intelligence.merge(labels: await attempt(() => MediaEngineService.labelScenes(sourcePath: a.path)));
    a.intelligence = a.intelligence.merge(ocr: await attempt(() => MediaEngineService.recognizeText(sourcePath: a.path)));
    if (hasAudio) {
      a.intelligence = a.intelligence.merge(loudness: await attempt(() => MediaEngineService.measureLoudness(sourcePath: a.path)));
      a.beatsMs = (await attempt(() => MediaEngineService.detectBeats(audioPath: a.path)))?.beatsMs;
    }
    if (_disposed) return;
    _focusClipCrops(a);
    if (!hasAudio) {
      a.transcriptState = TranscriptState.failed;
      a.transcriptError = MediaEngineException('NO_AUDIO', 'This clip has no sound.');
      _notify();
      return;
    }
    try {
      final audioPath = await MediaEngineService.getOutputAudioPath('stt_clip_${DateTime.now().microsecondsSinceEpoch}.m4a');
      final audio = await MediaEngineService.extractAudio(sourcePath: a.path, destPath: audioPath);
      if (audio.fileSizeBytes > AudioTranscriptionService.maxBytes) {
        throw MediaEngineException('AUDIO_TOO_LARGE', 'This clip is too long to transcribe (audio over 25 MB).');
      }
      a.transcript = await transcriber.transcribe(audio.path, language: spokenLanguage);
      unawaited(File(audio.path).delete().catchError((_) => File(audio.path)));
      a.transcriptState = TranscriptState.ready;
      _refreshSpeechRanges();
    } catch (e) {
      a.transcriptState = TranscriptState.failed;
      a.transcriptError = e;
    }
    _notify();
  }

  /// The transcript words of every source on the timeline, by assetId.
  Map<String, List<TranscriptWord>> get _wordsByAsset => {
        'primary': words,
        for (final e in clipAnalyses.entries)
          if (e.value.words.isNotEmpty) e.key: e.value.words,
      };

  /// Speech ranges (music ducking) from every clip's words, without an undo step (it is analysis, not an edit).
  void _refreshSpeechRanges() {
    final ir = _ir;
    if (ir == null || _disposed) return;
    _ir = ir.copyWith(
      audio: EditIrAudio(
        originalVolumeDb: ir.audio.originalVolumeDb,
        music: ir.audio.music,
        speechRangesMs: TimelineOps.speechRangesAll(_wordsByAsset, ir),
        sfx: ir.audio.sfx,
        voiceovers: ir.audio.voiceovers,
      ),
    );
  }

  /// A clip whose framing is still the automatic centre fill is re-centred on its speaker once faces are known.
  void _focusClipCrops(ClipAnalysis a) {
    final ir = _ir;
    final f = a.faces;
    if (ir == null || f == null || f.isEmpty) return;
    final focus = TimelineOps.faceFocus(f);
    var next = ir;
    for (var i = 0; i < ir.clips.length; i++) {
      final c = ir.clips[i];
      if (!identical(clipAnalyses[c.assetId], a)) continue;
      final src = ir.sources.where((s) => s.assetId == c.assetId).firstOrNull;
      if (src == null) continue;
      final auto = TimelineOps.centerCrop(src.width, src.height, ir.canvas);
      // Only the untouched automatic crop moves; framing the creator chose stays.
      if (c.crop == null || auto == null || jsonEncode(c.crop!.toJson()) != jsonEncode(auto.toJson())) continue;
      final focused = TimelineOps.centerCrop(src.width, src.height, ir.canvas, focus: focus);
      if (focused != null) next = TimelineOps.setCrop(next, focused, index: i);
    }
    if (!identical(next, ir)) {
      _ir = next;
      _notify();
    }
  }

  /// Sources on the timeline (other than the primary one) and their analysis, for the Director request.
  List<MediaAnalysis> _otherClipAnalyses() {
    final ir = _ir;
    if (ir == null) return const [];
    return [
      for (final id in ir.clips.map((c) => c.assetId).toSet())
        if (id != 'primary') ?clipAnalyses[id]?.toAnalysis(id),
    ];
  }

  List<String> _pendingAnalyses() {
    final ir = _ir;
    if (ir == null) return const [];
    return [
      for (final id in ir.clips.map((c) => c.assetId).toSet())
        if (clipAnalyses[id]?.pending ?? false) id,
    ];
  }

  /// Beats of each music file (source ms), measured once per file.
  final Map<String, List<int>> _musicBeatsByFile = {};

  /// Beats of the music bed(s) on the TIMELINE (ms), from the downloaded / local track files (Phase 6.4). A bed whose
  /// file is not on the phone yet, or a phone without beat detection, simply contributes none.
  Future<List<int>> _musicBeatsOnTimeline() async {
    final ir = _ir;
    if (ir == null || kIsWeb) return const [];
    final out = <int>[];
    for (final m in ir.audio.music) {
      final kind = m.source['kind'];
      final path = kind == 'asset' || kind == 'file'
          ? localOverlayPath(m.source)
          : kind == 'url'
              ? AssetCache.instance.cachedPath('${m.source['url']}')
              : null;
      if (path == null || !File(path).existsSync()) continue;
      var beats = _musicBeatsByFile[path];
      if (beats == null) {
        try {
          beats = (await MediaEngineService.detectBeats(audioPath: path)).beatsMs;
        } catch (_) {
          beats = const [];
        }
        _musicBeatsByFile[path] = beats;
      }
      for (final b in beats) {
        final t = m.timelineStartMs + b - m.sourceStartMs;
        if (t >= m.timelineStartMs && t < m.timelineEndMs) out.add(t);
      }
    }
    out.sort();
    return out.take(5000).toList();
  }

  /// Before a Director turn: waits up to [max] for clips still being transcribed, so it does not plan blind.
  Future<void> _awaitClipAnalyses({Duration max = const Duration(seconds: 10)}) async {
    if (_pendingAnalyses().isEmpty) return;
    waitingForClipAnalysis = true;
    _notify();
    final until = DateTime.now().add(max);
    while (_pendingAnalyses().isNotEmpty && DateTime.now().isBefore(until) && !_disposed) {
      await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    waitingForClipAnalysis = false;
    _notify();
  }

  void _push(MobileEditIr ir) {
    _undo.add(ir);
    if (_undo.length > _maxUndo) _undo.removeAt(0);
    _redo.clear();
  }

  void undo() {
    if (_undo.isEmpty || _ir == null) return;
    _liveStart = null;
    // Stepping back out of a Director turn's result undoes that turn.
    if (messages.any((m) => identical(m.appliedIr, _ir))) {
      _undoneDirectorStates.add(_ir!);
      _reportUndone(_ir!);
    }
    _redo.add(_ir!);
    selectedClip = null;
    _setTimeline(_undo.removeLast());
  }

  void redo() {
    if (_redo.isEmpty || _ir == null) return;
    _liveStart = null;
    _undo.add(_ir!);
    if (_undo.length > _maxUndo) _undo.removeAt(0);
    selectedClip = null;
    _setTimeline(_redo.removeLast());
    _undoneDirectorStates.remove(_ir);
  }

  void seek(int ms) {
    playheadMs = ms.clamp(0, _ir?.durationMs ?? 0);
    _notify();
  }

  void select(int? clip) {
    selectedClip = clip;
    _notify();
  }

  /// Local file of a timeline asset: the original video for `primary`, otherwise a clip added to the timeline.
  String? pathForAsset(String assetId) => assetId == 'primary' ? sourcePaths['main'] : sourcePaths[assetId];

  /// Registers a file on this phone (gallery photo / video, sticker, recording) and returns the overlay source that
  /// references it. The server only ever sees `{kind: asset, assetId}`; the path stays in the draft.
  Map<String, dynamic> localOverlaySource(String path, {String? label}) => localMediaSource(path, label: label);

  /// Registers any file on this phone (overlay, music, sound effect, recording) and returns `{kind: asset, assetId}`.
  /// The server never sees the path, and round-trips the reference untouched (F-03).
  Map<String, dynamic> localMediaSource(String path, {String? label}) {
    final assetId = 'local_${DateTime.now().microsecondsSinceEpoch}';
    sourcePaths[assetId] = path;
    return {'kind': 'asset', 'assetId': assetId, 'query': ?label};
  }

  /// Local file behind an overlay source (asset reference, or a legacy local path), or null for remote media.
  String? localOverlayPath(Map<String, dynamic> source) {
    if (source['kind'] == 'asset') return pathForAsset('${source['assetId']}');
    final url = (source['path'] ?? source['url']) as String?;
    if (url == null || url.isEmpty) return null;
    // Online media already in the shared asset cache plays from the phone (fast, offline, same file as export).
    if (url.startsWith('http://') || url.startsWith('https://')) return AssetCache.instance.cachedPath(url);
    return url.startsWith('file://') ? Uri.parse(url).toFilePath() : url;
  }

  /// Online media of the timeline being downloaded into the shared cache (Director picks, reopened drafts).
  /// Null when there is nothing to fetch; [failed] lists what could not be downloaded, with the reason.
  ({int done, int total, Map<String, String> failed})? mediaDownload;

  void dismissMediaDownload() {
    mediaDownload = null;
    _notify();
  }

  /// Resolves search-phrase B-roll / music to real files and downloads every online asset of the timeline, at most
  /// three at a time, so preview and export use local files. Safe to call again (cached files are skipped).
  Future<void> prefetchRemoteMedia() async {
    var ir = _ir;
    if (ir == null || kIsWeb) return;
    await AssetCache.instance.init();
    if (!AssetCache.instance.available) return;
    // 1. Search phrases → real files (the Director can leave B-roll / music as a phrase to resolve on the phone).
    for (final o in ir.overlays.where((o) => o.source['kind'] == 'stock_query' && !o.isImage)) {
      try {
        final hit = await director.resolveStockVideo('${o.source['query'] ?? ''}');
        if (hit == null || _disposed) continue;
        if (hit.credit != null) mediaCredits[hit.url] = hit.credit!;
        applyWithoutHistory((cur) => TimelineOps.replaceOverlaySource(cur, o.id, {'kind': 'url', 'url': hit.url, 'query': o.source['query']}));
      } catch (_) {
        // Left as a phrase; the export reports it if it still cannot be found.
      }
    }
    // 3D stickers the Director named ("sticker3d:<name>|<emoji>"): library search → download; the emoji, drawn on
    // the phone, when the library cannot be reached.
    for (final o in (_ir?.overlays ?? const <EditIrOverlay>[]).where((o) => o.isImage && '${o.source['query'] ?? ''}'.startsWith('sticker3d:'))) {
      final spec = '${o.source['query']}'.substring('sticker3d:'.length);
      final bar = spec.lastIndexOf('|');
      final name = bar > 0 ? spec.substring(0, bar) : spec;
      final emoji = bar > 0 ? spec.substring(bar + 1) : '';
      Map<String, dynamic>? source;
      try {
        final hit = (await director.searchStickers(name)).firstOrNull;
        if (hit != null) {
          await AssetCache.instance.ensure(hit.url, kind: AssetKind.image);
          if (hit.attribution != null) mediaCredits[hit.url] = hit.attribution!;
          source = {'kind': 'url', 'url': hit.url, 'query': name};
        }
      } catch (_) {}
      if (source == null && emoji.isNotEmpty) {
        try {
          final docs = await getApplicationDocumentsDirectory();
          final file = emoji.runes.map((r) => r.toRadixString(16)).join('_');
          source = localOverlaySource(await renderEmojiSticker(emoji, '${docs.path}/stickers/emoji_$file.png'), label: 'Sticker $emoji');
        } catch (_) {}
      }
      if (source != null && !_disposed) {
        final s = source;
        applyWithoutHistory((cur) => TimelineOps.replaceOverlaySource(cur, o.id, s));
      }
    }
    final m = _ir?.audio.music.firstOrNull;
    if (m != null && m.source['kind'] == 'stock_query') {
      try {
        final t = await director.resolveMusicTrack('${m.source['query'] ?? ''}');
        if (t != null && !_disposed) {
          if (t.credit != null) mediaCredits[t.url] = t.credit!;
          applyWithoutHistory((cur) => TimelineOps.setMusicSource(cur, {'kind': 'url', 'url': t.url, 'query': m.source['query']}));
        }
      } catch (_) {}
    }
    ir = _ir;
    if (ir == null) return;
    // 2. Everything online on the timeline.
    final wanted = <String, (AssetKind, String)>{};
    bool remote(Object? u) => u is String && (u.startsWith('https://') || u.startsWith('http://'));
    for (final o in ir.overlays) {
      final u = o.source['url'];
      if (remote(u)) wanted[u as String] = (o.isImage ? AssetKind.image : AssetKind.video, '${o.source['query'] ?? (o.isImage ? 'Photo' : 'B-roll')}');
    }
    for (final mm in ir.audio.music) {
      final u = mm.source['url'];
      if (remote(u)) wanted[u as String] = (AssetKind.audio, 'Music');
    }
    for (final e in ir.audio.sfx) {
      final u = e.source['url'];
      if (remote(u)) wanted[u as String] = (AssetKind.audio, e.credit ?? 'Sound effect');
    }
    final wm = ir.watermark;
    if (wm != null && remote(wm.imageUrl)) wanted[wm.imageUrl] = (AssetKind.image, 'Logo');
    final todo = wanted.entries.where((e) => !AssetCache.instance.isCached(e.key)).toList();
    if (todo.isEmpty) {
      mediaDownload = null;
      _notify();
      return;
    }
    var done = 0;
    final failed = <String, String>{};
    mediaDownload = (done: 0, total: todo.length, failed: failed);
    _notify();
    await Future.wait(todo.map((e) async {
      try {
        await AssetCache.instance.ensure(e.key, kind: e.value.$1);
      } catch (err) {
        failed[e.value.$2] = '$err';
      }
      done++;
      if (!_disposed) {
        mediaDownload = (done: done, total: todo.length, failed: failed);
        _notify(); // the preview switches to the local file as each one lands
      }
    }));
    if (!_disposed) {
      mediaDownload = failed.isEmpty ? null : (done: done, total: todo.length, failed: failed);
      _notify();
    }
  }

  /// Long-running frame jobs (reverse, background removal) — shown as a busy state in the tool sheet.
  String? processing;

  /// Plays clip [index] backwards (picture and sound). The reversed footage is made on the phone and saved with
  /// the draft; the clip keeps its place, speed and look.
  Future<void> reverseClip(int index) async {
    final ir = _ir;
    if (ir == null || kIsWeb || processing != null) return;
    final c = ir.clips[index];
    if (isStillAsset(c.assetId)) throw MediaEngineException('INVALID_EDIT', 'A still has nothing to reverse.');
    final path = pathForAsset(c.assetId);
    if (path == null) throw MediaEngineException('FILE_NOT_FOUND', 'This clip is no longer on this phone.');
    processing = 'Reversing clip ${index + 1}…';
    _notify();
    try {
      final out = await MediaEngineService.getProcessedPath('rev_${DateTime.now().millisecondsSinceEpoch}.mp4');
      final r = await MediaEngineService.reverseClip(sourcePath: path, startMs: c.sourceStartMs, endMs: c.sourceEndMs, outputPath: out);
      final assetId = 'rev_${DateTime.now().millisecondsSinceEpoch}';
      sourcePaths[assetId] = r.path;
      apply((cur) => TimelineOps.replaceClipSource(cur, index, assetId: assetId, durationMs: r.durationMs, width: r.width, height: r.height));
    } finally {
      processing = null;
      _notify();
    }
  }

  /// Runs the frame jobs the AI Director queued (`process` on clips / overlays), one after another, on the phone.
  /// Each finished job swaps in its file and clears the flag; a failed one clears it and says why in the chat.
  Future<void> runPendingProcesses() async {
    while (true) {
      final ir = _ir;
      if (ir == null || _disposed) return;
      final ci = ir.clips.indexWhere((c) => c.process != null);
      final ov = ir.overlays.where((o) => o.process != null).firstOrNull;
      if (ci < 0 && ov == null) return;
      try {
        if (ci >= 0) {
          final job = ir.clips[ci].process!;
          if (job == 'reverse') {
            await reverseClip(ci);
          } else {
            await stabilizeClip(ci);
          }
        } else {
          await removeOverlayBackground(ov!.id);
          applyWithoutHistory((cur) => TimelineOps.clearOverlayProcess(cur, ov.id));
        }
      } catch (e) {
        messages.add(DirectorMessage(fromUser: false, text: 'I could not finish that on this phone: ${e is MediaEngineException ? e.message : e}'));
        applyWithoutHistory((cur) => ci >= 0 ? TimelineOps.clearClipProcess(cur, ci) : TimelineOps.clearOverlayProcess(cur, ov!.id));
        _notify();
      }
    }
  }

  /// Steadies shaky footage of clip [index] on the phone ([strength]: seconds of camera path smoothing).
  Future<void> stabilizeClip(int index, {double strength = 1}) async {
    final ir = _ir;
    if (ir == null || kIsWeb || processing != null) return;
    final c = ir.clips[index];
    if (isStillAsset(c.assetId)) throw MediaEngineException('INVALID_EDIT', 'A still does not shake.');
    final path = pathForAsset(c.assetId);
    if (path == null) throw MediaEngineException('FILE_NOT_FOUND', 'This clip is no longer on this phone.');
    processing = 'Stabilising clip ${index + 1}…';
    _notify();
    try {
      final out = await MediaEngineService.getProcessedPath('stab_${DateTime.now().millisecondsSinceEpoch}.mp4');
      final r = await MediaEngineService.stabilizeClip(sourcePath: path, startMs: c.sourceStartMs, endMs: c.sourceEndMs, outputPath: out, strength: strength);
      final assetId = 'stab_${DateTime.now().millisecondsSinceEpoch}';
      sourcePaths[assetId] = r.path;
      apply((cur) => TimelineOps.replaceClipSource(cur, index, assetId: assetId, durationMs: r.durationMs, width: r.width, height: r.height));
    } finally {
      processing = null;
      _notify();
    }
  }

  /// "Remove background" on an overlay: the person is cut out on the phone. Videos become a person-on-green copy
  /// keyed out as a full-frame layer; photos become a transparent PNG. Remote media is downloaded first.
  Future<void> removeOverlayBackground(String overlayId) async {
    final ir = _ir;
    if (ir == null || kIsWeb || processing != null) return;
    final o = ir.overlays.where((x) => x.id == overlayId).firstOrNull;
    if (o == null) throw MediaEngineException('INVALID_EDIT', 'That overlay no longer exists.');
    processing = 'Removing the background…';
    _notify();
    try {
      var path = localOverlayPath(o.source);
      final url = o.source['url'] as String?;
      if (path == null && url != null && url.startsWith('http')) {
        path = await AssetCache.instance.ensure(url, kind: o.isImage ? AssetKind.image : AssetKind.video);
      }
      if (path == null) throw MediaEngineException('FILE_NOT_FOUND', 'This overlay has no file on this phone yet.');
      final stamp = DateTime.now().millisecondsSinceEpoch;
      if (o.isImage) {
        final out = await MediaEngineService.removeImageBackground(sourcePath: path, outputPath: await MediaEngineService.getProcessedPath('cutout_$stamp.png'));
        final source = localOverlaySource(out, label: '${o.source['query'] ?? 'Photo'} (cut out)');
        // A cut-out photo floats above the video (transparent PNG; no key needed).
        apply((cur) => TimelineOps.replaceOverlaySource(
              TimelineOps.updateOverlay(cur, overlayId, fit: 'contain', layer: o.layer ?? const EditIrLayer(x: 0.5, y: 0.6, scale: 0.8)),
              overlayId,
              source,
            ));
      } else {
        final len = o.timelineEndMs - o.timelineStartMs;
        final r = await MediaEngineService.removeBackground(
          sourcePath: path,
          startMs: o.sourceStartMs,
          endMs: o.sourceStartMs + len,
          outputPath: await MediaEngineService.getProcessedPath('cutout_$stamp.mp4'),
        );
        final source = localOverlaySource(r.path, label: '${o.source['query'] ?? 'Clip'} (cut out)');
        apply((cur) => TimelineOps.replaceOverlaySource(
              TimelineOps.updateOverlay(cur, overlayId,
                  fit: 'contain',
                  sourceStartMs: 0,
                  layer: o.layer ?? const EditIrLayer(x: 0.5, y: 0.5, scale: 1),
                  chromaKey: const EditIrChromaKey(similarity: 0.32, smoothness: 0.12, spill: 0.6)),
              overlayId,
              source,
            ));
      }
    } finally {
      processing = null;
      _notify();
    }
  }

  /// True when [assetId] is a photo / freeze-frame still rather than a video.
  bool isStillAsset(String assetId) {
    final p = pathForAsset(assetId)?.toLowerCase() ?? '';
    return p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.png') || p.endsWith('.webp');
  }

  /// Freezes the frame under the playhead for [durationMs]: the exact frame is extracted on the phone and held.
  Future<void> freezeFrame({int durationMs = 2000}) async {
    final ir = _ir;
    if (ir == null || kIsWeb) return;
    final clip = ir.clips[TimelineOps.clipIndexAt(ir, playheadMs)];
    if (isStillAsset(clip.assetId)) throw MediaEngineException('INVALID_EDIT', 'This is already a still. Trim it to change how long it holds.');
    final path = pathForAsset(clip.assetId);
    if (path == null) throw MediaEngineException('FILE_NOT_FOUND', 'This clip is no longer on this phone.');
    final docs = await getApplicationDocumentsDirectory();
    final frames = await MediaEngineService.generateThumbnails(
      sourcePath: path,
      outputDir: '${docs.path}/stills/${DateTime.now().millisecondsSinceEpoch}',
      timesMs: [sourcePositionMs],
      maxWidth: 1920,
      exact: true,
    );
    if (frames.isEmpty) throw MediaEngineException('NATIVE_ERROR', 'The frame could not be captured.');
    final src = ir.sources.where((s) => s.assetId == clip.assetId).firstOrNull;
    final assetId = 'still_${DateTime.now().millisecondsSinceEpoch}';
    sourcePaths[assetId] = frames.first;
    final at = playheadMs;
    apply((cur) => TimelineOps.insertStill(cur, assetId: assetId, atMs: at, durationMs: durationMs, width: src?.width ?? 1080, height: src?.height ?? 1920));
  }

  /// Stickers the AI Director places reference `emoji:<emoji>` assets; they are drawn here, on the phone, before the
  /// timeline is shown or exported. Already-drawn ones are reused.
  Future<void> materializeEmojiStickers(MobileEditIr ir) async {
    if (kIsWeb) return;
    for (final o in ir.overlays) {
      final id = o.source['kind'] == 'asset' ? '${o.source['assetId']}' : '';
      if (!id.startsWith('emoji:')) continue;
      final existing = sourcePaths[id];
      if (existing != null && File(existing).existsSync()) continue;
      final emoji = id.substring('emoji:'.length);
      final docs = await getApplicationDocumentsDirectory();
      final name = emoji.runes.map((r) => r.toRadixString(16)).join('_');
      sourcePaths[id] = await renderEmojiSticker(emoji, '${docs.path}/stickers/emoji_$name.png');
    }
  }

  /// Drafts saved before 2026-10 kept gallery overlays as raw device paths (`kind: url|file`), which the server
  /// rejects. Turns them into asset references.
  MobileEditIr _migrateLocalOverlays(MobileEditIr ir) {
    var changed = false;
    final overlays = <EditIrOverlay>[];
    for (final o in ir.overlays) {
      final kind = o.source['kind'];
      final raw = '${o.source['url'] ?? o.source['path'] ?? ''}';
      // Online media keeps its URL (credits, server round trip); only raw device paths are migrated.
      final remote = raw.startsWith('http://') || raw.startsWith('https://');
      final path = kind == 'asset' || kind == 'stock_query' || remote ? null : localOverlayPath(o.source);
      if (path == null) {
        overlays.add(o);
      } else {
        changed = true;
        overlays.add(o.copyWith(source: localOverlaySource(path, label: o.source['query'] as String?)));
      }
    }
    var out = changed ? ir.copyWith(overlays: overlays) : ir;
    // Music and sound effects imported from the phone were stored as raw paths (`kind: file`) until 2026-11, which made
    // every later AI Director request fail (F-03). They become asset references too.
    final m = out.audio.music.firstOrNull;
    if (m != null && m.source['kind'] == 'file' && '${m.source['path'] ?? ''}'.isNotEmpty) {
      final label = (m.source['title'] ?? m.source['query']) as String?;
      out = TimelineOps.setMusicSource(out, {...localMediaSource('${m.source['path']}', label: label), 'title': ?label});
    }
    for (final e in out.audio.sfx.where((e) => e.source['kind'] == 'file' && '${e.source['path'] ?? ''}'.isNotEmpty).toList()) {
      out = TimelineOps.setSfxSource(out, e.id, localMediaSource('${e.source['path']}')..remove('query'));
    }
    return out;
  }

  /// Proxy file if available (e.g. 720p hardware-downscaled copy for fluid scrubbing), else the original source path.
  String? previewPathForAsset(String assetId) => proxyPaths[assetId] ?? pathForAsset(assetId);

  Future<void> _generateProxy(String assetId, String originalPath) async {
    if (kIsWeb) return;
    try {
      final dir = await getTemporaryDirectory();
      final proxyFile = '${dir.path}/proxy_${assetId}_${DateTime.now().millisecondsSinceEpoch}.mp4';
      final path = await MediaEngineService.generateProxy(
        sourcePath: originalPath,
        destPath: proxyFile,
        targetHeight: 720,
      );
      if (File(path).existsSync()) {
        proxyPaths[assetId] = path;
        _notify();
      }
    } catch (_) {
      // Non-fatal: if proxy creation fails, preview smoothly falls back to originalPath.
    }
  }

  /// Asset of the clip under the playhead (which video the preview must show).
  String get assetAtPlayhead {
    final ir = _ir;
    if (ir == null || ir.clips.isEmpty) return 'primary';
    return ir.clips[TimelineOps.clipIndexAt(ir, playheadMs)].assetId;
  }

  /// Source position shown in the preview for the current playhead.
  int get sourcePositionMs {
    final ir = _ir;
    if (ir == null) return 0;
    final c = ir.clips[TimelineOps.clipIndexAt(ir, playheadMs)];
    return (c.sourceStartMs + (playheadMs - c.timelineStartMs) * c.speed)
        .round()
        .clamp(c.sourceStartMs, c.sourceEndMs - 1);
  }

  String _assetPathForExport(String assetId, String primary) {
    if (assetId == 'primary') return primary;
    final path = sourcePaths[assetId];
    if (path == null || path.isEmpty) {
      throw MediaEngineException('FILE_NOT_FOUND', 'A clip on the timeline is no longer on this device. Remove it or add it again.');
    }
    return path;
  }

  // ── AI Director ────────────────────────────────────────────────────────────

  MediaAnalysis _analysis() {
    final m = meta!;
    return MediaAnalysis(
      durationMs: m.durationMs,
      width: m.displayWidth,
      height: m.displayHeight,
      fps: m.frameRate,
      words: words,
      silences: silences,
      faces: faces,
      beatsMs: beatsMs,
      intelligence: intelligence.isEmpty ? null : intelligence,
    );
  }

  Future<void> askDirector(String prompt) async {
    if (_ir == null || directorBusy || prompt.trim().isEmpty) return;
    // Re-sending the message whose turn just failed is a retry: no second copy of it in the chat.
    final lastUser = messages.lastIndexWhere((m) => m.fromUser);
    if (messages.isNotEmpty && messages.last.failed && lastUser >= 0 && messages[lastUser].text == prompt.trim()) {
      return retryLastDirectorTurn();
    }
    messages.add(DirectorMessage(fromUser: true, text: prompt.trim()));
    await _directorTurn(prompt, messages.length - 1);
  }

  String? _turnStatus(DirectorMessage m) {
    final r = m.response;
    if (m.fromUser || r == null || r.appliedOperations.isEmpty) return null;
    if (!m.applied) return 'proposed_not_applied';
    return m.appliedIr != null && _undoneDirectorStates.contains(m.appliedIr) ? 'undone' : 'applied';
  }

  /// "Try again" after a failed turn: resends the last thing the user said without adding it to the chat a second
  /// time; the failure reply it replaces is removed.
  Future<void> retryLastDirectorTurn() async {
    if (_ir == null || directorBusy) return;
    final i = messages.lastIndexWhere((m) => m.fromUser);
    if (i < 0) return;
    for (var j = messages.length - 1; j > i; j--) {
      if (messages[j].failed) messages.removeAt(j);
    }
    await _directorTurn(messages[i].text, i);
  }

  /// Sends [prompt] (already in the chat at [userIndex]) with the conversation before it as history.
  Future<void> _directorTurn(String prompt, int userIndex) async {
    final ir = _ir;
    if (ir == null) return;
    final history = [
      for (final m in messages.take(userIndex))
        // Failed turns are not part of the conversation the director should see.
        if (!m.failed)
          DirectorTurn(
            role: m.fromUser ? 'user' : 'assistant',
            content: m.fromUser ? m.text : (m.response?.reply ?? m.text),
            // What really happened to the turn's edits on this phone (F-16).
            status: _turnStatus(m),
            appliedOps: m.fromUser ? const [] : (m.response?.appliedOperations ?? const []),
          ),
    ];
    directorBusy = true;
    _notify();
    try {
      // Clips still being transcribed: wait a little (up to 10 s) so the Director hears them too (Phase 4).
      await _awaitClipAnalyses();
      // The editor stays usable while the Director thinks: edits made meanwhile are merged with its answer (F-01).
      final current = _ir ?? ir;
      final baseRevision = revision;
      final r = await director.direct(
        prompt: prompt,
        history: history,
        media: _analysis(),
        mediaList: _otherClipAnalyses(),
        analysisPending: _pendingAnalyses(),
        musicBeatsMs: await _musicBeatsOnTimeline(),
        projectId: projectId,
        calendarPieceId: pieceId,
        postId: postId,
        currentEditIR: current.toJson(),
        baseRevision: baseRevision,
      );
      r.editIr.validate();
      await materializeEmojiStickers(r.editIr);
      try {
        await materializeNarration(r.editIr);
      } on MediaEngineException catch (e) {
        // The edit still applies; the narration that could not be spoken is reported, not faked.
        messages.add(DirectorMessage(fromUser: false, text: 'I could not create the narration voice on this phone: ${e.message}'));
      }
      try {
        await materializeFreezeFrames(r.editIr);
      } on MediaEngineException catch (e) {
        messages.add(DirectorMessage(fromUser: false, text: 'I could not capture the frozen frame on this phone: ${e.message} Remove the freeze before exporting.'));
      }
      // The server decides what is applied without asking (autonomy + operation kinds, F-09); a proposal waits for
      // "Apply to timeline".
      final autoApply = r.autoApplied && r.appliedOperations.isNotEmpty;
      messages.add(
        DirectorMessage(
          fromUser: false,
          text: r.reply,
          response: r,
          baseIr: current,
          baseRevision: baseRevision,
          prompt: prompt,
        ),
      );
      if (autoApply) _applyDirectorMessage(messages.length - 1);
    } catch (e, st) {
      debugPrint('AI Director turn failed: $e\n$st');
      messages.add(DirectorMessage(fromUser: false, text: directorFailureText(e), error: e));
    } finally {
      directorBusy = false;
      _notify();
    }
  }

  /// A failed director turn in plain words, never a raw exception dump (the exception is kept in
  /// [DirectorMessage.error]): the server's own explanation when it gave one (a vague prompt, an edit it refused),
  /// otherwise what went wrong in general. Always starts with "I could not do that:", which the chat panel uses to
  /// offer "Try again".
  static String directorFailureText(Object e) => 'I could not do that: ${_failureReason(e)}';

  static String _failureReason(Object e) {
    const connection = 'the connection dropped for a moment.';
    const limit = 'the AI usage limit is reached for now. Try again a bit later.';
    const generic = 'something went wrong on my side.';
    if (e is ApiException) {
      if (e.isNetwork) return connection;
      if (e.kind == ApiErrorKind.rateLimited) return limit;
      if (e.isTransient) return generic;
      if (e.message.trim().isNotEmpty) return e.message.trim();
    }
    if (e is MediaEngineException) {
      return e.code == 'INVALID_EDIT_IR' ? 'my edit could not be applied on this phone, so your video is unchanged.' : e.message;
    }
    final raw = '$e'.toLowerCase();
    if (raw.contains('socket') || raw.contains('network') || raw.contains('connection') || raw.contains('timed out')) return connection;
    if (raw.contains('quota') || raw.contains('credit')) return limit;
    return generic;
  }

  /// Applies the Director's answer in [messages] at [index]: as is when the timeline did not change since the
  /// request, otherwise merged onto the creator's newer edits ([TimelineMerge]). Both sides changing the cuts is not
  /// merged: the message is marked so the chat offers a choice. Returns whether the timeline changed.
  bool _applyDirectorMessage(int index) {
    final m = messages[index];
    final r = m.response;
    final current = _ir;
    if (r == null || current == null || m.applied) return false;
    final base = m.baseIr;
    if (base == null || m.baseRevision == revision || identical(base, current)) {
      _applyDirector(r, r.editIr);
      messages[index] = m.copyWith(applied: true, appliedIr: _ir);
      _reportApplied(r, _ir!);
      return true;
    }
    final merged = TimelineMerge.merge(base: base, mine: current, theirs: r.editIr);
    if (merged.structuralConflict) {
      messages[index] = m.copyWith(structuralConflict: true);
      return false;
    }
    _applyDirector(r, merged.ir);
    messages[index] = m.copyWith(applied: true, appliedIr: _ir);
    _reportApplied(r, _ir!, conflicts: merged.conflicts.length);
    final notes = merged.conflicts.toSet();
    messages.add(DirectorMessage(
      fromUser: false,
      text: notes.isEmpty
          ? 'I added my changes on top of the edits you made in the meantime.'
          : 'I added my changes on top of the edits you made in the meantime. ${notes.join(' ')}',
    ));
    return true;
  }

  /// The choice offered when the creator and the Director both changed the cuts.
  /// [useDirectors]: the Director's whole version replaces the timeline (one undo brings the creator's back).
  void resolveDirectorConflict(int index, {required bool useDirectors}) {
    final m = messages[index];
    final r = m.response;
    if (r == null || !m.structuralConflict) return;
    if (useDirectors) _applyDirector(r, r.editIr);
    messages[index] = m.copyWith(structuralConflict: false, applied: useDirectors, appliedIr: useDirectors ? _ir : null);
    _notify();
  }

  /// "Re-run on my latest edit": the same request again, made from the timeline as it is now.
  Future<void> rerunDirectorOnLatest(int index) async {
    final m = messages[index];
    final prompt = m.prompt;
    if (prompt == null || directorBusy) return;
    messages[index] = m.copyWith(structuralConflict: false);
    messages.add(DirectorMessage(fromUser: true, text: prompt));
    await _directorTurn(prompt, messages.length - 1);
  }

  void _applyDirector(DirectorResponse r, MobileEditIr next) {
    final ir = _ir;
    if (ir == null) return;
    mediaCredits.addAll(r.credits);
    // Keep the source metadata if the server omitted it, so the next turn stays valid.
    final withSources = next.sources.isNotEmpty
        ? next
        : MobileEditIr(
            projectId: next.projectId,
            canvas: next.canvas,
            durationMs: next.durationMs,
            sources: ir.sources,
            watermark: next.watermark,
            itemMeta: next.itemMeta,
            clips: next.clips,
            overlays: next.overlays,
            captions: next.captions,
            zooms: next.zooms,
            audio: next.audio,
            effects: next.effects,
          );
    _push(ir);
    _liveStart = null;
    _ir = _withGeneratedDurations(withSources);
    if (export != null && !export!.running) export = null;
    // Download what the Director picked (B-roll, photos, music, SFX) right away, with progress on screen.
    unawaited(prefetchRemoteMedia());
    // Heavy jobs the Director queued (reverse / stabilise / cut-out) run on the phone now.
    if (withSources.clips.any((c) => c.process != null) || withSources.overlays.any((o) => o.process != null)) {
      unawaited(runPendingProcesses());
    }
    playheadMs = playheadMs.clamp(0, withSources.durationMs);
    selectedClip = null;
  }

  /// Applies a proposal the director asked the user to confirm. Work done since the proposal was made is kept
  /// (merged), never overwritten (F-02).
  void applyProposal(int messageIndex) {
    final m = messages[messageIndex];
    if (m.response == null || m.applied) return;
    _applyDirectorMessage(messageIndex);
    _notify();
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  /// Resolves remote B-roll and music to local files, then renders on the device.
  /// Resolution / frame rate / quality picked on the export sheet; kept for the session.
  ExportSettings exportSettings = ExportSettings.studioDefault;

  Future<void> startExport() async {
    if (_ir == null || sourcePath == null || (export?.running ?? false)) return;
    // Everything online is resolved and downloaded first (usually already cached), so nothing is skipped silently.
    // It can rewrite sources (search phrase → file), so the timeline is read after it.
    await prefetchRemoteMedia();
    final ir = _ir;
    final src = sourcePath;
    if (ir == null || src == null) return;
    // Frame jobs (reverse / stabilise / cut-out) change the files the export reads: wait for them.
    if (processing != null || ir.clips.any((c) => c.process != null) || ir.overlays.any((o) => o.process != null)) {
      export = ExportState(error: MediaEngineException('PROCESSING', '${processing ?? 'Footage is still being processed'}. Export again when it is done.'));
      _notify();
      return;
    }
    final warnings = <String>[];
    if (kIsWeb) {
      // No renderer runs in the browser: say so instead of reporting the untouched source as an export (F-12).
      export = ExportState(
        error: MediaEngineException('NOT_SUPPORTED_ON_WEB', 'Exporting runs on the phone app. Open this draft on your phone to export it.'),
      );
      _notify();
      return;
    }
    export = ExportState(stage: 'Preparing media…');
    _notify();
    try {
      final overlayPaths = <String, String>{};
      final usedUrls =
          <String>[]; // resolved remote media in this export, for the credits
      var working = ir;
      await materializeEmojiStickers(ir);
      for (final o in ir.overlays) {
        final kind = o.source['kind'];
        String? url = kind == 'url' ? o.source['url'] as String? : null;
        if (kind == 'stock_query' && !o.isImage) {
          try {
            final hit = await director.resolveStockVideo(
              '${o.source['query'] ?? ''}',
            );
            url = hit?.url;
            if (hit?.credit != null) mediaCredits[hit!.url] = hit.credit!;
          } on StockSearchException catch (e) {
            // Providers failed: export the rest and say why this B-roll is missing.
            warnings.add('Skipped B-roll "${o.source['query'] ?? o.id}": ${e.warnings.take(2).join('; ')}');
            working = TimelineOps.removeOverlay(working, o.id);
            continue;
          }
        }
        if (kind == 'asset' && o.source['assetId'] == 'primary') {
          overlayPaths[o.id] = src;
          continue;
        }
        // Gallery photos / videos and stickers are files on this phone.
        final local = localOverlayPath(o.source);
        if (local != null) {
          if (!File(local).existsSync()) {
            warnings.add('Skipped "${o.source['query'] ?? o.id}": the file is no longer on this phone.');
            working = TimelineOps.removeOverlay(working, o.id);
          } else {
            overlayPaths[o.id] = local;
            if (url != null && url.startsWith('http')) usedUrls.add(url); // cached stock media still needs its credit
          }
          continue;
        }
        if (url == null) {
          warnings.add(
            'Skipped B-roll "${o.source['query'] ?? o.id}": no matching clip was found.',
          );
          working = TimelineOps.removeOverlay(working, o.id);
          continue;
        }
        export = ExportState(stage: 'Downloading B-roll…', warnings: warnings);
        _notify();
        try {
          // Shared asset cache: usually already downloaded when the clip was added or the Director picked it;
          // the cache keeps the right file type for the renderer.
          overlayPaths[o.id] = await AssetCache.instance.ensure(url, kind: o.isImage ? AssetKind.image : AssetKind.video);
          usedUrls.add(url);
        } catch (e) {
          warnings.add(
            'Skipped B-roll "${o.source['query'] ?? o.id}": could not download media ($e).',
          );
          working = TimelineOps.removeOverlay(working, o.id);
        }
      }
      // The renderer refuses overlapping full-screen cutaways (the whole export would fail): shorten them instead.
      final (resolved, shortened) = TimelineOps.resolveCutawayOverlaps(working);
      if (shortened > 0) {
        working = resolved;
        warnings.add('$shortened full-screen B-roll clip${shortened == 1 ? ' ran' : 's ran'} into the next one and '
            '${shortened == 1 ? 'was' : 'were'} shortened. Make one picture-in-picture to show both.');
      }
      final musicPaths = <String, String>{};
      for (final m in working.audio.music) {
        final kind = m.source['kind'];
        if (kind == 'asset' || kind == 'file') {
          // The creator's own track, on this phone (F-04: it used to be dropped as "could not be found").
          final local = localOverlayPath(m.source);
          final name = '${m.source['title'] ?? m.source['query'] ?? 'your music file'}';
          if (local == null || !File(local).existsSync()) {
            warnings.add('Music "$name" is no longer on this phone, so the video was exported without it. Add it again to keep it.');
            working = TimelineOps.removeMusic(working, id: m.id);
          } else {
            musicPaths[m.id] = local;
          }
          continue;
        }
        String? url = kind == 'url' ? m.source['url'] as String? : null;
        final query = '${m.source['query'] ?? ''}';
        if (kind == 'stock_query') {
          final t = await director.resolveMusicTrack(query);
          url = t?.url;
          if (t?.credit != null) mediaCredits[t!.url] = t.credit!;
        } else if (url != null &&
            !mediaCredits.containsKey(url) &&
            query.isNotEmpty) {
          // Director-picked catalogue track: look up its credit line (best effort).
          try {
            final t = await director.resolveMusicTrack(query, preferUrl: url);
            if (t?.credit != null) mediaCredits[url] = t!.credit!;
          } catch (_) {}
        }
        if (url == null) {
          warnings.add(
            'Music "${m.source['query'] ?? ''}" could not be found, so the video was exported without it.',
          );
          working = TimelineOps.removeMusic(working, id: m.id);
          continue;
        }
        export = ExportState(stage: 'Downloading music…', warnings: warnings);
        _notify();
        try {
          musicPaths[m.id] = await AssetCache.instance.ensure(url, kind: AssetKind.audio);
          usedUrls.add(url);
        } catch (e) {
          warnings.add(
            'Background music "${m.source['title'] ?? m.source['query'] ?? m.id}" could not be downloaded ($e). Exporting without it.',
          );
          working = TimelineOps.removeMusic(working, id: m.id);
        }
      }
      final sfxPaths = <String, String>{};
      final keptSfx = <EditIrSfx>[];
      for (final e in working.audio.sfx) {
        final kind = e.source['kind'];
        if (kind == 'asset' || kind == 'file') {
          final local = localOverlayPath(e.source);
          if (local == null || !File(local).existsSync()) {
            warnings.add('Sound effect "${e.credit ?? e.id}" is no longer on this phone and was left out.');
          } else {
            sfxPaths[e.id] = local;
            keptSfx.add(e);
          }
          continue;
        }
        final url = e.source['url'] as String?;
        if (url == null || !url.startsWith('https://')) {
          warnings.add('Skipped a sound effect with no downloadable file.');
          continue;
        }
        try {
          sfxPaths[e.id] = await AssetCache.instance.ensure(url, kind: AssetKind.audio);
          keptSfx.add(e);
          if (e.credit != null) mediaCredits[url] = e.credit!;
        } catch (_) {
          warnings.add(
            'A sound effect could not be downloaded and was left out.',
          );
        }
      }
      if (keptSfx.length != working.audio.sfx.length) {
        final a = working.audio;
        working = MobileEditIr(
          projectId: working.projectId,
          canvas: working.canvas,
          durationMs: working.durationMs,
          clips: working.clips,
          sources: working.sources,
          overlays: working.overlays,
          captions: working.captions,
          zooms: working.zooms,
          effects: working.effects,
          audio: EditIrAudio(
            originalVolumeDb: a.originalVolumeDb,
            music: a.music,
            speechRangesMs: a.speechRangesMs,
            sfx: keptSfx,
            voiceovers: a.voiceovers,
          ),
          watermark: working.watermark,
          itemMeta: working.itemMeta,
        );
      }
      String? watermarkPath;
      final wm = working.watermark;
      if (wm != null) {
        if (wm.localPath != null && File(wm.localPath!).existsSync()) {
          watermarkPath = wm.localPath;
        } else {
          try {
            export = ExportState(stage: 'Downloading logo…', warnings: warnings);
            _notify();
            watermarkPath = await AssetCache.instance.ensure(wm.imageUrl, kind: AssetKind.image);
          } catch (_) {
            warnings.add(
              'The brand logo could not be downloaded, so the video was exported without the watermark.',
            );
            working = working.withWatermark(null);
          }
        }
      }
      var fontPaths = const <String, String>{};
      if (working.captions.isNotEmpty) {
        export = ExportState(stage: 'Preparing caption fonts…', warnings: warnings);
        _notify();
        final (paths, fontWarnings) = await CaptionFonts.resolveForExport(working);
        fontPaths = paths;
        warnings.addAll(fontWarnings);
      }
      // The renderer reads local files only: stock clips placed on the main track are downloaded first.
      // A main clip cannot be skipped like B-roll, so a failed download stops the export with its reason.
      final assetPaths = <String, String>{};
      for (final id in working.assetIds) {
        final path = _assetPathForExport(id, src);
        if (path.startsWith('http://') || path.startsWith('https://')) {
          export = ExportState(stage: 'Downloading clips…', warnings: warnings);
          _notify();
          assetPaths[id] = await AssetCache.instance.ensure(path, kind: AssetKind.video);
          usedUrls.add(path);
        } else {
          assetPaths[id] = path;
        }
      }
      // Voiceover recordings are local files referenced by asset id.
      for (final v in working.audio.voiceovers) {
        final path = sourcePaths[v.assetId];
        if (path == null || !File(path).existsSync()) {
          throw MediaEngineException('FILE_NOT_FOUND', 'A voiceover recording is no longer on this phone. Record it again or remove it from the timeline.');
        }
        assetPaths[v.assetId] = path;
      }
      final out = await MediaEngineService.getOutputVideoPath(
        'export_${DateTime.now().millisecondsSinceEpoch}.mp4',
      );
      export = ExportState(stage: 'Rendering…', warnings: warnings);
      _notify();
      final done = Completer<void>();
      _renderSub =
          MediaEngineService.renderEditIr(
            editIr: working,
            outputPath: out,
            // Each clip renders from its own file; only the original video is `primary`.
            assetPaths: assetPaths,
            overlayPaths: overlayPaths,
            musicPaths: musicPaths,
            watermarkPath: watermarkPath,
            sfxPaths: sfxPaths,
            fontPaths: fontPaths,
            settings: exportSettings,
          ).listen(
            (p) {
              export = ExportState(
                progress: p.progress,
                stage: p.state == RenderState.completed ? 'Done' : 'Rendering…',
                result: p.result,
                warnings: [...warnings, ...?p.result?.warnings],
                credits: {for (final u in usedUrls) mediaCredits[u]}
                    .whereType<String>()
                    .toList(),
              );
              _notify();
            },
            onError: (Object e) {
              export = ExportState(error: e, warnings: warnings);
              _notify();
              if (!done.isCompleted) done.complete();
            },
            onDone: () {
              if (!done.isCompleted) done.complete();
            },
            cancelOnError: true,
          );
      await done.future;
    } catch (e) {
      export = ExportState(error: e, warnings: warnings);
      _notify();
    }
  }

  Future<void> cancelExport() async {
    await _renderSub?.cancel();
    _renderSub = null;
    export = null;
    _notify();
  }

  void clearExport() {
    export = null;
    _notify();
  }
}
