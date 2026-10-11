import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Durable home for recorded takes. The camera writes into the OS cache directory, which Android may purge at any
/// time, so every take is moved to `<app documents>/clips/<project>/` before the library or a calendar piece points
/// at it. Media stays on the device; only metadata is ever sent to the server.
class ClipStore {
  ClipStore({Future<Directory> Function()? baseDir, Future<Directory> Function()? tempDir})
      : _baseDir = baseDir ?? getApplicationDocumentsDirectory,
        _tempDir = tempDir ?? getTemporaryDirectory;

  final Future<Directory> Function() _baseDir;
  final Future<Directory> Function() _tempDir;
  static final _rand = Random();

  /// Directory that holds the takes of [projectId] (created on demand).
  Future<Directory> dirFor(String? projectId) async {
    final safe = (projectId == null || projectId.isEmpty) ? 'unassigned' : projectId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final dir = Directory('${(await _baseDir()).path}/clips/$safe');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// Moves [sourcePath] into the clip store and returns the new path. A path already inside the store is returned
  /// unchanged. On web (no file system) the source is returned as is.
  Future<String> persist(String sourcePath, {String? projectId}) async {
    if (kIsWeb) return sourcePath;
    final src = File(sourcePath);
    final dir = await dirFor(projectId);
    if (src.parent.path == dir.path) return sourcePath;
    final dot = sourcePath.lastIndexOf('.');
    final ext = dot > sourcePath.lastIndexOf(Platform.pathSeparator) && dot > 0 ? sourcePath.substring(dot) : '.mp4';
    final name = 'take_${DateTime.now().millisecondsSinceEpoch}_${_rand.nextInt(1 << 32).toRadixString(36)}$ext';
    final target = '${dir.path}/$name';
    try {
      // Same volume: a rename is instant and needs no extra space.
      return (await src.rename(target)).path;
    } on FileSystemException {
      final copied = await src.copy(target);
      try {
        await src.delete();
      } catch (_) {
        // The cache copy is only extra space; the durable copy already exists.
      }
      return copied.path;
    }
  }

  /// Deletes [path] only when it is a take inside the clip store (never a gallery or user-picked file).
  Future<bool> deleteIfOwned(String? path) async {
    if (kIsWeb || path == null || path.isEmpty) return false;
    final root = '${(await _baseDir()).path}/clips/';
    String norm(String p) => p.replaceAll(r'\', '/');
    if (!norm(path).startsWith(norm(root))) return false;
    final f = File(path);
    if (!await f.exists()) return false;
    await f.delete();
    return true;
  }

  /// For takes saved before the clip store existed: if [path] still lives in the temporary (cache) directory and
  /// the file is there, moves it into the store and returns the new path. Otherwise returns null.
  Future<String?> rescueIfTemporary(String? path, {String? projectId}) async {
    if (kIsWeb || path == null || path.isEmpty) return null;
    final tmp = (await _tempDir()).path;
    if (!path.startsWith(tmp) || !await File(path).exists()) return null;
    return persist(path, projectId: projectId);
  }
}
