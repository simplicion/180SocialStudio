import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint;

import '../../core/config/app_config.dart';
import '../../core/native_engine/media_engine_service.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/network/audio_transcription_service.dart';
import '../../core/network/device_registration.dart';
import '../../core/util/json.dart';

class DirectorTurn {
  DirectorTurn({required this.role, required this.content, this.status, this.appliedOps = const []});
  final String role; // user | assistant
  final String content;

  /// Assistant turns: applied | proposed_not_applied | undone (what really became of it on this phone, F-16).
  final String? status;

  /// The changes the turn made (the server's `appliedOperations`).
  final List<String> appliedOps;

  Json toJson() => {
        'role': role,
        'content': content,
        'status': ?status,
        if (appliedOps.isNotEmpty)
          'appliedOps': [for (final o in appliedOps.take(30)) o.length > 300 ? o.substring(0, 300) : o],
      };
}

class SilenceRange {
  SilenceRange(this.startMs, this.endMs);
  final int startMs;
  final int endMs;
  Json toJson() => {'startMs': startMs, 'endMs': endMs};
}

/// The on-device analysis of the source clip sent with every turn (contract §2.1 `media`).
class MediaAnalysis {
  MediaAnalysis({
    this.assetId = 'primary',
    required this.durationMs,
    required this.width,
    required this.height,
    this.fps,
    this.words = const [],
    this.silences,
    this.faces,
    this.beatsMs,
    this.intelligence,
  });

  /// On-device scene cuts, on-screen text, scene labels and loudness (all optional, computed on the phone).
  final MediaIntelligence? intelligence;

  final String assetId;
  final int durationMs;
  final int width;
  final int height;
  final double? fps;
  final List<TranscriptWord> words;
  final List<SilenceRange>? silences;

  /// On-device ML Kit face track (source ms); the director centres reframe crops and zooms on it.
  final List<FaceSample>? faces;

  /// On-device beat/onset times of the clip's audio (source ms).
  final List<int>? beatsMs;

  bool get hasTranscript => words.isNotEmpty;

  Json toJson() => compact({
        'assetId': assetId,
        'durationMs': durationMs,
        'width': width,
        'height': height,
        'fps': fps,
        'transcript': words.isEmpty ? null : {'words': words.map((w) => w.toJson()).toList()},
        'silences': silences?.map((s) => s.toJson()).toList(),
        'faces': faces == null || faces!.isEmpty ? null : faces!.map((f) => f.toJson()).toList(),
        'beatsMs': beatsMs == null || beatsMs!.isEmpty ? null : beatsMs,
        ...?intelligence?.toJson(),
      });
}

class DirectorResponse {
  DirectorResponse({
    required this.plannerSource,
    required this.plannerReason,
    required this.summary,
    required this.reply,
    required this.operations,
    required this.appliedOperations,
    required this.rejectedOperations,
    required this.warnings,
    required this.requiresConfirmation,
    required this.editIrJson,
    required this.editIr,
    this.credits = const {},
    this.message = '',
    this.phase = 'chat',
    this.quickReplies = const [],
    this.proposedPlan = const [],
    this.autoApplied = false,
    this.baseRevision,
    this.diffSummary,
    this.scopeMode,
    this.runId,
  });

  /// Id of this turn in the server's agent run log (for Apply / Undo feedback).
  final String? runId;

  /// What the turn changes, in plain words, for the proposal card (Phase 3.3); null for older servers.
  final DirectorDiffSummary? diffSummary;

  /// What the request was understood to be: modify_existing | add_new | full_edit | question | ambiguous.
  final String? scopeMode;

  final String plannerSource;
  final String? plannerReason;
  final String summary;

  /// What the director "said" as conversation history: the chat message plus the plan on the table
  /// (`<message>` + `Plan:` + numbered steps), so a later "yes" executes exactly that plan.
  final String reply;

  /// The short chat message shown in the bubble (1-4 sentences).
  final String message;

  /// recommend | gather | confirm | done | chat.
  final String phase;

