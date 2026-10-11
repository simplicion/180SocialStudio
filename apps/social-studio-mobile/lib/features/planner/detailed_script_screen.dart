import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/autopilot.dart';
import '../../data/models/content_calendar.dart';

/// Full script for one calendar video piece.
///
/// "Script" shows every spoken line with its timecode and pacing warnings (timing is computed from the words).
/// "Shooting script" is the scene-by-scene plan from the Shooting Script Director agent: shot, framing, action,
/// B-roll and edit cue per scene. It is generated on demand and never changes the spoken words.
class DetailedScriptScreen extends ConsumerStatefulWidget {
  const DetailedScriptScreen({super.key, required this.piece, this.calendar});

  final CalendarPiece piece;
  final ContentCalendar? calendar;

  @override
  ConsumerState<DetailedScriptScreen> createState() => _DetailedScriptScreenState();
}

class _DetailedScriptScreenState extends ConsumerState<DetailedScriptScreen> with SingleTickerProviderStateMixin {
  late final _tabs = TabController(length: 2, vsync: this);
  late final PieceBrief? _brief = PieceBrief.parse(widget.piece.videoScriptOrHooks);
  late ProductionScript? _shooting = _brief?.productionScript;
  bool _generating = false;
  Object? _error;

  String? get _projectId => widget.calendar?.projectId;

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _generate({bool force = false}) async {
    final projectId = _projectId;
    if (projectId == null || _generating) return;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final script = await ref.read(socialApiProvider).generateShootingScript(projectId, widget.piece.id, force: force);
      if (!mounted) return;
      setState(() => _shooting = script);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _generating = false);
    }
  }

  void _copy(String text, String what) {
    Clipboard.setData(ClipboardData(text: text));
    showSuccess(context, '$what copied');
  }

  void _record(PieceBrief brief) => context.push('/camera', extra: {
        'hook': brief.openingHook ?? widget.piece.headline,
        'script': brief.teleprompterText,
        'projectId': _projectId,
        'pieceId': widget.piece.id,
      });

  @override
  Widget build(BuildContext context) {
    final brief = _brief;
    if (brief == null || brief.timedBeats.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: Text('Detailed script')),
        body: EmptyView(
          icon: Icons.description_outlined,
          title: 'No script on this piece yet',
          message: 'Scripts are written for video pieces. Use "AI Autopilot Rewrite" on the piece to have one written.',
          actionLabel: 'Back to the calendar',
          onAction: () => context.pop(),
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text('Detailed script'),
        actions: [
          IconButton(
            tooltip: 'Copy the spoken script',
            icon: Icon(Icons.copy_rounded),
            onPressed: () => _copy(brief.teleprompterText, 'Script'),
          ),
        ],
        bottom: TabBar(controller: _tabs, tabs: const [Tab(text: 'Script'), Tab(text: 'Shooting script')]),
      ),
      body: TabBarView(controller: _tabs, children: [_scriptTab(brief), _shootingTab(brief)]),
      bottomNavigationBar: SafeArea(
        minimum: EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: Size.fromHeight(48)),
          onPressed: () => _record(brief),
          icon: Icon(Icons.videocam_rounded),
          label: Text('Record with teleprompter'),
        ),
      ),
    );
  }

  // ── Script tab ─────────────────────────────────────────────────────────────

  Widget _scriptTab(PieceBrief brief) {
    final flagged = brief.timedBeats.where((b) => b.flags.isNotEmpty).length;
    return ListView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        Text(widget.piece.headline, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
        SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          _Stat(label: 'Spoken length', value: '${brief.spokenSeconds.toStringAsFixed(0)}s'),
          _Stat(label: 'Lines', value: '${brief.timedBeats.length}'),
          if (brief.hookScore case final s?) _Stat(label: 'Hook score', value: '$s/100', color: _scoreColor(s)),
          if (brief.humanScore case final s?) _Stat(label: 'Human voice', value: '$s/100', color: _scoreColor(s)),
          if (brief.craftScore case final s?) _Stat(label: 'Craft score', value: '$s/100', color: _scoreColor(s)),
        ]),
        if (brief.hookFormula case final f?) ...[
          SizedBox(height: 8),
          Text('Hook shape: $f', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
        ],
        if (brief.craftBlocking.isNotEmpty) _Notice(title: 'Fix before posting', lines: brief.craftBlocking, color: AppTheme.error),
        if (brief.onScreenHook case final t? when t.isNotEmpty) ...[
          SectionHeader('On-screen hook'),
          SectionCard(child: Text(t, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
        ],
        SectionHeader(
          'Line by line',
          trailing: flagged == 0 ? null : Text('$flagged to tighten', style: TextStyle(fontSize: 11, color: AppTheme.warning, fontWeight: FontWeight.w700)),
        ),
        for (final b in brief.timedBeats) _BeatCard(beat: b),
        if (brief.shotNotes.isNotEmpty) ...[
          SectionHeader('Shot notes'),
          SectionCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              for (final n in brief.shotNotes) Padding(padding: EdgeInsets.only(bottom: 6), child: Text('• $n', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary))),
            ]),
          ),
        ],
        if (brief.craftAdvice.isNotEmpty) _Notice(title: 'Ways to make it stronger', lines: brief.craftAdvice, color: AppTheme.accent),
      ],
    );
  }

  // ── Shooting script tab ────────────────────────────────────────────────────

  Widget _shootingTab(PieceBrief brief) {
    if (_generating) {
      return Padding(padding: EdgeInsets.all(16), child: UniversalSkeleton(type: SkeletonType.detail, itemCount: 4));
    }
    if (_error case final e?) {
      return Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        ErrorView(error: e, onRetry: () => _generate(force: _shooting != null), compact: true),
        TextButton(onPressed: () => _tabs.animateTo(0), child: Text('Use the timed script instead')),
      ]);
    }
    final s = _shooting;
    if (s == null) {
      return EmptyView(
        icon: Icons.movie_creation_outlined,
        title: 'Turn this script into a shot list',
        message: _projectId == null
            ? 'Open this piece from its calendar to generate a shooting script.'
            : 'Get a scene-by-scene plan: shot, framing, what to do on camera, B-roll and edit cues. Your spoken words stay exactly as written.',
        actionLabel: _projectId == null ? 'Back to the calendar' : 'Generate shooting script',
        onAction: _projectId == null ? () => context.pop() : _generate,
      );
    }
    return ListView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        if (s.logline.isNotEmpty) Text(s.logline, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
        SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          _Stat(label: 'Runtime', value: '${s.totalSeconds.toStringAsFixed(0)}s'),
          _Stat(label: 'Scenes', value: '${s.scenes.length}'),
          if (s.aspect.isNotEmpty) _Stat(label: 'Frame', value: s.aspect),
        ]),
        if (s.flags.isNotEmpty) _Notice(title: 'Pacing to fix', lines: s.flags, color: AppTheme.warning),
        SectionHeader('Before you record'),
        SectionCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _kv('Location', s.location),
            _kv('Lighting', s.lighting),
            _kv('Wardrobe', s.wardrobe),
            _kv('Props', s.props.join(', ')),
            _kv('Captions', s.captionStyle),
            _kv('Music', s.musicMood),
          ]),
        ),
        SectionHeader('Scenes'),
        for (final scene in s.scenes) _SceneCard(scene: scene),
        if (s.checklist.isNotEmpty) ...[
          SectionHeader('Checklist'),
          SectionCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              for (final c in s.checklist)
                Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Icon(Icons.check_circle_outline_rounded, size: 16, color: AppTheme.success),
                    SizedBox(width: 8),
                    Expanded(child: Text(c, style: TextStyle(fontSize: 13))),
                  ]),
                ),
            ]),
          ),
        ],
        SizedBox(height: 12),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
          onPressed: () async {
            final ok = await confirm(context, title: 'Regenerate the shooting script?', message: 'The current scenes will be replaced. The spoken script does not change.', action: 'Regenerate');
            if (ok) _generate(force: true);
          },
          icon: Icon(Icons.refresh_rounded, size: 18),
          label: Text('Regenerate'),
        ),
      ],
    );
  }

  Widget _kv(String k, String v) => v.trim().isEmpty
      ? SizedBox.shrink()
      : Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 84, child: Text(k, style: TextStyle(fontSize: 12, color: AppTheme.textMuted, fontWeight: FontWeight.w600))),
            Expanded(child: Text(v, style: TextStyle(fontSize: 13))),
          ]),
        );
}

