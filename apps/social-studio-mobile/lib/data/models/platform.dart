import 'package:flutter/material.dart';

/// Platforms supported by the studio: Instagram, Facebook, YouTube, LinkedIn. Anything else is shown as [unknown].
enum SocialPlatform {
  instagram('instagram', 'Instagram', Icons.camera_alt_rounded, Color(0xFFE1306C)),
  facebook('facebook', 'Facebook', Icons.facebook_rounded, Color(0xFF1877F2)),
  youtube('youtube', 'YouTube', Icons.play_circle_fill_rounded, Color(0xFFFF0000)),
  linkedin('linkedin', 'LinkedIn', Icons.work_rounded, Color(0xFF0A66C2)),
  unknown('unknown', 'Unknown', Icons.public_rounded, Color(0xFF64748B));

  const SocialPlatform(this.id, this.label, this.icon, this.color);

  final String id;
  final String label;
  final IconData icon;
  final Color color;

  /// Whether this platform supports automated 1-click publishing via live credentials
  bool get isAutomated =>
      this == SocialPlatform.instagram ||
      this == SocialPlatform.facebook ||
      this == SocialPlatform.linkedin ||
      this == SocialPlatform.youtube;

  /// Whether this platform operates exclusively via manual pre-filled publishing
  bool get isManualOnly => false;

  /// Whether this platform defaults to user-assisted publishing
  bool get isUserAssisted => isManualOnly;

  /// Whether this platform supports manual pre-filled posting
  bool get supportsManualPublish => this != SocialPlatform.unknown;

  /// Channels available for connecting and publishing
  static const connectable = [
    instagram,
    facebook,
    youtube,
    linkedin,
  ];

  /// Channels that support Inbox conversations / messaging (YouTube has no messaging system)
  static const messagingPlatforms = [
    instagram,
    facebook,
    linkedin,
  ];

  static SocialPlatform parse(Object? raw) {
    final v = raw?.toString().toLowerCase().trim() ?? '';
    if (v.isEmpty) return unknown;
    if (v.startsWith('insta')) return instagram;
    if (v.startsWith('face') || v == 'fb' || v == 'meta') return facebook;
    if (v.startsWith('linked')) return linkedin;
    if (v.startsWith('youtube') || v == 'yt' || v == 'yt_shorts') return youtube;
    return unknown;
  }
}
