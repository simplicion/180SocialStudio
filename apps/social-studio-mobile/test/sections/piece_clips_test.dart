import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/data/models/vault_item.dart';
import 'package:social_studio_mobile/features/library/vault_provider.dart';
import 'package:social_studio_mobile/features/planner/piece_clips_section.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

/// Calendar piece → clips shot for it → "Shooting done" → "Edit N clips in Studio" (PRODUCTION_READINESS_PLAN P2.1).
void main() {
  test('piece clips: only that piece, videos with a file, in take order', () {
    VaultItem v(String id, {String? piece, int? take, String? path = '/c/x.mp4', VaultItemType type = VaultItemType.video}) =>
        VaultItem(id: id, name: id, type: type, localPath: path, pieceId: piece, takeIndex: take);
    final clips = pieceClips([
      v('b', piece: 'p1', take: 2),
      v('a', piece: 'p1', take: 1),
      v('other', piece: 'p2', take: 1),
      v('nofile', piece: 'p1', take: 3, path: null),
      v('note', piece: 'p1', take: 4, type: VaultItemType.note),
    ], 'p1');
    expect(clips.map((c) => c.id), ['a', 'b']);
  });

  test('vault items keep pieceId and take order through storage', () {
    final it = VaultItem(id: 'i', name: 'Clip 1', type: VaultItemType.video, localPath: '/c/1.mp4', pieceId: 'piece1', takeIndex: 1);
    final back = VaultItem.fromJson(it.toJson());
    expect((back.pieceId, back.takeIndex), ('piece1', 1));
    expect(back.copyWith(name: 'Intro').takeIndex, 1);
  });

  appTest('piece sheet lists its clips, "Shooting done" marks the piece shot, Studio gets every clip', (tester) async {
    final b = seededBackend()..json('PUT', '$sm/content-calendar/:id/pieces/:pieceId', {'piece': {...pieceJson(), 'status': 'shot'}});
    final h = await pumpApp(tester, b, location: '/planner/cal1');
    final items = h.container.read(vaultItemsProvider.notifier);
    await drive(tester, h.container.read(vaultItemsProvider.future));
    await drive(tester, items.addItem(name: 'Clip 2', type: VaultItemType.video, localPath: '/clips/p1/b.mp4', pieceId: 'piece1', takeIndex: 2));
    await drive(tester, items.addItem(name: 'Clip 1', type: VaultItemType.video, localPath: '/clips/p1/a.mp4', pieceId: 'piece1', takeIndex: 1));
    await drive(tester, items.addItem(name: 'Elsewhere', type: VaultItemType.video, localPath: '/clips/p1/c.mp4', pieceId: 'piece9', takeIndex: 1));

    await tester.tap(find.text('3 myths about shipping'));
    await settle(tester);
    expect(find.text('Clips (2)'), findsOneWidget);
    expect(find.text('Elsewhere'), findsNothing);
    final first = tester.getTopLeft(find.text('Clip 1')).dy;
    expect(first, lessThan(tester.getTopLeft(find.text('Clip 2')).dy));
    expect(find.text('Edit 2 clips in Studio'), findsOneWidget);

    await tapVisible(tester, find.text('Shooting done'));
    expect(b.last('PUT', '$sm/content-calendar/cal1/pieces/piece1')!.json, {'status': 'shot'});
    expect(find.text('Shooting done'), findsNothing); // already shot
  });
}
