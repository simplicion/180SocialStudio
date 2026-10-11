import 'package:dio/dio.dart';

enum ApiErrorKind {
  /// No connection, DNS failure, or the server could not be reached.
  network,
  timeout,
  cancelled,

  /// 401 that could not be fixed by refreshing: the user must sign in again.
  unauthorized,

  /// Generic 403.
  forbidden,

  /// 403 `code: APP_DISABLED` from `moduleGuard`.
  appDisabled,

  /// 403 `{ subscriptionExpired: true }` from `subscriptionGuard`.
  subscriptionExpired,

  /// 403 `{ companySuspended: true }` from `subscriptionGuard`.
  companySuspended,

  /// 403 `DESKTOP_APP_REQUIRED` from `requireDesktopDevice` (missing or invalid device token).
  deviceRequired,
  notFound,
  conflict,
  validation,
  tooLarge,
  rateLimited,
  server,
  unavailable,
  unknown,
}

/// Every failure from the HTTP layer is one of these. The [message] is the server's own text
/// whenever the server sent one; the UI shows it as-is rather than inventing a success.
class ApiException implements Exception {
  ApiException({
    required this.kind,
    required this.message,
    this.statusCode,
    this.code,
    this.data,
  });

  final ApiErrorKind kind;
  final String message;
  final int? statusCode;
  final String? code;
  final Object? data;

  bool get isNetwork => kind == ApiErrorKind.network || kind == ApiErrorKind.timeout;

  /// Whether retrying the same request later could succeed (network, 408/429/5xx).
  bool get isTransient =>
      isNetwork ||
      kind == ApiErrorKind.rateLimited ||
      kind == ApiErrorKind.server ||
      kind == ApiErrorKind.unavailable;

  bool get isAccessLock =>
      kind == ApiErrorKind.appDisabled ||
      kind == ApiErrorKind.subscriptionExpired ||
      kind == ApiErrorKind.companySuspended;

  /// Field-level issues from a Zod 400 (`issues`), if any.
  List<String> get issues {
    final d = data;
    if (d is Map && d['issues'] is List) {
      return (d['issues'] as List).map((i) {
        if (i is Map) {
          final path = i['path'] is List ? (i['path'] as List).join('.') : '';
          return path.isEmpty ? '${i['message']}' : '$path: ${i['message']}';
        }
        return '$i';
      }).toList();
    }
    return [];
  }

  @override
  String toString() => 'ApiException(${statusCode ?? '-'} ${code ?? kind.name}): $message';

  static final _codePattern = RegExp(r'^[A-Z][A-Z0-9_]+$');

  factory ApiException.fromDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
        return ApiException(
          kind: ApiErrorKind.timeout,
          message: 'The server took too long to respond. Check your connection and try again.',
        );
      case DioExceptionType.cancel:
        return ApiException(kind: ApiErrorKind.cancelled, message: 'Request cancelled.');
      case DioExceptionType.connectionError:
        return ApiException(
          kind: ApiErrorKind.network,
          message: 'Cannot reach 180 Workspace. You appear to be offline.',
        );
      case DioExceptionType.badCertificate:
        return ApiException(kind: ApiErrorKind.network, message: 'The server certificate could not be verified.');
      case DioExceptionType.badResponse:
      case DioExceptionType.unknown:
        final response = e.response;
        if (response == null) {
          final inner = e.error;
          if (inner is ApiException) return inner;
          final innerStr = inner?.toString() ?? e.message ?? 'no response';
          String userMsg = 'Cannot reach 180 Workspace ($innerStr).';
          if (innerStr.contains('Broken pipe') || innerStr.contains('errno = 32') || innerStr.contains('Connection reset')) {
            userMsg = 'Connection to 180 Workspace was interrupted during transfer (Broken pipe). The file may be too large or the network dropped.';
          } else if (innerStr.contains('Connection refused')) {
            userMsg = 'Cannot connect to 180 Workspace server. Please check your network or server status.';
          }
          return ApiException(
            kind: ApiErrorKind.network,
            message: userMsg,
          );
        }
        return ApiException.fromResponse(response.statusCode ?? 0, response.data);
    }
  }

  factory ApiException.fromResponse(int status, Object? body) {
    String? message;
    String? code;
    if (body is Map) {
      final m = body['message'];
      final err = body['error'];
      if (m is String && m.trim().isNotEmpty) message = m;
      if (err is String && err.trim().isNotEmpty) {
        if (_codePattern.hasMatch(err)) {
          code = err;
        } else {
          message ??= err;
        }
      } else if (err is Map && err['message'] is String) {
        message ??= err['message'] as String;
      }
      if (body['code'] is String) code = body['code'] as String;
    } else if (body is String && body.trim().isNotEmpty && body.length < 300 && !body.contains('<html')) {
      message = body.trim();
    }

    ApiErrorKind kind;
    if (status == 401) {
      kind = ApiErrorKind.unauthorized;
    } else if (status == 403) {
      if (code == 'APP_DISABLED') {
        kind = ApiErrorKind.appDisabled;
      } else if (body is Map && body['subscriptionExpired'] == true) {
        kind = ApiErrorKind.subscriptionExpired;
      } else if (body is Map && body['companySuspended'] == true) {
        kind = ApiErrorKind.companySuspended;
      } else if (code == 'DESKTOP_APP_REQUIRED') {
        kind = ApiErrorKind.deviceRequired;
      } else {
        kind = ApiErrorKind.forbidden;
      }
    } else if (status == 404) {
      kind = ApiErrorKind.notFound;
    } else if (status == 409) {
      kind = ApiErrorKind.conflict;
    } else if (status == 413) {
      kind = ApiErrorKind.tooLarge;
    } else if (status == 408 || status == 429) {
      kind = ApiErrorKind.rateLimited;
    } else if (status == 400 || status == 415 || status == 422) {
      kind = ApiErrorKind.validation;
    } else if (status == 503) {
      kind = ApiErrorKind.unavailable;
    } else if (status >= 500) {
      kind = ApiErrorKind.server;
    } else {
      kind = ApiErrorKind.unknown;
    }

    message ??= switch (kind) {
      ApiErrorKind.unauthorized => 'Your session has expired. Please sign in again.',
      ApiErrorKind.notFound => 'Not found (HTTP 404). This feature may not be available on the server yet.',
      ApiErrorKind.tooLarge => 'File size exceeds server upload limit (HTTP 413). Please choose a smaller file.',
      ApiErrorKind.rateLimited => 'Too many requests (HTTP 429). Please wait a moment and try again.',
      ApiErrorKind.server => 'The server failed to handle the request (HTTP $status).',
      ApiErrorKind.unavailable => 'The service is temporarily unavailable (HTTP 503).',
      _ => 'Request failed (HTTP $status).',
    };
    return ApiException(kind: kind, message: message, statusCode: status, code: code, data: body);
  }
}
