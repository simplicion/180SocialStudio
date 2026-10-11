import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// A request the app sent to the fake backend.
class RecordedRequest {
  RecordedRequest({
    required this.method,
    required this.path,
    required this.query,
    required this.headers,
    required this.body,
    required this.params,
  });

  final String method;
  final String path;
  final Map<String, dynamic> query;
  final Map<String, dynamic> headers;

  /// Decoded JSON body, or a `Map` of the text fields of a multipart form (files are listed
  /// under `__files` by field name), or null.
  final Object? body;

  /// Path parameters captured by the matching route pattern (`:id` → `params['id']`).
  final Map<String, String> params;

  Map<String, dynamic> get json => (body as Map).cast<String, dynamic>();

  String? get authorization => headers['authorization'] as String? ?? headers['Authorization'] as String?;
  String? get idempotencyKey => headers['idempotency-key'] as String? ?? headers['Idempotency-Key'] as String?;

  @override
  String toString() => '$method $path ${body == null ? '' : jsonEncode(body is FormData ? '<form>' : body)}';
}

/// What a route answers with.
class FakeResponse {
  FakeResponse.json(this.body, {this.status = 200}) : networkError = false;

  /// The request never reaches a server (DNS/connection failure → `ApiErrorKind.network`).
  FakeResponse.networkError()
      : body = null,
        status = 0,
        networkError = true;

  /// The backend's standard failure envelope: `{ success: false, error }`.
  factory FakeResponse.error(int status, String error) => FakeResponse.json({'success': false, 'error': error}, status: status);

  final Object? body;
  final int status;
  final bool networkError;
}

typedef FakeHandler = FutureOr<FakeResponse> Function(RecordedRequest request);

class _Route {
  _Route(this.method, String pattern, this.handler)
      : names = RegExp(r':(\w+)').allMatches(pattern).map((m) => m.group(1)!).toList(),
        regex = RegExp('^${pattern.replaceAllMapped(RegExp(r':(\w+)'), (_) => '([^/]+)')}\$');

  final String method;
  final RegExp regex;
  final List<String> names;
  final FakeHandler handler;
}

/// An [HttpClientAdapter] standing in for the 180 Workspace backend.
///
/// Routes are `method + path pattern` → handler; later registrations win, so a test can
/// override one route of a pre-seeded backend. Every request is recorded in [requests].
/// Unknown routes answer like the Express app: 404 `{ success: false, error }`.
///
/// Auth simulation: when [validAccessToken] is set, any authenticated request whose bearer
/// token differs gets a 401, and `POST /api/auth/refresh` exchanges [validRefreshToken] for a
/// new access token (or answers 401 when [refreshRejected]).
class FakeBackend implements HttpClientAdapter {
  FakeBackend();

  final List<_Route> _routes = [];
  final List<RecordedRequest> requests = [];

  String? validAccessToken;
  String validRefreshToken = 'refresh-1';
  bool refreshRejected = false;
  int _tokenCounter = 1;

  /// When true every request fails as if the device were offline.
  bool offline = false;

  void on(String method, String pattern, FakeHandler handler) => _routes.insert(0, _Route(method.toUpperCase(), pattern, handler));

  void json(String method, String pattern, Object body, {int status = 200}) =>
      on(method, pattern, (_) => FakeResponse.json(body, status: status));

  void fail(String method, String pattern, int status, String error) =>
      on(method, pattern, (_) => FakeResponse.error(status, error));

  void networkError(String method, String pattern) => on(method, pattern, (_) => FakeResponse.networkError());

  /// Makes [pattern] wait until the returned completer is completed (to observe loading UI).
  Completer<void> hold(String method, String pattern, Object body, {int status = 200}) {
    final gate = Completer<void>();
    on(method, pattern, (_) async {
      await gate.future;
      return FakeResponse.json(body, status: status);
    });
    return gate;
  }

  Iterable<RecordedRequest> calls(String method, String path) =>
      requests.where((r) => r.method == method.toUpperCase() && r.path == path);

  RecordedRequest? last(String method, String path) {
    final list = calls(method, path).toList();
    return list.isEmpty ? null : list.last;
  }

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final path = options.uri.path;
    final method = options.method.toUpperCase();
    final body = await _decodeBody(options, requestStream);
    final headers = <String, dynamic>{for (final e in options.headers.entries) e.key.toLowerCase(): e.value};

    _Route? match;
    Map<String, String> params = const {};
    for (final r in _routes) {
      if (r.method != method) continue;
      final m = r.regex.firstMatch(path);
      if (m == null) continue;
      match = r;
      params = {for (var i = 0; i < r.names.length; i++) r.names[i]: Uri.decodeComponent(m.group(i + 1)!)};
      break;
    }

    final req = RecordedRequest(
      method: method,
      path: path,
      query: Map<String, dynamic>.from(options.uri.queryParameters),
      headers: headers,
      body: body,
      params: params,
    );
    requests.add(req);

    if (offline) throw _connectionError(options);

    if (path == '/api/auth/refresh' && method == 'POST' && match == null) {
      final sent = (body is Map) ? body['refreshToken'] : null;
      if (refreshRejected || sent != validRefreshToken) {
        return _respond(FakeResponse.error(401, 'Invalid refresh token'));
      }
      validAccessToken = 'access-${++_tokenCounter}';
      return _respond(FakeResponse.json({'token': validAccessToken}));
    }

    final needsAuth = options.extra['auth'] != false;
    final token = validAccessToken;
    if (needsAuth && token != null && req.authorization != 'Bearer $token') {
      return _respond(FakeResponse.json({'success': false, 'message': 'Not authorized, token failed'}, status: 401));
    }

    final response = match == null
        ? FakeResponse.error(404, 'Route not found: $method $path')
        : await match.handler(req);
    if (response.networkError) throw _connectionError(options);
    return _respond(response);
  }

  DioException _connectionError(RequestOptions options) => DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
        error: 'Failed host lookup (fake backend offline)',
      );

  Future<Object?> _decodeBody(RequestOptions options, Stream<Uint8List>? stream) async {
    final data = options.data;
    if (data is FormData) {
      await stream?.drain<void>();
      return <String, dynamic>{
        for (final f in data.fields) f.key: f.value,
        '__files': [for (final f in data.files) f.key],
      };
    }
    if (stream == null) return data;
    final bytes = <int>[];
    await for (final chunk in stream) {
      bytes.addAll(chunk);
    }
    if (bytes.isEmpty) return null;
    final text = utf8.decode(bytes);
    try {
      return jsonDecode(text);
    } catch (_) {
      return text;
    }
  }

  ResponseBody _respond(FakeResponse r) => ResponseBody.fromString(
        r.body == null ? '' : jsonEncode(r.body),
        r.status,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );

  @override
  void close({bool force = false}) {}
}
