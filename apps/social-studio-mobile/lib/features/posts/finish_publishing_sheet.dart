import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/services/centralized_manual_publisher.dart';
import '../../core/services/platform_capability_registry.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/platform.dart';
import '../../data/models/user_assisted_publish_package.dart';

/// Modal bottom sheet allowing users to review prepared copy & media and launch
/// native/web publishing flows for all 9 platforms.
class CentralizedManualPublishSheet extends ConsumerStatefulWidget {
  const CentralizedManualPublishSheet({
    super.key,
    required this.package,
    this.onStatusUpdated,
    this.targetPlatforms,
  });

  final UserAssistedPublishPackage package;
  final void Function(String platform, String status)? onStatusUpdated;
  final Set<SocialPlatform>? targetPlatforms;

  @override
  ConsumerState<CentralizedManualPublishSheet> createState() => _CentralizedManualPublishSheetState();
}

class _CentralizedManualPublishSheetState extends ConsumerState<CentralizedManualPublishSheet> with WidgetsBindingObserver {
  late final Map<SocialPlatform, UniversalPlatformPayload> _payloads = {};
  late final Map<SocialPlatform, TextEditingController> _controllers = {};
  late final Map<SocialPlatform, TextEditingController> _titleControllers = {};
  late final Map<SocialPlatform, TextEditingController> _metaControllers = {};

  final Map<SocialPlatform, String> _statuses = {};
  String? _pendingPlatformHandoff;
  bool _isPublishing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    final p = widget.package;
    final targets = widget.targetPlatforms ?? _getAvailablePlatforms(p);

