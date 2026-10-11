import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:universal_html/html.dart' as html;
import 'package:url_launcher/url_launcher.dart';

import '../config/app_config.dart';
import 'identity_bottom_sheet.dart';

class OneEightySsoService {
  final FlutterSecureStorage _storage;
  final Dio _dio;

  static const _kCodeVerifier = '180_oauth_code_verifier';
  static const _kOAuthState = '180_oauth_state';
  static const _kAccessToken = '180_access_token';
  static const _kRefreshToken = '180_refresh_token';
  static const _kIdToken = '180_id_token';

  // In-memory fallbacks to prevent Web IndexedDB/localStorage race conditions
  static String? _ephemeralCodeVerifier;
  static String? _ephemeralOAuthState;

  OneEightySsoService({FlutterSecureStorage? storage, Dio? dio})
      : _storage = storage ?? FlutterSecureStorage(),
        _dio = dio ?? Dio();

  /// Generate high-entropy cryptographically random string
  String _randomString(int length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
    final rand = Random.secure();
    return List.generate(length, (_) => chars[rand.nextInt(chars.length)]).join();
  }

  /// Base64URL encoding without padding (RFC 7636)
  String _base64UrlNoPadding(List<int> bytes) {
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  /// Launch 180 Identity SSO in bottom sheet (or full page inside the app)
  Future<Map<String, dynamic>?> launch180IdentityLogin({
    BuildContext? context,
    bool fullScreen = false,
  }) async {
    final verifier = _randomString(64);
    final digest = sha256.convert(utf8.encode(verifier));
    final challenge = _base64UrlNoPadding(digest.bytes);
    final state = _randomString(32);

    _ephemeralCodeVerifier = verifier;
    _ephemeralOAuthState = state;

    await _storage.write(key: _kCodeVerifier, value: verifier);
    await _storage.write(key: _kOAuthState, value: state);

    final authUrl = Uri.parse('${AppConfig.identityAuthUrl}/auth/login').replace(
      queryParameters: {
        'client_id': AppConfig.identityClientId,
        'redirect_uri': AppConfig.identityRedirectUri,
        'response_type': 'code',
        'scope': 'openid identity:read identity:email',
        'state': state,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
        'ux_mode': fullScreen ? 'full_page' : 'bottom_sheet',
      },
    );

    if (kIsWeb) {
      final completer = Completer<Map<String, dynamic>?>();

      // Inject animation keyframes into the document head
      const styleId = '__180_identity_sheet_styles__';
      if (html.document.getElementById(styleId) == null) {
        final style = html.StyleElement()
          ..id = styleId
          ..text = '''
            @keyframes one-eighty-fade-in { from { opacity: 0; } to { opacity: 1; } }
            @keyframes one-eighty-fade-out { from { opacity: 1; } to { opacity: 0; } }
            @keyframes one-eighty-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
            @keyframes one-eighty-slide-down { from { transform: translateY(0); } to { transform: translateY(100%); } }
          ''';
        html.document.head?.append(style);
      }

      final isMobile = (html.window.innerWidth ?? 800) < 768;

      final root = html.DivElement()
        ..id = '__180_identity_sheet_container__'
        ..style.position = 'fixed'
        ..style.top = '0'
        ..style.left = '0'
        ..style.right = '0'
        ..style.bottom = '0'
        ..style.zIndex = '999999'
        ..style.display = 'flex'
        ..style.flexDirection = 'column'
        ..style.justifyContent = fullScreen ? 'center' : 'flex-end'
        ..style.alignItems = 'center'
        ..style.fontFamily = 'system-ui, -apple-system, sans-serif';

      final backdrop = html.DivElement()
        ..style.position = 'fixed'
        ..style.top = '0'
        ..style.left = '0'
        ..style.right = '0'
        ..style.bottom = '0'
        ..style.background = 'rgba(0, 0, 0, 0.72)'
        ..style.setProperty('backdrop-filter', 'blur(8px)')
        ..style.setProperty('-webkit-backdrop-filter', 'blur(8px)')
        ..style.animation = 'one-eighty-fade-in 0.25s ease-out forwards'
        ..style.cursor = 'pointer'
        // CRITICAL FIX: Disable pointer-events initially so the tap/click that opened
        // this modal in Flutter never bleeds through to dismiss the backdrop immediately.
        ..style.pointerEvents = 'none';

      final sheet = html.DivElement()
        ..style.position = 'relative'
        ..style.zIndex = '1000000'
        ..style.width = '100%'
        ..style.maxWidth = fullScreen ? '100%' : (isMobile ? '100%' : '480px')
        ..style.height = fullScreen ? '100vh' : (isMobile ? '90vh' : '720px')
        ..style.maxHeight = fullScreen ? '100vh' : '94vh'
        ..style.margin = fullScreen ? '0' : (isMobile ? '0' : '0 0 24px 0')
        ..style.background = '#09090b'
        ..style.color = '#fafafa'
        ..style.border = fullScreen ? 'none' : '1px solid rgba(255, 255, 255, 0.12)'
        ..style.borderRadius = fullScreen ? '0' : (isMobile ? '24px 24px 0 0' : '24px')
        ..style.boxShadow = '0 -12px 40px rgba(0, 0, 0, 0.65), 0 20px 48px rgba(0, 0, 0, 0.85)'
        ..style.display = 'flex'
        ..style.flexDirection = 'column'
        ..style.overflow = 'hidden'
        ..style.animation = fullScreen
            ? 'one-eighty-fade-in 0.25s ease-out forwards'
            : 'one-eighty-slide-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards';

      final header = html.DivElement()
        ..style.flexShrink = '0'
        ..style.padding = '10px 16px 8px 16px'
        ..style.display = 'flex'
        ..style.flexDirection = 'column'
        ..style.alignItems = 'center'
        ..style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)'
        ..style.background = '#09090b'
        ..style.position = 'relative';

      if (!fullScreen) {
        final grabBar = html.DivElement()
          ..style.width = '44px'
          ..style.height = '4px'
          ..style.borderRadius = '9999px'
          ..style.background = 'rgba(255, 255, 255, 0.22)'
          ..style.marginBottom = '8px';
        header.append(grabBar);
      }

      final bar = html.DivElement()
        ..style.width = '100%'
        ..style.display = 'flex'
        ..style.alignItems = 'center'
        ..style.justifyContent = 'space-between'
        ..style.setProperty('gap', '12px');

      final titleWrap = html.DivElement()
        ..style.display = 'flex'
        ..style.alignItems = 'center'
        ..style.setProperty('gap', '8px');
      titleWrap.setInnerHtml(
        '<span style="font-size: 13px; font-weight: 700; color: #f4f4f5; letter-spacing: -0.01em;">180 Sovereign Identity</span>',
        treeSanitizer: html.NodeTreeSanitizer.trusted,
      );

      final closeBtn = html.ButtonElement()
        ..type = 'button'
        ..style.width = '28px'
        ..style.height = '28px'
        ..style.borderRadius = '50%'
        ..style.background = 'rgba(255, 255, 255, 0.08)'
        ..style.border = '1px solid rgba(255, 255, 255, 0.1)'
        ..style.color = '#a1a1aa'
        ..style.display = 'flex'
        ..style.alignItems = 'center'
        ..style.justifyContent = 'center'
        ..style.cursor = 'pointer'
        ..style.padding = '0';
      closeBtn.setInnerHtml(
        '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>',
        treeSanitizer: html.NodeTreeSanitizer.trusted,
      );

      bar.append(titleWrap);
      bar.append(closeBtn);
      header.append(bar);

      final iframe = html.IFrameElement()
        ..src = authUrl.toString()
        ..style.flex = '1'
        ..style.width = '100%'
        ..style.height = '100%'
        ..style.border = 'none'
        ..style.background = 'transparent';

      sheet.append(header);
      sheet.append(iframe);
      root.append(backdrop);
      root.append(sheet);
      html.document.body?.append(root);

      bool isClosed = false;
      void closeSheet() {
        if (isClosed) return;
        isClosed = true;
        sheet.style.animation = fullScreen
            ? 'one-eighty-fade-out 0.2s ease-in forwards'
            : 'one-eighty-slide-down 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        backdrop.style.animation = 'one-eighty-fade-out 0.25s ease-in forwards';
        Future.delayed(const Duration(milliseconds: 250), () {
          root.remove();
        });
      }

      // Record open timestamp to ignore any lingering synthetic touch/mouse click
      final openedAt = DateTime.now();

      // Enable backdrop interaction only after slide-up animation and click event queues settle (400ms)
      Timer(const Duration(milliseconds: 400), () {
        if (!isClosed) {
          backdrop.style.pointerEvents = 'auto';
        }
      });

      backdrop.onClick.listen((event) {
        if (DateTime.now().difference(openedAt).inMilliseconds < 450) {
          // Ignore opening click or touch bleed-through
          return;
        }
        if (event.target == backdrop) {
          closeSheet();
          if (!completer.isCompleted) completer.complete(null);
        }
      });

      // Stop propagation inside sheet so internal clicks/drags never bubble up to backdrop
      sheet.onClick.listen((e) => e.stopPropagation());
      sheet.onMouseDown.listen((e) => e.stopPropagation());
      sheet.onTouchStart.listen((e) => e.stopPropagation());

      closeBtn.onClick.listen((_) {
        closeSheet();
        if (!completer.isCompleted) completer.complete(null);
      });

      late StreamSubscription msgSub;
      msgSub = html.window.onMessage.listen((event) async {
        dynamic data = event.data;
        if (data is String) {
          try {
            data = jsonDecode(data);
          } catch (_) {}
        }
        if (data is Map) {
          final type = data['type'];
          if (type == '180_IDENTITY_CLOSE') {
            closeSheet();
            msgSub.cancel();
            if (!completer.isCompleted) completer.complete(null);
          } else if (type == '180_IDENTITY_ERROR' || type == '180_AUTH_ERROR') {
            closeSheet();
            msgSub.cancel();
            final errorDesc = data['error_description'] ?? data['error'] ?? data['message'] ?? 'Identity authentication failed';
            if (!completer.isCompleted) completer.completeError(Exception(errorDesc));
          } else if (type == '180_IDENTITY_SUCCESS' || type == '180_AUTH_SUCCESS') {
            closeSheet();
            msgSub.cancel();
            final returnedCode = data['code'];
            final returnedState = data['state'];
            final directToken = data['token'] ?? data['accessToken'] ?? data['authToken'];

            try {
              if (returnedCode != null && returnedState != null) {
                final directParam = directToken != null ? '&direct_token=$directToken' : '';
                final callbackUri = Uri.parse('${AppConfig.identityRedirectUri}?code=$returnedCode&state=$returnedState$directParam');
                final res = await handleCallbackUri(callbackUri);
                if (!completer.isCompleted) completer.complete(res);
              } else if (directToken != null) {
                final tokenStr = directToken.toString();
                await _storage.write(key: _kAccessToken, value: tokenStr);
                if (!completer.isCompleted) completer.complete({'access_token': tokenStr, 'user': data['user']});
              } else {
                if (!completer.isCompleted) completer.complete(null);
              }
            } catch (e) {
              debugPrint('[OneEightySsoService] Code exchange warning: $e');
              // Graceful fallback to directToken from postMessage if PKCE code exchange encountered network/format issue
              if (directToken != null) {
                final tokenStr = directToken.toString();
                await _storage.write(key: _kAccessToken, value: tokenStr);
                if (!completer.isCompleted) completer.complete({'access_token': tokenStr, 'user': data['user']});
              } else {
                if (!completer.isCompleted) completer.completeError(e);
              }
            }
          }
        }
      });

      return completer.future;
    } else {
      if (context != null && context.mounted) {
        final callbackUri = await IdentityBottomSheet.show(
          context,
          initialUrl: authUrl,
          fullScreen: fullScreen,
        );
        if (callbackUri != null) {
          return await handleCallbackUri(callbackUri);
        }
        return null;
      } else {
        if (!await launchUrl(authUrl, mode: LaunchMode.inAppWebView)) {
          throw Exception('Could not launch 180 Identity authentication browser.');
        }
        return null;
      }
    }
  }

