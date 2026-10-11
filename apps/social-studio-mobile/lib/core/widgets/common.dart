import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../native_engine/media_engine_exception.dart';
import '../network/api_exception.dart';
import '../network/social_api_client.dart';
import '../theme/app_theme.dart';
import 'universal_skeleton.dart';

String errorText(Object error) {
  if (error is ApiException) {
    final issues = error.issues;
    return issues.isEmpty ? error.message : '${error.message}\n• ${issues.join('\n• ')}';
  }
  if (error is DioException) {
    return errorText(ApiException.fromDio(error));
  }
  if (error is MediaEngineException) return error.message;
  if (error is String) return error;
  final str = error.toString().replaceFirst('Exception: ', '');
  if (str.contains('Broken pipe') || str.contains('errno = 32')) {
    return 'Connection was lost during transfer (Broken pipe). Please check your internet connection and try again.';
  }
  return str;
}

void showError(BuildContext context, Object error) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(errorText(error)),
      backgroundColor: AppTheme.error,
      behavior: SnackBarBehavior.floating,
      duration: Duration(seconds: 6),
    ));
}

void showInfo(BuildContext context, String message, {Color? color}) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), backgroundColor: color ?? AppTheme.surfaceElevated, behavior: SnackBarBehavior.floating));
}

void showSuccess(BuildContext context, String message) => showInfo(context, message, color: AppTheme.success);

/// Tells the user whether a write reached the server or is waiting in the offline outbox.
void showMutation(BuildContext context, MutationOutcome outcome, String appliedMessage) {
  if (outcome.queued) {
    showInfo(context, 'Saved offline. It will sync when you are back online.', color: AppTheme.warning);
  } else {
    showInfo(context, appliedMessage, color: AppTheme.success);
  }
}

/// Runs [action], shows its error (never swallowing it), and returns null on failure.
Future<T?> guarded<T>(BuildContext context, Future<T> Function() action) async {
  try {
    return await action();
  } catch (e) {
    if (context.mounted) showError(context, e);
    return null;
  }
}

final _date = DateFormat('EEE d MMM');
final _dateTime = DateFormat('EEE d MMM, HH:mm');

String fmtDate(DateTime? d) => d == null ? '—' : _date.format(d);
String fmtDateTime(DateTime? d) => d == null ? '—' : _dateTime.format(d);

String timeAgo(DateTime? d) {
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inMinutes < 1) return 'now';
  if (diff.inHours < 1) return '${diff.inMinutes}m';
  if (diff.inDays < 1) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  return _date.format(d);
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label});
  final String? label;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 68,
                height: 68,
                child: CircularProgressIndicator(
                  color: AppTheme.primary,
                  strokeWidth: 2.5,
                ),
              ),
              Container(
                width: 44,
                height: 44,
                padding: EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.1),
                      blurRadius: 8,
                    ),
                  ],
                ),
                child: Image.asset(
                  'assets/logo/brand_favicon.png',
                  fit: BoxFit.contain,
                ),
              ),
            ],
          ),
          if (label != null) ...[
            SizedBox(height: 20),
            Text(label!, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
          ],
        ]),
      );
}

bool _canGoHome(BuildContext context) {
  if (GoRouter.maybeOf(context) == null) return false;
  try {
    final loc = GoRouterState.of(context).matchedLocation;
    return loc != '/home' && loc != '/splash' && loc != '/login' && !loc.startsWith('/review/');
  } catch (_) {
    return false;
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry, this.compact = false});
  final Object error;
  final VoidCallback? onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final e = error;
    final notAvailable = e is ApiException && e.kind == ApiErrorKind.notFound;
    final offline = e is ApiException && e.isNetwork;
    final icon = offline
        ? Icons.cloud_off_rounded
        : notAvailable
            ? Icons.construction_rounded
            : Icons.error_outline_rounded;
    final content = Column(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, color: offline || notAvailable ? AppTheme.warning : AppTheme.error, size: compact ? 28 : 40),
      SizedBox(height: 12),
      Text(
        offline
            ? 'You are offline'
            : notAvailable
                ? 'Not available on the server yet'
                : 'Something went wrong',
        style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 16),
        textAlign: TextAlign.center,
      ),
      SizedBox(height: 6),
      Text(errorText(error), style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
      SizedBox(height: 16),
      // Never a dead end: retry where possible, and always a way home (ux-best-practices §2).
      Wrap(alignment: WrapAlignment.center, spacing: 8, runSpacing: 8, children: [
        if (onRetry != null)
          OutlinedButton.icon(onPressed: onRetry, icon: Icon(Icons.refresh_rounded), label: Text('Try again')),
        if (!compact && _canGoHome(context))
          TextButton.icon(onPressed: () => context.go('/home'), icon: Icon(Icons.home_rounded), label: Text('Go to Home')),
      ]),
    ]);
    final announced = Semantics(liveRegion: true, container: true, child: content);
    return compact
        ? Padding(padding: EdgeInsets.all(16), child: announced)
        : Center(child: SingleChildScrollView(padding: EdgeInsets.all(32), child: announced));
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: AppTheme.surfaceElevated,
                shape: BoxShape.circle,
                border: Border.all(color: AppTheme.border),
              ),
              child: Icon(icon, color: AppTheme.textSecondary, size: 28),
            ),
            SizedBox(height: 16),
            Text(title, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 16), textAlign: TextAlign.center),
            if (message != null) ...[
              SizedBox(height: 6),
              Text(message!, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
            ],
            if (actionLabel != null && onAction != null) ...[
              SizedBox(height: 16),
              ElevatedButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ]),
        ),
      );
}