    for (final platform in targets) {
      UniversalPlatformPayload? payload = p.platformPayloads[platform];

      // Backwards compatibility for X & Reddit
      if (payload == null && platform == SocialPlatform.x && p.xPayload != null) {
        payload = UniversalPlatformPayload(
          platform: SocialPlatform.x,
          caption: p.xPayload!.text,
          mediaPath: p.xPayload!.mediaPath,
          mimeType: p.xPayload!.mimeType,
        );
      } else if (payload == null && platform == SocialPlatform.reddit && p.redditPayload != null) {
        payload = UniversalPlatformPayload(
          platform: SocialPlatform.reddit,
          caption: p.redditPayload!.body ?? '',
          title: p.redditPayload!.title,
          subreddit: p.redditPayload!.subreddit,
          mediaPath: p.redditPayload!.mediaPath,
          mimeType: p.redditPayload!.mimeType,
        );
      }
      payload ??= UniversalPlatformPayload(
        platform: platform,
        caption: p.caption ?? '',
        title: p.title,
        mediaPath: p.mediaPath,
        mimeType: p.mimeType,
      );

      _payloads[platform] = payload;
      _controllers[platform] = TextEditingController(text: payload.caption);
      if (PlatformCapabilityRegistry.getCapabilities(platform).requiresTitle) {
        _titleControllers[platform] = TextEditingController(text: payload.title ?? '');
      }
      if (platform == SocialPlatform.reddit) {
        _metaControllers[platform] = TextEditingController(text: payload.subreddit ?? 'socialmedia');
      }
      _statuses[platform] = 'ready';
    }
  }

  Set<SocialPlatform> _getAvailablePlatforms(UserAssistedPublishPackage p) {
    final s = <SocialPlatform>{};
    if (p.xPayload != null) s.add(SocialPlatform.x);
    if (p.redditPayload != null) s.add(SocialPlatform.reddit);
    s.addAll(p.platformPayloads.keys);
    if (s.isEmpty) s.add(SocialPlatform.x); // fallback
    return s;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final c in _controllers.values) {
      c.dispose();
    }
    for (final c in _titleControllers.values) {
      c.dispose();
    }
    for (final c in _metaControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _pendingPlatformHandoff != null) {
      final platform = _pendingPlatformHandoff!;
      _pendingPlatformHandoff = null;
      Future.microtask(() => _promptReturnConfirmation(platform));
    }
  }

  Future<void> _updateStatus(String platform, String status, {String? externalUrl}) async {
    widget.onStatusUpdated?.call(platform, status);
    setState(() {
      final plat = SocialPlatform.parse(platform);
      if (plat != SocialPlatform.unknown) {
        _statuses[plat] = status;
      }
    });
    try {
      await ref.read(socialApiProvider).updateAssistedPublishStatus(
            widget.package.id,
            platform: platform,
            status: status,
            externalUrl: externalUrl,
            platformMeta: {
              if (platform == 'reddit' && _metaControllers[SocialPlatform.reddit] != null)
                'subreddit': _metaControllers[SocialPlatform.reddit]!.text.trim(),
            },
          );
    } catch (_) {
      // Backend status update is non-blocking for mobile user flow
    }
  }

  Future<void> _promptReturnConfirmation(String platform) async {
    if (!mounted) return;
    await PostPublishReturnDialog.show(
      context,
      platform: platform.toUpperCase(),
      onConfirm: (status) async {
        await _updateStatus(platform, status);
        if (mounted && status == 'user_confirmed') {
          showInfo(context, 'Marked $platform as posted!', color: AppTheme.success);
        }
      },
    );
  }

  Future<void> _postOnPlatform(SocialPlatform platform, {bool preferWeb = false}) async {
    final cap = PlatformCapabilityRegistry.getCapabilities(platform);
    final text = _controllers[platform]?.text.trim() ?? '';
    final title = _titleControllers[platform]?.text.trim();
    final subreddit = _metaControllers[platform]?.text.trim();

    if (cap.requiresTitle && (title == null || title.isEmpty)) {
      showError(context, 'Post title is required for ${platform.label}.');
      return;
    }

    if (!cap.requiresTitle && text.isEmpty) {
      showError(context, 'Post caption cannot be empty for ${platform.label}.');
      return;
    }

    final origPayload = _payloads[platform]!;
    final payload = UniversalPlatformPayload(
      platform: platform,
      caption: text,
      title: title,
      mediaPath: origPayload.mediaPath,
      mimeType: origPayload.mimeType,
      subreddit: platform == SocialPlatform.reddit ? subreddit : null,
      sourceContentId: widget.package.id,
      projectId: widget.package.projectId,
    );

    setState(() {
      _isPublishing = true;
      _pendingPlatformHandoff = platform.id;
    });

    final result = await CentralizedManualPublisher.publish(
      context: context,
      payload: payload,
      preferWeb: preferWeb,
    );

    if (mounted) {
      setState(() => _isPublishing = false);
      if (result.success) {
        await _updateStatus(platform.id, 'handed_off');
        if (!mounted) return;
        showInfo(
          context,
          preferWeb
              ? 'Opening ${platform.label} in browser…'
              : result.message,
          color: AppTheme.success,
        );
      } else {
        showError(context, result.message);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final mediaExists = !kIsWeb &&
        widget.package.mediaPath != null &&
        widget.package.mediaPath!.isNotEmpty &&
        File(widget.package.mediaPath!).existsSync();
    final fileName = widget.package.mediaPath?.split(RegExp(r'[\\/]')).lastOrNull ?? 'Attached media';

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.9,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Modal Grab Handle
            Center(
              child: Container(
                margin: EdgeInsets.only(top: 12, bottom: 8),
                width: 44,
                height: 5,
                decoration: BoxDecoration(
                  color: AppTheme.primary,
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),

            // Header Bar
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Finish Publishing',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.bold,
                                color: AppTheme.textPrimary,
                              ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'User-assisted publishing hub',
                          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: Icon(Icons.close_rounded, color: AppTheme.textSecondary),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
            ),

            Divider(color: AppTheme.borderSubtle, height: 1),

            // Scrollable Content
            Flexible(
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Media banner indicator
                    if (mediaExists) ...[
                      Container(
                        padding: EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppTheme.surfaceElevated,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.border),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.video_library_rounded, color: AppTheme.accentBlue, size: 20),
                            SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                fileName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 12, color: AppTheme.textPrimary),
                              ),
                            ),
                            Text(
                              'Ready for handoff',
                              style: TextStyle(fontSize: 11, color: AppTheme.success, fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(height: 16),
                    ],

                    // Dynamic Platforms List
                    for (final platform in _payloads.keys) ...[
                      _buildPlatformCard(platform),
                      SizedBox(height: 20),
                    ],

                    // Honest Platform Disclosure
                    Container(
                      padding: EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceElevated,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.borderSubtle),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.verified_user_outlined, size: 16, color: AppTheme.textMuted),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '180 Workspace never automatically clicks the final platform Post button. You review and confirm publication in the native app.',
                              style: TextStyle(fontSize: 11, color: AppTheme.textMuted, height: 1.4),
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: 12),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlatformCard(SocialPlatform platform) {
    final cap = PlatformCapabilityRegistry.getCapabilities(platform);
    final controller = _controllers[platform];
    final titleController = _titleControllers[platform];
    final metaController = _metaControllers[platform];
    
    final charCount = controller?.text.runes.length ?? 0;
    final isOverLimit = charCount > cap.maxChars;
    final status = _statuses[platform] ?? 'ready';

    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceElevated,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isOverLimit ? AppTheme.warning.withValues(alpha: 0.5) : AppTheme.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceElevated,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.primary),
                ),
                child: Icon(Icons.share_rounded, size: 18, color: AppTheme.textPrimary),
              ),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Post on ${platform.label}',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: AppTheme.textPrimary),
                ),
              ),
              if (status != 'ready')
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: status == 'user_confirmed' ? AppTheme.success.withValues(alpha: 0.2) : AppTheme.accentBlue.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    status == 'user_confirmed' ? 'Confirmed' : 'Handed Off',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: status == 'user_confirmed' ? AppTheme.success : AppTheme.accentBlue,
                    ),
                  ),
                ),
              if (status == 'ready' && !cap.requiresTitle)
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: isOverLimit ? AppTheme.warning.withValues(alpha: 0.2) : AppTheme.surfaceElevated,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '$charCount / ${cap.maxChars}',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: isOverLimit ? AppTheme.warning : AppTheme.textSecondary,
                    ),
                  ),
                ),
            ],
          ),
          if (isOverLimit) ...[
            SizedBox(height: 8),
            Text(
              'Caption exceeds ${cap.maxChars} characters.',
              style: TextStyle(fontSize: 11, color: AppTheme.warning),
            ),
          ],
          SizedBox(height: 12),
          
          if (platform == SocialPlatform.reddit && metaController != null) ...[
            TextField(
              controller: metaController,
              style: TextStyle(fontSize: 13, color: AppTheme.textPrimary),
              decoration: InputDecoration(
                prefixText: 'r/ ',
                prefixStyle: TextStyle(color: Color(0xFFFF4500), fontWeight: FontWeight.bold),
                labelText: 'Target Subreddit',
                labelStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                filled: true,
                fillColor: AppTheme.surfaceElevated,
                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: AppTheme.borderSubtle),
                ),
              ),
            ),
            SizedBox(height: 10),
          ],

          if (cap.requiresTitle && titleController != null) ...[
            TextField(
              controller: titleController,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
              decoration: InputDecoration(
                labelText: 'Title (Required)',
                labelStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                filled: true,
                fillColor: AppTheme.surfaceElevated,
                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: AppTheme.borderSubtle),
                ),
              ),
            ),
            SizedBox(height: 10),
          ],

          if (controller != null) ...[
            TextField(
              controller: controller,
              maxLines: 4,
              minLines: 2,
              style: TextStyle(fontSize: 13, color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: 'Caption…',
                labelText: cap.requiresTitle ? 'Description / Body' : 'Caption',
                labelStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                hintStyle: TextStyle(color: AppTheme.textMuted),
                filled: true,
                fillColor: AppTheme.surfaceElevated,
                contentPadding: EdgeInsets.all(12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: AppTheme.borderSubtle),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: AppTheme.borderSubtle),
                ),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ],
          
          SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTheme.textPrimary,
                    foregroundColor: AppTheme.surface,
                    padding: EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: _isPublishing ? null : () => _postOnPlatform(platform, preferWeb: false),
                  icon: Icon(Icons.open_in_new_rounded, size: 16),
                  label: Text('Post on ${platform.label}', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ),
              SizedBox(width: 8),
              IconButton(
                tooltip: 'Open Web Composer',
                icon: Icon(Icons.language_rounded, size: 18),
                style: IconButton.styleFrom(
                  backgroundColor: AppTheme.surfaceElevated,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: BorderSide(color: AppTheme.border),
                  ),
                ),
                onPressed: _isPublishing ? null : () => _postOnPlatform(platform, preferWeb: true),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Dialog asking the user for confirmation when returning from an external platform app.
