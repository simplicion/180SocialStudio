import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';

import '../config/app_config.dart';

/// Result delivered to `workspace180://oauth/callback?...` after a social-account OAuth hop.
class OAuthCallback {
  OAuthCallback(this.uri);
  final Uri uri;

  Map<String, String> get _allParams {
    final params = Map<String, String>.from(uri.queryParameters);
    if (uri.fragment.contains('?')) {
      final fragmentQuery = uri.fragment.substring(uri.fragment.indexOf('?') + 1);
      params.addAll(Uri.splitQueryString(fragmentQuery));
    }
    return params;
  }

  String? get status => _allParams['status'];
  String? get error => _allParams['error_description'] ?? _allParams['error'];
  String? get platform => _allParams['platform'];
  String? get accountId => _allParams['accountId'];
  String? get state => _allParams['state'];
  String? get selectionId => _allParams['selectionId'];
  String? get code => _allParams['code'];

  /// The provider returned several pages / organisations; the user picks which to connect.
  bool get needsSelection => status == 'select' && (selectionId?.isNotEmpty ?? false);
  bool get isSuccess => error == null && (status == null || status == 'success' || status == 'connected');
}

/// Maps `workspace180://` links to in-app routes. Flutter's built-in deep linking is disabled
/// in the manifests so all links come through here.
class DeepLinkService {
  DeepLinkService({AppLinks? appLinks}) : _appLinks = appLinks;

  AppLinks? _appLinks;
  StreamSubscription<Uri>? _sub;
  final _oauth = StreamController<OAuthCallback>.broadcast();

  Stream<OAuthCallback> get oauthCallbacks => _oauth.stream;

  /// Returns an in-app location for [uri], or null if it is an OAuth callback / unknown.
  String? routeFor(Uri uri) {
    final isCustomScheme =
        uri.scheme == AppConfig.deepLinkScheme || uri.scheme == 'one80' || uri.scheme == 'workspace180' || uri.scheme == '180social';
    final isLocalOrEcosystem =
        (uri.scheme == 'https' || uri.scheme == 'http') && (uri.host.contains('180workspace') || uri.host == 'localhost' || uri.host == '127.0.0.1');
    if (!isCustomScheme && !isLocalOrEcosystem) {
      return null;
    }

    final isOAuth = uri.scheme == '180social' ||
        uri.scheme == 'workspace180' ||
        uri.host == 'oauth-callback' ||
        uri.path.contains('oauth-callback') ||
        uri.fragment.contains('oauth-callback') ||
        uri.queryParameters.containsKey('code') ||
        uri.fragment.contains('code=') ||
        uri.queryParameters.containsKey('status') ||
        uri.fragment.contains('status=') ||
        uri.queryParameters.containsKey('accountId') ||
        uri.fragment.contains('accountId=') ||
        uri.queryParameters.containsKey('selectionId') ||
        uri.fragment.contains('selectionId=') ||
        uri.queryParameters.containsKey('error') ||
        uri.fragment.contains('error=');

    if (isOAuth) {
      _oauth.add(OAuthCallback(uri));
      final query = uri.hasQuery ? '?${uri.query}' : (uri.fragment.contains('?') ? '?${uri.fragment.substring(uri.fragment.indexOf('?') + 1)}' : '');
      return '/oauth-callback$query';
    }

    final segments = [if (isCustomScheme && uri.host.isNotEmpty) uri.host, ...uri.pathSegments];
    if (segments.isEmpty) return '/home';
    switch (segments.first) {
      case 'oauth':
      case 'oauth-callback':
        _oauth.add(OAuthCallback(uri));
        final query = uri.hasQuery ? '?${uri.query}' : '';
        return '/oauth-callback$query';
      case 'review':
        return segments.length > 1 ? '/review/${segments[1]}' : null;
      case 'posts':
        return segments.length > 1 ? '/posts/${segments[1]}' : null;
      case 'inbox':
        return segments.length > 1 ? '/inbox/${segments[1]}' : '/inbox';
      case 'social-projects':
      case 'projects':
        if (segments.length > 1) {
          final tab = uri.queryParameters['tab'] ?? 'calendar';
          return '/projects/${segments[1]}/$tab';
        }
        return '/projects';
      default:
        return null;
    }
  }

  Future<void> start(void Function(String location) navigate) async {
    if (kIsWeb) {
      final baseUri = Uri.base;
      final r = routeFor(baseUri);
      if (r != null) navigate(r);
    }
    try {
      _appLinks ??= AppLinks();
      final initial = await _appLinks!.getInitialLink();
      if (initial != null) {
        final r = routeFor(initial);
        if (r != null) navigate(r);
      }
      _sub = _appLinks!.uriLinkStream.listen((uri) {
        final r = routeFor(uri);
        if (r != null) navigate(r);
      });
    } catch (e) {
      debugPrint('[DeepLinks] unavailable: $e');
    }
  }

  void dispose() {
    _sub?.cancel();
    _oauth.close();
  }
}
