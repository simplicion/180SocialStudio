import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:flutter/material.dart';
import 'package:universal_html/html.dart' as html;
import 'package:webview_flutter/webview_flutter.dart';

import '../theme/app_theme.dart';

/// Callback signatures for OneEightyPay
typedef OneEightyPaySuccessCallback = void Function(OneEightyPayResult result);
typedef OneEightyPayErrorCallback = void Function(String error);
typedef OneEightyPayCancelCallback = void Function();

/// Result payload returned upon checkout completion.
class OneEightyPayResult {
  const OneEightyPayResult({
    required this.isSuccess,
    this.transactionId,
    this.sessionId,
    this.amount,
    this.currency,
    this.rawPayload,
    this.isCancelled = false,
    this.errorMessage,
  });

  final bool isSuccess;
  final String? transactionId;
  final String? sessionId;
  final double? amount;
  final String? currency;
  final Map<String, dynamic>? rawPayload;
  final bool isCancelled;
  final String? errorMessage;

  factory OneEightyPayResult.success({
    String? transactionId,
    String? sessionId,
    double? amount,
    String? currency,
    Map<String, dynamic>? rawPayload,
  }) {
    return OneEightyPayResult(
      isSuccess: true,
      transactionId: transactionId,
      sessionId: sessionId,
      amount: amount,
      currency: currency,
      rawPayload: rawPayload,
    );
  }

  factory OneEightyPayResult.cancelled() {
    return const OneEightyPayResult(
      isSuccess: false,
      isCancelled: true,
    );
  }

  factory OneEightyPayResult.failure(String error) {
    return OneEightyPayResult(
      isSuccess: false,
      errorMessage: error,
    );
  }
}

/// Checkout configuration options passed to [OneEightyPay.open].
class OneEightyPayOptions {
  const OneEightyPayOptions({
    this.checkoutUrl,
    this.checkoutUrlBuilder,
    this.amount,
    this.currency = 'USD',
    this.title = '180 Pay Sovereign Checkout',
    this.description,
    this.clientId,
    this.returnUrl,
    this.metadata,
    this.fullScreen = false,
  }) : assert(
          checkoutUrl != null || checkoutUrlBuilder != null,
          'Either checkoutUrl or checkoutUrlBuilder must be provided',
        );

  final Uri? checkoutUrl;
  final Future<Uri> Function()? checkoutUrlBuilder;
  final double? amount;
  final String currency;
  final String title;
  final String? description;
  final String? clientId;
  final String? returnUrl;
  final Map<String, dynamic>? metadata;
  final bool fullScreen;
}

/// 180 Pay Sovereign Cross-Platform In-App Payment Gateway SDK.
///
/// Automatically determines the active platform (Web vs Android/iOS)
/// and presents the appropriate in-app bottom sheet within milliseconds.
///
/// Features:
/// - In-DOM slide-up bottom sheet with iframe & postMessage bridge on Flutter Web
/// - Native modal bottom sheet with high-performance WebView on Android & iOS
/// - Instant deep-link callback URL and custom scheme interception
/// - Android emulator localhost -> 10.0.2.2 fallback
/// - Zero external browser redirection: users stay seamlessly inside the application
class OneEightyPay {
  OneEightyPay._();