/// Renders an [AsyncValue] with consistent loading / error / empty states.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({
    super.key,
    required this.value,
    required this.builder,
    this.onRetry,
    this.isEmpty,
    this.empty,
    this.loadingLabel,
    this.skeleton = SkeletonType.table,
  });

  final AsyncValue<T> value;
  final SkeletonType skeleton;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;
  final bool Function(T data)? isEmpty;
  final Widget? empty;
  final String? loadingLabel;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      data: (d) => (isEmpty?.call(d) ?? false) && empty != null ? empty! : builder(d),
      // Skeletons, not spinners, for page loads (ui-architecture §5). Long AI jobs pass a label.
      loading: () => loadingLabel != null
          ? LoadingView(label: loadingLabel)
          : SingleChildScrollView(padding: EdgeInsets.all(16), child: UniversalSkeleton(type: skeleton)),
      error: (e, _) => ErrorView(error: e, onRetry: onRetry),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.color, this.icon});
  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 12, color: color), SizedBox(width: 4)],
          // Flexible + ellipsis: a long label shrinks instead of overflowing its parent.
          Flexible(
            child: Text(label,
                maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
          ),
        ]),
      );
}

class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap, this.borderColor});
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) => Material(
        color: AppTheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: borderColor ?? AppTheme.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
      );
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(4, 16, 4, 8),
        child: Row(children: [
          Expanded(
            child: Text(title.toUpperCase(),
                style: TextStyle(
                    color: AppTheme.textMuted, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
          ),
          ?trailing,
        ]),
      );
}

InputDecoration fieldDecoration(String label, {String? hint, Widget? prefix, Widget? suffix, String? helper}) => InputDecoration(
      labelText: label,
      hintText: hint,
      helperText: helper,
      helperMaxLines: 3,
      prefixIcon: prefix,
      suffixIcon: suffix,
      filled: true,
      fillColor: AppTheme.surfaceElevated,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
      enabledBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.border)),
      focusedBorder:
          OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: AppTheme.primary)),
    );

/// Parses a comma/newline separated list typed by the user.
List<String> splitList(String raw) =>
    raw.split(RegExp(r'[,\n]')).map((s) => s.trim()).where((s) => s.isNotEmpty).toList();

Future<bool> confirm(BuildContext context, {required String title, required String message, String action = 'Confirm', bool destructive = false}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: AppTheme.surfaceElevated,
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text('Cancel')),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(action, style: TextStyle(color: destructive ? AppTheme.error : AppTheme.primary)),
        ),
      ],
    ),
  );
  return ok ?? false;
}

Future<String?> promptText(BuildContext context, {required String title, String label = '', String initial = '', String action = 'Save', int maxLines = 1}) {
  return showDialog<String>(
    context: context,
    builder: (ctx) => DialogControllers(
      initial: [initial],
      builder: (ctx, c) => AlertDialog(
        backgroundColor: AppTheme.surfaceElevated,
        title: Text(title),
        content: TextField(controller: c.first, autofocus: true, maxLines: maxLines, decoration: fieldDecoration(label)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, c.first.text.trim()), child: Text(action)),
        ],
      ),
    ),
  );
}

/// Owns a dialog's [TextEditingController]s for the lifetime of the dialog route, so they are
/// disposed after its exit animation rather than when `showDialog` returns (too early).
class DialogControllers extends StatefulWidget {
  const DialogControllers({super.key, this.count = 1, this.initial = const [], required this.builder});
  final int count;
  final List<String> initial;
  final Widget Function(BuildContext context, List<TextEditingController> controllers) builder;

  @override
  State<DialogControllers> createState() => _DialogControllersState();
}

class _DialogControllersState extends State<DialogControllers> {
  late final List<TextEditingController> _controllers = [
    for (var i = 0; i < max(widget.count, widget.initial.length); i++)
      TextEditingController(text: i < widget.initial.length ? widget.initial[i] : ''),
  ];

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _controllers);
}
