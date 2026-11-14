import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint, kIsWeb, visibleForTesting;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/native_engine/media_engine_service.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/network/device_registration.dart';
import '../../core/util/json.dart';

/// Whether the creator lets the AI editor look at still frames of their clips (AI Director quality-fix Phase 2).
///
/// null = not asked yet (the Director panel asks once), true = allowed, false = declined. Stored on this device only.
class VisionConsent {
  VisionConsent._();
  static const _key = 'director_vision_consent';

  static Future<bool?> read() async {
    try {
      final p = await SharedPreferences.getInstance();
      final v = p.getString(_key);
      return v == 'granted' ? true : v == 'declined' ? false : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> write(bool allowed) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, allowed ? 'granted' : 'declined');
  }
}

/// Frame times to look at: one shortly after each scene cut plus one every [everyMs], capped at [max] and thinned
/// evenly. Same algorithm as `keyframeTimesMs` in packages/video-contracts/src/shot-log.ts.
List<int> keyframeTimesMs(int durationMs, List<int> scenesMs, {int everyMs = 2000, int max = 60}) {
  final cap = max.clamp(1, 60);
  final end = (durationMs - 100).clamp(0, 1 << 31);
  final raw = <double>[
    for (final t in scenesMs)
      if (t >= 0 && t < end) (t + 300).clamp(0, end).toDouble(),
    for (var i = 0; i <= end ~/ everyMs; i++) (i * everyMs + (everyMs / 2).clamp(0, 500)).clamp(0, end).toDouble(),
  ]..sort();
  final uniq = <int>[];
  for (final t in raw) {
    if (uniq.isEmpty || t - uniq.last >= 250) uniq.add(t.round());
  }
  if (uniq.length <= cap) return uniq;
  final step = uniq.length / cap;
  return [for (var i = 0; i < cap; i++) uniq[(i * step).floor()]];
}

/// Width to ask the decoder for so the LONG side of the still is at most [longSide] px.
int frameWidthFor(int width, int height, {int longSide = 512}) {
  if (width <= 0 || height <= 0) return longSide;
  if (width >= height) return width < longSide ? width : longSide;
  final w = (longSide * width / height).round();
  return w < 2 ? 2 : w;
}

/// Hash of a local file for caching its ShotLog: size + first and last 256 KB (fast on long videos, stable across
/// renames and copies).
Future<String?> sourceHash(String path) async {
  try {
    final f = File(path);
    final len = await f.length();
    const chunk = 256 * 1024;
    final raf = await f.open();
    try {
      final head = await raf.read(chunk);
      await raf.setPosition(len > chunk ? len - chunk : 0);
      final tail = await raf.read(chunk);
      final digest = sha256.convert([...utf8.encode('$len|'), ...head, ...tail]);
      return digest.toString().substring(0, 40);
    } finally {
      await raf.close();
    }
  } catch (_) {
    return null;
  }
}

/// Looks at a clip once: still frames on the device → the server's vision pass → a text ShotLog, cached on the
/// device by file hash. Only runs with consent; the stills are deleted from the phone right after the upload and the
/// server never stores them (contract: AI_DIRECTOR_CONTRACT.md 2026-11-13 (b)).
class ShotLogService {
  ShotLogService(this._api, this._device, {@visibleForTesting Future<Directory> Function()? cacheDir})
      : _cacheDir = cacheDir ?? (() async => Directory('${(await getApplicationSupportDirectory()).path}/shot_logs'));

  final ApiClient _api;
  final DeviceRegistration _device;
  final Future<Directory> Function() _cacheDir;
  final Map<String, Future<Json?>> _inFlight = {};

  static bool isValid(Json log) => log['version'] == 'shotlog/1' && log['shots'] is List;

  Future<File> _cacheFile(String hash) async {
    final dir = await _cacheDir();
    if (!await dir.exists()) await dir.create(recursive: true);
    return File('${dir.path}/$hash.json');
  }

  /// The ShotLog of [path] for [assetId], or null (no consent, web, the vision pass is unavailable or failed).
  /// Never throws: the Director works without it.
  Future<Json?> lookAt({
    required String path,
    required String assetId,
    required int durationMs,
    required int width,
    required int height,
    List<int> scenesMs = const [],
    CancelToken? cancelToken,
  }) async {
    if (kIsWeb || await VisionConsent.read() != true) return null;
    final hash = await sourceHash(path);
    if (hash == null) return null;
    // One pass per file, even when it backs several assets.
    final log = await _inFlight.putIfAbsent(hash, () async {
      try {
        return await _lookAt(hash, path, assetId, durationMs, width, height, scenesMs, cancelToken);
      } catch (e) {
        debugPrint('[vision] no shot log for $assetId: $e');
        return null;
      }
    }).whenComplete(() => _inFlight.remove(hash));
    return log == null ? null : {...log, 'assetId': assetId};
  }

