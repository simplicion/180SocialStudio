import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/text_motion.dart';

void main() {
  group('Phase 3: TextMotion v2 & Closed-form Spring Parity', () {
    test('easeSpring start, settle, and overshoot regimes', () {
      // t=0 gives 0.0
      expect(easeSpring(0.0, stiffness: 300, damping: 18), closeTo(0.0, 1e-4));

      // Under-damped spring (stiffness=300, damping=18) overshoots 1.0
      var maxUnderdamped = 0.0;
      for (var i = 1; i <= 50; i++) {
        final t = i * 0.01;
        final v = easeSpring(t, stiffness: 300, damping: 18);
        if (v > maxUnderdamped) maxUnderdamped = v;
      }
      expect(maxUnderdamped, greaterThan(1.05));

      // Critically damped spring (stiffness=100, damping=20 -> zeta=1.0) never crosses 1.0
      var maxCrit = 0.0;
      for (var i = 1; i <= 100; i++) {
        final t = i * 0.01;
        final v = easeSpring(t, stiffness: 100, damping: 20);
        if (v > maxCrit) maxCrit = v;
        expect(v, lessThanOrEqualTo(1.0001));
      }
      expect(maxCrit, greaterThan(0.98));

      // Over-damped spring (stiffness=100, damping=30 -> zeta=1.5) never crosses 1.0
      for (var i = 1; i <= 100; i++) {
        final t = i * 0.01;
        final v = easeSpring(t, stiffness: 100, damping: 30);
        expect(v, lessThanOrEqualTo(1.0001));
      }
    });

    test('spring-pop enter motion animates scale with overshoot', () {
      final style = {
        'enter': {'type': 'spring-pop', 'durationMs': 200},
      };
      // At t=0 ms: scale is 0.4
      expect(textMotionAt(style, 0, 2000, 0).scale, closeTo(0.4, 1e-2));

      // Mid-way: scale exceeds 1.0 due to spring overshoot
      var peakScale = 0.0;
      for (var ms = 0; ms <= 200; ms += 10) {
        final scale = textMotionAt(style, 0, 2000, ms).scale;
        if (scale > peakScale) peakScale = scale;
      }
      expect(peakScale, greaterThan(1.0));
    });

    test('scale-down-in enter motion starts enlarged and settles towards 1.0', () {
      final style = {
        'enter': {'type': 'scale-down-in', 'durationMs': 200},
      };
      // At t=0 ms: scale starts enlarged (1.4)
      expect(textMotionAt(style, 0, 2000, 0).scale, closeTo(1.4, 1e-2));
    });

    test('blur-in enter motion fades opacity and slides', () {
      final style = {
        'enter': {'type': 'blur-in', 'durationMs': 200},
      };
      // At t=0 ms: opacity 0
      expect(textMotionAt(style, 0, 2000, 0).opacity, closeTo(0.0, 1e-2));
      // At end of enter: opacity 1
      expect(textMotionAt(style, 0, 2000, 200).opacity, closeTo(1.0, 1e-2));
    });

    test('mask-wipe enter motion increases reveal with cubic ease out', () {
      final style = {
        'enter': {'type': 'mask-wipe', 'durationMs': 200},
      };
      expect(textMotionAt(style, 0, 2000, 0).reveal, closeTo(0.0, 1e-2));
      expect(textMotionAt(style, 0, 2000, 100).reveal, closeTo(0.875, 1e-2));
      expect(textMotionAt(style, 0, 2000, 200).reveal, closeTo(1.0, 1e-2));
    });
  });

  group('Phase 3: EditIrCaption with v2 Layered Paint & Layout Fields', () {
    test('parses and round-trips v2 fields in EditIrCaption', () {
      final json = {
        'id': 'cap-1',
        'kind': 'caption',
        'startMs': 0,
        'endMs': 2000,
        'text': 'Layered paints test',
        'words': [
          {'text': 'Layered', 'startMs': 0, 'endMs': 600, 'highlight': false},
          {'text': 'paints', 'startMs': 600, 'endMs': 1200, 'highlight': true},
          {'text': 'test', 'startMs': 1200, 'endMs': 2000, 'highlight': false},
        ],
        'style': {
          'preset': 'BOLD_POP',
          'animation': 'none',
          'fontFamily': 'Montserrat',
          'fontWeight': 900,
          'fontSizePx': 72.0,
          'textColor': '#FFFFFFFF',
          'highlightColor': '#FFF7C204',
          'strokeColor': '#FF000000',
          'strokeWidthPx': 8.0,
          'stroke2Color': '#FF222222',
          'stroke2WidthPx': 14.0,
          'shadow': true,
          'safeZone': 'tiktok',
          'faceAvoid': true,
          'maxLines': 2,
          'backgroundMode': 'pill',
          'backgroundOpacity': 0.85,
          'gradient': {'top': '#FFFFFFFF', 'bottom': '#FFFFD700'},
          'glowColor': '#FFF7C204',
          'glowRadiusPx': 16.0,
          'glowStrength': 0.6,
        },
      };

      final caption = EditIrCaption.fromJson(json);
      expect(caption.id, 'cap-1');
      expect(caption.style['safeZone'], 'tiktok');
      expect(caption.style['faceAvoid'], isTrue);
      expect(caption.style['stroke2WidthPx'], 14.0);
      expect(caption.style['backgroundMode'], 'pill');
      expect(caption.style['backgroundOpacity'], 0.85);

      final outJson = caption.toJson();
      expect(outJson['style']['safeZone'], 'tiktok');
      expect(outJson['style']['gradient']['bottom'], '#FFFFD700');
    });
  });
}

