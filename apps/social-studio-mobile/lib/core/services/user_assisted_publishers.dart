import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/models/user_assisted_publish_package.dart';
import 'clipboard_assist_service.dart';
import 'platform_capability_registry.dart';

export 'centralized_manual_publisher.dart';

enum HandoffMode {
  nativeShare,
  nativeApp,
  webCompose,
  clipboardOnly,
}

/// Result of a user-assisted handoff operation.
class UserAssistedHandoffResult {
  UserAssistedHandoffResult({
    required this.success,
    required this.mode,
    required this.message,
    this.error,
  });

  final bool success;
  final HandoffMode mode;
  final String message;
  final String? error;
}

/// Publisher handling user-assisted publishing to X (Twitter).
class XUserAssistedPublisher {
  XUserAssistedPublisher._();

  /// Maximum standard character limit for an X post.
  static const int maxStandardChars = 280;

  /// Validates text requirements for X.
  static List<String> validate(XPublishPayload payload) {
    final issues = <String>[];
    if (payload.text.trim().isEmpty) {
      issues.add('Post text cannot be empty for X.');
    }
    if (payload.text.runes.length > maxStandardChars) {
      issues.add('Post text exceeds standard limit of $maxStandardChars characters (${payload.text.runes.length} chars). It may require X Premium.');
    }
    if (!kIsWeb && payload.mediaPath != null && payload.mediaPath!.isNotEmpty) {
      final file = File(payload.mediaPath!);
      if (!file.existsSync()) {
        issues.add('Attached media file does not exist on device.');
      }
    }
    return issues;
  }

  /// Executes user-assisted handoff to X.
  /// Dual handoff: Copies caption to clipboard + opens native Sharesheet or web compose.
  static Future<UserAssistedHandoffResult> publish({
    required BuildContext context,
    required XPublishPayload payload,
    bool preferWeb = false,
  }) async {
    // 1. Dual handoff: Always copy caption to clipboard first
    await ClipboardAssistService.copyCaption(
      payload.text,
      context: context,
      platformLabel: 'X',
    );

    // 2. Web fallback if requested or if native share unavailable
    if (preferWeb) {
      final url = PlatformCapabilityRegistry.getXWebComposeUrl(text: payload.text);
      final launched = await launchUrl(url, mode: LaunchMode.externalApplication);
      if (launched) {
        return UserAssistedHandoffResult(
          success: true,
          mode: HandoffMode.webCompose,
          message: 'Opened X in web browser with prefilled text.',
        );
      }
      return UserAssistedHandoffResult(
        success: false,
        mode: HandoffMode.webCompose,
        message: 'Could not open web browser for X.',
      );
    }

    // 3. Native Android Sharesheet handoff
    try {
      final hasMedia = !kIsWeb && payload.mediaPath != null && payload.mediaPath!.isNotEmpty && File(payload.mediaPath!).existsSync();
      if (hasMedia) {
        await SharePlus.instance.share(
          ShareParams(
            files: [XFile(payload.mediaPath!, mimeType: payload.mimeType)],
            text: payload.text,
          ),
        );
      } else {
        await SharePlus.instance.share(
          ShareParams(text: payload.text),
        );
      }
      return UserAssistedHandoffResult(
        success: true,
        mode: HandoffMode.nativeShare,
        message: 'Content handed off to device sharing sheet.',
      );
    } catch (e) {
      // Fallback to web compose if native share throws an exception
      final url = PlatformCapabilityRegistry.getXWebComposeUrl(text: payload.text);
      final launched = await launchUrl(url, mode: LaunchMode.externalApplication).catchError((_) => false);
      if (launched) {
        return UserAssistedHandoffResult(
          success: true,
          mode: HandoffMode.webCompose,
          message: 'Native share unavailable. Opened X web composer.',
          error: e.toString(),
        );
      }
      return UserAssistedHandoffResult(
        success: false,
        mode: HandoffMode.clipboardOnly,
        message: 'Could not share to X. Caption is saved to clipboard.',
        error: e.toString(),
      );
    }
  }
}