  /// 0-3 one-tap answers (chips) under the latest director message.
  final List<String> quickReplies;

  /// Steps the director will do once the creator agrees (plan card). Nothing is applied for a pure proposal.
  final List<String> proposedPlan;

  bool get isProposal => proposedPlan.isNotEmpty && phase != 'done';
  final List<Json> operations;
  final List<String> appliedOperations;
  final List<String> rejectedOperations;
  final List<String> warnings;
  final bool requiresConfirmation;

  /// The server's decision to apply this turn without asking (editing autonomy + operation kinds). The phone follows
  /// it instead of deriving its own rule (audit F-09).
  final bool autoApplied;

  /// The timeline revision the request was made from (echoed by the server), or null for older servers.
  final int? baseRevision;

  /// Raw `editIR`, sent back unchanged as `currentEditIR` on the next turn.
  final Json editIrJson;
  final MobileEditIr editIr;

  /// Credit lines of the stock B-roll and music the director placed, by media URL.
  final Map<String, String> credits;

  bool get isDeterministic => plannerSource == 'deterministic';

  factory DirectorResponse.fromData(Json d) {
    final ir = jMap(d['editIR']);
    if (ir.isEmpty) {
      throw ApiException(kind: ApiErrorKind.server, message: 'The AI Director returned no timeline (editIR).');
    }
    MobileEditIr parsed;
    try {
      parsed = MobileEditIr.fromJson(ir);
    } on MediaEngineException catch (e) {
      throw ApiException(kind: ApiErrorKind.server, code: e.code, message: 'The AI Director returned an invalid timeline: ${e.message}');
    }
    final summary = jStr(d['summary']) ?? '';
    final message = (jStr(d['reply']) ?? summary).trim();
    final plan = jStrList(d['proposedPlan']).where((s) => s.trim().isNotEmpty).take(8).toList();
    return DirectorResponse(
      plannerSource: jStr(d['plannerSource']) ?? 'unknown',
      plannerReason: jStr(d['plannerReason']),
      summary: summary,
      message: message,
      reply: historyText(message, plan),
      phase: jStr(d['phase']) ?? (jBool(d['requiresConfirmation']) ? 'confirm' : 'chat'),
      quickReplies: jStrList(d['quickReplies']).where((s) => s.trim().isNotEmpty).take(3).toList(),
      proposedPlan: plan,
      operations: jList(d['operations'], (m) => m),
      appliedOperations: jStrList(d['appliedOperations']),
      rejectedOperations: jStrList(d['rejectedOperations']),
      warnings: jStrList(d['warnings']),
      requiresConfirmation: jBool(d['requiresConfirmation']),
      autoApplied: jBool(d['autoApplied']),
      baseRevision: (d['baseRevision'] as num?)?.toInt(),
      diffSummary: d['diffSummary'] is Map ? DirectorDiffSummary.fromJson(jMap(d['diffSummary'])) : null,
      scopeMode: jStr(jMap(d['scope'])['mode']),
      runId: jStr(d['runId']),
      editIrJson: ir,
      editIr: parsed,
      credits: {
        for (final c in jList(d['credits'], (m) => m))
          if (jStr(c['url']) != null && jStr(c['attribution']) != null) jStr(c['url'])!: jStr(c['attribution'])!,
      },
    );
  }
}

/// "+2 zooms · 12 captions restyled · music −16 → −22 dB · nothing removed" (server `diffSummary`).
class DirectorDiffSummary {
  DirectorDiffSummary({required this.text, this.changes = const [], this.removed = 0, this.cutSec = 0, this.destructive = false});
  final String text;
  final List<String> changes;

  /// Items the turn removes, and seconds of footage it cuts: highlighted on the card.
  final int removed;
  final double cutSec;
  final bool destructive;

  factory DirectorDiffSummary.fromJson(Json j) => DirectorDiffSummary(
        text: jStr(j['text']) ?? '',
        changes: jStrList(j['changes']),
        removed: (j['removed'] as num?)?.toInt() ?? 0,
        cutSec: (j['cutSec'] as num?)?.toDouble() ?? 0,
        destructive: jBool(j['destructive']),
      );
}

