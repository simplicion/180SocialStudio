import 'dart:ui' show PointerDeviceKind;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/payment/pay_bottom_sheet.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../auth/auth_provider.dart';
import '../auth/auth_repository.dart';

/// Shown when the creator needs to subscribe, recharge, or when trial has expired.
/// Features a switcher between "Monthly Plan" ($20/mo) and "Recharge & Use Pass" ($0.71/day).
/// Opens the 180 Pay checkout directly in-app via PayBottomSheet.
class FeatureLockView extends ConsumerStatefulWidget {
  const FeatureLockView({super.key});

  static (String, String) copyFor(LockReason? reason) => switch (reason) {
        LockReason.subscriptionExpired => (
            '3-Day Free Trial Expired',
            'Your free trial has ended. Subscribe monthly or recharge for flexible days to unlock full creator access.'
          ),
        LockReason.companySuspended => (
            'Workspace Suspended',
            'This workspace has been suspended. Contact 180 Workspace support to restore access.'
          ),
        LockReason.adminDisabled => (
            'Temporarily Unavailable',
            '180 Social Studio has been disabled by the platform administrator. Please check back later.'
          ),
        _ => (
            'Unlock 180 Social Studio',
            'Choose a creator plan or flexible daily recharge to continue creating content.'
          ),
      };

  @override
  ConsumerState<FeatureLockView> createState() => _FeatureLockViewState();
}

class _FeatureLockViewState extends ConsumerState<FeatureLockView> {
  int _selectedTab = 0; // 0: Monthly Subscription, 1: Recharge & Use Pass
  int _selectedDays = 7;
  bool _isLoadingCheckout = false;
  String? _activeCheckoutType;
  late final PageController _pageController;

