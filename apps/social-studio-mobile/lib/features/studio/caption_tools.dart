import '../../core/native_engine/edit_ir.dart';

/// Pure caption helpers: subtitle files, key-word picks, and fonts for non-Latin scripts. Captions never
/// get emoji. The key-word and font rules match `packages/video-contracts/src/caption-enhance.ts`
/// (what the AI Director applies), so manual and AI captions look the same.
class CaptionTools {
  CaptionTools._();

  // ── Subtitle files ─────────────────────────────────────────────────────────

  static String _stamp(int ms, String sep) {
    String two(int v) => v.toString().padLeft(2, '0');
    final h = ms ~/ 3600000, m = (ms ~/ 60000) % 60, s = (ms ~/ 1000) % 60;
    return '${two(h)}:${two(m)}:${two(s)}$sep${(ms % 1000).toString().padLeft(3, '0')}';
  }

  static List<EditIrCaption> _speech(MobileEditIr ir) =>
      [for (final c in ir.captions) if (c.kind == 'caption' && c.text.trim().isNotEmpty) c]
        ..sort((a, b) => a.startMs.compareTo(b.startMs));

  /// The speech captions as a SubRip (.srt) file, on the edited timeline.
  static String toSrt(MobileEditIr ir) {
    final b = StringBuffer();
    var n = 1;
    for (final c in _speech(ir)) {
      b
        ..writeln(n++)
        ..writeln('${_stamp(c.startMs, ',')} --> ${_stamp(c.endMs, ',')}')
        ..writeln(c.text.trim())
        ..writeln();
    }
    return b.toString();
  }

  /// The speech captions as a WebVTT (.vtt) file, on the edited timeline.
  static String toVtt(MobileEditIr ir) {
    final b = StringBuffer('WEBVTT\n\n');
    for (final c in _speech(ir)) {
      b
        ..writeln('${_stamp(c.startMs, '.')} --> ${_stamp(c.endMs, '.')}')
        ..writeln(c.text.trim())
        ..writeln();
    }
    return b.toString();
  }

  // ── Key words ──────────────────────────────────────────────────────────────

  static const _stop = {
    'because', 'should', 'would', 'could', 'really', 'actually', 'basically', 'literally', 'something', 'anything',
    'everything', 'nothing', 'people', 'things', 'through', 'before', 'between', 'without', 'around', 'another',
    'always', 'little', 'having', 'going', 'doing', 'being', 'there', 'their', 'these', 'those', 'which', 'where',
    'about', 'after', 'again', 'other', 'every',
  };

  static String _bare(String w) => w.toLowerCase().replaceAll(RegExp(r'[^\p{L}\p{M}\p{N}%$₹€£]', unicode: true), '');

  /// Index of the word worth emphasising in one caption, or null: a number / amount first, else the
  /// longest content word (6+ letters). At most one per caption.
  static int? keywordIndex(List<String> words) {
    for (var i = 0; i < words.length; i++) {
      if (RegExp(r'[0-9%$₹€£]').hasMatch(words[i])) return i;
    }
    int? best;
    var bestLen = 5;
    for (var i = 0; i < words.length; i++) {
      final w = _bare(words[i]);
      final len = w.runes.length;
      if (len > bestLen && !_stop.contains(w)) {
        best = i;
        bestLen = len;
      }
    }
    return best;
  }

  // ── Fonts for non-Latin scripts ────────────────────────────────────────────

  static const _scripts = <(int, int, String, Set<String>)>[
    (0x0900, 0x097F, 'Noto Sans Devanagari', {'Poppins', 'Baloo 2'}),
    (0x0980, 0x09FF, 'Noto Sans Bengali', {}),
    (0x0A00, 0x0A7F, 'Noto Sans Gurmukhi', {}),
    (0x0A80, 0x0AFF, 'Noto Sans Gujarati', {}),
    (0x0B00, 0x0B7F, 'Noto Sans Oriya', {}),
    (0x0B80, 0x0BFF, 'Noto Sans Tamil', {}),
    (0x0C00, 0x0C7F, 'Noto Sans Telugu', {}),
    (0x0C80, 0x0CFF, 'Noto Sans Kannada', {}),
    (0x0D00, 0x0D7F, 'Noto Sans Malayalam', {}),
    (0x0600, 0x06FF, 'Noto Sans Arabic', {}),
  ];

  /// The font family to draw [text] with: [family] when it covers the text's script, else the Noto Sans
  /// family for that script (so Hindi, Tamil, … keep the caption's weight instead of a thin system font).
  static String fontFor(String text, String family) {
    for (final r in text.runes) {
      for (final (lo, hi, noto, covered) in _scripts) {
        if (r >= lo && r <= hi) return covered.contains(family) ? family : noto;
      }
    }
    return family;
  }
}
