import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../offline/outbox.dart';
import '../providers.dart';
import '../theme/app_theme.dart';

/// App-bar badge for the offline outbox: offline, pending writes, or writes needing attention.
class SyncIndicator extends ConsumerWidget {
  const SyncIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final outbox = ref.watch(outboxProvider);
    final pending = outbox.pendingCount;
    final attention = outbox.attentionCount;
    if (outbox.online && pending == 0 && attention == 0) return SizedBox.shrink();
    final color = attention > 0
        ? AppTheme.error
        : outbox.online
            ? AppTheme.accentBlue
            : AppTheme.warning;
    final icon = !outbox.online
        ? Icons.cloud_off_rounded
        : outbox.state == SyncState.syncing
            ? Icons.sync_rounded
            : Icons.cloud_upload_rounded;
    return IconButton(
      tooltip: 'Sync status',
      onPressed: () => context.push('/sync'),
      icon: Badge(
        isLabelVisible: pending + attention > 0,
        backgroundColor: color,
        label: Text('${pending + attention}'),
        child: Icon(icon, color: color),
      ),
    );
  }
}

class OutboxScreen extends ConsumerWidget {
  const OutboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final outbox = ref.watch(outboxProvider);
    final items = outbox.mine;
    return Scaffold(
      appBar: AppBar(title: Text('Sync status'), actions: [
        IconButton(onPressed: () => outbox.drain(force: true), icon: Icon(Icons.sync_rounded), tooltip: 'Sync now'),
      ]),
      body: ListView(padding: EdgeInsets.all(16), children: [
        ListTile(
          leading: Icon(outbox.online ? Icons.cloud_done_rounded : Icons.cloud_off_rounded,
              color: outbox.online ? AppTheme.success : AppTheme.warning),
          title: Text(outbox.online ? 'Online' : 'Offline'),
          subtitle: Text(switch (outbox.state) {
            SyncState.authRequired => 'Sign in again to sync your queued changes.',
            SyncState.error => 'The server is having trouble; retrying automatically.',
            SyncState.syncing => 'Syncing…',
            _ => items.isEmpty ? 'Everything is synced.' : '${items.length} change(s) waiting to sync.',
          }),
        ),
        Divider(),
        for (final m in items)
          Card(
            color: AppTheme.surface,
            child: ListTile(
              title: Text(m.label),
              subtitle: Text([
                '${m.method} ${m.path}',
                m.status.name,
                if (m.retryCount > 0) 'retries: ${m.retryCount}',
                if (m.lastError != null) m.lastError!,
              ].join('\n')),
              isThreeLine: true,
              trailing: PopupMenuButton<String>(
                onSelected: (v) => v == 'retry' ? outbox.retry(m.id) : outbox.discard(m.id),
                itemBuilder: (_) => [
                  PopupMenuItem(value: 'retry', child: Text('Retry now')),
                  PopupMenuItem(value: 'discard', child: Text('Discard change')),
                ],
              ),
            ),
          ),
      ]),
    );
  }
}
