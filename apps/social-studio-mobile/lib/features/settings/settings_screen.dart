import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/providers.dart';
import '../../core/services/push_notifications.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/theme_provider.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../auth/auth_provider.dart';
import '../common/feature_lock_view.dart';
import '../projects/project_provider.dart';
import '../projects/project_switcher.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _loadingDevices = true;
  Object? _devicesError;
  List<Map<String, dynamic>> _devices = const [];
  String? _currentDeviceId;
  String? _cacheSizeStr = 'Calculating...';
  bool _clearingCache = false;

  @override
  void initState() {
    super.initState();
    _loadDevices();
    _calcCacheSize();
  }

  Future<void> _loadDevices() async {
    setState(() {
      _loadingDevices = true;
      _devicesError = null;
    });
    try {
      final reg = ref.read(deviceRegistrationProvider);
      final currentId = await reg.currentDeviceId;
      final list = await reg.listDevices();
      if (!mounted) return;
      setState(() {
        _currentDeviceId = currentId;
        _devices = list;
        _loadingDevices = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loadingDevices = false;
          _devicesError = e;
        });
      }
    }
  }

  Future<void> _revokeDevice(String deviceId, String label, {int sessionCount = 1}) async {
    final ok = await confirm(
      context,
      title: 'Revoke device?',
      message: sessionCount > 1
          ? 'Are you sure you want to revoke "$label" and its $sessionCount active sessions? It will need to re-register on next launch.'
          : 'Are you sure you want to revoke "$label"? It will need to re-register on next launch.',
      action: 'Revoke',
    );
    if (!ok) return;

    try {
      await ref.read(deviceRegistrationProvider).revokeDevice(deviceId);
      if (!mounted) return;
      showSuccess(context, 'Device slot revoked.');
      await _loadDevices();
    } catch (e) {
      if (mounted) showError(context, 'Failed to revoke device: $e');
    }
  }

  /// Re-downloadable media only: B-roll/music fetched for exports and audio extracted for
  /// transcription. Rendered videos, recordings and upload staging files are never touched.
  Future<List<Directory>> _cacheDirs() async {
    if (kIsWeb) return const [];
    final tmp = await getTemporaryDirectory();
    final docs = await getApplicationDocumentsDirectory();
    return [Directory('${tmp.path}/studio_media'), Directory('${docs.path}/extracted_audio')];
  }

  /// Files touched in the last few minutes may belong to an export or upload in progress.
  static const _inUseWindow = Duration(minutes: 10);

  Future<List<File>> _cacheFiles() async {
    final out = <File>[];
    for (final d in await _cacheDirs()) {
      if (!await d.exists()) continue;
      await for (final e in d.list(recursive: true, followLinks: false)) {
        if (e is File) out.add(e);
      }
    }
    return out;
  }

  Future<void> _calcCacheSize() async {
    try {
      var totalBytes = 0;
      for (final f in await _cacheFiles()) {
        totalBytes += await f.length();
      }
      if (!mounted) return;
      setState(() => _cacheSizeStr = totalBytes < 1024 * 1024
          ? '${(totalBytes / 1024).toStringAsFixed(1)} KB'
          : '${(totalBytes / (1024 * 1024)).toStringAsFixed(1)} MB');
    } catch (_) {
      if (mounted) setState(() => _cacheSizeStr = 'Unknown');
    }
  }

  Future<void> _clearCache() async {
    setState(() => _clearingCache = true);
    try {
      final cutoff = DateTime.now().subtract(_inUseWindow);
      for (final f in await _cacheFiles()) {
        try {
          if ((await f.lastModified()).isBefore(cutoff)) await f.delete();
        } catch (_) {}
      }
      if (!mounted) return;
      setState(() => _clearingCache = false);
      await _calcCacheSize();
      if (mounted) showSuccess(context, 'Downloaded media cache cleared.');
    } catch (e) {
      if (mounted) {
        setState(() => _clearingCache = false);
        showError(context, 'Error clearing cache: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).valueOrNull;
    final billing = session?.entitlement.creatorBilling;
    final activeProject = ref.watch(activeProjectProvider).valueOrNull;

    String planTitle = 'Creator Access';
    String statusBadge = 'Active';
    Color statusColor = AppTheme.success;
    String planSubtitle = 'Direct creator subscription or daily pass active.';
    String actionButtonText = 'Manage Subscription & Recharge';

    if (billing?.isTrial == true) {
      planTitle = '3-Day Free Trial';
      statusBadge = '${billing?.trialDaysRemaining ?? 0}d left';
      statusColor = AppTheme.warning;
      planSubtitle = 'Complimentary creator trial active. Upgrade or recharge anytime.';
      actionButtonText = 'Subscribe or Recharge';
    } else if (billing?.hasActivePass == true) {
      planTitle = 'Flexible Daily Pass';
      statusBadge = '${billing?.passDaysRemaining ?? 0}d left';
      statusColor = AppTheme.primary;
      planSubtitle = 'Pay-as-you-go creator pass active.';
      actionButtonText = 'Recharge More Days';
    } else if (billing?.hasActiveSubscription == true) {
      planTitle = 'Monthly Creator Plan';
      statusBadge = '\$20/mo';
      statusColor = AppTheme.success;
      planSubtitle = 'Unlimited creator subscription active.';
      actionButtonText = 'Manage Subscription';
    }

    return Scaffold(
      appBar: AppBar(
        title: Text('Settings'),
      ),
      body: ListView(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 20),
        children: [
          // Section: Device Management
          _sectionHeader(context, 'Active Mobile Devices & Sessions', Icons.smartphone_rounded),
          SizedBox(height: 4),
          Text(
            'Manage authorized mobile devices (Android & iOS) and active sessions linked to your account. Up to 20 devices. When the limit is reached, older idle sessions are signed out automatically.',
            style: TextStyle(fontSize: 12, color: Theme.of(context).textTheme.bodyMedium?.color),
          ),
          SizedBox(height: 10),
          Container(
            padding: EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Theme.of(context).dividerColor),
            ),
            child: _loadingDevices
                ? SizedBox(height: 120, child: UniversalSkeleton(type: SkeletonType.activity))
                : _devicesError != null
                    ? ErrorView(error: _devicesError!, compact: true, onRetry: _loadDevices)
                : _devices.isEmpty
                    ? Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No active devices recorded.', style: TextStyle(color: AppTheme.textMuted)),
                      )
                    : Column(
                        children: [
                          for (int i = 0; i < _devices.length; i++) ...[
                            if (i > 0) Divider(height: 1),
                            _buildDeviceTile(_devices[i]),
                          ],
                        ],
                      ),
          ),

          SizedBox(height: 24),

          // Section: Appearance
          _sectionHeader(context, 'Appearance', Icons.palette_outlined),
          const SizedBox(height: 8),
          _card(context, Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SegmentedButton<ThemeMode>(
              key: const Key('settings.theme'),
              showSelectedIcon: true,
              segments: const [
                ButtonSegment(
                  value: ThemeMode.dark,
                  label: Text('Dark'),
                  icon: Icon(Icons.dark_mode_outlined, size: 16),
                ),
                ButtonSegment(
                  value: ThemeMode.light,
                  label: Text('Light'),
                  icon: Icon(Icons.light_mode_outlined, size: 16),
                ),
                ButtonSegment(
                  value: ThemeMode.system,
                  label: Text('System'),
                  icon: Icon(Icons.brightness_auto_outlined, size: 16),
                ),
              ],
              selected: {ref.watch(themeModeProvider)},
              onSelectionChanged: (v) => ref.read(themeModeProvider.notifier).setThemeMode(v.first),
            ),
            const SizedBox(height: 8),
            Text(
              'Choose between Obsidian Dark (pure black & gray mix) and Crisp Light (official 180 blue & white). System dynamically matches your OS appearance.',
              style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
            ),
          ])),

          SizedBox(height: 24),

          // Section: Notifications
          _sectionHeader(context, 'Notifications', Icons.notifications_outlined),
          SizedBox(height: 8),
          _card(context, _pushPanel(context)),

          SizedBox(height: 24),

          // Section: Storage & Cache
          _sectionHeader(context, 'Storage & Media Cache', Icons.storage_rounded),
          SizedBox(height: 8),
          Container(
            padding: EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Theme.of(context).dividerColor),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Temporary Render & B-roll Cache', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                      SizedBox(height: 4),
                      Text('Current cache: $_cacheSizeStr', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                    ],
                  ),
                ),
                FilledButton.tonal(
                  onPressed: _clearingCache ? null : _clearCache,
                  child: _clearingCache
                      ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text('Clear'),
                ),
              ],
            ),
          ),

          SizedBox(height: 24),

          // Section: Creator Subscription & Recharge
          _sectionHeader(context, 'Creator Plan & Access', Icons.workspace_premium_rounded),
          SizedBox(height: 8),
          Container(
            padding: EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      planTitle,
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                      ),
                      child: Text(
                        statusBadge,
                        style: TextStyle(color: statusColor, fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 8),
                Text(
                  planSubtitle,
                  style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                ),
                SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const FeatureLockView()),
                    ),
                    icon: Icon(Icons.bolt_rounded, size: 18),
                    label: Text(actionButtonText),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: 24),

          // Section: Project Settings
          if (activeProject != null) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: _sectionHeader(context, 'Project Settings', Icons.tune_rounded)),
                InkWell(
                  onTap: () => showProjectSwitcherSheet(context, ref),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          activeProject.name,
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.primary),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.unfold_more_rounded, size: 16, color: AppTheme.primary),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            _card(
              context,
              Material(
                color: Colors.transparent,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.tune_rounded, color: AppTheme.primary, size: 20),
                  ),
                  title: Text(activeProject.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  subtitle: Text('Customize name, status, services, workflow & retention', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                  trailing: Icon(Icons.chevron_right_rounded, size: 20, color: AppTheme.textMuted),
                  onTap: () => context.push('/projects/${activeProject.id}/settings'),
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Section: About (real values only)
          _sectionHeader(context, 'About', Icons.info_outline_rounded),
          SizedBox(height: 8),
          _card(context, Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Workspace server', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            SizedBox(height: 4),
            Text(AppConfig.apiBaseUrl, style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
          ])),

          SizedBox(height: 24),

          // Section: What's New & System Updates
          _sectionHeader(context, 'What\'s New & System Updates', Icons.auto_awesome_rounded),
          SizedBox(height: 8),
          Container(
            padding: EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Theme.of(context).dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _updateItem(
                  '🎬 Autonomous Video AI Director',
                  'Chat with the AI Director to splice footage, search unified Pexels/Pixabay stock B-roll, and auto-duck CC0 royalty-free soundtracks under speech.',
                ),
                Divider(height: 16),
                _updateItem(
                  '📱 Real-Time Channel Previews',
                  'Interactive pixel-faithful previews for Instagram, YouTube Shorts, LinkedIn, Facebook, and Twitter/X inside the post composer.',
                ),
                Divider(height: 16),
                _updateItem(
                  '🤖 AI Autopilot Content Calendar',
                  'Multi-agent planner writes 30-day cross-platform schedules. Single-piece AI rewrite allows custom prompts on any calendar piece.',
                ),
                Divider(height: 16),
                _updateItem(
                  '🎨 Brand Consciousness & Cloudflare R2',
                  'Full brand DNA management with direct logo upload to Cloudflare R2, hex palettes, typography, and Hormozi/Ali Abdaal caption styles.',
                ),
                Divider(height: 16),
                _updateItem(
                  '🔗 Client Magic Link Approvals',
                  'Public client review portal with no-login required, allowing clients to leave feedback and approve entire content calendars in batch.',
                ),
              ],
            ),
          ),

          SizedBox(height: 24),

          // Section: Account & Security
          _sectionHeader(context, 'Account & Privacy', Icons.shield_outlined),
          SizedBox(height: 8),
          Container(
            padding: EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Theme.of(context).cardColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Theme.of(context).dividerColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (session != null) ...[
                  Text(session.user.name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                  SizedBox(height: 2),
                  Text('${session.user.email} • ${session.company.name}', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                  Divider(height: 24),
                ],
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.delete_forever_rounded, color: AppTheme.error),
                  title: Text('Delete Account & Data', style: TextStyle(color: AppTheme.error, fontWeight: FontWeight.w600)),
                  subtitle: Text('Permanently delete account, published data, and tenant workspace.'),
                  trailing: Icon(Icons.arrow_forward_ios_rounded, size: 14),
                  onTap: () async {
                    final uri = Uri.parse('https://180workspace.com/account-delete');
                    if (await canLaunchUrl(uri)) {
                      await launchUrl(uri, mode: LaunchMode.externalApplication);
                    }
                  },
                ),
              ],
            ),
          ),

          SizedBox(height: 24),

          // Sign out button
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTheme.error,
              side: BorderSide(color: AppTheme.error),
              minimumSize: Size(double.infinity, 50),
            ),
            onPressed: () async {
              final ok = await confirm(
                context,
                title: 'Sign out?',
                message: 'Queued offline changes stay on this device until you sign back in.',
                action: 'Sign out',
              );
              if (ok) await ref.read(sessionProvider.notifier).logout();
            },
            icon: Icon(Icons.logout_rounded),
            label: Text('Sign out of 180 Workspace'),
          ),

          SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _card(BuildContext context, Widget child) => Container(
        padding: EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Theme.of(context).dividerColor),
        ),
        child: child,
      );

  bool _sendingTest = false;

  Future<void> _sendTestPush() async {
    setState(() => _sendingTest = true);
    try {
      await ref.read(apiClientProvider).post('/api/desktop/push/test');
      if (mounted) showSuccess(context, 'Test notification sent.');
    } catch (e) {
      if (mounted) showError(context, 'Test notification failed: $e');
    } finally {
      if (mounted) setState(() => _sendingTest = false);
    }
  }

  Widget _pushPanel(BuildContext context) {
    final push = ref.watch(pushServiceProvider);
    final ok = push.state == PushState.enabled;
    final color = ok ? AppTheme.success : (push.state == PushState.unknown ? AppTheme.textMuted : AppTheme.warning);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        SizedBox(width: 8),
        Expanded(child: Text(push.label, key: Key('settings.push.status'), style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
      ]),
      if (push.message != null && !ok) ...[
        SizedBox(height: 4),
        Text(push.message!, style: TextStyle(fontSize: 12, color: AppTheme.textMuted), maxLines: 3, overflow: TextOverflow.ellipsis),
      ],
      SizedBox(height: 4),
      Text('Published, failed, needs-approval and reconnect alerts. Tapping one opens the post.',
          style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
      SizedBox(height: 10),
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (!ok && push.state != PushState.notConfiguredOnDevice)
          FilledButton.tonal(
            style: FilledButton.styleFrom(minimumSize: Size(44, 44)),
            onPressed: () => ref.read(pushServiceProvider.notifier).enable(),
            child: Text(push.state == PushState.error ? 'Retry' : 'Enable notifications'),
          ),
        if (push.state == PushState.permissionDenied)
          OutlinedButton(
            style: OutlinedButton.styleFrom(minimumSize: Size(44, 44)),
            onPressed: () => openAppSettings(),
            child: Text('Open system settings'),
          ),
        if (ok)
          OutlinedButton(
            style: OutlinedButton.styleFrom(minimumSize: Size(44, 44)),
            onPressed: _sendingTest ? null : _sendTestPush,
            child: Text('Send test notification'),
          ),
      ]),
    ]);
  }

  Widget _sectionHeader(BuildContext context, String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppTheme.primary),
        SizedBox(width: 8),
        Flexible(child: Text(title, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: -0.2))),
      ],
    );
  }

  Widget _buildDeviceTile(Map<String, dynamic> device) {
    final deviceId = device['deviceId']?.toString() ?? '';
    final label = device['label']?.toString() ?? 'Mobile Device';
    final platform = device['platform']?.toString().toLowerCase() ?? 'android';
    final isCurrent = device['current'] == true || deviceId == _currentDeviceId;
    final sessionCount = (device['sessionCount'] as num?)?.toInt() ?? 1;
    final lastSeen = device['lastSeenAt'] != null
        ? DateTime.fromMillisecondsSinceEpoch((device['lastSeenAt'] as num).toInt())
        : null;

    final icon = platform.contains('ios') || platform.contains('apple')
        ? Icons.phone_iphone_rounded
        : platform.contains('android')
            ? Icons.phone_android_rounded
            : Icons.smartphone_rounded;

    return ListTile(
      contentPadding: EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      leading: CircleAvatar(
        backgroundColor: isCurrent ? AppTheme.primary.withValues(alpha: 0.2) : Theme.of(context).dividerColor,
        child: Icon(icon, color: isCurrent ? AppTheme.primary : AppTheme.textMuted, size: 20),
      ),
      title: Row(
        children: [
          Expanded(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                ),
                if (sessionCount > 1) ...[
                  SizedBox(width: 6),
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceElevated,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: AppTheme.border),
                    ),
                    child: Text(
                      '($sessionCount times)',
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (isCurrent) ...[
            SizedBox(width: 6),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.primary.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: AppTheme.primary.withValues(alpha: 0.5)),
              ),
              child: Text('THIS DEVICE', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.primary)),
            ),
          ],
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            lastSeen != null ? 'Last active: ${DateFormat('MMM d, h:mm a').format(lastSeen)}' : 'Registered device',
            style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
          ),
          if (sessionCount > 1)
            Text(
              '$sessionCount active sessions linked to this device',
              style: TextStyle(fontSize: 10, color: AppTheme.textMuted),
            ),
        ],
      ),
      trailing: isCurrent
          ? null
          : IconButton(
              icon: Icon(Icons.remove_circle_outline_rounded, color: AppTheme.error, size: 20),
              tooltip: 'Revoke device',
              onPressed: () => _revokeDevice(deviceId, label, sessionCount: sessionCount),
            ),
    );
  }

  Widget _updateItem(String title, String description) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
          SizedBox(height: 3),
          Text(description, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.35)),
        ],
      ),
    );
  }
}
