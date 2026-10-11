import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import 'cc_widgets.dart';

const _basisLabel = {'views': 'views', 'reach': 'reach', 'engagements': 'likes, comments, shares and saves'};

/// The account's own posts ranked against its own median, from metrics the server read off the platform.
class OwnPostsSection extends ConsumerStatefulWidget {
  const OwnPostsSection({super.key, required this.platform, required this.projectId, required this.ownPosts, required this.connected, required this.onRefreshed});
  final String platform;
  final String projectId;
  final Json ownPosts;
  final bool connected;
  final VoidCallback onRefreshed;

  @override
  ConsumerState<OwnPostsSection> createState() => _OwnPostsSectionState();
}

class _OwnPostsSectionState extends ConsumerState<OwnPostsSection> {
  bool _busy = false;
  Object? _error;
  List<String> _failed = const [];

  Future<void> _refresh() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(socialApiProvider).refreshPostMetrics(widget.platform, widget.projectId);
      final failed = jList(jMap(r['refresh'])['failed'], (m) => m);
      if (!mounted) return;
      setState(() => _failed = {for (final f in failed) jStrOr(f['reason'], '')}.toList());
      widget.onRefreshed();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.ownPosts;
    final top = jList(o['top'], (m) => m);
    final basis = jStrOr(o['basis'], 'views');
    final measured = jInt(o['measured']) ?? 0;
    final published = jInt(o['published']) ?? 0;
    final needsMore = jInt(o['needsMore']) ?? 0;
    final label = platformLabel(widget.platform);
    final fetched = jDate(o['lastFetchedAt']);

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionHeader(
        'Your posts, ranked',
        trailing: fetched == null ? null : Text('Updated ${timeAgo(fetched)}', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
      ),
      if (_busy)
        UniversalSkeleton(type: SkeletonType.activity, itemCount: 2)
      else if (top.isEmpty)
        SectionCard(
          child: Text(
            !widget.connected
                ? 'Connect $label to rank your posts by how far each one beat your usual numbers.'
                : published == 0
                    ? 'Nothing published to $label in the last 90 days yet.'
                    : measured == 0
                        ? '$published published posts have no numbers yet. Refresh to read them from $label.'
                        : '$needsMore more measured posts are needed before a ranking means anything ($measured so far).',
            style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
          ),
        )
      else ...[
        Text(
          'Each post compared with your median of ${(jDouble(o['baseline']) ?? 0).round()} ${_basisLabel[basis] ?? basis}. 3x or more is an outlier worth repeating.',
          style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
        ),
        SizedBox(height: 8),
        for (final p in top) RankedPostCard(post: p, onTap: jStrOr(p['postId'], '').isEmpty ? null : () => context.push('/posts/${jStrOr(p['postId'], '')}')),
        if (jList(o['provenFormulas'], (m) => m).isNotEmpty)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (final f in jList(o['provenFormulas'], (m) => m)) StatusChip(label: '${jStrOr(f['formulaName'], '')} ×${jInt(f['count']) ?? 0}', color: AppTheme.success),
            ]),
          ),
      ],
      if (_error case final e?) ErrorView(error: e, onRetry: _refresh, compact: true),
      for (final f in _failed.take(2))
        Padding(padding: EdgeInsets.only(top: 4), child: Text('Some posts could not be read: $f', style: TextStyle(fontSize: 12, color: AppTheme.warning))),
      if (widget.connected) ...[
        SizedBox(height: 8),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
          onPressed: _busy ? null : _refresh,
          icon: Icon(Icons.refresh_rounded, size: 18),
          label: Text(_busy ? 'Reading from $label…' : 'Refresh numbers'),
        ),
      ],
    ]);
  }
}

class RankedPostCard extends StatelessWidget {
  const RankedPostCard({super.key, required this.post, this.onTap});
  final Json post;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final multiple = jDouble(post['outlierMultiple']) ?? 0;
    final outlier = jBool(post['isOutlier']);
    final m = jMap(post['metrics']);
    final stats = [
      for (final f in const [('views', 'views'), ('reach', 'reach'), ('likes', 'likes'), ('comments', 'comments'), ('shares', 'shares'), ('saves', 'saves')])
        if ((jInt(m[f.$1]) ?? jInt(post[f.$1])) case final v?) '$v ${f.$2}',
    ];
    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: SectionCard(
        padding: EdgeInsets.all(12),
        borderColor: outlier ? AppTheme.success.withValues(alpha: 0.6) : null,
        onTap: onTap,
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 56,
            padding: EdgeInsets.symmetric(vertical: 6),
            alignment: Alignment.center,
            decoration: BoxDecoration(color: (outlier ? AppTheme.success : AppTheme.textMuted).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
            child: Text('${multiple}x', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: outlier ? AppTheme.success : AppTheme.textSecondary)),
          ),
          SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (jStr(post['account']) case final a?) Text('@$a', style: TextStyle(fontSize: 11, color: AppTheme.textMuted, fontWeight: FontWeight.w600)),
              Text(jStrOr(post['hook'], jStrOr(post['title'], 'Untitled')), maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              if (stats.isNotEmpty) Padding(padding: EdgeInsets.only(top: 4), child: Text(stats.join(' · '), style: TextStyle(fontSize: 11, color: AppTheme.textMuted))),
              if (jStr(post['formulaName']) case final f?) Padding(padding: EdgeInsets.only(top: 2), child: Text('Hook shape: $f', style: TextStyle(fontSize: 11, color: AppTheme.textSecondary))),
            ]),
          ),
        ]),
      ),
    );
  }
}

