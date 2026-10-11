import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

import '../config/app_config.dart';
import '../storage/token_store.dart';
import 'api_exception.dart';

typedef ApiErrorListener = void Function(ApiException error);
typedef ReachabilityListener = void Function(bool reachable);

/// The single HTTP client of the app.
///
/// * Sends `Authorization: Bearer <access token>`; the tenant comes from the JWT, so no
///   `x-company-id` header is ever sent.
/// * On a 401 it refreshes the access token once (single-flight: concurrent 401s share one
///   `/api/auth/refresh` call) and retries the request. If refresh is rejected the session is
///   cleared and [onSessionExpired] fires.
/// * Sends `x-device-token` only for requests that opt in (`device: true`).
/// * Every failure is thrown as an [ApiException] carrying the server's own message.
class ApiClient {
  ApiClient({
    required TokenStore tokens,
    String? baseUrl,
    HttpClientAdapter? adapter,
    this.onSessionExpired,
    this.onAccessLocked,
    this.onReachability,
  })  : _tokens = tokens,
        dio = Dio(_options(baseUrl ?? AppConfig.apiBaseUrl)),
        _refreshDio = Dio(_options(baseUrl ?? AppConfig.apiBaseUrl)) {
    if (adapter != null) {
      dio.httpClientAdapter = adapter;
      _refreshDio.httpClientAdapter = adapter;
    }
    dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onResponse: _onResponse, onError: _onError));
  }

  static BaseOptions _options(String baseUrl) => BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: AppConfig.connectTimeout,
        receiveTimeout: AppConfig.defaultReceiveTimeout,
        sendTimeout: AppConfig.defaultReceiveTimeout,
        headers: {'Accept': 'application/json'},
        responseType: ResponseType.json,
      );

  final Dio dio;
  final Dio _refreshDio;
  final TokenStore _tokens;

  void Function()? onSessionExpired;
  ApiErrorListener? onAccessLocked;
  ReachabilityListener? onReachability;

  Future<_RefreshOutcome>? _refreshing;

  TokenStore get tokens => _tokens;

  // ── public verbs ───────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
    Duration? timeout,
    bool auth = true,
    bool device = false,
    CancelToken? cancelToken,
  }) =>
      _send('GET', path, query: query, timeout: timeout, auth: auth, device: device, cancelToken: cancelToken);

  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Duration? timeout,
    bool auth = true,
    bool device = false,
    String? idempotencyKey,
    CancelToken? cancelToken,
  }) =>
      _send('POST', path,
          body: body,
          query: query,
          timeout: timeout,
          auth: auth,
          device: device,
          idempotencyKey: idempotencyKey,
          cancelToken: cancelToken);

  Future<Map<String, dynamic>> put(
    String path, {
    Object? body,
    Duration? timeout,
    String? idempotencyKey,
  }) =>
      _send('PUT', path, body: body, timeout: timeout, idempotencyKey: idempotencyKey);

  Future<Map<String, dynamic>> patch(
    String path, {
    Object? body,
    Duration? timeout,
    String? idempotencyKey,
  }) =>
      _send('PATCH', path, body: body, timeout: timeout, idempotencyKey: idempotencyKey);

  Future<Map<String, dynamic>> delete(String path, {Object? body, String? idempotencyKey}) =>
      _send('DELETE', path, body: body, idempotencyKey: idempotencyKey);

  /// Generic entry point used by the offline outbox to replay a queued mutation.
  Future<Map<String, dynamic>> send(
    String method,
    String path, {
    Object? body,
    String? idempotencyKey,
  }) =>
      _send(method, path, body: body, idempotencyKey: idempotencyKey);

  /// Multipart upload of one local file (cross-platform: supports Web via bytes and Native via file).
  Future<Map<String, dynamic>> upload(
    String path, {
    required String filePath,
    List<int>? fileBytes,
    String field = 'file',
    String? filename,
    DioMediaType? contentType,
    Map<String, String> fields = const {},
    bool device = false,
    void Function(int sent, int total)? onProgress,
    CancelToken? cancelToken,
    Duration? timeout,
  }) async {
    final String cleanFilename = filename ?? filePath.split(RegExp(r'[/\\]')).lastOrNull ?? 'upload';

    DioMediaType? mediaType = contentType;
    if (mediaType == null) {
      final ext = cleanFilename.toLowerCase().split('.').lastOrNull ?? '';
      switch (ext) {
        case 'mp4':
          mediaType = DioMediaType('video', 'mp4');
          break;
        case 'mov':
          mediaType = DioMediaType('video', 'quicktime');
          break;
        case 'webm':
          mediaType = DioMediaType('video', 'webm');
          break;
        case 'png':
          mediaType = DioMediaType('image', 'png');
          break;
        case 'jpg':
        case 'jpeg':
          mediaType = DioMediaType('image', 'jpeg');
          break;
        case 'webp':
          mediaType = DioMediaType('image', 'webp');
          break;
      }
    }

    final MultipartFile multipartFile;
    if (kIsWeb || fileBytes != null) {
      List<int> bytes = fileBytes ?? const <int>[];
      if (bytes.isEmpty && filePath.isNotEmpty) {
        try {
          bytes = await XFile(filePath).readAsBytes();
        } catch (_) {}
      }
      multipartFile = MultipartFile.fromBytes(
        bytes,
        filename: cleanFilename,
        contentType: mediaType,
      );
    } else {
      multipartFile = await MultipartFile.fromFile(
        filePath,
        filename: cleanFilename,
        contentType: mediaType,
      );
    }

    final form = FormData.fromMap({
      ...fields,
      field: multipartFile,
    });
    return _send(
      'POST',
      path,
      body: form,
      device: device,
      timeout: timeout ?? AppConfig.uploadTimeout,
      onSendProgress: onProgress,
      cancelToken: cancelToken,
    );
  }

  /// Multipart POST with a caller-built form (several files).
  Future<Map<String, dynamic>> postForm(
    String path,
    FormData form, {
    bool device = false,
    void Function(int sent, int total)? onProgress,
    CancelToken? cancelToken,
  }) =>
      _send('POST', path,
          body: form,
          device: device,
          timeout: AppConfig.uploadTimeout,
          onSendProgress: onProgress,
          cancelToken: cancelToken);

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Duration? timeout,
    bool auth = true,
    bool device = false,
    String? idempotencyKey,
    CancelToken? cancelToken,
    ProgressCallback? onSendProgress,
  }) async {
    try {
      final response = await dio.request<Object?>(
        path,
        data: body,
        queryParameters: query,
        cancelToken: cancelToken,
        onSendProgress: onSendProgress,
        options: Options(
          method: method,
          receiveTimeout: timeout,
          sendTimeout: timeout,
          headers: {'Idempotency-Key': ?idempotencyKey},
          extra: {'auth': auth, 'device': device},
        ),
      );
      final data = response.data;
      if (data is Map) return data.cast<String, dynamic>();
      if (data == null || (data is String && data.isEmpty)) return <String, dynamic>{};
      return {'data': data};
    } on DioException catch (e) {
      final err = ApiException.fromDio(e);
      // APP_DISABLED names no app, so only a social-media route means *this* app is off.
      // A disabled media-editor (AI Director, transcription, stock) must not lock the whole
      // app; that error just surfaces on the Studio action that hit it.
      final locksApp = err.kind != ApiErrorKind.appDisabled || path.startsWith('/api/v1/social-media');
      if (err.isAccessLock && locksApp) onAccessLocked?.call(err);
      throw err;
    }
  }

  // ── interceptor ────────────────────────────────────────────────────────────

  Future<void> _onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    options.headers.remove('x-company-id');
    if (options.extra['auth'] != false) {
      final token = await _tokens.accessToken;
      if (token != null && token.isNotEmpty) options.headers['Authorization'] = 'Bearer $token';
    }
    if (options.extra['device'] == true) {
      final deviceToken = await _tokens.deviceToken;
      if (deviceToken != null && deviceToken.isNotEmpty) options.headers['x-device-token'] = deviceToken;
    }
    handler.next(options);
  }

  void _onResponse(Response<Object?> response, ResponseInterceptorHandler handler) {
    onReachability?.call(true);
    handler.next(response);
  }

  Future<void> _onError(DioException err, ErrorInterceptorHandler handler) async {
    final status = err.response?.statusCode;
    if (err.response != null) {
      onReachability?.call(true);
    } else if (err.type == DioExceptionType.connectionError ||
        err.type == DioExceptionType.connectionTimeout) {
      onReachability?.call(false);
    }

    final opts = err.requestOptions;
    final canRefresh = status == 401 && opts.extra['auth'] != false && opts.extra['retried'] != true;
    if (!canRefresh) return handler.next(err);

    final usedHeader = opts.headers['Authorization'] as String?;
    final current = await _tokens.accessToken;
    String? token;
    if (current != null && usedHeader != 'Bearer $current') {
      // Another request refreshed the token while this one was in flight.
      token = current;
    } else {
      final outcome = await _refreshAccessToken();
      switch (outcome) {
        case _Refreshed(:final token_):
          token = token_;
        case _RefreshNetworkFailure(:final error):
          return handler.next(error);
        case _RefreshRejected():
          onSessionExpired?.call();
          return handler.next(err);
      }
    }

    opts.headers['Authorization'] = 'Bearer $token';
    opts.extra['retried'] = true;
    try {
      final retried = await dio.fetch<Object?>(opts);
      return handler.resolve(retried);
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) onSessionExpired?.call();
      return handler.next(e);
    }
  }

  Future<_RefreshOutcome> _refreshAccessToken() {
    final inFlight = _refreshing;
    if (inFlight != null) return inFlight;
    final future = _doRefresh();
    _refreshing = future;
    future.whenComplete(() => _refreshing = null);
    return future;
  }

  Future<_RefreshOutcome> _doRefresh() async {
    final refreshToken = await _tokens.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) {
      await _tokens.clearSession();
      return const _RefreshRejected();
    }
    try {
      final res = await _refreshDio.post<Object?>(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = res.data;
      final token = data is Map ? (data['token'] ?? data['accessToken']) as String? : null;
      if (token == null || token.isEmpty) {
        await _tokens.clearSession();
        return const _RefreshRejected();
      }
      // Servers with sliding rotation return a fresh refresh token; older ones do not.
      final rotated = data is Map ? data['refreshToken'] as String? : null;
      await _tokens.saveSession(accessToken: token, refreshToken: (rotated?.isNotEmpty ?? false) ? rotated : null);
      return _Refreshed(token);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status != null && status >= 400 && status < 500) {
        await _tokens.clearSession();
        return const _RefreshRejected();
      }
      return _RefreshNetworkFailure(e);
    }
  }
}

sealed class _RefreshOutcome {
  const _RefreshOutcome();
}

class _Refreshed extends _RefreshOutcome {
  const _Refreshed(this.token_);
  final String token_;
}

class _RefreshRejected extends _RefreshOutcome {
  const _RefreshRejected();
}

class _RefreshNetworkFailure extends _RefreshOutcome {
  const _RefreshNetworkFailure(this.error);
  final DioException error;
}