class PostPublishReturnDialog extends StatelessWidget {
  const PostPublishReturnDialog({
    super.key,
    required this.platform,
    required this.onConfirm,
  });

  final String platform;
  final Future<void> Function(String status) onConfirm;

  static Future<void> show(
    BuildContext context, {
    required String platform,
    required Future<void> Function(String status) onConfirm,
  }) {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => PostPublishReturnDialog(
        platform: platform,
        onConfirm: onConfirm,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppTheme.surfaceElevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      title: Text('Did you publish on $platform?'),
      content: Text(
        '180 Workspace cannot independently verify posts published through external apps. Please let us know if your post went live.',
        style: TextStyle(fontSize: 13, color: AppTheme.textSecondary, height: 1.4),
      ),
      actions: [
        TextButton(
          onPressed: () async {
            Navigator.pop(context);
            await onConfirm('user_cancelled');
          },
          child: Text('Cancel', style: TextStyle(color: AppTheme.textMuted)),
        ),
        TextButton(
          onPressed: () async {
            Navigator.pop(context);
            await onConfirm('ready_to_publish');
          },
          child: Text('Not yet', style: TextStyle(color: AppTheme.accentBlue)),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: AppTheme.success,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          onPressed: () async {
            Navigator.pop(context);
            await onConfirm('user_confirmed');
          },
          child: Text('Yes, I posted'),
        ),
      ],
    );
  }
}
