import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path_provider/path_provider.dart';

import '../../core/native_engine/media_engine_service.dart';

/// One JPEG frame per local video, generated on the device once and reused (memory + disk cache), so the timeline
/// can show what a clip contains without decoding video while scrolling.
class VideoThumbnails {
  VideoThumbnails._();

  static final Map<String, Future<String?>> _memo = {};
  static const _videoExt = {'mp4', 'mov', 'm4v', 'webm', 'mkv', '3gp'};

  /// Whether [path] is a local video file (remote URLs and photos already have an image to show).
  static bool isLocalVideo(String? path) {
    if (kIsWeb || path == null || path.isEmpty || path.startsWith('http://') || path.startsWith('https://')) return false;
    final dot = path.lastIndexOf('.');
    return dot > 0 && _videoExt.contains(path.substring(dot + 1).toLowerCase());
  }

  /// Path of a cached frame ~1 s into [videoPath], or null when it cannot be extracted (the caller shows a colour).
  static Future<String?> frameFor(String videoPath, {int atMs = 1000}) =>
      _memo.putIfAbsent('$videoPath@$atMs', () => _generate(videoPath, atMs));

  static Future<String?> _generate(String videoPath, int atMs) async {
    try {
      final dir = Directory('${(await getTemporaryDirectory()).path}/studio_thumbs');
      if (!await dir.exists()) await dir.create(recursive: true);
      final name = sha1.convert(utf8.encode('$videoPath@$atMs')).toString().substring(0, 16);
      final cached = File('${dir.path}/$name.jpg');
      if (await cached.exists()) return cached.path;
      final out = await MediaEngineService.generateThumbnails(sourcePath: videoPath, outputDir: dir.path, timesMs: [atMs], maxWidth: 240);
      if (out.isEmpty) return null;
      final made = File(out.first);
      return (await made.rename(cached.path)).path;
    } catch (_) {
      return null;
    }
  }
}
