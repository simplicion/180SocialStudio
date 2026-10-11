import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/library.dart';
import '../../data/models/project.dart';
import '../../data/models/social_post.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../posts/post_providers.dart';

final evergreenSlotsProvider = FutureProvider.autoDispose.family<List<EvergreenSlot>, String>(
    (ref, projectId) => ref.watch(socialApiProvider).listEvergreenSlots(projectId));

/// Evergreen queue: weekly recurring slots and the posts eligible to fill them.
class EvergreenTab extends ConsumerWidget {
  const EvergreenTab({super.key, required this.project});
  final Project project;

  Future<void> _addSlot(BuildContext context, WidgetRef ref) async {
    var day = 1;
    var time = TimeOfDay(hour: 10, minute: 0);
    var category = EvergreenSlot.categoryPresets.first;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          backgroundColor: AppTheme.surfaceElevated,
          title: Text('New evergreen slot'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<int>(
              isExpanded: true,
              initialValue: day,
              decoration: fieldDecoration('Day'),
              items: [for (var i = 0; i < 7; i++) DropdownMenuItem(value: i, child: Text(EvergreenSlot.dayNames[i]))],
              onChanged: (v) => set(() => day = v ?? 1),
            ),
            SizedBox(height: 12),
            OutlinedButton.icon(
              icon: Icon(Icons.schedule_rounded),
              label: Text('${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')} UTC'),
              onPressed: () async {
                final t = await showTimePicker(context: ctx, initialTime: time, helpText: 'Time (UTC)');
                if (t != null) set(() => time = t);
              },
            ),
            SizedBox(height: 12),
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: category,
              decoration: fieldDecoration('Category'),
              items: [for (final c in EvergreenSlot.categoryPresets) DropdownMenuItem(value: c, child: Text(c))],
              onChanged: (v) => set(() => category = v ?? category),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text('Add')),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    final slot = await guarded(
      context,
      () => ref.read(socialApiProvider).createEvergreenSlot(
            projectId: project.id,
            dayOfWeek: day,
            timeSlotUtc: '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
            category: category,
          ),
    );
    if (slot != null && context.mounted) ref.invalidate(evergreenSlotsProvider(project.id));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final slots = ref.watch(evergreenSlotsProvider(project.id));
    final q = PostQuery(projectId: project.id, isEvergreen: true);
    final posts = ref.watch(projectPostsProvider(q));
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(evergreenSlotsProvider(project.id));
        ref.invalidate(projectPostsProvider(q));
      },
      child: ListView(padding: EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
        SectionHeader('Weekly slots',
            trailing: TextButton.icon(
                onPressed: () => _addSlot(context, ref), icon: Icon(Icons.add_rounded, size: 18), label: Text('Add slot'))),
        slots.when(
          loading: () => Padding(padding: EdgeInsets.all(16), child: LoadingView()),
          error: (e, _) => ErrorView(error: e, compact: true, onRetry: () => ref.invalidate(evergreenSlotsProvider(project.id))),
          data: (list) => list.isEmpty
              ? SectionCard(child: Text('No slots. Add one to recycle top content automatically.'))
              : Column(children: [
                  for (final s in [...list]..sort((a, b) => a.dayOfWeek != b.dayOfWeek ? a.dayOfWeek.compareTo(b.dayOfWeek) : a.timeSlotUtc.compareTo(b.timeSlotUtc)))
                    Padding(
                      padding: EdgeInsets.only(bottom: 8),
                      child: SectionCard(
                        padding: EdgeInsets.fromLTRB(12, 4, 4, 4),
                        child: Row(children: [
                          Icon(Icons.autorenew_rounded, color: AppTheme.success),
                          SizedBox(width: 12),
                          Expanded(child: Text('${s.dayName} · ${s.timeSlotUtc} UTC\n${s.category}')),
                          if (!s.isActive) StatusChip(label: 'Paused', color: AppTheme.textMuted),
                          IconButton(
                            icon: Icon(Icons.delete_outline_rounded),
                            onPressed: () async {
                              if (!await confirm(context, title: 'Delete slot?', message: '${s.dayName} ${s.timeSlotUtc} UTC', action: 'Delete', destructive: true)) return;
                              if (!context.mounted) return;
                              await guarded(context, () => ref.read(socialApiProvider).deleteEvergreenSlot(s.id));
                              if (context.mounted) ref.invalidate(evergreenSlotsProvider(project.id));
                            },
                          ),
                        ]),
                      ),
                    ),
                ]),
        ),
        SectionHeader('Evergreen posts'),
        posts.when(
          loading: () => Padding(padding: EdgeInsets.all(16), child: LoadingView()),
          error: (e, _) => ErrorView(error: e, compact: true, onRetry: () => ref.invalidate(projectPostsProvider(q))),
          data: (list) => list.isEmpty
              ? SectionCard(child: Text('Mark a post as Evergreen in the composer to add it here.'))
              : Column(children: [
                  for (final SocialPost p in list)
                    PostTile(post: p, trailing: Text('×${p.reuseCount}', style: Theme.of(context).textTheme.labelSmall)),
                ]),
        ),
      ]),
    );
  }
}