/// An assistant turn as history: the message plus the plan it proposed (the server reads the plan back
/// from the last assistant turn when the creator says "yes").
String historyText(String message, List<String> plan) {
  if (plan.isEmpty) return message;
  final b = StringBuffer(message)..write('\nPlan:');
  for (var i = 0; i < plan.length; i++) {
    b.write('\n${i + 1}. ${plan[i]}');
  }
  return b.toString();
}

class StockVideoResult {
  StockVideoResult({
    required this.id,
    required this.downloadUrl,
    this.previewUrl,
    this.thumbnailUrl,
    this.durationSec,
    this.width,
    this.height,
    required this.provider,
    this.author,
    this.attribution,
  });

  final String id;
  final String downloadUrl;

  /// Credit line (free providers: licence + author; always kept for the post caption).
  final String? attribution;
  final String? previewUrl;
  final String? thumbnailUrl;
  final double? durationSec;
  final int? width;
  final int? height;
  final String provider; // 'pexels' | 'pixabay'
  final String? author;
}

class StockPhotoResult {
  StockPhotoResult({required this.id, required this.url, required this.thumbnailUrl, required this.title, this.attribution});
  final String id;
  final String url;
  final String thumbnailUrl;
  final String title;
  final String? attribution;
}

class StockAudioResult {
  StockAudioResult({
    required this.id,
    required this.url,
    required this.title,
    this.durationSec,
    required this.provider,
    required this.kind, // 'music' | 'sfx'
    this.attribution,
  });

  final String id;
  final String url;
  final String title;
  final double? durationSec;
  final String provider;
  final String kind;
  final String? attribution;
}

/// `POST /api/v1/media-editor/ai-direct` (docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md).
///
/// Every failure is thrown; there is no fallback edit plan.
class AiDirectorService {
  AiDirectorService(this._api, this._device);

  final ApiClient _api;
  final DeviceRegistration _device;

  static const path = '/api/v1/media-editor/ai-direct';

  /// Renderer features this app version draws (contract `rendererCapabilities`); the Director uses nothing else.
  /// Switched on 2026-11-06 at the owner's request: the Android export and the native preview draw all four, the
  /// default Dart preview draws the moving crop, text transform and J/L cuts (it plays no music, as before). Not yet
  /// checked on a device: remove one here to switch it off again.
  static const rendererCapabilities = <String>['cropKeyframes', 'jlCut', 'textTransform', 'multiMusic'];
  static const maxHistory = 20;

  /// Tells the project's agent memory that a Director turn was applied or undone (`POST
  /// /social-media/projects/:id/agent-memory/feedback`). Telemetry: a failure is logged, never shown or retried.
  Future<void> sendFeedback({
    required String projectId,
    required bool accepted,
    String? runId,
    required String summary,
    List<String> operations = const [],
  }) async {
    try {
      await _api.post('/api/v1/social-media/projects/${Uri.encodeComponent(projectId)}/agent-memory/feedback', body: {
        'accepted': accepted,
        'agent': 'director',
        'runId': ?runId,
        'summary': summary.length > 300 ? summary.substring(0, 300) : summary,
        'operations': operations.take(30).map((o) => o.length > 40 ? o.substring(0, 40) : o).toList(),
      });
    } catch (e) {
      debugPrint('AI Director feedback not recorded: $e');
    }
  }

