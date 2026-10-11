import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';

/// Uploads raw footage to a calendar piece with a progress dialog. Errors keep the dialog's retry path.
Future<void> uploadRawFootage(BuildContext context, WidgetRef ref, String pieceId, String path) async {
  final progress = ValueNotifier<double?>(null);
  final nav = Navigator.of(context, rootNavigator: true);
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => AlertDialog(
      backgroundColor: AppTheme.surfaceElevated,
      title: Text('Uploading footage'),
      content: ValueListenableBuilder<double?>(
        valueListenable: progress,
        builder: (_, v, _) => Column(mainAxisSize: MainAxisSize.min, children: [
          LinearProgressIndicator(value: v, minHeight: 6),
          SizedBox(height: 8),
          Text(v == null ? 'Starting…' : '${(v * 100).round()}%'),
        ]),
      ),
    ),
  );
  try {
    await ref.read(socialApiProvider).uploadPieceRawFootage(pieceId, path,
        onProgress: (sent, total) => progress.value = total > 0 ? sent / total : null);
    nav.pop();
    if (context.mounted) showSuccess(context, 'Footage saved to this piece. Your editor can open it in the studio.');
  } catch (e) {
    nav.pop();
    if (context.mounted) showError(context, e);
  } finally {
    progress.dispose();
  }
}
