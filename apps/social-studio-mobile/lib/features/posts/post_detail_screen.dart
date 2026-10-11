import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/poll_backoff.dart';
import '../../core/widgets/common.dart';
import '../../data/models/platform.dart';
import '../../data/models/social_account.dart';
import '../../data/models/social_post.dart';
import '../../data/models/user_assisted_publish_package.dart';
import '../projects/project_provider.dart';
import 'finish_publishing_sheet.dart';
import 'platform_post_preview.dart';
import 'publish_status.dart';
import 'thumbnail_designer_sheet.dart';
import 'post_providers.dart';

Future<void> openExternal(BuildContext context, String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null || !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
    if (context.mounted) showError(context, 'Could not open $url');
  }
}

void _showPostPreview(BuildContext context, SocialPost post) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.surface,
    builder: (ctx) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (_, scroll) => SingleChildScrollView(
        controller: scroll,
        padding: EdgeInsets.only(bottom: 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 8, 8),
              child: Row(
                children: [
                  Icon(Icons.devices_rounded, color: AppTheme.primary),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text('Platform Preview', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ),
                  IconButton(icon: Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                ],
              ),
            ),
            PlatformPostPreview(
              caption: post.content,
              title: post.title,
              hook: post.hook,
              mediaUrls: post.mediaUrls.isNotEmpty ? post.mediaUrls : [if (post.finalVideoUrl != null) post.finalVideoUrl!],
              mediaType: post.mediaType,
              selectedPlatform: post.platforms.firstOrNull ?? SocialPlatform.instagram,
              accountName: post.accountName ?? post.projectName,
              firstComment: post.firstComment,
            ),
          ],
        ),
      ),
    ),
  );
}

/// A single post: content, variants, publishing state, review comments, footage and editing.
class PostDetailScreen extends ConsumerWidget {
  const PostDetailScreen({super.key, required this.postId});
  final String postId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final post = ref.watch(postDetailProvider(postId));
    return Scaffold(
      appBar: AppBar(
        title: Text(post.valueOrNull?.displayTitle ?? 'Post', overflow: TextOverflow.ellipsis),
        actions: [
          if (post.hasValue) ...[
            IconButton(
              tooltip: 'Platform Preview',
              icon: Icon(Icons.remove_red_eye_rounded),
              onPressed: () => _showPostPreview(context, post.value!),
            ),
            IconButton(
              tooltip: 'Edit',
              icon: Icon(Icons.edit_rounded),
              onPressed: () => context.push('/posts/$postId/edit'),
            ),
          ],
        ],
      ),
      body: AsyncBody<SocialPost>(
        value: post,
        onRetry: () => ref.invalidate(postDetailProvider(postId)),
        builder: (p) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(postDetailProvider(postId)),
          child: _PostBody(post: p),
        ),
      ),
    );
  }
}

class _PostBody extends ConsumerStatefulWidget {
  const _PostBody({required this.post});
  final SocialPost post;

  @override
  ConsumerState<_PostBody> createState() => _PostBodyState();
}

class _PostBodyState extends ConsumerState<_PostBody> {
  String? _busy;
  double? _progress;
  /// Platforms of a publish request in flight (shown as live rows).
  List<SocialPlatform>? _publishing;
  Timer? _poll;
  int _polls = 0;

  SocialPost get p => widget.post;

  /// Instagram/Facebook videos finish processing after the request returns: keep reloading until they settle.
  bool get _inFlight =>
      p.status == PostStatus.publishing || p.variants.any((v) => v.status == 'publishing' || v.status == 'processing');

  @override
  void initState() {
    super.initState();
    _schedulePoll();
  }

  @override
  void didUpdateWidget(covariant _PostBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    _schedulePoll();
  }

