import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/features/studio/caption_languages.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// Captions v2 Phase 8 on the phone: the generated language list, casing, and caption grouping per language.
void main() {
  /// Five words per language (native script), the last one ending a sentence where the language marks it.
  const samples = <String, List<String>>{
    'en': ['this', 'is', 'how', 'it', 'works.'],
    'hi': ['यह', 'ऐसे', 'काम', 'करता', 'है।'],
    'hi-Latn': ['yeh', 'aise', 'kaam', 'karta', 'hai.'],
    'bn': ['এটা', 'এভাবে', 'কাজ', 'করে', 'থাকে।'],
    'ta': ['இது', 'இப்படி', 'தான்', 'வேலை', 'செய்யும்.'],
    'te': ['ఇది', 'ఇలా', 'పని', 'చేస్తుంది', 'చూడండి.'],
    'mr': ['हे', 'असे', 'काम', 'करते', 'आहे।'],
    'gu': ['આ', 'આ', 'રીતે', 'કામ', 'કરે.'],
    'kn': ['ಇದು', 'ಹೀಗೆ', 'ಕೆಲಸ', 'ಮಾಡುತ್ತದೆ', 'ನೋಡಿ.'],
    'ml': ['ഇത്', 'ഇങ്ങനെ', 'ആണ്', 'പ്രവർത്തിക്കുന്നത്', 'നോക്കൂ.'],
    'pa': ['ਇਹ', 'ਇਸ', 'ਤਰ੍ਹਾਂ', 'ਕੰਮ', 'ਕਰਦਾ।'],
    'or': ['ଏହା', 'ଏମିତି', 'କାମ', 'କରେ', 'ଦେଖ।'],
    'as': ['এইটো', 'এনেকৈ', 'কাম', 'কৰে', 'চাওক।'],
    'ur': ['یہ', 'ایسے', 'کام', 'کرتا', 'ہے۔'],
    'ne': ['यो', 'यसरी', 'काम', 'गर्छ', 'हेर्नुहोस्।'],
    'sd': ['هي', 'هن', 'طرح', 'ڪم', 'ڪري۔'],
    'ar': ['هذا', 'هو', 'كيف', 'يعمل', 'الأمر؟'],
    'fa': ['این', 'طور', 'کار', 'می‌کند', 'ببین؟'],
    'es': ['así', 'es', 'como', 'funciona', 'esto.'],
    'pt': ['é', 'assim', 'que', 'isso', 'funciona.'],
    'fr': ['voici', 'comment', 'ça', 'marche', 'vraiment.'],
    'de': ['so', 'funktioniert', 'das', 'ganz', 'einfach.'],
    'it': ['ecco', 'come', 'funziona', 'tutto', 'questo.'],
    'id': ['beginilah', 'cara', 'kerjanya', 'yang', 'benar.'],
    'ms': ['beginilah', 'cara', 'ia', 'berfungsi', 'sebenarnya.'],
    'tr': ['işte', 'bu', 'böyle', 'çalışıyor', 'istanbul.'],
    'ru': ['вот', 'как', 'это', 'работает', 'просто.'],
    'uk': ['ось', 'як', 'це', 'працює', 'просто.'],
    'vi': ['đây', 'là', 'cách', 'nó', 'hoạt.'],
    'th': ['นี่', 'คือ', 'วิธี', 'การ', 'ทำงาน'],
    'ja': ['これ', 'が', '仕組み', 'です', '。'],
    'ko': ['이렇게', '작동', '하는', '거예요', '보세요.'],
    'zh-Hans': ['这', '就是', '它', '的', '原理。'],
    'zh-Hant': ['這', '就是', '它', '的', '原理。'],
    'fil': ['ganito', 'ang', 'paraan', 'ng', 'paggana.'],
    'sw': ['hivi', 'ndivyo', 'inavyofanya', 'kazi', 'sasa.'],
  };

  test('the generated list has every spec language with valid flags', () {
    final codes = CaptionLanguages.all.map((l) => l.code).toSet();
    expect(codes, samples.keys.toSet());
    expect(CaptionLanguages.all.where((l) => l.rtl).map((l) => l.code).toSet(), {'ur', 'sd', 'ar', 'fa'});
    expect(CaptionLanguages.all.where((l) => l.noSpaces).map((l) => l.code).toSet(), {'th', 'ja', 'zh-Hans', 'zh-Hant'});
    for (final l in CaptionLanguages.all) {
      expect(l.hasCase, l.casingLocale != null, reason: l.code);
      expect(l.fontStack, isNotEmpty, reason: l.code);
      if (l.noSpaces && l.code != 'th') expect(l.maxCharsPerLine, 16, reason: l.code);
    }
  });

  test('lookups: aliases, case-insensitive codes, names, transcription codes', () {
    expect(CaptionLanguages.byCode('zh')!.code, 'zh-Hans');
    expect(CaptionLanguages.byCode('TL')!.code, 'fil');
    expect(CaptionLanguages.nameOf('hi-Latn'), 'Hinglish (Roman)');
    expect(CaptionLanguages.nameOf('xx'), 'XX');
    expect(CaptionLanguages.transcriptionCodeOf('hi-Latn'), 'hi');
    expect(CaptionLanguages.transcriptionCodeOf('fil'), 'tl');
    expect(CaptionLanguages.transcriptionCodeOf('zh-Hant'), 'zh');
    // Whisper does not list Odia: detection is used instead of a code it would reject.
    expect(CaptionLanguages.transcriptionCodeOf('or'), CaptionLanguages.auto);
    expect(CaptionLanguages.transcriptionCodeOf(CaptionLanguages.auto), CaptionLanguages.auto);
    expect(CaptionLanguages.spoken.keys.first, CaptionLanguages.auto);
  });

  test('locale-aware casing: Turkish dotted i, title case, scripts without case untouched', () {
    expect(CaptionLanguages.applyCase('istanbul ılık', 'upper', 'tr'), 'İSTANBUL ILIK');
    expect(CaptionLanguages.applyCase('istanbul', 'upper', 'en'), 'ISTANBUL');
    expect(CaptionLanguages.applyCase('привіт світ', 'title', 'uk'), 'Привіт Світ');
    expect(CaptionLanguages.applyCase('işte istanbul', 'title', 'tr'), 'İşte İstanbul');
    expect(CaptionLanguages.applyCase('Hello', 'none', 'en'), 'Hello');
    for (final l in CaptionLanguages.all.where((l) => !l.hasCase)) {
      final s = samples[l.code]!.first;
      expect(CaptionLanguages.applyCase(s, 'upper', l.code), s, reason: l.code);
    }
  });

  group('caption grouping per language (TimelineOps.autoCaptions)', () {
    MobileEditIr base() => TimelineOps.initial(projectId: 'p', durationMs: 20000, width: 1080, height: 1920);
    List<TranscriptWord> words(List<String> w) => [
      for (final (i, t) in w.indexed) TranscriptWord(text: t, startMs: 1000 + i * 400, endMs: 1000 + i * 400 + 350),
    ];

    for (final e in samples.entries) {
      test(e.key, () {
        final lang = CaptionLanguages.byCode(e.key)!;
        final ir = TimelineOps.autoCaptions(base(), words(e.value), wordsPerCaption: 3);
        final caps = ir.captions.where((c) => c.kind == 'caption').toList();
        // Three words, then the rest: no words lost, no timing changed.
        expect(caps.map((c) => c.words.length).toList(), [3, 2]);
        expect([for (final c in caps) ...c.words.map((w) => w.text)], e.value);
        expect(caps.first.startMs, 1000);
        // Joined like the language is written: no spaces for CJK / Thai, spaces otherwise.
        final first = e.value.take(3).toList();
        expect(caps.first.text, lang.noSpaces ? first.join() : first.join(' '));
        // Each group fits the language's reading limits (2 lines of chars/line, chars per second).
        for (final c in caps) {
          expect(c.text.runes.length, lessThanOrEqualTo(lang.maxCharsPerLine * 2), reason: c.text);
        }
      });
    }
  });

  test('fits() uses the language reading speed (CJK 9 cps vs Latin 17 cps)', () {
    expect(CaptionLanguages.fits('这就是它的原理这就是它的原', 'zh-Hans', durationMs: 1000), isFalse);
    expect(CaptionLanguages.fits('this is fine', 'en', durationMs: 1000), isTrue);
    expect(CaptionLanguages.fits('यह ऐसे काम करता है', 'hi', durationMs: 1000), isTrue);
  });
}
