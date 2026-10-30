import 'package:url_launcher/url_launcher.dart';
import '../../data/models/platform.dart';

/// Specification of capabilities for a given platform.
class PlatformCapability {
  const PlatformCapability({
    required this.platform,
    required this.userAssistedPublishing,
    required this.apiPublishing,
    required this.canReceiveVideo,
    required this.canReceiveText,
    required this.captionPrefillGuaranteed,
    required this.requiresExternalPostButton,
    required this.maxChars,
    required this.requiresTitle,
    required this.sharesheetSupportsDirectMedia,
    required this.clipboardLabel,
    this.notes,
  });

  final SocialPlatform platform;
  final bool userAssistedPublishing;
  final bool apiPublishing;
  final bool canReceiveVideo;
  final bool canReceiveText;
  final bool captionPrefillGuaranteed;
  final bool requiresExternalPostButton;
  final int maxChars;
  final bool requiresTitle;
  final bool sharesheetSupportsDirectMedia;
  final String clipboardLabel;
  final String? notes;
}

/// Registry of capabilities and platform rules for Instagram, Facebook, YouTube, and LinkedIn.
class PlatformCapabilityRegistry {
  PlatformCapabilityRegistry._();

  /// Static capabilities registry.
  static final Map<SocialPlatform, PlatformCapability> capabilities = {
    SocialPlatform.instagram: PlatformCapability(
      platform: SocialPlatform.instagram,
      userAssistedPublishing: true,
      apiPublishing: true,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false,
      requiresExternalPostButton: true,
      maxChars: 2200,
      requiresTitle: false,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Caption',
      notes: 'Automated 1-click Graph API publishing or manual share sheet handoff.',
    ),
    SocialPlatform.facebook: PlatformCapability(
      platform: SocialPlatform.facebook,
      userAssistedPublishing: true,
      apiPublishing: true,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false,
      requiresExternalPostButton: true,
      maxChars: 63206,
      requiresTitle: false,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Caption',
      notes: 'Automated 1-click Graph API publishing or manual share sheet handoff.',
    ),
    SocialPlatform.youtube: PlatformCapability(
      platform: SocialPlatform.youtube,
      userAssistedPublishing: true,
      apiPublishing: true,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: true,
      requiresExternalPostButton: false,
      maxChars: 5000,
      requiresTitle: true,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Title & Description',
      notes: 'Automated 1-click Google OAuth / YouTube v3 API or manual Studio handoff.',
    ),
    SocialPlatform.linkedin: PlatformCapability(
      platform: SocialPlatform.linkedin,
      userAssistedPublishing: true,
      apiPublishing: true,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: true,
      requiresExternalPostButton: false,
      maxChars: 3000,
      requiresTitle: false,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Caption',
      notes: 'Automated 1-click Community Management API or manual share handoff.',
    ),
  };

  /// Returns the capability specification for a given platform.
  static PlatformCapability getCapabilities(SocialPlatform platform) {
    return capabilities[platform] ??
        PlatformCapability(
          platform: platform,
          userAssistedPublishing: platform.supportsManualPublish,
          apiPublishing: platform.isAutomated,
          canReceiveVideo: true,
          canReceiveText: true,
          captionPrefillGuaranteed: false,
          requiresExternalPostButton: platform.isManualOnly,
          maxChars: 2200,
          requiresTitle: false,
          sharesheetSupportsDirectMedia: true,
          clipboardLabel: 'Caption',
        );
  }

  /// Checks if the native app for the platform is installed and can handle URLs.
  static Future<bool> isAppInstalled(SocialPlatform platform) async {
    try {
      final List<String> schemes;
      switch (platform) {
        case SocialPlatform.instagram:
          schemes = ['instagram://'];
          break;
        case SocialPlatform.facebook:
          schemes = ['fb://', 'facebook://'];
          break;
        case SocialPlatform.youtube:
          schemes = ['vnd.youtube://', 'youtube://'];
          break;
        case SocialPlatform.linkedin:
          schemes = ['linkedin://'];
          break;
        default:
          return false;
      }

      for (final scheme in schemes) {
        if (await canLaunchUrl(Uri.parse(scheme))) {
          return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Returns the primary native launch URI for a given platform.
  static Uri? getNativeAppUri(SocialPlatform platform) {
    switch (platform) {
      case SocialPlatform.instagram:
        return Uri.parse('instagram://app');
      case SocialPlatform.facebook:
        return Uri.parse('fb://feed');
      case SocialPlatform.youtube:
        return Uri.parse('vnd.youtube://');
      case SocialPlatform.linkedin:
        return Uri.parse('linkedin://');
      default:
        return null;
    }
  }

  /// Universal web composer URL builder for supported platforms.
  static Uri getWebComposeUrl(
    SocialPlatform platform, {
    required String text,
    String? title,
    String? subreddit,
  }) {
    switch (platform) {
      case SocialPlatform.instagram:
        return Uri.parse('https://www.instagram.com/');
      case SocialPlatform.facebook:
        return Uri.parse('https://www.facebook.com/');
      case SocialPlatform.youtube:
        return Uri.parse('https://studio.youtube.com/channel/upload');
      case SocialPlatform.linkedin:
        return Uri.parse('https://www.linkedin.com/feed/?shareActive=true&text=${Uri.encodeComponent(text)}');
      default:
        return Uri.parse('https://180workspace.com');
    }
  }
}
