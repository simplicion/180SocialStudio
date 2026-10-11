import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import '../../data/models/engagement_rule.dart';
import '../../data/models/platform.dart';
import '../../data/models/project.dart';
import '../../data/models/social_account.dart';
import '../../data/models/social_post.dart';
import '../projects/project_provider.dart';
import 'platform_post_preview.dart';
import 'post_providers.dart';

/// Create or edit a post with a clean 2-Step Composer:
/// Step 1: Content, Media & Platform Channel Customization
/// Step 2: Scheduling, Visibility & 180 Auto DM / Comment Funnel
class PostComposerScreen extends ConsumerWidget {
  const PostComposerScreen({
    super.key,
    this.postId,
    this.projectId,
    this.date,
    this.calendarId,
    this.pieceId,
    this.prefill,
  });

  final String? postId;
  final String? projectId;
  final DateTime? date;
  final String? calendarId;
  final String? pieceId;

  /// Initial caption/title/hook, e.g. from a calendar piece, video studio export, or content idea.
  final Json? prefill;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (postId != null) {
      final post = ref.watch(postDetailProvider(postId!));
      return Scaffold(
        appBar: AppBar(title: const Text('Edit post')),
        body: AsyncBody<SocialPost>(
          value: post,
          onRetry: () => ref.invalidate(postDetailProvider(postId!)),
          builder: (p) => _ProjectLoader(
            projectId: p.projectId,
            builder: (project) => _ComposerForm(project: project, existing: p),
          ),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('New post')),
      body: _ProjectLoader(
        projectId: projectId ?? ref.watch(activeProjectProvider).valueOrNull?.id,
        builder: (project) => _ComposerForm(
          project: project,
          date: date,
          calendarId: calendarId,
          pieceId: pieceId,
          prefill: prefill ?? {},
        ),
      ),
    );
  }
}

class _ProjectLoader extends ConsumerWidget {
  const _ProjectLoader({required this.projectId, required this.builder});
  final String? projectId;
  final Widget Function(Project? project) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = projectId;
    if (id == null) return builder(null);
    return AsyncBody<ProjectDetail>(
      value: ref.watch(projectDetailProvider(id)),
      onRetry: () => ref.invalidate(projectDetailProvider(id)),
      builder: (d) => builder(d.project),
    );
  }
}

class _ComposerForm extends ConsumerStatefulWidget {
  const _ComposerForm({
    required this.project,
    this.existing,
    this.date,
    this.calendarId,
    this.pieceId,
    this.prefill = const {},
  });

  final Project? project;
  final SocialPost? existing;
  final DateTime? date;
  final String? calendarId;
  final String? pieceId;
  final Json prefill;

  @override
  ConsumerState<_ComposerForm> createState() => _ComposerFormState();
}

class _ComposerFormState extends ConsumerState<_ComposerForm> {
  late final SocialPost? _p = widget.existing;

  // Step indicator: 0 = Content & Channels, 1 = Schedule & Automation
  int _currentStep = 0;

  late final _title = TextEditingController(text: _p?.title ?? jStr(widget.prefill['title']) ?? '');
  late final _content = TextEditingController(text: _p?.content ?? jStr(widget.prefill['content']) ?? '');
  late final _hook = TextEditingController(text: _p?.hook ?? jStr(widget.prefill['hook']) ?? '');
  late final _firstComment = TextEditingController(text: _p?.firstComment ?? '');
  late DateTime? _scheduledFor = _p?.scheduledFor ?? widget.date;
  late bool _evergreen = _p?.isEvergreen ?? false;
  late String _visibility = _p?.metadata['visibility']?.toString() ?? 'public';

  late final Set<SocialPlatform> _platforms = {
    ...?_p?.platforms,
    ...jStrList(widget.prefill['platforms']).map(SocialPlatform.parse).where((p) => p != SocialPlatform.unknown),
  };

  late final Map<SocialPlatform, String> _platformFormat = {
    for (final v in _p?.variants ?? const <PostVariant>[])
      if (v.platformMeta['format'] != null)
        v.platform: v.platformMeta['format'].toString()
      else if (v.platformMeta['isShort'] == true)
        v.platform: 'short'
      else if (v.platformMeta['instagramFormat'] != null)
        v.platform: v.platformMeta['instagramFormat'].toString()
      else if (v.platformMeta['facebookFormat'] != null)
        v.platform: v.platformMeta['facebookFormat'].toString(),
  };

  late final Map<SocialPlatform, TextEditingController> _variantText = {
    for (final v in _p?.variants ?? const <PostVariant>[]) v.platform: TextEditingController(text: v.customContent ?? ''),
  };

  late final Map<SocialPlatform, TextEditingController> _variantTitle = {
    for (final v in _p?.variants ?? const <PostVariant>[])
      if (v.platformMeta['title'] != null) v.platform: TextEditingController(text: v.platformMeta['title'].toString()),
  };

  late final Map<SocialPlatform, String?> _selectedAccount = {
    for (final v in _p?.variants ?? const <PostVariant>[])
      if (v.socialAccountId != null) v.platform: v.socialAccountId,
  };

  late final List<String> _mediaUrls = [...?_p?.mediaUrls, ...jStrList(widget.prefill['mediaUrls'])];

  static bool _isVideoUrl(String url) {
    final lower = Uri.tryParse(url)?.path.toLowerCase() ?? url.toLowerCase();
    return lower.endsWith('.mp4') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.webm') ||
        lower.endsWith('.m4v') ||
        lower.endsWith('.avi') ||
        lower.endsWith('.mkv') ||
        lower.contains('/video/') ||
        lower.contains('video=true') ||
        lower.contains('format=video');
  }

  /// Automatically deduces media type from attached files:
  /// - 0 files: 'text' (or prefill/existing if editing)
  /// - 1 video file: 'video'
  /// - 1 image file: 'image'
  /// - 2+ files (photos or mixed video + photos): 'carousel'
  String get _detectedMediaType {
    if (_mediaUrls.isEmpty) {
      return _p?.mediaType ?? jStr(widget.prefill['mediaType']) ?? 'video';
    }
    final hasVideo = _mediaUrls.any(_isVideoUrl);
    if (_mediaUrls.length == 1) {
      return hasVideo ? 'video' : 'image';
    }
    return 'carousel';
  }

  String get _mediaType => _detectedMediaType;

  String _effectiveFormatFor(SocialPlatform platform) {
    final configured = _platformFormat[platform];
    if (configured != null) return configured;
    final m = _detectedMediaType;
    switch (platform) {
      case SocialPlatform.youtube:
        return m == 'video' ? 'short' : (m == 'image' || m == 'carousel' || m == 'text' ? 'community' : 'video');
      case SocialPlatform.instagram:
        return m == 'video' ? 'reel' : 'post';
      case SocialPlatform.facebook:
        return m == 'video' ? 'reel' : 'post';
      default:
        return 'post';
    }
  }

