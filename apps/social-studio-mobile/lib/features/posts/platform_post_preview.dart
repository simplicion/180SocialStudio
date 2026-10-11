import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/platform.dart';

/// Interactive, pixel-faithful preview of how a post renders across social channels.
/// Matches the web platform previews (InstagramFeedPreview, LinkedInPreview, TikTokPreview, YouTubeShortsPreview).
class PlatformPostPreview extends StatefulWidget {
  const PlatformPostPreview({
    super.key,
    required this.caption,
    this.title,
    this.hook,
    this.mediaUrls = const [],
    this.mediaType,
    this.selectedPlatform = SocialPlatform.instagram,
    this.accountName,
    this.username,
    this.avatarUrl,
    this.firstComment,
  });

  final String caption;
  final String? title;
  final String? hook;
  final List<String> mediaUrls;
  final String? mediaType;
  final SocialPlatform selectedPlatform;
  final String? accountName;
  final String? username;
  final String? avatarUrl;
  final String? firstComment;

  @override
  State<PlatformPostPreview> createState() => _PlatformPostPreviewState();
}

class _PlatformPostPreviewState extends State<PlatformPostPreview> {
  late SocialPlatform _platform = widget.selectedPlatform;
  bool _expandedCaption = false;

  static const _supportedPreviewPlatforms = [
    SocialPlatform.instagram,
    SocialPlatform.youtube,
    SocialPlatform.linkedin,
    SocialPlatform.facebook,
    SocialPlatform.x,
  ];

