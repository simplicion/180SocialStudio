import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/auth/one_eighty_sso_service.dart';
import '../../core/providers.dart';
import 'auth_provider.dart';
import 'auth_repository.dart';

enum _Step { credentials, mfa }

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _mfa = TextEditingController();
  _Step _step = _Step.credentials;
  bool _busy = false;
  String? _error;
  String? _notice;
  StreamSubscription? _oauthSub;

  @override
  void initState() {
    super.initState();
    _oauthSub = ref.read(deepLinksProvider).oauthCallbacks.listen((cb) async {
      final code = cb.uri.queryParameters['code'];
      if (code != null && code.isNotEmpty) {
        setState(() {
          _busy = true;
          _error = null;
        });
        try {
          final sso = OneEightySsoService();
          final data = await sso.handleCallbackUri(cb.uri);
          final accessToken = data['access_token'] as String;
          final refreshToken = data['refresh_token'] as String?;
          await ref.read(tokenStoreProvider).saveSession(accessToken: accessToken, refreshToken: refreshToken);
          await ref.read(sessionProvider.notifier).retryRestore();
        } catch (e) {
          if (mounted) setState(() => _error = errorText(e));
        } finally {
          if (mounted) setState(() => _busy = false);
        }
      }
    });
  }

  @override
  void dispose() {
    _oauthSub?.cancel();
    _mfa.dispose();
    super.dispose();
  }

  Future<void> _loginWith180Identity({bool fullScreen = false}) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final sso = OneEightySsoService();
      final data = await sso.launch180IdentityLogin(
        context: context,
        fullScreen: fullScreen,
      );
      if (data != null && (data['access_token'] != null || data['id_token'] != null)) {
        final accessToken = (data['access_token'] ?? data['id_token']) as String;
        final refreshToken = data['refresh_token'] as String?;
        await ref.read(tokenStoreProvider).saveSession(accessToken: accessToken, refreshToken: refreshToken);
        await ref.read(sessionProvider.notifier).retryRestore();
        var session = ref.read(sessionProvider).valueOrNull;
        if (session == null && mounted) {
          final idToken = data['id_token'] as String?;
          if (idToken != null && idToken.isNotEmpty && idToken != accessToken) {
            await ref.read(tokenStoreProvider).saveSession(accessToken: idToken, refreshToken: refreshToken);
            await ref.read(sessionProvider.notifier).retryRestore();
            session = ref.read(sessionProvider).valueOrNull;
          }
        }
        if (session == null && mounted) {
          final err = ref.read(sessionProvider).error;
          setState(() => _error = err != null ? errorText(err) : 'Authentication could not establish a workspace session. Please try again.');
        }
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitMfa() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(sessionProvider.notifier).login(
            email: '',
            password: '',
            mfaToken: _mfa.text.trim(),
          );
      if (!mounted) return;
      if (result is LoginSuccess) {
        // Router will redirect
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Brand Favicon Logo
                    Center(
                      child: Container(
                        width: 84,
                        height: 84,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(22),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.12),
                              blurRadius: 18,
                              offset: const Offset(0, 6),
                            ),
                          ],
                        ),
                        child: Image.asset(
                          'assets/logo/brand_favicon.png',
                          fit: BoxFit.contain,
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),

                    // App Title
                    Text(
                      '180 Social Studio',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.5,
                          ),
                    ),
                    const SizedBox(height: 8),

                    // Subtitle
                    Text(
                      _step == _Step.mfa
                          ? 'Enter the 6-digit code from your authenticator app.'
                          : 'Your Autonomous AI 180 Social Studio.\nSign in to manage & automate your channels.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppTheme.textSecondary,
                            height: 1.4,
                          ),
                    ),
                    const SizedBox(height: 36),

                    if (_step == _Step.credentials) ...[
                      // ─── 1-CLICK 180 IDENTITY AUTH BUTTON (SAME AS 180WORKSPACE) ───
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          key: const Key('login.180identity'),
                          borderRadius: BorderRadius.circular(18),
                          onTap: _busy ? null : () => _loginWith180Identity(fullScreen: false),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                            decoration: BoxDecoration(
                              color: AppTheme.surfaceElevated,
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(
                                color: AppTheme.border,
                                width: 1.5,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.25),
                                  blurRadius: 18,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Row(
                              children: [
                                // Left Logo Container with Live Status Dot
                                Stack(
                                  clipBehavior: Clip.none,
                                  children: [
                                    Container(
                                      width: 42,
                                      height: 42,
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        color: AppTheme.surface,
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(color: AppTheme.border),
                                      ),
                                      child: Image.asset(
                                        'assets/logo/brand_favicon.png',
                                        fit: BoxFit.contain,
                                      ),
                                    ),
                                    Positioned(
                                      top: -2,
                                      right: -2,
                                      child: Container(
                                        width: 10,
                                        height: 10,
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF10B981),
                                          shape: BoxShape.circle,
                                          border: Border.all(color: AppTheme.surfaceElevated, width: 2),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(width: 14),

                                // Main Title
                                Expanded(
                                  child: Text(
                                    'Continue with 180 Profile',
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w700,
                                      color: AppTheme.textPrimary,
                                      letterSpacing: -0.2,
                                    ),
                                  ),
                                ),

                                // Status Indicator or Chevron
                                _busy
                                    ? SizedBox(
                                        width: 18,
                                        height: 18,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: AppTheme.textPrimary,
                                        ),
                                      )
                                    : Icon(
                                        Icons.chevron_right_rounded,
                                        color: AppTheme.textMuted,
                                        size: 22,
                                      ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),

                      // Full Page in-app window toggle
                      Center(
                        child: TextButton.icon(
                          onPressed: _busy ? null : () => _loginWith180Identity(fullScreen: true),
                          icon: Icon(Icons.open_in_full_rounded, size: 13, color: AppTheme.textMuted),
                          label: Text(
                            'Open in Full Page Window',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                              color: AppTheme.textMuted,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Cryptographic Trust Badge
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.lock_outline_rounded, size: 13, color: Color(0xFF10B981)),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              'End-to-End Cryptographic Sovereign Verification',
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                color: AppTheme.textMuted,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ] else ...[
                      // MFA Verification Code Field
                      TextFormField(
                        key: const Key('login.mfa'),
                        controller: _mfa,
                        autofocus: true,
                        keyboardType: TextInputType.number,
                        maxLength: 8,
                        onFieldSubmitted: (_) => _submitMfa(),
                        decoration: fieldDecoration('Verification code'),
                        validator: (v) => (v == null || v.trim().length < 6) ? 'Enter the code' : null,
                      ),
                      const SizedBox(height: 12),
                      ElevatedButton(
                        onPressed: _busy ? null : _submitMfa,
                        child: _busy
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Verify MFA', style: TextStyle(fontWeight: FontWeight.w700)),
                      ),
                      TextButton(
                        onPressed: _busy ? null : () => setState(() => _step = _Step.credentials),
                        child: const Text('Use a different account'),
                      ),
                    ],

                    if (_error != null)
                      _Banner(text: _error!, color: AppTheme.error, icon: Icons.error_outline_rounded),
                    if (_notice != null)
                      _Banner(text: _notice!, color: AppTheme.warning, icon: Icons.info_outline_rounded, onOpenWeb: true),
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

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.color, required this.icon, this.onOpenWeb = false});
  final String text;
  final Color color;
  final IconData icon;
  final bool onOpenWeb;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(top: 14),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, color: color, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text(text, style: TextStyle(color: AppTheme.textPrimary, fontSize: 13))),
          ]),
          if (onOpenWeb)
            TextButton(
              onPressed: () => launchUrl(Uri.parse(AppConfig.webAppUrl), mode: LaunchMode.externalApplication),
              child: const Text('Open 180 Workspace on the web'),
            ),
        ]),
      );
}
