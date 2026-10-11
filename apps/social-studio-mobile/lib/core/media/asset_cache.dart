import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Why a download did not produce a usable file.
class AssetDownloadException implements Exception {
  AssetDownloadException(this.code, this.message);
  final String code;
  final String message;
  @override
  String toString() => message;
}

/// Kind of media expected at a URL (used to validate what came back).
enum AssetKind { video, image, audio }

/// One shared, content-addressed cache of online media (stock B-roll, photos, music, SFX, logos).
///
/// * Every URL is downloaded once into app storage (`asset_cache/<sha1>.<ext>`) and reused by the preview, the
///   export and later edits; the timeline keeps the real https URL (credits and the server contract stay intact).
/// * Downloads resume (HTTP Range), retry on 429 / 5xx / network drops with backoff, and are written to `.part`
///   then renamed, so a cut-off download never leaves a broken file behind.
/// * What arrives is checked: an HTML error page or an empty / truncated file is rejected with a clear reason.
/// * The same URL is never downloaded twice in parallel, at most [maxParallel] downloads run at once, and the
///   cache is trimmed (least recently used) when it grows past [maxBytes].
class AssetCache {
  AssetCache._();
  static final AssetCache instance = AssetCache._();

  static const maxParallel = 3;
  static const maxBytes = 3 * 1024 * 1024 * 1024; // 3 GB