  /// Handle incoming deep link or web callback (180social://, workspace180://, http://localhost:3007/#/oauth-callback)
  Future<Map<String, dynamic>> handleCallbackUri(Uri uri) async {
    final params = Map<String, String>.from(uri.queryParameters);
    if (uri.fragment.contains('?')) {
      final fragmentQuery = uri.fragment.substring(uri.fragment.indexOf('?') + 1);
      params.addAll(Uri.splitQueryString(fragmentQuery));
    }

    final code = params['code'];
    final state = params['state'];
    final error = params['error'];
    final directToken = params['direct_token'];

    if (error != null) {
      throw Exception('180 Identity error: $error (${params['error_description'] ?? ''})');
    }

    // Direct token authorization bypass (when webview postMessage already contains valid JWT)
    if (directToken != null && directToken.isNotEmpty) {
      await _storage.write(key: _kAccessToken, value: directToken);
      await _storage.delete(key: _kCodeVerifier);
      await _storage.delete(key: _kOAuthState);

      Map<String, dynamic> userInfo = {'id': 'authenticated'};
      try {
        final profileRes = await _dio.get(
          '${AppConfig.identityServerUrl}/api/oauth/userinfo',
          options: Options(headers: {'Authorization': 'Bearer $directToken'}),
        );
        if (profileRes.statusCode == 200 && profileRes.data is Map) {
          userInfo = Map<String, dynamic>.from(profileRes.data['user'] ?? profileRes.data);
        }
      } catch (_) {}

      return {
        'access_token': directToken,
        'user': userInfo,
      };
    }

    if (code == null || code.isEmpty) {
      throw Exception('Authorization code missing in OAuth callback.');
    }

    final savedState = (await _storage.read(key: _kOAuthState)) ?? _ephemeralOAuthState;
    if (savedState != null && state != null && savedState != state) {
      throw Exception('Invalid OAuth state parameter: CSRF validation failed.');
    }

    final codeVerifier = (await _storage.read(key: _kCodeVerifier)) ?? _ephemeralCodeVerifier;
    if (codeVerifier == null || codeVerifier.isEmpty) {
      throw Exception('PKCE code verifier missing.');
    }

    // Candidate token endpoints across identity provider domain and primary API domain
    final candidateEndpoints = [
      '${AppConfig.identityServerUrl}/api/oauth/token',
      '${AppConfig.identityServerUrl}/oauth/token',
      'https://services.180workspace.com/api/oauth/token',
      'https://services.180workspace.com/oauth/token',
      '${AppConfig.apiBaseUrl}/api/oauth/token',
      '${AppConfig.apiBaseUrl}/oauth/token',
      '${AppConfig.apiBaseUrl}/api/v1/identity/oauth/token',
    ];

    Response? response;
    DioException? lastError;

    for (final tokenUrl in candidateEndpoints) {
      try {
        response = await _dio.post(
          tokenUrl,
          data: {
            'grant_type': 'authorization_code',
            'client_id': AppConfig.identityClientId,
            'code': code,
            'redirect_uri': AppConfig.identityRedirectUri,
            'code_verifier': codeVerifier,
          },
          options: Options(
            headers: {'Content-Type': 'application/json'},
          ),
        );
        if (response.statusCode == 200 && response.data != null) {
          break;
        }
      } on DioException catch (e) {
        lastError = e;
        if (e.response?.statusCode == 400 && e.response?.data is Map && e.response?.data['error'] == 'invalid_grant') {
          // If code was already redeemed or expired, stop retrying
          break;
        }
      }
    }

    if (response == null || response.data == null) {
      throw lastError ?? Exception('Failed to exchange authorization code for tokens.');
    }

    final data = response.data as Map<String, dynamic>;
    final accessToken = data['access_token'] as String;
    final refreshToken = data['refresh_token'] as String?;
    final idToken = data['id_token'] as String?;

    // Persist session tokens
    await _storage.write(key: _kAccessToken, value: accessToken);
    if (refreshToken != null) {
      await _storage.write(key: _kRefreshToken, value: refreshToken);
    }
    if (idToken != null) {
      await _storage.write(key: _kIdToken, value: idToken);
    }

    // Cleanup ephemeral PKCE keys
    await _storage.delete(key: _kCodeVerifier);
    await _storage.delete(key: _kOAuthState);

    return data;
  }

  /// Get current access token
  Future<String?> getAccessToken() => _storage.read(key: _kAccessToken);

  /// Clear session
  Future<void> logout() async {
    await _storage.delete(key: _kAccessToken);
    await _storage.delete(key: _kRefreshToken);
    await _storage.delete(key: _kIdToken);
  }
}
