import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../../core/media/asset_cache.dart';
import '../../core/native_engine/edit_ir.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../director/ai_director_service.dart';
import '../projects/project_provider.dart';
import 'caption_fonts.dart';
import 'caption_languages.dart';
import 'caption_tools.dart';
import 'studio_controller.dart';
import 'sticker_maker.dart';
import 'studio_session_screen.dart' show timecode;
import 'text_motion.dart';
import 'text_templates.dart';
import 'timeline_ops.dart';

enum StudioTool {
  director('AI Director', Icons.auto_awesome_rounded),
  library('Library', Icons.library_add_rounded),
  trim('Trim', Icons.straighten_rounded),
  delete('Delete', Icons.delete_outline_rounded),
  cleanup('Clean up', Icons.cleaning_services_rounded),
  duplicate('Duplicate', Icons.copy_all_rounded),
  freeze('Freeze', Icons.pause_circle_outline_rounded),
  stabilize('Stabilise', Icons.video_stable_rounded),
  order('Reorder', Icons.swap_horiz_rounded),
  speed('Speed', Icons.speed_rounded),
  volume('Volume', Icons.volume_up_rounded),
  canvas('Canvas', Icons.crop_rounded),
  rotate('Rotate', Icons.rotate_90_degrees_cw_rounded),
  filter('Filters', Icons.filter_vintage_rounded),
  adjust('Adjust', Icons.tune_rounded),
  text('Text', Icons.title_rounded),
  captions('Captions', Icons.closed_caption_rounded),
  music('Music', Icons.music_note_rounded),
  voiceover('Voiceover', Icons.mic_rounded),
  zoom('Zoom', Icons.zoom_in_rounded),
  broll('B-roll', Icons.layers_rounded),
  sticker('Stickers', Icons.emoji_emotions_rounded),
  transition('Transition', Icons.compare_rounded);

  StudioTool(this.label, this.icon);
  final String label;
  final IconData icon;
}

typedef EditFn = void Function(MobileEditIr Function(MobileEditIr) op, {String? done});

/// Filter looks the renderer supports (contract §3.2) with their colour multipliers.
final filterLooks = <String, EditIrFilter>{
  'Vivid': EditIrFilter(preset: 'VIVID', brightness: 1.03, contrast: 1.1, saturation: 1.3),
  'Cinematic': EditIrFilter(preset: 'CINEMATIC_TEAL_ORANGE', brightness: 0.98, contrast: 1.15, saturation: 1.05),
  'Warm': EditIrFilter(preset: 'VINTAGE_WARM', brightness: 1.02, contrast: 0.95, saturation: 0.9),
  'Mono': EditIrFilter(preset: 'NOIR_BW', brightness: 1.0, contrast: 1.2, saturation: 0),
  'Neon': EditIrFilter(preset: 'CYBER_NEON', brightness: 1.0, contrast: 1.15, saturation: 1.45),
  'Glow': EditIrFilter(preset: 'GLOW', brightness: 1.08, contrast: 0.92, saturation: 1.05),
};

Future<void> showStudioTool(BuildContext context, StudioTool tool, StudioController c, {required EditFn onEdit}) {
  final ir = c.ir!;
  final selected = c.selectedClip;
  final clipIndex = selected ?? TimelineOps.clipIndexAt(ir, c.playheadMs);
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.surface,
    builder: (ctx) => Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
      child: SafeArea(
        child: switch (tool) {
          StudioTool.trim => _TrimSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.delete => _DeleteSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.cleanup => _CleanupSheet(c: c, onEdit: onEdit),
          StudioTool.duplicate => _DuplicateSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.freeze => _FreezeSheet(c: c),
          StudioTool.stabilize => _StabilizeSheet(c: c, index: clipIndex),
          StudioTool.order => _OrderSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.speed => _SpeedSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.volume => _VolumeSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.canvas => _CanvasSheet(c: c, onEdit: onEdit),
          StudioTool.rotate => _RotateSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.filter => _FilterSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.adjust => _AdjustSheet(c: c, index: clipIndex, onEdit: onEdit),
          StudioTool.text => _TextSheet(
            c: c,
            onEdit: onEdit,
            captionId: c.selectedKind == TrackKind.captions ? c.selectedItemId : null,
          ),
          StudioTool.captions => _CaptionsSheet(c: c, onEdit: onEdit),
          StudioTool.music => _MusicSheet(c: c, onEdit: onEdit),
          StudioTool.voiceover => _VoiceoverSheet(c: c),
          StudioTool.zoom => _ZoomSheet(c: c, onEdit: onEdit),
          StudioTool.broll => _BrollSheet(c: c, onEdit: onEdit),
          StudioTool.sticker => _StickerSheet(c: c, onEdit: onEdit),
          StudioTool.transition => _TransitionSheet(c: c, onEdit: onEdit),
          StudioTool.library => _LibrarySheet(c: c, onEdit: onEdit),
          StudioTool.director => SizedBox.shrink(),
        },
      ),
    ),
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

class _Title extends StatelessWidget {
  const _Title(this.text, {this.subtitle});
  final String text;
  final String? subtitle;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(text, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 18)),
          if (subtitle != null) Text(subtitle!, style: Theme.of(context).textTheme.labelSmall),
        ]),
      );
}

/// "This clip / All clips" switch for per-clip tools.
class _Scope extends StatelessWidget {
  const _Scope({required this.all, required this.onChanged, required this.index, required this.count});
  final bool all;
  final ValueChanged<bool> onChanged;
  final int index;
  final int count;

  @override
  Widget build(BuildContext context) => count < 2
      ? SizedBox.shrink()
      : Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: SegmentedButton<bool>(
            segments: [
              ButtonSegment(value: false, label: Text('Clip ${index + 1}')),
              ButtonSegment(value: true, label: Text('All clips')),
            ],
            selected: {all},
            onSelectionChanged: (s) => onChanged(s.first),
          ),
        );
}

void _close(BuildContext context) => Navigator.of(context).pop();

// ── clip tools ───────────────────────────────────────────────────────────────

class _TrimSheet extends StatefulWidget {
  const _TrimSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  State<_TrimSheet> createState() => _TrimSheetState();
}

class _TrimSheetState extends State<_TrimSheet> {
  late final EditIrClip clip = widget.c.ir!.clips[widget.index];
  late final int srcLen = widget.c.ir!.sources.firstOrNull?.durationMs ?? clip.sourceEndMs;
  late RangeValues v = RangeValues(clip.sourceStartMs.toDouble(), clip.sourceEndMs.toDouble());

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _Title('Trim clip ${widget.index + 1}', subtitle: 'Drag the handles to set where this clip starts and ends in the original video.'),
        RangeSlider(
          values: v,
          min: 0,
          max: srcLen.toDouble(),
          divisions: (srcLen / 100).clamp(1, 2000).round(),
          labels: RangeLabels(timecode(v.start.round()), timecode(v.end.round())),
          onChanged: (r) => setState(() => v = r),
        ),
        Text('${timecode(v.start.round())} → ${timecode(v.end.round())}  (${((v.end - v.start) / 1000).toStringAsFixed(1)}s)',
            textAlign: TextAlign.center, style: TextStyle(fontFeatures: [FontFeature.tabularFigures()])),
        SizedBox(height: 16),
        FilledButton(
          onPressed: () {
            _close(context);
            widget.onEdit((ir) => TimelineOps.trim(ir, widget.index, sourceStartMs: v.start.round(), sourceEndMs: v.end.round()));
          },
          child: Text('Apply trim'),
        ),
      ]);
}

class _DuplicateSheet extends StatelessWidget {
  const _DuplicateSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  Widget build(BuildContext context) {
    final clip = c.ir!.clips[index];
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title('Duplicate', subtitle: 'The copy goes right after the clip; everything after it moves later.'),
      ListTile(
        leading: Icon(Icons.copy_all_rounded),
        title: Text('Duplicate clip ${index + 1}'),
        subtitle: Text('${timecode(clip.timelineStartMs)} – ${timecode(clip.timelineEndMs)}'),
        onTap: () {
          _close(context);
          onEdit((ir) => TimelineOps.duplicateClip(ir, index), done: 'Clip duplicated');
        },
      ),
    ]);
  }
}

/// Stabilise: shaky handheld footage is steadied on the phone (slight zoom hides the moved edges).
class _StabilizeSheet extends StatefulWidget {
  const _StabilizeSheet({required this.c, required this.index});
  final StudioController c;
  final int index;

  @override
  State<_StabilizeSheet> createState() => _StabilizeSheetState();
}

class _StabilizeSheetState extends State<_StabilizeSheet> {
  double strength = 1;
  bool busy = false;

  Future<void> _go() async {
    setState(() => busy = true);
    try {
      await widget.c.stabilizeClip(widget.index, strength: strength);
      if (!mounted) return;
      _close(context);
      showSuccess(context, 'Clip ${widget.index + 1} stabilised');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _Title('Stabilise clip ${widget.index + 1}', subtitle: 'Smooths out hand shake. The picture is zoomed in slightly to hide the moving edges.'),
        Wrap(spacing: 8, children: [
          for (final (label, s) in const [('Light', 0.5), ('Recommended', 1.0), ('Smoothest', 2.0)])
            ChoiceChip(label: Text(label), selected: strength == s, onSelected: busy ? null : (_) => setState(() => strength = s)),
        ]),
        SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: FilledButton.icon(
            onPressed: busy ? null : _go,
            icon: Icon(Icons.video_stable_rounded),
            label: Text(busy ? 'Stabilising on this phone…' : 'Stabilise'),
          ),
        ),
      ]);
}

/// Freeze frame: holds the exact frame under the playhead; everything after moves later.
class _FreezeSheet extends StatefulWidget {
  const _FreezeSheet({required this.c});
  final StudioController c;

  @override
  State<_FreezeSheet> createState() => _FreezeSheetState();
}

class _FreezeSheetState extends State<_FreezeSheet> {
  int seconds = 2;
  bool busy = false;

  Future<void> _freeze() async {
    setState(() => busy = true);
    try {
      await widget.c.freezeFrame(durationMs: seconds * 1000);
      if (!mounted) return;
      _close(context);
      showSuccess(context, 'Frame frozen for $seconds s');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _Title('Freeze frame', subtitle: 'Holds the frame at ${timecode(widget.c.playheadMs)}. Trim the still later to change how long it holds.'),
        Wrap(spacing: 8, children: [
          for (final s in const [1, 2, 3, 5])
            ChoiceChip(label: Text('$s s'), selected: seconds == s, onSelected: busy ? null : (_) => setState(() => seconds = s)),
        ]),
        SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: FilledButton.icon(
            onPressed: busy ? null : _freeze,
            icon: Icon(Icons.pause_circle_outline_rounded),
            label: Text(busy ? 'Capturing the frame…' : 'Freeze frame'),
          ),
        ),
      ]);
}

class _DeleteSheet extends StatelessWidget {
  const _DeleteSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  Widget build(BuildContext context) {
    final clip = c.ir!.clips[index];
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title('Delete', subtitle: 'Everything after the deleted part moves up; captions, music and B-roll stay in sync.'),
      ListTile(
        leading: Icon(Icons.delete_outline_rounded, color: AppTheme.error),
        title: Text('Delete clip ${index + 1}'),
        subtitle: Text('${timecode(clip.timelineStartMs)} – ${timecode(clip.timelineEndMs)}'),
        enabled: c.ir!.clips.length > 1,
        onTap: () {
          _close(context);
          onEdit((ir) => TimelineOps.deleteClip(ir, index), done: 'Clip deleted');
        },
      ),
      ListTile(
        leading: Icon(Icons.first_page_rounded),
        title: Text('Delete everything before the playhead'),
        enabled: c.playheadMs > TimelineOps.minClipMs,
        onTap: () {
          _close(context);
          onEdit((ir) => TimelineOps.removeRange(ir, 0, c.playheadMs));
        },
      ),
      ListTile(
        leading: Icon(Icons.last_page_rounded),
        title: Text('Delete everything after the playhead'),
        enabled: c.ir!.durationMs - c.playheadMs > TimelineOps.minClipMs,
        onTap: () {
          _close(context);
          onEdit((ir) => TimelineOps.removeRange(ir, c.playheadMs, ir.durationMs));
        },
      ),
    ]);
  }
}

class _OrderSheet extends StatelessWidget {
  const _OrderSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  Widget build(BuildContext context) {
    final n = c.ir!.clips.length;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title('Reorder clip ${index + 1} of $n', subtitle: n < 2 ? 'Split the video first to get clips to reorder.' : null),
      Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: index == 0
                ? null
                : () {
                    _close(context);
                    c.select(index - 1);
                    onEdit((ir) => TimelineOps.moveClip(ir, index, index - 1));
                  },
            icon: Icon(Icons.arrow_back_rounded),
            label: Text('Earlier'),
          ),
        ),
        SizedBox(width: 8),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: index >= n - 1
                ? null
                : () {
                    _close(context);
                    c.select(index + 1);
                    onEdit((ir) => TimelineOps.moveClip(ir, index, index + 1));
                  },
            icon: Icon(Icons.arrow_forward_rounded),
            label: Text('Later'),
          ),
        ),
      ]),
    ]);
  }
}

class _SpeedSheet extends StatefulWidget {
  const _SpeedSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  State<_SpeedSheet> createState() => _SpeedSheetState();
}

