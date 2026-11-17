// Caption v2 fixtures shared by the host goldens (test/caption_v2_golden_test.dart) and the on-device preview-vs-export
// parity test (integration_test/caption_parity_test.dart): three v2 specs × four scripts × four instants.
//
// Fonts (SIL OFL 1.1, test/fonts/, licence in test/fonts/OFL.txt): Inter ExtraBold (bundled in the APK), Noto Sans
// Devanagari / Arabic ExtraBold and a subset of Noto Sans JP ExtraBold (the characters below + kana + ASCII).

import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';

/// Font family → file name in test/fonts (all weight 800).
const kCaptionTestFonts = <String, String>{
  'Inter': 'Inter-800.ttf',
  'Noto Sans Devanagari': 'NotoSansDevanagari-800.ttf',
  'Noto Sans Arabic': 'NotoSansArabic-800.ttf',
  'Noto Sans JP': 'NotoSansJP-800-subset.ttf',
};

const _stack = {'latin': 'Inter'};

/// Three templates that together use every paint layer and motion family.
final kCaptionTestSpecs = <String, Map<String, dynamic>>{
  // Heavy caps, yellow fill, double stroke, spring-pop group, active word scale spring.
  'impact': {
    'version': 2,
    'typography': {'fonts': _stack, 'weight': 800, 'sizePx': 84, 'case': 'upper'},
    'paint': {
      'fill': {'type': 'solid', 'color': '#FFE600'},
      'strokes': [
        {'color': '#000000', 'widthPx': 7},
        {'color': '#FFFFFF', 'widthPx': 3},
      ],
      'shadow': {'xPx': 0, 'yPx': 6, 'blurPx': 0, 'color': '#00000099'},
    },
    'words': {
      'active': {'color': '#FFFFFF', 'scale': 1.18},
      'spoken': {'color': '#FFE600'},
    },
    'motion': {
      'groupEnter': {
        'type': 'spring-pop',
        'durationMs': 260,
        'easing': {'type': 'spring', 'stiffness': 380, 'damping': 14},
      },
      'groupExit': {'type': 'fade', 'durationMs': 160},
      'activeWord': {'type': 'scale-spring', 'durationMs': 180},
    },
    'layout': {'position': 'lower-third', 'safeZone': 'tiktok', 'maxLines': 2},
  },
  // Dark pill, karaoke colour sweep, soft shadow, slide-up in / out, per-word fade.
  'glass': {
    'version': 2,
    'typography': {'fonts': _stack, 'weight': 800, 'sizePx': 64, 'case': 'none', 'letterSpacingEm': 0.01},
    'paint': {
      'fill': {'type': 'solid', 'color': '#FFFFFF'},
      'shadow': {'xPx': 0, 'yPx': 3, 'blurPx': 8, 'color': '#000000AA'},
      'background': {'mode': 'pill', 'color': '#101018', 'opacity': 0.7, 'paddingPx': 22, 'radiusPx': 28},
    },
    'words': {
      'resting': {'color': '#FFFFFFB3'},
      'active': {'color': '#5EEAD4'},
      'spoken': {'color': '#FFFFFF'},
    },
    'motion': {
      'groupEnter': {'type': 'slide-up', 'durationMs': 220},
      'groupExit': {'type': 'slide-up', 'durationMs': 180},
      'wordEnter': {'type': 'fade', 'staggerMs': 60, 'durationMs': 140},
      'activeWord': {'type': 'color-sweep'},
    },
    'layout': {'position': 'center', 'safeZone': 'reels', 'maxLines': 2},
  },
  // Gradient fill + crisp outline + glow AND shadow, a box sliding between words, scale-down-in.
  'gradient': {
    'version': 2,
    'typography': {'fonts': _stack, 'weight': 800, 'sizePx': 76, 'case': 'none'},
    'paint': {
      'fill': {'type': 'gradient', 'top': '#FFFFFF', 'bottom': '#FF7AC6'},
      'strokes': [
        {'color': '#1A0033', 'widthPx': 5},
      ],
      'shadow': {'xPx': 0, 'yPx': 5, 'blurPx': 6, 'color': '#00000088'},
      'glow': {'radiusPx': 18, 'color': '#C026D3', 'strength': 0.7},
    },
    'words': {
      'active': {
        'background': {'color': '#7C3AED', 'paddingPx': 10, 'radiusPx': 14},
      },
    },
    'motion': {
      'groupEnter': {'type': 'scale-down-in', 'durationMs': 240},
      'groupExit': {'type': 'fade', 'durationMs': 200},
      'activeWord': {
        'type': 'box-slide',
        'durationMs': 160,
        'easing': {'type': 'cubic', 'mode': 'out'},
      },
    },
    'layout': {'position': 'upper-third', 'safeZone': 'shorts', 'maxLines': 2},
  },
};

/// One sentence per script with word timings (ms from 0; the caption runs 0..2000).
const kCaptionTestScripts = <String, ({String language, List<(String, int, int)> words})>{
  'latin': (language: 'en', words: [('Stop', 0, 380), ('scrolling', 380, 820), ('and', 820, 1000), ('build', 1000, 1380), ('this', 1380, 1640), ('today', 1640, 2000)]),
  'hindi': (language: 'hi', words: [('आज', 0, 400), ('से', 400, 650), ('अपनी', 650, 1050), ('कहानी', 1050, 1500), ('शुरू', 1500, 1760), ('करो', 1760, 2000)]),
  'arabic': (language: 'ar', words: [('ابدأ', 0, 420), ('قصتك', 420, 900), ('اليوم', 900, 1320), ('مع', 1320, 1500), ('3', 1500, 1700), ('خطوات', 1700, 2000)]),
  'japanese': (language: 'ja', words: [('今日から', 0, 600), ('物語を', 600, 1200), ('始めよう', 1200, 2000)]),
};

/// The four instants of each caption: group enter (mid spring), mid-word, right after a word change, exit.
const kCaptionTestTimes = <String, int>{'enter': 70, 'midword': 520, 'wordchange': 1215, 'exit': 1930};

EditIrCaption captionFixture(String spec, String script) {
  final s = kCaptionTestScripts[script]!;
  final words = [for (final (t, a, b) in s.words) EditIrWord(text: t, startMs: a, endMs: b)];
  return EditIrCaption(
    id: '$spec-$script',
    startMs: 0,
    endMs: 2000,
    text: '',
    words: words,
    style: {'styleV2': kCaptionTestSpecs[spec]},
    language: s.language,
  );
}

/// The same caption as an IR JSON the Android renderer parses (MobileEditIr.parse).
Map<String, dynamic> captionIrJson(List<EditIrCaption> captions, {int width = 1080, int height = 1920}) => {
      'schemaVersion': 'mobile-editir/1',
      'projectId': 'caption-parity',
      'canvas': {'width': width, 'height': height, 'fps': 30, 'aspect': '9:16', 'background': '#000000'},
      'durationMs': 2000,
      'clips': [
        {
          'id': 'c0',
          'assetId': 'none',
          'sourceStartMs': 0,
          'sourceEndMs': 2000,
          'timelineStartMs': 0,
          'timelineEndMs': 2000,
          'speed': 1,
          'rotationDeg': 0,
          'volumeDb': 0,
        },
      ],
      'overlays': [],
      'captions': [for (final c in captions) c.toJson()],
      'zooms': [],
      'audio': {'originalVolumeDb': 0, 'music': []},
    };
