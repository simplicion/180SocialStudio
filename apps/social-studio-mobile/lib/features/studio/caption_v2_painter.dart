import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/native_engine/caption_v2.dart';
import '../../core/native_engine/edit_ir.dart';
import 'text_motion.dart';

/// The text style for a font family at a weight (no size). The app resolves families through google_fonts (the same
/// files the export receives); tests and the parity check register font files under their family names instead.
typedef CaptionFontResolver = TextStyle Function(String family, int weight);

TextStyle googleCaptionFont(String family, int weight) {
  final w = FontWeight.values[((weight.clamp(100, 900)) / 100).round() - 1];
  try {
    return GoogleFonts.getFont(family, fontWeight: w);
  } catch (_) {
    return GoogleFonts.inter(fontWeight: w);
  }
}

/// Plain family names (fonts registered with FontLoader under their family name).
TextStyle registeredCaptionFont(String family, int weight) =>
    TextStyle(fontFamily: family, fontWeight: FontWeight.values[((weight.clamp(100, 900)) / 100).round() - 1]);

class _Placed {
  _Placed(this.word, this.wordIndex, this.text, this.style, this.width, this.slot, this.line, this.rtl);
  final EditIrWord word;
  final int wordIndex;
  final String text;
  final TextStyle style;
  final double width, slot;
  final int line;
  final bool rtl;
  double x = 0;
}

class _Layout {
  _Layout(this.size, this.sf, this.items, this.lineWidths, this.lineLefts, this.baselines, this.ascent, this.descent, this.cx, this.cy, this.blockW,
      this.blockH, this.pad, this.rtl, this.allStatic, this.graphemes, this.letterSpacingEm);
  final double size, sf;
  final List<_Placed> items;
  final List<double> lineWidths, lineLefts, baselines;
  // ascent is negative (Android convention), descent positive.
  final double ascent, descent, cx, cy, blockW, blockH, pad;
  final bool rtl, allStatic;
  final int graphemes;
  final double letterSpacingEm;
  int get lineCount => lineWidths.length;
}

class _Look {
  _Look(this.color, this.scale, this.opacity, this.dy, this.blur, this.box, this.sweep, this.sweepColor, this.underline, this.shown);
  final int? color;
  final double scale, opacity, dy, blur, sweep, underline;
  final V2WordBox? box;
  final int sweepColor;
  final String shown;
}

/// Draws a v2 caption exactly like CaptionV2Renderer.kt (the Android export): same layout (font per script, measured
/// widths scaled with the font size, ≤ maxLines bottom-heavy lines with 8 % shrink steps, bidi visual order, preset
/// anchor in the safe zone, face avoidance), same motion (group enter / exit, per-word enter, word states, active-word
/// motion, all in milliseconds) and the same paint passes (backgrounds, glow, shadow, strokes outermost first, fill).
class CaptionV2Renderer {
  CaptionV2Renderer({required this.fontFor, required this.canvasWidth, this.faces = const []});

  final CaptionFontResolver fontFor;
  final int canvasWidth;
  final List<FaceSample> faces;
  final Map<String, _Layout> _cache = {};

  /// Top-left / size of the caption block (frame px) for hit-testing in the editor.
  Rect blockRect(EditIrCaption cap, CaptionSpecV2 spec, Size size) {
    final l = _layoutFor(cap, spec, size);
    return Rect.fromCenter(center: Offset(l.cx, l.cy), width: l.blockW, height: l.blockH);
  }

  void draw(Canvas canvas, Size size, EditIrCaption cap, CaptionSpecV2 spec, double t) {
    if (size.width <= 0 || size.height <= 0) return;
    final l = _layoutFor(cap, spec, size);
    if (l.items.isEmpty) return;
    _drawFrame(canvas, cap, spec, l, t, size.width, size.height);
  }

  _Layout _layoutFor(EditIrCaption cap, CaptionSpecV2 spec, Size size) {
    final key = '${identityHashCode(cap)}@${size.width}x${size.height}';
    final hit = _cache[key];
    if (hit != null) return hit;
    if (_cache.length > 64) _cache.clear();
    return _cache[key] = _layout(cap, spec, cap.displayWords, size.width, size.height);
  }

  TextStyle _style(TextStyle base, double size, double letterSpacingEm) =>
      base.copyWith(fontSize: size, letterSpacing: letterSpacingEm * size, height: null);

  TextPainter _tp(String text, TextStyle style) => TextPainter(text: TextSpan(text: text, style: style), textDirection: TextDirection.ltr)..layout();