class _SpeedSheetState extends State<_SpeedSheet> {
  late double speed = widget.c.ir!.clips[widget.index].speed;
  bool all = false;
  bool busy = false;

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const _Title('Speed', subtitle: 'Voice pitch is preserved.'),
        _Scope(all: all, onChanged: (v) => setState(() => all = v), index: widget.index, count: widget.c.ir!.clips.length),
        Wrap(spacing: 8, children: [
          for (final s in [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0])
            ChoiceChip(label: Text('${s}x'), selected: speed == s, onSelected: (_) => setState(() => speed = s)),
        ]),
        Slider(value: speed, min: 0.25, max: 4, divisions: 75, label: '${speed.toStringAsFixed(2)}x', onChanged: (v) => setState(() => speed = (v * 100).round() / 100)),
        FilledButton(
          onPressed: () {
            _close(context);
            widget.onEdit((ir) => TimelineOps.setSpeed(ir, speed, index: all ? null : widget.index));
          },
          child: Text('Set ${speed.toStringAsFixed(2)}x'),
        ),
        SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: busy
              ? null
              : () async {
                  setState(() => busy = true);
                  try {
                    await widget.c.reverseClip(widget.index);
                    if (context.mounted) {
                      _close(context);
                      showSuccess(context, 'Clip ${widget.index + 1} now plays backwards');
                    }
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  } finally {
                    if (mounted) setState(() => busy = false);
                  }
                },
          icon: Icon(Icons.fast_rewind_rounded),
          label: Text(busy ? 'Reversing on this phone… (up to a minute)' : 'Play this clip backwards'),
        ),
        SizedBox(height: 12),
        Text('Speed ramp (this clip)', style: Theme.of(context).textTheme.labelMedium),
        SizedBox(height: 6),
        Wrap(spacing: 8, runSpacing: 6, children: [
          for (final (key, label) in const [('montage', 'Montage'), ('hero', 'Hero slow-mo'), ('bullet', 'Bullet'), ('flash_in', 'Flash in'), ('flash_out', 'Flash out')])
            ActionChip(
              label: Text(label),
              onPressed: () {
                _close(context);
                widget.onEdit((ir) => TimelineOps.speedRamp(ir, widget.index, key), done: 'Speed ramp: $label');
              },
            ),
        ]),
      ]);
}

class _VolumeSheet extends StatefulWidget {
  const _VolumeSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  State<_VolumeSheet> createState() => _VolumeSheetState();
}

class _VolumeSheetState extends State<_VolumeSheet> {
  late double clipDb = widget.c.ir!.clips[widget.index].volumeDb.clamp(-60, 12);
  late double masterDb = widget.c.ir!.audio.originalVolumeDb.clamp(-60, 12);
  late double fadeIn = widget.c.ir!.clips[widget.index].audioFadeInMs / 1000;
  late double fadeOut = widget.c.ir!.clips[widget.index].audioFadeOutMs / 1000;
  late bool cleanup = widget.c.ir!.clips[widget.index].voiceCleanup;
  bool all = false;

  String _fmt(double db) => db <= -60 ? 'Muted' : '${db >= 0 ? '+' : ''}${db.toStringAsFixed(0)} dB';

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const _Title('Original audio'),
        _Scope(all: all, onChanged: (v) => setState(() => all = v), index: widget.index, count: widget.c.ir!.clips.length),
        Text('Clip volume: ${_fmt(clipDb)}'),
        Slider(value: clipDb, min: -60, max: 12, divisions: 72, onChanged: (v) => setState(() => clipDb = v.roundToDouble())),
        Text('Whole video voice level: ${_fmt(masterDb)}'),
        Slider(value: masterDb, min: -60, max: 12, divisions: 72, onChanged: (v) => setState(() => masterDb = v.roundToDouble())),
        Text('Fade in: ${fadeIn == 0 ? 'Off' : '${fadeIn.toStringAsFixed(1)} s'}'),
        Slider(value: fadeIn.clamp(0, 3), min: 0, max: 3, divisions: 30, onChanged: (v) => setState(() => fadeIn = v)),
        Text('Fade out: ${fadeOut == 0 ? 'Off' : '${fadeOut.toStringAsFixed(1)} s'}'),
        Slider(value: fadeOut.clamp(0, 3), min: 0, max: 3, divisions: 30, onChanged: (v) => setState(() => fadeOut = v)),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: cleanup,
          onChanged: (v) => setState(() => cleanup = v),
          title: Text('Reduce background noise'),
          subtitle: Text('Cuts rumble, hiss and hum between words. Applied in the exported video.'),
        ),
        Row(children: [
          TextButton(onPressed: () => setState(() => clipDb = -60), child: Text('Mute clip')),
          Spacer(),
          FilledButton(
            onPressed: () {
              _close(context);
              final index = all ? null : widget.index;
              widget.onEdit((ir) => TimelineOps.setVoiceCleanup(
                    TimelineOps.setClipAudioFades(
                      TimelineOps.setOriginalVolume(TimelineOps.setClipVolume(ir, clipDb, index: index), masterDb),
                      fadeInMs: (fadeIn * 1000).round(),
                      fadeOutMs: (fadeOut * 1000).round(),
                      index: index,
                    ),
                    cleanup,
                    index: index,
                  ));
            },
            child: Text('Apply'),
          ),
        ]),
      ]);
}

class _CanvasSheet extends StatefulWidget {
  const _CanvasSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  State<_CanvasSheet> createState() => _CanvasSheetState();
}

class _CanvasSheetState extends State<_CanvasSheet> {
  late String aspect = widget.c.ir!.canvas.aspect;
  late bool fill = widget.c.ir!.clips.first.crop != null || TimelineOps.centerCrop(
            widget.c.ir!.sources.firstOrNull?.width ?? 0, widget.c.ir!.sources.firstOrNull?.height ?? 0, widget.c.ir!.canvas) ==
        null;

  static const _labels = {'9:16': 'Reels · Shorts', '1:1': 'Square', '4:5': 'Feed portrait', '16:9': 'YouTube · landscape'};

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const _Title('Canvas & crop'),
        RadioGroup<String>(
          groupValue: aspect,
          onChanged: (v) => setState(() => aspect = v ?? aspect),
          child: Column(children: [
            for (final a in TimelineOps.aspects)
              RadioListTile<String>(value: a, title: Text(a), subtitle: Text(_labels[a] ?? ''), dense: true),
          ]),
        ),
        SegmentedButton<bool>(
          segments: [
            ButtonSegment(value: true, label: Text('Fill (crop)'), icon: Icon(Icons.crop_rounded)),
            ButtonSegment(value: false, label: Text('Fit (bars)'), icon: Icon(Icons.fit_screen_rounded)),
          ],
          selected: {fill},
          onSelectionChanged: (s) => setState(() => fill = s.first),
        ),
        SizedBox(height: 16),
        FilledButton(
          onPressed: () {
            _close(context);
            widget.onEdit((ir) => TimelineOps.setAspect(ir, aspect, fill: fill, focus: widget.c.faceFocus));
          },
          child: Text('Apply'),
        ),
      ]);
}

class _RotateSheet extends StatefulWidget {
  const _RotateSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  State<_RotateSheet> createState() => _RotateSheetState();
}

class _RotateSheetState extends State<_RotateSheet> {
  bool all = true;

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const _Title('Rotate & flip'),
        _Scope(all: all, onChanged: (v) => setState(() => all = v), index: widget.index, count: widget.c.ir!.clips.length),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                _close(context);
                widget.onEdit((ir) => TimelineOps.rotate(ir, index: all ? null : widget.index));
              },
              icon: Icon(Icons.rotate_90_degrees_cw_rounded),
              label: Text('Rotate 90°'),
            ),
          ),
          SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () {
                _close(context);
                widget.onEdit((ir) => TimelineOps.rotate(ir, index: all ? null : widget.index, rotate90: false, toggleFlip: true));
              },
              icon: Icon(Icons.flip_rounded),
              label: Text('Flip'),
            ),
          ),
        ]),
      ]);
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  bool all = true;

  @override
  Widget build(BuildContext context) {
    final current = widget.c.ir!.clips[widget.index].filter?.preset;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const _Title('Filters'),
      _Scope(all: all, onChanged: (v) => setState(() => all = v), index: widget.index, count: widget.c.ir!.clips.length),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ChoiceChip(
          label: Text('None'),
          selected: current == null,
          onSelected: (_) {
            _close(context);
            widget.onEdit((ir) => TimelineOps.setFilter(ir, null, index: all ? null : widget.index));
          },
        ),
        for (final e in filterLooks.entries)
          ChoiceChip(
            label: Text(e.key),
            selected: current == e.value.preset,
            onSelected: (_) {
              _close(context);
              widget.onEdit((ir) => TimelineOps.setFilter(ir, e.value, index: all ? null : widget.index));
            },
          ),
      ]),
    ]);
  }
}

class _AdjustSheet extends StatefulWidget {
  const _AdjustSheet({required this.c, required this.index, required this.onEdit});
  final StudioController c;
  final int index;
  final EditFn onEdit;

  @override
  State<_AdjustSheet> createState() => _AdjustSheetState();
}

class _AdjustSheetState extends State<_AdjustSheet> {
  late EditIrFilter f = widget.c.ir!.clips[widget.index].filter ?? EditIrFilter();
  bool all = true;

  /// [v] shown as -100..+100 around [neutral]; [span] is how far the slider reaches either side.
  Widget _slider(String label, double v, double neutral, double span, ValueChanged<double> on, {bool oneSided = false}) {
    final shown = ((v - neutral) / span * 100).round();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('$label  ${shown > 0 && !oneSided ? '+' : ''}$shown'),
      Slider(
        value: v.clamp(oneSided ? neutral : neutral - span, neutral + span),
        min: oneSided ? neutral : neutral - span,
        max: neutral + span,
        divisions: oneSided ? 20 : 40,
        onChanged: on,
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const _Title('Adjust colour'),
        _Scope(all: all, onChanged: (v) => setState(() => all = v), index: widget.index, count: widget.c.ir!.clips.length),
        Flexible(
          child: SingleChildScrollView(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _slider('Exposure', f.exposure, 0, 1, (v) => setState(() => f = f.copyWith(exposure: v))),
              _slider('Brightness', f.brightness, 1, 1, (v) => setState(() => f = f.copyWith(brightness: v))),
              _slider('Contrast', f.contrast, 1, 1, (v) => setState(() => f = f.copyWith(contrast: v))),
              _slider('Saturation', f.saturation, 1, 1, (v) => setState(() => f = f.copyWith(saturation: v))),
              _slider('Warmth', f.temperature, 0, 1, (v) => setState(() => f = f.copyWith(temperature: v))),
              _slider('Tint', f.tint, 0, 1, (v) => setState(() => f = f.copyWith(tint: v))),
              _slider('Vignette', f.vignette, 0, 1, (v) => setState(() => f = f.copyWith(vignette: v)), oneSided: true),
            ]),
          ),
        ),
        Row(children: [
          TextButton(
            onPressed: () => setState(() => f = EditIrFilter(preset: f.preset)),
            child: Text('Reset'),
          ),
          Spacer(),
          FilledButton(
            onPressed: () {
              _close(context);
              final next = f;
              widget.onEdit((ir) => TimelineOps.setFilter(ir, next.isNeutral ? null : next, index: all ? null : widget.index));
            },
            child: Text('Apply'),
          ),
        ]),
      ]);
}

/// Records a voiceover from the playhead. The recording is placed where it started; music ducks under it on export.
class _VoiceoverSheet extends StatefulWidget {
  const _VoiceoverSheet({required this.c});
  final StudioController c;

  @override
  State<_VoiceoverSheet> createState() => _VoiceoverSheetState();
}

class _VoiceoverSheetState extends State<_VoiceoverSheet> {
  final _narration = TextEditingController();
  Timer? _tick;
  DateTime? _since;
  bool _busy = false;

  Future<void> _speak() => _run(() async {
        await widget.c.addNarration(_narration.text);
        if (mounted) {
          _close(context);
          showSuccess(context, 'AI voice added');
        }
      });

  @override
  void dispose() {
    _narration.dispose();
    _tick?.cancel();
    // Closing the sheet mid-recording discards it rather than leaving the microphone on.
    if (widget.c.recordingVoiceover) unawaited(widget.c.cancelVoiceover());
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _start() => _run(() async {
        await widget.c.startVoiceover();
        _since = DateTime.now();
        _tick = Timer.periodic(const Duration(milliseconds: 200), (_) => setState(() {}));
      });

  Future<void> _stop() => _run(() async {
        _tick?.cancel();
        await widget.c.stopVoiceover();
        if (mounted) {
          _close(context);
          showSuccess(context, 'Voiceover added');
        }
      });

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    final recording = c.recordingVoiceover;
    final elapsed = _since == null ? 0 : DateTime.now().difference(_since!).inMilliseconds;
    final count = c.ir?.audio.voiceovers.length ?? 0;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title(
        'Voiceover',
        subtitle: recording
            ? 'Recording from ${timecode(c.voiceoverStartMs ?? 0)}…'
            : 'Records from the playhead (${timecode(c.playheadMs)}) while the video plays (muted). Music is lowered under your voice on export.',
      ),
      if (recording)
        Text(timecode(elapsed), textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: AppTheme.error)),
      SizedBox(height: 12),
      SizedBox(
        height: 56,
        child: FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: recording ? AppTheme.error : null),
          onPressed: _busy ? null : (recording ? _stop : _start),
          icon: Icon(recording ? Icons.stop_rounded : Icons.mic_rounded),
          label: Text(recording ? 'Stop and add' : 'Start recording'),
        ),
      ),
      if (recording)
        TextButton(onPressed: _busy ? null : () => _run(c.cancelVoiceover), child: Text('Discard')),
      if (!recording) ...[
        Divider(height: 28),
        Text("Or type it and let the phone's AI voice read it", style: TextStyle(color: AppTheme.textSecondary)),
        SizedBox(height: 8),
        TextField(controller: _narration, minLines: 2, maxLines: 4, maxLength: 400, decoration: fieldDecoration('Narration text')),
        SizedBox(
          height: 48,
          child: OutlinedButton.icon(
            onPressed: _busy ? null : _speak,
            icon: Icon(Icons.record_voice_over_rounded),
            label: Text(_busy ? 'Generating voice…' : 'Generate AI voice'),
          ),
        ),
      ],
      if (!recording && count > 0)
        Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
            '$count voiceover${count == 1 ? '' : 's'} on the timeline. Tap one on the Voiceover track to move, trim, change its volume or delete it.',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
        ),
    ]);
  }
}

