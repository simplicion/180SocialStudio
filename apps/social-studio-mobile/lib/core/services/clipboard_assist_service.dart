import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_theme.dart';
import '../widgets/common.dart';

/// Service providing user-assisted clipboard operations with feedback.
class ClipboardAssistService {
  ClipboardAssistService._();

  /// Copies raw text to the device clipboard and optionally displays a feedback toast.
  static Future<bool> copyText(
    String text, {
    String? feedbackMessage,
    BuildContext? context,
  }) async {
    try {
      await Clipboard.setData(ClipboardData(text: text));
      if (context != null && context.mounted && feedbackMessage != null) {
        showInfo(context, feedbackMessage, color: AppTheme.success);
      }
      return true;
    } catch (_) {
      if (context != null && context.mounted) {
        showError(context, 'Could not copy to clipboard. Please copy manually.');
      }
      return false;
    }
  }

  /// Copies the platform post caption to the clipboard with an instruction toast.
  static Future<bool> copyCaption(
    String text, {
    required BuildContext context,
    String platformLabel = 'X',
  }) async {
    return copyText(
      text,
      feedbackMessage: 'Caption copied to clipboard — paste it in $platformLabel',
      context: context,
    );
  }

  /// Copies a Reddit post title to the clipboard.
  static Future<bool> copyRedditTitle(
    String title, {
    required BuildContext context,
  }) async {
    return copyText(
      title,
      feedbackMessage: 'Reddit title copied to clipboard',
      context: context,
    );
  }

  /// Copies a Reddit post body to the clipboard.
  static Future<bool> copyRedditBody(
    String body, {
    required BuildContext context,
  }) async {
    return copyText(
      body,
      feedbackMessage: 'Reddit body copied to clipboard',
      context: context,
    );
  }

  /// Copies both Reddit title and body formatted together.
  static Future<bool> copyRedditTitleAndBody({
    required String title,
    required String body,
    required BuildContext context,
  }) async {
    final combined = body.trim().isNotEmpty ? '$title\n\n$body' : title;
    return copyText(
      combined,
      feedbackMessage: 'Reddit Title & Body copied — paste in Reddit',
      context: context,
    );
  }
}
