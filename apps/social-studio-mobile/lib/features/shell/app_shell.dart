import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../projects/project_provider.dart';

/// Bottom navigation: Home (active project), Planner (AI calendars), Inbox, Library, Studio.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  static const _destinations = [
    (Icons.dashboard_rounded, 'Home'),
    (Icons.calendar_month_rounded, 'Planner'),
    (Icons.forum_rounded, 'Inbox'),
    (Icons.perm_media_rounded, 'Library'),
    (Icons.videocam_rounded, 'Studio'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unreadInbox = ref.watch(unreadInboxCountProvider);
    final pendingApprovals = ref.watch(pendingApprovalsCountProvider);

    int getBadgeCount(String label) {
      if (label == 'Inbox') return unreadInbox;
      if (label == 'Planner') return pendingApprovals;
      return 0;
    }

    Color getBadgeColor(String label) {
      if (label == 'Inbox') return AppTheme.error;
      if (label == 'Planner') return AppTheme.warning;
      return AppTheme.primary;
    }

    Widget buildNavIcon(IconData icon, Color color, int count, Color badgeColor) {
      final baseIcon = Icon(icon, color: color);
      if (count <= 0) return baseIcon;
      return Badge.count(
        count: count,
        backgroundColor: badgeColor,
        textColor: Colors.white,
        child: baseIcon,
      );
    }

    return Scaffold(
      body: shell,
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          border: Border(top: BorderSide(color: AppTheme.border)),
        ),
        child: NavigationBar(
          selectedIndex: shell.currentIndex,
          backgroundColor: Colors.transparent,
          indicatorColor: AppTheme.primary.withValues(alpha: 0.25),
          onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
          destinations: [
            for (final (icon, label) in _destinations)
              NavigationDestination(
                icon: buildNavIcon(
                  icon,
                  AppTheme.textSecondary,
                  getBadgeCount(label),
                  getBadgeColor(label),
                ),
                selectedIcon: buildNavIcon(
                  icon,
                  AppTheme.primary,
                  getBadgeCount(label),
                  getBadgeColor(label),
                ),
                label: label,
              ),
          ],
        ),
      ),
    );
  }
}