/// Emoji stickers drawn on the phone; each is placed at the playhead as a floating layer (drag it on the preview).
class _StickerSheet extends StatefulWidget {
  const _StickerSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  State<_StickerSheet> createState() => _StickerSheetState();
}

class _StickerSheetState extends State<_StickerSheet> {
  String? _busy;
  final _q = TextEditingController();
  List<StockPhotoResult>? _found;
  Object? _error;
  bool _searching = false;

  @override
  void initState() {
    super.initState();
    _search(); // popular 3D stickers
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _search([String? q]) async {
    if (q != null) _q.text = q;
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final r = await widget.c.director.searchStickers(_q.text.trim());
      if (mounted) setState(() => _found = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  /// 3D sticker: downloaded first (progress on the tile), then placed like any sticker.
  Future<void> _add3d(StockPhotoResult s) async {
    setState(() => _busy = s.url);
    try {
      await AssetCache.instance.ensure(s.url, kind: AssetKind.image);
      if (!mounted) return;
      if (s.attribution != null) widget.c.mediaCredits[s.url] = s.attribution!;
      _close(context);
      widget.onEdit(
        (ir) => TimelineOps.addSticker(ir, {'kind': 'url', 'url': s.url, 'query': s.title},
            startMs: widget.c.playheadMs, avoidFace: TimelineOps.faceOnCanvas(ir, widget.c.faces, widget.c.playheadMs)),
        done: 'Sticker added. Drag it on the preview to move it.',
      );
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _add(String emoji) async {
    setState(() => _busy = emoji);
    try {
      final docs = await getApplicationDocumentsDirectory();
      final name = emoji.runes.map((r) => r.toRadixString(16)).join('_');
      final path = await renderEmojiSticker(emoji, '${docs.path}/stickers/emoji_$name.png');
      final source = widget.c.localOverlaySource(path, label: 'Sticker $emoji');
      if (!mounted) return;
      _close(context);
      widget.onEdit(
          (ir) => TimelineOps.addSticker(ir, source,
              startMs: widget.c.playheadMs, avoidFace: TimelineOps.faceOnCanvas(ir, widget.c.faces, widget.c.playheadMs)),
          done: 'Sticker added. Drag it on the preview to move it.');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _Title('Stickers', subtitle: 'Added at ${timecode(widget.c.playheadMs)} for 2.5 s. Resize, rotate and animate it in the B-roll inspector.'),
        Text('3D stickers', style: Theme.of(context).textTheme.labelLarge),
        SizedBox(height: 6),
        TextField(
          controller: _q,
          textInputAction: TextInputAction.search,
          onSubmitted: (_) => _search(),
          decoration: fieldDecoration('Search 3D stickers', hint: 'fire, rocket, money, trophy…').copyWith(
            suffixIcon: IconButton(tooltip: 'Search', icon: Icon(Icons.search_rounded), onPressed: () => _search()),
          ),
        ),
        SizedBox(height: 8),
        if (_searching) SizedBox(height: 120, child: UniversalSkeleton(type: SkeletonType.projects)),
        if (_error != null && !_searching) ErrorView(error: _error!, compact: true, onRetry: _search),
        if (!_searching && _error == null && (_found?.isEmpty ?? false))
          EmptyView(
            icon: Icons.emoji_emotions_outlined,
            title: 'No 3D stickers found',
            message: 'Try one simple word, or use an emoji below.',
            actionLabel: 'Show popular',
            onAction: () => _search(''),
          ),
        if (!_searching && (_found?.isNotEmpty ?? false))
          SizedBox(
            height: 132,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final s in _found!)
                Padding(
                  padding: EdgeInsets.only(right: 6),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: _busy == null ? () => _add3d(s) : null,
                    child: SizedBox(
                      width: 96,
                      child: Column(children: [
                        SizedBox(
                          width: 88,
                          height: 88,
                          child: Stack(fit: StackFit.expand, children: [
                            Opacity(
                              opacity: _busy == s.url ? 0.4 : 1,
                              child: Image.network(s.thumbnailUrl, cacheWidth: 200, fit: BoxFit.contain,
                                  errorBuilder: (_, _, _) => Icon(Icons.broken_image_rounded, color: AppTheme.textMuted)),
                            ),
                            Positioned(top: 0, right: 0, child: AssetDownloadBadge(url: s.url)),
                          ]),
                        ),
                        SizedBox(height: 4),
                        Text(s.title, maxLines: 2, textAlign: TextAlign.center, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11)),
                      ]),
                    ),
                  ),
                ),
            ]),
          ),
        SizedBox(height: 12),
        Text('Emoji', style: Theme.of(context).textTheme.labelLarge),
        SizedBox(height: 6),
        Wrap(spacing: 4, runSpacing: 4, children: [
          for (final e in stickerEmojis)
            SizedBox(
              width: 52,
              height: 52,
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: _busy == null ? () => _add(e) : null,
                // The sticker being drawn dims until it is placed.
                child: Center(child: Opacity(opacity: _busy == e ? 0.3 : 1, child: Text(e, style: TextStyle(fontSize: 30)))),
              ),
            ),
        ]),
      ]);
}

// ── overlays & audio ─────────────────────────────────────────────────────────

class _TextSheet extends StatefulWidget {
  const _TextSheet({required this.c, required this.onEdit, this.captionId});
  final StudioController c;
  final EditFn onEdit;
  final String? captionId;

  @override
  State<_TextSheet> createState() => _TextSheetState();
}

class _TextSheetState extends State<_TextSheet> {
  late final EditIrCaption? _existing = () {
    final id = widget.captionId ??
        (widget.c.selectedKind == TrackKind.captions ? widget.c.selectedItemId : null);
    if (id == null) return null;
    return widget.c.ir?.captions.where((c) => c.id == id).firstOrNull;
  }();

  late final _text = TextEditingController(text: _existing?.text ?? '');
  late double seconds = _existing != null ? ((_existing.endMs - _existing.startMs) / 1000).clamp(0.5, 30.0) : 3.0;
  late double y = (_existing?.style['positionY'] as num?)?.toDouble() ?? 0.25;
  late double x = (_existing?.style['positionX'] as num?)?.toDouble() ?? 0.50;

  late String _fontFamily = (_existing?.style['fontFamily'] as String?) ?? 'Inter';
  late double _fontSize = (_existing?.style['fontSizePx'] as num?)?.toDouble() ?? 24;
  late String _textColor = (_existing?.style['textColor'] as String?) ?? '#FFFFFF';
  late String? _bgColor = (_existing?.style['background'] as Map?)?['color'] as String?;
  late int _strokeWidth = (_existing?.style['strokeWidthPx'] as num?)?.toInt() ?? 0;
  late bool _shadow = _existing?.style['shadow'] == true;
  late bool _glow = _existing?.style['glow'] == true;
  late final Map<String, dynamic> _initialStyle = normaliseCaptionStyle(_existing?.style ?? const {});
  late String _animation = (_initialStyle['animation'] as String?) ?? 'none';
  late String? _enter = (_initialStyle['enter'] as Map?)?['type'] as String?;
  late String? _exit = (_initialStyle['exit'] as Map?)?['type'] as String?;
  late String? _loop = (_initialStyle['loop'] as Map?)?['type'] as String?;

  static const _emojis = ['🔥', '🚀', '❤️', '💡', '👏', '😂', '✨', '🎯', '📈', '⚡', '🎬', '💥', '💰', '👑', '🎉', '💯'];
  static const _fonts = ['Inter', 'Anton', 'Montserrat', 'Poppins', 'Syne', 'Outfit', 'Roboto', 'Bebas Neue'];
  static const _textColors = [
    ('#FFFFFF', 'White'),
    ('#FFE600', 'Yellow'),
    ('#22D3EE', 'Cyan'),
    ('#4ADE80', 'Green'),
    ('#F472B6', 'Pink'),
    ('#FB923C', 'Orange'),
    ('#000000', 'Black'),
    ('#EF4444', 'Red'),
  ];
  static const _bgColors = [
    (null, 'None'),
    ('#B3000000', 'Black'),
    ('#CCFFFFFF', 'White'),
    ('#4D22D3EE', 'Cyan'),
    ('#80EF4444', 'Red'),
  ];
  /// Word highlighting (captions); motion lives in the In / Out / Loop pickers below.
  static const _animations = [
    ('none', 'None'),
    ('word_pop', 'Word Pop'),
    ('karaoke', 'Karaoke'),
    ('word_box', 'Word Box'),
    ('word_reveal', 'Word Reveal'),
  ];

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _insertEmoji(String emoji) {
    final cur = _text.text;
    final pos = _text.selection.baseOffset;
    if (pos >= 0 && pos <= cur.length) {
      _text.text = cur.substring(0, pos) + emoji + cur.substring(pos);
      _text.selection = TextSelection.collapsed(offset: pos + emoji.length);
    } else {
      _text.text = cur + emoji;
      _text.selection = TextSelection.collapsed(offset: _text.text.length);
    }
    setState(() {});
  }

  Map<String, dynamic> _buildStyle() => {
        'fontFamily': _fontFamily,
        'fontSizePx': _fontSize,
        'textColor': _textColor,
        'highlightColor': _textColor,
        'positionX': x,
        'positionY': y,
        if (_bgColor != null) 'background': {'color': _bgColor},
        if (_strokeWidth > 0) 'strokeWidthPx': _strokeWidth,
        if (_strokeWidth > 0) 'strokeColor': '#000000',
        'shadow': _shadow,
        'glow': _glow,
        'animation': _animation,
        if (_enter != null) 'enter': {'type': _enter, 'durationMs': _enter == 'typewriter' ? 1200 : 400},
        if (_exit != null) 'exit': {'type': _exit, 'durationMs': 400},
        if (_loop != null) 'loop': {'type': _loop, 'periodMs': 1200},
      };

