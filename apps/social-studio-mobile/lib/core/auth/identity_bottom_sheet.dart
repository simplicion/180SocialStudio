import 'dart:convert';
import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../config/app_config.dart';

/// In-app authentication bottom sheet / full-page sheet for 180 Profile & Sovereign Identity.
/// Renders an in-app WebView on mobile so the user never leaves the application.
class IdentityBottomSheet extends StatefulWidget {
  const IdentityBottomSheet({
    super.key,
    required this.initialUrl,
    this.initialFullScreen = false,
  });

  final Uri initialUrl;
  final bool initialFullScreen;

  /// Shows the in-app bottom sheet and returns the intercepted callback [Uri] upon success.
  static Future<Uri?> show(
    BuildContext context, {
    required Uri initialUrl,
    bool fullScreen = false,
  }) {
    return showModalBottomSheet<Uri>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withValues(alpha: 0.76),
      enableDrag: !fullScreen,
      builder: (ctx) => IdentityBottomSheet(
        initialUrl: initialUrl,
        initialFullScreen: fullScreen,
      ),
    );
  }

  @override
  State<IdentityBottomSheet> createState() => _IdentityBottomSheetState();
}

class _IdentityBottomSheetState extends State<IdentityBottomSheet> {
  late bool _isFullScreen = widget.initialFullScreen;
  late final WebViewController _controller;
  bool _loading = true;
  double _progress = 0.0;
  String? _loadError;
  bool _hasHandledCallback = false;
  bool _hasTriedHostFallback = false;

  bool _isCallbackUri(Uri uri) {
    return uri.scheme == 'workspace180' ||
        uri.scheme == '180social' ||
        uri.scheme == 'socialstudio' ||
        uri.scheme == 'one80' ||
        uri.host == 'oauth-callback' ||
        uri.host == 'callback' ||
        uri.path.contains('oauth-callback') ||
        uri.path.contains('callback') ||
        uri.fragment.contains('oauth-callback') ||
        (uri.queryParameters.containsKey('code') &&
            uri.queryParameters.containsKey('state')) ||
        uri.queryParameters.containsKey('direct_token');
  }

