import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/autopilot.dart';
import '../../data/models/content_calendar.dart';
import '../posts/platform_post_preview.dart';
import '../projects/project_provider.dart';
import 'carousel_sheet.dart';
import 'piece_clips_section.dart';
import 'planner_providers.dart';
import 'raw_footage_upload.dart';

/// Calendar detail (web `content-calendar/[id]`):
/// Interactive Date Grid (primary default view), stats, goals, pillars, pieces by week, and Master SOP production sheets.
class CalendarDetailScreen extends ConsumerStatefulWidget {
  const CalendarDetailScreen({super.key, required this.calendarId});
  final String calendarId;

  @override
  ConsumerState<CalendarDetailScreen> createState() => _CalendarDetailScreenState();
}

class _CalendarDetailScreenState extends ConsumerState<CalendarDetailScreen> {
  bool _isGridView = true;
  DateTime? _selectedDate;
  late DateTime _displayedMonth;
  bool _monthInitialized = false;

  @override
  void initState() {
    super.initState();
    _displayedMonth = DateTime(DateTime.now().year, DateTime.now().month, 1);
  }

  void _initMonthFromCalendar(ContentCalendar c) {
    if (_monthInitialized) return;
    _monthInitialized = true;
    for (final p in c.pieces) {
      if (p.dateScheduled != null) {
        _displayedMonth = DateTime(p.dateScheduled!.year, p.dateScheduled!.month, 1);
        return;
      }
    }
    if (c.startDate != null) {
      _displayedMonth = DateTime(c.startDate!.year, c.startDate!.month, 1);
    }
  }

  void _prevMonth() {
    setState(() {
      _displayedMonth = DateTime(_displayedMonth.year, _displayedMonth.month - 1, 1);
    });
  }

  void _nextMonth() {
    setState(() {
      _displayedMonth = DateTime(_displayedMonth.year, _displayedMonth.month + 1, 1);
    });
  }

  @override
  Widget build(BuildContext context) {
    final cal = ref.watch(calendarDetailProvider(widget.calendarId));
    final calendar = cal.valueOrNull;
    if (calendar != null) {
      _initMonthFromCalendar(calendar);
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(calendar?.displayName ?? 'Calendar'),
        actions: [
          IconButton(
            icon: Icon(_isGridView ? Icons.view_agenda_outlined : Icons.calendar_month_rounded),
            tooltip: _isGridView ? 'Switch to Week List' : 'Switch to Date Grid',
            onPressed: () => setState(() => _isGridView = !_isGridView),
          ),
          if (cal.hasValue)
            PopupMenuButton<String>(
              color: AppTheme.surfaceElevated,
              onSelected: (v) async {
                final c = cal.value!;
                if (v == 'extend') {
                  context.push('/planner/new', extra: c);
                } else if (v == 'delete') {
                  if (!await confirm(context,
                      title: 'Delete calendar?',
                      message: 'All ${c.totalPieces} pieces are removed.',
                      action: 'Delete',
                      destructive: true)) {
                    return;
                  }
                  if (!context.mounted) return;
                  final ok = await guarded(context, () async {
                    await ref.read(socialApiProvider).deleteCalendar(c.id);
                    return true;
                  });
                  if (ok == true && context.mounted) {
                    ref.invalidate(calendarsProvider);
                    context.pop();
                  }
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'extend', child: Text('Extend for next period')),
                PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: AppTheme.error))),
              ],
            ),
        ],
      ),
      body: AsyncBody<ContentCalendar>(
        value: cal,
        skeleton: SkeletonType.calendar,
        onRetry: () => ref.invalidate(calendarDetailProvider(widget.calendarId)),
        builder: (c) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(calendarDetailProvider(widget.calendarId)),
          child: ListView(padding: EdgeInsets.fromLTRB(16, 8, 16, 48), children: [
            // Overview card
            SectionCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(c.displayName, style: Theme.of(context).textTheme.titleLarge)),
                  StatusChip(label: c.status.label, color: c.status.color),
                ]),
                SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  if (c.calendarDuration != null)
                    StatusChip(label: c.calendarDuration!, color: AppTheme.textSecondary, icon: Icons.timelapse_rounded),
                  if (c.frequency != null)
                    StatusChip(label: c.frequency!, color: AppTheme.textSecondary, icon: Icons.repeat_rounded),
                  StatusChip(label: '${c.totalPieces} pieces', color: AppTheme.accentBlue),
                  if (c.reelsCount > 0) StatusChip(label: '${c.reelsCount} reels', color: AppTheme.accent),
                  if (c.postsCount > 0) StatusChip(label: '${c.postsCount} posts', color: AppTheme.accentBlue),
                  if (c.carouselsCount > 0) StatusChip(label: '${c.carouselsCount} carousels', color: AppTheme.success),
                ]),
                if (c.engagementGoal?.isNotEmpty ?? false) ...[
                  SizedBox(height: 10),
                  Text('Goal: ${c.engagementGoal}', style: Theme.of(context).textTheme.bodyMedium),
                ],
                if (c.contentPillars.isNotEmpty) ...[
                  SizedBox(height: 6),
                  Text('Pillars: ${c.contentPillars.join(', ')}', style: Theme.of(context).textTheme.bodyMedium),
                ],
              ]),
            ),

            if (c.pieces.isEmpty)
              Padding(
                padding: EdgeInsets.only(top: 24),
                child: EmptyView(
                  icon: Icons.hourglass_empty_rounded,
                  title: 'No pieces yet',
                  message: 'If the calendar is still processing, pull to refresh.',
                ),
              ),

            // Date Grid View (Primary Default)
            if (c.pieces.isNotEmpty && _isGridView) ...[
              SizedBox(height: 12),
              _CalendarDateGrid(
                calendar: c,
                displayedMonth: _displayedMonth,
                onPrevMonth: _prevMonth,
                onNextMonth: _nextMonth,
                selectedDate: _selectedDate,
                onSelectDate: (d) => setState(() => _selectedDate = d),
              ),
            ],

            // Pieces list (by week)
            if (c.pieces.isNotEmpty) ...[
              SizedBox(height: 16),
              for (final week in c.piecesByWeek.entries) ...[
                SectionHeader('Week ${week.key}'),
                for (final p in week.value) _PieceTile(calendar: c, piece: p),
              ],
            ],
          ]),
        ),
      ),
    );
  }
}