  final Dio _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 60),
    followRedirects: true,
    headers: {'User-Agent': '180Workspace-SocialStudio/1.0'},
  ));

  Directory? _dir;

  /// sha1(url) → cached file path (built once at [init], updated on every download).
  final Map<String, String> _index = {};
  final Map<String, Future<String>> _inflight = {};
  int _running = 0;
  final List<Completer<void>> _queue = [];

  /// Tests: replaces the network download (url → local file path). Widget tests cannot reach the network.
  @visibleForTesting
  Future<String> Function(String url, AssetKind? kind)? fetchOverride;

  /// Runs on every downloaded video before it is handed out (set by the app to the native "make seekable" step).
  Future<void> Function(String path)? videoFinalizer;

  /// False where the app has no storage for a cache (web, plain unit tests): callers then skip prefetching.
  bool get available => _dir != null || fetchOverride != null;

  /// Live progress per URL (0..1; -1 while the size is unknown). Removed when the download ends.
  final ValueNotifier<Map<String, double>> progress = ValueNotifier(const {});

  /// Prepares the cache folder; call once at start-up (later calls are free).
  Future<void> init() async {
    if (_dir != null || kIsWeb) return;
    final Directory docs;
    try {
      docs = await getApplicationDocumentsDirectory();
    } catch (_) {
      return; // no app storage here (unit tests); `available` stays false
    }
    _open(Directory('${docs.path}/asset_cache'));
  }

  /// Uses [dir] as the cache folder (tests).
  @visibleForTesting
  void initAt(Directory dir) {
    _index.clear();
    _open(dir);
  }

  void _open(Directory folder) {
    final dir = folder..createSync(recursive: true);
    for (final f in dir.listSync().whereType<File>()) {
      final name = f.uri.pathSegments.last;
      if (name.endsWith('.part')) continue;
      final dot = name.indexOf('.');
      if (dot > 0) _index[name.substring(0, dot)] = f.path;
    }
    _dir = dir;
  }

  /// The cached file for [url], or null when it is not downloaded yet (synchronous, for build methods).
  String? cachedPath(String url) {
    if (_dir == null || !_isRemote(url)) return null;
    final path = _index[_key(url)];
    if (path == null) return null;
    if (!File(path).existsSync()) {
      _index.remove(_key(url));
      return null;
    }
    return path;
  }

  bool isCached(String url) => cachedPath(url) != null;

  /// The local file for [url], downloading it first if needed. Concurrent calls for one URL share a download.
  Future<String> ensure(String url, {AssetKind? kind, CancelToken? cancel}) async {
    if (!_isRemote(url)) {
      if (File(url).existsSync()) return url;
      throw AssetDownloadException('FILE_NOT_FOUND', 'The file is no longer on this phone.');
    }
    final override = fetchOverride;
    if (override != null) return override(url, kind);
    await init();
    final hit = cachedPath(url);
    if (hit != null) {
      // Touch for least-recently-used trimming.
      try {
        File(hit).setLastModifiedSync(DateTime.now());
      } catch (_) {}
      return hit;
    }
    // The callback must not return the removed future: whenComplete would then wait on itself forever.
    return _inflight[url] ??= _download(url, kind, cancel).whenComplete(() {
      _inflight.remove(url);
    });
  }

  /// Downloads several URLs (at most [maxParallel] at once); returns url → path and url → error.
  Future<({Map<String, String> paths, Map<String, String> errors})> ensureAll(Map<String, AssetKind?> urls) async {
    final paths = <String, String>{};
    final errors = <String, String>{};
    await Future.wait(urls.entries.map((e) async {
      try {
        paths[e.key] = await ensure(e.key, kind: e.value);
      } catch (err) {
        errors[e.key] = '$err';
      }
    }));
    return (paths: paths, errors: errors);
  }

  /// Extra request headers some free-media hosts require. ccMixter blocks hotlinked files (403 + a tiny HTML body)
  /// unless the request comes "from" its own site.
  @visibleForTesting
  static Map<String, String> hostHeaders(String url) {
    final host = Uri.tryParse(url)?.host ?? '';
    if (host == 'ccmixter.org' || host.endsWith('.ccmixter.org')) return {'referer': 'https://ccmixter.org/'};
    return const {};
  }

  Future<String> _download(String url, AssetKind? kind, CancelToken? cancel) async {
    await _slot();
    try {
      final dir = _dir!;
      final key = _key(url);
      final part = File('${dir.path}/$key.part');
      _setProgress(url, 0);
      String? contentType;
      var attempt = 0;
      while (true) {
        attempt++;
        final have = part.existsSync() ? part.lengthSync() : 0;
        try {
          final res = await _dio.download(
            url,
            part.path,
            cancelToken: cancel,
            deleteOnError: false,
            fileAccessMode: have > 0 ? FileAccessMode.append : FileAccessMode.write,
            options: Options(headers: {...hostHeaders(url), if (have > 0) 'range': 'bytes=$have-'}),
            onReceiveProgress: (got, total) => _setProgress(url, total > 0 ? (have + got) / (have + total) : -1),
          );
          // A server that ignores Range sends the whole file again: start over.
          if (have > 0 && res.statusCode == 200) {
            part.deleteSync();
            continue;
          }
          contentType = res.headers.value('content-type');
          break;
        } on DioException catch (e) {
          if (CancelToken.isCancel(e)) {
            _clearProgress(url);
            throw AssetDownloadException('CANCELLED', 'Download cancelled.');
          }
          final status = e.response?.statusCode;
          if (status == 416) {
            // Range past the end: the .part is already complete.
            contentType = e.response?.headers.value('content-type');
            break;
          }
          final retryable = status == null || status == 429 || status >= 500;
          if (!retryable || attempt >= 4) {
            _clearProgress(url);
            throw AssetDownloadException(
              status == 404 ? 'NOT_FOUND' : status == 403 ? 'FORBIDDEN' : 'DOWNLOAD_FAILED',
              status == null
                  ? 'The download stopped (no connection). It will resume from where it stopped when you retry.'
                  : 'The media server answered $status${status == 404 ? ' (the file was removed)' : ''}.',
            );
          }
          final retryAfter = int.tryParse(e.response?.headers.value('retry-after') ?? '');
          await Future<void>.delayed(Duration(milliseconds: retryAfter != null && retryAfter <= 15 ? retryAfter * 1000 : 800 * attempt * attempt));
        }
      }
      final size = part.existsSync() ? part.lengthSync() : 0;
      final ext = _extension(url, contentType, kind);
      final problem = _validate(part, size, contentType, kind);
      if (problem != null) {
        part.deleteSync();
        _clearProgress(url);
        throw AssetDownloadException('NOT_MEDIA', problem);
      }
      final out = File('${dir.path}/$key.$ext');
      part.renameSync(out.path);
      // Stock clips are often fragmented MP4s the player cannot seek in: the app normalises them once here.
      final finalize = videoFinalizer;
      if (finalize != null && const {'mp4', 'mov', 'm4v'}.contains(ext)) {
        try {
          await finalize(out.path);
        } catch (_) {
          // Optional: the export makes the file seekable again if this did not.
        }
      }
      _index[key] = out.path;
      _clearProgress(url);
      unawaited(_trim());
      return out.path;
    } finally {
      _release();
    }
  }

  /// Null when the file looks like the expected media; otherwise the reason.
  String? _validate(File f, int size, String? contentType, AssetKind? kind) {
    if (size < 512) return 'The download was empty.';
    final ct = (contentType ?? '').toLowerCase();
    if (ct.startsWith('text/html') || ct.startsWith('application/json')) {
      return 'The link returned a web page instead of media (the provider may have expired it). Search again.';
    }
    final raf = f.openSync();
    final List<int> head;
    try {
      head = raf.readSync(16);
    } finally {
      raf.closeSync();
    }
    final ascii = String.fromCharCodes(head.where((b) => b >= 32 && b < 127));
    if (ascii.toLowerCase().startsWith('<!doctype') || ascii.toLowerCase().startsWith('<html')) {
      return 'The link returned a web page instead of media. Search again.';
    }
    final isImage = _isPng(head) || _isJpeg(head) || _isWebp(head) || _isGif(head);
    if (kind == AssetKind.image && !isImage) return 'This is not a photo file.';
    if (kind == AssetKind.video && isImage) return 'This is a photo, not a video.';
    return null;
  }

  static bool _isPng(List<int> h) => h.length > 4 && h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47;
  static bool _isJpeg(List<int> h) => h.length > 3 && h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF;
  static bool _isGif(List<int> h) => h.length > 3 && h[0] == 0x47 && h[1] == 0x49 && h[2] == 0x46;
  static bool _isWebp(List<int> h) => h.length > 11 && h[8] == 0x57 && h[9] == 0x45 && h[10] == 0x42 && h[11] == 0x50;

  String _extension(String url, String? contentType, AssetKind? kind) {
    final fromPath = Uri.tryParse(url)?.pathSegments.lastOrNull?.split('.');
    final e = fromPath != null && fromPath.length > 1 ? fromPath.last.toLowerCase() : '';
    const known = {'mp4', 'mov', 'webm', 'm4v', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac'};
    if (known.contains(e)) return e;
    final ct = (contentType ?? '').toLowerCase();
    if (ct.contains('mp4')) return kind == AssetKind.audio ? 'm4a' : 'mp4';
    if (ct.contains('webm')) return 'webm';
    if (ct.contains('jpeg')) return 'jpg';
    if (ct.contains('png')) return 'png';
    if (ct.contains('webp')) return 'webp';
    if (ct.contains('mpeg')) return 'mp3';
    if (ct.contains('wav')) return 'wav';
    if (ct.contains('ogg')) return 'ogg';
    return switch (kind) { AssetKind.image => 'jpg', AssetKind.audio => 'mp3', _ => 'mp4' };
  }

  /// Least-recently-used trim down to [maxBytes] (files in use are recent, so they stay).
  Future<void> _trim() async {
    final dir = _dir;
    if (dir == null) return;
    final files = dir.listSync().whereType<File>().where((f) => !f.path.endsWith('.part')).toList()
      ..sort((a, b) => a.lastModifiedSync().compareTo(b.lastModifiedSync()));
    var total = files.fold<int>(0, (s, f) => s + f.lengthSync());
    for (final f in files) {
      if (total <= maxBytes) break;
      final age = DateTime.now().difference(f.lastModifiedSync());
      if (age < const Duration(hours: 1)) break;
      total -= f.lengthSync();
      try {
        f.deleteSync();
        _index.removeWhere((_, path) => path == f.path);
      } catch (_) {}
    }
  }

  Future<void> _slot() async {
    if (_running < maxParallel) {
      _running++;
      return;
    }
    final c = Completer<void>();
    _queue.add(c);
    await c.future;
    _running++;
  }

  void _release() {
    _running = math.max(0, _running - 1);
    if (_queue.isNotEmpty) _queue.removeAt(0).complete();
  }

  void _setProgress(String url, double p) => progress.value = {...progress.value, url: p};
  void _clearProgress(String url) => progress.value = {...progress.value}..remove(url);

  static bool _isRemote(String url) => url.startsWith('https://') || url.startsWith('http://');
  static String _key(String url) => sha1.convert(utf8.encode(url)).toString();
}
