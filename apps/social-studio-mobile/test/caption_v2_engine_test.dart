import 'dart:ui';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/caption_v2.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';

/// The Dart mirror of CaptionV2EngineTest.kt: the same inputs must give the same outputs as the Android export.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final spec = <String, dynamic>{
    'version': 2,
    'typography': {
      'fonts': {'latin': 'Anton', 'arabic': 'Cairo'},
      'weight': 800,
      'sizePx': 80,
      'case': 'upper',
    },
    'paint': {
      'fill': {'type': 'gradient', 'top': '#FFFFFF', 'bottom': '#FFD400'},
      'strokes': [
        {'color': '#000000', 'widthPx': 6},
        {'color': '#FF000080', 'widthPx': 4},
      ],
      'shadow': {'xPx': 0, 'yPx': 4, 'blurPx': 8, 'color': '#00000099'},
      'glow': {'radiusPx': 14, 'color': '#00E5FF', 'strength': 0.6},
    },
    'words': {
      'active': {'color': '#FFE600', 'scale': 1.2},
    },
    'motion': {
      'groupEnter': {
        'type': 'spring-pop',
        'durationMs': 300,
        'easing': {'type': 'spring', 'stiffness': 400, 'damping': 14},
      },
    },
    'layout': {'position': 'upper-third', 'safeZone': 'reels', 'maxLines': 1},
  };

  test('parses the v2 spec with schema defaults; v1 maps are not v2', () {
    final s = CaptionSpecV2.parse(spec)!;
    expect(s.fontFor('latin'), 'Anton');
    expect(s.fontFor('devanagari'), 'Noto Sans Devanagari');
    expect(s.gradientBottom, 0xFFFFD400);
    expect(s.strokes[1].color, 0x80FF0000);
    expect(s.glow!.strength, 0.6);
    expect(s.shadow, isNotNull);
    expect((s.groupEnter.easing as V2Spring).stiffness, 400);
    expect(s.activeWord.easing, isA<V2Spring>());
    expect(s.maxLines, 1);
    expect(s.faceAvoid, isTrue);
    expect(CaptionSpecV2.parse({'version': 1}), isNull);
    final cap = EditIrCaption(id: 'a', startMs: 0, endMs: 1, text: 'x', style: {'styleV2': spec});
    expect(cap.styleV2, isNotNull);
    expect(EditIrCaption(id: 'b', startMs: 0, endMs: 1, text: 'x').styleV2, isNull);
  });

  test("the editor's flat textCase / caseLocale / motionIntensity keys win over the spec", () {
    final cap = EditIrCaption(id: 'a', startMs: 0, endMs: 1, text: 'x', style: {'styleV2': spec, 'textCase': 'title', 'motionIntensity': 0.3, 'caseLocale': 'tr'});
    expect(cap.styleV2!.textCase, 'title');
    expect(cap.styleV2!.intensity, 0.3);
    expect(cap.effectiveLanguage, 'tr');
  });

  test('easeAt: spring forced to 1 at durationMs, overshoots before; time-based', () {
    const sp = V2Spring(300, 10);
    expect(CaptionV2Math.easeAt(sp, 300, 300), 1);
    final peak = [for (var i = 1; i < 300; i++) CaptionV2Math.easeAt(sp, i.toDouble(), 300)].reduce((a, b) => a > b ? a : b);
    expect(peak, greaterThan(1.1));
    expect(CaptionV2Math.easeAt(const V2Cubic(), 50, 100), closeTo(1 - 0.125, 1e-12));
  });

  test('tokens: the same rules as CaptionText.tokens in Kotlin', () {
    expect(CaptionTextEngine.tokens('今日から物語を始めよう'), ['今日から', '物語を', '始めよう']);
    expect(CaptionTextEngine.tokens('こんにちは、世界'), ['こんにちは、', '世界']);
    expect(CaptionTextEngine.tokens('「東京」で新しい会社を'), ['「東京」', 'で', '新しい', '会社を']);
    expect(CaptionTextEngine.tokens('iPhone 16を買った'), ['iPhone', '16', 'を', '買った']);
    expect(CaptionTextEngine.tokens('आज से शुरू करो'), ['आज', 'से', 'शुरू', 'करो']);
    expect(CaptionTextEngine.tokens('one\ntwo'), ['one', '\n', 'two']);
    final thai = CaptionTextEngine.tokens('สวัสดีครับวันนี้');
    expect(thai.length, greaterThan(1));
    expect(CaptionTextEngine.join(thai), 'สวัสดีครับวันนี้');
  });

  test('displayWords of a CJK title uses the shared tokeniser (same word timing as export)', () {
    final c = EditIrCaption(id: 'j', kind: 'text', startMs: 0, endMs: 1000, text: '今日から物語を始めよう');
    expect(c.displayWords.map((w) => w.text), ['今日から', '物語を', '始めよう']);
  });

  test('width split never cuts a grapheme cluster', () {
    const word = 'क्षत्रियक्षत्रियक्षत्रिय';
    final ends = CaptionTextEngine.graphemeEnds(word).toSet();
    final pieces = CaptionTextEngine.splitToWidth(word, 3, (s) => s.length.toDouble());
    expect(pieces.join(), word);
    var off = 0;
    for (final p in pieces.take(pieces.length - 1)) {
      off += p.length;
      expect(ends.contains(off), isTrue, reason: 'cut at $off');
    }
    const family = '👨‍👩‍👧';
    expect(CaptionTextEngine.splitToWidth(family, 1, (s) => s.length.toDouble()), [family]);
  });

  test('bidi visual order (engine ICU) matches the Kotlin expectations', () {
    expect(CaptionTextEngine.visualOrder(['ابدأ', 'قصتك', 'اليوم'], true), [2, 1, 0]);
    expect(CaptionTextEngine.visualOrder(['ابدأ', '3', 'خطوات'], true), [2, 1, 0]);
    expect(CaptionTextEngine.visualOrder(['میں', 'iPhone', '16', 'خریدا'], true), [3, 1, 2, 0]);
    expect(CaptionTextEngine.visualOrder(['I', 'said', 'مرحبا', 'بكم'], false), [0, 1, 3, 2]);
    expect(CaptionScripts.isRtlParagraph('iPhone خریدا', 'ur'), isTrue);
    expect(CaptionScripts.isRtlParagraph('iPhone خریدا', null), isFalse);
  });

  test('case is locale-aware and only for cased scripts', () {
    expect(CaptionScripts.applyCase("istanbul'da iyi", 'upper', 'tr'), "İSTANBUL'DA İYİ");
    expect(CaptionScripts.applyCase("istanbul'da iyi", 'upper', 'en'), "ISTANBUL'DA IYI");
    expect(CaptionScripts.applyCase('kapı', 'upper', 'tr-TR'), 'KAPI');
    expect(CaptionScripts.applyCase('straße', 'upper', 'de'), 'STRASSE');
    expect(CaptionScripts.applyCase('नमस्ते', 'upper', 'hi'), 'नमस्ते');
    expect(CaptionScripts.applyCase('iyi günler', 'title', 'tr'), 'İyi Günler');
  });

  test('line breaking: ≤ 2 lines, bottom-heavy, no single word on top', () {
    List<CaptionItem> items(List<double> w) => [for (var i = 0; i < w.length; i++) CaptionItem(i, 'w$i', w[i], w[i], i)];
    double gap(CaptionItem a, CaptionItem b) => 10;
    expect(CaptionTextEngine.breakLines(items([100, 100]), 300, 2, gap, true)!.length, 1);
    final two = CaptionTextEngine.breakLines(items([60, 90, 80, 200]), 300, 2, gap, true)!;
    expect(two.length, 2);
    double lw(List<CaptionItem> l) => l.fold<double>(0, (n, i) => n + i.slot) + 10.0 * (l.length - 1);
    expect(lw(two[0]), lessThanOrEqualTo(lw(two[1])));
    expect(two[0].length, greaterThanOrEqualTo(2));
    expect(CaptionTextEngine.breakLines(items([290, 290, 290]), 300, 2, gap, true), isNull);
  });

  test('anchor + face avoidance', () {
    final s = CaptionSpecV2.parse({...spec, 'layout': {'position': 'custom', 'y': 0.98, 'safeZone': 'tiktok'}})!;
    expect(CaptionV2Math.anchor(s, 1080, 1920, 600, 200).dy, 1920 - 480 - 100);
    final safe = CaptionV2Math.safeRect('tiktok', 1080, 1920);
    const face = Rect.fromLTRB(340, 1100, 740, 1500);
    final cy = CaptionV2Math.avoidFaces(1300, 160, 200, 880, [face], safe, 1920);
    expect(Rect.fromLTRB(200, cy - 80, 880, cy + 80).overlaps(face), isFalse);
  });

  test('group motion: enter from 0, settled at 1, exit slides up', () {
    final s = CaptionSpecV2.parse({
      ...spec,
      'motion': {
        'groupEnter': {'type': 'fade', 'durationMs': 200},
        'groupExit': {'type': 'slide-up', 'durationMs': 200},
      },
    })!;
    expect(captionGroupMotion(s, 0, 2000, 0, 1920).opacity, 0);
    expect(captionGroupMotion(s, 0, 2000, 1000, 1920).opacity, 1);
    final out = captionGroupMotion(s, 0, 2000, 1950, 1920);
    expect(out.dy, lessThan(0));
  });
}