  Future<Json?> _lookAt(String hash, String path, String assetId, int durationMs, int width, int height, List<int> scenesMs, CancelToken? cancel) async {
    final cached = await _cacheFile(hash);
    if (await cached.exists()) {
      try {
        final log = jMap(jsonDecode(await cached.readAsString()));
        if (isValid(log)) return log;
      } catch (_) {}
    }
    await _device.ensureToken();
    // The server may already have looked at this file (another device or project of the workspace).
    try {
      final r = await _api.get('/api/v1/media-editor/vision/shot-log', query: {'assetId': assetId, 'sourceHash': hash}, device: true, cancelToken: cancel);
      final log = jMap(r['data']);
      if (isValid(log)) {
        await cached.writeAsString(jsonEncode(log));
        return log;
      }
    } on ApiException catch (e) {
      if (e.kind != ApiErrorKind.notFound) rethrow;
    }

    final times = keyframeTimesMs(durationMs, scenesMs);
    final tmp = Directory('${(await getTemporaryDirectory()).path}/vision_${DateTime.now().microsecondsSinceEpoch}');
    await tmp.create(recursive: true);
    try {
      final files = await MediaEngineService.generateThumbnails(
        sourcePath: path,
        outputDir: tmp.path,
        timesMs: times,
        maxWidth: frameWidthFor(width, height),
        quality: 70,
      );
      if (files.length != times.length) throw StateError('expected ${times.length} stills, got ${files.length}');
      final form = FormData();
      form.fields.addAll([
        const MapEntry('consent', 'granted'),
        MapEntry('assetId', assetId),
        MapEntry('sourceHash', hash),
        MapEntry('durationMs', '$durationMs'),
        MapEntry('width', '$width'),
        MapEntry('height', '$height'),
        MapEntry('timesMs', jsonEncode(times)),
        MapEntry('scenesMs', jsonEncode(scenesMs.take(2000).toList())),
      ]);
      for (final f in files) {
        form.files.add(MapEntry('frames', await MultipartFile.fromFile(f, filename: f.split(RegExp(r'[/\\]')).last, contentType: DioMediaType('image', 'jpeg'))));
      }
      final r = await _api.postForm('/api/v1/media-editor/vision/shot-log', form, device: true, cancelToken: cancel);
      if (r['success'] == false) throw ApiException.fromResponse(200, r);
      final log = jMap(r['data']);
      if (!isValid(log)) throw StateError('invalid shot log');
      await cached.writeAsString(jsonEncode(log));
      return log;
    } finally {
      // The stills never outlive the upload.
      try {
        await tmp.delete(recursive: true);
      } catch (_) {}
    }
  }

  /// Issues worth a repair turn (critical / major); minor ones are only reported.
  static List<Json> repairableIssues(Json critique) =>
      [for (final i in jList(critique['issues'], (m) => m)) if (i['severity'] == 'critical' || i['severity'] == 'major') i];

  /// The visual check (quality-fix Phase 5): stills of the RENDERED edit at the Director's [checkpoints] → the
  /// server's critique ({score, issues, summary}), or null when it could not be made. Only with consent; the stills
  /// are deleted right after the upload and the server does not store them.
  Future<Json?> critique({
    required String videoPath,
    required List<Json> checkpoints,
    required int durationMs,
    required int width,
    required int height,
    String? aspect,
    String? prompt,
    CancelToken? cancelToken,
  }) async {
    if (kIsWeb || checkpoints.isEmpty || await VisionConsent.read() != true) return null;
    final cps = [
      for (final c in checkpoints.take(40))
        if (c['tMs'] is num) {...c, 'tMs': (c['tMs'] as num).toInt().clamp(0, durationMs > 60 ? durationMs - 60 : 0)},
    ];
    if (cps.isEmpty) return null;
    final tmp = Directory('${(await getTemporaryDirectory()).path}/check_${DateTime.now().microsecondsSinceEpoch}');
    await tmp.create(recursive: true);
    try {
      final files = await MediaEngineService.generateThumbnails(
        sourcePath: videoPath,
        outputDir: tmp.path,
        timesMs: [for (final c in cps) c['tMs'] as int],
        maxWidth: frameWidthFor(width, height),
        exact: true,
        quality: 70,
      );
      if (files.length != cps.length) return null;
      await _device.ensureToken();
      final form = FormData();
      form.fields.addAll([
        const MapEntry('consent', 'granted'),
        MapEntry('checkpoints', jsonEncode(cps)),
        MapEntry('width', '$width'),
        MapEntry('height', '$height'),
        if (aspect != null) MapEntry('aspect', aspect),
        if (prompt != null && prompt.trim().isNotEmpty) MapEntry('prompt', prompt.length > 2000 ? prompt.substring(0, 2000) : prompt),
      ]);
      for (final f in files) {
        form.files.add(MapEntry('frames', await MultipartFile.fromFile(f, filename: f.split(RegExp(r'[/\\]')).last, contentType: DioMediaType('image', 'jpeg'))));
      }
      final r = await _api.postForm('/api/v1/media-editor/vision/critique', form, device: true, cancelToken: cancelToken);
      if (r['success'] == false) return null;
      final c = jMap(r['data']);
      return c['score'] is num ? c : null;
    } catch (e) {
      debugPrint('[vision] visual check failed: $e');
      return null;
    } finally {
      try {
        await tmp.delete(recursive: true);
      } catch (_) {}
    }
  }

  /// Forgets every cached ShotLog on this device (when the creator turns the setting off).
  Future<void> clearCache() async {
    try {
      final dir = await _cacheDir();
      if (await dir.exists()) await dir.delete(recursive: true);
    } catch (_) {}
  }
}