final _radarProvider = FutureProvider.autoDispose.family<Json, ({String platform, String projectId})>((ref, k) => ref.watch(socialApiProvider).radar(k.platform, k.projectId));

/// Accounts the creator watches. Posts are read through the platform's official API with the connected account.
class RadarSection extends ConsumerStatefulWidget {
  const RadarSection({super.key, required this.platform, required this.projectId});
  final String platform;
  final String projectId;

  @override
  ConsumerState<RadarSection> createState() => _RadarSectionState();
}

class _RadarSectionState extends ConsumerState<RadarSection> {
  final _handle = TextEditingController();
  bool _busy = false;
  Object? _error;
  Json? _fresh;

  ({String platform, String projectId}) get _key => (platform: widget.platform, projectId: widget.projectId);

  @override
  void dispose() {
    _handle.dispose();
    super.dispose();
  }

  Future<void> _run(Future<Json> Function() action) async {
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await action();
      if (mounted) setState(() => _fresh = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final label = platformLabel(widget.platform);
    final loaded = ref.watch(_radarProvider(_key));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SectionHeader('Accounts you watch'),
      loaded.when(
        loading: () => UniversalSkeleton(type: SkeletonType.activity, itemCount: 1),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_radarProvider(_key)), compact: true),
        data: (stored) {
          final radar = _fresh ?? stored;
          if (!jBool(radar['supported'])) {
            return SectionCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('$label gives apps no way to read other accounts\' posts, so they cannot be scanned automatically.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
                SizedBox(height: 10),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
                  onPressed: () => DefaultTabController.of(context).animateTo(2),
                  child: Text('Check a post by hand'),
                ),
              ]),
            );
          }
          final handles = jStrList(radar['handles']);
          final scan = jMap(radar['scan']);
          final top = jList(scan['top'], (m) => m);
          final accounts = jList(scan['accounts'], (m) => m);
          final api = ref.read(socialApiProvider);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SectionCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (handles.isEmpty)
                  Text('Add up to ${jInt(radar['maxHandles']) ?? 10} $label accounts in your niche to see which of their posts beat their own average.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary))
                else
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final h in handles)
                      InputChip(
                        label: Text('@$h'),
                        onDeleted: _busy ? null : () => _run(() => api.setRadarHandles(widget.platform, widget.projectId, handles.where((x) => x != h).toList())),
                      ),
                  ]),
                SizedBox(height: 12),
                Row(children: [
                  Expanded(child: TextField(controller: _handle, enabled: !_busy, decoration: fieldDecoration('Add a handle', hint: '@name'), onSubmitted: (_) => _add(handles))),
                  SizedBox(width: 8),
                  IconButton.filledTonal(
                    constraints: BoxConstraints(minWidth: 48, minHeight: 48),
                    tooltip: 'Add account',
                    onPressed: _busy ? null : () => _add(handles),
                    icon: Icon(Icons.add_rounded),
                  ),
                ]),
                if (handles.isNotEmpty) ...[
                  SizedBox(height: 12),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(minimumSize: Size.fromHeight(44)),
                    onPressed: _busy ? null : () => _run(() => api.scanRadar(widget.platform, widget.projectId)),
                    icon: Icon(Icons.radar_rounded, size: 18),
                    label: Text(_busy ? 'Reading from $label…' : scan.isEmpty ? 'Scan their recent posts' : 'Scan again'),
                  ),
                ],
                if (_error case final e?) ...[
                  ErrorView(error: e, compact: true, onRetry: handles.isEmpty ? null : () => _run(() => api.scanRadar(widget.platform, widget.projectId))),
                  TextButton(onPressed: () => context.push('/projects/${widget.projectId}/accounts'), child: Text('Open connected accounts')),
                ],
              ]),
            ),
            if (_busy) Padding(padding: EdgeInsets.only(top: 8), child: UniversalSkeleton(type: SkeletonType.activity, itemCount: 2)),
            if (!_busy && scan.isNotEmpty) ...[
              SizedBox(height: 8),
              Text(
                'Scanned ${timeAgo(jDate(scan['fetchedAt']))}. Each post is compared with that account\'s own median, so big and small accounts are judged the same way.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              for (final a in accounts.where((a) => jStr(a['error']) != null))
                Padding(padding: EdgeInsets.only(top: 6), child: Text('@${jStrOr(a['handle'], '')}: ${jStrOr(a['error'], '')}', style: TextStyle(fontSize: 12, color: AppTheme.warning))),
              SizedBox(height: 8),
              if (top.isEmpty)
                Text('No posts could be ranked yet.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary))
              else
                for (final p in top.take(8)) RankedPostCard(post: p),
            ],
          ]);
        },
      ),
    ]);
  }

  void _add(List<String> handles) {
    final h = _handle.text.trim();
    if (h.isEmpty) {
      showInfo(context, 'Type a handle first.');
      return;
    }
    _run(() async {
      final r = await ref.read(socialApiProvider).setRadarHandles(widget.platform, widget.projectId, [...handles, h]);
      _handle.clear();
      return r;
    });
  }
}