Color _scoreColor(int score) => score >= 70 ? AppTheme.success : score >= 50 ? AppTheme.warning : AppTheme.error;

const _roleLabels = {'hook': 'Hook', 'body': 'Beat', 'loop': 'Loop back', 'cta': 'Call to action'};

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.color});
  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(10), border: Border.all(color: AppTheme.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: color ?? AppTheme.textPrimary)),
          Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
        ]),
      );
}

class _Notice extends StatelessWidget {
  const _Notice({required this.title, required this.lines, required this.color});
  final String title;
  final List<String> lines;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: 12),
        child: SectionCard(
          borderColor: color.withValues(alpha: 0.5),
          padding: EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color)),
            SizedBox(height: 6),
            for (final l in lines) Padding(padding: EdgeInsets.only(bottom: 4), child: Text('• $l', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
          ]),
        ),
      );
}

class _BeatCard extends StatelessWidget {
  const _BeatCard({required this.beat});
  final TimedBeatModel beat;

  @override
  Widget build(BuildContext context) {
    final flagged = beat.flags.isNotEmpty;
    return Padding(
      padding: EdgeInsets.only(bottom: 8),
      child: SectionCard(
        padding: EdgeInsets.all(12),
        borderColor: flagged ? AppTheme.warning.withValues(alpha: 0.6) : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(beat.timecode, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.accent, fontFeatures: const [FontFeature.tabularFigures()])),
            SizedBox(width: 8),
            Text(_roleLabels[beat.role] ?? 'Beat', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppTheme.textMuted)),
            Spacer(),
            Text('${beat.durationSec.toStringAsFixed(1)}s', style: TextStyle(fontSize: 11, color: flagged ? AppTheme.warning : AppTheme.textMuted, fontWeight: FontWeight.w600)),
          ]),
          SizedBox(height: 6),
          SelectableText(beat.spokenWords, style: TextStyle(fontSize: 15, height: 1.35, color: AppTheme.textPrimary)),
          if (beat.screenText case final t? when t.isNotEmpty) _line(Icons.title_rounded, 'On screen: $t'),
          if (beat.retentionDevice case final d? when d.isNotEmpty) _line(Icons.anchor_rounded, d),
          for (final f in beat.flags) _line(Icons.timer_outlined, f, color: AppTheme.warning),
        ]),
      ),
    );
  }
}

