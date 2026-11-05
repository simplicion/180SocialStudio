import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/native_engine/edit_ir.dart';
import 'package:social_studio_mobile/features/studio/timeline_merge.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// Editor overhaul Phase 2: every manual edit has an AI Director counterpart (F-20), and item provenance / locks
/// survive every edit (F-21).
void main() {
  test('every public TimelineOps operation is in the Director parity manifest', () {
    final dart = File('lib/features/studio/timeline_ops.dart').readAsStringSync();
    final ops = RegExp(r'^  static MobileEditIr ([a-zA-Z]+)\(', multiLine: true).allMatches(dart).map((m) => m.group(1)!).toSet();
    final manifest = (jsonDecode(File('../../packages/video-contracts/src/director-tool-parity.json').readAsStringSync())['ops'] as Map).keys.toSet();
    expect(ops.difference(manifest), isEmpty, reason: 'TimelineOps operations without a Director mapping (add them to director-tool-parity.json)');
    expect(manifest.difference(ops), isEmpty, reason: 'manifest entries for operations that no longer exist');
  });

  MobileEditIr base() => TimelineOps.initial(projectId: 'p1', durationMs: 10000, width: 1080, height: 1920);

  test('itemMeta round-trips through JSON and drops entries of removed items', () {
    var ir = TimelineOps.addText(base(), 'Hook', startMs: 0, durationMs: 1000);
    final id = ir.captions.single.id;
    ir = ir.withItemMeta(id, origin: 'manual', locked: true);
    final back = MobileEditIr.fromJson(ir.toJson());
    expect(back.isLocked(id), isTrue);
    expect(back.itemMeta[id]!.origin, 'manual');
    final removed = TimelineOps.removeCaption(back, id);
    expect(removed.toJson().containsKey('itemMeta'), isFalse);
  });

  test('provenance and locks survive edits that rebuild items (move, cut, restyle)', () {
    var ir = TimelineOps.addZoom(TimelineOps.addText(base(), 'Hook', startMs: 6000, durationMs: 1000), startMs: 7000);
    final t = ir.captions.single.id;
    final z = ir.zooms.single.id;
    ir = ir.withItemMeta(t, origin: 'manual', locked: true).withItemMeta(z, origin: 'manual');
    ir = TimelineOps.moveItem(ir, TrackKind.text, t, 5000);
    ir = TimelineOps.removeRange(ir, 0, 1000);
    ir = TimelineOps.editText(ir, t, style: {'textColor': '#FFE600'});
    expect(ir.isLocked(t), isTrue);
    expect(ir.itemMeta[z]?.origin, 'manual');
  });

  test("a merge keeps the creator's locks and takes the Director's provenance for items it added", () {
    final b = TimelineOps.addText(base(), 'T', startMs: 0, durationMs: 1000);
    final t = b.captions.single.id;
    final mine = b.withItemMeta(t, origin: 'manual', locked: true);
    final added = TimelineOps.addZoom(b, startMs: 3000);
    final z = added.zooms.single.id;
    final theirs = added.withItemMeta(z, origin: 'director');
    final r = TimelineMerge.merge(base: b, mine: mine, theirs: theirs);
    expect(r.ir.isLocked(t), isTrue);
    expect(r.ir.itemMeta[z]?.origin, 'director');
  });
}