  static Json buildRequest({
    required String prompt,
    required List<DirectorTurn> history,
    required MediaAnalysis media,
    String? projectId,
    Json? currentEditIR,
    String? calendarPieceId,
    String? postId,
    String? intent,
    int? baseRevision,
    List<MediaAnalysis> mediaList = const [],
    List<String> analysisPending = const [],
    List<int> musicBeatsMs = const [],
  }) {
    final trimmed = history.length > maxHistory ? history.sublist(history.length - maxHistory) : history;
    return {
      'prompt': prompt.length > 2000 ? prompt.substring(0, 2000) : prompt,
      'history': trimmed.map((t) => t.toJson()).toList(),
      'projectId': ?projectId,
      'intent': ?intent,
      'calendarPieceId': ?calendarPieceId,
      'postId': ?postId,
      'media': media.toJson(),
      'currentEditIR': currentEditIR,
      'baseRevision': ?baseRevision,
      // Every other source on the timeline, with its own analysis (Phase 4); the server caps the list at 20.
      if (mediaList.isNotEmpty) 'mediaList': mediaList.take(20).map((m) => m.toJson()).toList(),
      if (analysisPending.isNotEmpty) 'analysisPending': analysisPending.take(20).toList(),
      // Beats of the music bed(s) on the timeline (Phase 6.4): a whole edit places zooms and cuts on them.
      if (musicBeatsMs.isNotEmpty) 'musicBeatsMs': musicBeatsMs.take(5000).toList(),
      // What this phone's renderer draws; the Director uses nothing else (Phase 6).
      if (rendererCapabilities.isNotEmpty) 'rendererCapabilities': rendererCapabilities,
    };
  }

  Future<DirectorResponse> direct({
    required String prompt,
    required List<DirectorTurn> history,
    required MediaAnalysis media,
    String? projectId,
    String? calendarPieceId,
    String? postId,
    String? intent,
    Json? currentEditIR,
    int? baseRevision,
    List<MediaAnalysis> mediaList = const [],
    List<String> analysisPending = const [],
    List<int> musicBeatsMs = const [],
    CancelToken? cancelToken,
  }) async {
    if (prompt.trim().isEmpty && intent != 'greet') {
      throw ApiException(kind: ApiErrorKind.validation, message: 'Tell the director what to change.');
    }
    await _device.ensureToken();
    final body = buildRequest(
      prompt: prompt.trim(),
      history: history,
      media: media,
      projectId: projectId,
      calendarPieceId: calendarPieceId,
      postId: postId,
      intent: intent,
      currentEditIR: currentEditIR,
      baseRevision: baseRevision,
      mediaList: mediaList,
      analysisPending: analysisPending,
      musicBeatsMs: musicBeatsMs,
    );
    Future<Json> call() => _api.post(path,
        body: body, device: true, timeout: AppConfig.aiReceiveTimeout, cancelToken: cancelToken);
    Json r;
    try {
      r = await call();
    } on ApiException catch (e) {
      if (e.kind != ApiErrorKind.deviceRequired) rethrow;
      await _device.ensureToken(forceRenew: true);
      r = await call();
    }
    if (r['success'] != true) throw ApiException.fromResponse(200, r);
    return DirectorResponse.fromData(jMap(r['data']));
  }

  static String? _firstHttpUrl(Object? list, List<String> keys) {
    if (list is! List) return null;
    for (final item in list.whereType<Map>()) {
      for (final k in keys) {
        final v = jStr(item[k]);
        if (v != null && v.startsWith('http')) return v;
      }
    }
    return null;
  }

  /// Free stock photos (Pexels / Pixabay / other free sources) for photo overlays. Errors propagate so the
  /// UI can show them with a retry.
  /// 3D stickers (Fluent Emoji, MIT) by name; popular picks for an empty query. Reuses the photo result shape.
  Future<List<StockPhotoResult>> searchStickers(String query) async {
    final r = await _api.get('/api/v1/media-editor/stock/stickers', query: {'query': query, 'limit': 30});
    return [
      for (final s in (r['stickers'] as List?)?.whereType<Map>() ?? const <Map>[])
        if (jStr(s['url']) case final url? when url.startsWith('https://'))
          StockPhotoResult(
            id: jStr(s['id']) ?? url,
            url: url,
            thumbnailUrl: jStr(s['previewUrl']) ?? url,
            title: jStr(s['title']) ?? query,
            attribution: jStr(s['attribution']),
          ),
    ];
  }