/// Interactive 7-day calendar date grid with status and format indicators.
class _CalendarDateGrid extends StatelessWidget {
  const _CalendarDateGrid({
    required this.calendar,
    required this.displayedMonth,
    required this.onPrevMonth,
    required this.onNextMonth,
    required this.selectedDate,
    required this.onSelectDate,
  });

  final ContentCalendar calendar;
  final DateTime displayedMonth;
  final VoidCallback onPrevMonth;
  final VoidCallback onNextMonth;
  final DateTime? selectedDate;
  final ValueChanged<DateTime> onSelectDate;

  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    final daysInMonth = DateUtils.getDaysInMonth(displayedMonth.year, displayedMonth.month);
    final firstWeekday = DateTime(displayedMonth.year, displayedMonth.month, 1).weekday; // 1 = Mon, 7 = Sun
    final leadingSlots = firstWeekday - 1;
    final totalSlots = leadingSlots + daysInMonth;

    return SectionCard(
      padding: EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // Month navigation header
        Row(children: [
          Icon(Icons.calendar_month_rounded, color: AppTheme.primary, size: 20),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              DateFormat('MMMM yyyy').format(displayedMonth),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
          ),
          IconButton(
            icon: Icon(Icons.chevron_left_rounded),
            tooltip: 'Previous month',
            onPressed: onPrevMonth,
          ),
          IconButton(
            icon: Icon(Icons.chevron_right_rounded),
            tooltip: 'Next month',
            onPressed: onNextMonth,
          ),
        ]),
        SizedBox(height: 8),