  /// Resolves the checkout URI, ensuring `ux_mode=bottom_sheet` and local Android host mapping.
  static Uri resolveCheckoutUri(Uri original, {String? returnUrl}) {
    var uri = original;
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      if (uri.host == 'localhost' || uri.host == '127.0.0.1') {
        uri = uri.replace(host: '10.0.2.2');
      }
    }
    final qp = Map<String, String>.from(uri.queryParameters);
    if (!qp.containsKey('ux_mode')) {
      qp['ux_mode'] = 'bottom_sheet';
    }
    if (!qp.containsKey('app')) {
      qp['app'] = 'pay';
    }
    if (returnUrl != null && !qp.containsKey('returnUrl')) {
      qp['returnUrl'] = returnUrl;
    }
    return uri.replace(queryParameters: qp);
  }

  /// Opens the 180 Pay bottom sheet in-app.
  ///
  /// Returns a [OneEightyPayResult] containing transaction metadata.
  static Future<OneEightyPayResult> open(
    BuildContext context, {
    required OneEightyPayOptions options,
  }) async {
    Uri targetUri;
    try {
      if (options.checkoutUrlBuilder != null) {
        targetUri = await options.checkoutUrlBuilder!();
      } else {
        targetUri = options.checkoutUrl!;
      }
    } catch (e) {
      return OneEightyPayResult.failure('Failed to resolve checkout URL: $e');
    }

    final resolvedUrl = resolveCheckoutUri(targetUri, returnUrl: options.returnUrl);

    if (kIsWeb) {
      return _openWebBottomSheet(resolvedUrl, options: options);
    } else {
      if (!context.mounted) return OneEightyPayResult.cancelled();
      final res = await showModalBottomSheet<OneEightyPayResult>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        barrierColor: Colors.black.withValues(alpha: 0.76),
        enableDrag: !options.fullScreen,
        builder: (ctx) => _OneEightyPayModalSheet(
          initialUrl: resolvedUrl,
          initialFullScreen: options.fullScreen,
          returnUrl: options.returnUrl,
          title: options.title,
        ),
      );
      return res ?? OneEightyPayResult.cancelled();
    }
  }

  /// Web DOM Bottom Sheet implementation
  static Future<OneEightyPayResult> _openWebBottomSheet(
    Uri url, {
    required OneEightyPayOptions options,
  }) {
    final completer = Completer<OneEightyPayResult>();

    const styleId = '__180_pay_sdk_styles__';
    if (html.document.getElementById(styleId) == null) {
      final style = html.StyleElement()
        ..id = styleId
        ..text = '''
          @keyframes one-eighty-fade-in { from { opacity: 0; } to { opacity: 1; } }
          @keyframes one-eighty-fade-out { from { opacity: 1; } to { opacity: 0; } }
          @keyframes one-eighty-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
          @keyframes one-eighty-slide-down { from { transform: translateY(0); } to { transform: translateY(100%); } }
          @keyframes one-eighty-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ''';
      html.document.head?.append(style);
    }

    final isMobile = (html.window.innerWidth ?? 800) < 768;
    final fullScreen = options.fullScreen;

    final root = html.DivElement()
      ..id = '__180_pay_sdk_container__'
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
      ..style.fontFamily =
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    final backdrop = html.DivElement()
      ..style.position = 'fixed'
      ..style.top = '0'
      ..style.left = '0'
      ..style.right = '0'
      ..style.bottom = '0'
      ..style.background = 'rgba(0, 0, 0, 0.76)'
      ..style.setProperty('backdrop-filter', 'blur(8px)')
      ..style.setProperty('-webkit-backdrop-filter', 'blur(8px)')
      ..style.animation = 'one-eighty-fade-in 0.25s ease-out forwards'
      ..style.cursor = 'pointer'
      ..style.pointerEvents = 'none';

    final sheet = html.DivElement()
      ..style.position = 'relative'
      ..style.zIndex = '1000000'
      ..style.width = '100%'
      ..style.maxWidth = fullScreen ? '100%' : (isMobile ? '100%' : '500px')
      ..style.height = fullScreen ? '100vh' : (isMobile ? '92vh' : '740px')
      ..style.maxHeight = fullScreen ? '100vh' : '96vh'
      ..style.margin = fullScreen ? '0' : (isMobile ? '0' : '0 0 20px 0')
      ..style.background = '#09090b'
      ..style.color = '#fafafa'
      ..style.border = fullScreen ? 'none' : '1px solid rgba(255, 255, 255, 0.12)'
      ..style.borderRadius = fullScreen ? '0' : (isMobile ? '24px 24px 0 0' : '24px')
      ..style.boxShadow =
          '0 -12px 40px rgba(0, 0, 0, 0.65), 0 20px 48px rgba(0, 0, 0, 0.85)'
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
      '<div style="width: 22px; height: 22px; border-radius: 6px; background: rgba(147, 51, 234, 0.15); border: 1px solid rgba(147, 51, 234, 0.3); display: flex; align-items: center; justify-content: center;"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#c084fc" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-6 3.75h19.5a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0021.75 4.5H2.25A2.25 2.25 0 000 6.75v10.5A2.25 2.25 0 002.25 21z" /></svg></div><span style="font-size: 13px; font-weight: 700; color: #f4f4f5; letter-spacing: -0.01em;">${options.title}</span>',
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
      ..src = url.toString()
      ..style.flex = '1'
      ..style.width = '100%'
      ..style.height = '100%'
      ..style.border = 'none'
      ..style.background = 'transparent';
    iframe.setAttribute('allow', 'clipboard-write; payment; geolocation');

    sheet.append(header);
    sheet.append(iframe);
    root.append(backdrop);
    root.append(sheet);
    html.document.body?.append(root);

    bool isClosed = false;
    void closeSheet(OneEightyPayResult result) {
      if (isClosed) return;
      isClosed = true;
      sheet.style.animation = fullScreen
          ? 'one-eighty-fade-out 0.2s ease-in forwards'
          : 'one-eighty-slide-down 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards';
      backdrop.style.animation = 'one-eighty-fade-out 0.25s ease-in forwards';
      Future.delayed(const Duration(milliseconds: 250), () {
        root.remove();
      });
      if (!completer.isCompleted) {
        completer.complete(result);
      }
    }

    final openedAt = DateTime.now();
    Timer(const Duration(milliseconds: 400), () {
      if (!isClosed) {
        backdrop.style.pointerEvents = 'auto';
      }
    });

    backdrop.onClick.listen((event) {
      if (DateTime.now().difference(openedAt).inMilliseconds < 450) return;
      if (event.target == backdrop) {
        closeSheet(OneEightyPayResult.cancelled());
      }
    });

    sheet.onClick.listen((e) => e.stopPropagation());
    sheet.onMouseDown.listen((e) => e.stopPropagation());
    sheet.onTouchStart.listen((e) => e.stopPropagation());

    closeBtn.onClick.listen((_) => closeSheet(OneEightyPayResult.cancelled()));

    late StreamSubscription msgSub;
    msgSub = html.window.onMessage.listen((event) {
      dynamic data = event.data;
      if (data is String) {
        try {
          data = jsonDecode(data);
        } catch (_) {}
      }
      if (data is Map) {
        final type = data['type'];
        if (type == '180_PAYMENT_SUCCESS' || type == '180_PAY_SUCCESS') {
          msgSub.cancel();
          closeSheet(
            OneEightyPayResult.success(
              transactionId: data['transactionId']?.toString(),
              sessionId: data['sessionId']?.toString(),
              amount: (data['amount'] is num) ? (data['amount'] as num).toDouble() : null,
              currency: data['currency']?.toString(),
              rawPayload: Map<String, dynamic>.from(data),
            ),
          );
        } else if (type == '180_PAYMENT_CLOSE' ||
            type == '180_PAY_CLOSE' ||
            type == '180_MODAL_CLOSE' ||
            type == '180_IDENTITY_CLOSE') {
          msgSub.cancel();
          closeSheet(OneEightyPayResult.cancelled());
        }
      }
    });

    return completer.future;
  }
}