  @override
  Widget build(BuildContext context) {
    final titles = widget.c.ir!.captions.where((c) => c.kind == 'text').toList();
    final previewStyle = _buildStyle();

    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.78,
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _Title(
            _existing != null ? 'Edit text style' : 'Add text',
            subtitle: 'Starts at ${timecode(widget.c.playheadMs)}. Drag directly on video to position.',
          ),

          // Live Text Preview Box
          Container(
            height: 72,
            margin: EdgeInsets.only(bottom: 12),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.black45,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border),
            ),
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                _text.text.isEmpty ? 'Sample Text' : _text.text,
                textAlign: TextAlign.center,
                style: CaptionFonts.textStyle(
                  previewStyle,
                  fontSize: _fontSize.clamp(14, 32),
                  color: Color(int.parse('FF${_textColor.substring(1)}', radix: 16)),
                  shadows: [
                    if (_glow) Shadow(blurRadius: 16, color: Color(int.parse('FF${_textColor.substring(1)}', radix: 16))),
                    if (_shadow || _strokeWidth > 0) ...[
                      Shadow(blurRadius: 4, color: Colors.black),
                      Shadow(blurRadius: 1, color: Colors.black),
                    ],
                  ],
                ),
              ),
            ),
          ),

          // Text Field
          TextField(
            controller: _text,
            autofocus: _existing == null,
            maxLines: 2,
            onChanged: (_) => setState(() {}),
            decoration: fieldDecoration('Text content', hint: 'Type your title, hook, or text…'),
          ),
          SizedBox(height: 8),

          // Quick Emojis
          Row(children: [
            Icon(Icons.emoji_emotions_outlined, size: 16, color: AppTheme.textSecondary),
            SizedBox(width: 6),
            Text('Quick Emojis', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, fontWeight: FontWeight.bold)),
          ]),
          SizedBox(height: 6),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final em in _emojis)
                  Padding(
                    padding: EdgeInsets.only(right: 6),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () => _insertEmoji(em),
                      child: Container(
                        padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(8)),
                        child: Text(em, style: TextStyle(fontSize: 18)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(height: 12),

          // Google Font Family
          Text('Font Style', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
          SizedBox(height: 6),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final f in _fonts)
                  Padding(
                    padding: EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(f),
                      selected: _fontFamily == f,
                      onSelected: (_) => setState(() => _fontFamily = f),
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(height: 12),

          // Text Colors
          Text('Text Color', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
          SizedBox(height: 6),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final (hex, _) in _textColors)
                  Padding(
                    padding: EdgeInsets.only(right: 8),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: () => setState(() => _textColor = hex),
                      child: Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: Color(int.parse('FF${hex.substring(1)}', radix: 16)),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: _textColor == hex ? AppTheme.primary : AppTheme.border,
                            width: _textColor == hex ? 3 : 1,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(height: 12),

          // Highlight / Background
          Text('Highlight Box', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
          SizedBox(height: 6),
          Wrap(spacing: 8, children: [
            for (final (hex, label) in _bgColors)
              ChoiceChip(
                label: Text(label),
                selected: _bgColor == hex,
                onSelected: (_) => setState(() => _bgColor = hex),
              ),
          ]),
          SizedBox(height: 12),

          // Word highlighting
          Text('Word highlight', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
          SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 6, children: [
            for (final (animKey, animLabel) in _animations)
              ChoiceChip(
                label: Text(animLabel),
                selected: _animation == animKey,
                onSelected: (_) => setState(() => _animation = animKey),
              ),
          ]),
          SizedBox(height: 12),

          // Motion: the same In / Out / Loop the export renders.
          for (final (label, types, value, set) in [
            ('In', textEnterTypes, _enter, (String? v) => _enter = v),
            ('Out', textExitTypes, _exit, (String? v) => _exit = v),
            ('Loop', textLoopTypes, _loop, (String? v) => _loop = v),
          ]) ...[
            Text('Animation: $label', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
            SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 6, children: [
              ChoiceChip(label: Text('None'), selected: value == null, onSelected: (_) => setState(() => set(null))),
              for (final t in types)
                ChoiceChip(label: Text(textMotionLabels[t] ?? t), selected: value == t, onSelected: (_) => setState(() => set(t))),
            ]),
            SizedBox(height: 12),
          ],

          // Effects: Stroke, Shadow, Glow
          Text('Effects & Styling', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
          SizedBox(height: 6),
          Wrap(spacing: 8, children: [
            FilterChip(
              label: Text('Drop Shadow'),
              selected: _shadow,
              onSelected: (v) => setState(() => _shadow = v),
            ),
            FilterChip(
              label: Text('Neon Glow'),
              selected: _glow,
              onSelected: (v) => setState(() => _glow = v),
            ),
            ChoiceChip(
              label: Text('No Stroke'),
              selected: _strokeWidth == 0,
              onSelected: (_) => setState(() => _strokeWidth = 0),
            ),
            ChoiceChip(
              label: Text('Outline 2px'),
              selected: _strokeWidth == 2,
              onSelected: (_) => setState(() => _strokeWidth = 2),
            ),
            ChoiceChip(
              label: Text('Outline 4px'),
              selected: _strokeWidth == 4,
              onSelected: (_) => setState(() => _strokeWidth = 4),
            ),
          ]),
          SizedBox(height: 12),

          // Font Size & Duration
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Size: ${_fontSize.round()}px', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                Slider(
                  value: _fontSize,
                  min: 14,
                  max: 56,
                  divisions: 21,
                  onChanged: (v) => setState(() => _fontSize = v),
                ),
              ]),
            ),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Duration: ${seconds.toStringAsFixed(1)}s', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                Slider(
                  value: seconds,
                  min: 0.5,
                  max: 10,
                  divisions: 19,
                  onChanged: (v) => setState(() => seconds = v),
                ),
              ]),
            ),
          ]),
          SizedBox(height: 8),

          // Vertical Position Quick Buttons
          Text('Vertical Position', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
          SizedBox(height: 6),
          SegmentedButton<double>(
            segments: [
              ButtonSegment(value: 0.18, label: Text('Top')),
              ButtonSegment(value: 0.50, label: Text('Center')),
              ButtonSegment(value: 0.82, label: Text('Bottom')),
            ],
            selected: {y},
            onSelectionChanged: (v) => setState(() => y = v.first),
          ),
          SizedBox(height: 16),

          // Apply / Add Button
          FilledButton.icon(
            icon: Icon(_existing != null ? Icons.check_rounded : Icons.add_rounded),
            label: Text(_existing != null ? 'Update text' : 'Add text to video'),
            onPressed: () {
              final t = _text.text.trim();
              if (t.isEmpty) return;
              _close(context);
              final ex = _existing;
              if (ex != null) {
                widget.onEdit(
                  (ir) => TimelineOps.editText(ir, ex.id, text: t, style: _buildStyle()),
                  done: 'Text updated',
                );
              } else {
                widget.onEdit(
                  (ir) => TimelineOps.addText(
                    ir,
                    t,
                    startMs: widget.c.playheadMs,
                    durationMs: (seconds * 1000).round(),
                    positionY: y,
                    positionX: x,
                    style: _buildStyle(),
                  ),
                  done: 'Text added',
                );
              }
            },
          ),

          if (titles.isNotEmpty) ...[
            SizedBox(height: 16),
            SectionHeader('On this video'),
            for (final t in titles)
              ListTile(
                dense: true,
                title: Text(t.text, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('${timecode(t.startMs)} – ${timecode(t.endMs)}'),
                trailing: IconButton(
                  icon: Icon(Icons.delete_outline_rounded, color: AppTheme.error),
                  onPressed: () {
                    _close(context);
                    widget.onEdit((ir) => TimelineOps.removeCaption(ir, t.id));
                  },
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// One-tap cleanup from the transcript: cut pauses, cut filler words. Both work on every clip, in any order.
class _CleanupSheet extends StatefulWidget {
  const _CleanupSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  State<_CleanupSheet> createState() => _CleanupSheetState();
}

class _CleanupSheetState extends State<_CleanupSheet> {
  int gapMs = 500;

  @override
  Widget build(BuildContext context) {
    final c = widget.c;
    final ready = c.transcriptState == TranscriptState.ready && c.words.isNotEmpty;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title('Clean up',
          subtitle: ready
              ? 'Cuts follow the transcript (${c.words.length} words). Undo brings everything back.'
              : c.transcriptState == TranscriptState.running
                  ? 'Waiting for the transcript…'
                  : 'Cleanup needs a transcript. ${errorText(c.transcriptError ?? '')}'),
      Text('Pauses longer than', style: TextStyle(color: AppTheme.textSecondary)),
      Wrap(spacing: 8, children: [
        for (final ms in const [300, 500, 800, 1200])
          ChoiceChip(label: Text('${(ms / 1000).toStringAsFixed(1)} s'), selected: gapMs == ms, onSelected: (_) => setState(() => gapMs = ms)),
      ]),
      SizedBox(height: 8),
      SizedBox(
        height: 48,
        child: FilledButton.icon(
          onPressed: !ready
              ? null
              : () {
                  _close(context);
                  widget.onEdit((ir) => TimelineOps.removePauses(ir, c.words, minGapMs: gapMs), done: 'Pauses removed');
                },
          icon: Icon(Icons.content_cut_rounded),
          label: Text('Remove pauses'),
        ),
      ),
      SizedBox(height: 8),
      SizedBox(
        height: 48,
        child: OutlinedButton.icon(
          onPressed: !ready
              ? null
              : () {
                  _close(context);
                  widget.onEdit((ir) => TimelineOps.removeFillers(ir, c.words), done: 'Filler words removed');
                },
          icon: Icon(Icons.record_voice_over_rounded),
          label: Text('Remove filler words (um, uh, you know…)'),
        ),
      ),
      if (!ready && c.transcriptState == TranscriptState.failed)
        TextButton(onPressed: c.transcribe, child: Text('Retry transcript')),
    ]);
  }
}

class _CaptionsSheet extends StatefulWidget {
  const _CaptionsSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  State<_CaptionsSheet> createState() => _CaptionsSheetState();
}

class _CaptionsSheetState extends State<_CaptionsSheet> {
  /// Starts on the style the captions already use, so "Apply to all" is a no-op until changed.
  late String preset = () {
    final current = widget.c.ir!.captions.where((x) => x.kind == 'caption').firstOrNull?.style['preset'];
    return current is String && TimelineOps.captionPresets.containsKey(current) ? current : 'BOLD_POP';
  }();
  int words = 3;

  /// Null keeps the preset's own highlight colour.
  String? color;
  double y = 0.72;
  double? _fontSizePx;
  bool _autoGenerating = false;

  Future<void> _autoGenerate() async {
    final c = widget.c;
    setState(() => _autoGenerating = true);
    try {
      if (c.transcriptState != TranscriptState.ready) {
        if (c.transcriptState != TranscriptState.running) {
          await c.transcribe();
        } else {
          while (c.transcriptState == TranscriptState.running && mounted) {
            await Future.delayed(const Duration(milliseconds: 200));
          }
        }
      }
      if (!mounted) return;
      if (c.transcriptState == TranscriptState.ready && c.words.isNotEmpty) {
        _close(context);
        final keywords = _keywords;
        final chosenPreset = preset;
        final chosenWords = words;
        final chosenColor = color;
        final chosenY = y;
        final chosenFontSize = _fontSizePx;
        widget.onEdit((ir) {
          final out = TimelineOps.autoCaptions(
            ir,
            c.words,
            preset: chosenPreset,
            wordsPerCaption: chosenWords,
            highlightColor: chosenColor,
            positionY: chosenY,
            fontSizePx: chosenFontSize,
          );
          return keywords ? TimelineOps.enhanceCaptions(out) : out;
        }, done: '✨ Auto-generated viral captions added!');
      } else if (c.transcriptState == TranscriptState.failed) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Transcription failed: ${errorText(c.transcriptError ?? '')}')),
          );
        }
      }
    } finally {
      if (mounted) setState(() => _autoGenerating = false);
    }
  }

  /// Convert captions: target language, script, and the request state.
  String? _convertTo;
  bool _roman = false;
  bool _converting = false;
  Object? _convertError;

  Future<void> _convert() async {
    final target = _convertTo;
    if (target == null || _converting) return;
    setState(() {
      _converting = true;
      _convertError = null;
    });
    try {
      final texts = await widget.c.translateCaptions(target, script: _roman ? 'roman' : 'native');
      if (!mounted) return;
      _close(context);
      widget.onEdit((ir) => TimelineOps.retextCaptions(ir, texts),
          done: 'Captions converted to ${CaptionLanguages.nameOf(target)}${_roman ? ' (Roman letters)' : ''}');
    } catch (e) {
      if (mounted) {
        setState(() {
          _converting = false;
          _convertError = e;
        });
      }
    }
  }

  /// Auto key-word emphasis applied when captions are added or regenerated.
  bool _keywords = true;

  /// Fix caption text: one field per speech caption while editing (caption id → controller).
  Map<String, TextEditingController>? _fixing;
  Object? _exportError;

  @override
  void dispose() {
    for (final t in _fixing?.values ?? const <TextEditingController>[]) {
      t.dispose();
    }
    super.dispose();
  }

  List<EditIrCaption> get _speech => [for (final x in widget.c.ir!.captions) if (x.kind == 'caption') x];

  void _startFixing() => setState(() => _fixing = {for (final x in _speech) x.id: TextEditingController(text: x.text)});

  void _saveFixes() {
    final old = {for (final x in _speech) x.id: x.text};
    final changed = {
      for (final e in _fixing!.entries)
        if (e.value.text.trim().isNotEmpty && e.value.text.trim() != old[e.key]) e.key: e.value.text.trim(),
    };
    _close(context);
    if (changed.isEmpty) return;
    widget.onEdit((ir) => TimelineOps.retextCaptions(ir, changed), done: '${changed.length} caption${changed.length == 1 ? '' : 's'} corrected');
  }

  /// Shares the captions as .srt and .vtt files (written to the temp folder first).
  Future<void> _exportSubtitles() async {
    setState(() => _exportError = null);
    try {
      final dir = await getTemporaryDirectory();
      final ir = widget.c.ir!;
      final srt = await File('${dir.path}/captions.srt').writeAsString(CaptionTools.toSrt(ir), flush: true);
      final vtt = await File('${dir.path}/captions.vtt').writeAsString(CaptionTools.toVtt(ir), flush: true);
      await SharePlus.instance.share(ShareParams(files: [
        XFile(srt.path, mimeType: 'application/x-subrip'),
        XFile(vtt.path, mimeType: 'text/vtt'),
      ]));
    } catch (e) {
      if (mounted) setState(() => _exportError = e);
    }
  }

  Widget _fixBody(BuildContext context) {
    final caps = _speech;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title('Fix caption text', subtitle: 'Correct any word. Timings stay as they are.'),
      ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.5),
        child: ListView.builder(
          shrinkWrap: true,
          itemCount: caps.length,
          itemBuilder: (context, i) => Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: TextField(
              controller: _fixing![caps[i].id],
              minLines: 1,
              maxLines: 3,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: timecode(caps[i].startMs), isDense: true),
            ),
          ),
        ),
      ),
      SizedBox(height: 8),
      Wrap(alignment: WrapAlignment.end, spacing: 8, children: [
        TextButton(
          onPressed: () => setState(() {
            for (final t in _fixing!.values) {
              t.dispose();
            }
            _fixing = null;
          }),
          child: Text('Cancel'),
        ),
        FilledButton(onPressed: _saveFixes, child: Text('Save corrections')),
      ]),
    ]);
  }

  // The sheet follows the controller: a new transcript (language change) updates it in place.
  @override
  Widget build(BuildContext context) => _fixing != null
      ? _fixBody(context)
      : ListenableBuilder(
          listenable: widget.c,
          builder: (context, _) => SingleChildScrollView(child: _body(context)),
        );

  Widget _body(BuildContext context) {
    final c = widget.c;
    final has = c.ir!.captions.any((x) => x.kind == 'caption');
    final ready = c.transcriptState == TranscriptState.ready;
    final running = c.transcriptState == TranscriptState.running;
    final detected = c.transcript?.language;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title('Captions',
          subtitle: ready
              ? 'Word-synced from the transcript (${c.words.length} words'
                  '${c.spokenLanguage == CaptionLanguages.auto && CaptionLanguages.isKnown(detected) ? ', detected ${CaptionLanguages.nameOf(detected!)}' : ''}).'
              : running
                  ? 'Waiting for the transcript…'
                  : 'Captions need a transcript. ${errorText(c.transcriptError ?? '')}'),
      if (!has) ...[
        Container(
          margin: EdgeInsets.only(bottom: 12),
          padding: EdgeInsets.all(12),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [AppTheme.primary.withValues(alpha: 0.18), Colors.purpleAccent.withValues(alpha: 0.12)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.primary.withValues(alpha: 0.35)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Icon(Icons.auto_awesome, color: AppTheme.primary, size: 20),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '1-Tap Auto Viral Captions',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                ),
              ]),
              SizedBox(height: 6),
              Text(
                'Automatically transcribes speech, syncs word timings, and applies trending viral motion and keyword highlights.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _autoGenerating ? null : _autoGenerate,
                icon: _autoGenerating
                    ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Icon(Icons.bolt_rounded),
                label: Text(_autoGenerating
                    ? (running ? 'Transcribing & syncing…' : 'Generating viral captions…')
                    : '✨ Auto-Generate Captions Now'),
              ),
            ],
          ),
        ),
      ],
      Row(children: [
        Expanded(child: Text('Spoken language')),
        DropdownButton<String>(
          value: c.spokenLanguage,
          onChanged: running ? null : (v) => v == null ? null : c.setSpokenLanguage(v),
          items: [
            for (final e in CaptionLanguages.spoken.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
          ],
        ),
      ]),
      if (running) SizedBox(height: 48, child: UniversalSkeleton(type: SkeletonType.activity)),
      SizedBox(height: 8),
      SizedBox(
        height: 84,
        child: ListView(scrollDirection: Axis.horizontal, children: [
          for (final e in TimelineOps.captionPresets.entries)
            CaptionPresetCard(
              name: e.value,
              style: TimelineOps.captionStyle(e.key),
              selected: preset == e.key,
              onTap: () => setState(() => preset = e.key),
            ),
        ]),
      ),
      SizedBox(height: 8),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          Text('Highlight'),
          SizedBox(width: 8),
          ChoiceChip(label: Text('Preset'), selected: color == null, onSelected: (_) => setState(() => color = null)),
          SizedBox(width: 8),
          for (final hex in ['#FFE600', '#22D3EE', '#4ADE80', '#F472B6', '#FFFFFF'])
            Semantics(
              button: true,
              selected: color == hex,
              label: 'Highlight $hex',
              child: GestureDetector(
                onTap: () => setState(() => color = hex),
                child: Container(
                  width: 36,
                  height: 36,
                  margin: EdgeInsets.only(right: 8),
                  decoration: BoxDecoration(
                    color: Color(int.parse('FF${hex.substring(1)}', radix: 16)),
                    shape: BoxShape.circle,
                    border: Border.all(color: color == hex ? AppTheme.primary : AppTheme.border, width: color == hex ? 3 : 1),
                  ),
                ),
              ),
            ),
        ]),
      ),
      SizedBox(height: 8),
      Text('Caption font size', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppTheme.textSecondary)),
      SizedBox(height: 4),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          ChoiceChip(
            label: Text('Preset default'),
            selected: _fontSizePx == null,
            onSelected: (_) => setState(() => _fontSizePx = null),
          ),
          SizedBox(width: 6),
          ChoiceChip(
            label: Text('Compact (42px)'),
            selected: _fontSizePx == 42.0,
            onSelected: (_) => setState(() => _fontSizePx = 42.0),
          ),
          SizedBox(width: 6),
          ChoiceChip(
            label: Text('Standard (56px)'),
            selected: _fontSizePx == 56.0,
            onSelected: (_) => setState(() => _fontSizePx = 56.0),
          ),
          SizedBox(width: 6),
          ChoiceChip(
            label: Text('Bold (70px)'),
            selected: _fontSizePx == 70.0,
            onSelected: (_) => setState(() => _fontSizePx = 70.0),
          ),
          SizedBox(width: 6),
          ChoiceChip(
            label: Text('Massive Viral (88px)'),
            selected: _fontSizePx == 88.0,
            onSelected: (_) => setState(() => _fontSizePx = 88.0),
          ),
        ]),
      ),
      SizedBox(height: 6),
      Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text('Auto'),
        FilterChip(label: Text('Highlight key words'), selected: _keywords, onSelected: (v) => setState(() => _keywords = v)),
      ]),
      Text('Words per caption: $words'),
      Slider(value: words.toDouble(), min: 1, max: 6, divisions: 5, onChanged: (v) => setState(() => words = v.round())),
      SegmentedButton<double>(
        segments: [ButtonSegment(value: 0.25, label: Text('Top')), ButtonSegment(value: 0.5, label: Text('Middle')), ButtonSegment(value: 0.72, label: Text('Bottom'))],
        selected: {y},
        onSelectionChanged: (v) => setState(() => y = v.first),
      ),
      SizedBox(height: 12),
      if (has)
        FilledButton.icon(
          onPressed: () {
            _close(context);
            widget.onEdit((ir) => TimelineOps.styleCaptions(ir, preset, highlightColor: color, positionY: y, fontSizePx: _fontSizePx),
                done: 'Caption style applied to all captions');
          },
          icon: Icon(Icons.format_paint_rounded),
          label: Text('Apply to all captions'),
        ),
      Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
        if (has)
          TextButton(
            onPressed: () {
              _close(context);
              widget.onEdit((ir) => TimelineOps.clearCaptions(ir), done: 'Captions removed');
            },
            child: Text('Remove', style: TextStyle(color: AppTheme.error)),
          ),
        if (!ready && c.transcriptState == TranscriptState.failed)
          TextButton(onPressed: c.transcribe, child: Text('Retry transcript')),
        (has ? OutlinedButton.new : FilledButton.new)(
          onPressed: !ready
              ? null
              : () {
                  _close(context);
                  final keywords = _keywords;
                  widget.onEdit((ir) {
                    final out = TimelineOps.autoCaptions(
                      ir,
                      c.words,
                      preset: preset,
                      wordsPerCaption: words,
                      highlightColor: color,
                      positionY: y,
                      fontSizePx: _fontSizePx,
                    );
                    return keywords ? TimelineOps.enhanceCaptions(out) : out;
                  }, done: 'Captions added');
                },
          child: Text(has ? 'Regenerate from transcript' : 'Add captions'),
        ),
      ]),
      if (has) ...[
        Divider(height: 24),
        Wrap(spacing: 8, children: [
          OutlinedButton.icon(onPressed: _startFixing, icon: Icon(Icons.edit_note_rounded), label: Text('Fix caption text')),
          OutlinedButton.icon(onPressed: _exportSubtitles, icon: Icon(Icons.subtitles_rounded), label: Text('Export .srt / .vtt')),
        ]),
        if (_exportError != null) ...[
          Text('The subtitle files could not be shared. ${errorText(_exportError!)}', style: TextStyle(color: AppTheme.error)),
          Wrap(spacing: 8, children: [
            TextButton(onPressed: _exportSubtitles, child: Text('Try again')),
            TextButton(onPressed: () => setState(() => _exportError = null), child: Text('Dismiss')),
          ]),
        ],
        SizedBox(height: 8),
        Text('Convert captions', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
        Row(children: [
          Expanded(
            child: DropdownButton<String>(
              isExpanded: true,
              value: _convertTo,
              hint: Text('Choose a language'),
              onChanged: _converting ? null : (v) => setState(() => _convertTo = v),
              items: [
                for (final e in CaptionLanguages.targets.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
              ],
            ),
          ),
          SizedBox(width: 8),
          FilterChip(
            label: Text('Roman letters'),
            selected: _roman,
            onSelected: _converting ? null : (v) => setState(() => _roman = v),
          ),
        ]),
        if (_converting)
          SizedBox(height: 48, child: UniversalSkeleton(type: SkeletonType.activity))
        else if (_convertError != null) ...[
          Text(errorText(_convertError!), style: TextStyle(color: AppTheme.error)),
          Wrap(spacing: 8, children: [
            TextButton(onPressed: _convert, child: Text('Try again')),
            TextButton(onPressed: () => setState(() => _convertError = null), child: Text('Keep current captions')),
          ]),
        ] else
          OutlinedButton.icon(
            onPressed: _convertTo == null ? null : _convert,
            icon: Icon(Icons.translate_rounded),
            label: Text('Convert captions'),
          ),
      ],
    ]);
  }
}

