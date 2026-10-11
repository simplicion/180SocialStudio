import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/studio/caption_fonts.dart';

void main() {
  tearDown(() => CaptionFonts.fetchOverride = null);

  test('downloads the TTF named in the Google Fonts CSS, caches it, and returns null when no TTF is offered', () async {
    final dir = Directory.systemTemp.createTempSync('fonts');
    final calls = <Uri>[];
    CaptionFonts.fetchOverride = (uri) async {
      calls.add(uri);
      if (uri.host == 'fonts.googleapis.com') {
        return "@font-face { font-family: 'Anton'; src: url(https://fonts.gstatic.com/s/anton/v1/Anton.ttf) format('truetype'); }".codeUnits;
      }
      return List.filled(4096, 7);
    };
    final path = await CaptionFonts.downloadTtf(dir, 'Anton', 400);
    expect(path, endsWith('Anton_400.ttf'));
    expect(File(path!).lengthSync(), 4096);
    expect(calls.first.queryParameters['family'], 'Anton:wght@400');

    calls.clear();
    expect(await CaptionFonts.downloadTtf(dir, 'Anton', 400), path, reason: 'cached');
    expect(calls, isEmpty);

    CaptionFonts.fetchOverride = (uri) async => 'src: url(https://fonts.gstatic.com/x.woff2)'.codeUnits;
    expect(await CaptionFonts.downloadTtf(dir, 'Syne', 800), isNull);
    dir.deleteSync(recursive: true);
  });
}
