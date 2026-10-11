import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/text_motion.dart';

/// Text in / out / loop motion (P2.7). The same numbers are produced by TextMotion.kt in the Android renderer.
void main() {
  Map<String, dynamic> style({Map? enter, Map? exit, Map? loop}) => {
        'animation': 'none',
        'enter': ?enter,
        'exit': ?exit,
        'loop': ?loop,
      };

  test('no motion fields: no motion', () {
    expect(identical(textMotionAt(style(), 0, 2000, 500), TextMotion.none), isTrue);
  });

  test('fade in then fade out', () {
    final s = style(enter: {'type': 'fade', 'durationMs': 400}, exit: {'type': 'fade', 'durationMs': 400});
    expect(textMotionAt(s, 1000, 3000, 1000).opacity, 0);
    expect(textMotionAt(s, 1000, 3000, 1200).opacity, closeTo(0.875, 1e-9)); // easeOutCubic(0.5)
    expect(textMotionAt(s, 1000, 3000, 2000).opacity, 1);
    expect(textMotionAt(s, 1000, 3000, 3000).opacity, 0);
  });

  test('slides start offset and end in place; exit slides away', () {
    final s = style(enter: {'type': 'slide_up', 'durationMs': 400}, exit: {'type': 'slide_left', 'durationMs': 400});
    expect(textMotionAt(s, 0, 2000, 0).dy, closeTo(0.08, 1e-9));
    expect(textMotionAt(s, 0, 2000, 1000).dy, 0);
    expect(textMotionAt(s, 0, 2000, 2000).dx, closeTo(-0.15, 1e-9));
  });

  test('typewriter reveals characters over its duration', () {
    final s = style(enter: {'type': 'typewriter', 'durationMs': 1000});
    expect(textMotionAt(s, 0, 4000, 250).reveal, closeTo(0.25, 1e-9));
    expect(textMotionAt(s, 0, 4000, 2000).reveal, 1);
  });

  test('loops repeat with their period', () {
    final s = style(loop: {'type': 'pulse', 'periodMs': 1000});
    expect(textMotionAt(s, 0, 5000, 250).scale, closeTo(1.06, 1e-9));
    expect(textMotionAt(s, 0, 5000, 1250).scale, closeTo(1.06, 1e-9));
    expect(textMotionAt(style(loop: {'type': 'wiggle', 'periodMs': 1000}), 0, 5000, 250).rotationDeg, closeTo(4, 1e-9));
  });

  test('a short caption shares its time between enter and exit', () {
    final s = style(enter: {'type': 'fade', 'durationMs': 800}, exit: {'type': 'fade', 'durationMs': 800});
    // 600 ms caption: enter gets 300 ms, exit the other 300 ms.
    expect(textMotionAt(s, 0, 600, 300).opacity, 1);
  });

  test('unknown or malformed motion is ignored', () {
    expect(identical(textMotionAt(style(enter: {'type': 'spin', 'durationMs': 400}), 0, 1000, 0), TextMotion.none), isTrue);
    expect(identical(textMotionAt(style(loop: {'type': 'pulse'}), 0, 1000, 0), TextMotion.none), isTrue);
  });

  test('legacy animation values become motion fields the renderer understands', () {
    expect(normaliseCaptionStyle({'animation': 'fade_in'}), {'animation': 'none', 'enter': {'type': 'fade', 'durationMs': 400}});
    expect(normaliseCaptionStyle({'animation': 'pulse'}), {'animation': 'none', 'loop': {'type': 'pulse', 'periodMs': 1200}});
    expect(normaliseCaptionStyle({'animation': 'typewriter'})['enter'], {'type': 'typewriter', 'durationMs': 1200});
    expect(normaliseCaptionStyle({'animation': 'word_pop'}), {'animation': 'word_pop'});
    final cap = EditIrCaption.fromJson({'id': 'c', 'kind': 'text', 'startMs': 0, 'endMs': 1000, 'text': 'Hi', 'words': [], 'style': {'animation': 'slide_up'}});
    expect(cap.style['animation'], 'none');
    expect(cap.toJson()['style']['enter'], {'type': 'slide_up', 'durationMs': 400});
  });
}
