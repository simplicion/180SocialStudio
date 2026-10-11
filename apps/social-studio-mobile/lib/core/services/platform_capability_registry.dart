import 'package:url_launcher/url_launcher.dart';

import '../../data/models/platform.dart';

/// Capability metadata describing what publishing features are supported for a platform.
class PlatformCapability {
  PlatformCapability({
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
    this.notes = '',
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
  final String notes;
}

/// Registry for detecting platform availability, capabilities, and web composer URLs.
class PlatformCapabilityRegistry {
  PlatformCapabilityRegistry._();

  /// Static capabilities registry reflecting dual-mode platform realities.
  /// All 9 platforms support userAssistedPublishing (manual pre-filled handoff).
  /// Instagram, Threads, Facebook, YouTube, and LinkedIn also support automated 1-click apiPublishing.
  static final Map<SocialPlatform, PlatformCapability> capabilities = {
    SocialPlatform.instagram: PlatformCapability(
      platform: SocialPlatform.instagram,
      userAssistedPublishing: true,
      apiPublishing: true,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false, // Mobile OS share to IG may discard clipboard text
      requiresExternalPostButton: true,
      maxChars: 2200,
      requiresTitle: false,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Caption',
      notes: 'Automated 1-click Graph API publishing or manual share sheet handoff.',
    ),
    SocialPlatform.threads: PlatformCapability(
      platform: SocialPlatform.threads,
      userAssistedPublishing: true,
      apiPublishing: true,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false,
      requiresExternalPostButton: true,
      maxChars: 500,
      requiresTitle: false,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Caption',
      notes: 'Automated 1-click Graph API publishing or manual web/app handoff.',
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
    SocialPlatform.x: PlatformCapability(
      platform: SocialPlatform.x,
      userAssistedPublishing: true,
      apiPublishing: false,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false, // Discarded on many X versions when video stream is attached
      requiresExternalPostButton: true,
      maxChars: 280,
      requiresTitle: false,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Caption',
      notes: 'Video attached via Sharesheet; caption copied to clipboard as dual handoff.',
    ),
    SocialPlatform.reddit: PlatformCapability(
      platform: SocialPlatform.reddit,
      userAssistedPublishing: true,
      apiPublishing: false,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false, // Reddit ignores EXTRA_TEXT for video composer
      requiresExternalPostButton: true,
      maxChars: 40000,
      requiresTitle: true,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Title & Body',
      notes: 'Video attached via Sharesheet; title and body copied to clipboard.',
    ),
    SocialPlatform.tiktok: PlatformCapability(
      platform: SocialPlatform.tiktok,
      userAssistedPublishing: true,
      apiPublishing: false,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false,
      requiresExternalPostButton: true,
      maxChars: 2200,
      requiresTitle: false,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Caption',
      notes: 'Manual handoff: video shared to TikTok app with caption copied to clipboard.',
    ),
    SocialPlatform.pinterest: PlatformCapability(
      platform: SocialPlatform.pinterest,
      userAssistedPublishing: true,
      apiPublishing: false,
      canReceiveVideo: true,
      canReceiveText: true,
      captionPrefillGuaranteed: false,
      requiresExternalPostButton: true,
      maxChars: 500,
      requiresTitle: true,
      sharesheetSupportsDirectMedia: true,
      clipboardLabel: 'Title & Description',
      notes: 'Manual handoff: pin media shared with title & notes copied to clipboard.',
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
        case SocialPlatform.x:
          schemes = ['twitter://', 'x://'];
          break;
        case SocialPlatform.reddit:
          schemes = ['reddit://'];
          break;
        case SocialPlatform.instagram:
          schemes = ['instagram://'];
          break;
        case SocialPlatform.threads:
          schemes = ['threads://', 'barcelona://'];
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
        case SocialPlatform.tiktok:
          schemes = ['tiktok://', 'snssdk1233://'];
          break;
        case SocialPlatform.pinterest:
          schemes = ['pinterest://'];
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
      case SocialPlatform.x:
        return Uri.parse('twitter://');
      case SocialPlatform.reddit:
        return Uri.parse('reddit://');
      case SocialPlatform.instagram:
        return Uri.parse('instagram://app');
      case SocialPlatform.threads:
        return Uri.parse('threads://');
      case SocialPlatform.facebook:
        return Uri.parse('fb://feed');
      case SocialPlatform.youtube:
        return Uri.parse('vnd.youtube://');
      case SocialPlatform.linkedin:
        return Uri.parse('linkedin://');
      case SocialPlatform.tiktok:
        return Uri.parse('tiktok://');
      case SocialPlatform.pinterest:
        return Uri.parse('pinterest://');
      default:
        return null;
    }
  }

  /// Builds official web composer URL for X with prefilled text.
  static Uri getXWebComposeUrl({required String text}) {
    return Uri.parse('https://x.com/intent/post?text=${Uri.encodeComponent(text)}');
  }

  /// Builds official web submission URL for Reddit with prefilled subreddit, title, and body.
  static Uri getRedditWebComposeUrl({
    String? subreddit,
    required String title,
    String? body,
  }) {
    final sub = (subreddit != null && subreddit.trim().isNotEmpty)
        ? subreddit.trim().replaceFirst(RegExp(r'^/?r/'), '')
        : 'all';
    final q = <String, String>{'title': title};
    if (body != null && body.isNotEmpty) q['text'] = body;
    return Uri.https('www.reddit.com', '/r/$sub/submit', q);
  }

  /// Builds official web composer URL for Threads with prefilled text.
  static Uri getThreadsWebComposeUrl({required String text}) {
    return Uri.parse('https://www.threads.net/intent/post?text=${Uri.encodeComponent(text)}');
  }

  /// Universal web composer URL builder for any platform.
  static Uri getWebComposeUrl(
    SocialPlatform platform, {
    required String text,
    String? title,
    String? subreddit,
  }) {
    switch (platform) {
      case SocialPlatform.x:
        return getXWebComposeUrl(text: text);
      case SocialPlatform.reddit:
        return getRedditWebComposeUrl(subreddit: subreddit, title: title ?? text, body: text);
      case SocialPlatform.threads:
        return getThreadsWebComposeUrl(text: text);
      case SocialPlatform.instagram:
        return Uri.parse('https://www.instagram.com/');
      case SocialPlatform.facebook:
        return Uri.parse('https://www.facebook.com/');
      case SocialPlatform.youtube:
        return Uri.parse('https://studio.youtube.com/channel/upload');
      case SocialPlatform.linkedin:
        return Uri.parse('https://www.linkedin.com/feed/?shareActive=true&text=${Uri.encodeComponent(text)}');
      case SocialPlatform.tiktok:
        return Uri.parse('https://www.tiktok.com/upload');
      case SocialPlatform.pinterest:
        return Uri.parse('https://www.pinterest.com/pin-builder/');
      default:
        return Uri.parse('https://180workspace.com');
    }
  }
}
