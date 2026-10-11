import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/platform.dart';

/// "Publishes in 2 h 14 min" for a scheduled post, refreshed every 30 s. When the time passes it calls [onDue]
/// once (the screen reloads the post) and says it is being published.
class PublishCountdown extends StatefulWidget {
  const PublishCountdown({super.key, required this.scheduledFor, this.onDue, this.now});
  final DateTime scheduledFor;
  final VoidCallback? onDue;

  /// Test clock.
  final DateTime Function()? now;

  @override
  State<PublishCountdown> createState() => _PublishCountdownState();
}

class _PublishCountdownState extends State<PublishCountdown> {
  Timer? _timer;
  bool _dueFired = false;

  DateTime get _now => (widget.now ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _tick());
  }

  void _tick() {
    if (!mounted) return;
    setState(() {});
    if (!_dueFired && !_now.isBefore(widget.scheduledFor)) {
      _dueFired = true;
      widget.onDue?.call();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.scheduledFor.difference(_now);
    final text = left.isNegative || left.inSeconds < 30 ? 'Publishing now…' : 'Publishes in ${formatLeft(left)}';
    return Row(children: [
      Icon(Icons.schedule_send_rounded, size: 18, color: AppTheme.primary),
      const SizedBox(width: 6),
      Flexible(child: Text(text, style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.w600))),
    ]);
  }
}

/// "3 d 4 h", "2 h 14 min", "9 min", "< 1 min".
String formatLeft(Duration d) {
  if (d.inDays >= 1) return '${d.inDays} d ${d.inHours % 24} h';
  if (d.inHours >= 1) return '${d.inHours} h ${d.inMinutes % 60} min';
  if (d.inMinutes >= 1) return '${d.inMinutes} min';
  return '< 1 min';
}

/// One row per platform while a publish request is running. The server answers only when every platform is done,
/// so rows show an indeterminate indicator (no invented percentages).
class PublishingProgress extends StatelessWidget {
  const PublishingProgress({super.key, required this.platforms});
  final List<SocialPlatform> platforms;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final pl in platforms)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            Icon(pl.icon, color: pl.color, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text('Posting to ${pl.label}…')),
            const SizedBox(width: 48, child: LinearProgressIndicator()),
          ]),
        ),
    ]);
  }
}