        // Weekday column headers
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            for (final d in _weekdays)
              Expanded(
                child: Center(
                  child: Text(
                    d,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ),
              ),
          ],
        ),
        SizedBox(height: 6),

        // Date Grid
        GridView.builder(
          shrinkWrap: true,
          physics: NeverScrollableScrollPhysics(),
          itemCount: totalSlots,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 7,
            crossAxisSpacing: 5,
            mainAxisSpacing: 5,
            childAspectRatio: 0.92,
          ),
          itemBuilder: (ctx, index) {
            if (index < leadingSlots) {
              return SizedBox.shrink();
            }
            final day = index - leadingSlots + 1;
            final date = DateTime(displayedMonth.year, displayedMonth.month, day);

            // Filter pieces on this date
            final piecesOnDay = calendar.pieces.where((p) {
              if (p.dateScheduled == null) return false;
              return p.dateScheduled!.year == date.year &&
                  p.dateScheduled!.month == date.month &&
                  p.dateScheduled!.day == date.day;
            }).toList();

            final hasPieces = piecesOnDay.isNotEmpty;
            final isSelected = selectedDate != null &&
                selectedDate!.year == date.year &&
                selectedDate!.month == date.month &&
                selectedDate!.day == date.day;

            final reelsCount = piecesOnDay
                .where((p) =>
                    p.contentType.toLowerCase().contains('reel') || p.contentType.toLowerCase().contains('video'))
                .length;
            final carouselsCount =
                piecesOnDay.where((p) => p.contentType.toLowerCase().contains('carousel')).length;
            final postsCount = piecesOnDay.length - reelsCount - carouselsCount;

            return InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () {
                onSelectDate(date);
                if (hasPieces) {
                  showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    backgroundColor: AppTheme.surface,
                    builder: (_) => DayScheduleSheet(calendar: calendar, date: date, pieces: piecesOnDay),
                  );
                } else {
                  showInfo(context, 'No pieces scheduled on ${fmtDate(date)}');
                }
              },
              child: Container(
                decoration: BoxDecoration(
                  color: isSelected
                      ? AppTheme.primary.withValues(alpha: 0.25)
                      : hasPieces
                          ? AppTheme.primary.withValues(alpha: 0.10)
                          : AppTheme.surfaceElevated.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isSelected
                        ? AppTheme.primary
                        : hasPieces
                            ? AppTheme.primary.withValues(alpha: 0.45)
                            : AppTheme.border.withValues(alpha: 0.3),
                    width: isSelected ? 1.5 : 1,
                  ),
                ),
                padding: EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '$day',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: hasPieces ? FontWeight.bold : FontWeight.normal,
                        color: hasPieces ? Colors.white : AppTheme.textSecondary.withValues(alpha: 0.7),
                      ),
                    ),
                    if (hasPieces)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          if (reelsCount > 0)
                            Container(
                              width: 6,
                              height: 6,
                              margin: EdgeInsets.symmetric(horizontal: 1),
                              decoration: BoxDecoration(color: AppTheme.accent, shape: BoxShape.circle),
                            ),
                          if (carouselsCount > 0)
                            Container(
                              width: 6,
                              height: 6,
                              margin: EdgeInsets.symmetric(horizontal: 1),
                              decoration: BoxDecoration(color: AppTheme.success, shape: BoxShape.circle),
                            ),
                          if (postsCount > 0)
                            Container(
                              width: 6,
                              height: 6,
                              margin: EdgeInsets.symmetric(horizontal: 1),
                              decoration: BoxDecoration(color: AppTheme.accentBlue, shape: BoxShape.circle),
                            ),
                        ],
                      )
                    else
                      SizedBox(height: 6),
                  ],
                ),
              ),
            );
          },
        ),
        SizedBox(height: 10),

        // Legend row
        Wrap(
          spacing: 12,
          runSpacing: 4,
          children: [
            _legendDot(AppTheme.accent, 'Reel / Video'),
            _legendDot(AppTheme.success, 'Carousel'),
            _legendDot(AppTheme.accentBlue, 'Post'),
            Text('• Tap scheduled date to view & produce',
                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary, fontStyle: FontStyle.italic)),
          ],
        ),
      ]),
    );
  }

  Widget _legendDot(Color color, String label) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 7, height: 7, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
        ],
      );
}

/// Day schedule bottom sheet when a user taps a date cell in the date grid.
class DayScheduleSheet extends StatelessWidget {
  const DayScheduleSheet({
    super.key,
    required this.calendar,
    required this.date,
    required this.pieces,
  });

