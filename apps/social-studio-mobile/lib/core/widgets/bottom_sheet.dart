import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'common.dart';

/// A reusable, premium BottomSheet component for the entire platform.
/// Features smooth enter/exit animations, drag-to-dismiss, keyboard awareness,
/// and consistent Obsidian/Zinc design tokens matching the design system.
class AppBottomSheet extends StatelessWidget {
  const AppBottomSheet({
    super.key,
    this.title,
    this.subtitle,
    this.icon,
    this.child,
    this.actions,
    this.showCloseButton = true,
    this.showHandle = true,
    this.contentPadding,
    this.maxHeight,
    this.backgroundColor,
  });

  final String? title;
  final String? subtitle;
  final Widget? icon;
  final Widget? child;
  final List<Widget>? actions;
  final bool showCloseButton;
  final bool showHandle;
  final EdgeInsetsGeometry? contentPadding;
  final double? maxHeight;
  final Color? backgroundColor;

  /// Shows an [AppBottomSheet] modal with smooth animation and keyboard awareness.
  static Future<T?> show<T>({
    required BuildContext context,
    String? title,
    String? subtitle,
    Widget? icon,
    Widget? child,
    Widget Function(BuildContext context)? builder,
    List<Widget>? actions,
    bool isDismissible = true,
    bool enableDrag = true,
    bool showCloseButton = true,
    bool showHandle = true,
    double? maxHeight,
    EdgeInsetsGeometry? contentPadding,
    Color? backgroundColor,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withValues(alpha: 0.72),
      isDismissible: isDismissible,
      enableDrag: enableDrag,
      useSafeArea: true,
      builder: (ctx) => AppBottomSheet(
        title: title,
        subtitle: subtitle,
        icon: icon,
        actions: actions,
        showCloseButton: showCloseButton,
        showHandle: showHandle,
        maxHeight: maxHeight,
        contentPadding: contentPadding,
        backgroundColor: backgroundColor,
        child: builder != null ? builder(ctx) : child,
      ),
    );
  }