  void _schedulePoll() {
    _poll?.cancel();
    if (!_inFlight) {
      _polls = 0;
      return;
    }
    _poll = Timer(pollDelay(_polls++), () {
      if (mounted) _refresh();
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  void _refresh() {
    ref.refreshPost(p.id, projectId: p.projectId);
    if (p.projectId != null) ref.refreshProjectData(p.projectId!);
  }

  Future<void> _run(String label, Future<void> Function() action) async {
    setState(() => _busy = label);
    await guarded(context, action);
    if (mounted) setState(() => _busy = null);
  }

  Future<void> _openCentralizedManualPublishSheet() async {
    final xVariant = p.variants.where((v) => v.platform == SocialPlatform.x).firstOrNull;
    final videoUrl = p.finalVideoUrl ?? p.mediaUrls.where((u) => u.endsWith('.mp4')).firstOrNull ?? p.mediaUrls.firstOrNull;

    final Map<SocialPlatform, UniversalPlatformPayload> payloads = {};
    for (final v in p.variants) {
      payloads[v.platform] = UniversalPlatformPayload(
        platform: v.platform,
        caption: v.customContent?.isNotEmpty == true ? v.customContent! : p.content,
        title: v.platformMeta['title']?.toString() ?? p.title,
        mediaPath: videoUrl,
        projectId: p.projectId,
      );
    }

    final package = UserAssistedPublishPackage(
      id: p.id,
      projectId: p.projectId ?? '',
      calendarItemId: p.calendarPieceId,
      mediaPath: videoUrl,
      title: p.title,
      caption: p.content,
      platformPayloads: payloads,
      xPayload: XPublishPayload(
        text: xVariant?.customContent?.isNotEmpty == true ? xVariant!.customContent! : p.content,
        mediaPath: videoUrl,
        projectId: p.projectId,
      ),
    );

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CentralizedManualPublishSheet(
        package: package,
        targetPlatforms: p.platforms.toSet(), // Show all platforms if they open the hub!
        onStatusUpdated: (platform, status) => _refresh(),
      ),
    );
    _refresh();
  }

  Future<bool> _pickAccountForPlatform(SocialPlatform platform) async {
    final api = ref.read(socialApiProvider);
    List<SocialAccount> accounts = [];
    try {
      accounts = await api.listAccounts(projectId: p.projectId);
      accounts = accounts.where((a) => a.platform == platform && a.isActive).toList();
    } catch (e) {
      if (mounted) showError(context, 'Could not fetch accounts: $e');
      return false;
    }

    if (!mounted) return false;

    if (accounts.isEmpty) {
      final connect = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppTheme.surfaceElevated,
          title: Text('No ${platform.label} Account Connected'),
          content: Text(
            'No active ${platform.label} account is connected to this project. Would you like to connect one in Workspace Settings?',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Go to Accounts'),
            ),
          ],
        ),
      );
      if (connect == true && mounted && p.projectId != null) {
        context.push('/projects/${p.projectId}/accounts');
      }
      return false;
    }

    final variant = p.variants.where((v) => v.platform == platform).firstOrNull;
    final currentAccountId = variant?.socialAccountId;

