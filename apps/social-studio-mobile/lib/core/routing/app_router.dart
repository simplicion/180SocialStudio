import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/auth_provider.dart';
import '../../features/auth/login_screen.dart';
import '../../features/common/feature_lock_view.dart';
import '../../features/dashboard/studio_dashboard_screen.dart';
import '../../features/shell/app_shell.dart';
import '../../features/shell/extra_routes.dart';
import '../widgets/common.dart';
import '../widgets/sync_indicator.dart';

final _rootKey = GlobalKey<NavigatorState>();

/// Bridges the Riverpod session into go_router's refresh mechanism.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _SessionListenable(ref);
  ref.onDispose(listenable.dispose);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/splash',
    refreshListenable: listenable,
    redirect: (context, state) {
      final uri = state.uri;
      // Handle custom scheme deep links (e.g. workspace180://oauth/callback?...)
      if (uri.scheme == 'workspace180' || uri.scheme == 'one80' || uri.scheme == '180social') {
        final path = [if (uri.host.isNotEmpty) uri.host, ...uri.pathSegments].join('/');
        final query = uri.hasQuery ? '?${uri.query}' : '';
        if (path.startsWith('oauth/callback') || path.startsWith('oauth-callback')) {
          return '/oauth-callback$query';
        }
        return '/$path$query';
      }

      final loc = state.matchedLocation;
      if (loc.startsWith('/review/')) return null; // public client portal, no login
      if (loc == '/oauth-callback' || loc.startsWith('/oauth-callback') || loc == '/oauth/callback' || loc.startsWith('/oauth/callback')) {
        return null; // OAuth callback processing
      }
      final session = ref.read(sessionProvider);
      if (!session.hasValue) return loc == '/splash' ? null : '/splash';
      final s = session.value;
      if (s == null) return loc == '/login' ? null : '/login';
      if (!s.entitlement.hasSocial) return loc == '/locked' ? null : '/locked';
      if (loc == '/login' || loc == '/splash' || loc == '/locked') return '/home';
      return null;
    },
    onException: (context, state, router) {
      final uri = state.uri;
      final raw = uri.toString();
      final query = uri.hasQuery
          ? '?${uri.query}'
          : (uri.fragment.contains('?') ? '?${uri.fragment.substring(uri.fragment.indexOf('?') + 1)}' : '');
      final isOAuth = raw.contains('oauth') ||
          raw.contains('status=') ||
          raw.contains('accountId=') ||
          raw.contains('code=') ||
          raw.contains('error=');
      if (isOAuth) {
        router.go('/oauth-callback$query');
        return;
      }
      router.go('/home');
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => LoginScreen()),
      GoRoute(path: '/locked', builder: (_, _) => FeatureLockView()),
      GoRoute(path: '/sync', builder: (_, _) => OutboxScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, _) => StudioDashboardScreen())]),
          ...shellBranches(),
        ],
      ),
      ...extraRoutes(),
    ],
  );
});

class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    return Scaffold(
      body: session.hasError
          ? Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              ErrorView(error: session.error!, onRetry: () => ref.read(sessionProvider.notifier).retryRestore()),
              TextButton(onPressed: () => ref.read(sessionProvider.notifier).logout(), child: Text('Sign out')),
            ])
          : LoadingView(label: 'Initializing 180 Social Studio...'),
    );
  }
}
