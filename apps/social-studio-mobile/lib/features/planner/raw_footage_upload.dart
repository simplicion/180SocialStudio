import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';

/// Uploads raw footage to a calendar piece with a progress dialog. Errors keep the dialog's retry path.
Future<void> uploadRawFootage(BuildContext context, WidgetRef ref, String pieceId, String path) async {
  final progress = ValueNotifier<double?>(null);
  final nav = Navigator.of(context, rootNavigator: true);
  AppBottomSheet.show<void>(
    context: context,
    isDismissible: false,
    enableDrag: false,
    showCloseButton: false,
    title: 'Uploading footage',
    icon: Icon(Icons.cloud_upload_rounded, color: AppTheme.primary, size: 22),
    builder: (_) => ValueListenableBuilder<double?>(
      valueListenable: progress,
      builder: (_, v, _) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: v, minHeight: 6),
          ),
          const SizedBox(height: 12),
          Text(
            v == null ? 'Starting…' : '${(v * 100).round()}% completed',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
        ],
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
