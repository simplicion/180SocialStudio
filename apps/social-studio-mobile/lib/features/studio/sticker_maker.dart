import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Popular emoji stickers, drawn on the phone (no download, no licence): each becomes a transparent PNG that is
/// placed as a floating image layer.
const stickerEmojis = [
  '🔥', '😂', '❤️', '👍', '💯', '✨', '🎉', '😱', '👀', '🚀', '💡', '✅', '❌', '⭐', '🤯', '🙌', //
  '👇', '👉', '😎', '🤔', '💰', '📈', '⚡', '🎯', '😍', '🥳', '🙏', '💪', '👏', '😭', '🤝', '📌',
];

/// Draws [emoji] centred on a transparent [size]² PNG at [outPath] (reused when it already exists).
Future<String> renderEmojiSticker(String emoji, String outPath, {int size = 512}) async {
  final out = File(outPath);
  if (out.existsSync() && out.lengthSync() > 0) return outPath;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final tp = TextPainter(
    text: TextSpan(text: emoji, style: TextStyle(fontSize: size * 0.78)),
    textDirection: TextDirection.ltr,
  )..layout();
  tp.paint(canvas, Offset((size - tp.width) / 2, (size - tp.height) / 2));
  final image = await recorder.endRecording().toImage(size, size);
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  if (png == null) throw StateError('Could not draw the sticker');
  out.parent.createSync(recursive: true);
  await out.writeAsBytes(png.buffer.asUint8List(), flush: true);
  return outPath;
}
