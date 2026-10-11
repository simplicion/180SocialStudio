import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/project.dart';
import '../../data/models/social_post.dart';
import '../dashboard/studio_dashboard_screen.dart';
import '../posts/post_providers.dart';

/// Posts closer together than this on one project compete for the same audience.
const cannibalizationWindow = Duration(minutes: 15);

/// Groups of posts scheduled within [cannibalizationWindow] of each other.
List<List<SocialPost>> findCannibalization(List<SocialPost> posts) {
  final dated = posts.where((p) => p.scheduledFor != null).toList()..sort((a, b) => a.scheduledFor!.compareTo(b.scheduledFor!));
  final groups = <List<SocialPost>>[];
  var current = <SocialPost>[];
  for (final p in dated) {
    if (current.isNotEmpty && p.scheduledFor!.difference(current.last.scheduledFor!) < cannibalizationWindow) {
      current.add(p);
    } else {
      if (current.length > 1) groups.add(current);
      current = [p];
    }
  }
  if (current.length > 1) groups.add(current);
  return groups;
}

/// Project calendar (web `tabs/CalendarTab.tsx`): month grid or list, tap a day to draft.
class CalendarTab extends ConsumerStatefulWidget {
  const CalendarTab({super.key, required this.project});
  final Project project;

  @override
  ConsumerState<CalendarTab> createState() => _CalendarTabState();
}

class _CalendarTabState extends ConsumerState<CalendarTab> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  bool _list = false;
  DateTime? _selectedDay;

  PostQuery get _query => PostQuery(
        projectId: widget.project.id,
        from: _month,
        to: DateTime(_month.year, _month.month + 1),
      );

  @override
  Widget build(BuildContext context) {
    final posts = ref.watch(projectPostsProvider(_query));
    return Column(children: [
      Padding(
        padding: EdgeInsets.fromLTRB(8, 4, 8, 0),
        child: Row(children: [
          IconButton(
            icon: Icon(Icons.chevron_left_rounded),
            onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
          ),
          Expanded(
            child: Text(DateFormat('MMMM yyyy').format(_month),
                textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          ),
          IconButton(
            icon: Icon(Icons.chevron_right_rounded),
            onPressed: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
          ),
          IconButton(
            tooltip: _list ? 'Month view' : 'List view',
            icon: Icon(_list ? Icons.calendar_view_month_rounded : Icons.view_agenda_rounded),
            onPressed: () => setState(() => _list = !_list),
          ),
        ]),
      ),
      Padding(
        padding: EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton.icon(
              onPressed: () => context.push('/posts/new?projectId=${widget.project.id}'),
              icon: Icon(Icons.add_rounded, size: 18),
              label: Text('Create content'),
            ),
          ],
        ),
      ),
      Expanded(
        child: AsyncBody<List<SocialPost>>(
          value: posts,
          onRetry: () => ref.invalidate(projectPostsProvider(_query)),
          builder: (all) {
            // Servers without the range filter return everything; keep this month only.
            final inMonth = all
                .where((p) => p.scheduledFor != null && p.scheduledFor!.year == _month.year && p.scheduledFor!.month == _month.month)
                .toList()
              ..sort((a, b) => a.scheduledFor!.compareTo(b.scheduledFor!));
            final clashes = findCannibalization(inMonth);
            return RefreshIndicator(
              onRefresh: () async => ref.invalidate(projectPostsProvider(_query)),
              child: ListView(padding: EdgeInsets.fromLTRB(12, 8, 12, 96), children: [
                if (all.length >= 200)
                  Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: StatusChip(
                        label: 'Showing the first 200 posts; some may be missing', color: AppTheme.warning, icon: Icons.warning_rounded),
                  ),
                for (final g in clashes)
                  Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: SectionCard(
                      padding: EdgeInsets.all(12),
                      borderColor: AppTheme.warning.withValues(alpha: 0.6),
                      child: Row(children: [
                        Icon(Icons.warning_amber_rounded, color: AppTheme.warning),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(
                              '${g.length} posts within 15 minutes on ${fmtDateTime(g.first.scheduledFor)}: they will compete for reach.'),
                        ),
                      ]),
                    ),
                  ),
                if (_list) ...[
                  if (inMonth.isEmpty) SectionCard(child: Text('Nothing scheduled this month.')),
                  for (final p in inMonth) PostTile(post: p),
                ] else ...[
                  _MonthGrid(
                    month: _month,
                    posts: inMonth,
                    selected: _selectedDay,
                    onSelect: (d) => setState(() => _selectedDay = d),
                  ),
                  if (_selectedDay != null) ..._dayDetail(inMonth),
                ],
              ]),
            );
          },
        ),
      ),
    ]);
  }

  List<Widget> _dayDetail(List<SocialPost> inMonth) {
    final d = _selectedDay!;
    final dayPosts = inMonth.where((p) => DateUtils.isSameDay(p.scheduledFor, d)).toList();
    return [
      SectionHeader(DateFormat('EEEE d MMMM').format(d),
          trailing: TextButton.icon(
            onPressed: () {
              final at = DateTime(d.year, d.month, d.day, 10);
              context.push('/posts/new?projectId=${widget.project.id}&date=${Uri.encodeQueryComponent(at.toIso8601String())}');
            },
            icon: Icon(Icons.add_rounded, size: 18),
            label: Text('Add'),
          )),
      if (dayPosts.isEmpty) SectionCard(child: Text('No posts on this day.')),
      for (final p in dayPosts) PostTile(post: p),
    ];
  }
}

