import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:social_studio_mobile/core/network/api_client.dart';
import 'package:social_studio_mobile/core/offline/outbox.dart';
import 'package:social_studio_mobile/core/providers.dart';
import 'package:social_studio_mobile/core/routing/app_router.dart';
import 'package:social_studio_mobile/core/storage/key_value_store.dart';

import 'fake_backend.dart';

/// Secure-storage contents of a device that is signed in with a valid device token.
Map<String, String> signedInStore({String access = 'access-1', String refresh = 'refresh-1'}) => {
      'auth.accessToken': access,
      'auth.refreshToken': refresh,
      'device.id': 'dev1',
      'device.token': 'device-token-1',
      'device.expiresAt': DateTime.now().add(const Duration(days: 20)).millisecondsSinceEpoch.toString(),
    };

class AppHarness {
  AppHarness(this.container, this.backend, this.outboxStorage, this.store);
  final ProviderContainer container;
  final FakeBackend backend;
  final MemoryOutboxStorage outboxStorage;
  final InMemoryKeyValueStore store;

  GoRouter get router => container.read(routerProvider);
}

final _live = <ProviderContainer>[];

/// [testWidgets] for app-level tests: after [body] the tree is torn down and the provider
/// container disposed inside the test, so the outbox heartbeat timer is cancelled before the
/// framework checks for pending timers.
void appTest(String description, Future<void> Function(WidgetTester tester) body) {
  testWidgets(description, (tester) async {
    try {
      await body(tester);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      for (final c in _live) {
        c.dispose();
      }
      _live.clear();
      await settle(tester, frames: 3); // flush requests started by the last frame
    }
  });
}

/// Pumps the real router + providers against [backend]. The theme is a plain dark theme
/// because the app theme fetches Google Fonts over the network.
Future<AppHarness> pumpApp(
  WidgetTester tester,
  FakeBackend backend, {
  Map<String, String>? store,
  String? location,
  Size size = const Size(400, 860),
}) async {
  SharedPreferences.setMockInitialValues({});
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  final kv = InMemoryKeyValueStore(store ?? signedInStore());
  final outboxStorage = MemoryOutboxStorage();
  final container = ProviderContainer(overrides: [
    keyValueStoreProvider.overrideWithValue(kv),
    outboxStorageProvider.overrideWithValue(outboxStorage),
    apiClientProvider.overrideWith((ref) => ApiClient(
          tokens: ref.watch(tokenStoreProvider),
          baseUrl: 'https://api.test',
          adapter: backend,
        )),
  ]);
  _live.add(container);

  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: Consumer(
      builder: (context, ref, _) => MaterialApp.router(
        theme: ThemeData.dark(useMaterial3: true),
        routerConfig: ref.watch(routerProvider),
      ),
    ),
  ));
  await settle(tester);
  final h = AppHarness(container, backend, outboxStorage, kv);
  if (location != null) {
    h.router.go(location);
    await settle(tester);
  }
  return h;
}

/// Lets fake HTTP round-trips and a few frames complete. Not `pumpAndSettle`: skeletons and
/// spinners animate forever.
Future<void> settle(WidgetTester tester, {int frames = 12}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Awaits [future] while pumping frames. Awaiting an HTTP call directly inside `testWidgets`
/// hangs, because fake time only moves when the test pumps.
Future<T> drive<T>(WidgetTester tester, Future<T> future) async {
  Object? error;
  T? value;
  var done = false;
  future.then((v) {
    value = v;
    done = true;
  }, onError: (Object e) {
    error = e;
    done = true;
  });
  for (var i = 0; i < 100 && !done; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
  if (!done) throw TimeoutException('future did not complete while pumping');
  if (error != null) throw error!;
  return value as T;
}

/// Scrolls the first scrollable until [finder] is visible, then taps it.
Future<void> tapVisible(WidgetTester tester, Finder finder, {Finder? scrollable}) async {
  await tester.scrollUntilVisible(finder, 200, scrollable: scrollable ?? find.byType(Scrollable).first);
  await settle(tester, frames: 6); // a scrolling list ignores taps until it stops
  await tester.tap(finder);
  await settle(tester);
}

/// No GoRouter "no routes for location" page and no unknown workspace section.
void expectNoRoutingError() {
  expect(find.textContaining('no routes'), findsNothing);
  expect(find.text('Page Not Found'), findsNothing);
  expect(find.textContaining('Unknown section'), findsNothing);
}

/// Like [drive] but for a call that must fail: returns the error it threw.
Future<Object> driveError(WidgetTester tester, Future<Object?> future) async {
  try {
    await drive(tester, future);
  } catch (e) {
    return e;
  }
  throw TestFailure('expected the call to fail, but it succeeded');
}
