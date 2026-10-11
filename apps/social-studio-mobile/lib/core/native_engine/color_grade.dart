import 'dart:math' as math;

import 'edit_ir.dart';

/// Clip colour grade as one affine colour matrix. Mirrors `ColorGrade` in the Android renderer (ColorGrade.kt) so the
/// preview and the export match. Steps, in order: preset → exposure → contrast → saturation → temperature / tint →
/// brightness. Values are 0..1 colour units.
const _lr = 0.2126, _lg = 0.7152, _lb = 0.0722;

/// Row-major 3x4 affine: r' = m[0]r + m[1]g + m[2]b + m[3], …
typedef _Affine = List<double>;

_Affine _diag(double r, double g, double b, [double off = 0]) => [r, 0, 0, off, 0, g, 0, off, 0, 0, b, off];

_Affine _saturation(double s) {
  const l = [_lr, _lg, _lb];
  return [
    for (var r = 0; r < 3; r++) ...[for (var c = 0; c < 3; c++) (1 - s) * l[c] + (r == c ? s : 0), 0],
  ];
}

/// [step] applied after [first].
_Affine _after(_Affine step, _Affine first) => [
      for (var r = 0; r < 3; r++) ...[
        for (var c = 0; c < 3; c++) [for (var k = 0; k < 3; k++) step[r * 4 + k] * first[k * 4 + c]].reduce((a, b) => a + b),
        [for (var k = 0; k < 3; k++) step[r * 4 + k] * first[k * 4 + 3]].reduce((a, b) => a + b) + step[r * 4 + 3],
      ],
    ];

_Affine _preset(String p) => switch (p) {
      'NOIR_BW' => _saturation(0),
      'VIVID' => _saturation(1.25),
      'CINEMATIC_TEAL_ORANGE' => _diag(1.08, 1.0, 0.92),
      'VINTAGE_WARM' => _diag(1.1, 1.02, 0.85),
      'CYBER_NEON' => _diag(1.05, 0.9, 1.15),
      'GLOW' => _diag(1, 1, 1, 0.06),
      _ => _diag(1, 1, 1),
    };

/// The grade as a row-major 3x4 affine in 0..1 units (exposed for tests).
List<double> gradeAffine(EditIrFilter f) {
  var a = _preset(f.preset);
  if (f.exposure != 0) {
    final e = math.pow(2, f.exposure).toDouble();
    a = _after(_diag(e, e, e), a);
  }
  if (f.contrast != 1) a = _after(_diag(f.contrast, f.contrast, f.contrast, 0.5 * (1 - f.contrast)), a);
  if (f.saturation != 1) a = _after(_saturation(f.saturation), a);
  if (f.temperature != 0 || f.tint != 0) {
    a = _after(_diag(1 + 0.12 * f.temperature + 0.05 * f.tint, 1 - 0.1 * f.tint, 1 - 0.12 * f.temperature + 0.05 * f.tint), a);
  }
  if (f.brightness != 1) a = _after(_diag(1, 1, 1, 0.5 * (f.brightness - 1)), a);
  return a;
}

/// 4x5 matrix for Flutter's `ColorFilter.matrix` (offsets in 0..255).
List<double> gradeMatrix(EditIrFilter f) {
  final a = gradeAffine(f);
  return [
    for (var r = 0; r < 3; r++) ...[a[r * 4], a[r * 4 + 1], a[r * 4 + 2], 0, a[r * 4 + 3] * 255],
    0, 0, 0, 1, 0,
  ];
}