  final ContentCalendar calendar;
  final DateTime date;
  final List<CalendarPiece> pieces;

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.65,
      maxChildSize: 0.90,
      builder: (_, scroll) => ListView(
        controller: scroll,
        padding: EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(color: AppTheme.border, borderRadius: BorderRadius.circular(2)),
            ),
          ),
          SizedBox(height: 14),
          Row(
            children: [
              Icon(Icons.event_note_rounded, color: AppTheme.primary),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      DateFormat('EEEE, MMM d, yyyy').format(date),
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    Text(
                      '${pieces.length} piece${pieces.length == 1 ? '' : 's'} scheduled',
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                    ),
                  ],
                ),
              ),
              IconButton(icon: Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context)),
            ],
          ),
          SizedBox(height: 16),
          for (final p in pieces) ...[
            _DayPieceCard(calendar: calendar, piece: p),
            SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

class _DayPieceCard extends StatelessWidget {
  const _DayPieceCard({required this.calendar, required this.piece});
  final ContentCalendar calendar;
  final CalendarPiece piece;

  @override
  Widget build(BuildContext context) {
    final brief = PieceBrief.parse(piece.videoScriptOrHooks);
    final hook = brief?.spokenHook ?? brief?.openingHook;
    final isCarousel = piece.contentType.toLowerCase().contains('carousel');
    final isVideo = piece.contentType.toLowerCase().contains('reel') ||
        piece.contentType.toLowerCase().contains('video') ||
        piece.contentType.toLowerCase().contains('short');

    return SectionCard(
      padding: EdgeInsets.all(14),
      onTap: () {
        Navigator.pop(context);
        showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          backgroundColor: AppTheme.surface,
          builder: (_) => PieceSheet(calendar: calendar, piece: piece),
        );
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          StatusChip(
            label: piece.contentType.isEmpty ? 'Post' : piece.contentType,
            color: isVideo ? AppTheme.accent : isCarousel ? AppTheme.success : AppTheme.accentBlue,
          ),
          SizedBox(width: 6),
          StatusChip(label: piece.status.label, color: piece.status.color),
          if (brief != null && brief.timedBeats.isNotEmpty) ...[
            SizedBox(width: 6),
            StatusChip(label: 'Script ${brief.spokenSeconds.toStringAsFixed(0)}s', color: AppTheme.accent),
          ],
          if (piece.psychologicalJob?.isNotEmpty == true || brief?.psychologicalJob?.isNotEmpty == true) ...[
            SizedBox(width: 6),
            Expanded(
              child: Text(
                '🧠 ${piece.psychologicalJob ?? brief?.psychologicalJob}',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: AppTheme.primary, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ]),
        SizedBox(height: 8),
        Text(
          piece.headline.isEmpty ? '(No headline)' : piece.headline,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        if (hook?.isNotEmpty == true) ...[
          SizedBox(height: 6),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: AppTheme.surfaceElevated,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: AppTheme.border.withValues(alpha: 0.5)),
            ),
            child: Row(
              children: [
                Icon(Icons.format_quote_rounded, size: 14, color: AppTheme.accent),
                SizedBox(width: 6),
                Expanded(
                  child: Text(
                    hook!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: Colors.white70),
                  ),
                ),
              ],
            ),
          ),
        ],
        SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact),
              onPressed: () {
                Navigator.pop(context);
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: AppTheme.surface,
                  builder: (_) => PieceSheet(calendar: calendar, piece: piece),
                );
              },
              icon: Icon(Icons.description_rounded, size: 14),
              label: Text('Brief'),
            ),
          ),
          if (isVideo || brief?.hasScript == true) ...[
            SizedBox(width: 6),
            Expanded(
              child: FilledButton.tonalIcon(
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  backgroundColor: AppTheme.primary.withValues(alpha: 0.15),
                  foregroundColor: AppTheme.primary,
                ),
                onPressed: () {
                  Navigator.pop(context);
                  context.push(
                    '/planner/script?calendarId=${calendar.id}&pieceId=${piece.id}',
                    extra: {
                      'piece': piece,
                      'calendar': calendar,
                    },
                  );
                },
                icon: Icon(Icons.menu_book_rounded, size: 14),
                label: Text('Full script'),
              ),
            ),
            SizedBox(width: 6),
            Expanded(
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  backgroundColor: AppTheme.accent,
                  foregroundColor: Colors.white,
                ),
                onPressed: () {
                  Navigator.pop(context);
                  context.push('/camera', extra: {
                    'hook': hook ?? piece.headline,
                    'script': brief?.teleprompterText ?? piece.videoScriptOrHooks,
                    'projectId': calendar.projectId,
                    'pieceId': piece.id,
                  });
                },
                icon: Icon(Icons.videocam_rounded, size: 14),
                label: Text('Shoot'),
              ),
            ),
          ] else if (isCarousel && calendar.projectId != null) ...[
            SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  backgroundColor: AppTheme.success,
                  foregroundColor: Colors.white,
                ),
                onPressed: () {
                  Navigator.pop(context);
                  showCarouselSheet(context,
                      projectId: calendar.projectId!, pieceId: piece.id, title: piece.headline);
                },
                icon: Icon(Icons.view_carousel_rounded, size: 14),
                label: Text('Design'),
              ),
            ),
          ],
        ]),
      ]),
    );
  }
}

class _PieceTile extends StatelessWidget {
  const _PieceTile({required this.calendar, required this.piece});
  final ContentCalendar calendar;
  final CalendarPiece piece;

  @override
  Widget build(BuildContext context) {
    final brief = PieceBrief.parse(piece.videoScriptOrHooks);
    final isVideo = piece.contentType.toLowerCase().contains('reel') ||
        piece.contentType.toLowerCase().contains('video') ||
        piece.contentType.toLowerCase().contains('short');
    final hasScript = isVideo || brief?.hasScript == true;

    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: SectionCard(
        padding: EdgeInsets.all(12),
        onTap: () => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          backgroundColor: AppTheme.surface,
          builder: (_) => PieceSheet(calendar: calendar, piece: piece),
        ),
        child: Row(children: [
          Container(width: 4, height: 40, decoration: BoxDecoration(color: piece.status.color, borderRadius: BorderRadius.circular(2))),
          SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(piece.headline.isEmpty ? '(no headline)' : piece.headline,
                  maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600)),
              SizedBox(height: 4),
              Text(
                [
                  fmtDate(piece.dateScheduled),
                  piece.platform,
                  piece.contentType,
                  if (hasScript && brief != null && brief.timedBeats.isNotEmpty) 'Script ${brief.spokenSeconds.toStringAsFixed(0)}s',
                  piece.status.label,
                ].where((s) => s.isNotEmpty).join(' · '),
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ]),
          ),
          if (hasScript) ...[
            IconButton(
              icon: Icon(Icons.menu_book_rounded, size: 18, color: AppTheme.accent),
              tooltip: 'Full script',
              onPressed: () => context.push(
                '/planner/script?calendarId=${calendar.id}&pieceId=${piece.id}',
                extra: {
                  'piece': piece,
                  'calendar': calendar,
                },
              ),
            ),
          ],
        ]),
      ),
    );
  }
}

