import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/native_engine/edit_ir.dart';

/// Applies a green-screen key to [child] with shaders/chroma_key.frag, the same maths as the export (ChromaKey.kt).
/// Needs Impeller; without it the layer is shown unkeyed with a note, never a different-looking fake.
class ChromaKeyed extends StatelessWidget {
  const ChromaKeyed({super.key, required this.keyed, required this.child});
  final EditIrChromaKey keyed;
  final Widget child;

  static final Future<ui.FragmentProgram> _program = ui.FragmentProgram.fromAsset('shaders/chroma_key.frag');

  @override
  Widget build(BuildContext context) {
    if (!ui.ImageFilter.isShaderFilterSupported) {
      return Stack(fit: StackFit.passthrough, children: [
        child,
        const Positioned(
          left: 4,
          bottom: 4,
          child: DecoratedBox(
            decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.all(Radius.circular(6))),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              child: Text('Green screen shows in the export', style: TextStyle(color: Colors.white, fontSize: 10)),
            ),
          ),
        ),
      ]);
    }
    return FutureBuilder<ui.FragmentProgram>(
      future: _program,
      builder: (context, snap) {
        final program = snap.data;
        if (program == null) return child;
        final c = keyed.color.replaceFirst('#', '');
        final rgb = int.parse(c, radix: 16);
        final shader = program.fragmentShader()
          // Index 0-1 is the size, set by the engine.
          ..setFloat(2, ((rgb >> 16) & 0xFF) / 255)
          ..setFloat(3, ((rgb >> 8) & 0xFF) / 255)
          ..setFloat(4, (rgb & 0xFF) / 255)
          ..setFloat(5, keyed.similarity)
          ..setFloat(6, keyed.smoothness)
          ..setFloat(7, keyed.spill);
        return ImageFiltered(imageFilter: ui.ImageFilter.shader(shader), child: child);
      },
    );
  }
}
