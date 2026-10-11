import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/routing/deep_links.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/platform.dart';
import 'account_selection_sheet.dart';
import 'accounts_tab.dart';

/// Screen displayed when an OAuth callback redirects to `/#/oauth-callback` or `/?status=...#/oauth-callback`.
/// Handles account connection confirmation, multiple-account selection, and error presentation.
class OAuthCallbackScreen extends ConsumerStatefulWidget {
  const OAuthCallbackScreen({super.key, this.query = const {}});
  final Map<String, String> query;

  @override
  ConsumerState<OAuthCallbackScreen> createState() => _OAuthCallbackScreenState();
}

class _OAuthCallbackScreenState extends ConsumerState<OAuthCallbackScreen> {
  late OAuthCallback _callback;
  Timer? _redirectTimer;
  bool _selectionHandled = false;

  @override
  void initState() {
    super.initState();
    _initCallback();
  }

  void _initCallback() {
    // Merge parameters from state query and browser URL (which may be in search query or fragment)
    final params = Map<String, String>.from(widget.query);
    if (kIsWeb) {
      final base = Uri.base;
      params.addAll(base.queryParameters);
      if (base.fragment.contains('?')) {
        final fQuery = base.fragment.substring(base.fragment.indexOf('?') + 1);
        params.addAll(Uri.splitQueryString(fQuery));
      }
    }

    final fakeUri = Uri(
      scheme: 'http',
      host: 'localhost',
      path: '/oauth-callback',
      queryParameters: params.isNotEmpty ? params : null,
    );
    _callback = OAuthCallback(fakeUri);

    // Notify global deep links and invalidate accounts cache
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.invalidate(allAccountsProvider);
      ref.read(deepLinksProvider).routeFor(fakeUri);

      if (_callback.needsSelection && !_selectionHandled) {
        _selectionHandled = true;
        showAccountSelectionSheet(context, _callback.selectionId!).then((_) {
          if (mounted) {
            ref.invalidate(allAccountsProvider);
            context.go('/home');
          }
        });
      } else if (_callback.isSuccess) {
        _redirectTimer = Timer(const Duration(seconds: 3), () {
          if (mounted) context.go('/home');
        });
      }
    });
  }

  @override
  void dispose() {
    _redirectTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cb = _callback;
    final platform = SocialPlatform.parse(cb.platform);

    if (cb.needsSelection) {
      return Scaffold(
        backgroundColor: AppTheme.background,
        appBar: AppBar(
          title: const Text('Connect Accounts'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_rounded),
            onPressed: () => context.go('/home'),
          ),
        ),
        body: SafeArea(
          child: AccountSelectionSheet(selectionId: cb.selectionId!),
        ),
      );
    }

    if (cb.isSuccess) {
      return Scaffold(
        backgroundColor: AppTheme.background,
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: SectionCard(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: platform.color.withValues(alpha: 0.15),
                          border: Border.all(color: platform.color.withValues(alpha: 0.35), width: 2),
                        ),
                        child: Icon(platform.icon, color: platform.color, size: 36),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        '${platform.label} Connected!',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'Your ${platform.label} account has been securely authenticated and linked to 180 Social Studio.',
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 13.5, height: 1.4),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 28),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: () {
                            _redirectTimer?.cancel();
                            context.go('/home');
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.primary,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          icon: const Icon(Icons.check_circle_outline_rounded, color: Colors.white, size: 18),
                          label: const Text(
                            'Continue to Studio',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    // Error State
    final errorMsg = cb.error ?? 'Authentication was cancelled or failed.';
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: SectionCard(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
                borderColor: AppTheme.error.withValues(alpha: 0.3),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppTheme.error.withValues(alpha: 0.12),
                      ),
                      child: Icon(Icons.error_outline_rounded, color: AppTheme.error, size: 32),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Connection Failed',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      errorMsg,
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 28),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: () => context.go('/home'),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        child: const Text('Return to Studio'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