class PieceSheet extends ConsumerStatefulWidget {
  const PieceSheet({super.key, required this.calendar, required this.piece});
  final ContentCalendar calendar;
  final CalendarPiece piece;

  @override
  ConsumerState<PieceSheet> createState() => _PieceSheetState();
}

class _PieceSheetState extends ConsumerState<PieceSheet> {
  late PieceStatus _status = widget.piece.status;
  late CalendarPiece _currentPiece = widget.piece;
  bool _isEditing = false;
  bool _saving = false;
  bool _regenerating = false;

  late final _headline = TextEditingController(text: _currentPiece.headline);
  late final _adCopy = TextEditingController(text: _currentPiece.adCopyFull);
  late final _script = TextEditingController(text: _currentPiece.videoScriptOrHooks);
  late final _cta = TextEditingController(text: _currentPiece.callToAction);
  late final _hashtags = TextEditingController(text: _currentPiece.hashtags.join(' '));
  late final _visualBrief = TextEditingController(text: _currentPiece.visualAssetsBrief);

  /// Autopilot pieces store a structured brief (JSON) in `videoScriptOrHooks`; older ones are plain text.
  PieceBrief? get _brief => PieceBrief.parse(_script.text);
  String? get _hookLine => _brief?.openingHook ?? _script.text.split('\n').firstOrNull;
  String get _prompterScript {
    final b = _brief;
    if (b == null) return _script.text;
    return b.hasScript ? b.teleprompterText : '';
  }

  bool get _isVideoPiece {
    final t = _currentPiece.contentType.toLowerCase();
    return t.contains('video') || t.contains('reel') || t.contains('short');
  }

  bool get _isCarousel =>
      _currentPiece.contentType.toLowerCase().contains('carousel') || _brief?.format?.toLowerCase().contains('carousel') == true;

  List<Widget> _briefBlocks(PieceBrief b) => [
        _block('Hook (say this)', b.spokenHook ?? b.hook ?? ''),
        _block('On-screen hook', b.onScreenHook ?? ''),
        _block('Script Beats${b.durationSec == null ? '' : ' · ~${b.durationSec}s'}',
            [for (var i = 0; i < b.body.length; i++) '${i + 1}. ${b.body[i].beat}'].join('\n')),
        _block('Loop back', b.retentionLoop ?? ''),
        _block('Spoken CTA', b.cta ?? ''),
        _block('Shot notes', b.shotNotes.map((n) => '• $n').join('\n')),
        _block('Visual idea', b.visualBrief ?? ''),
      ];

  @override
  void dispose() {
    _headline.dispose();
    _adCopy.dispose();
    _script.dispose();
    _cta.dispose();
    _hashtags.dispose();
    _visualBrief.dispose();
    super.dispose();
  }

  Future<void> _setStatus(PieceStatus s) async {
    final outcome = await guarded(
        context, () => ref.read(socialApiProvider).updatePiece(widget.calendar.id, _currentPiece.id, {'status': s.id}));
    if (outcome == null || !mounted) return;
    setState(() => _status = s);
    showMutation(context, outcome, 'Status updated');
    ref.invalidate(calendarDetailProvider(widget.calendar.id));
  }