  double _measure(String text, TextStyle style) {
    final tp = _tp(text, style);
    final w = tp.width;
    tp.dispose();
    return w;
  }

  _Layout _layout(EditIrCaption cap, CaptionSpecV2 spec, List<EditIrWord> words, double w, double h) {
    final sf = canvasWidth > 0 ? w / canvasWidth : 1.0;
    final lang = cap.effectiveLanguage;
    final rtl = CaptionScripts.isRtlParagraph(cap.text.trim().isEmpty ? words.map((e) => e.text).join(' ') : cap.text, lang);
    final size0 = spec.sizePx * sf;
    final primaryScript = CaptionScripts.forToken(cap.text.trim().isEmpty ? words.map((e) => e.text).join() : cap.text, cap.text, lang);
    final primary = _style(fontFor(spec.fontFor(primaryScript), spec.weight), size0, spec.letterSpacingEm);

    final measured = <({EditIrWord word, int wi, String text, TextStyle style, double width, double scale})>[];
    var hardBreaks = 0;
    for (var wi = 0; wi < words.length; wi++) {
      final wd = words[wi];
      if (wd.text == EditIrCaption.lineBreak) {
        hardBreaks++;
        if (hardBreaks < spec.maxLines) measured.add((word: wd, wi: wi, text: EditIrCaption.lineBreak, style: primary, width: 0, scale: 1));
        continue;
      }
      final text = CaptionScripts.applyCase(wd.text, spec.textCase, lang);
      final st = _style(fontFor(spec.fontFor(CaptionScripts.forToken(text, cap.text, lang)), spec.weight), size0, spec.letterSpacingEm);
      final maxScale = [1.0, spec.active.scale, spec.spoken.scale, spec.resting.scale, if (wd.highlight) spec.emphasis.scale].reduce(math.max);
      measured.add((word: wd, wi: wi, text: text, style: st, width: _measure(text, st), scale: maxScale));
    }
    final space0 = _measure(' ', primary);
    final mtp = _tp('x', primary);
    final lm = mtp.computeLineMetrics().first;
    mtp.dispose();
    final asc0 = -lm.ascent, desc0 = lm.descent;

    final pad = (spec.background.mode == 'pill' || spec.background.mode == 'line') ? spec.background.paddingPx * sf : 0.0;
    final safe = CaptionV2Math.safeRect(spec.safeZone, w, h);
    final maxWidth = math.max(math.min(spec.maxWidthFraction * w, safe.width) - 2 * pad, size0 * 0.5);

    var factor = 1.0;
    List<List<CaptionItem>>? lines;
    var pieces = <CaptionItem>[];
    while (true) {
      final items = <CaptionItem>[];
      for (var mi = 0; mi < measured.length; mi++) {
        final m = measured[mi];
        if (m.text == EditIrCaption.lineBreak) {
          items.add(CaptionItem(mi, m.text, 0, 0, m.wi));
          continue;
        }
        final ws = m.width * factor;
        if (ws * m.scale <= maxWidth) {
          items.add(CaptionItem(mi, m.text, ws, ws * m.scale, m.wi));
        } else {
          final st = m.style.copyWith(fontSize: size0 * factor, letterSpacing: spec.letterSpacingEm * size0 * factor);
          for (final p in CaptionTextEngine.splitToWidth(m.text, maxWidth / m.scale, (s) => _measure(s, st))) {
            final pw = _measure(p, st);
            items.add(CaptionItem(mi, p, pw, pw * m.scale, m.wi));
          }
        }
      }
      final gap = space0 * factor;
      lines = CaptionTextEngine.breakLines(items, maxWidth, spec.maxLines, (a, b) => CaptionTextEngine.noGap(a.text, b.text) ? 0 : gap, spec.balance == 'bottom-heavy');
      pieces = items;
      if (lines != null || factor < 0.3) break;
      factor *= 0.92;
    }
    final finalLines = lines ?? [pieces.where((i) => i.text != EditIrCaption.lineBreak).toList()];
    final size = size0 * factor;
    final gap = space0 * factor;
    final ascent = asc0 * factor, descent = desc0 * factor;
    final adv = size * spec.lineHeight;

    final placed = <_Placed>[];
    final lineWidths = <double>[];
    for (var li = 0; li < finalLines.length; li++) {
      final line = finalLines[li];
      var lw = 0.0;
      for (var i = 0; i < line.length; i++) {
        if (i > 0 && !CaptionTextEngine.noGap(line[i - 1].text, line[i].text)) lw += gap;
        lw += line[i].slot;
      }
      lineWidths.add(lw);
      for (final it in line) {
        final m = measured[it.index];
        placed.add(_Placed(m.word, m.wi, it.text, m.style.copyWith(fontSize: size, letterSpacing: spec.letterSpacingEm * size), it.width, it.slot, li, rtl));
      }
    }
    final maxLineW = lineWidths.isEmpty ? 0.0 : lineWidths.reduce(math.max);
    final blockW = maxLineW + 2 * pad;
    final blockH = adv * finalLines.length + 2 * pad;
    final a = CaptionV2Math.anchor(spec, w, h, blockW, blockH);
    final cx = a.dx;
    var cy = a.dy;
    if (spec.faceAvoid && faces.isNotEmpty) {
      final seen = [
        for (final f in faces)
          if (f.tMs >= cap.startMs - 500 && f.tMs <= cap.endMs + 500) Rect.fromLTRB((f.x - f.w / 2) * w, (f.y - f.h / 2) * h, (f.x + f.w / 2) * w, (f.y + f.h / 2) * h),
      ];
      cy = CaptionV2Math.avoidFaces(cy, blockH, cx - blockW / 2, cx + blockW / 2, seen, safe, h);
    }
    final top = cy - blockH / 2 + pad;
    final blockLeft = cx - maxLineW / 2;
    final lineLefts = [
      for (final lw in lineWidths)
        switch (spec.align) {
          'start' => rtl ? blockLeft + maxLineW - lw : blockLeft,
          'end' => rtl ? blockLeft : blockLeft + maxLineW - lw,
          _ => cx - lw / 2,
        },
    ];
    final baselines = [for (var li = 0; li < finalLines.length; li++) top + li * adv + (adv - (descent - ascent)) / 2 - ascent];
    for (var li = 0; li < finalLines.length; li++) {
      final onLine = placed.where((p) => p.line == li).toList();
      final order = CaptionTextEngine.visualOrder(onLine.map((p) => p.text).toList(), rtl);
      var x = lineLefts[li];
      for (var k = 0; k < order.length; k++) {
        final p = onLine[order[k]];
        if (k > 0 && !CaptionTextEngine.noGap(onLine[order[k - 1]].text, p.text)) x += gap;
        p.x = x;
        x += p.slot;
      }
    }
    final allStatic = words.every((wd) => wd.startMs <= cap.startMs && wd.endMs >= cap.endMs);
    final graphemes = placed.fold<int>(0, (n, p) => n + CaptionTextEngine.graphemeEnds(p.text).length);
    return _Layout(size, sf, placed, lineWidths, lineLefts, baselines, ascent, descent, cx, cy, blockW, blockH, pad, rtl, allStatic, graphemes, spec.letterSpacingEm);
  }

