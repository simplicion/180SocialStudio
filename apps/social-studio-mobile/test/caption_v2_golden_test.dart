import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/studio/caption_v2_painter.dart';

import '../integration_test/caption_v2_fixtures.dart';

/// Real image goldens of the v2 preview painter (the same CaptionV2Renderer the editor uses): 3 templates ×
/// {Latin, Hindi, Arabic, Japanese} × {group enter, mid-word, word change, exit}. One golden per template × script,
/// the four instants side by side. Fonts are the OFL files in test/fonts, registered under their family names, so the
/// images do not depend on the machine or the network. Update with `flutter test --update-goldens`.
///
/// The on-device test (integration_test/caption_parity_test.dart) draws the same captions with this painter AND the
/// Android export renderer and compares them.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    for (final e in kCaptionTestFonts.entries) {
      final bytes = File('test/fonts/${e.value}').readAsBytesSync();
      await (FontLoader(e.key)..addFont(Future.value(ByteData.sublistView(bytes)))).load();
    }
  });

  // 1080×1920 canvas drawn at 270×480 (scale 0.25), so canvas-pixel units are exercised.
  const frame = Size(270, 480);

  for (final spec in kCaptionTestSpecs.keys) {
    for (final script in kCaptionTestScripts.keys) {
      testWidgets('golden $spec × $script', (tester) async {
        final cap = captionFixture(spec, script);
        final renderer = CaptionV2Renderer(fontFor: registeredCaptionFont, canvasWidth: 1080);
        await tester.binding.setSurfaceSize(Size(frame.width * 4, frame.height));
        await tester.pumpWidget(
          Directionality(
            textDirection: TextDirection.ltr,
            child: RepaintBoundary(
              key: const ValueKey('strip'),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final t in kCaptionTestTimes.values)
                    Container(
                      width: frame.width,
                      height: frame.height,
                      color: const Color(0xFF3A4048),
                      child: CustomPaint(
                        size: frame,
                        painter: CaptionV2Painter(renderer: renderer, caption: cap, spec: cap.styleV2!, tMs: t.toDouble()),
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
        await expectLater(find.byKey(const ValueKey('strip')), matchesGoldenFile('goldens/caption_v2_${spec}_$script.png'));
        await tester.binding.setSurfaceSize(null);
      });
    }
  }
}