  /// Replacement for confirmation pop-up dialogs with a smooth bottom sheet.
  static Future<bool> confirm(
    BuildContext context, {
    required String title,
    required String message,
    String action = 'Confirm',
    String cancelText = 'Cancel',
    bool destructive = false,
    IconData? icon,
  }) async {
    final result = await show<bool>(
      context: context,
      title: title,
      icon: Icon(
        icon ?? (destructive ? Icons.warning_amber_rounded : Icons.info_outline_rounded),
        color: destructive ? AppTheme.error : AppTheme.primary,
        size: 24,
      ),
      actions: [
        Expanded(
          child: TextButton(
            style: TextButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: AppTheme.border),
              ),
            ),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(cancelText, style: TextStyle(color: AppTheme.textSecondary)),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: TextButton(
            style: TextButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              backgroundColor: destructive ? AppTheme.error : AppTheme.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(action, style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white)),
          ),
        ),
      ],
      child: Text(
        message,
        style: TextStyle(
          fontSize: 14,
          height: 1.5,
          color: AppTheme.textSecondary,
        ),
      ),
    );
    return result ?? false;
  }

  /// Replacement for prompt/text-input pop-up dialogs with a smooth bottom sheet.
  static Future<String?> prompt(
    BuildContext context, {
    required String title,
    String? subtitle,
    String label = '',
    String initial = '',
    String action = 'Save',
    String cancelText = 'Cancel',
    int maxLines = 1,
    int? maxLength,
    String? hint,
    IconData? icon,
  }) async {
    final controller = TextEditingController(text: initial);
    final result = await show<String>(
      context: context,
      title: title,
      subtitle: subtitle,
      icon: icon != null ? Icon(icon, color: AppTheme.primary, size: 22) : null,
      builder: (ctx) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: controller,
              autofocus: true,
              maxLines: maxLines,
              maxLength: maxLength,
              style: TextStyle(color: AppTheme.textPrimary),
              decoration: fieldDecoration(label.isEmpty ? title : label, hint: hint),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    style: TextButton.styleFrom(
                      minimumSize: const Size.fromHeight(46),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(color: AppTheme.border),
                      ),
                    ),
                    onPressed: () => Navigator.of(ctx).pop(null),
                    child: Text(cancelText, style: TextStyle(color: AppTheme.textSecondary)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextButton(
                    style: TextButton.styleFrom(
                      minimumSize: const Size.fromHeight(46),
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
                    child: Text(action, style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.white)),
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
    controller.dispose();
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final viewInsets = MediaQuery.viewInsetsOf(context);
    final size = MediaQuery.sizeOf(context);
    final effectiveMaxHeight = maxHeight ?? (size.height * 0.88);

    return TweenAnimationBuilder<double>(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
      tween: Tween<double>(begin: 0.0, end: 1.0),
      builder: (context, value, animChild) {
        return Transform.translate(
          offset: Offset(0, 16 * (1 - value)),
          child: Opacity(
            opacity: value,
            child: animChild,
          ),
        );
      },
      child: Container(
        constraints: BoxConstraints(maxHeight: effectiveMaxHeight),
        decoration: BoxDecoration(
          color: backgroundColor ?? AppTheme.surfaceElevated,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          border: Border.all(color: AppTheme.border, width: 1),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.4),
              blurRadius: 24,
              offset: const Offset(0, -6),
            ),
          ],
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: EdgeInsets.only(bottom: viewInsets.bottom),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Top drag handle
                if (showHandle)
                  Center(
                    child: Container(
                      width: 38,
                      height: 4,
                      margin: const EdgeInsets.only(top: 10, bottom: 6),
                      decoration: BoxDecoration(
                        color: AppTheme.textMuted.withValues(alpha: 0.35),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),

                // Header
                if (title != null || showCloseButton)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 12, 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        if (icon != null) ...[
                          icon!,
                          const SizedBox(width: 12),
                        ],
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (title != null)
                                Text(
                                  title!,
                                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: AppTheme.textPrimary,
                                        letterSpacing: -0.2,
                                      ),
                                ),
                              if (subtitle != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  subtitle!,
                                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                        color: AppTheme.textSecondary,
                                      ),
                                ),
                              ],
                            ],
                          ),
                        ),
                        if (showCloseButton)
                          IconButton(
                            icon: const Icon(Icons.close_rounded, size: 20),
                            color: AppTheme.textMuted,
                            tooltip: 'Close',
                            visualDensity: VisualDensity.compact,
                            onPressed: () => Navigator.of(context).pop(),
                          ),
                      ],
                    ),
                  ),

                if (title != null || showCloseButton)
                  Divider(height: 1, color: AppTheme.border),

                // Content body
                Flexible(
                  child: SingleChildScrollView(
                    physics: const BouncingScrollPhysics(),
                    padding: contentPadding ?? const EdgeInsets.fromLTRB(20, 16, 20, 16),
                    child: child ?? const SizedBox.shrink(),
                  ),
                ),

                // Footer actions
                if (actions != null && actions!.isNotEmpty) ...[
                  Divider(height: 1, color: AppTheme.border),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: actions!,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Convenience alias / helper functions
Future<T?> showAppBottomSheet<T>({
  required BuildContext context,
  String? title,
  String? subtitle,
  Widget? icon,
  Widget? child,
  Widget Function(BuildContext context)? builder,
  List<Widget>? actions,
  bool isDismissible = true,
  bool enableDrag = true,
  bool showCloseButton = true,
  bool showHandle = true,
  double? maxHeight,
  EdgeInsetsGeometry? contentPadding,
  Color? backgroundColor,
}) {
  return AppBottomSheet.show<T>(
    context: context,
    title: title,
    subtitle: subtitle,
    icon: icon,
    child: child,
    builder: builder,
    actions: actions,
    isDismissible: isDismissible,
    enableDrag: enableDrag,
    showCloseButton: showCloseButton,
    showHandle: showHandle,
    maxHeight: maxHeight,
    contentPadding: contentPadding,
    backgroundColor: backgroundColor,
  );
}
