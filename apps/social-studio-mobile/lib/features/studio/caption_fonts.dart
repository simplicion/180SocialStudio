import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/native_engine/caption_v2.dart';
import '../../core/native_engine/edit_ir.dart';

/// Caption fonts: the same Google Fonts family drives the in-app preview and the Android export.
///
/// The preview loads fonts through `google_fonts`, which caches every downloaded file in the app
/// support directory as `<Family>_<variant>_<hash>.ttf`. Export reuses exactly those files, so the
/// rendered video uses the font the user saw. Inter ships inside the APK and never needs a download.
class CaptionFonts {
  CaptionFonts._();

  /// Families the caption presets use and that export fetches before rendering.
  static const exportFamilies = {
    'Anton',
    'Montserrat',
    'Poppins',
    'Syne',
    'Outfit',
    'Inter',
    'Roboto',
    'Bebas Neue',
    'Baloo 2',
    'Playfair Display',
    'Space Grotesk',
  };

  /// Licence of every family a caption may be drawn with. Only fonts whose licence allows embedding in a commercial
  /// app (SIL OFL 1.1 or Apache 2.0, all served by Google Fonts) are fetched; any other family falls back to Inter with
  /// a warning. Every "Noto Sans …" / "Noto Serif …" family is OFL. Tested in test/caption_fonts_licence_test.dart.
  static const licences = <String, String>{
    'Inter': 'OFL-1.1',
    'Anton': 'OFL-1.1',
    'Bebas Neue': 'OFL-1.1',
    'Montserrat': 'OFL-1.1',
    'Poppins': 'OFL-1.1',
    'Syne': 'OFL-1.1',
    'Outfit': 'OFL-1.1',
    'Roboto': 'OFL-1.1',
    'Baloo 2': 'OFL-1.1',
    'Playfair Display': 'OFL-1.1',
    'Space Grotesk': 'OFL-1.1',
    'Mukta': 'OFL-1.1',
    'Hind': 'OFL-1.1',
    'Tiro Devanagari Hindi': 'OFL-1.1',
    'Cairo': 'OFL-1.1',
    'Tajawal': 'OFL-1.1',
    'Kanit': 'OFL-1.1',
    'Prompt': 'OFL-1.1',
    'Oswald': 'OFL-1.1',
    'DM Sans': 'OFL-1.1',
    'DM Serif Display': 'OFL-1.1',
    'Archivo Black': 'OFL-1.1',
    'Bangers': 'OFL-1.1',
    'Fredoka': 'OFL-1.1',
    'Lilita One': 'OFL-1.1',
    'Luckiest Guy': 'Apache-2.0',
    'Rubik': 'OFL-1.1',
    'Manrope': 'OFL-1.1',
    'Sora': 'OFL-1.1',
    'Lora': 'OFL-1.1',
    'EB Garamond': 'OFL-1.1',
    'Cormorant Garamond': 'OFL-1.1',
    'Libre Baskerville': 'OFL-1.1',
    'Barlow': 'OFL-1.1',
    'Barlow Condensed': 'OFL-1.1',
    'League Spartan': 'OFL-1.1',
    'Plus Jakarta Sans': 'OFL-1.1',
    'Open Sans': 'OFL-1.1',
    'Lato': 'OFL-1.1',
  };

  /// The licence of [family], or null when it is not an allowed caption font.
  static String? licenceOf(String family) =>
      licences[family] ?? (family.startsWith('Noto Sans') || family.startsWith('Noto Serif') || family.startsWith('Noto Kufi') ? 'OFL-1.1' : null);