class _MusicSheet extends ConsumerStatefulWidget {
  const _MusicSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  ConsumerState<_MusicSheet> createState() => _MusicSheetState();
}

class _MusicSheetState extends ConsumerState<_MusicSheet> {
  late final EditIrMusic? m = widget.c.ir!.audio.music.firstOrNull;
  late double vol = m?.volumeDb ?? -16;
  late bool duck = m?.duck?.enabled ?? true;
  late bool fades = (m?.fadeInMs ?? 500) > 0;
  final _query = TextEditingController(text: 'upbeat');
  bool _busy = false;
  bool _searching = false;
  List<StockAudioResult>? _results;
  String? _previewingUrl;
  VideoPlayerController? _previewPlayer;

  static const _moodChips = ['upbeat', 'lo-fi', 'cinematic', 'ambient', 'energetic', 'calm', 'electronic'];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _searchAudio(_query.text);
    });
  }

  @override
  void dispose() {
    _query.dispose();
    _previewPlayer?.dispose();
    super.dispose();
  }

  Future<void> _togglePreview(String url) async {
    if (_previewingUrl == url) {
      if (_previewPlayer?.value.isPlaying ?? false) {
        await _previewPlayer?.pause();
      } else {
        await _previewPlayer?.play();
      }
      setState(() {});
      return;
    }

    await _previewPlayer?.dispose();
    _previewPlayer = null;
    setState(() => _previewingUrl = url);

    try {
      final player = VideoPlayerController.networkUrl(Uri.parse(url));
      _previewPlayer = player;
      await player.initialize();
      await player.play();
      if (mounted) setState(() {});
    } catch (_) {
      if (mounted) {
        setState(() {
          _previewingUrl = null;
          _previewPlayer = null;
        });
      }
    }
  }

  Future<void> _searchAudio(String mood) async {
    final q = mood.trim();
    if (q.isEmpty) return;
    setState(() => _searching = true);
    try {
      final res = await ref.read(aiDirectorServiceProvider).searchStockAudio(q);
      if (!mounted) return;
      setState(() {
        _results = res;
        _searching = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _searching = false);
    }
  }

  Future<void> _applyTrack(String url, String title, String? credit) async {
    await _previewPlayer?.dispose();
    _previewPlayer = null;
    // Online tracks are downloaded first (progress shown on the row), so preview and export use the same file.
    if (url.startsWith('http')) {
      try {
        await AssetCache.instance.ensure(url, kind: AssetKind.audio);
      } catch (e) {
        if (mounted) showError(context, e);
        return;
      }
    }
    if (credit != null && credit.isNotEmpty) {
      widget.c.mediaCredits[url] = credit;
    }
    if (!mounted) return;
    _close(context);
    widget.onEdit(
      (ir) => TimelineOps.setMusic(
        ir,
        url: url,
        title: title,
        volumeDb: vol,
        fadeInMs: fades ? 500 : 0,
        fadeOutMs: fades ? 1000 : 0,
        duckUnderSpeech: duck,
      ),
      done: 'Music added',
    );
  }

  Future<void> _upload() async {
    final files = await FilePicker.pickFiles(type: FileType.audio);
    final file = files.firstOrNull;
    final path = file?.path;
    if (file == null || path == null || !mounted) return;
    setState(() => _busy = true);
    List<int>? bytes;
    try {
      bytes = await XFile(path).readAsBytes();
    } catch (_) {}
    if (!mounted) return;
    final url = await guarded(
      context,
      () => ref.read(socialApiProvider).uploadFile(path, fileBytes: bytes, filename: file.name),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (url != null) {
      _applyTrack(url, file.name, null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasSpeech = widget.c.ir!.audio.speechRangesMs.isNotEmpty;
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Title('Music & Soundtracks',
                subtitle: m == null
                    ? 'Plays under the video and loops automatically.'
                    : 'Current: ${m!.source['query'] ?? 'custom track'}'),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _query,
                  onSubmitted: _searchAudio,
                  decoration: fieldDecoration('Mood / Genre', hint: 'upbeat, chill, cinematic…'),
                ),
              ),
              SizedBox(width: 8),
              FilledButton.icon(
                onPressed: _searching || _busy ? null : () => _searchAudio(_query.text),
                icon: Icon(Icons.search_rounded, size: 18),
                label: Text('Find'),
              ),
            ]),
            SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final tag in _moodChips)
                    Padding(
                      padding: EdgeInsets.only(right: 6),
                      child: ActionChip(
                        label: Text(tag, style: TextStyle(fontSize: 12)),
                        backgroundColor: _query.text.trim().toLowerCase() == tag ? AppTheme.primary.withValues(alpha: 0.3) : AppTheme.surfaceElevated,
                        side: BorderSide(
                          color: _query.text.trim().toLowerCase() == tag ? AppTheme.primary : AppTheme.border,
                        ),
                        onPressed: () {
                          _query.text = tag;
                          _searchAudio(tag);
                        },
                      ),
                    ),
                ],
              ),
            ),
            if (_searching)
              SizedBox(height: 160, child: UniversalSkeleton(type: SkeletonType.projects)),
            if (_results != null && !_searching) ...[
              SizedBox(height: 12),
              Text(
                'Found ${_results!.length} tracks (Pixabay / Freesound):',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
              ),
              SizedBox(height: 6),
              if (_results!.isEmpty)
                Container(
                  padding: EdgeInsets.all(16),
                  decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(12)),
                  child: Text('No tracks found for this mood. Try "energetic" or "calm", or upload an audio file.',
                      style: TextStyle(color: AppTheme.textMuted)),
                )
              else
                ListView.separated(
                  shrinkWrap: true,
                  physics: NeverScrollableScrollPhysics(),
                  itemCount: _results!.length.clamp(0, 10),
                  separatorBuilder: (_, _) => Divider(height: 1, color: AppTheme.borderSubtle),
                  itemBuilder: (ctx, i) {
                    final t = _results![i];
                    final isPlaying = _previewingUrl == t.url && (_previewPlayer?.value.isPlaying ?? false);
                    final durStr = t.durationSec != null ? '${(t.durationSec! / 60).floor()}:${(t.durationSec! % 60).round().toString().padLeft(2, '0')}' : '';
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: IconButton(
                        icon: Icon(
                          isPlaying ? Icons.pause_circle_filled_rounded : Icons.play_circle_fill_rounded,
                          color: isPlaying ? AppTheme.success : AppTheme.primary,
                          size: 36,
                        ),
                        onPressed: () => _togglePreview(t.url),
                      ),
                      title: Text(t.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                      subtitle: Row(
                        children: [
                          Container(
                            padding: EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(4)),
                            child: Text(t.provider.toUpperCase(), style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
                          ),
                          if (durStr.isNotEmpty) ...[
                            SizedBox(width: 6),
                            Text(durStr, style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
                          ],
                        ],
                      ),
                      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                        AssetDownloadBadge(url: t.url),
                        SizedBox(width: 6),
                        FilledButton.tonal(
                          style: FilledButton.styleFrom(padding: EdgeInsets.symmetric(horizontal: 12, vertical: 6)),
                          onPressed: () => _applyTrack(t.url, t.title, t.attribution),
                          child: Text('Use', style: TextStyle(fontSize: 12)),
                        ),
                      ]),
                    );
                  },
                ),
            ],
            SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _busy || _searching ? null : _upload,
              icon: Icon(Icons.upload_file_rounded),
              label: Text('Use my own audio file'),
            ),
            if (_busy) Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
            SizedBox(height: 12),
            Text('Music volume: ${vol.toStringAsFixed(0)} dB'),
            Slider(value: vol, min: -40, max: 0, divisions: 40, onChanged: (v) => setState(() => vol = v.roundToDouble())),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: duck && hasSpeech,
              onChanged: hasSpeech ? (v) => setState(() => duck = v) : null,
              title: Text('Lower music while someone speaks'),
              subtitle: hasSpeech ? null : Text('Needs a transcript'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: fades,
              onChanged: (v) => setState(() => fades = v),
              title: Text('Fade in and out'),
            ),
            if (m != null)
              Row(children: [
                TextButton(
                  onPressed: () {
                    _close(context);
                    widget.onEdit((ir) => TimelineOps.removeMusic(ir), done: 'Music removed');
                  },
                  child: Text('Remove music', style: TextStyle(color: AppTheme.error)),
                ),
                Spacer(),
                FilledButton(
                  onPressed: () {
                    _close(context);
                    widget.onEdit((ir) => TimelineOps.updateMusic(ir, volumeDb: vol, duck: duck, fadeInMs: fades ? 500 : 0, fadeOutMs: fades ? 1000 : 0));
                  },
                  child: Text('Update'),
                ),
              ]),
          ],
        ),
      ),
    );
  }
}

