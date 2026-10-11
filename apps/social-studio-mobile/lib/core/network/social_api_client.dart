import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb, debugPrint;
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../data/models/brand_voice.dart';
import '../../data/models/autopilot.dart';
import '../../data/models/content_calendar.dart';
import '../../data/models/engagement_rule.dart';
import '../../data/models/inbox.dart';
import '../../data/models/library.dart';
import '../../data/models/manager_chat.dart';
import '../../data/models/platform.dart';
import '../../data/models/project.dart';
import '../../data/models/review.dart';
import '../../data/models/social_account.dart';
import '../../data/models/social_post.dart';
import '../../data/models/task.dart';
import '../../data/models/creator_billing.dart';
import '../config/app_config.dart';
import '../offline/outbox.dart';
import '../util/json.dart';
import 'api_client.dart';
import 'api_exception.dart';
import 'device_registration.dart';

/// Result of a write that may have been queued for later because the device is offline.
class MutationOutcome {
  MutationOutcome.applied(this.data) : queued = false;
  MutationOutcome.queued()
      : data = null,
        queued = true;

  final Json? data;
  final bool queued;
}

/// Input of the project create wizard (`POST /projects`).
class CreateProjectInput {
  CreateProjectInput({
    required this.name,
    this.clientId,
    this.clientName,
    this.clientEmail,
    this.description = '',
    this.startDate,
    this.endDate,
    this.socialServices = const [],
    required this.brandVoice,
    this.connectedAccountIds = const [],
    this.teamMemberIds = const [],
    this.settings = const ProjectSettings(),
  });

  final String name;
  final String? clientId;
  final String? clientName;
  final String? clientEmail;
  final String description;
  final DateTime? startDate;
  final DateTime? endDate;
  final List<String> socialServices;
  final BrandVoice brandVoice;
  final List<String> connectedAccountIds;
  final List<String> teamMemberIds;
  final ProjectSettings settings;

  Json toJson() {
    final bv = brandVoice.toJson();
    return compact({
      'name': name.trim(),
      'clientId': clientId,
      'clientName': clientId == null && (clientName?.trim().isNotEmpty ?? false) ? clientName!.trim() : null,
      'clientEmail': clientId == null && (clientEmail?.trim().isNotEmpty ?? false) ? clientEmail!.trim() : null,
      'description': description.trim(),
      'startDate': isoOrNull(startDate),
      'endDate': isoOrNull(endDate),
      'socialServices': socialServices,
      'brandProfile': {
        ...bv,
        // The web wizard sends pillars top-level too; the server keeps them via metadata.
        'contentPillars': brandVoice.contentPillars,
      },
      'connectedAccountIds': connectedAccountIds,
      'teamMemberIds': teamMemberIds,
      'settings': settings.toJson(),
    });
  }
}

/// All `/api/v1/social-media/*` endpoints plus the few platform endpoints the social app needs.
/// Paths and payloads follow docs/social-studio-mobile/FEATURE_PARITY.md.
class SocialApi {
  SocialApi(this._api, {Outbox? outbox, DeviceRegistration? device})
      : _outbox = outbox,
        _device = device;

  final ApiClient _api;
  final Outbox? _outbox;
  final DeviceRegistration? _device;
  final _uuid = Uuid();

  static const base = '/api/v1/social-media';