  Future<void> _saveChanges() async {
    setState(() => _saving = true);
    final tags = _hashtags.text
        .split(RegExp(r'[\s,]+'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .map((s) => s.startsWith('#') ? s : '#$s')
        .toList();

    final outcome = await guarded(
      context,
      () => ref.read(socialApiProvider).updatePiece(widget.calendar.id, _currentPiece.id, {
        'headline': _headline.text.trim(),
        'adCopyFull': _adCopy.text.trim(),
        'videoScriptOrHooks': _script.text.trim(),
        'callToAction': _cta.text.trim(),
        'hashtags': tags,
        'visualAssetsBrief': _visualBrief.text.trim(),
      }),
    );
    if (!mounted) return;
    setState(() {
      _saving = false;
      if (outcome != null) _isEditing = false;
    });
    if (outcome != null) {
      showSuccess(context, 'Piece updated');
      ref.invalidate(calendarDetailProvider(widget.calendar.id));
    }
  }

  Future<void> _regenerateWithAi() async {
    final projectId = widget.calendar.projectId ?? ref.read(activeProjectProvider).valueOrNull?.id;
    if (projectId == null) {
      showError(context, 'Project context is required for AI regeneration.');
      return;
    }

    final instruction = await promptText(
      context,
      title: 'AI Autopilot Rewrite',
      label: 'Specific guidance (optional)',
      action: 'Rewrite Piece',
    );
    if (!mounted) return;

    setState(() => _regenerating = true);
    final rewritten = await guarded(
      context,
      () => ref.read(socialApiProvider).regeneratePiece(
            projectId,
            _currentPiece.id,
            instruction: instruction?.trim().isEmpty ?? true ? null : instruction!.trim(),
          ),
    );
    if (!mounted) return;
    setState(() => _regenerating = false);
    if (rewritten != null) {
      setState(() {
        _currentPiece = rewritten;
        _headline.text = rewritten.headline;
        _adCopy.text = rewritten.adCopyFull;
        _script.text = rewritten.videoScriptOrHooks;
        _cta.text = rewritten.callToAction;
        _hashtags.text = rewritten.hashtags.join(' ');
        _visualBrief.text = rewritten.visualAssetsBrief;
      });
      showSuccess(context, 'Piece rewritten by AI Autopilot!');
      ref.invalidate(calendarDetailProvider(widget.calendar.id));
    }
  }

  void _showPreview() {
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
                      child: Text('Post Preview', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    ),
                    IconButton(icon: Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
              ),
              PlatformPostPreview(
                caption: '${_adCopy.text}\n\n${_cta.text}\n\n${_hashtags.text}'.trim(),
                title: _headline.text.isNotEmpty ? _headline.text : null,
                hook: _hookLine,
                mediaType: _currentPiece.contentType.toLowerCase().contains('carousel')
                    ? 'carousel'
                    : _currentPiece.contentType.toLowerCase().contains('reel') || _currentPiece.contentType.toLowerCase().contains('video')
                        ? 'video'
                        : 'image',
                accountName: widget.calendar.displayName,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _block(String label, String text) => text.trim().isEmpty
      ? SizedBox.shrink()
      : Padding(
          padding: EdgeInsets.only(top: 14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(label.toUpperCase(), style: Theme.of(context).textTheme.labelSmall)),
              IconButton(
                tooltip: 'Copy',
                icon: Icon(Icons.copy_rounded, size: 16),
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: text));
                  if (mounted) showInfo(context, '$label copied');
                },
              ),
            ]),
            SelectableText(text),
          ]),
        );

  @override
  Widget build(BuildContext context) {
    final p = _currentPiece;
    final b = _brief;
    final projectId = widget.calendar.projectId ?? ref.watch(activeProjectProvider).valueOrNull?.id;
    final pieceQuery = 'projectId=${projectId ?? ''}&calendarId=${widget.calendar.id}&pieceId=${p.id}'
        '${p.dateScheduled == null ? '' : '&date=${Uri.encodeQueryComponent(p.dateScheduled!.toIso8601String())}'}';
    final prefill = {
      'title': _headline.text,
      'hook': _hookLine,
      'content': [_adCopy.text, if (_cta.text.isNotEmpty) _cta.text, if (_hashtags.text.isNotEmpty) _hashtags.text].join('\n\n'),
      'platforms': [p.platform],
      'mediaType': p.contentType.toLowerCase().contains('carousel')
          ? 'carousel'
          : p.contentType.toLowerCase().contains('reel') || p.contentType.toLowerCase().contains('video')
              ? 'video'
              : 'image',
    };

    final psychJob = p.psychologicalJob ?? b?.psychologicalJob;
    final designSys = p.designSystem ?? b?.designSystem;
    final deliverable = p.whatContentDelivers ?? b?.whatContentDelivers;
    final visDirection = p.visualDirection ?? b?.visualDirection;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.88,
      maxChildSize: 0.96,
      builder: (_, scroll) => ListView(controller: scroll, padding: EdgeInsets.fromLTRB(16, 16, 16, 32), children: [
        Row(
          children: [
            Expanded(
              child: Text(p.headline.isEmpty ? '(No headline)' : p.headline, style: Theme.of(context).textTheme.titleLarge),
            ),
            IconButton(
              tooltip: _isEditing ? 'Cancel editing' : 'Edit piece',
              icon: Icon(_isEditing ? Icons.close_rounded : Icons.edit_rounded, color: AppTheme.primary),
              onPressed: () => setState(() => _isEditing = !_isEditing),
            ),
          ],
        ),
        SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          if (p.platform.isNotEmpty) StatusChip(label: p.platform, color: AppTheme.accentBlue),
          if (p.contentType.isNotEmpty)
            StatusChip(
              label: p.contentType,
              color: _isCarousel ? AppTheme.success : AppTheme.accent,
            ),
          if (p.pillar.isNotEmpty) StatusChip(label: p.pillar, color: AppTheme.textSecondary),
          StatusChip(label: fmtDate(p.dateScheduled), color: AppTheme.textSecondary, icon: Icons.event_rounded),
          if (p.postingTimeTz.isNotEmpty) StatusChip(label: p.postingTimeTz, color: AppTheme.textSecondary, icon: Icons.schedule_rounded),
          if (p.estimatedImpressions != null) StatusChip(label: '~${p.estimatedImpressions} impressions', color: AppTheme.textSecondary),
        ]),
        SizedBox(height: 12),

        // Master SOP Neuromarketing & Brand System Card
        if (psychJob != null || designSys != null || deliverable != null || visDirection != null) ...[
          Container(
            padding: EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppTheme.surfaceElevated,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(Icons.psychology_rounded, color: AppTheme.primary, size: 18),
                SizedBox(width: 8),
                Text(
                  'MASTER SOP CREATIVE STRATEGY',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.1, color: AppTheme.primary),
                ),
              ]),
              SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, children: [
                if (psychJob != null) StatusChip(label: '🧠 $psychJob', color: AppTheme.accent),
                if (designSys != null) StatusChip(label: '🎨 $designSys', color: AppTheme.accentBlue),
                if (deliverable != null) StatusChip(label: '🎯 $deliverable', color: AppTheme.success),
              ]),
              if (visDirection != null && visDirection.isNotEmpty) ...[
                SizedBox(height: 8),
                Text('Visual Direction: $visDirection',
                    style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, fontStyle: FontStyle.italic)),
              ],
            ]),
          ),
          SizedBox(height: 12),
        ],

        DropdownButtonFormField<PieceStatus>(
          initialValue: PieceStatus.settable.contains(_status) ? _status : null,
          decoration: fieldDecoration('Status'),
          items: [for (final s in PieceStatus.settable) DropdownMenuItem(value: s, child: Text(s.label))],
          onChanged: (s) => s == null || s == _status ? null : _setStatus(s),
        ),
        SizedBox(height: 12),

        if (_isVideoPiece) ...[
          PieceClipsSection(
            piece: p,
            status: _status,
            projectId: projectId,
            hook: prefill['hook']?.toString() ?? p.headline,
            script: _prompterScript,
            onStatusChanged: (s) => setState(() => _status = s),
          ),
          SizedBox(height: 12),
        ],

        // Action Toolbar
        Row(children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () {
                Navigator.pop(context);
                context.push('/posts/new?$pieceQuery', extra: prefill);
              },
              icon: Icon(Icons.send_rounded, size: 16),
              label: Text('To Post'),
            ),
          ),
          SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              // The camera opens on top of this sheet and its takes are linked to the piece (listed under Clips).
              onPressed: () => context.push('/camera', extra: {
                'hook': prefill['hook'] ?? p.headline,
                'script': _prompterScript,
                'projectId': projectId,
                'pieceId': p.id,
              }),
              icon: Icon(Icons.videocam_rounded, size: 16),
              label: Text('Shoot'),
            ),
          ),
          SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: _showPreview,
            icon: Icon(Icons.remove_red_eye_rounded, size: 16),
            label: Text('Preview'),
          ),
        ]),
        if (p.contentType.toLowerCase().contains('video') ||
            p.contentType.toLowerCase().contains('reel') ||
            p.contentType.toLowerCase().contains('short')) ...[
          SizedBox(height: 10),
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.primary.withValues(alpha: 0.15),
              foregroundColor: AppTheme.primary,
              padding: EdgeInsets.symmetric(vertical: 12),
            ),
            onPressed: () {
              Navigator.pop(context);
              context.push(
                '/planner/script?calendarId=${widget.calendar.id}&pieceId=${p.id}',
                extra: {
                  'piece': p,
                  'calendar': widget.calendar,
                },
              );
            },
            icon: Icon(Icons.menu_book_rounded, size: 18),
            label: Text('View detailed script'),
          ),
          SizedBox(height: 10),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.white,
              padding: EdgeInsets.symmetric(vertical: 12),
            ),
            onPressed: () async {
              Navigator.pop(context);
              final picker = ImagePicker();
              final choice = await showModalBottomSheet<String>(
                context: context,
                backgroundColor: AppTheme.surfaceElevated,
                builder: (ctx) => SafeArea(
                  child: Wrap(children: [
                    ListTile(
                      leading: Icon(Icons.video_library_rounded, color: AppTheme.primary),
                      title: Text('Pick Raw Footage from Gallery'),
                      onTap: () => Navigator.pop(ctx, 'gallery'),
                    ),
                    ListTile(
                      leading: Icon(Icons.videocam_rounded, color: AppTheme.accent),
                      title: Text('Record with Teleprompter Camera'),
                      onTap: () => Navigator.pop(ctx, 'camera'),
                    ),
                    ListTile(
                      leading: Icon(Icons.cloud_upload_rounded),
                      title: Text('Send raw footage to my editor'),
                      subtitle: Text('Uploads it to this piece for editing in the studio'),
                      onTap: () => Navigator.pop(ctx, 'upload'),
                    ),
                  ]),
                ),
              );

              if (choice == 'camera' && context.mounted) {
                context.push('/camera', extra: {
                  'hook': prefill['hook'] ?? p.headline,
                  'script': _prompterScript,
                  'projectId': projectId,
                  'pieceId': p.id,
                });
              } else if (choice == 'upload') {
                final vid = await picker.pickVideo(source: ImageSource.gallery);
                if (vid != null && context.mounted) await uploadRawFootage(context, ref, p.id, vid.path);
              } else if (choice == 'gallery') {
                final vid = await picker.pickVideo(source: ImageSource.gallery);
                if (vid != null && context.mounted) {
                  context.push('/studio/session', extra: {
                    'sourcePath': vid.path,
                    'projectId': projectId,
                    'pieceId': p.id,
                    'hook': prefill['hook'] ?? p.headline,
                    'script': _prompterScript,
                  });
                }
              }
            },
            icon: Icon(Icons.movie_creation_rounded, size: 18),
            label: Text('🎬 Edit in 180 Media Studio'),
          ),
        ],
        if (_isCarousel && projectId != null) ...[
          SizedBox(height: 10),
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.success.withValues(alpha: 0.15),
              foregroundColor: AppTheme.success,
            ),
            onPressed: () => showCarouselSheet(context, projectId: projectId, pieceId: p.id, title: p.headline),
            icon: Icon(Icons.view_carousel_rounded, size: 18),
            label: Text('Design carousel slides'),
          ),
        ],
        SizedBox(height: 10),

        // AI Autopilot Rewrite Button
        FilledButton.tonalIcon(
          onPressed: _regenerating ? null : _regenerateWithAi,
          icon: _regenerating
              ? SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
              : Icon(Icons.auto_awesome_rounded, size: 16, color: AppTheme.primary),
          label: Text(_regenerating ? 'AI Autopilot Writing…' : 'AI Autopilot Rewrite Piece'),
        ),

        // Editable Form or Display Blocks
        if (_isEditing) ...[
          SizedBox(height: 16),
          TextField(controller: _headline, decoration: fieldDecoration('Headline')),
          SizedBox(height: 12),
          if (_brief == null)
            TextField(controller: _script, minLines: 2, maxLines: 6, decoration: fieldDecoration('Script / Hooks'))
          else
            Text('The hook and script were written by Autopilot. Use "AI Autopilot Rewrite" with an instruction to change them.'),
          SizedBox(height: 12),
          TextField(controller: _adCopy, minLines: 4, maxLines: 10, decoration: fieldDecoration('Full Caption / Ad Copy')),
          SizedBox(height: 12),
          TextField(controller: _cta, decoration: fieldDecoration('Call to Action')),
          SizedBox(height: 12),
          TextField(controller: _hashtags, decoration: fieldDecoration('Hashtags')),
          SizedBox(height: 12),
          TextField(controller: _visualBrief, minLines: 2, maxLines: 4, decoration: fieldDecoration('Visual Brief')),
          SizedBox(height: 16),
          ElevatedButton(
            onPressed: _saving ? null : _saveChanges,
            child: _saving
                ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : Text('Save Changes'),
          ),
        ] else ...[
          // 5-Slide Breakdown for Carousels
          if (_isCarousel && b?.carouselSlides.isNotEmpty == true) ...[
            SizedBox(height: 14),
            Row(children: [
              Icon(Icons.slideshow_rounded, size: 18, color: AppTheme.success),
              SizedBox(width: 8),
              Text(
                'CAROUSEL SLIDE-BY-SLIDE BLUEPRINT',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.1, color: AppTheme.success),
              ),
            ]),
            SizedBox(height: 8),
            for (var i = 0; i < b!.carouselSlides.length; i++) ...[
              Container(
                margin: EdgeInsets.only(bottom: 8),
                padding: EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceElevated,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.border.withValues(alpha: 0.4)),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.success.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'Slide ${i + 1}${b.carouselSlides[i].role == null ? '' : ' · ${b.carouselSlides[i].role}'}',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.success),
                      ),
                    ),
                  ]),
                  SizedBox(height: 6),
                  Text(b.carouselSlides[i].headline, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  if (b.carouselSlides[i].body?.isNotEmpty == true) ...[
                    SizedBox(height: 4),
                    SelectableText(
                      b.carouselSlides[i].body!,
                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                    ),
                  ],
                ]),
              ),
            ],
          ],

          if (b case final br?) ..._briefBlocks(br) else _block('Script / hooks', _script.text),
          _block('Caption', _adCopy.text),
          _block('Call to action', _cta.text),
          _block('Hashtags', _hashtags.text),
          _block('Visual brief', _visualBrief.text),
          _block('Notes', p.notes),
        ],
      ]),
    );
  }
}