  @override
  void initState() {
    super.initState();
    _pageController = PageController(initialPage: _selectedTab);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  double _calculateRechargeAmount(int days) {
    // $20 for 28 days = $0.714285... per day
    return ((days * 20.0 / 28.0) * 100).round() / 100.0;
  }

  Future<void> _handleCheckout(String type, {int? days}) async {
    setState(() {
      _isLoadingCheckout = true;
      _activeCheckoutType = type;
    });

    try {
      final api = ref.read(socialApiProvider);
      final checkout = await api.createBillingCheckout(
        type: type,
        days: days,
        returnUrl: AppConfig.oauthRedirectUri,
      );

      final uri = Uri.parse(checkout.checkoutUrl);

      if (!mounted) return;

      // Open in-app 180 Pay bottom sheet directly (Web in-DOM or Mobile in-app WebView)
      final paid = await PayBottomSheet.show(
        context,
        checkoutUrl: uri,
        returnUrl: AppConfig.oauthRedirectUri,
      );

      if (paid) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('🎉 Payment successful! Creator access unlocked.'),
              backgroundColor: AppTheme.success,
              duration: const Duration(seconds: 4),
            ),
          );
        }
        await ref.read(sessionProvider.notifier).refreshEntitlement();
      } else {
        // Refresh entitlement in case webhook updated account status before modal was closed
        await ref.read(sessionProvider.notifier).refreshEntitlement();
      }
    } catch (e) {
      // Graceful fallback to external application browser if in-app bottom sheet fails
      try {
        final api = ref.read(socialApiProvider);
        final checkout = await api.createBillingCheckout(
          type: type,
          days: days,
          returnUrl: AppConfig.oauthRedirectUri,
        );
        final uri = Uri.parse(checkout.checkoutUrl);
        if (await canLaunchUrl(uri)) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: const Text('Payment page opened. Pull down to refresh after completing payment.'),
                backgroundColor: AppTheme.primary,
                duration: const Duration(seconds: 5),
              ),
            );
          }
        }
      } catch (fallbackErr) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Could not start checkout: $e'),
              backgroundColor: AppTheme.error,
            ),
          );
        }
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingCheckout = false;
          _activeCheckoutType = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).valueOrNull;
    final ent = session?.entitlement;
    final billing = ent?.creatorBilling;
    final (defaultTitle, defaultBody) = FeatureLockView.copyFor(ent?.lockReason);

    final title = billing?.isTrial == true && billing?.trialDaysRemaining != 0
        ? '3-Day Free Trial'
        : defaultTitle;
    final body = ent?.message ?? defaultBody;

    final rechargeCost = _calculateRechargeAmount(_selectedDays);

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: Column(
          children: [
            // Top Header: Sign out action
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    onPressed: () => ref.read(sessionProvider.notifier).logout(),
                    icon: Icon(Icons.logout_rounded, size: 16, color: AppTheme.textMuted),
                    label: Text(
                      'Sign out',
                      style: TextStyle(
                        color: AppTheme.textMuted,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref.read(sessionProvider.notifier).refreshEntitlement(),
                color: AppTheme.primary,
                backgroundColor: AppTheme.surfaceElevated,
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Top Brand Logo Icon & Badge
                Center(
                  child: Container(
                    width: 76,
                    height: 76,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceElevated,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: AppTheme.primary.withValues(alpha: 0.35),
                        width: 1.5,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.primary.withValues(alpha: 0.25),
                          blurRadius: 24,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Image.asset(
                      'assets/logo/brand_favicon.png',
                      fit: BoxFit.contain,
                      errorBuilder: (context, error, stackTrace) => const Icon(
                        Icons.workspace_premium_rounded,
                        size: 36,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Creator Header
                Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
                    ),
                    child: Text(
                      '180 SOCIAL STUDIO CREATOR',
                      style: TextStyle(
                        color: AppTheme.primary,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                // Title & Description
                Text(
                  title,
                  key: const Key('lock.title'),
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppTheme.textSecondary,
                        height: 1.4,
                      ),
                  textAlign: TextAlign.center,
                ),

                if (session != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    session.user.email,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: AppTheme.textMuted,
                        ),
                    textAlign: TextAlign.center,
                  ),
                ],

                const SizedBox(height: 16),

                // ─── Carousel Page Indicator Dots ───────────────────────────
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _buildPageDot(
                      index: 0,
                      activeColor: AppTheme.primary,
                      isActive: _selectedTab == 0,
                    ),
                    const SizedBox(width: 8),
                    _buildPageDot(
                      index: 1,
                      activeColor: AppTheme.accent,
                      isActive: _selectedTab == 1,
                    ),
                  ],
                ),

                const SizedBox(height: 14),

                // ─── Swipeable Pricing Cards (PageView) ──────────────────────
                AnimatedContainer(
                  duration: const Duration(milliseconds: 260),
                  curve: Curves.easeOutCubic,
                  height: _selectedTab == 0 ? 465 : 510,
                  child: ScrollConfiguration(
                    behavior: ScrollConfiguration.of(context).copyWith(
                      dragDevices: {
                        PointerDeviceKind.touch,
                        PointerDeviceKind.mouse,
                        PointerDeviceKind.trackpad,
                      },
                    ),
                    child: PageView(
                      controller: _pageController,
                      physics: const BouncingScrollPhysics(),
                      onPageChanged: (index) {
                        setState(() => _selectedTab = index);
                      },
                      children: [
                        _buildMonthlyCard(),
                        _buildRechargeCard(rechargeCost),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    ],
  ),
),
);
  }

  Widget _buildPageDot({
    required int index,
    required Color activeColor,
    required bool isActive,
  }) {
    return GestureDetector(
      onTap: () {
        setState(() => _selectedTab = index);
        _pageController.animateToPage(
          index,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeInOutCubic,
        );
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        width: isActive ? 24 : 8,
        height: 8,
        decoration: BoxDecoration(
          color: isActive ? activeColor : AppTheme.border,
          borderRadius: BorderRadius.circular(4),
          boxShadow: isActive
              ? [
                  BoxShadow(
                    color: activeColor.withValues(alpha: 0.4),
                    blurRadius: 6,
                    offset: const Offset(0, 1),
                  ),
                ]
              : null,
        ),
      ),
    );
  }

  Widget _buildMonthlyCard() {
    return Container(
      key: const ValueKey('monthly_card'),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.primary, width: 1.5),
        boxShadow: [
          BoxShadow(
            color: AppTheme.primary.withValues(alpha: 0.12),
            blurRadius: 18,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Text(
                      'MOST POPULAR',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'Cancel anytime',
                  style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  '\$20',
                  style: TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w900,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Text(
                  ' / month',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Direct monthly creator subscription. Automatic recurring billing via 180 Subscriptions.',
              style: TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.3),
            ),
            const SizedBox(height: 14),
            const _FeatureItem(text: 'Full unlimited project & video creation'),
            const _FeatureItem(text: 'AI Script Director & timeline editor'),
            const _FeatureItem(text: 'Autonomous Autopilot & social scheduling'),
            const _FeatureItem(text: 'Direct publishing to Instagram, YouTube & LinkedIn'),
            const SizedBox(height: 16),
            _SlideToPayButton(
              label: 'Slide to Subscribe — \$20/mo',
              hint: '👉 Slide handle right or tap to activate with 180 Pay',
              accentColor: AppTheme.primary,
              icon: Icons.bolt_rounded,
              isLoading: _isLoadingCheckout && _activeCheckoutType == 'monthly',
              onSlideComplete: () => _handleCheckout('monthly'),
            ),
            const SizedBox(height: 10),
            Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.shield_outlined, size: 12, color: AppTheme.textMuted),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      'Opens in-app 180 Pay bottom sheet · Instant activation',
                      style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRechargeCard(double rechargeCost) {
    return Container(
      key: const ValueKey('recharge_card'),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.6), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: AppTheme.accent.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4)),
                  ),
                  child: Text(
                    'PAY AS YOU GO',
                    style: TextStyle(
                      color: AppTheme.accent,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '~ \$0.71 / day',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.accent,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Recharge & Use Pass',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Slide to choose how many days you need. Based on \$20 for 28 days with no ongoing commitment.',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.3),
          ),
          const SizedBox(height: 16),

          // Days duration selector with badge
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  'Duration:',
                  style: TextStyle(fontSize: 14, color: AppTheme.textPrimary, fontWeight: FontWeight.w500),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.accent.withValues(alpha: 0.35)),
                ),
                child: Text(
                  '$_selectedDays Day${_selectedDays > 1 ? 's' : ''}',
                  style: TextStyle(
                    color: AppTheme.accent,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Hint badge for the duration slider
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.accent.withValues(alpha: 0.2)),
            ),
            child: Row(
              children: [
                Icon(Icons.tune_rounded, size: 14, color: AppTheme.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Slide the bar below to customize days (1 to 28 days)',
                    style: TextStyle(
                      fontSize: 11.5,
                      color: AppTheme.textSecondary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),

          // Duration Slider
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: AppTheme.accent,
              inactiveTrackColor: AppTheme.border,
              thumbColor: AppTheme.accent,
              overlayColor: AppTheme.accent.withValues(alpha: 0.2),
              trackHeight: 6,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 10),
            ),
            child: Slider(
              value: _selectedDays.toDouble(),
              min: 1,
              max: 28,
              divisions: 27,
              onChanged: (val) {
                setState(() {
                  _selectedDays = val.round();
                });
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('1 Day (\$0.71)', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
                Text('28 Days (\$20.00)', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Dynamic total amount display box
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppTheme.surfaceElevated,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Total Recharge',
                        style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
                      ),
                      Text(
                        '$_selectedDays Days Access',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '\$${rechargeCost.toStringAsFixed(2)}',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                    color: AppTheme.accent,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          _SlideToPayButton(
            label: 'Slide to Recharge — \$${rechargeCost.toStringAsFixed(2)}',
            hint: '👉 Slide handle right or tap to activate $_selectedDays-day pass',
            accentColor: AppTheme.accent,
            icon: Icons.calendar_today_rounded,
            isLoading: _isLoadingCheckout && _activeCheckoutType == 'recharge',
            onSlideComplete: () => _handleCheckout('recharge', days: _selectedDays),
          ),
          const SizedBox(height: 10),
          Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.bolt_rounded, size: 12, color: AppTheme.textMuted),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    'Opens in-app 180 Pay bottom sheet · No recurring charge',
                    style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  }
}



class _FeatureItem extends StatelessWidget {
  const _FeatureItem({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.check_circle_rounded, size: 16, color: AppTheme.success),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary,
                height: 1.25,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Interactive "Slide to Subscribe / Recharge" slider button.
/// Supports smooth dragging with mouse or touch, progress fill, glowing handle,
/// shimmering chevrons, tap fallback, and haptic feedback.
class _SlideToPayButton extends StatefulWidget {
  const _SlideToPayButton({
    required this.label,
    required this.hint,
    required this.accentColor,
    required this.icon,
    required this.isLoading,
    required this.onSlideComplete,
  });

  final String label;
  final String hint;
  final Color accentColor;
  final IconData icon;
  final bool isLoading;
  final VoidCallback onSlideComplete;

  @override
  State<_SlideToPayButton> createState() => _SlideToPayButtonState();
}

class _SlideToPayButtonState extends State<_SlideToPayButton>
    with TickerProviderStateMixin {
  late final AnimationController _animController;
  late final AnimationController _shimmerController;
  late Animation<double> _slideAnimation;
  double _dragPosition = 0.0;
  bool _isCompleted = false;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 260),
    )..addListener(() {
        setState(() {
          _dragPosition = _slideAnimation.value;
        });
      });

    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();
  }

  @override
  void dispose() {
    _animController.dispose();
    _shimmerController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _SlideToPayButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.isLoading && oldWidget.isLoading && _isCompleted) {
      _resetSlider();
    }
  }

  void _resetSlider() {
    if (mounted) {
      setState(() {
        _isCompleted = false;
        _dragPosition = 0.0;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    const double trackHeight = 52.0;
    const double knobSize = 44.0;
    const double knobMargin = 4.0;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final maxDrag = (constraints.maxWidth - knobSize - (knobMargin * 2))
                .clamp(0.0, double.infinity);
            final progress =
                maxDrag > 0 ? (_dragPosition / maxDrag).clamp(0.0, 1.0) : 0.0;

            return GestureDetector(
              onHorizontalDragUpdate: widget.isLoading || _isCompleted
                  ? null
                  : (details) {
                      if (_animController.isAnimating) _animController.stop();
                      setState(() {
                        _dragPosition =
                            (_dragPosition + details.delta.dx).clamp(0.0, maxDrag);
                      });
                    },
              onHorizontalDragEnd: widget.isLoading || _isCompleted
                  ? null
                  : (details) {
                      final currProgress =
                          maxDrag > 0 ? (_dragPosition / maxDrag) : 0.0;
                      if (currProgress >= 0.78) {
                        setState(() {
                          _dragPosition = maxDrag;
                          _isCompleted = true;
                        });
                        HapticFeedback.mediumImpact();
                        widget.onSlideComplete();
                      } else {
                        _slideAnimation = Tween<double>(
                          begin: _dragPosition,
                          end: 0.0,
                        ).animate(
                          CurvedAnimation(
                            parent: _animController,
                            curve: Curves.easeOutCubic,
                          ),
                        );
                        _animController.forward(from: 0.0);
                      }
                    },
              onTap: widget.isLoading || _isCompleted
                  ? null
                  : () {
                      _slideAnimation = Tween<double>(
                        begin: _dragPosition,
                        end: maxDrag,
                      ).animate(
                        CurvedAnimation(
                          parent: _animController,
                          curve: Curves.easeInOutCubic,
                        ),
                      );
                      _animController.forward(from: 0.0).then((_) {
                        if (mounted) {
                          setState(() {
                            _isCompleted = true;
                          });
                          HapticFeedback.mediumImpact();
                          widget.onSlideComplete();
                        }
                      });
                    },
              child: Container(
                height: trackHeight,
                width: double.infinity,
                decoration: BoxDecoration(
                  color: Color.lerp(
                    widget.accentColor.withValues(alpha: 0.12),
                    widget.accentColor.withValues(alpha: 0.28),
                    progress,
                  ),
                  borderRadius: BorderRadius.circular(trackHeight / 2),
                  border: Border.all(
                    color: widget.accentColor
                        .withValues(alpha: 0.4 + (0.4 * progress)),
                    width: 1.5,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: widget.accentColor
                          .withValues(alpha: 0.15 + (0.2 * progress)),
                      blurRadius: 14,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
                child: Stack(
                  alignment: Alignment.centerLeft,
                  children: [
                    // Filled track behind knob
                    Positioned(
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: (knobMargin + _dragPosition + (knobSize / 2))
                          .clamp(0.0, constraints.maxWidth),
                      child: Container(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(trackHeight / 2),
                          gradient: LinearGradient(
                            colors: [
                              widget.accentColor.withValues(alpha: 0.3),
                              widget.accentColor.withValues(alpha: 0.65),
                            ],
                          ),
                        ),
                      ),
                    ),

                    // Centered Text Label & Shimmer Chevrons
                    Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 50),
                        child: AnimatedBuilder(
                          animation: _shimmerController,
                          builder: (context, child) {
                            final shimmerVal = _shimmerController.value;
                            return Opacity(
                              opacity:
                                  (1.0 - (progress * 1.6)).clamp(0.0, 1.0),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Flexible(
                                    child: Text(
                                      widget.label,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w700,
                                        color: Colors.white,
                                        letterSpacing: 0.3,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  // Animated shimmer chevrons
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: List.generate(3, (i) {
                                      final chevronOpacity =
                                          ((shimmerVal + (i * 0.25)) % 1.0);
                                      return Opacity(
                                        opacity: (0.35 + (0.65 * chevronOpacity))
                                            .clamp(0.0, 1.0),
                                        child: Icon(
                                          Icons.chevron_right_rounded,
                                          size: 16,
                                          color: widget.accentColor,
                                        ),
                                      );
                                    }),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                    ),

                    // Draggable Knob / Handle
                    Positioned(
                      left: knobMargin + _dragPosition,
                      top: knobMargin,
                      child: Container(
                        width: knobSize,
                        height: knobSize,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(
                            colors: [
                              widget.accentColor,
                              Color.lerp(widget.accentColor, Colors.white, 0.2)!,
                            ],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: widget.accentColor.withValues(alpha: 0.5),
                              blurRadius: 10,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Center(
                          child: widget.isLoading
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.2,
                                    color: Colors.white,
                                  ),
                                )
                              : Icon(
                                  _isCompleted
                                      ? Icons.check_rounded
                                      : widget.icon,
                                  size: 22,
                                  color: Colors.white,
                                ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),

        const SizedBox(height: 8),

        // Hint under slider
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.swipe_right_alt_rounded,
                size: 13, color: AppTheme.textMuted),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                widget.hint,
                maxLines: 1,
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
      ],
    );
  }
}