class _MonthGrid extends StatelessWidget {
  const _MonthGrid({required this.month, required this.posts, required this.selected, required this.onSelect});
  final DateTime month;
  final List<SocialPost> posts;
  final DateTime? selected;
  final ValueChanged<DateTime> onSelect;

  @override
  Widget build(BuildContext context) {
    final first = DateTime(month.year, month.month);
    final lead = first.weekday % 7; // Sunday first
    final days = DateUtils.getDaysInMonth(month.year, month.month);
    final cells = ((lead + days) / 7).ceil() * 7;
    final today = DateTime.now();
    return Column(children: [
      Row(children: [
        for (final w in ['S', 'M', 'T', 'W', 'T', 'F', 'S'])
          Expanded(child: Center(child: Text(w, style: Theme.of(context).textTheme.labelSmall))),
      ]),
      SizedBox(height: 4),
      GridView.builder(
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        itemCount: cells,
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7, childAspectRatio: 0.62),
        itemBuilder: (_, i) {
          final dayNum = i - lead + 1;
          if (dayNum < 1 || dayNum > days) return SizedBox.shrink();
          final date = DateTime(month.year, month.month, dayNum);
          final dayPosts = posts.where((p) => DateUtils.isSameDay(p.scheduledFor, date)).toList();
          final isSel = DateUtils.isSameDay(selected, date);
          final isToday = DateUtils.isSameDay(today, date);
          return InkWell(
            key: Key('calendarDay.$dayNum'),
            onTap: () => onSelect(date),
            child: Container(
              margin: EdgeInsets.all(1.5),
              padding: EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: isSel ? AppTheme.primary.withValues(alpha: 0.2) : AppTheme.surface,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: isToday ? AppTheme.primary : AppTheme.border),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('$dayNum', style: TextStyle(fontSize: 11, fontWeight: isToday ? FontWeight.w800 : FontWeight.w500)),
                for (final p in dayPosts.take(2))
                  Container(
                    margin: EdgeInsets.only(top: 2),
                    height: 5,
                    decoration: BoxDecoration(color: p.status.color, borderRadius: BorderRadius.circular(2)),
                  ),
                if (dayPosts.length > 2)
                  Text('+${dayPosts.length - 2}', style: TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
              ]),
            ),
          );
        },
      ),
    ]);
  }
}