/// Drop-in 180 Pay Button Widget for Flutter applications.
///
/// Developers place this button anywhere in their widget tree:
/// ```dart
/// OneEightyPayButton(
///   label: 'Subscribe Monthly — $20/mo',
///   icon: Icons.bolt_rounded,
///   options: OneEightyPayOptions(
///     amount: 20.0,
///     currency: 'USD',
///     title: '180 Creator Pass',
///     checkoutUrlBuilder: () => api.createCheckoutUrl(),
///     returnUrl: 'socialstudio://oauth-callback',
///   ),
///   onSuccess: (res) => print('Success: ${res.transactionId}'),
///   onFailure: (err) => print('Error: $err'),
/// )
/// ```
class OneEightyPayButton extends StatefulWidget {
  const OneEightyPayButton({
    super.key,
    required this.options,
    this.label = 'Pay with 180 Pay',
    this.icon = Icons.credit_card_rounded,
    this.onSuccess,
    this.onFailure,
    this.onCancel,
    this.backgroundColor,
    this.foregroundColor,
    this.borderRadius = 12.0,
    this.height = 48.0,
    this.width = double.infinity,
  });

  final OneEightyPayOptions options;
  final String label;
  final IconData icon;
  final OneEightyPaySuccessCallback? onSuccess;
  final OneEightyPayErrorCallback? onFailure;
  final OneEightyPayCancelCallback? onCancel;
  final Color? backgroundColor;
  final Color? foregroundColor;
  final double borderRadius;
  final double height;
  final double width;

