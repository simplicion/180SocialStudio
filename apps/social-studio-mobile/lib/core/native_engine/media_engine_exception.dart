import 'package:flutter/services.dart';

/// Typed failure from the on-device media engine.
///
/// [code] is stable and comes from the native side (for example `FILE_NOT_FOUND`,
/// `NO_AUDIO_TRACK`, `INVALID_EDIT_IR`, `MISSING_MEDIA`, `EXPORT_FAILED`, `CANCELLED`,
/// `ENGINE_UNAVAILABLE`). The engine never substitutes placeholder output for a failure.
class MediaEngineException implements Exception {
  MediaEngineException(this.code, this.message, {this.detail});

  /// Converts a channel error into a typed exception.
  factory MediaEngineException.fromPlatform(PlatformException e) =>
      MediaEngineException(e.code, e.message ?? e.code, detail: e.details?.toString());

  /// No native implementation is registered, for example on web/desktop or in a unit test
  /// that did not mock the channel.
  factory MediaEngineException.unavailable(String method) => MediaEngineException(
        'ENGINE_UNAVAILABLE',
        'The native media engine is not available on this platform (method: $method)',
      );

  static const cancelledCode = 'CANCELLED';

  final String code;
  final String message;
  final String? detail;

  bool get isCancelled => code == cancelledCode;

  @override
  String toString() => 'MediaEngineException($code): $message${detail == null ? '' : ' [$detail]'}';
}