  /// The family the Android v1 path draws a caption with (VideoEffects.kt fontForText): the style's family, or the
  /// script font for non-Latin text.
  static String v1FamilyFor(String text, String family) {
    for (final c in text.runes) {
      final s = CaptionScripts.ofCodePoint(c);
      switch (s) {
        case null || 'cyrillic':
          continue;
        case 'devanagari':
          return family == 'Poppins' || family == 'Baloo 2' ? family : 'Noto Sans Devanagari';
        case 'arabic':
          return family == 'Cairo' || family == 'Tajawal' ? family : 'Noto Sans Arabic';
        case 'thai':
          return family == 'Kanit' || family == 'Prompt' ? family : 'Noto Sans Thai';
        case 'cjk-sc':
          return family == 'Noto Sans JP' ? family : 'Noto Sans SC';
        default:
          return kDefaultScriptFonts[s]!;
      }
    }
    return family;
  }

  /// Every (family, weight) the renderers draw [ir]'s captions with: v2 captions use the template's font for each
  /// word's script (font stack, else DEFAULT_SCRIPT_FONTS), v1 captions their family or its script fallback.
  static Set<(String, int)> familiesFor(MobileEditIr ir) {
    final out = <(String, int)>{};
    for (final c in ir.captions) {
      final spec = c.styleV2;
      if (spec == null) {
        out.add((v1FamilyFor(c.text, (c.style['fontFamily'] as String?) ?? 'Inter'), weightOf(c.style['fontWeight']).value));
        continue;
      }
      for (final w in c.displayWords) {
        if (w.text == EditIrCaption.lineBreak) continue;
        final text = CaptionScripts.applyCase(w.text, spec.textCase, c.effectiveLanguage);
        out.add((spec.fontFor(CaptionScripts.forToken(text, c.text, c.effectiveLanguage)), spec.weight));
      }
    }
    return out;
  }

  static FontWeight weightOf(Object? w) {
    final v = ((w as num?)?.toInt() ?? 800).clamp(100, 900);
    return FontWeight.values[(v / 100).round() - 1];
  }

  /// Preview text style for a caption style map (family, weight, glow). Unknown families use Inter.
  static TextStyle textStyle(
    Map<String, dynamic> st, {
    required double fontSize,
    Color? color,
    List<Shadow>? shadows,
  }) {
    final family = st['fontFamily'] as String? ?? 'Inter';
    final weight = weightOf(st['fontWeight']);
    try {
      return GoogleFonts.getFont(
        family,
        fontSize: fontSize,
        fontWeight: weight,
        color: color,
        shadows: shadows,
      );
    } catch (_) {
      return GoogleFonts.inter(
        fontSize: fontSize,
        fontWeight: weight,
        color: color,
        shadows: shadows,
      );
    }
  }

  /// Local font files for every non-Inter caption family used by [ir], keyed `family:weight` and
  /// `family` (the renderer's lookup keys). A family that cannot be fetched is left out and reported
  /// in the returned warnings; the renderer then draws it with the bundled Inter.
  static Future<(Map<String, String>, List<String>)> resolveForExport(
    MobileEditIr ir, {
    Duration timeout = const Duration(seconds: 20),
  }) async {
    // Every script present gets its own font (a Hindi or Arabic caption is not drawn with the Latin family).
    final paths = <String, String>{};
    final warnings = <String>[];
    final wanted = <(String, int)>[];
    for (final f in familiesFor(ir)) {
      if (f.$1.toLowerCase() == 'inter') continue;
      if (licenceOf(f.$1) == null) {
        warnings.add('The "${f.$1}" caption font is not on the allowed (OFL / Apache) list, so captions use Inter instead.');
        continue;
      }
      wanted.add(f);
    }
    if (wanted.isEmpty || kIsWeb) return (paths, warnings);
    Directory? dir;
    try {
      dir = await getApplicationSupportDirectory();
    } catch (_) {}
    for (final (family, weight) in wanted) {
      String? path;
      try {
        final style = GoogleFonts.getFont(family, fontWeight: weightOf(weight));
        await GoogleFonts.pendingFonts([style]).timeout(timeout);
        if (dir != null) path = await _cachedFile(dir, family, weight);
      } catch (_) {
        path = null;
      }
      // Independent of google_fonts' private cache naming: fetch the TTF ourselves.
      if (path == null && dir != null) {
        try {
          path = await downloadTtf(dir, family, weight).timeout(timeout);
        } catch (_) {
          path = null;
        }
      }
      if (path == null) {
        warnings.add(
          'The "$family" caption font could not be downloaded, so captions use Inter instead.',
        );
        continue;
      }
      paths['$family:$weight'] = path;
      paths.putIfAbsent(family, () => path!);
    }
    return (paths, warnings);
  }

