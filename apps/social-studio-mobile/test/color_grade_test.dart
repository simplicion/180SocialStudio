import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/color_grade.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';

/// Applies the affine to an RGB colour (0..1), the way the renderer's RgbMatrix does.
List<double> apply(List<double> a, List<double> c) =>
    [for (var r = 0; r < 3; r++) a[r * 4] * c[0] + a[r * 4 + 1] * c[1] + a[r * 4 + 2] * c[2] + a[r * 4 + 3]];

void main() {
  test('neutral grade is the identity', () {
    final f = EditIrFilter();
    expect(f.isNeutral, isTrue);
    expect(gradeAffine(f), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });

  test('mono turns every colour grey by luma', () {
    final out = apply(gradeAffine(EditIrFilter(preset: 'NOIR_BW')), [1, 0, 0]);
    expect(out[0], closeTo(0.2126, 1e-9));
    expect(out[1], closeTo(0.2126, 1e-9));
    expect(out[2], closeTo(0.2126, 1e-9));
  });

  test('exposure doubles per stop, contrast pivots on mid grey, warmth adds red and removes blue', () {
    expect(apply(gradeAffine(EditIrFilter(exposure: 1)), [0.2, 0.2, 0.2])[0], closeTo(0.4, 1e-9));
    expect(apply(gradeAffine(EditIrFilter(contrast: 1.5)), [0.5, 0.5, 0.5])[1], closeTo(0.5, 1e-9));
    final warm = apply(gradeAffine(EditIrFilter(temperature: 1)), [0.5, 0.5, 0.5]);
    expect(warm[0], greaterThan(0.5));
    expect(warm[2], lessThan(0.5));
  });

  test('steps compose in order: preset, exposure, contrast, saturation, temperature/tint, brightness', () {
    final f = EditIrFilter(preset: 'GLOW', exposure: 0.5, contrast: 1.2, saturation: 0.8, temperature: 0.3, tint: -0.2, brightness: 1.1);
    final c = [0.3, 0.5, 0.7];
    // By hand, step by step.
    var x = [for (final v in c) v + 0.06];
    x = [for (final v in x) v * 1.4142135623730951];
    x = [for (final v in x) v * 1.2 + 0.5 * (1 - 1.2)];
    final l = 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
    x = [for (final v in x) 0.2 * l + 0.8 * v];
    x = [x[0] * (1 + 0.036 - 0.01), x[1] * (1 + 0.02), x[2] * (1 - 0.036 - 0.01)];
    x = [for (final v in x) v + 0.05];
    final got = apply(gradeAffine(f), c);
    for (var i = 0; i < 3; i++) {
      expect(got[i], closeTo(x[i], 1e-9));
    }
    // Flutter's matrix carries the same numbers with offsets in 0..255.
    final m = gradeMatrix(f);
    expect(m[4], closeTo(gradeAffine(f)[3] * 255, 1e-9));
    expect(m.sublist(15), [0, 0, 0, 1, 0]);
  });

  test('new adjustments round-trip and are omitted when neutral', () {
    final f = EditIrFilter(exposure: 0.4, temperature: -0.5, tint: 0.2, vignette: 0.6);
    final back = EditIrFilter.fromJson(f.toJson());
    expect([back.exposure, back.temperature, back.tint, back.vignette], [0.4, -0.5, 0.2, 0.6]);
    expect(EditIrFilter().toJson().containsKey('exposure'), isFalse);
    expect(EditIrFilter.fromJson({'temperature': 5}).temperature, 1.0);
  });
}
