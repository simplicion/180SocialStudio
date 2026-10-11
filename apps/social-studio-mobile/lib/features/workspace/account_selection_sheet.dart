import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/social_account.dart';

/// After OAuth returns `status=select`: the user picks which Pages / Instagram accounts / LinkedIn
/// organisations to connect. Nothing is connected until they confirm.
Future<void> showAccountSelectionSheet(BuildContext context, String selectionId) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppTheme.surfaceElevated,
      builder: (_) => FractionallySizedBox(heightFactor: 0.8, child: AccountSelectionSheet(selectionId: selectionId)),
    );

final _selectionProvider = FutureProvider.autoDispose.family(
  (ref, String id) => ref.watch(socialApiProvider).getOAuthSelection(id),
);

class AccountSelectionSheet extends ConsumerStatefulWidget {
  const AccountSelectionSheet({super.key, required this.selectionId});
  final String selectionId;

  @override
  ConsumerState<AccountSelectionSheet> createState() => _AccountSelectionSheetState();
}

class _AccountSelectionSheetState extends ConsumerState<AccountSelectionSheet> {
  final _picked = <String>{};
  bool _saving = false;

  Future<void> _connect() async {
    setState(() => _saving = true);
    final accounts = await guarded(
        context, () => ref.read(socialApiProvider).completeOAuthSelection(widget.selectionId, _picked.toList()));
    if (!mounted) return;
    setState(() => _saving = false);
    if (accounts == null) return;
    showSuccess(context, accounts.length == 1 ? '${accounts.first.accountName} connected' : '${accounts.length} accounts connected');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: EdgeInsets.fromLTRB(16, 8, 8, 0),
        child: Row(children: [
          Expanded(child: Text('Choose accounts to connect', style: Theme.of(context).textTheme.titleMedium)),
          IconButton(tooltip: 'Close', icon: Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context)),
        ]),
      ),
      Expanded(
        child: AsyncBody<({String platform, List<OAuthCandidate> candidates})>(
          value: ref.watch(_selectionProvider(widget.selectionId)),
          onRetry: () => ref.invalidate(_selectionProvider(widget.selectionId)),
          builder: (sel) => sel.candidates.isEmpty
              ? EmptyView(
                  icon: Icons.account_circle_outlined,
                  title: 'No accounts were found',
                  message: 'Make sure you gave access to at least one page or organisation, then connect again.',
                  actionLabel: 'Close',
                  onAction: () => Navigator.pop(context),
                )
              : ListView(padding: EdgeInsets.fromLTRB(8, 8, 8, 16), children: [
                  for (final c in sel.candidates)
                    CheckboxListTile(
                      value: _picked.contains(c.candidateId),
                      onChanged: (on) => setState(() => on == true ? _picked.add(c.candidateId) : _picked.remove(c.candidateId)),
                      secondary: CircleAvatar(
                        backgroundColor: AppTheme.surface,
                        foregroundImage: c.profileImageUrl == null ? null : NetworkImage(c.profileImageUrl!),
                        child: Text(c.accountName.isEmpty ? '?' : c.accountName[0].toUpperCase()),
                      ),
                      title: Text(c.accountName, maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text([c.kindLabel, if (c.username != null) '@${c.username}'].join(' · ')),
                    ),
                ]),
        ),
      ),
      Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: ElevatedButton(
          onPressed: _saving || _picked.isEmpty ? null : _connect,
          child: _saving
              ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(_picked.isEmpty ? 'Pick at least one' : 'Connect ${_picked.length}'),
        ),
      ),
    ]);
  }
}