  /// google_fonts writes the file without awaiting it, so poll briefly for it to appear.
  /// Test hook: returns the body for a GET (CSS or font bytes). Null = real network.
  @visibleForTesting
  static Future<List<int>> Function(Uri uri)? fetchOverride;

  static Future<List<int>> _get(Uri uri) async {
    final f = fetchOverride;
    if (f != null) return f(uri);
    final client = HttpClient()..connectionTimeout = Duration(seconds: 10);
    try {
      final req = await client.getUrl(uri);
      // A plain user agent makes the Google Fonts CSS API answer with TTF urls (renderers need TTF, not WOFF2).
      req.headers.set(HttpHeaders.userAgentHeader, 'Mozilla/5.0');
      final res = await req.close();
      if (res.statusCode != 200)
        throw HttpException('HTTP ${res.statusCode}', uri: uri);
      final bytes = <int>[];
      await for (final chunk in res) {
        bytes.addAll(chunk);
        // CJK fonts are 5-10 MB per weight.
        if (bytes.length > 24 * 1024 * 1024)
          throw HttpException('font too large');
      }
      return bytes;
    } finally {
      client.close(force: true);
    }
  }

  /// Downloads [family] at [weight] from the public Google Fonts CSS API into `<dir>/caption_fonts/`, cached.
  @visibleForTesting
  static Future<String?> downloadTtf(
    Directory dir,
    String family,
    int weight,
  ) async {
    final out = File(
      '${dir.path}/caption_fonts/${family.replaceAll(' ', '')}_$weight.ttf',
    );
    if (out.existsSync() && out.lengthSync() > 0) return out.path;
    final css = String.fromCharCodes(
      await _get(
        Uri.https('fonts.googleapis.com', '/css2', {
          'family': '$family:wght@$weight',
        }),
      ),
    );
    final m = RegExp(r"src:\s*url\((https://[^)]+\.ttf)\)").firstMatch(css);
    if (m == null) return null;
    final bytes = await _get(Uri.parse(m.group(1)!));
    if (bytes.length < 1000) return null;
    out.parent.createSync(recursive: true);
    await out.writeAsBytes(bytes, flush: true);
    return out.path;
  }

  static Future<String?> _cachedFile(
    Directory dir,
    String family,
    int weight,
  ) async {
    final prefix = '${family.replaceAll(' ', '')}_';
    for (var attempt = 0; attempt < 15; attempt++) {
      final best = _closest(dir, prefix, weight);
      if (best != null) return best;
      await Future<void>.delayed(Duration(milliseconds: 200));
    }
    return null;
  }

  /// The cached non-italic variant closest to [weight] (google_fonts also picks the closest one).
  static String? _closest(Directory dir, String prefix, int weight) {
    if (!dir.existsSync()) return null;
    String? best;
    var bestD = 1 << 30;
    for (final f in dir.listSync().whereType<File>()) {
      final name = f.uri.pathSegments.last;
      if (!name.startsWith(prefix) ||
          !name.endsWith('.ttf') ||
          f.lengthSync() == 0)
        continue;
      final variant = name.substring(prefix.length).split('_').first;
      final w = variant == 'regular' ? 400 : int.tryParse(variant);
      if (w == null) continue; // italic variants
      final d = (w - weight).abs();
      if (d < bestD) {
        bestD = d;
        best = f.path;
      }
    }
    return best;
  }
}