/// Bottom sheet with AI reply drafts for one triaged conversation. Sending is always an explicit, confirmed tap.
Future<void> showReplyDrafts(BuildContext context, {required String platform, required String projectId, required String conversationId, required String author, required String message}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      builder: (_) => _ReplyDraftSheet(platform: platform, projectId: projectId, conversationId: conversationId, author: author, message: message),
    );

class _ReplyDraftSheet extends ConsumerStatefulWidget {
  const _ReplyDraftSheet({required this.platform, required this.projectId, required this.conversationId, required this.author, required this.message});
  final String platform;
  final String projectId;
  final String conversationId;
  final String author;
  final String message;

  @override
  ConsumerState<_ReplyDraftSheet> createState() => _ReplyDraftSheetState();
}

class _ReplyDraftSheetState extends ConsumerState<_ReplyDraftSheet> {
  late Future<Json> _drafts = _load();
  bool _sending = false;

  Future<Json> _load() => ref.read(socialApiProvider).draftReplies(widget.platform, widget.projectId, widget.conversationId);

  Future<void> _send(String text) async {
    final ok = await confirm(context, title: 'Send this reply?', message: 'It will be sent to @${widget.author} on ${platformLabel(widget.platform)}.\n\n$text', action: 'Send');
    if (!ok || !mounted) return;
    setState(() => _sending = true);
    final outcome = await guarded(context, () => ref.read(socialApiProvider).sendMessage(widget.conversationId, text));
    if (!mounted) return;
    setState(() => _sending = false);
    if (outcome != null) {
      showMutation(context, outcome, 'Reply sent');
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Reply to @${widget.author}', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            SizedBox(height: 4),
            Text(widget.message, maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            SizedBox(height: 12),
            Flexible(
              child: FutureBuilder<Json>(
                future: _drafts,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) return UniversalSkeleton(type: SkeletonType.activity, itemCount: 3);
                  if (snap.hasError) {
                    return Column(mainAxisSize: MainAxisSize.min, children: [
                      ErrorView(error: snap.error!, compact: true, onRetry: () => setState(() => _drafts = _load())),
                      TextButton(onPressed: () => context.push('/inbox/${widget.conversationId}'), child: Text('Write the reply yourself')),
                    ]);
                  }
                  final suggestions = jList(snap.data!['suggestions'], (m) => m);
                  if (suggestions.isEmpty) {
                    return Text(jStrOr(snap.data!['nextStep'], 'No reply is suggested for this message.'), style: TextStyle(fontSize: 13, color: AppTheme.textSecondary));
                  }
                  return ListView(shrinkWrap: true, children: [
                    Text(jStrOr(snap.data!['nextStep'], ''), style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                    SizedBox(height: 8),
                    for (final s in suggestions)
                      Padding(
                        padding: EdgeInsets.only(bottom: 8),
                        child: SectionCard(
                          padding: EdgeInsets.all(12),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            if (jStrOr(s['tone'], '').isNotEmpty) Text(jStrOr(s['tone'], '').toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppTheme.textMuted)),
                            SizedBox(height: 4),
                            SelectableText(jStrOr(s['text'], ''), style: TextStyle(fontSize: 14, height: 1.35)),
                            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                              TextButton(
                                style: TextButton.styleFrom(minimumSize: Size(44, 44)),
                                onPressed: () => copyText(context, jStrOr(s['text'], ''), 'Reply'),
                                child: Text('Copy'),
                              ),
                              FilledButton(
                                style: FilledButton.styleFrom(minimumSize: Size(72, 44)),
                                onPressed: _sending ? null : () => _send(jStrOr(s['text'], '')),
                                child: Text('Send'),
                              ),
                            ]),
                          ]),
                        ),
                      ),
                    TextButton(onPressed: () => context.push('/inbox/${widget.conversationId}'), child: Text('Open the conversation')),
                  ]);
                },
              ),
            ),
          ]),
        ),
      );
}