class _ZoomSheet extends StatefulWidget {
  const _ZoomSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  State<_ZoomSheet> createState() => _ZoomSheetState();
}

class _ZoomSheetState extends State<_ZoomSheet> {
  double scale = 1.3;
  double seconds = 1.5;

  @override
  Widget build(BuildContext context) {
    final zooms = widget.c.ir!.zooms;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _Title('Punch-in zoom', subtitle: 'At ${timecode(widget.c.playheadMs)}'),
      Text('Zoom ${scale.toStringAsFixed(1)}x'),
      Slider(value: scale, min: 1.1, max: 2.0, divisions: 9, onChanged: (v) => setState(() => scale = v)),
      Text('Hold ${seconds.toStringAsFixed(1)}s'),
      Slider(value: seconds, min: 0.5, max: 5, divisions: 9, onChanged: (v) => setState(() => seconds = v)),
      FilledButton(
        onPressed: () {
          _close(context);
          widget.onEdit((ir) => TimelineOps.addZoom(ir, startMs: widget.c.playheadMs, durationMs: (seconds * 1000).round(), scale: scale));
        },
        child: Text('Add zoom'),
      ),
      for (final z in zooms)
        ListTile(
          dense: true,
          title: Text('${z.scale.toStringAsFixed(1)}x zoom'),
          subtitle: Text('${timecode(z.startMs)} – ${timecode(z.endMs)}'),
          trailing: IconButton(
            icon: Icon(Icons.delete_outline_rounded),
            onPressed: () {
              _close(context);
              widget.onEdit((ir) => TimelineOps.removeZoom(ir, z.id));
            },
          ),
        ),
    ]);
  }
}

class _BrollSheet extends ConsumerStatefulWidget {
  const _BrollSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  ConsumerState<_BrollSheet> createState() => _BrollSheetState();
}

class _BrollSheetState extends ConsumerState<_BrollSheet> {
  final _query = TextEditingController(text: 'cinematic');
  double seconds = 3;
  bool _searching = false;
  bool _busy = false;
  List<StockVideoResult>? _results;

  static const _ideaChips = ['cinematic', 'nature', 'office', 'city night', 'technology', 'people', 'coffee', 'coding'];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _searchVideos(_query.text);
    });
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _searchVideos(String query) async {
    final q = query.trim();
    if (q.isEmpty) return;
    setState(() => _searching = true);
    try {
      final res = await ref.read(aiDirectorServiceProvider).searchStockVideos(q);
      if (!mounted) return;
      setState(() {
        _results = res;
        _searching = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _searching = false);
      // The provider's real reason (keys, quota, offline) instead of a silent "no clips".
      showError(context, e);
    }
  }

  void _addClip(String url, String label, {String? credit, String? thumbnailUrl, String? previewUrl}) {
    if (credit != null && credit.isNotEmpty) widget.c.mediaCredits[url] = credit;
    _close(context);
    final source = url.startsWith('http')
        ? {'kind': 'url', 'url': url, 'query': label, 'thumbnailUrl': thumbnailUrl ?? previewUrl ?? url, 'previewUrl': previewUrl ?? url}
        : widget.c.localOverlaySource(url, label: label);
    widget.onEdit(
      (ir) => TimelineOps.addBroll(
        ir,
        source,
        startMs: widget.c.playheadMs,
        durationMs: (seconds * 1000).round(),
      ),
      done: 'B-roll added',
    );
  }

  Future<void> _downloadThenSelect(StockVideoResult v) async {
    if (!AssetCache.instance.isCached(v.downloadUrl)) {
      try {
        await AssetCache.instance.ensure(v.downloadUrl, kind: AssetKind.video);
      } catch (e) {
        if (mounted) showError(context, e);
        return;
      }
    }
    if (mounted) _onSelectClip(v);
  }

  void _onSelectClip(StockVideoResult v) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Insert Stock Video', style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              SizedBox(height: 4),
              Text('${v.provider}: ${v.author ?? v.id}', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              SizedBox(height: 16),
              FilledButton.icon(
                icon: Icon(Icons.layers_rounded),
                label: Text('Add as B-roll Cutaway (Overlay)'),
                onPressed: () {
                  Navigator.pop(ctx);
                  _addClip(
                    v.downloadUrl,
                    '${v.provider}: ${v.author ?? v.id}',
                    credit: v.attribution,
                    thumbnailUrl: v.thumbnailUrl,
                    previewUrl: v.previewUrl,
                  );
                },
              ),
              SizedBox(height: 8),
              OutlinedButton.icon(
                icon: Icon(Icons.movie_rounded),
                label: Text('Add to Main Timeline (Video Track)'),
                onPressed: () async {
                  // Captured before the sheets close, so a failure can still be shown.
                  final messenger = ScaffoldMessenger.of(context);
                  Navigator.pop(ctx);
                  _close(context);
                  try {
                    // Already downloaded: the main track uses the phone's copy (no second download at export).
                    await widget.c.addVideoClip(AssetCache.instance.cachedPath(v.downloadUrl) ?? v.downloadUrl, label: '${v.provider}: ${v.author ?? v.id}');
                  } catch (e) {
                    messenger.showSnackBar(SnackBar(content: Text('This video could not be added: ${errorText(e)}'), backgroundColor: AppTheme.error));
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _fromGallery() async {
    setState(() => _busy = true);
    final XFile? file;
    try {
      file = await ImagePicker().pickVideo(source: ImageSource.gallery);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (file == null || !mounted) return;
    final f = file;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Add Selected Video', style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              SizedBox(height: 4),
              Text(f.name, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              SizedBox(height: 16),
              FilledButton.icon(
                icon: Icon(Icons.layers_rounded),
                label: Text('Add as B-roll Cutaway (Overlay)'),
                onPressed: () {
                  Navigator.pop(ctx);
                  _addClip(f.path, f.name, thumbnailUrl: f.path, previewUrl: f.path);
                },
              ),
              SizedBox(height: 8),
              OutlinedButton.icon(
                icon: Icon(Icons.movie_rounded),
                label: Text('Add to Main Timeline'),
                onPressed: () async {
                  // Captured before the sheets close, so a failure can still be shown.
                  final messenger = ScaffoldMessenger.of(context);
                  Navigator.pop(ctx);
                  _close(context);
                  try {
                    await widget.c.addVideoClip(f.path, label: f.name);
                  } catch (e) {
                    messenger.showSnackBar(SnackBar(content: Text('This video could not be added: ${errorText(e)}'), backgroundColor: AppTheme.error));
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final overlays = widget.c.ir!.overlays;
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.78,
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _Title('B-roll Cutaways & Clips', subtitle: 'Overlay from ${timecode(widget.c.playheadMs)} or add to main timeline.'),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _query,
                onSubmitted: _searchVideos,
                decoration: fieldDecoration('Search stock video', hint: 'e.g. nature, cinematic, city…'),
              ),
            ),
            SizedBox(width: 8),
            FilledButton.icon(
              onPressed: _searching || _busy ? null : () => _searchVideos(_query.text),
              icon: Icon(Icons.search_rounded, size: 18),
              label: Text('Find'),
            ),
          ]),
          SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final tag in _ideaChips)
                  Padding(
                    padding: EdgeInsets.only(right: 6),
                    child: ActionChip(
                      label: Text(tag, style: TextStyle(fontSize: 12)),
                      backgroundColor: _query.text.trim().toLowerCase() == tag ? AppTheme.primary.withValues(alpha: 0.3) : AppTheme.surfaceElevated,
                      side: BorderSide(
                        color: _query.text.trim().toLowerCase() == tag ? AppTheme.primary : AppTheme.border,
                      ),
                      onPressed: () {
                        _query.text = tag;
                        _searchVideos(tag);
                      },
                    ),
                  ),
              ],
            ),
          ),
          if (_searching)
            SizedBox(height: 160, child: UniversalSkeleton(type: SkeletonType.projects)),
          if (_results != null && !_searching) ...[
            SizedBox(height: 12),
            Text(
              'Found ${_results!.length} clips (Pexels & Pixabay):',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
            ),
            SizedBox(height: 8),
            if (_results!.isEmpty)
              Container(
                padding: EdgeInsets.all(16),
                decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(12)),
                child: Text('No video clips found. Try another query like "city" or "drone".', style: TextStyle(color: AppTheme.textMuted)),
              )
            else
              SizedBox(
                height: math.min(320.0, ((_results!.length.clamp(0, 15) + 2) ~/ 3) * 155.0),
                child: GridView.builder(
                  physics: ClampingScrollPhysics(),
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                    childAspectRatio: 0.72,
                  ),
                  itemCount: _results!.length.clamp(0, 15),
                  itemBuilder: (ctx, i) {
                    final v = _results![i];
                    return InkWell(
                      borderRadius: BorderRadius.circular(10),
                      // Download first (progress on the tile), then choose where it goes.
                      onTap: () => _downloadThenSelect(v),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            if (v.thumbnailUrl != null)
                              Image.network(
                                v.thumbnailUrl!, cacheWidth: 360,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => Container(color: AppTheme.surfaceElevated, child: Icon(Icons.videocam_rounded, color: AppTheme.textMuted)),
                              )
                            else
                              Container(color: AppTheme.surfaceElevated, child: Icon(Icons.videocam_rounded, color: AppTheme.textMuted)),
                            // Gradient shadow
                            Positioned(
                              left: 0,
                              right: 0,
                              bottom: 0,
                              height: 48,
                              child: Container(
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    begin: Alignment.topCenter,
                                    end: Alignment.bottomCenter,
                                    colors: [Colors.transparent, Colors.black87],
                                  ),
                                ),
                              ),
                            ),
                            // Provider badge
                            Positioned(
                              top: 4,
                              left: 4,
                              child: Container(
                                padding: EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                                decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(4)),
                                child: Text(v.provider.toUpperCase(), style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: Colors.white)),
                              ),
                            ),
                            // Download state: cloud = not on the phone yet, ring = downloading, tick = ready.
                            Positioned(top: 4, right: 4, child: AssetDownloadBadge(url: v.downloadUrl)),
                            // Duration
                            if (v.durationSec != null)
                              Positioned(
                                bottom: 4,
                                right: 4,
                                child: Container(
                                  padding: EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                                  decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(4)),
                                  child: Text('${v.durationSec!.round()}s', style: TextStyle(fontSize: 9, color: Colors.white)),
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
          ],
          SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _busy || _searching ? null : _fromGallery,
            icon: Icon(Icons.video_library_rounded),
            label: Text('From my gallery / device'),
          ),
          if (_busy) Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
          SizedBox(height: 12),
          Text('Cutaway length: ${seconds.toStringAsFixed(1)}s'),
          Slider(value: seconds, min: 1, max: 10, divisions: 18, onChanged: (v) => setState(() => seconds = v)),
          if (overlays.isNotEmpty) ...[
            SizedBox(height: 8),
            Text('Active Overlays on Timeline', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.textSecondary)),
            for (final o in overlays)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Icon(o.isImage ? Icons.photo_rounded : Icons.layers_rounded, color: AppTheme.accentBlue),
                title: Text('${o.source['query'] ?? o.source['kind']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('${timecode(o.timelineStartMs)} – ${timecode(o.timelineEndMs)}'),
                trailing: IconButton(
                  icon: Icon(Icons.delete_outline_rounded, color: AppTheme.error),
                  onPressed: () {
                    _close(context);
                    widget.onEdit((ir) => TimelineOps.removeOverlay(ir, o.id));
                  },
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _TransitionSheet extends StatelessWidget {
  const _TransitionSheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  Widget build(BuildContext context) {
    final n = c.ir!.clips.length;
    final current = {for (final clip in c.ir!.clips.skip(1)) clip.transitionIn?.type ?? 'CUT'};
    final unknown = current.where((t) => !EditIrTransition.types.containsKey(t)).toList();
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (unknown.isNotEmpty)
        Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text(
            'This edit uses ${unknown.join(', ')}, which this phone renders as a crossfade. Pick one below to replace it.',
            style: TextStyle(color: AppTheme.warning, fontSize: 12),
          ),
        ),
      _Title('Transitions', subtitle: n < 2 ? 'Split the video first: transitions go between clips.' : 'Applied at every cut.'),
      for (final (label, t) in [
        ('Hard cut', null),
        ('Crossfade', EditIrTransition(type: 'CROSSFADE', durationMs: 300)),
        ('Dissolve', EditIrTransition(type: 'DISSOLVE', durationMs: 500)),
        ('Fade through black', EditIrTransition(type: 'DIP_BLACK', durationMs: 500)),
        ('Fade through white', EditIrTransition(type: 'DIP_WHITE', durationMs: 400)),
        ('Zoom swoosh', EditIrTransition(type: 'ZOOM_SWOOSH', durationMs: 400)),
        ('Zoom out', EditIrTransition(type: 'ZOOM_OUT', durationMs: 500)),
        ('Glitch', EditIrTransition(type: 'GLITCH', durationMs: 300)),
      ])
        ListTile(
          enabled: n > 1,
          title: Text(label),
          trailing: current.contains(t?.type ?? 'CUT') ? Icon(Icons.check_rounded, color: AppTheme.primary) : null,
          onTap: () {
            _close(context);
            onEdit((ir) => TimelineOps.setTransition(ir, t));
          },
        ),
    ]);
  }
}