  @override
  void didUpdateWidget(covariant PlatformPostPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedPlatform != widget.selectedPlatform) {
      _platform = widget.selectedPlatform;
    }
  }

  String get _displayAuthor => widget.accountName ?? widget.username ?? '180creator';
  String get _displayHandle => (widget.username != null && widget.username!.isNotEmpty)
      ? (widget.username!.startsWith('@') ? widget.username! : '@${widget.username}')
      : '@$_displayAuthor';
  String get _mediaType => widget.mediaType ?? 'video';

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Platform Switcher Bar
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              for (final p in _supportedPreviewPlatforms)
                Padding(
                  padding: EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    avatar: Icon(p.icon, size: 16, color: _platform == p ? Colors.white : p.color),
                    label: Text(p.label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                    selected: _platform == p,
                    selectedColor: p.color,
                    onSelected: (selected) {
                      if (selected) setState(() => _platform = p);
                    },
                  ),
                ),
            ],
          ),
        ),

        // Device Frame Container
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Center(
            child: Container(
              constraints: BoxConstraints(maxWidth: 380),
              decoration: BoxDecoration(
                color: _platform == SocialPlatform.youtube
                    ? Colors.black
                    : Theme.of(context).cardColor,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Theme.of(context).dividerColor),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.15),
                    blurRadius: 18,
                    offset: Offset(0, 8),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: switch (_platform) {
                SocialPlatform.instagram => _buildInstagramPreview(),
                SocialPlatform.youtube => _buildYouTubeShortsPreview(),
                SocialPlatform.linkedin => _buildLinkedInPreview(),
                SocialPlatform.facebook => _buildFacebookPreview(),
                SocialPlatform.x => _buildTwitterPreview(),
                _ => _buildInstagramPreview(),
              },
            ),
          ),
        ),
      ],
    );
  }

  // ── Instagram Feed Preview ───────────────────────────────────────────────
  Widget _buildInstagramPreview() {
    final hasMedia = widget.mediaUrls.isNotEmpty;
    final firstMedia = widget.mediaUrls.firstOrNull;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Instagram Header
        ListTile(
          dense: true,
          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          leading: Container(
            padding: EdgeInsets.all(2),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: [Color(0xFFF58529), Color(0xFFDD2A7B), Color(0xFF8134AF)],
                begin: Alignment.bottomLeft,
                end: Alignment.topRight,
              ),
            ),
            child: CircleAvatar(
              radius: 16,
              backgroundColor: AppTheme.surfaceElevated,
              backgroundImage: widget.avatarUrl != null ? NetworkImage(widget.avatarUrl!) : null,
              child: widget.avatarUrl == null
                  ? Icon(Icons.person_rounded, size: 16, color: Colors.white)
                  : null,
            ),
          ),
          title: Text(_displayAuthor, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          subtitle: Text('Original audio', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
          trailing: Icon(Icons.more_horiz_rounded, size: 20),
        ),

        // Media Viewport (4:5 vertical feed ratio or fallback)
        AspectRatio(
          aspectRatio: 4 / 5,
          child: Container(
            color: Colors.black,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (hasMedia && firstMedia != null)
                  Image.network(
                    firstMedia,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => _mediaPlaceholder(Icons.videocam_rounded, 'Video / Media attached'),
                  )
                else
                  _mediaPlaceholder(
                    widget.mediaType == 'video' ? Icons.videocam_rounded : Icons.image_rounded,
                    widget.mediaType == 'video' ? 'Reel Video (9:16 / 4:5)' : 'Post Image (1:1 / 4:5)',
                  ),
                Positioned(
                  top: 10,
                  right: 10,
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(_mediaType == 'video' ? Icons.play_arrow_rounded : Icons.photo_library_rounded,
                            size: 14, color: Colors.white),
                        SizedBox(width: 4),
                        Text(_mediaType.toUpperCase(),
                            style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),

        // Action Bar (Heart, Comment, Share, Save)
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Icon(Icons.favorite_border_rounded, size: 22),
              SizedBox(width: 14),
              Icon(Icons.mode_comment_outlined, size: 20),
              SizedBox(width: 14),
              Icon(Icons.send_outlined, size: 20),
              Spacer(),
              Icon(Icons.bookmark_border_rounded, size: 22),
            ],
          ),
        ),

        // Likes & Caption
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Liked by 180workspace and 1,248 others',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
              SizedBox(height: 4),
              RichText(
                maxLines: _expandedCaption ? 100 : 2,
                overflow: TextOverflow.ellipsis,
                text: TextSpan(
                  style: TextStyle(fontSize: 12, color: Theme.of(context).textTheme.bodyMedium?.color),
                  children: [
                    TextSpan(text: '$_displayAuthor ', style: TextStyle(fontWeight: FontWeight.bold)),
                    TextSpan(text: widget.caption.isEmpty ? 'Your post caption goes here...' : widget.caption),
                  ],
                ),
              ),
              if (widget.caption.length > 80 && !_expandedCaption)
                GestureDetector(
                  onTap: () => setState(() => _expandedCaption = true),
                  child: Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Text('more', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
                  ),
                ),
              if (widget.firstComment != null && widget.firstComment!.isNotEmpty) ...[
                SizedBox(height: 6),
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(6)),
                  child: Row(
                    children: [
                      Icon(Icons.reply_rounded, size: 12, color: AppTheme.primary),
                      SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'First comment: ${widget.firstComment}',
                          style: TextStyle(fontSize: 11, fontStyle: FontStyle.italic, color: AppTheme.textSecondary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              SizedBox(height: 10),
            ],
          ),
        ),
      ],
    );
  }


  // ── YouTube Shorts Preview ───────────────────────────────────────────────
  Widget _buildYouTubeShortsPreview() {
    final hasMedia = widget.mediaUrls.isNotEmpty;
    final firstMedia = widget.mediaUrls.firstOrNull;

    return AspectRatio(
      aspectRatio: 9 / 16,
      child: Container(
        color: Colors.black,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (hasMedia && firstMedia != null)
              Image.network(
                firstMedia,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => _mediaPlaceholder(Icons.play_circle_fill_rounded, 'YouTube Shorts Video'),
              )
            else
              _mediaPlaceholder(Icons.play_circle_fill_rounded, 'Shorts 9:16 Player'),

            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Colors.transparent, Colors.black.withValues(alpha: 0.85)],
                    begin: Alignment.center,
                    end: Alignment.bottomCenter,
                  ),
                ),
              ),
            ),

            // Top Bar
            Positioned(
              top: 12,
              left: 14,
              right: 14,
              child: Row(
                children: [
                  Icon(Icons.search_rounded, color: Colors.white),
                  Spacer(),
                  Icon(Icons.camera_alt_outlined, color: Colors.white),
                  SizedBox(width: 14),
                  Icon(Icons.more_vert_rounded, color: Colors.white),
                ],
              ),
            ),

            // Right Action Column
            Positioned(
              right: 8,
              bottom: 20,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _shortsActionIcon(Icons.thumb_up_alt_rounded, '24K'),
                  SizedBox(height: 14),
                  _shortsActionIcon(Icons.thumb_down_alt_rounded, 'Dislike'),
                  SizedBox(height: 14),
                  _shortsActionIcon(Icons.comment_rounded, '412'),
                  SizedBox(height: 14),
                  _shortsActionIcon(Icons.share_rounded, 'Share'),
                  SizedBox(height: 14),
                  _shortsActionIcon(Icons.loop_rounded, 'Remix'),
                ],
              ),
            ),

            // Bottom Info Column
            Positioned(
              left: 12,
              right: 70,
              bottom: 16,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 14,
                        backgroundImage: widget.avatarUrl != null ? NetworkImage(widget.avatarUrl!) : null,
                        child: widget.avatarUrl == null
                            ? Icon(Icons.person, size: 14, color: Colors.white)
                            : null,
                      ),
                      SizedBox(width: 8),
                      Text(_displayHandle,
                          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                      SizedBox(width: 10),
                      Container(
                        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                        child: Text('Subscribe',
                            style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 11)),
                      ),
                    ],
                  ),
                  SizedBox(height: 8),
                  Text(
                    widget.title ?? (widget.caption.isEmpty ? 'Shorts catchy title goes here' : widget.caption),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w500),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── LinkedIn Preview ─────────────────────────────────────────────────────
  Widget _buildLinkedInPreview() {
    final hasMedia = widget.mediaUrls.isNotEmpty;
    final firstMedia = widget.mediaUrls.firstOrNull;

    return Padding(
      padding: EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: AppTheme.surfaceElevated,
                backgroundImage: widget.avatarUrl != null ? NetworkImage(widget.avatarUrl!) : null,
                child: widget.avatarUrl == null ? Icon(Icons.business_rounded, color: AppTheme.primary) : null,
              ),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_displayAuthor, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    Text('Industry Leader • 1st', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                    Row(
                      children: [
                        Text('Just now • ', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                        Icon(Icons.public_rounded, size: 11, color: Theme.of(context).hintColor),
                      ],
                    ),
                  ],
                ),
              ),
              Icon(Icons.more_horiz_rounded, size: 18),
            ],
          ),
          SizedBox(height: 10),
          Text(
            widget.caption.isEmpty ? 'Share professional insights, company milestones, or industry news...' : widget.caption,
            style: TextStyle(fontSize: 12, height: 1.4),
          ),
          SizedBox(height: 10),
          if (hasMedia && firstMedia != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: AspectRatio(
                aspectRatio: 16 / 9,
                child: Image.network(
                  firstMedia,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => _mediaPlaceholder(Icons.article_rounded, 'Media Attachment'),
                ),
              ),
            ),
          Divider(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _linkedInAction(Icons.thumb_up_alt_outlined, 'Like'),
              _linkedInAction(Icons.comment_outlined, 'Comment'),
              _linkedInAction(Icons.repeat_rounded, 'Repost'),
              _linkedInAction(Icons.send_outlined, 'Send'),
            ],
          ),
        ],
      ),
    );
  }

  // ── Facebook Preview ─────────────────────────────────────────────────────
  Widget _buildFacebookPreview() {
    final hasMedia = widget.mediaUrls.isNotEmpty;
    final firstMedia = widget.mediaUrls.firstOrNull;

    return Padding(
      padding: EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundImage: widget.avatarUrl != null ? NetworkImage(widget.avatarUrl!) : null,
                child: widget.avatarUrl == null ? Icon(Icons.person, color: Colors.blue) : null,
              ),
              SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_displayAuthor, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    Row(
                      children: [
                        Text('Just now • ', style: TextStyle(fontSize: 10, color: AppTheme.textMuted)),
                        Icon(Icons.public, size: 11, color: Theme.of(context).hintColor),
                      ],
                    ),
                  ],
                ),
              ),
              Icon(Icons.more_horiz_rounded),
            ],
          ),
          SizedBox(height: 8),
          Text(widget.caption.isEmpty ? 'What\'s on your mind?' : widget.caption, style: TextStyle(fontSize: 13)),
          SizedBox(height: 8),
          if (hasMedia && firstMedia != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: AspectRatio(
                aspectRatio: 16 / 9,
                child: Image.network(firstMedia, fit: BoxFit.cover),
              ),
            ),
          Divider(height: 18),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              Row(children: [Icon(Icons.thumb_up_outlined, size: 18), SizedBox(width: 6), Text('Like', style: TextStyle(fontSize: 12))]),
              Row(children: [Icon(Icons.mode_comment_outlined, size: 18), SizedBox(width: 6), Text('Comment', style: TextStyle(fontSize: 12))]),
              Row(children: [Icon(Icons.share_outlined, size: 18), SizedBox(width: 6), Text('Share', style: TextStyle(fontSize: 12))]),
            ],
          ),
        ],
      ),
    );
  }

  // ── Twitter / X Preview ──────────────────────────────────────────────────
  Widget _buildTwitterPreview() {
    final hasMedia = widget.mediaUrls.isNotEmpty;
    final firstMedia = widget.mediaUrls.firstOrNull;

    return Padding(
      padding: EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 18,
            backgroundImage: widget.avatarUrl != null ? NetworkImage(widget.avatarUrl!) : null,
            child: widget.avatarUrl == null ? Icon(Icons.person) : null,
          ),
          SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(_displayAuthor, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                    SizedBox(width: 4),
                    Text(_displayHandle, style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                    Text(' · now', style: TextStyle(color: AppTheme.textMuted, fontSize: 12)),
                  ],
                ),
                SizedBox(height: 4),
                Text(widget.caption.isEmpty ? 'What is happening?!' : widget.caption, style: TextStyle(fontSize: 13)),
                if (hasMedia && firstMedia != null) ...[
                  SizedBox(height: 8),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: AspectRatio(
                      aspectRatio: 16 / 9,
                      child: Image.network(firstMedia, fit: BoxFit.cover),
                    ),
                  ),
                ],
                SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Icon(Icons.chat_bubble_outline_rounded, size: 16, color: AppTheme.textMuted),
                    Icon(Icons.repeat_rounded, size: 16, color: AppTheme.textMuted),
                    Icon(Icons.favorite_border_rounded, size: 16, color: AppTheme.textMuted),
                    Icon(Icons.bookmark_border_rounded, size: 16, color: AppTheme.textMuted),
                    Icon(Icons.share_outlined, size: 16, color: AppTheme.textMuted),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  Widget _mediaPlaceholder(IconData icon, String label) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 40, color: Colors.white38),
          SizedBox(height: 6),
          Text(label, style: TextStyle(color: Colors.white54, fontSize: 11, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }


  Widget _shortsActionIcon(IconData icon, String label) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: Colors.white, size: 24),
        SizedBox(height: 2),
        Text(label, style: TextStyle(color: Colors.white, fontSize: 10)),
      ],
    );
  }

  Widget _linkedInAction(IconData icon, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppTheme.textSecondary),
        SizedBox(width: 4),
        Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.textSecondary)),
      ],
    );
  }


}