  /// Skia's BlurMaskFilter radius → sigma (what Android's BlurMaskFilter(radius) uses).
  static ui.MaskFilter? _blur(double radius) => radius < 0.5 ? null : ui.MaskFilter.blur(ui.BlurStyle.normal, 0.57735 * radius + 0.5);

  void _drawFrame(Canvas canvas, EditIrCaption cap, CaptionSpecV2 spec, _Layout l, double t, double w, double h) {
    final g = captionGroupMotion(spec, cap.startMs, cap.endMs, t, h);
    if (g.opacity <= 0.001) return;
    final tr = textTransformAt(cap.style, cap.startMs, cap.endMs, t.round());
    canvas.save();
    canvas.translate(0, g.dy);
    final blockScale = g.scale * tr.scale;
    if (tr.rotationDeg != 0) {
      canvas.translate(l.cx, l.cy);
      canvas.rotate(tr.rotationDeg * math.pi / 180);
      canvas.translate(-l.cx, -l.cy);
    }
    if (blockScale != 1) {
      canvas.translate(l.cx, l.cy);
      canvas.scale(blockScale, blockScale);
      canvas.translate(-l.cx, -l.cy);
    }
    if (g.wipe < 1) {
      final left = l.cx - l.blockW / 2;
      final ww = l.blockW * g.wipe;
      canvas.clipRect(l.rtl ? Rect.fromLTRB(left + l.blockW - ww, -1e5, left + l.blockW, 1e5) : Rect.fromLTRB(left, -1e5, left + ww, 1e5));
    }
    final alpha = g.opacity;

    var budget = g.reveal >= 0 && l.allStatic ? (l.graphemes * g.reveal).ceil() : 1 << 30;
    final looks = <_Look>[];
    for (var i = 0; i < l.items.length; i++) {
      final p = l.items[i];
      var shown = p.text;
      if (g.reveal >= 0) {
        final ends = CaptionTextEngine.graphemeEnds(p.text);
        int take;
        if (l.allStatic) {
          take = math.min(budget, ends.length);
          budget -= take;
        } else {
          final span = math.max(1, p.word.endMs - p.word.startMs).toDouble();
          take = (ends.length * ((t - p.word.startMs) / span).clamp(0.0, 1.0)).ceil();
        }
        shown = take <= 0 ? '' : p.text.substring(0, ends[take - 1]);
      }
      looks.add(_look(spec, cap, l, p, t, shown));
    }

    final bgSpec = spec.background;
    if (bgSpec.mode != 'none') {
      final paint = Paint()
        ..color = Color(withAlpha(bgSpec.color, bgSpec.opacity * alpha))
        ..maskFilter = _blur(g.blurPx * l.sf);
      final r = bgSpec.radiusPx * l.sf;
      final bpad = bgSpec.paddingPx * l.sf;
      final adv = l.size * spec.lineHeight;
      switch (bgSpec.mode) {
        case 'pill':
          canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromCenter(center: Offset(l.cx, l.cy), width: l.blockW, height: l.blockH), Radius.circular(r)), paint);
        case 'line':
          for (var li = 0; li < l.lineCount; li++) {
            final top = l.cy - l.blockH / 2 + l.pad + li * adv;
            canvas.drawRRect(RRect.fromLTRBR(l.lineLefts[li] - bpad, top - bpad, l.lineLefts[li] + l.lineWidths[li] + bpad, top + adv + bpad, Radius.circular(r)), paint);
          }
        case 'word':
          for (var i = 0; i < l.items.length; i++) {
            if (looks[i].shown.isEmpty || looks[i].opacity <= 0) continue;
            canvas.drawRRect(RRect.fromRectAndRadius(_wordBox(l.items[i], l, bpad), Radius.circular(r)), paint);
          }
      }
    }
    _drawWordBoxes(canvas, spec, l, looks, t, alpha);

    final glow = spec.glow;
    if (glow != null && glow.radiusPx > 0 && glow.strength > 0) {
      _textPass(canvas, l, looks, alpha * glow.strength, g.blurPx, (p, lk) => (Paint()..color = Color(glow.color), glow.radiusPx * l.sf));
    }
    final sh = spec.shadow;
    if (sh != null) {
      canvas.save();
      canvas.translate(sh.xPx * l.sf, sh.yPx * l.sf);
      _textPass(canvas, l, looks, alpha, g.blurPx, (p, lk) => (Paint()..color = Color(sh.color), sh.blurPx * l.sf));
      canvas.restore();
    }
    var acc = 0.0;
    final cumulative = [for (final s in spec.strokes) acc += s.widthPx];
    for (var si = spec.strokes.length - 1; si >= 0; si--) {
      final s = spec.strokes[si];
      _textPass(
        canvas,
        l,
        looks,
        alpha,
        g.blurPx,
        (p, lk) => (
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeJoin = StrokeJoin.round
            ..strokeCap = StrokeCap.round
            ..strokeWidth = 2 * cumulative[si] * l.sf
            ..color = Color(s.color),
          0.0
        ),
      );
    }
    _textPass(canvas, l, looks, alpha, g.blurPx, (p, lk) {
      final solid = lk.color;
      if (solid == null && spec.gradientTop != null && spec.gradientBottom != null) {
        final base = l.baselines[p.line];
        final a = alpha * lk.opacity;
        return (
          Paint()
            ..color = const Color(0xFFFFFFFF)
            ..shader = ui.Gradient.linear(Offset(0, base + l.ascent), Offset(0, base + l.descent), [Color(withAlpha(spec.gradientTop!, a)), Color(withAlpha(spec.gradientBottom!, a))]),
          0.0
        );
      }
      return (Paint()..color = Color(solid ?? spec.fillColor), 0.0);
    }, fill: true);
    canvas.restore();
  }

  Rect _wordBox(_Placed p, _Layout l, double pad) {
    final base = l.baselines[p.line];
    return Rect.fromLTRB(p.x + (p.slot - p.width) / 2 - pad, base + l.ascent - pad * 0.5, p.x + (p.slot + p.width) / 2 + pad, base + l.descent + pad * 0.5);
  }

  void _drawWordBoxes(Canvas canvas, CaptionSpecV2 spec, _Layout l, List<_Look> looks, double t, double alpha) {
    final slide = spec.activeWord.type == 'box-slide';
    for (var i = 0; i < l.items.length; i++) {
      final p = l.items[i];
      final lk = looks[i];
      final box = lk.box;
      if (box == null || lk.shown.isEmpty || lk.opacity <= 0) continue;
      final isActive = t >= p.word.startMs && t < p.word.endMs;
      var r = _wordBox(p, l, box.paddingPx * l.sf);
      if (slide && isActive) {
        _Placed? prev;
        for (var j = i - 1; j >= 0; j--) {
          final q = l.items[j];
          if (q.line == p.line && q.wordIndex != p.wordIndex) {
            prev = q;
            break;
          }
        }
        final k = CaptionV2Math.easeAt(spec.activeWord.easing, t - p.word.startMs, spec.activeWord.durationMs.toDouble());
        if (prev != null && k < 1) {
          final a = _wordBox(prev, l, box.paddingPx * l.sf);
          r = Rect.fromLTRB(a.left + (r.left - a.left) * k, a.top + (r.top - a.top) * k, a.right + (r.right - a.right) * k, a.bottom + (r.bottom - a.bottom) * k);
        }
      }
      canvas.save();
      if (!slide || !isActive) {
        final wcx = p.x + p.slot / 2, wcy = l.baselines[p.line] + (l.ascent + l.descent) / 2;
        canvas.translate(wcx, wcy);
        canvas.scale(lk.scale, lk.scale);
        canvas.translate(-wcx, -wcy);
      }
      canvas.translate(0, lk.dy);
      canvas.drawRRect(RRect.fromRectAndRadius(r, Radius.circular(box.radiusPx * l.sf)), Paint()..color = Color(withAlpha(box.color, alpha * lk.opacity)));
      canvas.restore();
    }
  }

  void _textPass(Canvas canvas, _Layout l, List<_Look> looks, double alpha, double groupBlurPx, (Paint, double) Function(_Placed, _Look) setup, {bool fill = false}) {
    for (var i = 0; i < l.items.length; i++) {
      final p = l.items[i];
      final lk = looks[i];
      if (lk.shown.isEmpty || lk.opacity <= 0) continue;
      final (paint, layerBlur) = setup(p, lk);
      paint.maskFilter = _blur(layerBlur + lk.blur + groupBlurPx * l.sf);
      if (paint.shader == null) paint.color = paint.color.withValues(alpha: (paint.color.a * alpha * lk.opacity).clamp(0.0, 1.0));
      final base = l.baselines[p.line];
      final wcx = p.x + p.slot / 2, wcy = base + (l.ascent + l.descent) / 2;
      canvas.save();
      canvas.translate(0, lk.dy);
      if (lk.scale != 1) {
        canvas.translate(wcx, wcy);
        canvas.scale(lk.scale, lk.scale);
        canvas.translate(-wcx, -wcy);
      }
      final shownW = lk.shown.length < p.text.length ? _measure(lk.shown, p.style) : p.width;
      final textX = p.x + (p.slot - p.width) / 2 + (p.rtl && lk.shown.length < p.text.length ? p.width - shownW : 0);
      _drawText(canvas, lk.shown, p.style, paint, textX, base);
      if (fill && lk.sweep > 0) {
        final sw = p.width * lk.sweep;
        canvas.save();
        canvas.clipRect(p.rtl
            ? Rect.fromLTRB(textX + p.width - sw, base + l.ascent * 1.5, textX + p.width, base + l.descent * 1.5)
            : Rect.fromLTRB(textX, base + l.ascent * 1.5, textX + sw, base + l.descent * 1.5));
        _drawText(canvas, lk.shown, p.style, Paint()..color = Color(withAlpha(lk.sweepColor, alpha * lk.opacity)), textX, base);
        canvas.restore();
      }
      if (fill && lk.underline > 0) {
        final uw = p.width * lk.underline;
        final y = base + l.descent * 0.55;
        final left = p.rtl ? textX + p.width - uw : textX;
        canvas.drawRect(Rect.fromLTWH(left, y, uw, l.size * 0.07), Paint()..color = Color(withAlpha(lk.sweepColor, alpha * lk.opacity)));
      }
      canvas.restore();
    }
  }

  /// Draws [text] with its alphabetic baseline at [baseline] and its left edge at [x].
  void _drawText(Canvas canvas, String text, TextStyle style, Paint paint, double x, double baseline) {
    final tp = TextPainter(text: TextSpan(text: text, style: style.copyWith(foreground: paint, color: null)), textDirection: TextDirection.ltr)..layout();
    tp.paint(canvas, Offset(x, baseline - tp.computeDistanceToActualBaseline(TextBaseline.alphabetic)));
    tp.dispose();
  }

  _Look _look(CaptionSpecV2 spec, EditIrCaption cap, _Layout l, _Placed p, double t, String shown) {
    final wd = p.word;
    final active = t >= wd.startMs && t < wd.endMs;
    final spoken = t >= wd.endMs;
    final base = active ? spec.active : (spoken ? spec.spoken : spec.resting);
    final e = spec.emphasis;
    final emColor = wd.color != null ? v2Color(wd.color!) : null;
    final st = wd.highlight
        ? V2WordState(
            color: emColor ?? e.color ?? spec.emphasisColor,
            scale: active ? math.max(e.scale, spec.active.scale) : e.scale,
            opacity: e.opacity,
            yOffsetPx: e.yOffsetPx,
            background: e.background,
            blurPx: e.blurPx,
          )
        : base;
    final intensity = spec.intensity;
    var scale = st.scale;
    int? color = st.color;
    var dy = st.yOffsetPx * l.sf;
    var opacity = st.opacity;
    var blur = st.blurPx * l.sf;
    var sweep = -1.0;
    var underline = 0.0;
    final accent = spec.active.color ?? emColor ?? spec.emphasisColor;
    final restScale = wd.highlight ? spec.emphasis.scale : spec.resting.scale;
    final elapsed = t - wd.startMs;
    switch (spec.activeWord.type) {
      case 'scale-spring':
        if (active) {
          final k = CaptionV2Math.easeAt(spec.activeWord.easing, elapsed, spec.activeWord.durationMs.toDouble());
          scale = restScale + (st.scale - restScale) * k * intensity;
        }
      case 'color-sweep':
        if (active) {
          sweep = (elapsed / math.max(1, wd.endMs - wd.startMs)).clamp(0.0, 1.0);
          color = wd.highlight ? st.color : spec.resting.color;
        }
      case 'underline-grow':
        if (active) underline = CaptionV2Math.easeAt(spec.activeWord.easing, elapsed, spec.activeWord.durationMs.toDouble()).clamp(0.0, 1.2);
      case 'bounce':
        if (active) {
          final k = (elapsed / math.max(1, spec.activeWord.durationMs)).clamp(0.0, 1.0);
          dy -= math.sin(math.pi * k) * 0.15 * l.size * intensity;
        }
    }
    final we = spec.wordEnter;
    if (we.type != 'none') {
      final startAt = we.staggerMs > 0 ? cap.startMs + p.wordIndex * we.staggerMs.toDouble() : wd.startMs.toDouble();
      final k = CaptionV2Math.easeAt(we.easing, t - startAt, we.durationMs.toDouble());
      final lin = ((t - startAt) / math.max(1, we.durationMs)).clamp(0.0, 1.0);
      switch (we.type) {
        case 'fade':
          opacity *= k.clamp(0.0, 1.0);
        case 'pop':
          scale *= 1 - 0.4 * intensity + 0.4 * intensity * k;
          opacity *= math.min(1.0, lin * 2);
        case 'rise':
          dy += (1 - k) * 0.4 * l.size * intensity;
          opacity *= k.clamp(0.0, 1.0);
        case 'blur-in':
          blur += (1 - k.clamp(0.0, 1.0)) * 8 * l.sf * intensity;
          opacity *= k.clamp(0.0, 1.0);
      }
    }
    return _Look(color, scale, opacity.clamp(0.0, 1.0), dy, blur, st.background, sweep, accent, underline, shown);
  }
}

/// A CustomPainter for one v2 caption over the whole preview canvas.
class CaptionV2Painter extends CustomPainter {
  CaptionV2Painter({required this.renderer, required this.caption, required this.spec, required this.tMs});
  final CaptionV2Renderer renderer;
  final EditIrCaption caption;
  final CaptionSpecV2 spec;
  final double tMs;

  @override
  void paint(Canvas canvas, Size size) => renderer.draw(canvas, size, caption, spec, tMs);

  @override
  bool shouldRepaint(CaptionV2Painter old) => old.tMs != tMs || !identical(old.caption, caption) || old.renderer != renderer;
}
