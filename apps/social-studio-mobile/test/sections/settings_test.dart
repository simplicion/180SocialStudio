import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:social_studio_mobile/core/services/push_notifications.dart';
import 'package:social_studio_mobile/core/theme/theme_provider.dart';
import 'package:social_studio_mobile/data/models/social_post.dart';

import '../support/app_harness.dart';
import '../support/fixtures.dart';

const _devices = '/api/desktop/devices';

void main() {
  appTest('Settings → Active devices: current device badge (no revoke), revoke another device', (tester) async {
    final b = seededBackend()
      ..json('GET', _devices, {
        'success': true,
        'devices': [
          {'deviceId': 'dev1', 'label': 'This phone', 'platform': 'android', 'lastSeenAt': 1790000000000, 'current': true},
          {'deviceId': 'old', 'label': 'Old laptop', 'platform': 'windows', 'lastSeenAt': 1780000000000},
        ],
      })
      ..json('DELETE', '$_devices/:id', {'success': true});
    await pumpApp(tester, b, location: '/settings');
    expect(find.text('THIS DEVICE'), findsOneWidget);
    expect(find.byTooltip('Revoke device'), findsOneWidget, reason: 'the current device cannot be revoked from here');
    await tester.tap(find.byTooltip('Revoke device'));
    await settle(tester);
    await tester.tap(find.widgetWithText(TextButton, 'Revoke').last);
    await settle(tester);
    expect(b.calls('DELETE', '$_devices/old'), hasLength(1));
    expect(b.calls('DELETE', '$_devices/dev1'), isEmpty);
  });

  appTest('Settings → Appearance: Dark / Light / System persisted and selectable', (tester) async {
    final b = seededBackend()..json('GET', _devices, {'success': true, 'devices': []});
    final h = await pumpApp(tester, b, location: '/settings');
    await tester.scrollUntilVisible(find.text('System'), 200);
    expect(find.text('Dark'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('System'), findsOneWidget);

    await tester.tap(find.text('System'));
    await settle(tester);
    expect(h.container.read(themeModeProvider), ThemeMode.system);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('user_theme_mode'), 'system');

    await tester.tap(find.text('Light'));
    await settle(tester);
    expect(h.container.read(themeModeProvider), ThemeMode.light);
    expect(prefs.getString('user_theme_mode'), 'light');
    expect(ThemeModeNotifier.parse('light'), ThemeMode.light);
  });

  appTest('Settings → Notifications: shows "Push not configured" when Firebase is unavailable in this build', (tester) async {
    final b = seededBackend()..json('GET', _devices, {'success': true, 'devices': []});
    final h = await pumpApp(tester, b, location: '/settings');
    await h.container.read(pushServiceProvider.notifier).enable();
    await settle(tester);
    await tester.scrollUntilVisible(find.byKey(const Key('settings.push.status')), 200);
    expect(find.text('Push not configured in this build'), findsOneWidget);
    expect(find.text('Enable notifications'), findsNothing, reason: 'no action that cannot work');
  });

  test('push tap → post location (data.link or postId)', () {
    expect(PushNotificationService.locationFor({'link': 'workspace180://posts/p42'}), '/posts/p42');
    expect(PushNotificationService.locationFor({'postId': 'p7'}), '/posts/p7');
    expect(PushNotificationService.locationFor({'kind': 'test'}), isNull);
  });

  test('simulated variants are detected from the server markers', () {
    final sim = PostVariant.fromJson({'platform': 'threads', 'publishStatus': 'published', 'externalId': 'sim_threads_1', 'externalUrl': 'https://www.threads.net/@x/post/1'});
    final real = PostVariant.fromJson({'platform': 'threads', 'publishStatus': 'published', 'externalId': '1789', 'lastError': 'Posted, but the first comment failed'});
    expect(sim.isSimulated, isTrue);
    expect(real.isSimulated, isFalse);
    expect(real.isFailed, isFalse);
  });
}