/// A caption preset rendered as a live sample in its own font, colours, stroke, glow and pill.
class CaptionPresetCard extends StatelessWidget {
  const CaptionPresetCard({super.key, required this.name, required this.style, required this.selected, required this.onTap});
  final String name;
  final Map<String, dynamic> style;
  final bool selected;
  final VoidCallback onTap;

  static Color _hex(Object? v, Color d) {
    if (v is! String) return d;
    final h = v.replaceFirst('#', '');
    if (h.length != 6 && h.length != 8) return d;
    final n = int.tryParse(h.length == 6 ? 'FF$h' : h.substring(6) + h.substring(0, 6), radix: 16);
    return n == null ? d : Color(n);
  }

  @override
  Widget build(BuildContext context) {
    final text = _hex(style['textColor'], Colors.white);
    final hi = _hex(style['highlightColor'], Color(0xFFFFE600));
    final bg = style['background'] is Map ? _hex((style['background'] as Map)['color'], Colors.black54) : null;
    final stroke = (style['strokeWidthPx'] as num? ?? 0) > 0;
    final shadows = [
      if (style['glow'] == true) Shadow(blurRadius: 10, color: hi),
      if (style['shadow'] == true || stroke) Shadow(blurRadius: stroke ? 1.5 : 4, color: _hex(style['strokeColor'], Colors.black)),
    ];
    String up(String s) => style['uppercase'] == true ? s.toUpperCase() : s;
    return Semantics(
      button: true,
      selected: selected,
      label: 'Caption style $name',
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 112,
          margin: EdgeInsets.only(right: 8),
          padding: EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: AppTheme.background,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: selected ? AppTheme.primary : AppTheme.border, width: selected ? 2 : 1),
          ),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Expanded(
              child: Center(
                child: Container(
                  padding: bg == null ? null : EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: bg == null ? null : BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
                  child: FittedBox(
                    child: Text.rich(
                      TextSpan(children: [
                        TextSpan(text: '${up('Go')} '),
                        TextSpan(text: up('viral'), style: TextStyle(color: hi)),
                      ]),
                      style: CaptionFonts.textStyle(style, fontSize: 18, color: text, shadows: shadows),
                    ),
                  ),
                ),
              ),
            ),
            Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.labelSmall),
          ]),
        ),
      ),
    );
  }
}

// ── Library: browse music, sound effects, stock video and text templates ─────

class _LibrarySheet extends StatelessWidget {
  const _LibrarySheet({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 7,
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.8,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(icon: Icon(Icons.cloud_upload_rounded), text: 'Uploads'),
                Tab(icon: Icon(Icons.movie_rounded), text: 'Video'),
                Tab(icon: Icon(Icons.photo_rounded), text: 'Photos'),
                Tab(icon: Icon(Icons.music_note_rounded), text: 'Music'),
                Tab(icon: Icon(Icons.graphic_eq_rounded), text: 'Sound FX'),
                Tab(icon: Icon(Icons.title_rounded), text: 'Text'),
                Tab(icon: Icon(Icons.auto_fix_high_rounded), text: 'Effects'),
              ],
            ),
            SizedBox(height: 12),
            Expanded(
              child: TabBarView(children: [
                _UploadsTab(c: c, onEdit: onEdit),
                _BrollSheet(c: c, onEdit: onEdit),
                _PhotosTab(c: c, onEdit: onEdit),
                _MusicSheet(c: c, onEdit: onEdit),
                _SfxTab(c: c, onEdit: onEdit),
                _TextTemplatesTab(c: c, onEdit: onEdit),
                _EffectsTab(c: c, onEdit: onEdit),
              ]),
            ),
          ]),
        ),
      );
}

class _UploadsTab extends ConsumerStatefulWidget {
  const _UploadsTab({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  ConsumerState<_UploadsTab> createState() => _UploadsTabState();
}

class _UploadsTabState extends ConsumerState<_UploadsTab> {
  Future<void> _uploadVideo() async {
    final f = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (f == null || !mounted) return;
    _chooseVideoPlacement(f.path, f.name);
  }

  void _chooseVideoPlacement(String path, String name) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Insert Video Clip', style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              SizedBox(height: 4),
              Text(name, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              SizedBox(height: 16),
              FilledButton.icon(
                icon: Icon(Icons.movie_rounded),
                label: Text('Add to Main Video Timeline'),
                onPressed: () async {
                  // Captured before the sheets close, so a failure can still be shown.
                  final messenger = ScaffoldMessenger.of(context);
                  Navigator.pop(ctx);
                  _close(context);
                  try {
                    await widget.c.addVideoClip(path, label: name);
                  } catch (e) {
                    messenger.showSnackBar(SnackBar(content: Text('This video could not be added: ${errorText(e)}'), backgroundColor: AppTheme.error));
                  }
                },
              ),
              SizedBox(height: 8),
              OutlinedButton.icon(
                icon: Icon(Icons.layers_rounded),
                label: Text('Add as B-roll Cutaway (Overlay)'),
                onPressed: () {
                  Navigator.pop(ctx);
                  _close(context);
                  final source = widget.c.localOverlaySource(path, label: name);
                  widget.onEdit(
                    (ir) => TimelineOps.addBroll(
                      ir,
                      source,
                      startMs: widget.c.playheadMs,
                      durationMs: 3000,
                    ),
                    done: 'B-roll added',
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _uploadPhoto() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2160, maxHeight: 2160);
    if (f == null || !mounted) return;
    _close(context);
    final source = widget.c.localOverlaySource(f.path, label: f.name);
    widget.onEdit(
      (ir) => TimelineOps.addBroll(
        ir,
        source,
        startMs: widget.c.playheadMs,
        durationMs: 3000,
        image: true,
      ),
      done: 'Photo overlay added',
    );
  }

  Future<void> _uploadAudio() async {
    final files = await FilePicker.pickFiles(type: FileType.audio);
    final file = files.firstOrNull;
    final path = file?.path;
    if (file == null || path == null || !mounted) return;
    _chooseAudioPlacement(path, file.name);
  }

  void _chooseAudioPlacement(String path, String name) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Insert Audio File', style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              SizedBox(height: 4),
              Text(name, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              SizedBox(height: 16),
              FilledButton.icon(
                icon: Icon(Icons.music_note_rounded),
                label: Text('Set as Background Music Track'),
                onPressed: () {
                  Navigator.pop(ctx);
                  _close(context);
                  widget.onEdit(
                    (ir) => TimelineOps.setMusic(ir, url: path, title: name),
                    done: 'Background music updated',
                  );
                },
              ),
              SizedBox(height: 8),
              OutlinedButton.icon(
                icon: Icon(Icons.graphic_eq_rounded),
                label: Text('Insert as Sound Effect (SFX)'),
                onPressed: () {
                  Navigator.pop(ctx);
                  _close(context);
                  widget.onEdit(
                    (ir) => TimelineOps.addSfx(ir, credit: name, url: path, startMs: widget.c.playheadMs, durationMs: 2000),
                    done: 'Sound effect added',
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.zero,
      children: [
        _Title('Upload & Import Assets', subtitle: 'Import media from your device storage into this video.'),
        ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: AppTheme.border)),
          leading: Container(
            padding: EdgeInsets.all(8),
            decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
            child: Icon(Icons.video_call_rounded, color: AppTheme.primary),
          ),
          title: Text('Import Video Clip', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text('Add to timeline or overlay as B-roll cutaway'),
          trailing: Icon(Icons.chevron_right_rounded),
          onTap: _uploadVideo,
        ),
        SizedBox(height: 10),
        ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: AppTheme.border)),
          leading: Container(
            padding: EdgeInsets.all(8),
            decoration: BoxDecoration(color: AppTheme.accentBlue.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
            child: Icon(Icons.add_photo_alternate_rounded, color: AppTheme.accentBlue),
          ),
          title: Text('Import Photo', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text('Add full-screen or Picture-in-Picture photo overlay'),
          trailing: Icon(Icons.chevron_right_rounded),
          onTap: _uploadPhoto,
        ),
        SizedBox(height: 10),
        ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: AppTheme.border)),
          leading: Container(
            padding: EdgeInsets.all(8),
            decoration: BoxDecoration(color: AppTheme.success.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
            child: Icon(Icons.audio_file_rounded, color: AppTheme.success),
          ),
          title: Text('Import Audio Track', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text('Add custom music soundtrack or sound effect'),
          trailing: Icon(Icons.chevron_right_rounded),
          onTap: _uploadAudio,
        ),
      ],
    );
  }
}

class _SfxTab extends ConsumerStatefulWidget {
  const _SfxTab({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  ConsumerState<_SfxTab> createState() => _SfxTabState();
}

class _SfxTabState extends ConsumerState<_SfxTab> {
  static const suggestions = ['whoosh', 'pop', 'click', 'swoosh', 'ding', 'bass drop', 'camera shutter', 'notification'];
  final _q = TextEditingController();
  List<StockAudioResult>? _results;
  Object? _error;
  bool _searching = false;
  String? _previewing;
  VideoPlayerController? _player;

  @override
  void dispose() {
    _q.dispose();
    _player?.dispose();
    super.dispose();
  }

  Future<void> _search([String? query]) async {
    final q = (query ?? _q.text).trim();
    if (q.isEmpty) return;
    _q.text = q;
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final res = await ref.read(aiDirectorServiceProvider).searchStockAudio(q, type: 'sfx');
      if (mounted) setState(() => _results = res.where((r) => r.kind != 'music').toList());
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _preview(StockAudioResult r) async {
    final same = _previewing == r.url;
    await _player?.dispose();
    _player = null;
    if (same) return setState(() => _previewing = null);
    final p = VideoPlayerController.networkUrl(Uri.parse(r.url));
    _player = p;
    setState(() => _previewing = r.url);
    try {
      await p.initialize();
      if (mounted && _player == p) await p.play();
    } catch (_) {
      if (mounted) {
        setState(() => _previewing = null);
        showError(context, 'This sound could not be played. Try another one.');
      }
    }
  }

  Future<void> _add(StockAudioResult r) async {
    try {
      await AssetCache.instance.ensure(r.url, kind: AssetKind.audio);
    } catch (e) {
      if (mounted) showError(context, e);
      return;
    }
    if (!mounted) return;
    if (r.attribution != null && r.attribution!.isNotEmpty) widget.c.mediaCredits[r.url] = r.attribution!;
    final ms = r.durationSec == null ? null : (r.durationSec! * 1000).round();
    _close(context);
    widget.onEdit(
      (ir) => TimelineOps.addSfx(ir, url: r.url, startMs: widget.c.playheadMs, durationMs: ms, credit: r.attribution),
      done: 'Sound effect added at ${timecode(widget.c.playheadMs)}',
    );
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    return ListView(children: [
      _Title('Sound effects', subtitle: 'Added at the playhead (${timecode(widget.c.playheadMs)}).'),
      TextField(
        controller: _q,
        textInputAction: TextInputAction.search,
        onSubmitted: (_) => _search(),
        decoration: fieldDecoration('Search sounds', hint: 'whoosh, pop, applause…').copyWith(
          suffixIcon: IconButton(tooltip: 'Search', icon: Icon(Icons.search_rounded), onPressed: _search),
        ),
      ),
      SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 4, children: [
        for (final sgg in suggestions) ActionChip(label: Text(sgg), onPressed: () => _search(sgg)),
      ]),
      SizedBox(height: 12),
      if (_searching) SizedBox(height: 160, child: UniversalSkeleton(type: SkeletonType.activity)),
      if (_error != null && !_searching) ErrorView(error: _error!, compact: true, onRetry: _search),
      if (!_searching && _error == null && results != null && results.isEmpty)
        EmptyView(
          icon: Icons.graphic_eq_rounded,
          title: 'No sounds found',
          message: 'Try a simpler word like "whoosh" or "click".',
          actionLabel: 'Search "whoosh"',
          onAction: () => _search('whoosh'),
        ),
      if (!_searching && results != null)
        for (final r in results)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: IconButton(
              tooltip: _previewing == r.url ? 'Stop' : 'Preview',
              icon: Icon(_previewing == r.url ? Icons.stop_rounded : Icons.play_arrow_rounded),
              onPressed: () => _preview(r),
            ),
            title: Text(r.title, maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text(
              [if (r.durationSec != null) '${r.durationSec!.toStringAsFixed(1)} s', r.provider].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              AssetDownloadBadge(url: r.url),
              TextButton(onPressed: () => _add(r), child: Text('Add')),
            ]),
          ),
    ]);
  }
}

class _TextTemplatesTab extends ConsumerStatefulWidget {
  const _TextTemplatesTab({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  ConsumerState<_TextTemplatesTab> createState() => _TextTemplatesTabState();
}

class _TextTemplatesTabState extends ConsumerState<_TextTemplatesTab> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  BrandLook _brand() {
    final pid = widget.c.projectId;
    if (pid == null) return BrandLook.none;
    final v = ref.watch(brandVoiceProvider(pid)).valueOrNull;
    if (v == null) return BrandLook.none;
    return BrandLook(font: v.font, primaryColor: v.primaryColor, accentColor: v.accentColor);
  }

  void _add(TextTemplate t, BrandLook brand) {
    final words = _text.text.trim().isEmpty ? t.sample : _text.text.trim();
    _close(context);
    widget.onEdit(
      (ir) => TimelineOps.addText(
        ir,
        words,
        startMs: widget.c.playheadMs,
        durationMs: t.defaultSeconds * 1000,
        positionY: t.positionY,
        style: t.style(brand),
      ),
      done: '${t.name} added. Tap it on the timeline to edit.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final brand = _brand();
    return ListView(children: [
      _Title('Text templates', subtitle: brand.font == null ? 'Tap a style to add it at the playhead.' : 'Using your brand font ${brand.font}.'),
      TextField(controller: _text, decoration: fieldDecoration('Your text', hint: 'Leave empty to use the sample')),
      SizedBox(height: 12),
      GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 1.6,
        children: [
          for (final t in TextTemplate.all)
            Semantics(
              button: true,
              label: 'Add ${t.name} text',
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => _add(t, brand),
                child: Ink(
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceElevated,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppTheme.border),
                  ),
                  padding: EdgeInsets.all(10),
                  child: Column(mainAxisAlignment: MainAxisAlignment.spaceBetween, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Expanded(child: Center(child: _TemplateSample(template: t, brand: brand))),
                    Text(t.name, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                  ]),
                ),
              ),
            ),
        ],
      ),
    ]);
  }
}

/// Small approximation of a template (the export uses the full style).
class _TemplateSample extends StatelessWidget {
  const _TemplateSample({required this.template, required this.brand});
  final TextTemplate template;
  final BrandLook brand;

