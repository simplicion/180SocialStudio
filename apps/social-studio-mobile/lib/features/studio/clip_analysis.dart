import '../../core/native_engine/edit_ir.dart';
import '../../core/native_engine/media_engine_service.dart';
import '../../core/native_engine/media_intelligence.dart';
import '../../core/network/audio_transcription_service.dart';
import '../director/ai_director_service.dart';
import 'studio_controller.dart' show TranscriptState;

/// What the phone knows about ONE source file of the timeline (editor overhaul Phase 4, audit F-10): the AI Director
/// gets this for every clip, not only the first, so clips 2..N are captioned, cleaned and ducked from their own words.
/// All times are SOURCE ms of that file.
class ClipAnalysis {
  ClipAnalysis({required this.path, this.info});

  final String path;
  VideoMetadata? info;

  /// queued -> running -> ready | failed (the transcript; the other parts are optional and may stay null).
  TranscriptState transcriptState = TranscriptState.idle;
  bool queued = false;
  Transcript? transcript;
  Object? transcriptError;
  List<SilenceRange>? silences;
  List<FaceSample>? faces;
  List<int>? beatsMs;
  MediaIntelligence intelligence = MediaIntelligence();

  /// Still being analysed: the Director is told, and a turn waits a little for it.
  bool get pending => queued || transcriptState == TranscriptState.running;

  List<TranscriptWord> get words => transcript?.words ?? const [];

  /// The request form for [assetId] (one file can back several assets, e.g. added twice).
  MediaAnalysis? toAnalysis(String assetId) {
    final i = info;
    if (i == null) return null;
    return MediaAnalysis(
      assetId: assetId,
      durationMs: i.durationMs,
      width: i.displayWidth,
      height: i.displayHeight,
      fps: i.frameRate,
      words: words,
      silences: silences,
      faces: faces,
      beatsMs: beatsMs,
      intelligence: intelligence.isEmpty ? null : intelligence,
    );
  }
}