class _SceneCard extends StatelessWidget {
  const _SceneCard({required this.scene});
  final ProductionScene scene;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(bottom: 8),
        child: SectionCard(
          padding: EdgeInsets.all(12),
          borderColor: scene.flags.isEmpty ? null : AppTheme.warning.withValues(alpha: 0.6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text('${scene.index}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppTheme.textMuted)),
              SizedBox(width: 8),
              Text(scene.timecode, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.accent, fontFeatures: const [FontFeature.tabularFigures()])),
              SizedBox(width: 8),
              Expanded(
                child: Text('${scene.purpose} · ${scene.shotLabel}', overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppTheme.textMuted)),
              ),
              Text('${scene.durationSec.toStringAsFixed(1)}s', style: TextStyle(fontSize: 11, color: AppTheme.textMuted, fontWeight: FontWeight.w600)),
            ]),
            SizedBox(height: 6),
            if (scene.spokenLine.isNotEmpty)
              SelectableText(scene.spokenLine, style: TextStyle(fontSize: 15, height: 1.35, color: AppTheme.textPrimary))
            else
              Text('No speech', style: TextStyle(fontSize: 13, fontStyle: FontStyle.italic, color: AppTheme.textMuted)),
            if (scene.onScreenText.isNotEmpty) _line(Icons.title_rounded, 'On screen: ${scene.onScreenText}'),
            if (scene.framing.isNotEmpty) _line(Icons.crop_free_rounded, scene.framing),
            if (scene.action.isNotEmpty) _line(Icons.accessibility_new_rounded, scene.action),
            if (scene.bRoll.isNotEmpty) _line(Icons.video_library_outlined, 'B-roll: ${scene.bRoll}'),
            if (scene.editCue.isNotEmpty) _line(Icons.content_cut_rounded, scene.editCue),
            if (scene.audioCue.isNotEmpty) _line(Icons.music_note_rounded, scene.audioCue),
            if (scene.delivery.isNotEmpty) _line(Icons.record_voice_over_outlined, scene.delivery),
            for (final f in scene.flags) _line(Icons.timer_outlined, f, color: AppTheme.warning),
          ]),
        ),
      );
}

Widget _line(IconData icon, String text, {Color? color}) => Padding(
      padding: EdgeInsets.only(top: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 14, color: color ?? AppTheme.textMuted),
        SizedBox(width: 6),
        Expanded(child: Text(text, style: TextStyle(fontSize: 12, color: color ?? AppTheme.textSecondary))),
      ]),
    );
