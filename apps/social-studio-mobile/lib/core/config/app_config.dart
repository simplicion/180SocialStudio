import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform, kDebugMode, kIsWeb;

/// Build-time configuration. Nothing in here is a secret.
///
/// Override per build with `--dart-define`, e.g.
/// `flutter run --dart-define=API_BASE_URL=http://localhost:4007`.
class AppConfig {
  AppConfig._();

  static String get _localHost {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return '10.0.2.2';
    }
    return 'localhost';
  }

  /// Origin of the 180 Social Studio backend (no trailing slash, no `/api`).
  static String get apiBaseUrl {
    const fromEnv = String.fromEnvironment('API_BASE_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    if (kIsWeb) {
      final host = Uri.base.host;
      if (host == 'localhost' || host == '127.0.0.1') {
        return 'http://$host:4007';
      }
    }
    return 'http://18.207.84.197:4005';
  }

  /// Origin of the web app. Used to build shareable links such as `/review/<token>`.
  static String get webAppUrl {
    const fromEnv = String.fromEnvironment('WEB_APP_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    if (kIsWeb) {
      final host = Uri.base.host;
      if (host == 'localhost' || host == '127.0.0.1') {
        return 'http://$host:3002';
      }
    }
    if (kDebugMode) {
      return 'http://$_localHost:3002';
    }
    return 'https://app.180workspace.com';
  }

  /// Google OAuth *web* client id used as `serverClientId` so the native SDK mints an ID token
  /// the backend accepts. A public identifier, not a secret.
  static const String googleServerClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
    defaultValue: '',
  );

  /// Custom scheme the OS hands back to the app after a browser OAuth hop.
  static const String deepLinkScheme = 'workspace180';
  static String get oauthRedirectUri {
    const fromEnv = String.fromEnvironment('OAUTH_REDIRECT_URI');
    if (fromEnv.isNotEmpty) return fromEnv;
    if (kIsWeb) {
      final base = Uri.base.origin;
      return base.isNotEmpty ? '$base/#/oauth-callback' : 'https://social.180workspace.com/#/oauth-callback';
    }
    return 'workspace180://oauth/callback';
  }

  /// 180 Identity Provider Configurations (Live Production 180 Core API)
  static String get identityServerUrl {
    const fromEnv = String.fromEnvironment('IDENTITY_SERVER_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    return 'https://api.180core.cloud';
  }

  /// 180 Profile / Identity Web Auth UI Server (Live Global Cloudflare Edge OIDC/SSO)
  static String get identityAuthUrl {
    const fromEnv = String.fromEnvironment('IDENTITY_AUTH_URL');
    if (fromEnv.isNotEmpty) return fromEnv;
    return 'https://profile.180core.cloud';
  }

  /// Registered 180 Social Studio Client ID (180 Sovereign Core)
  static String get identityClientId {
    const fromEnv = String.fromEnvironment('IDENTITY_CLIENT_ID');
    if (fromEnv.isNotEmpty) return fromEnv;
    const from180Env = String.fromEnvironment('180_CLIENT_ID');
    if (from180Env.isNotEmpty) return from180Env;
    return '180_client_a61725d6de73908b150480da80991fc4';
  }

  static String get identityRedirectUri {
    const fromEnv = String.fromEnvironment('IDENTITY_REDIRECT_URI');
    if (fromEnv.isNotEmpty) return fromEnv;
    if (kIsWeb) {
      final base = Uri.base.origin;
      if (base.contains(':3000')) {
        return '$base/callback';
      }
      if (base.contains(':3007')) {
        return 'http://localhost:3007/oauth-callback';
      }
      return 'workspace180://oauth/callback';
    }
    return 'workspace180://oauth/callback';
  }

  /// Kebab-case app id used by billing, feature flags and `moduleGuard`.
  static const String socialAppId = 'social-media';

  /// Timeouts. LLM-backed endpoints are slow; uploads are slower.
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration defaultReceiveTimeout = Duration(seconds: 30);
  static const Duration aiReceiveTimeout = Duration(seconds: 120);
  static const Duration calendarGenerationTimeout = Duration(seconds: 180);
  static const Duration uploadTimeout = Duration(minutes: 10);

  static String absoluteWebUrl(String pathOrUrl) {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
    final p = pathOrUrl.startsWith('/') ? pathOrUrl : '/$pathOrUrl';
    return '$webAppUrl$p';
  }
}