  @override
  State<OneEightyPayButton> createState() => _OneEightyPayButtonState();
}

class _OneEightyPayButtonState extends State<OneEightyPayButton> {
  bool _loading = false;

  Future<void> _handleTap() async {
    if (_loading) return;
    setState(() => _loading = true);

    try {
      final result = await OneEightyPay.open(
        context,
        options: widget.options,
      );

      if (!mounted) return;

      if (result.isSuccess) {
        widget.onSuccess?.call(result);
      } else if (result.isCancelled) {
        widget.onCancel?.call();
      } else if (result.errorMessage != null) {
        widget.onFailure?.call(result.errorMessage!);
      }
    } catch (e) {
      if (mounted) {
        widget.onFailure?.call(e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bg = widget.backgroundColor ?? AppTheme.primary;
    final fg = widget.foregroundColor ?? Colors.white;

    return SizedBox(
      width: widget.width,
      height: widget.height,
      child: ElevatedButton.icon(
        onPressed: _loading ? null : _handleTap,
        style: ElevatedButton.styleFrom(
          backgroundColor: bg,
          foregroundColor: fg,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(widget.borderRadius),
          ),
        ),
        icon: _loading
            ? SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: fg),
              )
            : Icon(widget.icon, size: 20),
        label: Text(
          widget.label,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
        ),
      ),
    );
  }
}

/// Mobile WebView Modal Sheet implementation
class _OneEightyPayModalSheet extends StatefulWidget {
  const _OneEightyPayModalSheet({
    required this.initialUrl,
    this.initialFullScreen = false,
    this.returnUrl,
    required this.title,
  });

  final Uri initialUrl;
  final bool initialFullScreen;
  final String? returnUrl;
  final String title;

  @override
  State<_OneEightyPayModalSheet> createState() => _OneEightyPayModalSheetState();
}

class _OneEightyPayModalSheetState extends State<_OneEightyPayModalSheet> {
  late bool _isFullScreen = widget.initialFullScreen;
  late final WebViewController _controller;
  bool _loading = true;
  double _progress = 0.0;
  String? _loadError;
  bool _hasTriedHostFallback = false;

