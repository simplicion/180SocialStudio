import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/engagement_rule.dart';
import '../../data/models/social_account.dart';

/// The picked existing post, shown in place of the post dropdown; ✕ goes back to "All videos & posts".
class SelectedMediaCard extends StatelessWidget {
  const SelectedMediaCard({super.key, required this.item, required this.onClear});
  final AccountMediaItem item;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.surfaceElevated,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.4)),
      ),
      child: Row(children: [
        MediaThumb(url: item.thumbnailUrl, size: 48),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.mediaType == 'REEL' ? 'Existing Reel' : 'Existing post',
                style: TextStyle(fontSize: 11, color: AppTheme.accent, fontWeight: FontWeight.w600)),
            Text(_caption(item), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
          ]),
        ),
        IconButton(tooltip: 'Remove post target', onPressed: onClear, icon: const Icon(Icons.close_rounded)),
      ]),
    );
  }
}

String _caption(AccountMediaItem m) => m.caption?.trim().isNotEmpty == true ? m.caption!.trim() : '(no caption)';

/// Square thumbnail decoded at display size; a neutral placeholder when there is no https image.
class MediaThumb extends StatelessWidget {
  const MediaThumb({super.key, required this.url, required this.size});
  final String? url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      color: AppTheme.surface,
      child: Icon(Icons.movie_rounded, color: AppTheme.textSecondary, size: size * 0.4),
    );
    final u = url;
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: u == null || !u.startsWith('https://')
          ? placeholder
          : Image.network(
              u,
              width: size,
              height: size,
              fit: BoxFit.cover,
              cacheWidth: (size * MediaQuery.devicePixelRatioOf(context)).round(),
              errorBuilder: (_, _, _) => placeholder,
            ),
    );
  }
}

/// Grid of the account's real, already-published posts (newest first, paged). Pops with the tapped item.
class AccountMediaPickerSheet extends ConsumerStatefulWidget {
  const AccountMediaPickerSheet({super.key, required this.account});
  final SocialAccount account;

  @override
  ConsumerState<AccountMediaPickerSheet> createState() => _AccountMediaPickerSheetState();
}

class _AccountMediaPickerSheetState extends ConsumerState<AccountMediaPickerSheet> {
  final _items = <AccountMediaItem>[];
  String? _cursor;
  bool _loading = true;
  bool _hasMore = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) {
      _items.clear();
      _cursor = null;
      _hasMore = true;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(socialApiProvider).listAccountMedia(widget.account.id, cursor: _cursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final handle = widget.account.username ?? widget.account.accountName;
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.8,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Pick a post from @$handle', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('The automation runs only on comments under this post.', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
            const SizedBox(height: 12),
            Expanded(child: _body()),
          ]),
        ),
      ),
    );
  }

  Widget _body() {
    if (_items.isEmpty && _loading) return const UniversalSkeleton(type: SkeletonType.projects);
    if (_items.isEmpty && _error != null) {
      return ListView(children: [
        ErrorView(error: _error!, onRetry: () => _load(reset: true)),
        // Second recovery path: the rule can still run on every post of the account.
        TextButton(
          style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
          onPressed: () => Navigator.pop(context),
          child: const Text('Use "All videos & posts" instead'),
        ),
      ]);
    }
    if (_items.isEmpty) {
      return EmptyView(
        icon: Icons.video_library_outlined,
        title: 'No posts on this account yet',
        message: 'Publish a post, or apply the automation to all future posts.',
        actionLabel: 'Back to the rule',
        onAction: () => Navigator.pop(context),
      );
    }
    return GridView.builder(
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 140,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 0.7,
      ),
      itemCount: _items.length + (_hasMore ? 1 : 0),
      itemBuilder: (context, i) {
        if (i >= _items.length) {
          if (_error != null) {
            return Center(child: IconButton(tooltip: 'Load more', onPressed: _load, icon: const Icon(Icons.refresh_rounded)));
          }
          if (!_loading) WidgetsBinding.instance.addPostFrameCallback((_) => _load());
          return const UniversalSkeleton(type: SkeletonType.detail);
        }
        final m = _items[i];
        return InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => Navigator.pop(context, m),
          onLongPress: m.permalink == null ? null : () => launchUrl(Uri.parse(m.permalink!), mode: LaunchMode.externalApplication),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(child: LayoutBuilder(builder: (_, c) => MediaThumb(url: m.thumbnailUrl, size: c.maxWidth))),
            const SizedBox(height: 4),
            Text(_caption(m), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11)),
            if (m.commentsCount != null)
              Text('${m.commentsCount} comments', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
          ]),
        );
      },
    );
  }
}
