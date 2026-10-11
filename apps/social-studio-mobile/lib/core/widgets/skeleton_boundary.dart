import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'universal_skeleton.dart';

/// Container lifecycle boundary adhering strictly to:
/// - .agents/rules/ui-architecture.md: Section 5 (Universal Skeleton Loading & Lifecycle Boundaries)
/// - .agents/rules/ux-best-practices.md: Section 2 (Error Recovery & Accessibility, Empty States)
class SkeletonBoundary extends StatelessWidget {
  final bool loading;
  final String? error;
  final bool empty;
  final SkeletonType skeletonType;
  final Widget children;
  
  // Customization for empty states
  final String? emptyTitle;
  final String? emptyMessage;
  final IconData? emptyIcon;
  final String? emptyActionLabel;
  final VoidCallback? onEmptyAction;

  // Customization for error states
  final VoidCallback? onRetry;
  final VoidCallback? onNavigateHome;

  const SkeletonBoundary({
    super.key,
    required this.loading,
    this.error,
    this.empty = false,
    required this.skeletonType,
    required this.children,
    this.emptyTitle,
    this.emptyMessage,
    this.emptyIcon,
    this.emptyActionLabel,
    this.onEmptyAction,
    this.onRetry,
    this.onNavigateHome,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return UniversalSkeleton(type: skeletonType);
    }

    if (error != null && error!.isNotEmpty) {
      return _buildErrorState(context);
    }

    if (empty) {
      return _buildEmptyState(context);
    }

    return children;
  }

  /// Strict dual-recovery path error state adhering to ux-best-practices.md:12:
  /// "Never show a dead-end error page. Always provide at least two recovery paths."
  Widget _buildErrorState(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: 'Error: $error',
      child: Container(
        margin: EdgeInsets.symmetric(vertical: 16),
        padding: EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppTheme.error.withValues(alpha: 0.3)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.4),
              blurRadius: 16,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: AppTheme.error.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.error_outline_rounded,
                color: AppTheme.error,
                size: 28,
              ),
            ),
            SizedBox(height: 16),
            Text(
              'Something Went Wrong',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: AppTheme.textPrimary,
                letterSpacing: -0.3,
              ),
            ),
            SizedBox(height: 8),
            Text(
              error ?? 'An unexpected network or engine error occurred.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 14,
                color: AppTheme.textSecondary,
                height: 1.4,
              ),
            ),
            SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Primary Recovery Path: Retry
                if (onRetry != null)
                  ElevatedButton.icon(
                    onPressed: onRetry,
                    icon: Icon(Icons.refresh_rounded, size: 18),
                    label: Text('Try Again'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      minimumSize: Size(120, 44), // Strict 44px min touch target
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                if (onRetry != null) SizedBox(width: 12),
                // Secondary Recovery Path: Return to Dashboard
                OutlinedButton.icon(
                  onPressed: onNavigateHome ?? () => Navigator.of(context).maybePop(),
                  icon: Icon(Icons.dashboard_rounded, size: 18),
                  label: Text('Dashboard'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.textSecondary,
                    side: BorderSide(color: AppTheme.border),
                    minimumSize: Size(120, 44), // Strict 44px min touch target
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Empty state adhering to ux-best-practices.md:14:
  /// "When a list is empty, show a beautifully designed empty state with an actionable button to create the first item."
  Widget _buildEmptyState(BuildContext context) {
    return Container(
      margin: EdgeInsets.symmetric(vertical: 24),
      padding: EdgeInsets.all(32),
      decoration: AppTheme.glassCardDecoration(),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
              border: Border.all(color: AppTheme.primary.withValues(alpha: 0.2)),
            ),
            child: Icon(
              emptyIcon ?? Icons.inbox_outlined,
              color: AppTheme.primary,
              size: 32,
            ),
          ),
          SizedBox(height: 18),
          Text(
            emptyTitle ?? 'No Items Found',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimary,
              letterSpacing: -0.3,
            ),
          ),
          SizedBox(height: 8),
          Text(
            emptyMessage ?? 'Get started by creating your first entry right here.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              color: AppTheme.textSecondary,
              height: 1.4,
            ),
          ),
          if (onEmptyAction != null) ...[
            SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: onEmptyAction,
              icon: Icon(Icons.add_rounded, size: 18),
              label: Text(emptyActionLabel ?? 'Create First Item'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                minimumSize: Size(180, 44), // Strict 44px min touch target
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                elevation: 0,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
