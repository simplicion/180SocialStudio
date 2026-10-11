import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/media/asset_cache.dart';

/// A fake MP4 body: "ftyp" box header + payload (not an image, not HTML).
Uint8List mp4(int size) {
  final b = Uint8List(size);
  b.setAll(4, 'ftypisom'.codeUnits);
  for (var i = 12; i < size; i++) {
    b[i] = i % 251;
  }
  return b;
}

const crlf = '\r\n';

void main() {
  late HttpServer server;
  late Directory dir;
  var hits = <String, int>{};
  final video = mp4(200 * 1024);

  setUp(() async {
    hits = {};
    dir = await Directory.systemTemp.createTemp('asset_cache_test');
    AssetCache.instance.initAt(dir);
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      hits[req.uri.path] = (hits[req.uri.path] ?? 0) + 1;
      final res = req.response;
      switch (req.uri.path) {
        case '/clip.mp4':
          res.headers.contentType = ContentType('video', 'mp4');
          res.add(video);
        case '/expired.mp4':
          res.headers.contentType = ContentType.html;
          res.write('<!doctype html><html><body>Link expired</body></html>${' ' * 2000}');
        default:
          res.statusCode = 404;
      }
      await res.close();
    });
  });

  tearDown(() async {
    await server.close(force: true);
    await dir.delete(recursive: true);
  });

  String url(String p) => 'http://127.0.0.1:${server.port}$p';

  test('downloads once, then serves the cached file (same path, no second request)', () async {
    final a = await AssetCache.instance.ensure(url('/clip.mp4'), kind: AssetKind.video);
    expect(File(a).lengthSync(), video.length);
    expect(a.endsWith('.mp4'), isTrue);
    final b = await AssetCache.instance.ensure(url('/clip.mp4'), kind: AssetKind.video);
    expect(b, a);
    expect(hits['/clip.mp4'], 1);
    expect(AssetCache.instance.cachedPath(url('/clip.mp4')), a);
  });

  test('parallel requests for one URL share a single download', () async {
    final paths = await Future.wait(List.generate(5, (_) => AssetCache.instance.ensure(url('/clip.mp4'))));
    expect(paths.toSet().length, 1);
    expect(hits['/clip.mp4'], 1);
  });

  test('a dropped connection resumes from where it stopped (Range) and completes intact', () async {
    // Raw socket server: the first response is cut off half way; the retry must ask for the rest with Range.
    final raw = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final ranges = <String?>[];
    raw.listen((sock) {
      final buf = <int>[];
      var answered = false;
      sock.listen((data) {
        buf.addAll(data);
        final req = String.fromCharCodes(buf);
        if (answered || !req.contains('$crlf$crlf')) return;
        answered = true;
        final m = RegExp(r'range: bytes=(\d+)-', caseSensitive: false).firstMatch(req);
        ranges.add(m?.group(1));
        if (m == null) {
          sock.add('HTTP/1.1 200 OK${crlf}Content-Type: video/mp4${crlf}Content-Length: ${video.length}$crlf$crlf'.codeUnits);
          sock.add(video.sublist(0, video.length ~/ 2));
          sock.flush().then((_) => sock.destroy());
        } else {
          final from = int.parse(m.group(1)!);
          sock.add(('HTTP/1.1 206 Partial Content${crlf}Content-Type: video/mp4$crlf'
                  'Content-Range: bytes $from-${video.length - 1}/${video.length}$crlf'
                  'Content-Length: ${video.length - from}${crlf}Connection: close$crlf$crlf')
              .codeUnits);
          sock.add(video.sublist(from));
          sock.flush().then((_) => sock.close());
        }
      });
    });
    final p = await AssetCache.instance.ensure('http://127.0.0.1:${raw.port}/clip.mp4', kind: AssetKind.video);
    await raw.close();
    expect(File(p).readAsBytesSync(), video);
    expect(ranges.first, isNull);
    expect(ranges.length, greaterThanOrEqualTo(2));
    expect(int.parse(ranges.last!), greaterThan(0), reason: 'the retry resumed instead of starting over');
  });

  test('an HTML error page is rejected with a clear reason and nothing is cached', () async {
    await expectLater(
      AssetCache.instance.ensure(url('/expired.mp4'), kind: AssetKind.video),
      throwsA(isA<AssetDownloadException>().having((e) => e.code, 'code', 'NOT_MEDIA')),
    );
    expect(AssetCache.instance.isCached(url('/expired.mp4')), isFalse);
    expect(dir.listSync().where((f) => f.path.endsWith('.part')), isEmpty);
  });

  test('ccMixter files get the Referer its hotlink protection requires; other hosts do not', () {
    expect(AssetCache.hostHeaders('https://ccmixter.org/content/a/a_-_Song.mp3'), {'referer': 'https://ccmixter.org/'});
    expect(AssetCache.hostHeaders('https://videos.pexels.com/video-files/1/1.mp4'), isEmpty);
  });

  test('a removed file is a typed NOT_FOUND error', () async {
    await expectLater(
      AssetCache.instance.ensure(url('/gone.mp4')),
      throwsA(isA<AssetDownloadException>().having((e) => e.code, 'code', 'NOT_FOUND')),
    );
  });
}
