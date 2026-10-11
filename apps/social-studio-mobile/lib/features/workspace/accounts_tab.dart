import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/platform.dart';
import '../../data/models/project.dart';
import '../../data/models/social_account.dart';
import '../projects/project_provider.dart';
import 'account_selection_sheet.dart';

final allAccountsProvider = FutureProvider.autoDispose<List<SocialAccount>>((ref) => ref.watch(socialApiProvider).listAccounts());

final projectAccountsProvider = FutureProvider.autoDispose.family<List<SocialAccount>, String?>((ref, projectId) {
  return ref.watch(socialApiProvider).listAccounts(projectId: projectId);
});

/// Channels linked to the project: link existing workspace accounts, connect new ones via
/// OAuth in the system browser, unlink, and flag accounts needing re-authorization.
class AccountsTab extends ConsumerStatefulWidget {
  const AccountsTab({super.key, required this.project});
  final Project project;

  @override
  ConsumerState<AccountsTab> createState() => _AccountsTabState();
}

class _AccountsTabState extends ConsumerState<AccountsTab> {
  StreamSubscription? _oauthSub;

  @override
  void initState() {
    super.initState();
    _oauthSub = ref.read(deepLinksProvider).oauthCallbacks.listen((cb) {
      if (!mounted) return;
      if (cb.needsSelection) {
        showAccountSelectionSheet(context, cb.selectionId!).then((_) => _refresh());
        return;
      }
      if (cb.isSuccess) {
        showInfo(context, '${cb.platform ?? 'Account'} connected', color: AppTheme.success);
      } else {
        showError(context, 'Connection failed: ${cb.error ?? 'unknown error'}');
      }
      _refresh();
    });
  }

  @override
  void dispose() {
    _oauthSub?.cancel();
    super.dispose();
  }

  void _refresh() {
    ref.refreshProjectData(widget.project.id);
    ref.invalidate(allAccountsProvider);
    ref.invalidate(projectAccountsProvider);
  }

  Future<void> _connect(SocialPlatform platform) async {
    final uri = await guarded(context, () => ref.read(socialApiProvider).startAccountOAuth(platform, projectId: widget.project.id));
    if (uri == null || !mounted) return;
    if (uri.scheme == AppConfig.deepLinkScheme) {
      ref.read(deepLinksProvider).routeFor(uri);
      return;
    }
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      showError(context, 'Could not open the browser for ${platform.label}.');
    }
  }

  Future<void> _setDefault(SocialAccount a) async {
    final ok = await guarded(context, () async {
      await ref.read(socialApiProvider).setDefaultAccount(a.id);
      return true;
    });
    if (ok == true && mounted) {
      showInfo(context, '${a.accountName} is now the default for ${a.platform.label}', color: AppTheme.success);
      _refresh();
    }
  }

  Future<void> _unlink(SocialAccount a) async {
    final yes = await confirm(context,
        title: 'Unlink ${a.accountName}?', message: 'Scheduled posts from this account will not publish for this project.', action: 'Unlink', destructive: true);
    if (!yes || !mounted) return;
    final ok = await guarded(context, () async {
      await ref.read(socialApiProvider).unlinkAccount(widget.project.id, a.id);
      return true;
    });
    if (ok == true && mounted) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final linked = widget.project.socialAccounts;
    return RefreshIndicator(
      onRefresh: () async => _refresh(),
      child: ListView(padding: EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
        SectionHeader('Linked to this project (${linked.length})'),
        if (linked.isEmpty) SectionCard(child: Text('No channels linked yet.')),
        for (final a in linked)
          _AccountTile(
            account: a,
            hasSiblings: linked.where((x) => x.platform == a.platform).length > 1,
            onSetDefault: () => _setDefault(a),
            onUnlink: () => _unlink(a),
          ),
        SectionHeader('Connect a new channel'),
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text(
            'Connect multiple accounts for each platform (e.g. multiple LinkedIn profiles/pages, multiple Instagram accounts, multiple Facebook pages). Link as many accounts as you manage.',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
          ),
        ),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in SocialPlatform.connectable) ...[
            () {
              final count = linked.where((x) => x.platform == p).length;
              return OutlinedButton.icon(
                onPressed: () => _connect(p),
                icon: Icon(p.icon, color: p.color, size: 18),
                label: Text(count > 0 ? '${p.label} (+ Add another)' : p.label),
              );
            }(),
          ],
        ]),
        Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text('Opens the platform sign-in in your browser and returns here when done.',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
        ),
      ]),
    );
  }
}

class _AccountTile extends StatelessWidget {
  const _AccountTile({
    required this.account,
    required this.hasSiblings,
    required this.onSetDefault,
    required this.onUnlink,
  });

  final SocialAccount account;
  final bool hasSiblings;
  final VoidCallback onSetDefault;
  final VoidCallback onUnlink;

  @override
  Widget build(BuildContext context) {
    final a = account;
    final status = a.reauthRequired || a.tokenHealth == 'reauth_required'
        ? 'Re-authorization required'
        : a.tokenExpired
            ? 'Access expired'
            : a.expiresSoon
                ? (a.tokenExpiresAt == null ? 'Access expires within 7 days' : 'Access expires ${fmtDate(a.tokenExpiresAt)}')
                : null;
    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: SectionCard(
        padding: EdgeInsets.fromLTRB(12, 8, 4, 8),
        borderColor: a.needsAttention ? AppTheme.error.withValues(alpha: 0.5) : null,
        child: Row(children: [
          CircleAvatar(
            backgroundColor: a.platform.color.withValues(alpha: 0.2),
            foregroundImage: a.profileImageUrl == null ? null : NetworkImage(a.profileImageUrl!),
            child: Icon(a.platform.icon, color: a.platform.color, size: 18),
          ),
          SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text(a.accountName, style: TextStyle(fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)),
                if (a.isDefault) ...[
                  SizedBox(width: 6),
                  StatusChip(label: 'DEFAULT', color: AppTheme.primary),
                ],
                if (a.isSimulated) ...[
                  SizedBox(width: 6),
                  StatusChip(label: 'SANDBOX', color: AppTheme.warning),
                ],
              ]),
              Text([a.platform.label, if (a.username != null) '@${a.username}'].join(' · '),
                  style: Theme.of(context).textTheme.labelSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
              if (status != null)
                Text(status, style: TextStyle(fontSize: 12, color: a.needsAttention ? AppTheme.error : AppTheme.warning)),
            ]),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert_rounded, size: 20, color: Colors.white70),
            onSelected: (val) {
              if (val == 'default') onSetDefault();
              if (val == 'unlink') onUnlink();
            },
            itemBuilder: (ctx) => [
              if (!a.isDefault && hasSiblings)
                PopupMenuItem(
                  value: 'default',
                  child: Row(
                    children: [
                      Icon(Icons.star_rounded, size: 18, color: AppTheme.primary),
                      const SizedBox(width: 8),
                      const Text('Set as Default'),
                    ],
                  ),
                ),
              PopupMenuItem(
                value: 'unlink',
                child: Row(
                  children: [
                    Icon(Icons.link_off_rounded, size: 18, color: AppTheme.error),
                    const SizedBox(width: 8),
                    Text('Unlink Account', style: TextStyle(color: AppTheme.error)),
                  ],
                ),
              ),
            ],
          ),
        ]),
      ),
    );
  }
}