  Future<List<StockPhotoResult>> searchStockPhotos(String query, {String orientation = 'portrait'}) async {
    final r = await _api.get('/api/v1/media-editor/stock/unified', query: {
      'query': query,
      'type': 'photo',
      'orientation': orientation,
      'perPage': 24,
    });
    final list = <StockPhotoResult>[];
    for (final p in (r['unifiedPhotos'] as List?)?.whereType<Map>() ?? const <Map>[]) {
      final url = jStr(p['downloadUrl']) ?? jStr(p['url']);
      if (url == null || !url.startsWith('https://')) continue;
      final author = jStr(p['photographer']) ?? jStr(p['user']);
      final provider = jStr(p['provider']) ?? 'stock';
      list.add(StockPhotoResult(
        id: jStr(p['id']) ?? 'img_${list.length}',
        url: url,
        thumbnailUrl: jStr(p['thumbnailUrl']) ?? url,
        title: jStr(p['title']) ?? query,
        attribution: jStr(p['attribution']) ?? (author == null ? null : 'Photo: $author / $provider'),
      ));
    }
    return list;
  }

  /// Free stock B-roll (Pexels, Pixabay and the keyless free sources). Request and provider failures are thrown
  /// (with the providers' own messages) so the B-roll sheet can show them; an empty list means a real "no match".
  Future<List<StockVideoResult>> searchStockVideos(String query, {String orientation = 'portrait'}) async {
    final r = await _api.get('/api/v1/media-editor/stock/unified', query: {
      'query': query,
      'type': 'video',
      'orientation': orientation,
      'perPage': 18,
      'shape': 'unified',
    });
    final list = <StockVideoResult>[];
    for (final v in (r['unifiedVideos'] as List?)?.whereType<Map>() ?? const <Map>[]) {
      final downloadUrl = jStr(v['downloadUrl']) ?? jStr(v['previewVideoUrl']) ?? _firstHttpUrl(v['video_files'], ['link']);
      if (downloadUrl == null || !downloadUrl.startsWith('https://')) continue;
      final id = jStr(v['id']) ?? 'vid_${list.length}';
      list.add(StockVideoResult(
        id: id,
        downloadUrl: downloadUrl,
        previewUrl: jStr(v['previewVideoUrl']) ?? downloadUrl,
        thumbnailUrl: jStr(v['thumbnailUrl']) ?? jStr(v['image']) ?? jStr(v['picture_url']),
        durationSec: ((v['durationSec'] ?? v['duration']) as num?)?.toDouble(),
        width: (v['width'] as num?)?.toInt(),
        height: (v['height'] as num?)?.toInt(),
        provider: jStr(v['provider']) ?? 'stock',
        author: jStr(v['photographer']) ?? jStr(v['user']) ?? 'Creator',
        attribution: jStr(v['attribution']),
      ));
    }
    final warnings = (r['warnings'] as List?)?.map((w) => '$w').where((w) => w.isNotEmpty).toList() ?? const <String>[];
    if (list.isEmpty && warnings.isNotEmpty) throw StockSearchException(warnings);
    return list;
  }