    final selected = await showModalBottomSheet<SocialAccount>(
      context: context,
      backgroundColor: AppTheme.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
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
              Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: platform.color.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(platform.icon, color: platform.color, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Choose ${platform.label} Account', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        Text('Multiple accounts connected; select destination', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: accounts.length,
                  separatorBuilder: (c, i) => const SizedBox(height: 8),
                  itemBuilder: (_, idx) {
                    final acc = accounts[idx];
                    final isCurrent = acc.id == currentAccountId;
                    return ListTile(
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                        side: BorderSide(color: isCurrent ? platform.color : Colors.white12),
                      ),
                      tileColor: isCurrent ? platform.color.withValues(alpha: 0.1) : AppTheme.surface,
                      leading: CircleAvatar(
                        backgroundColor: platform.color.withValues(alpha: 0.2),
                        foregroundImage: acc.profileImageUrl != null ? NetworkImage(acc.profileImageUrl!) : null,
                        child: Text(acc.accountName.isNotEmpty ? acc.accountName[0].toUpperCase() : '?'),
                      ),
                      title: Row(
                        children: [
                          Flexible(child: Text(acc.accountName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14), overflow: TextOverflow.ellipsis)),
                          if (acc.isDefault) ...[
                            const SizedBox(width: 6),
                            StatusChip(label: 'DEFAULT', color: AppTheme.primary),
                          ],
                        ],
                      ),
                      subtitle: acc.username != null ? Text('@${acc.username}', style: const TextStyle(fontSize: 12)) : null,
                      trailing: isCurrent ? Icon(Icons.check_circle_rounded, color: platform.color) : const Icon(Icons.chevron_right_rounded, color: Colors.white38),
                      onTap: () => Navigator.pop(ctx, acc),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (selected == null || !mounted) return false;

    setState(() => _busy = 'assign');
    try {
      await api.assignVariantAccount(p.id, platform.id, selected.id);
      _refresh();
      if (mounted) {
        showInfo(context, '${selected.accountName} assigned for ${platform.label}', color: AppTheme.success);
      }
      return true;
    } catch (e) {
      if (mounted) showError(context, 'Failed to assign account: $e');
      return false;
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _publish() => _run('publish', () async {
        final api = ref.read(socialApiProvider);
        final assistedPlatforms = p.platforms.where((pl) => pl.isUserAssisted).toList();
        final apiPlatforms = p.platforms.where((pl) => !pl.isUserAssisted).toList();

        if (apiPlatforms.isEmpty && assistedPlatforms.isNotEmpty) {
          await _openCentralizedManualPublishSheet();
          return;
        }

        // Action Sheet for Dual-Mode Choice
        final mode = await showModalBottomSheet<String>(
          context: context,
          backgroundColor: AppTheme.surfaceElevated,
          builder: (ctx) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Publishing Mode', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                ),
                ListTile(
                  leading: Icon(Icons.flash_on_rounded, color: AppTheme.primary),
                  title: Text('Auto-Publish (1-Click)'),
                  subtitle: Text('Post automatically via API to connected platforms.'),
                  onTap: () => Navigator.pop(ctx, 'auto'),
                ),
                ListTile(
                  leading: Icon(Icons.pan_tool_alt_rounded, color: AppTheme.accentBlue),
                  title: Text('Manual Pre-filled Post'),
                  subtitle: Text('Open centralized manual hub to post manually.'),
                  onTap: () => Navigator.pop(ctx, 'manual'),
                ),
                SizedBox(height: 8),
              ],
            ),
          ),
        );

        if (mode == null) return;
        if (mode == 'manual') {
          await _openCentralizedManualPublishSheet();
          return;
        }

        final readiness = await api.validatePublish(p.id);
        if (!mounted) return;
        if (!readiness.isReady) {
          // Check if failure is due to multiple accounts needing a selection
          final multiAccountIssues = readiness.issues.where((i) =>
              i.toLowerCase().contains('several') && i.toLowerCase().contains('accounts are connected')).toList();

          if (multiAccountIssues.isNotEmpty) {
            final platformsNeedingSelection = p.platforms.where((pl) =>
                multiAccountIssues.any((issue) =>
                    issue.toLowerCase().contains(pl.id.toLowerCase()) ||
                    issue.toLowerCase().contains(pl.label.toLowerCase()))).toList();

            if (platformsNeedingSelection.isNotEmpty) {
              if (platformsNeedingSelection.length == 1) {
                // Single platform needs choice: directly open account picker
                final chosen = await _pickAccountForPlatform(platformsNeedingSelection.first);
                if (chosen && mounted) {
                  final proceed = await confirm(
                    context,
                    title: 'Account Selected',
                    message: 'Account assigned successfully. Would you like to proceed with publishing now?',
                    action: 'Publish Now',
                  );
                  if (proceed && mounted) {
                    _publish();
                  }
                }
                return;
              } else {
                // Multiple platforms need choice: show smart actionable dialog
                await showDialog<void>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    backgroundColor: AppTheme.surfaceElevated,
                    title: const Text('Account Selection Required'),
                    content: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Multiple accounts are connected for these platforms. Please choose which account to use:'),
                        const SizedBox(height: 12),
                        for (final pl in platformsNeedingSelection)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: pl.color.withValues(alpha: 0.15),
                                foregroundColor: pl.color,
                              ),
                              icon: Icon(pl.icon, size: 18),
                              label: Text('Select ${pl.label} Account'),
                              onPressed: () {
                                Navigator.pop(ctx);
                                _pickAccountForPlatform(pl);
                              },
                            ),
                          ),
                      ],
                    ),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                    ],
                  ),
                );
                return;
              }
            }
          }

          await showDialog<void>(
            context: context,
            builder: (ctx) => AlertDialog(
              backgroundColor: AppTheme.surfaceElevated,
              title: Text(readiness.schedulingBlockers.isEmpty && readiness.approvalPending ? 'Waiting for approval' : 'Not ready to publish'),
              content: Text(readiness.schedulingBlockers.isEmpty && readiness.approvalPending
                  ? 'This project requires approval before publishing. Send it for review, or ask an approver to approve it.'
                  : readiness.issues.isEmpty
                      ? 'The server reported the post is not ready.'
                      : '• ${readiness.issues.join('\n• ')}'),
              actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: Text('OK'))],
            ),
          );
          return;
        }
        final warn = readiness.warnings.isEmpty ? '' : '\n\nHeads up:\n• ${readiness.warnings.join('\n• ')}';
        final ok = await confirm(context,
            title: 'Publish now?', message: 'This posts to ${p.platforms.map((x) => x.label).join(', ')} immediately.$warn', action: 'Publish');
        if (!ok) return;
        setState(() => _publishing = apiPlatforms);
        final PublishResult result;
        try {
          result = await api.publish(p.id);
        } finally {
          if (mounted) setState(() => _publishing = null);
        }
        _refresh();
        if (!mounted) return;
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: AppTheme.surfaceElevated,
            title: Text(result.simulated ? 'Simulated publish: ${result.status}' : 'Publish: ${result.status}'),
            content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (result.simulated)
                Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: Text('Sandbox mode: nothing was posted to any platform. Limits were checked as for a real post.',
                      style: TextStyle(color: AppTheme.warning)),
                ),
              if (result.message.isNotEmpty) Text(result.message),
              for (final e in result.publishedLinks.entries)
                result.simulated
                    ? Text('✓ ${e.key}: simulated (no live post)', style: TextStyle(color: AppTheme.success))
                    : Row(children: [
                        Expanded(child: Text('✓ ${e.key}: posted', style: TextStyle(color: AppTheme.success))),
                        TextButton.icon(
                          style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
                          onPressed: () => openExternal(ctx, e.value),
                          icon: const Icon(Icons.open_in_new_rounded, size: 16),
                          label: const Text('Open'),
                        ),
                      ]),
              for (final e in result.errors.entries) Text('✗ ${e.key}: ${e.value}', style: TextStyle(color: AppTheme.error)),
            ]),
            actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: Text('OK'))],
          ),
        );

        // If user also selected assisted-only platforms in a hybrid post, open the sheet after API publishing
        if (assistedPlatforms.isNotEmpty && mounted) {
          await _openCentralizedManualPublishSheet();
        }
      });

  Future<void> _uploadDeliverable() async {
    final file = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (file == null || !mounted) return;
    final notes = await promptText(context, title: 'Notes for the reviewer', label: 'Optional', action: 'Upload', maxLines: 3);
    if (notes == null || !mounted) return;
    setState(() {
      _busy = 'upload';
      _progress = 0;
    });
    final updated = await guarded(
      context,
      () => ref.read(socialApiProvider).submitForApproval(p.id, videoPath: file.path, notes: notes, onProgress: (s, t) {
        if (mounted && t > 0) setState(() => _progress = s / t);
      }),
    );
    if (!mounted) return;
    setState(() {
      _busy = null;
      _progress = null;
    });
    if (updated != null) {
      showInfo(context, 'Uploaded. The post is now ${updated.status.label}.', color: AppTheme.success);
      _refresh();
    }
  }

  Future<void> _addFootageLink() async {
    final url = await promptText(context, title: 'Add raw footage link', label: 'Drive, Dropbox, WeTransfer… URL', action: 'Add');
    if (url == null || url.isEmpty || !mounted) return;
    if (Uri.tryParse(url)?.hasScheme != true) {
      showError(context, 'Enter a full URL starting with https://');
      return;
    }
    await _run('footage', () async {
      await ref.read(socialApiProvider).submitFootage(p.id, links: [ExternalLink(url: url)]);
      _refresh();
      if (mounted) showInfo(context, 'Footage link added', color: AppTheme.success);
    });
  }

  Future<void> _repurpose() async {
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(Duration(days: 7)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(Duration(days: 730)),
      helpText: 'Schedule the copy for',
    );
    if (d == null || !mounted) return;
    await _run('repurpose', () async {
      final copy = await ref.read(socialApiProvider).repurpose(p.id, newScheduleDate: d);
      _refresh();
      if (mounted) context.push('/posts/${copy.id}');
    });
  }

  Future<void> _retry(SocialPlatform platform) => _run('retry', () async {
        await ref.read(socialApiProvider).retryVariant(p.id, platform.id);
        _refresh();
        if (mounted) showInfo(context, 'Retried ${platform.label}');
      });

  @override
  Widget build(BuildContext context) {
    final errors = p.platformErrors;
    final busy = _busy != null;
    return ListView(padding: EdgeInsets.fromLTRB(16, 8, 16, 48), children: [
      SectionCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            StatusChip(label: p.status.label, color: p.status.color),
            if (p.versionNumber > 1) StatusChip(label: 'v${p.versionNumber}', color: AppTheme.textSecondary),
            if (p.isEvergreen) StatusChip(label: 'Evergreen', color: AppTheme.success, icon: Icons.autorenew_rounded),
            if (p.mediaType != null) StatusChip(label: p.mediaType!, color: AppTheme.textSecondary),
            for (final pl in p.platforms) StatusChip(label: pl.label, color: pl.color, icon: pl.icon),
          ]),
          SizedBox(height: 10),
          Text(p.displayTitle, style: Theme.of(context).textTheme.titleLarge),
          SizedBox(height: 6),
          Text(
            [
              if (p.projectName != null) p.projectName!,
              if (p.accountName != null) 'from ${p.accountName}',
              p.scheduledFor == null ? 'Not scheduled' : 'Scheduled ${fmtDateTime(p.scheduledFor)}',
              if (p.publishedAt != null) 'Published ${fmtDateTime(p.publishedAt)}',
            ].join(' · '),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ]),
      ),
      if (p.scheduledFor != null &&
          p.scheduledFor!.isAfter(DateTime.now().subtract(const Duration(minutes: 5))) &&
          (p.status == PostStatus.scheduled || p.status == PostStatus.approved))
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: PublishCountdown(key: ValueKey(p.scheduledFor), scheduledFor: p.scheduledFor!, onDue: _refresh),
        ),
      if (_publishing != null)
        Padding(padding: const EdgeInsets.only(top: 12), child: SectionCard(child: PublishingProgress(platforms: _publishing!)))
      else if (_inFlight)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text('The platform is still processing the video; this page updates by itself.',
              style: TextStyle(color: AppTheme.textSecondary)),
        ),
      if (busy && _publishing == null)
        Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator(value: _progress)),
      SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ElevatedButton.icon(
          onPressed: busy ? null : _publish,
          icon: Icon(Icons.send_rounded, size: 18),
          label: Text('Publish'),
        ),
        if (p.platforms.any((pl) => pl.isUserAssisted))
          OutlinedButton.icon(
            onPressed: busy ? null : _openCentralizedManualPublishSheet,
            icon: Icon(Icons.open_in_new_rounded, size: 18),
            label: Text('Manual publish hub'),
          ),
        OutlinedButton.icon(
          onPressed: busy ? null : () => context.push('/studio/session?postId=${p.id}${p.projectId == null ? '' : '&projectId=${p.projectId}'}'),
          icon: Icon(Icons.auto_awesome_rounded, size: 18),
          label: Text('Edit in Studio'),
        ),
        OutlinedButton.icon(
          onPressed: busy ? null : _uploadDeliverable,
          icon: Icon(Icons.upload_rounded, size: 18),
          label: Text('Upload final video'),
        ),
        OutlinedButton.icon(
          onPressed: busy ? null : _repurpose,
          icon: Icon(Icons.copy_all_rounded, size: 18),
          label: Text('Repurpose'),
        ),
      ]),
      if (p.revisionNotes?.isNotEmpty ?? false) ...[
        SectionHeader('Revision notes'),
        SectionCard(borderColor: AppTheme.warning.withValues(alpha: 0.5), child: Text(p.revisionNotes!)),
      ],
      if (errors.isNotEmpty) ...[
        SectionHeader('Publishing errors'),
        SectionCard(
          borderColor: AppTheme.error.withValues(alpha: 0.5),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final e in errors.entries)
              Padding(
                padding: EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  Expanded(child: Text('${e.key}: ${e.value}', style: TextStyle(color: AppTheme.error))),
                  if (SocialPlatform.parse(e.key) != SocialPlatform.unknown)
                    TextButton(onPressed: busy ? null : () => _retry(SocialPlatform.parse(e.key)), child: Text('Retry')),
                ]),
              ),
          ]),
        ),
      ],
      if (p.finalVideoUrl != null || p.thumbnailUrl != null || p.mediaUrls.isNotEmpty) ...[
        SectionHeader('Media'),
        if (p.thumbnailUrl != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.network(p.thumbnailUrl!, cacheWidth: 1080, height: 200, fit: BoxFit.cover,
                errorBuilder: (_, _, _) => SizedBox.shrink()),
          ),
        // AI thumbnail team: a designed cover from the best real frame of the video (YouTube / Reels / Pinterest).
        if (p.finalVideoUrl ?? p.mediaUrls.where((u) => u.toLowerCase().contains('.mp4')).firstOrNull case final video?)
          Padding(
            padding: EdgeInsets.only(top: 8),
            child: SizedBox(
              height: 44,
              child: OutlinedButton.icon(
                icon: Icon(Icons.auto_awesome_rounded),
                label: Text(p.thumbnailUrl == null ? 'Design thumbnail with AI' : 'Redesign thumbnail with AI'),
                onPressed: () async {
                  final url = await showThumbnailDesigner(context, p, video);
                  if (url != null) {
                    ref.refreshPost(p.id, projectId: p.projectId);
                  }
                },
              ),
            ),
          ),
        if (p.finalVideoUrl != null)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.movie_rounded, color: AppTheme.success),
            title: Text('Final video'),
            subtitle: Text(p.finalVideoUrl!, maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () => openExternal(context, p.finalVideoUrl!),
          ),
        for (final url in p.mediaUrls)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.attachment_rounded),
            title: Text(url, maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () => openExternal(context, url),
          ),
      ],
      SectionHeader('Caption'),
      SectionCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (p.hook != null) ...[
            Text('HOOK', style: Theme.of(context).textTheme.labelSmall),
            Text(p.hook!, style: TextStyle(fontWeight: FontWeight.w700)),
            SizedBox(height: 10),
          ],
          SelectableText(p.content),
          if (p.objective != null) ...[
            SizedBox(height: 10),
            Text('Objective: ${p.objective}', style: Theme.of(context).textTheme.bodyMedium),
          ],
          if (p.firstComment != null) ...[
            SizedBox(height: 6),
            Text('First comment: ${p.firstComment}', style: Theme.of(context).textTheme.bodyMedium),
          ],
        ]),
      ),
      if (p.variants.isNotEmpty) ...[
        SectionHeader('Per-platform'),
        for (final v in p.variants)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: SectionCard(
              padding: EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Icon(v.platform.icon, color: v.platform.color, size: 18),
                  SizedBox(width: 8),
                  Expanded(child: Text(v.platform.label, style: TextStyle(fontWeight: FontWeight.w600))),
                  if (v.isSimulated) ...[
                    StatusChip(label: 'SIMULATED', color: AppTheme.warning),
                    SizedBox(width: 6),
                  ],
                  if (v.status != null) StatusChip(label: v.status!, color: v.status == 'failed' ? AppTheme.error : AppTheme.textSecondary),
                ]),
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: InkWell(
                    onTap: busy ? null : () => _pickAccountForPlatform(v.platform),
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: (v.accountName != null || v.username != null)
                            ? Colors.white.withValues(alpha: 0.05)
                            : AppTheme.warning.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: (v.accountName != null || v.username != null)
                              ? Colors.white12
                              : AppTheme.warning.withValues(alpha: 0.4),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (v.profileImageUrl != null)
                            Padding(
                              padding: const EdgeInsets.only(right: 6),
                              child: CircleAvatar(
                                radius: 8,
                                backgroundImage: NetworkImage(v.profileImageUrl!),
                              ),
                            )
                          else
                            Icon(
                              (v.accountName != null || v.username != null)
                                  ? Icons.account_circle_rounded
                                  : Icons.swap_horiz_rounded,
                              size: 15,
                              color: (v.accountName != null || v.username != null) ? v.platform.color : AppTheme.warning,
                            ),
                          const SizedBox(width: 6),
                          Text(
                            v.accountName ?? (v.username != null ? '@${v.username}' : 'Choose account (multiple connected)'),
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: (v.accountName != null || v.username != null) ? Colors.white : AppTheme.warning,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Icon(Icons.unfold_more_rounded, size: 14, color: AppTheme.textSecondary),
                        ],
                      ),
                    ),
                  ),
                ),
                if (v.customContent?.isNotEmpty ?? false) Padding(padding: EdgeInsets.only(top: 6), child: Text(v.customContent!)),
                if (v.isSimulated)
                  Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Text('Sandbox publish: nothing was posted to the platform and there is no live link.',
                        style: TextStyle(color: AppTheme.warning, fontSize: 12)),
                  )
                else if (v.errorMessage != null && v.isFailed)
                  Row(children: [
                    Expanded(child: Text(v.errorMessage!, style: TextStyle(color: AppTheme.error))),
                    TextButton(onPressed: busy ? null : () => _retry(v.platform), child: Text('Retry')),
                  ])
                else if (v.errorMessage != null)
                  Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Text(v.errorMessage!, style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                  ),
                if (v.publishedUrl != null && !v.isSimulated)
                  TextButton.icon(
                    onPressed: () => openExternal(context, v.publishedUrl!),
                    icon: Icon(Icons.open_in_new_rounded, size: 16),
                    label: Text('View live post'),
                  ),
              ]),
            ),
          ),
      ],
      if (p.publishedLinks.isNotEmpty) ...[
        SectionHeader('Live links'),
        for (final e in p.publishedLinks.entries.where((e) => !p.variants.any((v) => v.isSimulated && v.platform == SocialPlatform.parse(e.key))))
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(SocialPlatform.parse(e.key).icon, color: SocialPlatform.parse(e.key).color),
            title: Text(e.key),
            subtitle: Text(e.value, maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () => openExternal(context, e.value),
          ),
      ],
      SectionHeader('Raw footage',
          trailing: TextButton.icon(
              onPressed: busy ? null : _addFootageLink, icon: Icon(Icons.add_link_rounded, size: 16), label: Text('Add link'))),
      if (p.rawMediaUrls.isEmpty && p.externalStorageLinks.isEmpty)
        SectionCard(child: Text('No footage yet. Shoot in Studio, or add a cloud link.'))
      else ...[
        for (final url in p.rawMediaUrls)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.video_file_rounded),
            title: Text(url, maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () => openExternal(context, url),
          ),
        for (final l in p.externalStorageLinks)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.cloud_rounded),
            title: Text(l.label ?? l.provider ?? 'Link'),
            subtitle: Text(l.url, maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () => openExternal(context, l.url),
          ),
      ],
      SectionHeader('Review comments (${p.unresolvedComments} open)'),
      if (p.reviewComments.isEmpty)
        SectionCard(child: Text('No comments yet.'))
      else
        for (final c in p.reviewComments)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: SectionCard(
              padding: EdgeInsets.all(12),
              borderColor: c.resolved ? null : AppTheme.warning.withValues(alpha: 0.4),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: Text('${c.authorName ?? c.authorType ?? 'Reviewer'} · ${timeAgo(c.createdAt)}',
                        style: Theme.of(context).textTheme.labelSmall),
                  ),
                  if (c.resolved) StatusChip(label: 'Resolved', color: AppTheme.success),
                ]),
                SizedBox(height: 4),
                Text(c.text),
              ]),
            ),
          ),
    ]);
  }
}