  void _popResult(OneEightyPayResult result) {
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop(result);
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
          'OneEightyPayMobileChannel',
          onMessageReceived: (JavaScriptMessage msg) {
            try {
              final data = jsonDecode(msg.message);
              if (data is Map) {
                final type = data['type'];
                if (type == '180_PAYMENT_SUCCESS' || type == '180_PAY_SUCCESS') {
                  _popResult(
                    OneEightyPayResult.success(
                      transactionId: data['transactionId']?.toString(),
                      sessionId: data['sessionId']?.toString(),
                      amount: (data['amount'] is num)
                          ? (data['amount'] as num).toDouble()
                          : null,
                      currency: data['currency']?.toString(),
                      rawPayload: Map<String, dynamic>.from(data),
                    ),
                  );
                } else if (type == '180_PAYMENT_CLOSE' || type == '180_PAY_CLOSE') {
                  _popResult(OneEightyPayResult.cancelled());
                }
              }
            } catch (_) {}
          },
        )
        ..setNavigationDelegate(
          NavigationDelegate(
            onProgress: (p) {
              if (mounted) {
                setState(() {
                  _progress = p / 100.0;
                  if (p >= 100) _loading = false;
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
                    if (window.__180_pay_listener_registered) return;
                    window.__180_pay_listener_registered = true;

                    function forward(payload) {
                      if (window.OneEightyPayMobileChannel) {
                        try {
                          var s = typeof payload === 'string' ? payload : JSON.stringify(payload);
                          window.OneEightyPayMobileChannel.postMessage(s);
                        } catch(e) {}
                      }
                    }

                    window.addEventListener('message', function(e) {
                      if (e && e.data) forward(e.data);
                    });
                    window.addEventListener('180_PAYMENT_SUCCESS', function(e) {
                      if (e && e.detail) forward(e.detail);
                    });
                    window.addEventListener('180_PAY_SUCCESS', function(e) {
                      if (e && e.detail) forward(e.detail);
                    });
                    window.addEventListener('180_PAYMENT_CLOSE', function() {
                      forward({ type: '180_PAYMENT_CLOSE' });
                    });
                  })();
                ''');
              }
            },
            onUrlChange: (UrlChange change) {
              final url = change.url;
              if (url != null) {
                _checkUrlForCompletion(url);
              }
            },
            onWebResourceError: (error) {
              final failingUrl = error.url;
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
            onNavigationRequest: (req) {
              final url = req.url;

              // ─── Deep-Link & App Scheme Callback Interception ─────────
              // Intercept custom app schemes (e.g. socialstudio://, workspace180://)
              if (!url.startsWith('http://') && !url.startsWith('https://')) {
                _handleCustomSchemeCallback(url);
                return NavigationDecision.prevent;
              }

              // Check if URL matches configured returnUrl or indicates payment success
              if (_checkUrlForCompletion(url)) {
                return NavigationDecision.prevent;
              }

              return NavigationDecision.navigate;
            },
          ),
        )
        ..loadRequest(widget.initialUrl);
    }
  }

  bool _checkUrlForCompletion(String url) {
    if (url.contains('payment=success') ||
        url.contains('status=success') ||
        url.contains('paid=true') ||
        url.contains('180_PAYMENT_SUCCESS')) {
      final uri = Uri.tryParse(url);
      final qp = uri?.queryParameters ?? {};
      _popResult(
        OneEightyPayResult.success(
          transactionId: qp['transactionId'] ?? qp['payment_id'] ?? qp['razorpay_payment_id'],
          sessionId: qp['sessionId'] ?? qp['session_id'],
          amount: double.tryParse(qp['amount'] ?? ''),
          currency: qp['currency'],
        ),
      );
      return true;
    }
    return false;
  }

  void _handleCustomSchemeCallback(String url) {
    final uri = Uri.tryParse(url);
    final qp = uri?.queryParameters ?? {};
    final isSuccess = qp['status'] == 'success' ||
        qp['payment'] == 'success' ||
        qp['paid'] == 'true' ||
        url.contains('success');

    if (isSuccess) {
      _popResult(
        OneEightyPayResult.success(
          transactionId: qp['transactionId'] ?? qp['payment_id'],
          sessionId: qp['sessionId'] ?? qp['session_id'],
          amount: double.tryParse(qp['amount'] ?? ''),
          currency: qp['currency'],
        ),
      );
    } else {
      _popResult(OneEightyPayResult.cancelled());
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
    final targetHeight =
        _isFullScreen ? media.size.height : (media.size.height * 0.90);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (!kIsWeb && await _controller.canGoBack()) {
          await _controller.goBack();
          return;
        }
        if (context.mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop(OneEightyPayResult.cancelled());
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
              : const BorderRadius.vertical(top: Radius.circular(24)),
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
              // Drag Handle
              if (!_isFullScreen) ...[
                const SizedBox(height: 8),
                Container(
                  width: 44,
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
                    Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(
                        color: const Color(0xFF18181B),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFF27272A), width: 1),
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.credit_card_rounded,
                          size: 14,
                          color: Color(0xFFC084FC),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        widget.title,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFFFAFAFA),
                          letterSpacing: -0.2,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: Icon(
                        _isFullScreen
                            ? Icons.fullscreen_exit_rounded
                            : Icons.fullscreen_rounded,
                        size: 20,
                        color: const Color(0xFFA1A1AA),
                      ),
                      tooltip: _isFullScreen
                          ? 'Collapse to bottom sheet'
                          : 'Expand to full page',
                      onPressed: _toggleFullScreen,
                    ),
                    IconButton(
                      icon: const Icon(
                        Icons.close_rounded,
                        size: 20,
                        color: Color(0xFFA1A1AA),
                      ),
                      tooltip: 'Close',
                      onPressed: () => Navigator.of(context).pop(OneEightyPayResult.cancelled()),
                    ),
                  ],
                ),
              ),

              if (_loading)
                LinearProgressIndicator(
                  value: _progress > 0 ? _progress : null,
                  minHeight: 2,
                  backgroundColor: const Color(0xFF18181B),
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFFC084FC)),
                ),

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
                                'Unable to load 180 Pay checkout',
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
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 22, vertical: 12),
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
                              'Web checkout handled via in-DOM sheet',
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
