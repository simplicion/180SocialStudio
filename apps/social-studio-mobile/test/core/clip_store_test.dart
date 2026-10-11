import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/storage/clip_store.dart';

void main() {
  late Directory root;
  late Directory docs;
  late Directory cache;
  late ClipStore store;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('clip_store_test');
    docs = await Directory('${root.path}/docs').create();
    cache = await Directory('${root.path}/cache').create();
    store = ClipStore(baseDir: () async => docs, tempDir: () async => cache);
  });
  tearDown(() => root.delete(recursive: true));

  test('a take is moved out of the cache into clips/<project>', () async {
    final take = await File('${cache.path}/REC123.mp4').writeAsString('video');
    final path = await store.persist(take.path, projectId: 'p/1');
    expect(path, startsWith('${docs.path}/clips/p_1/'));
    expect(path, endsWith('.mp4'));
    expect(await File(path).readAsString(), 'video');
    expect(await take.exists(), isFalse);
  });

  test('persisting a stored take is a no-op', () async {
    final take = await File('${cache.path}/a.mov').writeAsString('x');
    final first = await store.persist(take.path, projectId: 'p');
    expect(await store.persist(first, projectId: 'p'), first);
  });

  test('rescue moves only existing files that are still in the cache', () async {
    final cached = await File('${cache.path}/old.mp4').writeAsString('x');
    final rescued = await store.rescueIfTemporary(cached.path, projectId: 'p');
    expect(rescued, startsWith('${docs.path}/clips/p/'));
    expect(await store.rescueIfTemporary(rescued, projectId: 'p'), isNull);
    expect(await store.rescueIfTemporary('${cache.path}/missing.mp4'), isNull);
    expect(await store.rescueIfTemporary(null), isNull);
  });
}