  /// Tries the write online; on a network failure (not a server rejection) it is queued in
  /// the outbox and replayed later with the same idempotency key.
  Future<MutationOutcome> _mutate(String method, String path, {Object? body, required String label}) async {
    final key = _uuid.v4();
    try {
      final data = await _api.send(method, path, body: body, idempotencyKey: key);
      return MutationOutcome.applied(data);
    } on ApiException catch (e) {
      final outbox = _outbox;
      if (e.isNetwork && outbox != null) {
        await outbox.enqueue(method: method, path: path, body: body, label: label, clientMutationId: key);
        return MutationOutcome.queued();
      }
      rethrow;
    }
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  Future<List<Project>> listProjects({String? search, String? status, int limit = 50, int offset = 0}) async {
    final r = await _api.get('$base/projects', query: compact({
      'search': (search?.trim().isEmpty ?? true) ? null : search!.trim(),
      'status': status,
      'limit': limit,
      'offset': offset,
    }));
    return jList(r['projects'], Project.fromJson);
  }

  Future<ProjectDetail> getProject(String id) async {
    final r = await _api.get('$base/projects/$id');
    return ProjectDetail.fromJson(jMap(r['project']));
  }

  Future<Project> createProject(CreateProjectInput input) async {
    final r = await _api.post('$base/projects', body: input.toJson(), idempotencyKey: _uuid.v4());
    return Project.fromJson(jMap(r['project']));
  }

  Future<MutationOutcome> updateProject(String id, Json body) =>
      _mutate('PUT', '$base/projects/$id', body: body, label: 'Update project settings');

  Future<void> deleteProject(String id) => _api.delete('$base/projects/$id');

  Future<ProjectDashboard> projectDashboard(String id) async {
    final r = await _api.get('$base/projects/$id/dashboard');
    return ProjectDashboard.fromJson(jMap(r['dashboard']));
  }

  Future<List<ActivityItem>> projectActivity(String id, {int limit = 10}) async {
    final r = await _api.get('$base/projects/$id/activity', query: {'limit': limit});
    return jList(r['activity'], ActivityItem.fromJson);
  }

  Future<void> linkAccount(String projectId, String accountId) =>
      _api.post('$base/projects/$projectId/accounts', body: {'accountId': accountId});

  Future<void> unlinkAccount(String projectId, String accountId) =>
      _api.delete('$base/projects/$projectId/accounts/$accountId');

  /// Analytics has no backend yet (FEATURE_PARITY N1). This is the proposed endpoint; a 404
  /// is surfaced to the user as "not available", never replaced with invented numbers.
  Future<Json> projectAnalytics(String projectId, {String range = '30d'}) =>
      _api.get('$base/projects/$projectId/analytics', query: {'range': range});

  // ── Brand voice ────────────────────────────────────────────────────────────

  Future<BrandVoice> getBrandVoice(String projectId) async {
    final r = await _api.get('$base/brand-voice/$projectId');
    return BrandVoice.fromJson(jMap(r['profile']), projectId: projectId);
  }

  Future<MutationOutcome> saveBrandVoice(String projectId, BrandVoice voice) =>
      _mutate('POST', '$base/brand-voice/$projectId', body: voice.toJson(), label: 'Save brand voice');

  /// Proposed endpoint (FEATURE_PARITY B4 has no backend). Errors are surfaced as-is.
  Future<List<ContentIdea>> generateIdeas(String projectId, {int count = 3}) async {
    final r = await _api.post('$base/brand-voice/$projectId/ideas',
        body: {'count': count}, timeout: AppConfig.aiReceiveTimeout);
    return jList(r['ideas'], ContentIdea.fromJson);
  }

  // ── Accounts ───────────────────────────────────────────────────────────────

  Future<List<SocialAccount>> listAccounts({String? projectId}) async {
    final r = await _api.get('$base/accounts', query: compact({'projectId': projectId}));
    return jList(r['accounts'], SocialAccount.fromJson);
  }

  /// Starts a server-side OAuth flow and returns the provider authorize URL to open in the
  /// system browser. The provider redirects back to [AppConfig.oauthRedirectUri].
  Future<Uri> startAccountOAuth(SocialPlatform platform, {String? projectId}) async {
    final r = await _api.get('$base/accounts/oauth/${platform.id}/authorize', query: compact({
      'projectId': projectId,
      'redirectUri': AppConfig.oauthRedirectUri,
      'client': kIsWeb ? 'web' : 'mobile',
    }));
    final url = jStr(r['url']) ?? jStr(r['authorizeUrl']) ?? jStr(jMap(r['data'])['url']);
    final uri = url == null ? null : Uri.tryParse(url);
    if (uri == null || !(uri.isScheme('https') || uri.isScheme('http') || uri.scheme == AppConfig.deepLinkScheme)) {
      throw ApiException(kind: ApiErrorKind.server, message: 'The server did not return an authorization URL.');
    }
    return uri;
  }

  /// Pages / Instagram accounts / LinkedIn organisations found after OAuth (`status=select`).
  Future<({String platform, List<OAuthCandidate> candidates})> getOAuthSelection(String selectionId) async {
    final r = await _api.get('$base/accounts/oauth/selections/$selectionId');
    return (platform: jStrOr(r['platform'], ''), candidates: jList(r['candidates'], OAuthCandidate.fromJson));
  }

  Future<List<SocialAccount>> completeOAuthSelection(String selectionId, List<String> candidateIds) async {
    final r = await _api.post('$base/accounts/oauth/selections/$selectionId', body: {'candidateIds': candidateIds});
    return jList(r['accounts'], SocialAccount.fromJson);
  }

  Future<void> disconnectAccount(String id) => _api.delete('$base/accounts/$id');

  Future<void> setDefaultAccount(String id) => _api.post('$base/accounts/$id/set-default');

  // ── AI content calendars ──────────────────────────────────────────────────

  Future<List<ContentCalendar>> listCalendars({int limit = 50, int offset = 0, String? projectId}) async {
    final r = await _api.get('$base/content-calendar', query: compact({
      'limit': limit,
      'offset': offset,
      if (projectId != null && projectId.isNotEmpty) 'projectId': projectId,
    }));
    return jList(r['calendars'], ContentCalendar.fromJson);
  }

  Future<ContentCalendar> getCalendar(String id) async {
    final r = await _api.get('$base/content-calendar/$id');
    final pieces = jList(r['pieces'], CalendarPiece.fromJson);
    return ContentCalendar.fromJson(jMap(r['calendar']), pieces: pieces);
  }

  /// Slow: the server calls the workspace's LLM. Returns the new calendar id.
  Future<({String calendarId, int totalPieces, String? message})> createCalendar(CalendarConfig config) async {
    final r = await _api.post('$base/content-calendar/create',
        body: config.toJson(), timeout: AppConfig.calendarGenerationTimeout, idempotencyKey: _uuid.v4());
    final id = jStr(r['calendar_id']);
    if (id == null || id.isEmpty) {
      throw ApiException(
          kind: ApiErrorKind.server, message: jStr(r['message']) ?? 'The server did not return a calendar id.');
    }
    return (calendarId: id, totalPieces: jInt(r['total_pieces']) ?? 0, message: jStr(r['message']));
  }

  Future<ContentCalendar> updateCalendar(String id, Json body) async {
    final r = await _api.put('$base/content-calendar/$id', body: body);
    return ContentCalendar.fromJson(jMap(r['calendar']));
  }

  Future<void> deleteCalendar(String id) => _api.delete('$base/content-calendar/$id');

  Future<MutationOutcome> updatePiece(String calendarId, String pieceId, Json body) => _mutate(
      'PUT', '$base/content-calendar/$calendarId/pieces/$pieceId',
      body: body, label: 'Update calendar piece');

  /// Autopilot regeneration of a single piece with an AI instruction (WS2).
  Future<CalendarPiece> regeneratePiece(String projectId, String pieceId, {String? instruction}) async {
    final r = await _api.post(
      '$base/projects/$projectId/autopilot/pieces/$pieceId/regenerate',
      body: {'instruction': ?instruction},
      timeout: AppConfig.aiReceiveTimeout,
    );
    return CalendarPiece.fromJson(jMap(r['piece']));
  }

  /// Scene-by-scene shooting script for one video piece (Shooting Script Director agent). Cached on the piece;
  /// [force] regenerates it after the script changed.
  Future<ProductionScript> generateShootingScript(String projectId, String pieceId, {bool force = false}) async {
    final r = await _api.post(
      '$base/projects/$projectId/autopilot/pieces/$pieceId/shooting-script',
      body: {'force': force},
      timeout: AppConfig.aiReceiveTimeout,
    );
    final script = ProductionScript.tryParse(r['productionScript']);
    if (script == null) throw const FormatException('The server returned an empty shooting script');
    return script;
  }

  // ── Platform Team (Command Center): craft tools, AI drafting and monitoring per platform ──────────────

  /// `GET /platform-team/:platform/overview`: accounts, pipeline, queue craft scores, triaged inbox, live metrics.
  Future<Json> platformOverview(String platform, String projectId) async =>
      jMap((await _api.get('$base/platform-team/$platform/overview', query: {'projectId': projectId}))['data']);

  /// Deterministic craft tools: `hooks/score`, `beat-sheet`, `copy/lint`, `thread`, `humanize`, `profile/audit`,
  /// `outliers`, `comments/triage`, `posts/audit`.
  Future<Json> platformTool(String platform, String tool, Json body) async =>
      jMap((await _api.post('$base/platform-team/$platform/$tool', body: body))['data']);

  /// AI tools (`draft`, `repurpose`). Throws AI_NOT_CONFIGURED (503) when the workspace has no AI key.
  Future<Json> platformAi(String platform, String tool, Json body) async => jMap(
      (await _api.post('$base/platform-team/$platform/$tool', body: body, timeout: AppConfig.aiReceiveTimeout))['data']);

  /// Reads fresh per-post numbers from the platform, re-ranks the account's own posts. Provider calls can be slow.
  Future<Json> refreshPostMetrics(String platform, String projectId, {bool force = false}) async => jMap((await _api.post(
          '$base/platform-team/$platform/posts/refresh-metrics',
          body: {'projectId': projectId, 'force': force},
          timeout: AppConfig.aiReceiveTimeout))['data']);

  /// Competitor radar: watched handles and the last stored scan (`supported` is false where no official API exists).
  Future<Json> radar(String platform, String projectId) async =>
      jMap((await _api.get('$base/platform-team/$platform/radar', query: {'projectId': projectId}))['data']);

  Future<Json> setRadarHandles(String platform, String projectId, List<String> handles) async =>
      jMap((await _api.put('$base/platform-team/$platform/radar', body: {'projectId': projectId, 'handles': handles}))['data']);

  Future<Json> scanRadar(String platform, String projectId) async => jMap((await _api.post(
          '$base/platform-team/$platform/radar/scan',
          body: {'projectId': projectId},
          timeout: AppConfig.aiReceiveTimeout))['data']);

  /// AI reply drafts for one triaged inbox conversation. Drafts only; nothing is sent.
  Future<Json> draftReplies(String platform, String projectId, String conversationId) async => jMap((await _api.post(
          '$base/platform-team/$platform/replies/draft',
          body: {'projectId': projectId, 'conversationId': conversationId},
          timeout: AppConfig.aiReceiveTimeout))['data']);

  /// AI calls and output-token ceiling for a calendar with these settings, before it runs.
  Future<Json> estimateAutopilot(String projectId, {required int days, List<String>? platforms, Map<String, dynamic>? contentMix}) async =>
      _api.post('$base/projects/$projectId/autopilot/estimate', body: {'days': days, 'platforms': ?platforms, 'contentMix': ?contentMix});

  /// Starts the multi-agent autopilot calendar (brand consciousness + research). 409 = one already running.
  Future<({String jobId, String calendarId})> startAutopilot(
    String projectId, {
    required int days,
    required DateTime startDate,
    List<String>? platforms,
    List<String> goals = const [],
    String? name,
    String? structureDirectives,
    String? referenceInspirations,
    Map<String, dynamic>? contentMix,
    int? targetReelDurationSec,
    int? carouselSlideCount,
  }) async {
    final d = startDate;
    final ymd = '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    final r = await _api.post('$base/projects/$projectId/autopilot/calendar', body: compact({
      'days': days,
      'startDate': ymd,
      if (platforms != null && platforms.isNotEmpty) 'platforms': platforms,
      if (goals.isNotEmpty) 'goals': goals,
      if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
      if (structureDirectives != null && structureDirectives.trim().isNotEmpty) 'structureDirectives': structureDirectives.trim(),
      if (referenceInspirations != null && referenceInspirations.trim().isNotEmpty) 'referenceInspirations': referenceInspirations.trim(),
      if (contentMix != null && contentMix.isNotEmpty) 'contentMix': contentMix,
      'targetReelDurationSec': ?targetReelDurationSec,
      'carouselSlideCount': ?carouselSlideCount,
    }), idempotencyKey: _uuid.v4());
    final jobId = jStr(r['jobId']);
    final calendarId = jStr(r['calendarId']);
    if (jobId == null || calendarId == null) {
      throw ApiException(kind: ApiErrorKind.server, message: 'The server did not return an autopilot job.');
    }
    return (jobId: jobId, calendarId: calendarId);
  }

  Future<AutopilotJob> getAutopilotJob(String projectId, String jobId) async =>
      AutopilotJob.fromJson(await _api.get('$base/projects/$projectId/autopilot/jobs/$jobId'));

  /// Renders a carousel (or a single static post) for a calendar piece or post. The finished slides are
  /// attached to the piece/post by the server.
  Future<CreativeJob> startCreative(
    String projectId, {
    bool carousel = true,
    String? pieceId,
    String? postId,
    String format = 'portrait',
    bool useImageModel = true,
  }) async {
    return _startCreativeJob(projectId, carousel: carousel, pieceId: pieceId, postId: postId, format: format, useImageModel: useImageModel);
  }

  /// AI thumbnail team: real frames in (base64 JPEG + face boxes), three QA'd designs out (slow: LLM team + render).
  Future<Json> designThumbnails(String projectId, Json body) =>
      _api.post('$base/projects/$projectId/creative/thumbnails', body: body, timeout: AppConfig.aiReceiveTimeout, idempotencyKey: _uuid.v4());

  /// Manual thumbnail (no AI): one frame + the creator's text through the same compositor and QA.
  Future<Json> renderThumbnail(String projectId, Json body) =>
      _api.post('$base/projects/$projectId/creative/thumbnails/render', body: body, timeout: AppConfig.aiReceiveTimeout, idempotencyKey: _uuid.v4());

  Future<CreativeJob> _startCreativeJob(
    String projectId, {
    required bool carousel,
    String? pieceId,
    String? postId,
    required String format,
    required bool useImageModel,
  }) async {
    final r = await _api.post('$base/projects/$projectId/creative/${carousel ? 'carousels' : 'static-posts'}',
        body: {'pieceId': ?pieceId, 'postId': ?postId, 'format': format, 'useImageModel': useImageModel},
        idempotencyKey: _uuid.v4());
    return CreativeJob.fromJson(jMap(r['job']));
  }

  Future<CreativeJob> getCreativeJob(String projectId, String jobId) async =>
      CreativeJob.fromJson(jMap((await _api.get('$base/projects/$projectId/creative/jobs/$jobId'))['job']));

  Future<CreativeJob> regenerateSlide(String projectId, String jobId, int index) async {
    final r = await _api.post('$base/projects/$projectId/creative/jobs/$jobId/slides/$index/regenerate');
    return CreativeJob.fromJson(jMap(r['job']));
  }

  Future<BrandConsciousness> getBrandConsciousness(String projectId) async =>
      BrandConsciousness.fromJson(jMap((await _api.get('$base/projects/$projectId/brand-consciousness'))['brand']));

  Future<BrandConsciousness> putBrandConsciousness(String projectId, Json patch) async =>
      BrandConsciousness.fromJson(
          jMap((await _api.put('$base/projects/$projectId/brand-consciousness', body: patch))['brand']));

  // ── Posts ──────────────────────────────────────────────────────────────────

  Future<List<SocialPost>> listPosts({
    String? projectId,
    String? clientId,
    String? status,
    String? calendarId,
    bool? isEvergreen,
    DateTime? from,
    DateTime? to,
    int limit = 200,
    int offset = 0,
  }) async {
    final r = await _api.get('$base/posts', query: compact({
      'projectId': projectId,
      'clientId': clientId,
      'status': status,
      'calendarId': calendarId,
      'isEvergreen': isEvergreen?.toString(),
      // Proposed range filter (FEATURE_PARITY F1); ignored by servers that lack it.
      'from': isoOrNull(from),
      'to': isoOrNull(to),
      'limit': limit,
      'offset': offset,
    }));
    return jList(r['posts'], SocialPost.fromJson);
  }

  Future<SocialPost> getPost(String id) async {
    final r = await _api.get('$base/posts/$id');
    return SocialPost.fromJson(jMap(r['post']));
  }

  Future<MutationOutcome> createPost(Json body) => _mutate('POST', '$base/posts', body: body, label: 'Create post');

  Future<MutationOutcome> updatePost(String id, Json body) =>
      _mutate('PUT', '$base/posts/$id', body: body, label: 'Update post');

  Future<void> assignVariantAccount(String postId, String variantIdOrPlatform, String? socialAccountId) =>
      _api.patch('$base/posts/$postId/variants/$variantIdOrPlatform/account', body: {'socialAccountId': socialAccountId});

  Future<MultipartFile> _makeMultipartFile(
    String path, {
    String? filename,
    DioMediaType? contentType,
  }) async {
    final name = filename ?? path.split(RegExp(r'[/\\]')).lastOrNull ?? 'file';
    if (kIsWeb) {
      List<int> bytes = const <int>[];
      try {
        bytes = await XFile(path).readAsBytes();
      } catch (_) {}
      return MultipartFile.fromBytes(bytes, filename: name, contentType: contentType);
    }
    return MultipartFile.fromFile(path, filename: name, contentType: contentType);
  }

  /// Uploads a rendered/recorded MP4 as the post's deliverable and moves it to `in_review`
  /// (`POST /posts/:id/submit-for-approval`, device-gated multipart, max 300 MB).
  Future<SocialPost> submitForApproval(
    String postId, {
    required String videoPath,
    String? thumbnailPath,
    String? notes,
    void Function(int sent, int total)? onProgress,
  }) async {
    Future<Json> call() async {
      final form = FormData.fromMap({
        'video': await _makeMultipartFile(videoPath,
            contentType: videoPath.toLowerCase().endsWith('.mov') ? DioMediaType('video', 'quicktime') : DioMediaType('video', 'mp4')),
        if (thumbnailPath != null)
          'thumbnail': await _makeMultipartFile(thumbnailPath,
              contentType: thumbnailPath.toLowerCase().endsWith('.png') ? DioMediaType('image', 'png') : DioMediaType('image', 'jpeg')),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
        'source': 'social-studio-mobile',
      });
      return _api.postForm('$base/posts/$postId/submit-for-approval', form, device: true, onProgress: onProgress);
    }

    await _device?.ensureToken();
    Json r;
    try {
      r = await call();
    } on ApiException catch (e) {
      if (e.kind != ApiErrorKind.deviceRequired || _device == null) rethrow;
      await _device.ensureToken(forceRenew: true);
      r = await call();
    }
    return SocialPost.fromJson(jMap(r['post']));
  }

  /// Attaches a rendered video to a calendar piece (`POST /calendar-pieces/:id/final-video`,
  /// device-gated). Creates the piece's post if it has none and moves it to review.
  /// Raw footage for a calendar piece (for an editor on the desktop app). Returns the stored URL.
  Future<String> uploadPieceRawFootage(String pieceId, String videoPath, {void Function(int sent, int total)? onProgress}) async {
    final lower = videoPath.toLowerCase();
    final form = FormData.fromMap({
      'video': await _makeMultipartFile(videoPath,
          contentType: lower.endsWith('.mov')
              ? DioMediaType('video', 'quicktime')
              : lower.endsWith('.webm')
                  ? DioMediaType('video', 'webm')
                  : DioMediaType('video', 'mp4')),
    });
    final r = await _api.postForm('$base/calendar-pieces/$pieceId/raw-footage', form, onProgress: onProgress);
    final url = jStr(jMap(r['data'])['url']);
    if (url == null || url.isEmpty) {
      throw ApiException(kind: ApiErrorKind.server, message: 'Footage uploaded but the server returned no URL.');
    }
    return url;
  }

  Future<SocialPost> uploadPieceFinalVideo(
    String pieceId, {
    required String videoPath,
    String? notes,
    void Function(int sent, int total)? onProgress,
  }) async {
    Future<Json> call() async {
      final form = FormData.fromMap({
        'video': await _makeMultipartFile(videoPath,
            contentType: videoPath.toLowerCase().endsWith('.mov') ? DioMediaType('video', 'quicktime') : DioMediaType('video', 'mp4')),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
        'source': 'social-studio-mobile',
      });
      return _api.postForm('$base/calendar-pieces/$pieceId/final-video', form, device: true, onProgress: onProgress);
    }

    await _device?.ensureToken();
    Json r;
    try {
      r = await call();
    } on ApiException catch (e) {
      if (e.kind != ApiErrorKind.deviceRequired || _device == null) rethrow;
      await _device.ensureToken(forceRenew: true);
      r = await call();
    }
    return SocialPost.fromJson(jMap(jMap(r['data'])['post']));
  }

  Future<SocialPost> submitFootage(String postId, {List<String>? rawMediaUrls, List<ExternalLink>? links}) async {
    final r = await _api.post('$base/posts/$postId/footage', body: compact({
      'rawMediaUrls': rawMediaUrls,
      'externalStorageLinks': links?.map((l) => l.toJson()).toList(),
    }));
    return SocialPost.fromJson(jMap(r['post']));
  }

  Future<Json> studioLaunchContext(String postId) async {
    final r = await _api.get('$base/posts/$postId/studio-launch-context');
    return jMap(r['context']);
  }

  Future<PublishReadiness> validatePublish(String postId) async =>
      PublishReadiness.fromJson(await _api.get('$base/posts/$postId/validate-publish'));

  /// Never queued: publishing must report the server's real outcome immediately.
  Future<PublishResult> publish(String postId) async =>
      PublishResult.fromJson(await _api.post('$base/posts/$postId/publish', timeout: AppConfig.aiReceiveTimeout));

  /// Updates user-assisted publishing status for a platform variant (e.g. X or Reddit handoff/confirmation).
  Future<Json> updateAssistedPublishStatus(
    String postId, {
    required String platform,
    required String status,
    Json? platformMeta,
    String? externalUrl,
  }) async {
    final r = await _api.post(
      '$base/posts/$postId/assisted-status',
      body: compact({
        'platform': platform,
        'status': status,
        'platformMeta': platformMeta,
        'externalUrl': externalUrl,
      }),
    );
    return jMap(r);
  }

  Future<SocialPost> retryVariant(String postId, String platform) async {
    final r = await _api.post('$base/posts/$postId/retry-variant',
        body: {'platform': platform}, timeout: AppConfig.aiReceiveTimeout);
    return SocialPost.fromJson(jMap(r['post']));
  }

  Future<SocialPost> repurpose(String postId, {DateTime? newScheduleDate, String? newProjectId, String? newContent}) async {
    final r = await _api.post('$base/posts/$postId/repurpose', body: compact({
      'newScheduleDate': isoOrNull(newScheduleDate),
      'newProjectId': newProjectId,
      'newContent': newContent,
    }));
    return SocialPost.fromJson(jMap(r['post']));
  }

  // ── Tasks / users / clients (other modules) ────────────────────────────────

  Future<List<EditingTask>> listTasks(String projectId) async {
    final r = await _api.get('/api/tasks', query: {'projectId': projectId});
    return jList(r['tasks'], EditingTask.fromJson);
  }

  Future<Json> createTask(Json body) => _api.post('/api/tasks', body: body);

  Future<List<WorkspaceUser>> listUsers() async {
    final r = await _api.get('/api/users');
    final list = r['users'] ?? r['data'];
    return jList(list, WorkspaceUser.fromJson);
  }

  Future<List<ClientRef>> listClients() async {
    final r = await _api.get('/api/clients');
    return jList(r['clients'] ?? r['data'], ClientRef.fromJson);
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  Future<ReviewSession> createReviewSession({
    required String clientId,
    String? projectId,
    required String name,
    required DateTime startDate,
    required DateTime endDate,
    List<String>? postIds,
    int expiresInDays = 14,
  }) async {
    final r = await _api.post('$base/reviews/sessions', body: compact({
      'clientId': clientId,
      'projectId': projectId,
      'name': name,
      'startDate': isoOrNull(startDate),
      'endDate': isoOrNull(endDate),
      'postIds': postIds,
      'expiresInDays': expiresInDays,
    }));
    return ReviewSession.fromJson(jMap(r['session']));
  }

  Future<PublicReview> publicReview(String token) async =>
      PublicReview.fromJson(await _api.get('$base/reviews/public/$token', auth: false));

  Future<ReviewComment> publicComment(String token, {required String postId, required String text, String? authorName}) async {
    final r = await _api.post('$base/reviews/public/$token/comments',
        auth: false,
        body: compact({'postId': postId, 'commentText': text, 'authorName': authorName, 'authorType': 'client'}));
    return ReviewComment.fromJson(jMap(r['comment']));
  }

  /// [seenVersions] ({postId: versionNumber}) lets the server refuse with REVIEW_STALE if a post changed after the
  /// client opened the page, so nobody approves content they haven't seen.
  Future<Json> approveBatch(String token, {String? clientNotes, Map<String, int>? seenVersions}) =>
      _api.post('$base/reviews/public/$token/approve-batch',
          auth: false, body: compact({'clientNotes': clientNotes, 'seenVersions': seenVersions}));

  // ── Inbox ──────────────────────────────────────────────────────────────────

  Future<List<Conversation>> listConversations({String? projectId, String? platform, bool? isRead, String? search}) async {
    final r = await _api.get('$base/inbox/conversations', query: compact({
      'projectId': projectId,
      'platform': platform,
      'isRead': isRead?.toString(),
      'search': (search?.trim().isEmpty ?? true) ? null : search!.trim(),
    }));
    return jList(r['conversations'], Conversation.fromJson);
  }

  Future<Conversation> getConversation(String id) async {
    final r = await _api.get('$base/inbox/conversations/$id');
    return Conversation.fromJson(jMap(r['conversation']));
  }

  Future<MutationOutcome> sendMessage(String conversationId, String content, {String senderType = 'agent'}) => _mutate(
      'POST', '$base/inbox/conversations/$conversationId/messages',
      body: {'content': content, 'senderType': senderType}, label: 'Send inbox reply');

  Future<({List<ReplySuggestion> suggestions, String? tone})> aiSuggestions(String conversationId) async {
    final r = await _api.get('$base/inbox/conversations/$conversationId/ai-suggestions',
        timeout: AppConfig.aiReceiveTimeout);
    final raw = r['suggestions'];
    final list = raw is List
        ? raw.map((s) => s is Map ? ReplySuggestion.fromJson(s.cast<String, dynamic>()) : ReplySuggestion(tone: '', text: '$s')).toList()
        : <ReplySuggestion>[];
    return (suggestions: list, tone: jStr(r['brandToneApplied']));
  }

  Future<Json> convertToLead(String conversationId) =>
      _api.post('$base/inbox/conversations/$conversationId/convert-to-lead');

  Future<({int synced, int accountsChecked, List<String> notes})> syncInbox({
    String? projectId,
    String? platform,
    bool includeSample = false,
  }) async {
    final r = await _api.post('$base/inbox/sync', body: compact({
      'projectId': projectId,
      'platform': platform,
      if (includeSample) 'includeSample': true,
    }));
    return (
      synced: jInt(r['synced']) ?? 0,
      accountsChecked: jInt(r['accountsChecked']) ?? 0,
      notes: (r['notes'] is List) ? (r['notes'] as List).map((e) => e.toString()).toList() : <String>[],
    );
  }

  Future<Json> seedTestConversation({String? projectId, String? socialAccountId}) async {
    final r = await _api.post('$base/inbox/test-conversation', body: compact({
      'projectId': projectId,
      'socialAccountId': socialAccountId,
    }));
    return jMap(r);
  }

  // ── AI Reply All & Autonomous Agent ──────────────────────────────────────────

  Future<List<BatchAiReplySuggestion>> getAiReplyAllSuggestions({
    String? projectId,
    String? platform,
    int limit = 20,
  }) async {
    final r = await _api.post('$base/inbox/ai-reply-all/suggestions', body: compact({
      'projectId': projectId,
      'platform': platform,
      'limit': limit,
    }), timeout: AppConfig.aiReceiveTimeout);
    return jList(r['suggestions'], BatchAiReplySuggestion.fromJson);
  }

  Future<Map<String, dynamic>> dispatchAiReplyAll(List<Map<String, dynamic>> replies) async {
    final r = await _api.post('$base/inbox/ai-reply-all/dispatch', body: {'replies': replies});
    return jMap(r);
  }

  // ── Studio library metadata (media stays on the device) ──
  Future<({List<Json> folders, List<Json> items})> pullStudioLibrary({String? projectId, String? since}) async {
    final r = await _api.get('$base/library/sync', query: {'projectId': ?projectId, 'since': ?since});
    return (folders: jList(r['folders'], (j) => j), items: jList(r['items'], (j) => j));
  }

  /// Queued in the outbox when offline, like every other write.
  Future<MutationOutcome> pushStudioLibrary(Json body) => _mutate('PUT', '$base/library/sync', body: body, label: 'Sync library');

  // ── AI inbox per account ──
  Future<List<AiInboxAccount>> aiInboxSettings({String? projectId}) async {
    final r = await _api.get('$base/inbox/ai-settings', query: {'projectId': ?projectId});
    return jList(r['accounts'], AiInboxAccount.fromJson);
  }

  Future<AiInboxAccount> setAiInboxMode(String accountId, String mode, {String? instructions}) async {
    final r = await _api.put('$base/inbox/ai-settings/accounts/$accountId', body: {'mode': mode, 'instructions': ?instructions});
    return AiInboxAccount.fromJson(jMap(r['account']));
  }

  /// Sets [mode] on every supported account (optionally one platform / project). Returns how many changed.
  Future<int> setAiInboxModeBulk(String mode, {String? platform, String? projectId}) async {
    final r = await _api.put('$base/inbox/ai-settings/bulk', body: {'mode': mode, 'platform': ?platform, 'projectId': ?projectId});
    return (r['updated'] as num?)?.toInt() ?? 0;
  }

  Future<Map<String, dynamic>> toggleConversationAiAgent(String conversationId, {bool? active}) async {
    final r = await _api.post('$base/inbox/conversations/$conversationId/toggle-agent', body: compact({
      'active': active,
    }));
    return jMap(r);
  }

  Future<Map<String, dynamic>> takeoverConversation(String conversationId) async {
    final r = await _api.post('$base/inbox/conversations/$conversationId/takeover');
    return jMap(r);
  }

  // ── 180 Engagement Automation Rules ────────────────────────────────────────

  Future<List<EngagementRule>> listEngagementRules({String? projectId, String? socialAccountId, String? status, String? postId}) async {
    final r = await _api.get('$base/engagement/rules', query: compact({
      'projectId': projectId,
      'socialAccountId': socialAccountId,
      'status': status,
      'postId': postId,
    }));
    return jList(r['rules'], EngagementRule.fromJson);
  }

  /// Recent posts of an Instagram/Facebook account, live from the platform (paged by [cursor]).
  Future<({List<AccountMediaItem> items, String? nextCursor})> listAccountMedia(String accountId, {String? cursor}) async {
    final r = await _api.get('$base/accounts/$accountId/media', query: {'cursor': ?cursor});
    return (items: jList(r['items'], AccountMediaItem.fromJson), nextCursor: jStr(r['nextCursor']));
  }

  Future<EngagementRule> createEngagementRule(Map<String, dynamic> data) async {
    final r = await _api.post('$base/engagement/rules', body: data);
    return EngagementRule.fromJson(jMap(r['rule']));
  }

  Future<EngagementRule> updateEngagementRule(String ruleId, Map<String, dynamic> data) async {
    final r = await _api.put('$base/engagement/rules/$ruleId', body: data);
    return EngagementRule.fromJson(jMap(r['rule']));
  }

  Future<void> deleteEngagementRule(String ruleId) => _api.delete('$base/engagement/rules/$ruleId');

  Future<EngagementRule> toggleEngagementRule(String ruleId) async {
    final r = await _api.patch('$base/engagement/rules/$ruleId/toggle');
    return EngagementRule.fromJson(jMap(r['rule']));
  }

  Future<EngagementStats> getEngagementStats({String? projectId}) async {
    final r = await _api.get('$base/engagement/stats', query: compact({'projectId': projectId}));
    return EngagementStats.fromJson(jMap(r['stats']));
  }

  Future<Map<String, dynamic>> testEngagementMatch({
    required String platform,
    required String text,
    String? mediaId,
    String? commentId,
    String senderHandle = 'test_user',
  }) async {
    final body = <String, dynamic>{
      'platform': platform,
      'eventType': 'comment',
      'text': text,
      'senderId': 'sim_user_1',
      'senderHandle': senderHandle,
    };
    if (mediaId != null) body['mediaId'] = mediaId;
    if (commentId != null) body['commentId'] = commentId;
    final r = await _api.post('$base/engagement/test-match', body: body);
    return jMap(r);
  }

  Future<List<Map<String, dynamic>>> getLivePlatformMetrics(String projectId) async {
    final r = await _api.get('$base/projects/$projectId/platform-metrics');
    final list = r['metrics'] as List<dynamic>? ?? [];
    return list.map((m) => jMap(m)).toList();
  }

  // ── 180 Manager AI Assistant & Swarm ───────────────────────────────────────

  Future<ManagerTurnResponse> chatWithManager({
    required String message,
    String? projectId,
    String? conversationId,
    String? attachedAssetUrl,
  }) async {
    final r = await _api.post('$base/manager/chat', body: compact({
      'message': message,
      'projectId': projectId,
      'conversationId': conversationId,
      'attachedAssetUrl': attachedAssetUrl,
    }));
    return ManagerTurnResponse.fromJson(jMap(r));
  }

  Future<Map<String, dynamic>> executeManagerAction(Map<String, dynamic> action) async {
    final r = await _api.post('$base/manager/actions/execute', body: {'action': action});
    return jMap(r);
  }

  Future<Map<String, dynamic>> getManagerCalendarStatus(String projectId) async {
    final r = await _api.get('$base/manager/calendar-status', query: {'projectId': projectId});
    return jMap(r['status']);
  }

  Future<List<Map<String, dynamic>>> getManagerInboxOpportunities({String? projectId, String? platform}) async {
    final r = await _api.get('$base/manager/inbox-opportunities', query: compact({
      'projectId': projectId,
      'platform': platform,
    }));
    final list = r['opportunities'] as List<dynamic>? ?? [];
    return list.map((o) => jMap(o)).toList();
  }

  Future<Map<String, dynamic>> getManagerAnalyticsSummary({String? projectId}) async {
    final r = await _api.get('$base/manager/analytics-summary', query: compact({'projectId': projectId}));
    return jMap(r['summary']);
  }

  Future<Map<String, dynamic>> analyzeVideoIntel(Map<String, dynamic> data) async {
    final r = await _api.post('$base/manager/video-intel', body: data);
    return jMap(r['traits']);
  }

  // ── Assets & banks ─────────────────────────────────────────────────────────

  Future<List<LinkedAsset>> listAssets({String? type}) async {
    final r = await _api.get('$base/assets', query: compact({'type': type}));
    return jList(r['assets'], LinkedAsset.fromJson).where((a) => !a.isBankItem).toList();
  }

  Future<MutationOutcome> createAsset({
    required String url,
    required String type,
    String? title,
    String? description,
    List<String> tags = const [],
  }) =>
      _mutate('POST', '$base/assets',
          body: compact({'url': url, 'type': type, 'title': title, 'description': description, 'tags': tags}),
          label: 'Link asset');

  Future<void> deleteAsset(String id) => _api.delete('$base/assets/$id');

  Future<List<SavedBankItem>> listBanks({String? type}) async {
    final r = await _api.get('$base/saved-banks');
    final all = jList(r['banks'], SavedBankItem.fromJson);
    return type == null ? all : all.where((b) => b.type == type).toList();
  }

  Future<MutationOutcome> createBank({required String type, required String name, required String content, List<String> tags = const []}) =>
      _mutate('POST', '$base/saved-banks',
          body: {'type': type, 'name': name, 'content': content, 'tags': tags}, label: 'Save $type');

  Future<void> deleteBank(String id) => _api.delete('$base/saved-banks/$id');

  // ── Evergreen ──────────────────────────────────────────────────────────────

  Future<List<EvergreenSlot>> listEvergreenSlots(String projectId) async {
    final r = await _api.get('$base/evergreen/$projectId/slots');
    return jList(r['slots'], EvergreenSlot.fromJson);
  }

  Future<EvergreenSlot> createEvergreenSlot({
    required String projectId,
    required int dayOfWeek,
    required String timeSlotUtc,
    required String category,
  }) async {
    final r = await _api.post('$base/evergreen/slots', body: {
      'projectId': projectId,
      'dayOfWeek': dayOfWeek,
      'timeSlotUtc': timeSlotUtc,
      'category': category,
    });
    return EvergreenSlot.fromJson(jMap(r['slot']));
  }

  Future<void> deleteEvergreenSlot(String id) => _api.delete('$base/evergreen/slots/$id');

  // ── Storage ────────────────────────────────────────────────────────────────

  /// Uploads a local file to workspace storage and returns its public URL.
  /// Uses direct presigned R2 upload when available to bypass reverse-proxy payload limits (HTTP 413)
  /// and TCP connection resets (Broken pipe), with seamless fallback to multipart upload.
  Future<String> uploadFile(
    String filePath, {
    List<int>? fileBytes,
    String? filename,
    void Function(int sent, int total)? onProgress,
  }) async {
    final cleanFilename = filename ?? filePath.split(RegExp(r'[/\\]')).lastOrNull ?? 'upload';
    final ext = cleanFilename.toLowerCase().split('.').lastOrNull ?? '';
    final mimeType = switch (ext) {
      'mp4' => 'video/mp4',
      'mov' => 'video/quicktime',
      'webm' => 'video/webm',
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      _ => 'application/octet-stream',
    };

    // 1. Attempt direct presigned upload to R2 (bypasses proxy 413 limit and broken pipe)
    try {
      final safeName = cleanFilename.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
      final key = 'social-uploads/${DateTime.now().millisecondsSinceEpoch}_$safeName';
      final presignedRes = await _api.get(
        '/api/files/presigned-url',
        query: {'key': key, 'contentType': mimeType},
      );
      final uploadUrl = jStr(presignedRes['url']);
      final publicUrl = jStr(presignedRes['publicUrl']);

      if (uploadUrl != null && uploadUrl.isNotEmpty && publicUrl != null && publicUrl.isNotEmpty) {
        final dio = Dio();
        Stream<List<int>>? uploadStream;
        int? contentLength;

        if (fileBytes != null && fileBytes.isNotEmpty) {
          uploadStream = Stream.fromIterable([fileBytes]);
          contentLength = fileBytes.length;
        } else if (filePath.isNotEmpty) {
          final xf = XFile(filePath);
          contentLength = await xf.length();
          uploadStream = xf.openRead();
        }

        if (uploadStream != null) {
          await dio.put(
            uploadUrl,
            data: uploadStream,
            options: Options(
              headers: {
                'Content-Type': mimeType,
                if (contentLength != null) 'Content-Length': contentLength.toString(),
              },
            ),
            onSendProgress: onProgress,
          );
          return publicUrl;
        }
      }
    } catch (e) {
      // If presigned URL is not available or rejected, smoothly fallback to standard upload
      debugPrint('[Upload] Presigned upload fallback: $e');
    }

    // 2. Standard multipart upload fallback
    final r = await _api.upload(
      '/api/files/upload',
      filePath: filePath,
      fileBytes: fileBytes,
      filename: filename,
      onProgress: onProgress,
    );
    final doc = jMap(r['document']);
    final url = jStr(doc['fileUrl']) ?? jStr(r['fileUrl']) ?? jStr(r['url']);
    if (url == null || url.isEmpty) {
      throw ApiException(kind: ApiErrorKind.server, message: 'Upload finished but the server returned no file URL.');
    }
    return url;
  }

  /// Uploads a brand logo to Cloudflare R2 and updates the project's brand identity.
  Future<String> uploadBrandLogo(String projectId, String filePath, {List<int>? fileBytes, String? filename}) async {
    final r = await _api.upload(
      '$base/projects/$projectId/brand-consciousness/logo',
      filePath: filePath,
      fileBytes: fileBytes,
      filename: filename,
      field: 'logo',
    );
    final url = jStr(r['logoUrl']);
    if (url == null || url.isEmpty) {
      throw ApiException(kind: ApiErrorKind.server, message: 'Logo uploaded but the server returned no logo URL.');
    }
    return url;
  }

  // ── Creator Billing & Recharge ─────────────────────────────────────────────

  /// Retrieves the creator billing status: 3-day free trial, active monthly subscription, or daily pass.
  Future<CreatorBillingStatus> getBillingStatus() async {
    final r = await _api.get('$base/billing/status');
    return CreatorBillingStatus.fromJson(r);
  }

  /// Retrieves the available creator plans and daily recharge rate details.
  Future<Json> getBillingPlans() async {
    return await _api.get('$base/billing/plans');
  }

  /// Creates a checkout session via 180 Pay for either monthly subscription or daily recharge.
  Future<CreatorCheckoutResult> createBillingCheckout({
    required String type,
    int? days,
    String? returnUrl,
  }) async {
    final r = await _api.post('$base/billing/checkout', body: compact({
      'type': type,
      'days': days,
      'returnUrl': returnUrl,
    }));
    return CreatorCheckoutResult.fromJson(r);
  }
}