  /// Searches unified royalty-free music and sound effects (Pixabay Music + Freesound SFX).
  Future<List<StockAudioResult>> searchStockAudio(String query, {String type = 'all'}) async {
    try {
      final r = await _api.get('/api/v1/media-editor/stock/unified', query: {
        'query': query,
        'type': type,
        'perPage': 20,
      });
      final audioList = (r['unifiedAudio'] as List?)?.whereType<Map>().toList() ?? [];
      final list = <StockAudioResult>[];
      for (final a in audioList) {
        final url = jStr(a['url']) ?? jStr(a['downloadUrl']) ?? jStr(a['previewUrl']);
        if (url == null || !url.startsWith('http')) continue;
        list.add(StockAudioResult(
          id: jStr(a['id']) ?? 'aud_${list.length}',
          url: url,
          title: jStr(a['title']) ?? jStr(a['name']) ?? 'Audio Track',
          durationSec: (a['durationSec'] as num?)?.toDouble(),
          provider: jStr(a['provider']) ?? 'royalty-free',
          kind: jStr(a['kind']) ?? 'music',
          attribution: jStr(a['attribution']) ?? jStr(a['license']),
        ));
      }
      if (list.isNotEmpty) return list;
    } on ApiException catch (e) {
      if (e.isAccessLock || e.kind == ApiErrorKind.unauthorized) rethrow;
    } catch (_) {}

    // Fallback: /stock/music catalogue
    try {
      final r = await _api.get('/api/v1/media-editor/stock/music', query: {'query': query});
      final tracks = (r['tracks'] as List?)?.whereType<Map>().toList() ?? [];
      final list = <StockAudioResult>[];
      for (final t in tracks) {
        final u = jStr(t['url']) ?? '';
        if (u.isEmpty) continue;
        list.add(StockAudioResult(
          id: jStr(t['id']) ?? 'track',
          url: u,
          title: jStr(t['title']) ?? query,
          durationSec: (t['durationSec'] as num?)?.toDouble(),
          provider: 'catalogue',
          kind: 'music',
          attribution: jStr(t['attribution']),
        ));
      }
      return list;
    } on ApiException catch (e) {
      if (e.isAccessLock || e.kind == ApiErrorKind.unauthorized) rethrow;
      return [];
    } catch (_) {
      return [];
    }
  }

  /// Resolves a `stock_query` B-roll overlay to a video URL with its credit line (contract §3.3).
  /// Null if none found.
  Future<({String url, String? credit})?> resolveStockVideo(String query) async {
    final hit = (await searchStockVideos(query)).firstOrNull;
    return hit == null ? null : (url: hit.downloadUrl, credit: hit.attribution);
  }

  /// Resolves a `stock_query` music phrase through the unified stock search.
  Future<String?> resolveMusic(String query) async => (await resolveMusicTrack(query))?.url;

  /// A music track for a mood [query], with the credit line its licence requires.
  Future<({String url, String? credit})?> resolveMusicTrack(String query, {String? preferUrl}) async {
    final results = await searchStockAudio(query);
    final match = results.where((t) => preferUrl == null || t.url == preferUrl).firstOrNull;
    if (match != null) {
      final m = match;
      return (url: m.url, credit: m.attribution);
    }
    return null;
  }

  /// Downloads a remote media file for the renderer (which only takes local paths)
  /// with automatic retries and exponential backoff on 429/5xx and structured ApiException wrapping.
  Future<String> download(String url, String destPath, {CancelToken? cancelToken}) async {
    final dio = Dio(BaseOptions(
      receiveTimeout: AppConfig.uploadTimeout,
      headers: {'User-Agent': '180Workspace-SocialStudio/1.0'},
    ));

    int attempt = 0;
    const maxAttempts = 3;

    while (true) {
      attempt++;
      try {
        await dio.download(url, destPath, cancelToken: cancelToken);
        return destPath;
      } on DioException catch (e) {
        final status = e.response?.statusCode;
        final isRateLimited = status == 429;
        final isServerError = status != null && status >= 500 && status < 600;

        if ((isRateLimited || isServerError) && attempt < maxAttempts) {
          int delayMs = attempt * 1500;
          final retryAfter = e.response?.headers.value('retry-after');
          if (retryAfter != null) {
            final parsed = int.tryParse(retryAfter);
            if (parsed != null && parsed > 0 && parsed <= 10) {
              delayMs = parsed * 1000;
            }
          }
          await Future.delayed(Duration(milliseconds: delayMs));
          continue;
        }

        throw ApiException.fromDio(e);
      } catch (e) {
        if (e is ApiException) rethrow;
        throw ApiException(
          kind: ApiErrorKind.network,
          message: 'Failed to download asset: $e',
        );
      }
    }
  }
}

/// Every stock provider failed (keys, quota, network). [warnings] are the providers' own messages.
class StockSearchException implements Exception {
  StockSearchException(this.warnings);
  final List<String> warnings;

  @override
  String toString() => 'Stock search failed: ${warnings.take(3).join('; ')}';
}