  static Color _hex(Object? v, Color d) {
    if (v is! String) return d;
    final h = v.replaceFirst('#', '');
    if (h.length != 6 && h.length != 8) return d;
    final n = int.tryParse(h.length == 6 ? 'FF$h' : h.substring(6) + h.substring(0, 6), radix: 16);
    return n == null ? d : Color(n);
  }

  @override
  Widget build(BuildContext context) {
    final st = template.style(brand);
    final bg = st['background'] is Map ? _hex((st['background'] as Map)['color'], Colors.black) : null;
    final text = st['uppercase'] == true ? template.sample.toUpperCase() : template.sample;
    return Container(
      padding: bg == null ? EdgeInsets.zero : EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: bg == null ? null : BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: ((st['fontSizePx'] as num?) ?? 64).toDouble().clamp(40, 180) / 5,
          fontWeight: FontWeight.values[(((st['fontWeight'] as num?) ?? 700).toInt() ~/ 100 - 1).clamp(0, 8)],
          color: _hex(st['textColor'], Colors.white),
          shadows: st['shadow'] == true ? [Shadow(blurRadius: 3)] : null,
        ),
      ),
    );
  }
}

class _PhotosTab extends ConsumerStatefulWidget {
  const _PhotosTab({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  ConsumerState<_PhotosTab> createState() => _PhotosTabState();
}

class _PhotosTabState extends ConsumerState<_PhotosTab> {
  final _q = TextEditingController();
  List<StockPhotoResult>? _results;
  Object? _error;
  bool _busy = false;
  double _seconds = 3;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final q = _q.text.trim();
    if (q.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await ref.read(aiDirectorServiceProvider).searchStockPhotos(q, orientation: widget.c.ir!.canvas.width < widget.c.ir!.canvas.height ? 'portrait' : 'landscape');
      if (mounted) setState(() => _results = res);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add(String url, String label, String? credit) async {
    try {
      await AssetCache.instance.ensure(url, kind: AssetKind.image);
    } catch (e) {
      if (mounted) showError(context, e);
      return;
    }
    if (!mounted) return;
    if (credit != null && credit.isNotEmpty) widget.c.mediaCredits[url] = credit;
    _close(context);
    widget.onEdit(
      (ir) => TimelineOps.addBroll(ir, {'kind': 'url', 'url': url, 'query': label},
          startMs: widget.c.playheadMs, durationMs: (_seconds * 1000).round(), image: true),
      done: 'Photo added. Tap it on the timeline to adjust.',
    );
  }

  Future<void> _fromGallery() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2160, maxHeight: 2160);
    if (f == null || !mounted) return;
    setState(() => _busy = true);
    final bytes = await f.readAsBytes();
    if (!mounted) return;
    final url = await guarded(
      context,
      () => ref.read(socialApiProvider).uploadFile(f.path, fileBytes: bytes, filename: f.name),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (url != null) _add(url, 'my photo', null);
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    return ListView(children: [
      _Title('Photos', subtitle: 'Shown full-screen at the playhead (${timecode(widget.c.playheadMs)}).'),
      Row(children: [
        Expanded(
          child: TextField(
            controller: _q,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _search(),
            decoration: fieldDecoration('Search free photos', hint: 'coffee beans, city at night…').copyWith(
              suffixIcon: IconButton(tooltip: 'Search', icon: Icon(Icons.search_rounded), onPressed: _search),
            ),
          ),
        ),
        SizedBox(width: 8),
        IconButton.filledTonal(tooltip: 'From my gallery', onPressed: _busy ? null : _fromGallery, icon: Icon(Icons.add_photo_alternate_rounded)),
      ]),
      Row(children: [
        Text('Show for ${_seconds.toStringAsFixed(1)} s', style: Theme.of(context).textTheme.bodySmall),
        Expanded(child: Slider(value: _seconds, min: 1, max: 8, divisions: 14, onChanged: (v) => setState(() => _seconds = v))),
      ]),
      if (_busy) SizedBox(height: 200, child: UniversalSkeleton(type: SkeletonType.projects)),
      if (_error != null && !_busy) ErrorView(error: _error!, compact: true, onRetry: _search),
      if (!_busy && _error == null && results != null && results.isEmpty)
        EmptyView(
          icon: Icons.photo_rounded,
          title: 'No photos found',
          message: 'Try another word, or add one from your gallery.',
          actionLabel: 'From my gallery',
          onAction: _fromGallery,
        ),
      if (!_busy && results != null && results.isNotEmpty)
        GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          physics: NeverScrollableScrollPhysics(),
          mainAxisSpacing: 6,
          crossAxisSpacing: 6,
          childAspectRatio: 0.75,
          children: [
            for (final p in results)
              Semantics(
                button: true,
                label: 'Add photo ${p.title}',
                child: InkWell(
                  onTap: () => _add(p.url, p.title, p.attribution),
                  borderRadius: BorderRadius.circular(8),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Stack(fit: StackFit.expand, children: [
                      Image.network(
                        p.thumbnailUrl, cacheWidth: 360,
                        fit: BoxFit.cover,
                        loadingBuilder: (_, child, prog) => prog == null ? child : Container(color: AppTheme.surfaceElevated),
                        errorBuilder: (_, _, _) => Container(color: AppTheme.surfaceElevated, child: Icon(Icons.broken_image_rounded)),
                      ),
                      Positioned(top: 4, right: 4, child: AssetDownloadBadge(url: p.url)),
                    ]),
                  ),
                ),
              ),
          ],
        ),
    ]);
  }
}

class _EffectsTab extends StatefulWidget {
  const _EffectsTab({required this.c, required this.onEdit});
  final StudioController c;
  final EditFn onEdit;

  @override
  State<_EffectsTab> createState() => _EffectsTabState();
}

class _EffectsTabState extends State<_EffectsTab> {
  double _intensity = 0.6;

  static const _icons = {
    'flash': Icons.flash_on_rounded,
    'fade_black': Icons.brightness_3_rounded,
    'shake': Icons.vibration_rounded,
    'zoom_pulse': Icons.center_focus_strong_rounded,
    'black_white': Icons.filter_b_and_w_rounded,
    'vignette': Icons.vignette_rounded,
  };

  @override
  Widget build(BuildContext context) => ListView(children: [
        _Title('Effects', subtitle: 'Added at the playhead (${timecode(widget.c.playheadMs)}). Tap it on the timeline to change timing.'),
        Row(children: [
          Text('Strength ${(_intensity * 100).round()}%', style: Theme.of(context).textTheme.bodySmall),
          Expanded(child: Slider(value: _intensity, min: 0.1, max: 1, divisions: 9, onChanged: (v) => setState(() => _intensity = v))),
        ]),
        for (final e in EditIrEffect.types.entries)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(_icons[e.key] ?? Icons.auto_fix_high_rounded, color: AppTheme.primary),
            title: Text(e.value.$1),
            subtitle: Text('${e.value.$2} · ${(e.value.$3 / 1000).toStringAsFixed(1)} s'),
            trailing: TextButton(
              onPressed: () {
                _close(context);
                widget.onEdit(
                  (ir) => TimelineOps.addEffect(ir, e.key, startMs: widget.c.playheadMs, intensity: _intensity),
                  done: '${e.value.$1} added',
                );
              },
              child: Text('Add'),
            ),
          ),
      ]);
}

/// Small badge on an online asset tile: cloud (not downloaded), progress ring (downloading), tick (on the phone).
class AssetDownloadBadge extends StatelessWidget {
  const AssetDownloadBadge({super.key, required this.url});
  final String url;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Map<String, double>>(
        valueListenable: AssetCache.instance.progress,
        builder: (context, progress, _) {
          final p = progress[url];
          final cached = p == null && AssetCache.instance.isCached(url);
          return Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.7), shape: BoxShape.circle),
            padding: EdgeInsets.all(5),
            child: p != null
                ? CircularProgressIndicator(strokeWidth: 2.5, value: p < 0 ? null : p, color: Colors.white)
                : Icon(cached ? Icons.check_rounded : Icons.download_rounded, size: 16, color: cached ? AppTheme.success : Colors.white),
          );
        },
      );
}

