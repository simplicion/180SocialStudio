/// Languages for captions: what is spoken in the video, and what captions can be converted to.
class CaptionLanguages {
  CaptionLanguages._();

  /// The speech provider detects the spoken language.
  static const auto = 'auto';

  /// Code the server returns when it could not name the detected language.
  static const undetermined = 'und';

  /// Languages captions can be converted to (same codes as the server's `CAPTION_TARGET_LANGUAGES`).
  static const targets = <String, String>{
    'en': 'English',
    'hi': 'Hindi',
    'ur': 'Urdu',
    'bn': 'Bengali',
    'ta': 'Tamil',
    'te': 'Telugu',
    'mr': 'Marathi',
    'gu': 'Gujarati',
    'kn': 'Kannada',
    'ml': 'Malayalam',
    'pa': 'Punjabi',
    'or': 'Odia',
    'as': 'Assamese',
    'ne': 'Nepali',
    'sd': 'Sindhi',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'pt': 'Portuguese',
    'it': 'Italian',
    'ar': 'Arabic',
    'fa': 'Persian',
    'id': 'Indonesian',
    'ms': 'Malay',
    'tr': 'Turkish',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'vi': 'Vietnamese',
    'th': 'Thai',
  };

  /// Choices for the spoken language: auto-detect first, then every language.
  static const spoken = <String, String>{auto: 'Auto-detect', ...targets};

  /// Display name for a language code; unknown codes are shown as they are.
  static String nameOf(String code) => spoken[code] ?? code.toUpperCase();

  /// True when [code] names a real language (not auto / undetermined / empty).
  static bool isKnown(String? code) => code != null && code.isNotEmpty && code != auto && code != undetermined;
}
