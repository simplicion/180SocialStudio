import 'package:flutter/material.dart';

/// Platforms the backend supports. Anything else is shown as [unknown] rather than
/// being coerced into Instagram.
enum SocialPlatform {
  instagram('instagram', 'Instagram', Icons.camera_alt_rounded, Color(0xFFE1306C)),
  threads('threads', 'Threads', Icons.alternate_email_rounded, Color(0xFFF4F4F5)),
  facebook('facebook', 'Facebook', Icons.facebook_rounded, Color(0xFF1877F2)),
  youtube('youtube', 'YouTube', Icons.play_circle_fill_rounded, Color(0xFFFF0000)),
  linkedin('linkedin', 'LinkedIn', Icons.work_rounded, Color(0xFF0A66C2)),
  x('x', 'X', Icons.tag_rounded, Color(0xFF1D9BF0)),
  pinterest('pinterest', 'Pinterest', Icons.push_pin_rounded, Color(0xFFE60023)),
  reddit('reddit', 'Reddit', Icons.forum_rounded, Color(0xFFFF4500)),
  tiktok('tiktok', 'TikTok', Icons.music_note_rounded, Color(0xFF25F4EE)),
  unknown('unknown', 'Unknown', Icons.public_rounded, Color(0xFF64748B));

  SocialPlatform(this.id, this.label, this.icon, this.color);

  final String id;
  final String label;
  final IconData icon;
  final Color color;

  /// Whether this platform supports automated 1-click publishing via live credentials
  bool get isAutomated =>
      this == SocialPlatform.instagram ||
      this == SocialPlatform.facebook ||
      this == SocialPlatform.threads ||
      this == SocialPlatform.linkedin ||
      this == SocialPlatform.youtube;

  /// Whether this platform operates exclusively via manual pre-filled publishing (no server API credentials)
  bool get isManualOnly =>
      this == SocialPlatform.x ||
      this == SocialPlatform.reddit ||
      this == SocialPlatform.tiktok ||
      this == SocialPlatform.pinterest;

  /// Whether this platform defaults to user-assisted publishing (X, Reddit, TikTok, Pinterest)
  bool get isUserAssisted => isManualOnly;

  /// Whether this platform supports manual pre-filled posting (All known platforms support manual flow)
  bool get supportsManualPublish => this != SocialPlatform.unknown;

  static const connectable = [
    instagram,
    threads,
    facebook,
    youtube,
    linkedin,
    x,
    pinterest,
    reddit,
    tiktok,
  ];

  static SocialPlatform parse(Object? raw) {
    final v = raw?.toString().toLowerCase().trim() ?? '';
    if (v.isEmpty) return unknown;
    if (v.startsWith('insta')) return instagram;
    if (v.startsWith('thread')) return threads;
    if (v.startsWith('face') || v == 'fb' || v == 'meta') return facebook;
    if (v.startsWith('linked')) return linkedin;
    if (v == 'x' || v.startsWith('twit')) return x;
    if (v.startsWith('pin')) return pinterest;
    if (v.startsWith('red')) return reddit;
    if (v.startsWith('tiktok')) return tiktok;
    if (v.startsWith('youtube') || v == 'yt' || v == 'yt_shorts') return youtube;
    return unknown;
  }
}
