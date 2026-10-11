import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/data/models/vault_item.dart';
import 'package:social_studio_mobile/features/library/library_sync.dart';
import 'package:social_studio_mobile/features/library/vault_provider.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

/// Library metadata in the database, media on the phone (PRODUCTION_READINESS_PLAN P2.8).
void main() {
  appTest('merge: newer server metadata wins, file paths only for this phone, deletions applied, new local rows pushed', (tester) async {
    final b = seededBackend()..json('PUT', '$sm/library/sync', {'success': true, 'items': 1});
    final h = await pumpApp(tester, b);
    final sync = h.container.read(librarySyncProvider);
    final me = await drive(tester, sync.deviceId());
    expect(await drive(tester, sync.deviceId()), me, reason: 'stable per install');

    final old = DateTime.utc(2026, 10, 1);
    final newer = DateTime.utc(2026, 10, 2).toIso8601String();
    final local = [
      VaultItem(id: 'a', name: 'Clip 1', type: VaultItemType.video, localPath: '/clips/a.mp4', updatedAt: old, createdAt: old),
      VaultItem(id: 'gone', name: 'Old', type: VaultItemType.video, localPath: '/clips/g.mp4', updatedAt: old, createdAt: old),
      VaultItem(id: 'local-only', name: 'Fresh', type: VaultItemType.video, localPath: '/clips/f.mp4'),
    ];
    final merged = await drive(tester, sync.mergeItems(local, [
      {'id': 'a', 'name': 'Hook take', 'type': 'video', 'localPath': '/other/phone.mp4', 'deviceId': 'other', 'updatedAt': newer},
      {'id': 'gone', 'name': 'Old', 'type': 'video', 'deletedAt': newer, 'updatedAt': newer},
      {'id': 'b', 'name': 'From tablet', 'type': 'video', 'localPath': '/tablet/b.mp4', 'deviceId': 'tablet', 'pieceId': 'piece1', 'takeIndex': 2, 'updatedAt': newer},
      {'id': 'c', 'name': 'Mine', 'type': 'video', 'localPath': '/clips/c.mp4', 'deviceId': me, 'updatedAt': newer},
    ]));
    final byId = {for (final i in merged) i.id: i};
    expect(byId.keys.toSet(), {'a', 'local-only', 'b', 'c'});
    expect((byId['a']!.name, byId['a']!.localPath), ('Hook take', '/clips/a.mp4'));
    expect((byId['b']!.localPath, byId['b']!.pieceId, byId['b']!.takeIndex), (null, 'piece1', 2));
    expect(byId['c']!.localPath, '/clips/c.mp4');
    final pushed = b.last('PUT', '$sm/library/sync')!.json;
    expect([for (final i in pushed['items'] as List) i['id']], ['local-only']);
    expect(pushed['deviceId'], me);
  });

  appTest('a new take is pushed with its piece link and take order', (tester) async {
    final b = seededBackend()..json('PUT', '$sm/library/sync', {'success': true});
    final h = await pumpApp(tester, b);
    await drive(tester, h.container.read(vaultItemsProvider.future));
    await drive(
      tester,
      h.container.read(vaultItemsProvider.notifier).addItem(
            name: 'Clip 1',
            type: VaultItemType.video,
            localPath: '/clips/p1/a.mp4',
            pieceId: 'piece1',
            takeIndex: 1,
          ),
    );
    await settle(tester);
    final item = (b.last('PUT', '$sm/library/sync')!.json['items'] as List).single as Map;
    expect((item['name'], item['pieceId'], item['takeIndex'], item['localPath']), ('Clip 1', 'piece1', 1, '/clips/p1/a.mp4'));
  });
}
