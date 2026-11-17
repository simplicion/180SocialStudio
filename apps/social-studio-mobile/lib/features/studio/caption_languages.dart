import 'caption_languages_data.dart';

export 'caption_languages_data.dart' show CaptionLanguage, captionLanguageList;

/// Languages for captions: what is spoken in the video, and what captions can be converted to.
/// The data is generated from packages/video-contracts/src/caption-languages.ts (the list the server's
/// `CAPTION_TARGET_LANGUAGES` is derived from), so the phone and the server accept the same codes.
class CaptionLanguages {
  CaptionLanguages._();

  /// The speech provider detects the spoken language.
  static const auto = 'auto';

  /// Code the server returns when it could not name the detected language.
  static const undetermined = 'und';

  /// Every caption language, in menu order.
  static const all = captionLanguageList;

  /// Languages captions can be converted to (BCP-47 code → English name).
  static final targets = <String, String>{for (final l in all) l.code: l.name};

  /// Choices for the spoken language: auto-detect first, then every language.
  static final spoken = <String, String>{auto: 'Auto-detect', ...targets};

  /// A language by code or alias, case-insensitive ('ZH-HANS', 'zh', 'tl'); null when unknown.
  static CaptionLanguage? byCode(String? code) {
    final c = code?.trim().toLowerCase() ?? '';
    if (c.isEmpty) return null;
    for (final l in all) {
      if (l.code.toLowerCase() == c || l.aliases.contains(c)) return l;
    }
    return null;
  }

  /// Display name for a language code; unknown codes are shown as they are.
  static String nameOf(String code) => code == auto ? spoken[auto]! : byCode(code)?.name ?? code.toUpperCase();

  /// True when [code] names a real language (not auto / undetermined / empty).
  static bool isKnown(String? code) => code != null && code.isNotEmpty && code != auto && code != undetermined;

  /// What the speech-to-text request carries for a spoken-language choice: the provider's code, or [auto] when
  /// the provider does not list the language (Odia) or the code is unknown.
  static String transcriptionCodeOf(String code) {
    if (code == auto) return auto;
    return byCode(code)?.transcriptionCode ?? auto;
  }

  /// Applies a caption case mode ('none' | 'upper' | 'title') like `applyCaptionCase` in caption-style-v2.ts:
  /// only for languages with case, with the language's casing rules (Turkish / Azerbaijani i → İ, ı → I).
  static String applyCase(String text, String mode, String? code) {
    final lang = byCode(code);
    if (mode == 'none' || (lang != null && !lang.hasCase)) return text;
    final locale = lang?.casingLocale ?? '';
    if (mode == 'upper') return _upper(text, locale);
    if (mode != 'title') return text;
    return text.replaceAllMapped(
      RegExp(r'(^|\s)(\p{L})', unicode: true),
      (m) => '${m[1]}${_upper(m[2]!, locale)}',
    );
  }

  static String _upper(String s, String locale) {
    if (locale == 'tr' || locale == 'az') s = s.replaceAll('i', 'İ').replaceAll('ı', 'I');
    return s.toUpperCase();
  }

  /// Whether a caption's text fits the language's reading limits: at most [maxLines] lines of maxCharsPerLine
  /// (characters for CJK, letters and spaces otherwise) and maxCharsPerSecond over [durationMs].
  static bool fits(String text, String? code, {required int durationMs, int maxLines = 2}) {
    final lang = byCode(code);
    final perLine = lang?.maxCharsPerLine ?? 42;
    final cps = lang?.maxCharsPerSecond ?? 17;
    final n = text.runes.length;
    return n <= perLine * maxLines && n <= cps * durationMs / 1000 + 0.0001;
  }
}
