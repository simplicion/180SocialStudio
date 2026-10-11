import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/media/asset_cache.dart';
import 'core/native_engine/media_engine_service.dart';
import 'core/providers.dart';
import 'core/routing/app_router.dart';
import 'core/services/push_notifications.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_provider.dart';
import 'features/auth/auth_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Shared cache of online media (stock B-roll, music, SFX): indexed once so the editor can use it synchronously.
  unawaited(AssetCache.instance.init());
  if (!kIsWeb && Platform.isAndroid) AssetCache.instance.videoFinalizer = MediaEngineService.makeSeekable;

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    debugPrint('[180Social] Flutter error: ${details.exception}');
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('[180Social] Uncaught async error: $error\n$stack');
    return true;
  };

  runApp(ProviderScope(child: SocialStudioApp()));
}

class SocialStudioApp extends ConsumerStatefulWidget {
  const SocialStudioApp({super.key});

  @override
  ConsumerState<SocialStudioApp> createState() => _SocialStudioAppState();
}

class _SocialStudioAppState extends ConsumerState<SocialStudioApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(deepLinksProvider).start((location) {
        final router = ref.read(routerProvider);
        if (location.startsWith('/oauth') || location.startsWith('/home') || location.startsWith('/login')) {
          router.go(location);
        } else {
          router.push(location);
        }
      });
      // Push: gated on Firebase config; a tapped notification opens the post.
      unawaited(ref.read(pushServiceProvider.notifier).init(navigate: (location) => ref.read(routerProvider).push(location)).then((_) {
        if (ref.read(sessionProvider).valueOrNull != null) unawaited(ref.read(pushServiceProvider.notifier).enable());
      }));
    });
    // After each sign-in, ask for the notification permission (Android 13+) and register this device's token.
    ref.listenManual(sessionProvider, (prev, next) {
      if (prev?.valueOrNull == null && next.valueOrNull != null) unawaited(ref.read(pushServiceProvider.notifier).enable());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // Re-check subscription / kill-switch and flush queued offline writes.
      unawaited(ref.read(sessionProvider.notifier).refreshEntitlement());
      unawaited(ref.read(outboxProvider).drain());
    }
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(themeModeProvider);
    AppTheme.currentThemeMode = themeMode;
    
    return MaterialApp.router(
      title: '180 Social Studio',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: themeMode,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