  String _formatDisplayName(SocialPlatform platform, String format) {
    switch (platform) {
      case SocialPlatform.youtube:
        return format == 'short' ? 'Short' : format == 'community' ? 'Community' : 'Video';
      case SocialPlatform.instagram:
        return format == 'reel' ? 'Reel' : format == 'story' ? 'Story' : 'Post';
      case SocialPlatform.facebook:
        return format == 'reel' ? 'Reel' : 'Post';
      default:
        return 'Post';
    }
  }
  bool _saving = false;
  double? _uploadProgress;

  // 180 Engagement Automation (Auto DM & Comment Funnel)
  bool _enableEngagement = false;
  late final _engagementKeyword = TextEditingController();
  late final _engagementCommentReply = TextEditingController();
  late final _engagementDmTemplate = TextEditingController();
  bool _engagementAutoLike = true;
  /// The funnel rule already attached to the post being edited (loaded in initState), updated instead of duplicated.
  EngagementRule? _existingFunnel;

  @override
  void initState() {
    super.initState();
    if (_p != null) _loadExistingFunnel(_p.id);
    // Opened from a Studio export: the rendered video is attached right away.
    final local = jStr(widget.prefill['localMediaPath']);
    if (_p == null && local != null && local.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _uploadLocal(XFile(local, mimeType: 'video/mp4'));
      });
    }
  }

  Future<void> _loadExistingFunnel(String postId) async {
    try {
      final rules = await ref.read(socialApiProvider).listEngagementRules(postId: postId);
      final rule = rules.where((r) => r.postId == postId).firstOrNull;
      if (rule == null || !mounted) return;
      setState(() {
        _existingFunnel = rule;
        _enableEngagement = rule.status == 'active';
        _engagementKeyword.text = rule.triggerType == 'comment_any' ? '' : rule.triggerKeywords.join(', ');
        _engagementCommentReply.text = rule.actionPublicReplies.firstOrNull ?? '';
        _engagementDmTemplate.text = rule.actionDmTemplate;
        _engagementAutoLike = rule.actionAutoLike;
      });
    } catch (_) {
      // The editor still works; the funnel section just starts empty. Saving reports any real error.
    }
  }

  /// Comment → DM funnel for [postId]: empty keywords = every comment. Errors are returned, never swallowed.
  Future<Object?> _syncFunnel(String postId, String? projectId) async {
    final api = ref.read(socialApiProvider);
    final existing = _existingFunnel;
    try {
      if (!_enableEngagement) {
        if (existing != null && existing.status == 'active') await api.updateEngagementRule(existing.id, {'status': 'paused'});
        return null;
      }
      final keywords = _engagementKeyword.text.split(RegExp(r'[,\n]')).map((k) => k.trim()).where((k) => k.isNotEmpty).toList();
      final reply = _engagementCommentReply.text.trim();
      final label = _title.text.trim().isNotEmpty ? _title.text.trim() : _content.text.trim();
      final data = {
        'name': 'Comment funnel: ${label.length > 40 ? label.substring(0, 40) : label}',
        'projectId': projectId,
        'postId': postId,
        'status': 'active',
        'triggerType': keywords.isEmpty ? 'comment_any' : 'comment_keyword',
        'triggerKeywords': keywords,
        'matchMode': 'contains',
        'actionAutoLike': _engagementAutoLike,
        'actionPublicReplies': reply.isEmpty ? <String>[] : [reply],
        'actionSendDm': true,
        'actionDmTemplate': _engagementDmTemplate.text.trim(),
        // Follow-up conversations belong to the inbox AI, not to this funnel.
        'actionEnableAiAgent': false,
      };
      if (existing != null) {
        await api.updateEngagementRule(existing.id, data);
      } else {
        _existingFunnel = await api.createEngagementRule(data);
      }
      return null;
    } catch (e) {
      return e;
    }
  }

  @override
  void dispose() {
    for (final c in [
      _title,
      _content,
      _hook,
      _firstComment,
      _engagementKeyword,
      _engagementCommentReply,
      _engagementDmTemplate,
      ..._variantText.values,
      ..._variantTitle.values,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickSchedule() async {
    final now = DateTime.now();
    final initial = _scheduledFor ?? now.add(const Duration(days: 1));
    final d = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 730)),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
    if (t == null || !mounted) return;
    setState(() => _scheduledFor = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  Future<void> _showMediaPickerSheet() async {
    final picker = ImagePicker();
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetCtx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Add Media',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 4),
              Text(
                'Upload photos or video. System automatically detects formats & carousels.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 16),
              ListTile(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                tileColor: AppTheme.surface,
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppTheme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.photo_library_rounded, color: AppTheme.primary),
                ),
                title: const Text('Photos & Images', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                subtitle: const Text('Select single photo or multiple images for a carousel', style: TextStyle(fontSize: 12)),
                trailing: const Icon(Icons.chevron_right_rounded, color: Colors.white38),
                onTap: () async {
                  Navigator.pop(sheetCtx);
                  final List<XFile> files = await picker.pickMultiImage();
                  if (files.isEmpty || !mounted) return;
                  for (final f in files) {
                    if (!mounted) return;
                    await _uploadLocal(f);
                  }
                },
              ),
              const SizedBox(height: 8),
              ListTile(
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                tileColor: AppTheme.surface,
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.videocam_rounded, color: AppTheme.accent),
                ),
                title: const Text('Video', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                subtitle: const Text('Reels, Shorts, long-form videos, or video carousels', style: TextStyle(fontSize: 12)),
                trailing: const Icon(Icons.chevron_right_rounded, color: Colors.white38),
                onTap: () async {
                  Navigator.pop(sheetCtx);
                  final XFile? file = await picker.pickVideo(source: ImageSource.gallery);
                  if (file == null || !mounted) return;
                  await _uploadLocal(file);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Uploads one local file (picked, or the video just exported from Studio) and attaches it to the post.
  Future<void> _uploadLocal(XFile file) async {
    setState(() => _uploadProgress = 0);
    List<int>? bytes;
    if (kIsWeb) {
      bytes = await file.readAsBytes();
      if (!mounted) return;
    }
    final url = await guarded(
      context,
      () => ref.read(socialApiProvider).uploadFile(
        file.path,
        fileBytes: bytes,
        filename: file.name,
        onProgress: (s, t) {
          if (mounted && t > 0) setState(() => _uploadProgress = s / t);
        },
      ),
    );
    if (!mounted) return;
    setState(() {
      _uploadProgress = null;
      if (url != null) _mediaUrls.add(url);
    });
  }

  List<String> _restrictedHits(List<String> forbidden) {
    final text = '${_title.text} ${_content.text} ${_hook.text}'.toLowerCase();
    return forbidden.where((w) => w.trim().isNotEmpty && text.contains(w.toLowerCase())).toList();
  }

  /// What was auto-copied into a platform's fields; an untouched copy keeps following the main title/caption.
  final Map<SocialPlatform, String> _copiedCaption = {};
  final Map<SocialPlatform, String> _copiedTitle = {};

  /// The platform's own text, or null when it should inherit the main field (empty, or the untouched copy).
  String? _ownText(TextEditingController? c, String? copied, String main) {
    final v = c?.text.trim() ?? '';
    return v.isEmpty || v == main || v == copied ? null : v;
  }

  void _openPlatformCustomization(SocialPlatform platform) {
    final captionCtrl = _variantText.putIfAbsent(platform, TextEditingController.new);
    // Refresh an untouched copy so the sheet shows the current main caption/title.
    if (_ownText(captionCtrl, _copiedCaption[platform], _content.text.trim()) == null && _content.text.trim().isNotEmpty) {
      captionCtrl.text = _content.text.trim();
      _copiedCaption[platform] = captionCtrl.text;
    }
    final titleCtrl = _variantTitle.putIfAbsent(platform, TextEditingController.new);
    if (_ownText(titleCtrl, _copiedTitle[platform], _title.text.trim()) == null && _title.text.trim().isNotEmpty) {
      titleCtrl.text = _title.text.trim();
      _copiedTitle[platform] = titleCtrl.text;
    }

    final availableAccounts = (widget.project?.socialAccounts ?? [])
        .where((a) => a.platform == platform && a.isActive)
        .toList();
    final currentAccId = _selectedAccount[platform] ??
        availableAccounts.where((a) => a.isDefault).firstOrNull?.id ??
        availableAccounts.firstOrNull?.id;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _PlatformCustomizationSheet(
        platform: platform,
        globalTitle: _title.text.trim(),
        globalCaption: _content.text.trim(),
        customCaptionController: captionCtrl,
        customTitleController: titleCtrl,
        selectedFormat: _effectiveFormatFor(platform),
        detectedMediaType: _detectedMediaType,
        mediaCount: _mediaUrls.length,
        availableAccounts: availableAccounts,
        selectedAccountId: currentAccId,
        onAccountChanged: (newAccountId) {
          setState(() => _selectedAccount[platform] = newAccountId);
        },
        onFormatChanged: (newFormat) {
          setState(() => _platformFormat[platform] = newFormat);
        },
        onSaved: () {
          setState(() => _platforms.add(platform));
          Navigator.pop(ctx);
        },
        onRemoved: () {
          setState(() {
            _platforms.remove(platform);
            _platformFormat.remove(platform);
            _selectedAccount.remove(platform);
          });
          Navigator.pop(ctx);
        },
      ),
    );
  }

  void _showPreview() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.88,
        maxChildSize: 0.95,
        builder: (_, scroll) => SingleChildScrollView(
          controller: scroll,
          padding: const EdgeInsets.only(bottom: 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
                child: Row(
                  children: [
                    Icon(Icons.devices_rounded, color: AppTheme.primary),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text('Live Cross-Platform Preview', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    ),
                    IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
              ),
              PlatformPostPreview(
                caption: _content.text,
                title: _title.text.isNotEmpty ? _title.text : null,
                mediaUrls: _mediaUrls,
                mediaType: _mediaType,
                selectedPlatform: _platforms.isNotEmpty ? _platforms.first : SocialPlatform.instagram,
                accountName: widget.project?.name ?? '180creator',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _save() async {
    if (_content.text.trim().isEmpty) {
      showError(context, 'The caption cannot be empty.');
      return;
    }
    if (_platforms.isEmpty) {
      showError(context, 'Please select at least one social channel to publish to.');
      return;
    }
    if (_enableEngagement && _engagementDmTemplate.text.trim().isEmpty) {
      showError(context, 'Write the direct message the funnel sends (put your link inside it), or turn the funnel off.');
      return;
    }

    setState(() => _saving = true);
    final project = widget.project;
    final metadata = compact({
      ...?_p?.metadata,
      'hook': _hook.text.trim().isEmpty ? null : _hook.text.trim(),
      'visibility': _visibility,
      'firstComment': _firstComment.text.trim().isEmpty ? null : _firstComment.text.trim(),
    });

    final body = compact({
      'title': _title.text.trim().isEmpty ? null : _title.text.trim(),
      'content': _content.text.trim(),
      'mediaType': _mediaType,
      'mediaUrls': _mediaUrls,
      'scheduledFor': isoOrNull(_scheduledFor),
      'isEvergreen': _evergreen,
      'metadata': metadata,
      'variants': [
        for (final p in _platforms)
          PostVariant(
            platform: p,
            // '' = use the main caption (also when the platform copy was never edited).
            customContent: _ownText(_variantText[p], _copiedCaption[p], _content.text.trim()) ?? '',
            firstComment: metadata['firstComment'] as String?,
            socialAccountId: _selectedAccount[p],
            platformMeta: p == SocialPlatform.youtube
                    ? compact({
                        'title': _ownText(_variantTitle[p], _copiedTitle[p], _title.text.trim()) != null
                            ? _variantTitle[p]!.text.trim()
                            : (_title.text.trim().isNotEmpty ? _title.text.trim() : null),
                        'visibility': _visibility,
                        'format': _platformFormat[p],
                        'isShort': _platformFormat[p] == 'short' ? true : null,
                      })
                    : p == SocialPlatform.instagram
                        ? (_platformFormat[p] != null
                            ? <String, dynamic>{
                                'format': _platformFormat[p]!,
                                'instagramFormat': _platformFormat[p]!,
                              }
                            : const <String, dynamic>{})
                        : p == SocialPlatform.facebook
                            ? (_platformFormat[p] != null
                                ? <String, dynamic>{
                                    'format': _platformFormat[p]!,
                                    'facebookFormat': _platformFormat[p]!,
                                  }
                                : const <String, dynamic>{})
                            : p == SocialPlatform.x
                                // Over 280 characters: published as a numbered thread (each post replies to the last).
                                ? <String, dynamic>{
                                    'publishingMode': 'user_assisted',
                                    if ((_ownText(_variantText[p], _copiedCaption[p], _content.text.trim()) ?? _content.text.trim()).characters.length > 280) 'thread': true,
                                  }
                                : const <String, dynamic>{},
          ).toCreateJson(),
      ],
      if (_p == null) ...{
        'projectId': project?.id,
        'clientId': project?.primaryClientId,
        'calendarId': widget.calendarId,
        'calendarPieceId': widget.pieceId,
      },
    });

    final api = ref.read(socialApiProvider);
    final outcome = await guarded(context, () => _p == null ? api.createPost(body) : api.updatePost(_p.id, body));
    if (!mounted) return;
    setState(() => _saving = false);
    if (outcome == null) return;
    showMutation(context, outcome, _p == null ? 'Post created' : 'Post saved');
    if (project != null) ref.refreshProjectData(project.id);
    if (_p != null) {
      final funnelError = await _syncFunnel(_p.id, project?.id);
      if (!mounted) return;
      if (funnelError != null) showError(context, 'Post saved, but the comment automation was not: ${errorText(funnelError)}');
      ref.refreshPost(_p.id, projectId: project?.id);
      context.pop();
      return;
    }

    final created = jMapOrNull(outcome.data?['post']);
    final id = _p?.id ?? (created == null ? null : jStr(created['id']));

    if (id != null) {
      final funnelError = await _syncFunnel(id, project?.id);
      if (mounted && funnelError != null) {
        showError(context, 'Post created, but the comment automation was not: ${errorText(funnelError)}. Open the post to try again.');
      }
    }

    ref.invalidate(projectPostsProvider);
    if (!mounted) return;
    if (id != null && _p == null) {
      context.pushReplacement('/posts/$id');
    } else {
      context.pop();
    }
  }

  Widget _buildMediaStatusBadge() {
    if (_mediaUrls.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.04),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          children: [
            Icon(Icons.auto_awesome_rounded, size: 14, color: AppTheme.textSecondary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Auto-detect: Attach photos or a video to automatically set post format.',
                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
              ),
            ),
          ],
        ),
      );
    }

    final type = _detectedMediaType;
    final isVideo = type == 'video';
    final isCarousel = type == 'carousel';

    final Color badgeColor = isVideo
        ? AppTheme.accent
        : isCarousel
            ? AppTheme.accentBlue
            : AppTheme.primary;
    final IconData badgeIcon = isVideo
        ? Icons.videocam_rounded
        : isCarousel
            ? Icons.view_carousel_rounded
            : Icons.image_rounded;
    final String label = isVideo
        ? 'Video detected (1 video) • Ready for Reels, Shorts, and Feed'
        : isCarousel
            ? 'Carousel detected (${_mediaUrls.length} files) • Multiple photos & videos'
            : 'Single Photo detected • Ready for Feed & Community posts';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: badgeColor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: badgeColor.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(badgeIcon, size: 16, color: badgeColor),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: badgeColor),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final project = widget.project;
    final accounts = project?.socialAccounts ?? [];
    final voice = project == null ? null : ref.watch(brandVoiceProvider(project.id)).valueOrNull;
    final hits = _restrictedHits(voice?.forbiddenWords ?? []);

    return Column(
      children: [
        // ── 2-Step Progress Stepper Header ──
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            border: Border(bottom: BorderSide(color: Theme.of(context).dividerColor)),
          ),
          child: Row(
            children: [
              Expanded(
                child: _StepTab(
                  stepIndex: 0,
                  title: '1. Content',
                  isActive: _currentStep == 0,
                  isDone: _currentStep > 0,
                  onTap: () => setState(() => _currentStep = 0),
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right_rounded, size: 16, color: Colors.white38),
              const SizedBox(width: 8),
              Expanded(
                child: _StepTab(
                  stepIndex: 1,
                  title: '2. Schedule & Funnel',
                  isActive: _currentStep == 1,
                  isDone: false,
                  onTap: () {
                    if (_content.text.trim().isEmpty) {
                      showError(context, 'Please enter a caption first');
                      return;
                    }
                    setState(() => _currentStep = 1);
                  },
                ),
              ),
            ],
          ),
        ),

        // ── Step Content ──
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
            children: [
              if (project != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Row(
                    children: [
                      Icon(Icons.folder_rounded, size: 16, color: AppTheme.textSecondary),
                      const SizedBox(width: 6),
                      Text(
                        'Project: ',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: AppTheme.textSecondary),
                      ),
                      Expanded(
                        child: Text(
                          project.name,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.textSecondary),
                        ),
                      ),
                    ],
                  ),
                ),

              // ════════════════════════════════════════════
              // STEP 1: CONTENT, MEDIA & CHANNEL ASSIGNMENT
              // ════════════════════════════════════════════
              if (_currentStep == 0) ...[
                // Post Title (Universal)
                TextField(
                  controller: _title,
                  decoration: fieldDecoration(
                    'Title (internal & video title)',
                    hint: 'e.g. 5 AI Video Tricks That Tripled My Engagement',
                  ),
                ),
                const SizedBox(height: 12),

                // Main Caption (Universal)
                TextField(
                  controller: _content,
                  minLines: 5,
                  maxLines: 12,
                  onChanged: (_) => setState(() {}),
                  decoration: fieldDecoration(
                    'Caption *',
                    hint: 'Write your post caption or video description...',
                    helper: '${_content.text.characters.length} characters',
                  ),
                ),

                if (hits.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  StatusChip(
                    label: 'Restricted brand words: ${hits.join(', ')}',
                    color: AppTheme.error,
                    icon: Icons.block_rounded,
                  ),
                ],

                if (voice != null && voice.defaultHashtags.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final h in voice.defaultHashtags)
                        ActionChip(
                          label: Text(h, style: const TextStyle(fontSize: 12)),
                          onPressed: () => setState(() => _content.text = '${_content.text.trimRight()} $h'),
                        ),
                    ],
                  ),
                ],

                const SizedBox(height: 16),

                // Media Attachment with Auto-Detection
                SectionHeader(
                  'Media Files',
                  trailing: TextButton.icon(
                    onPressed: _uploadProgress != null ? null : _showMediaPickerSheet,
                    icon: const Icon(Icons.add_photo_alternate_rounded, size: 16),
                    label: const Text('Add Media'),
                  ),
                ),
                const SizedBox(height: 4),
                _buildMediaStatusBadge(),
                const SizedBox(height: 8),
                for (final url in _mediaUrls)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceElevated,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(_isVideoUrl(url) ? Icons.movie_rounded : Icons.image_rounded, color: AppTheme.primary),
                    ),
                    title: Text(
                      Uri.tryParse(url)?.pathSegments.lastOrNull ?? url,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13),
                    ),
                    trailing: IconButton(
                      icon: const Icon(Icons.close_rounded, size: 18),
                      onPressed: () => setState(() => _mediaUrls.remove(url)),
                    ),
                  ),
                if (_uploadProgress != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: LinearProgressIndicator(value: _uploadProgress),
                  ),

                const SizedBox(height: 16),

                // Channels & Customization Tiles
                SectionHeader(
                  'Target Channels',
                  trailing: TextButton.icon(
                    onPressed: _showPreview,
                    icon: const Icon(Icons.remove_red_eye_rounded, size: 16),
                    label: const Text('Live Preview'),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Select platforms to post to. Tap a channel to customize platform-specific title, description, or format (Reels, Shorts, Community).',
                  style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 12),

                // Channels Grid
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    for (final p in SocialPlatform.connectable)
                      _ChannelTile(
                        platform: p,
                        isSelected: _platforms.contains(p),
                        account: accounts.where((a) => a.id == _selectedAccount[p]).firstOrNull ??
                            accounts.where((a) => a.platform == p && a.isDefault).firstOrNull ??
                            accounts.where((a) => a.platform == p).firstOrNull,
                        hasCustomOverride: _ownText(_variantText[p], _copiedCaption[p], _content.text.trim()) != null ||
                            _ownText(_variantTitle[p], _copiedTitle[p], _title.text.trim()) != null,
                        formatLabel: _platforms.contains(p) ? _formatDisplayName(p, _effectiveFormatFor(p)) : null,
                        onToggle: () {
                          if (_platforms.contains(p)) {
                            setState(() {
                              _platforms.remove(p);
                              _platformFormat.remove(p);
                            });
                          } else {
                            setState(() => _platforms.add(p));
                            _openPlatformCustomization(p);
                          }
                        },
                        onCustomize: () => _openPlatformCustomization(p),
                      ),
                  ],
                ),

                const SizedBox(height: 32),

                // Step 1 Primary Action
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: () {
                      if (_content.text.trim().isEmpty) {
                        showError(context, 'The caption cannot be empty.');
                        return;
                      }
                      if (_platforms.isEmpty) {
                        showError(context, 'Select at least one social channel.');
                        return;
                      }
                      setState(() => _currentStep = 1);
                    },
                    icon: const Icon(Icons.arrow_forward_rounded, size: 18),
                    label: const Text(
                      'Next: Schedule & Funnel',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                    ),
                  ),
                ),
              ],

              // ════════════════════════════════════════════
              // STEP 2: SCHEDULE, VISIBILITY & AUTO-DM FUNNEL
              // ════════════════════════════════════════════
              if (_currentStep == 1) ...[
                // Schedule Mode
                SectionHeader('Publishing Schedule'),
                const SizedBox(height: 8),
                SectionCard(
                  onTap: _pickSchedule,
                  child: Row(
                    children: [
                      Icon(Icons.event_rounded, color: AppTheme.primary),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _scheduledFor == null ? 'Publish Instantly' : 'Scheduled for',
                              style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _scheduledFor == null ? 'Post now upon creating' : fmtDateTime(_scheduledFor),
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                            ),
                          ],
                        ),
                      ),
                      if (_scheduledFor != null)
                        IconButton(
                          tooltip: 'Clear schedule and publish instantly',
                          icon: const Icon(Icons.clear_rounded),
                          onPressed: () => setState(() => _scheduledFor = null),
                        )
                      else
                        OutlinedButton.icon(
                          onPressed: _pickSchedule,
                          icon: const Icon(Icons.calendar_month_rounded, size: 16),
                          label: const Text('Schedule'),
                        ),
                    ],
                  ),
                ),
                if (project != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Timezone: ${project.settings.defaultTimezone}. Posts are scheduled automatically in the background.',
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),

                const SizedBox(height: 16),

                // Post Visibility (YouTube / Video platforms)
                SectionHeader('Visibility & Privacy'),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'public', label: Text('Public'), icon: Icon(Icons.public_rounded)),
                    ButtonSegment(value: 'unlisted', label: Text('Unlisted'), icon: Icon(Icons.lock_clock_rounded)),
                    ButtonSegment(value: 'private', label: Text('Private'), icon: Icon(Icons.lock_outline_rounded)),
                  ],
                  selected: {_visibility},
                  onSelectionChanged: (s) => setState(() => _visibility = s.first),
                ),

                const SizedBox(height: 12),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _evergreen,
                  onChanged: (v) => setState(() => _evergreen = v),
                  title: const Text('Evergreen Re-post Queue'),
                  subtitle: const Text('Allow AI Smart Scheduler to re-post this content periodically'),
                ),

                const SizedBox(height: 20),

                // 180 Engagement Automation (Auto DM & Comment Funnel)
                SectionHeader('180 Auto DM & Comment Funnel'),
                const SizedBox(height: 4),
                Text(
                  'Automatically send direct messages (DMs) with resource links and reply to comments on Instagram & Facebook.',
                  style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                ),
                const SizedBox(height: 10),

                SectionCard(
                  padding: const EdgeInsets.all(14),
                  borderColor: _enableEngagement ? AppTheme.primary.withValues(alpha: 0.5) : AppTheme.borderSubtle,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        value: _enableEngagement,
                        onChanged: (v) => setState(() => _enableEngagement = v),
                        title: const Text('Enable Auto-DM & Comment Funnel', style: TextStyle(fontWeight: FontWeight.bold)),
                        subtitle: const Text('Convert viral comments into qualified leads & delivery in DMs'),
                      ),
                      if (_enableEngagement) ...[
                        const Divider(height: 20),

                        // Trigger Keyword
                        TextField(
                          controller: _engagementKeyword,
                          decoration: fieldDecoration(
                            'Trigger keywords (optional)',
                            hint: 'e.g. GUIDE, SEND. Leave empty to answer every comment',
                          ),
                        ),
                        const SizedBox(height: 12),

                        // Public Comment Reply
                        TextField(
                          controller: _engagementCommentReply,
                          decoration: fieldDecoration(
                            'Comment reply (optional)',
                            hint: 'Posted under the comment, e.g. Sent it to your DMs!',
                          ),
                        ),
                        const SizedBox(height: 12),

                        // Direct Message (DM)
                        TextField(
                          controller: _engagementDmTemplate,
                          minLines: 2,
                          maxLines: 4,
                          decoration: fieldDecoration(
                            'Direct message *',
                            hint: 'Hey {name}! Here is the guide: https://your-site.com/guide',
                          ),
                        ),
                        const SizedBox(height: 8),

                        // Auto-like comment
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _engagementAutoLike,
                          onChanged: (v) => setState(() => _engagementAutoLike = v),
                          title: const Text('Auto-like matching comment', style: TextStyle(fontSize: 13)),
                          subtitle: const Text('Gives an instant like before sending the reply', style: TextStyle(fontSize: 11)),
                        ),
                      ],
                    ],
                  ),
                ),

                const SizedBox(height: 32),

                // Step 2 Submission Actions
                Row(
                  children: [
                    OutlinedButton.icon(
                      onPressed: () => setState(() => _currentStep = 0),
                      icon: const Icon(Icons.arrow_back_rounded, size: 16),
                      label: const Text('Back to Content'),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                        onPressed: _saving ? null : _save,
                        icon: _saving
                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Icon(Icons.send_rounded, size: 18),
                        label: Text(_p != null
                            ? 'Save Changes'
                            : _scheduledFor != null
                                ? 'Schedule Post'
                                : 'Create post'),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

// ───────────────────────────────────────────
// Step Indicator Tab
// ───────────────────────────────────────────
class _StepTab extends StatelessWidget {
  const _StepTab({
    required this.stepIndex,
    required this.title,
    required this.isActive,
    required this.isDone,
    required this.onTap,
  });

  final int stepIndex;
  final String title;
  final bool isActive;
  final bool isDone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isActive ? AppTheme.primary.withValues(alpha: 0.18) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isActive ? AppTheme.primary : (isDone ? AppTheme.success : Colors.transparent),
          ),
        ),
        child: Row(
          children: [
            if (isDone)
              Icon(Icons.check_circle_rounded, size: 14, color: AppTheme.success)
            else
              Container(
                width: 16,
                height: 16,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isActive ? AppTheme.primary : Colors.white24,
                ),
                child: Center(
                  child: Text(
                    '${stepIndex + 1}',
                    style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                ),
              ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: isActive ? FontWeight.bold : FontWeight.w500,
                  color: isActive ? Colors.white : AppTheme.textSecondary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ───────────────────────────────────────────
// Channel Selection & Customization Tile
// ───────────────────────────────────────────
// ───────────────────────────────────────────
// Channel Selection & Customization Tile
// ───────────────────────────────────────────
class _ChannelTile extends StatelessWidget {
  const _ChannelTile({
    required this.platform,
    required this.isSelected,
    this.account,
    required this.hasCustomOverride,
    this.formatLabel,
    required this.onToggle,
    required this.onCustomize,
  });

  final SocialPlatform platform;
  final bool isSelected;
  final dynamic account;
  final bool hasCustomOverride;
  final String? formatLabel;
  final VoidCallback onToggle;
  final VoidCallback onCustomize;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      avatar: Icon(platform.icon, size: 16, color: isSelected ? Colors.white : platform.color),
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              formatLabel != null
                  ? '${platform.label} • $formatLabel${isSelected && account?.username != null ? ' (@${account.username})' : ''}'
                  : (isSelected && account?.username != null ? '${platform.label} (@${account.username})' : platform.label),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (hasCustomOverride) ...[
            const SizedBox(width: 4),
            Container(
              width: 6,
              height: 6,
              decoration: const BoxDecoration(color: Color(0xFF10B981), shape: BoxShape.circle),
            ),
          ],
          if (isSelected) ...[
            const SizedBox(width: 4),
            InkWell(
              onTap: onCustomize,
              child: const Icon(Icons.tune_rounded, size: 14, color: Colors.white70),
            ),
          ],
        ],
      ),
      selected: isSelected,
      selectedColor: platform.color,
      onSelected: (_) => onToggle(),
    );
  }
}

// ───────────────────────────────────────────
// Platform Customization Bottom Sheet & Specifications
// ───────────────────────────────────────────
class _FormatOption {
  const _FormatOption({
    required this.id,
    required this.label,
    required this.icon,
    required this.description,
  });

  final String id;
  final String label;
  final IconData icon;
  final String description;
}

List<_FormatOption> _getPlatformFormatOptions(SocialPlatform platform) {
  switch (platform) {
    case SocialPlatform.youtube:
      return const [
        _FormatOption(
          id: 'short',
          label: '⚡ Short',
          icon: Icons.bolt_rounded,
          description: 'Vertical 9:16 video under 3m. Auto-tags #shorts.',
        ),
        _FormatOption(
          id: 'video',
          label: '📹 Video',
          icon: Icons.videocam_rounded,
          description: 'Standard landscape (16:9) or regular YouTube video.',
        ),
        _FormatOption(
          id: 'community',
          label: '💬 Community',
          icon: Icons.forum_rounded,
          description: 'Text or image announcement for subscribers.',
        ),
      ];
    case SocialPlatform.instagram:
      return const [
        _FormatOption(
          id: 'reel',
          label: '⚡ Reel',
          icon: Icons.movie_filter_rounded,
          description: 'Vertical 9:16 video for Reels feed & Explore recommendations.',
        ),
        _FormatOption(
          id: 'post',
          label: '📸 Carousel / Post',
          icon: Icons.view_carousel_rounded,
          description: 'Feed post with photo(s) or mixed photo & video carousel.',
        ),
        _FormatOption(
          id: 'story',
          label: '📖 Story',
          icon: Icons.auto_stories_rounded,
          description: '24-hour vertical photo or video story.',
        ),
      ];
    case SocialPlatform.facebook:
      return const [
        _FormatOption(
          id: 'reel',
          label: '⚡ Reel',
          icon: Icons.movie_filter_rounded,
          description: 'Vertical short video (3s–90s) for Facebook Reels.',
        ),
        _FormatOption(
          id: 'post',
          label: '📝 Page Post',
          icon: Icons.feed_rounded,
          description: 'Standard Page post, photo album, or long video.',
        ),
      ];
    case SocialPlatform.linkedin:
      return const [
        _FormatOption(
          id: 'post',
          label: '💼 LinkedIn Post',
          icon: Icons.article_rounded,
          description: 'Universal post: text, single image, multi-image, or video.',
        ),
      ];
    case SocialPlatform.threads:
      return const [
        _FormatOption(
          id: 'post',
          label: '🧵 Threads Post',
          icon: Icons.forum_rounded,
          description: 'Universal post: text, photo carousel (up to 10), or video.',
        ),
      ];
    case SocialPlatform.x:
      return const [
        _FormatOption(
          id: 'post',
          label: '🐦 Tweet / Thread',
          icon: Icons.chat_bubble_outline_rounded,
          description: '280-char post (auto-threads if longer) with media.',
        ),
      ];
    default:
      return const [];
  }
}

class _PlatformSpec {
  const _PlatformSpec({
    required this.name,
    required this.mediaTypes,
    required this.aspectRatios,
    required this.maxChars,
    this.maxTitleChars,
    required this.features,
    required this.guidelines,
  });

  final String name;
  final String mediaTypes;
  final String aspectRatios;
  final int maxChars;
  final int? maxTitleChars;
  final List<String> features;
  final String guidelines;

  static _PlatformSpec forPlatform(SocialPlatform platform, [String? format]) {
    switch (platform) {
      case SocialPlatform.instagram:
        if (format == 'reel') {
          return const _PlatformSpec(
            name: 'Instagram Reel',
            mediaTypes: 'Vertical Video (MP4 / MOV)',
            aspectRatios: '9:16 (3s–15 min)',
            maxChars: 2200,
            features: ['Up to 30 hashtags', 'Reels Explore distribution', 'First comment auto-delivery'],
            guidelines: 'Reels receive highest organic reach on Instagram. Use catchy audio and hook viewers in the first 3 seconds.',
          );
        } else if (format == 'story') {
          return const _PlatformSpec(
            name: 'Instagram Story',
            mediaTypes: 'Vertical Photo or Video',
            aspectRatios: '9:16 (Full-screen, 3–60s video)',
            maxChars: 2200,
            features: ['24-hour expiration', 'Direct message replies'],
            guidelines: 'Stories expire after 24 hours. Great for daily updates, behind-the-scenes, and announcements.',
          );
        }
        return const _PlatformSpec(
          name: 'Instagram Post / Carousel',
          mediaTypes: 'Single photo or up to 10 photos & videos',
          aspectRatios: '1:1 (Square) or 4:5 (Portrait)',
          maxChars: 2200,
          features: ['Multi-item carousel (photos & videos)', 'Up to 30 hashtags', 'First comment auto-delivery'],
          guidelines: 'Carousels support photos and videos mixed together. Great for educational carousels and swipeable content.',
        );

      case SocialPlatform.youtube:
        if (format == 'community') {
          return const _PlatformSpec(
            name: 'YouTube Community Post',
            mediaTypes: 'Images (JPEG / PNG) or Text only',
            aspectRatios: '1:1 (Square) or 16:9 Landscape',
            maxChars: 5000,
            features: ['Community tab shelf', 'Subscriber feed alerts', 'Photo polls / updates'],
            guidelines: 'Community posts keep your subscribers engaged between video uploads. Great for text discussions and announcements.',
          );
        } else if (format == 'short') {
          return const _PlatformSpec(
            name: 'YouTube Short',
            mediaTypes: 'Vertical Video (MP4 / MOV / WebM)',
            aspectRatios: '9:16 (Vertical) or 1:1, up to 3 mins',
            maxChars: 5000,
            maxTitleChars: 100,
            features: ['Auto-tagged #shorts', 'Shorts shelf recommendations', 'Title (max 100 chars)'],
            guidelines: 'YouTube Shorts hook viewers in the first 3 seconds. The #shorts hashtag is automatically appended.',
          );
        }
        return const _PlatformSpec(
          name: 'YouTube Video',
          mediaTypes: 'Video (MP4 / MOV / WebM)',
          aspectRatios: '16:9 (Landscape) or standard video',
          maxChars: 5000,
          maxTitleChars: 100,
          features: ['Title (max 100 chars)', 'Description chapters & timestamps', 'Privacy control'],
          guidelines: 'Title and thumbnail are crucial for search & algorithm CTR. Include keywords, links, and hashtags in description.',
        );

      case SocialPlatform.facebook:
        if (format == 'reel') {
          return const _PlatformSpec(
            name: 'Facebook Reel',
            mediaTypes: 'Vertical Video (MP4 / MOV, 3s–90s)',
            aspectRatios: '9:16 (Reels)',
            maxChars: 63206,
            features: ['Facebook Reels feed', 'Algorithm distribution'],
            guidelines: 'Reels are recommended to non-followers across Facebook for maximum organic audience growth.',
          );
        }
        return const _PlatformSpec(
          name: 'Facebook Page Post',
          mediaTypes: 'Photos, Videos, or Status Update',
          aspectRatios: '16:9, 1:1, or photo albums',
          maxChars: 63206,
          maxTitleChars: 255,
          features: ['Page timeline', 'Photo albums', 'Link previews'],
          guidelines: 'Great for community discussions. Videos between 1-3 minutes and photo albums perform exceptionally well.',
        );

      case SocialPlatform.linkedin:
        return const _PlatformSpec(
          name: 'LinkedIn',
          mediaTypes: 'Post text, Image, Video, or PDF Document',
          aspectRatios: '1:1, 16:9, or 4:5',
          maxChars: 3000,
          maxTitleChars: 200,
          features: ['Professional headlines', 'Rich text formatting', '3-5 relevant hashtags'],
          guidelines: 'Focus on professional insights, career learnings, and business value. Spaced-out paragraphs improve read-through.',
        );

      case SocialPlatform.x:
        return const _PlatformSpec(
          name: 'X (Twitter)',
          mediaTypes: 'Up to 4 images, 1 video, or text-only',
          aspectRatios: '16:9 or 1:1',
          maxChars: 280,
          features: ['Concise 280 chars', 'Trending hashtags', 'Thread-ready (auto-splits > 280)'],
          guidelines: 'Keep copy punchy and fast-paced. Over 280 chars will publish as an automated numbered thread.',
        );

      case SocialPlatform.threads:
        return const _PlatformSpec(
          name: 'Threads',
          mediaTypes: 'Up to 10 photos, video (up to 5m), or text',
          aspectRatios: '9:16, 1:1, or 4:5',
          maxChars: 500,
          features: ['500 character limit', 'Conversational tone', 'Instagram identity sync'],
          guidelines: 'Prioritize conversational prompts, community replies, and engaging bite-sized discussions.',
        );

      default:
        return _PlatformSpec(
          name: platform.label,
          mediaTypes: 'Image, Video, or Text',
          aspectRatios: 'Standard',
          maxChars: 2200,
          features: const ['Cross-platform publishing'],
          guidelines: 'Customize your title and caption for this channel.',
        );
    }
  }
}

class _PlatformCustomizationSheet extends StatefulWidget {
  const _PlatformCustomizationSheet({
    required this.platform,
    required this.globalTitle,
    required this.globalCaption,
    required this.customCaptionController,
    required this.customTitleController,
    required this.selectedFormat,
    required this.detectedMediaType,
    required this.mediaCount,
    required this.onFormatChanged,
    required this.onSaved,
    required this.onRemoved,
    this.availableAccounts = const [],
    this.selectedAccountId,
    this.onAccountChanged,
  });

  final SocialPlatform platform;
  final String globalTitle;
  final String globalCaption;
  final TextEditingController customCaptionController;
  final TextEditingController customTitleController;
  final String selectedFormat;
  final String detectedMediaType;
  final int mediaCount;
  final ValueChanged<String> onFormatChanged;
  final VoidCallback onSaved;
  final VoidCallback onRemoved;
  final List<SocialAccount> availableAccounts;
  final String? selectedAccountId;
  final ValueChanged<String?>? onAccountChanged;

  @override
  State<_PlatformCustomizationSheet> createState() => _PlatformCustomizationSheetState();
}

class _PlatformCustomizationSheetState extends State<_PlatformCustomizationSheet> {
  late String _currentFormat = widget.selectedFormat;
  late String? _currentAccountId = widget.selectedAccountId;
  bool _hasManuallyChangedFormat = false;

  @override
  void initState() {
    super.initState();
    if (widget.customCaptionController.text.isEmpty && widget.globalCaption.isNotEmpty) {
      widget.customCaptionController.text = widget.globalCaption;
    }
    if (widget.customTitleController.text.isEmpty && widget.globalTitle.isNotEmpty) {
      widget.customTitleController.text = widget.globalTitle;
    }
    widget.customCaptionController.addListener(_onChanged);
    widget.customTitleController.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.customCaptionController.removeListener(_onChanged);
    widget.customTitleController.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final platform = widget.platform;
    final formatOptions = _getPlatformFormatOptions(platform);
    final spec = _PlatformSpec.forPlatform(platform, _currentFormat);
    final hasTitle = spec.maxTitleChars != null ||
        (platform == SocialPlatform.youtube && _currentFormat != 'community') ||
        platform == SocialPlatform.facebook ||
        platform == SocialPlatform.linkedin;

    final captionLength = widget.customCaptionController.text.characters.length;
    final isOverLimit = captionLength > spec.maxChars;
    final titleLength = widget.customTitleController.text.characters.length;
    final isTitleOverLimit = spec.maxTitleChars != null && titleLength > spec.maxTitleChars!;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      minChildSize: 0.5,
      builder: (ctx, scrollController) => SingleChildScrollView(
        controller: scrollController,
        padding: EdgeInsets.fromLTRB(18, 14, 18, MediaQuery.of(context).viewInsets.bottom + 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            // Sheet Header
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: platform.color.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: platform.color.withValues(alpha: 0.35)),
                  ),
                  child: Icon(platform.icon, color: platform.color, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Customize for ${platform.label}',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                      Text(
                        spec.mediaTypes,
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // Destination Account Selector
            if (widget.availableAccounts.length > 1 || _currentAccountId != null) ...[
              Row(
                children: [
                  const Text('Destination Account', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  if (widget.availableAccounts.length > 1) ...[
                    const SizedBox(width: 6),
                    Text('(${widget.availableAccounts.length} connected)', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                  ],
                ],
              ),
              const SizedBox(height: 8),
              Container(
                decoration: BoxDecoration(
                  color: AppTheme.surface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppTheme.borderSubtle),
                ),
                child: Column(
                  children: [
                    for (final acc in widget.availableAccounts) ...[
                      Builder(
                        builder: (context) {
                          final effectiveId = _currentAccountId ??
                              (widget.availableAccounts.where((a) => a.isDefault).firstOrNull?.id ??
                                  widget.availableAccounts.first.id);
                          final isSelected = effectiveId == acc.id;
                          return InkWell(
                            borderRadius: BorderRadius.circular(10),
                            onTap: () {
                              setState(() => _currentAccountId = acc.id);
                              widget.onAccountChanged?.call(acc.id);
                            },
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 14,
                                    backgroundColor: platform.color.withValues(alpha: 0.2),
                                    foregroundImage: acc.profileImageUrl != null ? NetworkImage(acc.profileImageUrl!) : null,
                                    child: Text(
                                      acc.accountName.isNotEmpty ? acc.accountName[0].toUpperCase() : '?',
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Flexible(
                                              child: Text(
                                                acc.accountName,
                                                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                            if (acc.isDefault) ...[
                                              const SizedBox(width: 6),
                                              StatusChip(label: 'DEFAULT', color: AppTheme.primary),
                                            ],
                                          ],
                                        ),
                                        if (acc.username != null)
                                          Text('@${acc.username}', style: const TextStyle(fontSize: 11, color: Colors.white70)),
                                      ],
                                    ),
                                  ),
                                  Icon(
                                    isSelected ? Icons.radio_button_checked : Icons.radio_button_off,
                                    size: 18,
                                    color: isSelected ? platform.color : AppTheme.textMuted,
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 14),
            ],

            // Publishing Format Selector (if platform has multiple format options)
            if (formatOptions.isNotEmpty) ...[
              Text(
                'Publishing Format',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  for (final opt in formatOptions)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: InkWell(
                          onTap: () {
                            setState(() {
                              _currentFormat = opt.id;
                              _hasManuallyChangedFormat = true;
                            });
                          },
                          borderRadius: BorderRadius.circular(10),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 180),
                            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                            decoration: BoxDecoration(
                              color: _currentFormat == opt.id
                                  ? platform.color.withValues(alpha: 0.22)
                                  : AppTheme.surface,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: _currentFormat == opt.id
                                    ? platform.color
                                    : AppTheme.borderSubtle,
                                width: _currentFormat == opt.id ? 1.5 : 1,
                              ),
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  opt.icon,
                                  size: 18,
                                  color: _currentFormat == opt.id ? platform.color : AppTheme.textSecondary,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  opt.label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: _currentFormat == opt.id ? FontWeight.bold : FontWeight.w500,
                                    color: _currentFormat == opt.id ? Colors.white : AppTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              if ((_currentFormat == 'reel' || _currentFormat == 'short' || _currentFormat == 'video') &&
                  widget.detectedMediaType != 'video' &&
                  widget.detectedMediaType != 'carousel') ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.warning.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.warning.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.warning_amber_rounded, size: 16, color: AppTheme.warning),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${platform.label} format expects a video file. Attach a video in Step 1 or switch to photo/community format.',
                          style: TextStyle(fontSize: 11, color: AppTheme.warning),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 14),
            ],

            // Platform Requirements & Specs Card
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: platform.color.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: platform.color.withValues(alpha: 0.22)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline_rounded, size: 15, color: platform.color),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${spec.name} Requirements & Specs',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: platform.color,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      _RequirementPill(icon: Icons.aspect_ratio_rounded, text: spec.aspectRatios),
                      _RequirementPill(
                        icon: Icons.text_fields_rounded,
                        text: 'Max ${spec.maxChars.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} chars',
                      ),
                      for (final f in spec.features)
                        _RequirementPill(icon: Icons.check_circle_outline_rounded, text: f),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    spec.guidelines,
                    style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, height: 1.35),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Optional Title Override
            if (hasTitle) ...[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    platform == SocialPlatform.youtube
                        ? (_currentFormat == 'short' ? 'YouTube Shorts Title *' : 'YouTube Video Title *')
                        : '${platform.label} Title',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  if (spec.maxTitleChars != null)
                    Text(
                      '$titleLength / ${spec.maxTitleChars}',
                      style: TextStyle(
                        fontSize: 11,
                        color: isTitleOverLimit ? AppTheme.error : AppTheme.textSecondary,
                        fontWeight: isTitleOverLimit ? FontWeight.bold : FontWeight.normal,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              TextField(
                controller: widget.customTitleController,
                decoration: fieldDecoration(
                  platform == SocialPlatform.youtube ? 'Video Title' : '${platform.label} Title',
                  hint: widget.globalTitle.isNotEmpty ? widget.globalTitle : 'Enter title for ${platform.label}',
                ),
              ),
              const SizedBox(height: 14),
            ],

            // Caption / Content Field
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  platform == SocialPlatform.youtube
                      ? (_currentFormat == 'community' ? 'Community Post Message' : 'Video Description')
                      : '${platform.label} Caption',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
                Text(
                  '$captionLength / ${spec.maxChars}',
                  style: TextStyle(
                    fontSize: 11,
                    color: isOverLimit ? AppTheme.error : AppTheme.textSecondary,
                    fontWeight: isOverLimit ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            TextField(
              controller: widget.customCaptionController,
              minLines: 4,
              maxLines: 10,
              decoration: fieldDecoration(
                platform == SocialPlatform.youtube
                    ? (_currentFormat == 'community' ? 'Community Post Message' : 'YouTube Description')
                    : '${platform.label} Caption',
                hint: widget.globalCaption.isNotEmpty ? widget.globalCaption : 'Enter caption for ${platform.label}',
                helper: isOverLimit
                    ? (platform == SocialPlatform.x
                        ? 'Over 280 characters: this goes out as a thread of about ${(captionLength / 270).ceil()} posts.'
                        : 'Over the ${platform.label} character limit. Shorten it before publishing.')
                    : (widget.customCaptionController.text.trim() == widget.globalCaption.trim() && widget.globalCaption.isNotEmpty)
                        ? 'Pre-filled with your post description. Edit if you wish to customize.'
                        : null,
              ),
            ),
            const SizedBox(height: 22),

            // Actions
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: platform.color,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: () {
                if (_hasManuallyChangedFormat) {
                  widget.onFormatChanged(_currentFormat);
                }
                widget.onSaved();
              },
              icon: const Icon(Icons.check_rounded, size: 18),
              label: Text('Save ${platform.label} Settings', style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.error,
                side: BorderSide(color: AppTheme.error.withValues(alpha: 0.3)),
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              onPressed: widget.onRemoved,
              icon: const Icon(Icons.delete_outline_rounded, size: 16),
              label: Text('Remove ${platform.label} from this post'),
            ),
          ],
        ),
      ),
    );
  }
}

class _RequirementPill extends StatelessWidget {
  const _RequirementPill({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 220),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: Colors.white70),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 10, color: Colors.white70, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