  void _handleSuccessUri(Uri uri) {
    if (_hasHandledCallback) return;
    _hasHandledCallback = true;
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop(uri);
    }
  }

  @override
  void initState() {
    super.initState();
    if (!kIsWeb) {
      _controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(const Color(0xFF09090B))
        ..setUserAgent(
          'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        )
        ..addJavaScriptChannel(
          'OneEightyMobileChannel',
          onMessageReceived: (JavaScriptMessage msg) {
            try {
              final data = jsonDecode(msg.message);
              if (data is Map) {
                final type = data['type'];
                if (type == '180_IDENTITY_SUCCESS' || type == '180_AUTH_SUCCESS') {
                  final code = data['code'];
                  final state = data['state'];
                  final directToken = data['token'] ?? data['accessToken'] ?? data['authToken'];
                  if (code != null && code.toString().isNotEmpty) {
                    final uri = Uri.parse(
                      '${AppConfig.identityRedirectUri}?code=$code&state=${state ?? ''}',
                    );
                    _handleSuccessUri(uri);
                  } else if (directToken != null && directToken.toString().isNotEmpty) {
                    final uri = Uri.parse(
                      '${AppConfig.identityRedirectUri}?direct_token=$directToken&state=${state ?? ''}',
                    );
                    _handleSuccessUri(uri);
                  }
                } else if (type == '180_IDENTITY_CLOSE') {
                  if (!_hasHandledCallback && mounted && Navigator.of(context).canPop()) {
                    Navigator.of(context).pop(null);
                  }
                }
              }
            } catch (_) {}
          },
        )
        ..setNavigationDelegate(
          NavigationDelegate(
            onProgress: (progress) {
              if (mounted) {
                setState(() {
                  _progress = progress / 100.0;
                  if (progress >= 100) _loading = false;
                });
              }
            },
            onPageStarted: (_) {
              if (mounted) {
                setState(() {
                  _loading = true;
                  _loadError = null;
                });
              }
            },
            onPageFinished: (_) {
              if (mounted) {
                setState(() => _loading = false);
                _controller.runJavaScript('''
                  (function() {
                    if (window.__180_mobile_listener_registered) return;
                    window.__180_mobile_listener_registered = true;

                    function forwardMessage(payload) {
                      if (window.OneEightyMobileChannel) {
                        try {
                          var str = typeof payload === 'string' ? payload : JSON.stringify(payload);
                          window.OneEightyMobileChannel.postMessage(str);
                        } catch(e) {}
                      }
                    }

                    window.addEventListener('message', function(event) {
                      if (event && event.data) {
                        forwardMessage(event.data);
                      }
                    });

                    window.addEventListener('180_IDENTITY_SUCCESS', function(event) {
                      if (event && event.detail) forwardMessage(event.detail);
                    });

                    window.addEventListener('180_AUTH_SUCCESS', function(event) {
                      if (event && event.detail) forwardMessage(event.detail);
                    });

                    window.addEventListener('180_IDENTITY_CLOSE', function() {
                      forwardMessage({ type: '180_IDENTITY_CLOSE' });
                    });
                  })();
                ''');
              }
            },
            onUrlChange: (UrlChange change) {
              final url = change.url;
              if (url != null) {
                final uri = Uri.tryParse(url);
                if (uri != null && _isCallbackUri(uri)) {
                  _handleSuccessUri(uri);
                }
              }
            },
            onWebResourceError: (error) {
              final failingUrl = error.url;
              if (failingUrl != null && failingUrl.isNotEmpty) {
                final uri = Uri.tryParse(failingUrl);
                if (uri != null && _isCallbackUri(uri)) {
                  _handleSuccessUri(uri);
                  return;
                }
              }

              final desc = error.description.toLowerCase();
              final isCustomScheme = desc.contains('workspace180') ||
                  desc.contains('180social') ||
                  desc.contains('socialstudio') ||
                  desc.contains('one80');

              if (isCustomScheme) {
                final match = RegExp(
                  r'(workspace180|180social|socialstudio|one80)://[^\s]+',
                  caseSensitive: false,
                ).firstMatch(error.description);
                if (match != null) {
                  final uri = Uri.tryParse(match.group(0)!);
                  if (uri != null && _isCallbackUri(uri)) {
                    _handleSuccessUri(uri);
                    return;
                  }
                }
                return;
              }

              // Auto-fallback between localhost and 10.0.2.2 on Android
              if (!kIsWeb &&
                  defaultTargetPlatform == TargetPlatform.android &&
                  failingUrl != null &&
                  !_hasTriedHostFallback) {
                if (failingUrl.contains('localhost')) {
                  _hasTriedHostFallback = true;
                  final fallbackUrl = failingUrl.replaceFirst('localhost', '10.0.2.2');
                  _controller.loadRequest(Uri.parse(fallbackUrl));
                  return;
                } else if (failingUrl.contains('10.0.2.2')) {
                  _hasTriedHostFallback = true;
                  final fallbackUrl = failingUrl.replaceFirst('10.0.2.2', 'localhost');
                  _controller.loadRequest(Uri.parse(fallbackUrl));
                  return;
                }
              }

              if (mounted) {
                setState(() {
                  _loadError = error.description;
                  _loading = false;
                });
              }
            },
            onNavigationRequest: (NavigationRequest request) {
              final uri = Uri.parse(request.url);
              if (_isCallbackUri(uri)) {
                _handleSuccessUri(uri);
                return NavigationDecision.prevent;
              }
              return NavigationDecision.navigate;
            },
          ),
        )
        ..loadRequest(widget.initialUrl);
    }
  }

  void _toggleFullScreen() {
    setState(() {
      _isFullScreen = !_isFullScreen;
    });
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final targetHeight = _isFullScreen ? media.size.height : (media.size.height * 0.88);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (!kIsWeb && await _controller.canGoBack()) {
          await _controller.goBack();
          return;
        }
        if (context.mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop(null);
        }
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOutCubic,
        height: targetHeight,
        decoration: BoxDecoration(
          color: const Color(0xFF09090B),
          borderRadius: _isFullScreen
              ? BorderRadius.zero
              : const BorderRadius.vertical(top: Radius.circular(20)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.65),
              blurRadius: 28,
              spreadRadius: 4,
            ),
          ],
        ),
        child: SafeArea(
          top: _isFullScreen,
          bottom: true,
          child: Column(
            children: [
              // Drag Handle or Brand Icon
              if (!_isFullScreen) ...[
                const SizedBox(height: 8),
                Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFF27272A),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 4),
              ],

              // Top Bar
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: const BoxDecoration(
                  border: Border(
                    bottom: BorderSide(color: Color(0xFF27272A), width: 1),
                  ),
                ),
                child: Row(
                  children: [
                    // Brand Icon Box
                    Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: const Color(0xFF18181B),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: const Color(0xFF27272A), width: 1),
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.lock_outline_rounded,
                          size: 13,
                          color: Color(0xFFFAFAFA),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Text(
                        '180 Sovereign Identity',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFFFAFAFA),
                          letterSpacing: -0.2,
                        ),
                      ),
                    ),
                    // Fullscreen Toggle
                    IconButton(
                      icon: Icon(
                        _isFullScreen ? Icons.fullscreen_exit_rounded : Icons.fullscreen_rounded,
                        size: 20,
                        color: const Color(0xFFA1A1AA),
                      ),
                      tooltip: _isFullScreen ? 'Collapse to bottom sheet' : 'Expand to full page',
                      onPressed: _toggleFullScreen,
                    ),
                    // Close Button
                    IconButton(
                      icon: const Icon(
                        Icons.close_rounded,
                        size: 20,
                        color: Color(0xFFA1A1AA),
                      ),
                      tooltip: 'Close',
                      onPressed: () => Navigator.of(context).pop(null),
                    ),
                  ],
                ),
              ),

              // Linear Progress Bar
              if (_loading)
                LinearProgressIndicator(
                  value: _progress > 0 ? _progress : null,
                  minHeight: 2,
                  backgroundColor: const Color(0xFF18181B),
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFFFAFAFA)),
                ),

              // Content Area (WebView or Error State)
              Expanded(
                child: _loadError != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 54,
                                height: 54,
                                decoration: BoxDecoration(
                                  color: const Color(0xFF18181B),
                                  shape: BoxShape.circle,
                                  border: Border.all(color: const Color(0xFF27272A)),
                                ),
                                child: const Center(
                                  child: Icon(
                                    Icons.wifi_off_rounded,
                                    size: 26,
                                    color: Color(0xFFEF4444),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 16),
                              const Text(
                                'Unable to load authentication page',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFFFAFAFA),
                                  letterSpacing: -0.2,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _loadError!,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFFA1A1AA),
                                  fontFamily: 'monospace',
                                ),
                              ),
                              const SizedBox(height: 20),
                              ElevatedButton.icon(
                                onPressed: () {
                                  setState(() {
                                    _loadError = null;
                                    _loading = true;
                                    _hasTriedHostFallback = false;
                                  });
                                  _controller.reload();
                                },
                                icon: const Icon(Icons.refresh_rounded, size: 16),
                                label: const Text('Retry'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFFFAFAFA),
                                  foregroundColor: const Color(0xFF09090B),
                                  elevation: 0,
                                  padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  textStyle: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    : (kIsWeb
                        ? const Center(
                            child: Text(
                              'Web authentication handled via DOM',
                              style: TextStyle(color: Color(0xFFFAFAFA)),
                            ),
                          )
                        : WebViewWidget(controller: _controller)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
