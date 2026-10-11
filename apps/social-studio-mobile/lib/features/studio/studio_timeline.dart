import 'dart:io' as io;
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/native_engine/edit_ir.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import 'studio_controller.dart';
import 'studio_session_screen.dart' show timecode;
import 'studio_tools.dart';
import 'text_templates.dart';
import 'timeline_ops.dart';
import 'video_thumbnails.dart';

/// Multi-track timeline: one row per track (video, B-roll, text, captions, zoom, music, SFX) with every
/// placed item — including everything the AI Director added — as a tappable block. Tap an item to edit it.
class StudioTimeline extends StatefulWidget {
  const StudioTimeline({
    super.key,
    required this.controller,
    required this.onScrub,
    required this.onEdit,
    required this.onOpenTool,
  });

  final StudioController controller;
  final ValueChanged<int> onScrub;
  final EditFn onEdit;
  final ValueChanged<StudioTool> onOpenTool;

  @override
  State<StudioTimeline> createState() => _StudioTimelineState();
}

class _StudioTimelineState extends State<StudioTimeline> {
  static const _labelW = 40.0;
  static const _videoH = 44.0;
  static const _trackH = 30.0;

  /// Transparent hit padding around each trim handle (the visible grip is 6 px).
  static const _handleHit = 22.0;

  /// 1 = whole video fits the width; up to 8x for fine edits.
  double _zoom = 1;
  double _zoomStart = 1;

  /// Non-video item whose trim handles are shown (set by tapping it).
  String? _selectedId;

  /// Live preview while an item is being dragged or trimmed; committed as one edit on release.
  _Drag? _drag;

  /// Volumes captured before muting a track, so unmuting restores them.
  final _restoreDb = <TrackKind, Map<String, double>>{};

  static final _colors = {
    TrackKind.video: AppTheme.accentBlue,
    TrackKind.broll: AppTheme.accent,
    TrackKind.text: AppTheme.primary,
    TrackKind.captions: AppTheme.accentBlue,
    TrackKind.zoom: AppTheme.warning,
    TrackKind.effect: AppTheme.accent,
    TrackKind.voice: AppTheme.accentBlue,
    TrackKind.voiceover: AppTheme.warning,
    TrackKind.music: AppTheme.success,
    TrackKind.sfx: AppTheme.accentBlue,
  };

  static const _icons = {
    TrackKind.video: Icons.movie_rounded,
    TrackKind.broll: Icons.layers_rounded,
    TrackKind.text: Icons.title_rounded,
    TrackKind.captions: Icons.closed_caption_rounded,
    TrackKind.zoom: Icons.zoom_in_rounded,
    TrackKind.effect: Icons.auto_fix_high_rounded,
    TrackKind.voice: Icons.record_voice_over_rounded,
    TrackKind.voiceover: Icons.mic_rounded,
    TrackKind.music: Icons.music_note_rounded,
    TrackKind.sfx: Icons.graphic_eq_rounded,
  };

  static bool _movable(TrackKind k) => k != TrackKind.video && k != TrackKind.music && k != TrackKind.voice;
  static bool _trimmable(TrackKind k) => k != TrackKind.video && k != TrackKind.voice;

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final ir = c.ir!;
    // Main-track clips show a frame of their own file (the original video or a clip added later).
    final items = [
      for (final i in TimelineOps.items(ir))
        if (i.kind == TrackKind.video && i.mediaUrl == null)
          () {
            final clip = ir.clips.where((x) => x.id == i.id).firstOrNull;
            final path = clip == null ? null : c.pathForAsset(clip.assetId);
            return path == null
                ? i
                : TimelineItem(i.kind, i.id, i.startMs, i.endMs, i.label,
                    mediaUrl: path, thumbnailUrl: i.thumbnailUrl, isImage: i.isImage || c.isStillAsset(clip!.assetId));
          }()
        else
          i,
    ];
    final tracks = [
      for (final k in TrackKind.values)
        if (k == TrackKind.video ||
            items.any((i) => i.kind == k) ||
            (k == TrackKind.voice && TimelineOps.isTrackMuted(ir, k)))
          k,
    ];
    final total = math.max(1, ir.durationMs).toDouble();
    if (_selectedId != null && !items.any((i) => i.id == _selectedId)) _selectedId = null;

    return Container(
      color: AppTheme.surfaceElevated,
      padding: EdgeInsets.fromLTRB(8, 6, 8, 4),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Text('${timecode(c.playheadMs)} / ${timecode(ir.durationMs)}',
              style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
          Spacer(),
          IconButton(
            tooltip: 'Zoom out timeline',
            visualDensity: VisualDensity.compact,
            onPressed: _zoom <= 1 ? null : () => setState(() => _zoom = math.max(1, _zoom / 2)),
            icon: Icon(Icons.zoom_out_rounded, size: 20),
          ),
          IconButton(
            tooltip: 'Zoom in timeline',
            visualDensity: VisualDensity.compact,
            onPressed: _zoom >= 8 ? null : () => setState(() => _zoom = math.min(8, _zoom * 2)),
            icon: Icon(Icons.zoom_in_rounded, size: 20),
          ),
        ]),
        ConstrainedBox(
          constraints: BoxConstraints(maxHeight: 190),
          child: SingleChildScrollView(
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Column(children: [
                for (final k in tracks)
                  SizedBox(
                    width: _labelW,
                    height: k == TrackKind.video ? _videoH : _trackH,
                    child: _header(ir, k),
                  ),
              ]),
              Expanded(
                child: LayoutBuilder(builder: (context, box) {
                  const leadW = 32.0;
                  final width = box.maxWidth * _zoom;
                  double x(int ms) => leadW + (ms / total * width);
                  int msPerPx(double dx) => (dx / width * total).round();
                  final drag = _drag;
                  return GestureDetector(
                    onScaleStart: (_) => _zoomStart = _zoom,
                    onScaleUpdate: (d) {
                      if (d.pointerCount > 1) setState(() => _zoom = (_zoomStart * d.scale).clamp(1, 8).toDouble());
                    },
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: SizedBox(
                        width: width + leadW + 36,
                        child: Stack(clipBehavior: Clip.none, children: [
                          Column(children: [
                            for (final k in tracks)
                              SizedBox(
                                height: k == TrackKind.video ? _videoH : _trackH,
                                child: GestureDetector(
                                  behavior: HitTestBehavior.opaque,
                                  onTapDown: (d) {
                                    final localMs = ((d.localPosition.dx - leadW) / width * total).round().clamp(0, total.toInt());
                                    widget.onScrub(localMs);
                                  },
                                  child: Stack(clipBehavior: Clip.none, children: [
                                    if (k == TrackKind.video) ...[
                                      // Prepend '+' button at the very beginning of the video timeline
                                      Positioned(
                                        left: 2,
                                        width: 26,
                                        top: 7,
                                        bottom: 7,
                                        child: _AddClipButton(
                                          tooltip: 'Add video to start (intro)',
                                          onTap: () => _showAddVideoSheet(context, atIndex: 0),
                                        ),
                                      ),
                                    ],
                                    for (final (i, it) in items.where((i) => i.kind == k).indexed)
                                      ..._placed(
                                        it: drag != null && drag.item.id == it.id && drag.item.kind == it.kind
                                            ? drag.preview
                                            : it,
                                        original: it,
                                        index: i,
                                        x: x,
                                        msPerPx: msPerPx,
                                        total: total.toInt(),
                                        muted: TimelineOps.mutableTracks.contains(k) && TimelineOps.isTrackMuted(ir, k),
                                      ),
                                    if (k == TrackKind.video) ...[
                                      // Prepend '+' button at the beginning of the video timeline
                                      Positioned(
                                        left: math.max(0.0, x(0) - 28),
                                        width: 24,
                                        top: 7,
                                        bottom: 7,
                                        child: _AddClipButton(
                                          tooltip: 'Add video to beginning',
                                          onTap: () => _showAddVideoSheet(context, atIndex: 0),
                                        ),
                                      ),
                                      // Append '+' button at the very end of the video timeline
                                      Positioned(
                                        left: x(ir.durationMs) + 4,
                                        width: 26,
                                        top: 7,
                                        bottom: 7,
                                        child: _AddClipButton(
                                          tooltip: 'Add video to end',
                                          onTap: () => _showAddVideoSheet(context, atIndex: ir.clips.length),
                                        ),
                                      ),
                                    ],
                                  ]),
                                ),
                              ),
                          ]),
                          Positioned(
                            left: x(c.playheadMs).clamp(leadW, leadW + width).toDouble(),
                            top: 0,
                            bottom: 0,
                            child: IgnorePointer(child: Container(width: 2, color: AppTheme.textPrimary)),
                          ),
                          if (drag != null)
                            Positioned(
                              left: (x(drag.mode == _DragMode.trimEnd ? drag.preview.endMs : drag.preview.startMs) - 30)
                                  .clamp(0, math.max(0, width + leadW - 60))
                                  .toDouble(),
                              top: 0,
                              child: IgnorePointer(
                                child: Container(
                                  key: Key('timeline-drag-tooltip'),
                                  width: 60,
                                  padding: EdgeInsets.symmetric(vertical: 2),
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    color: AppTheme.surfaceElevated,
                                    borderRadius: BorderRadius.circular(4),
                                    border: Border.all(color: AppTheme.primary),
                                  ),
                                  child: Text(
                                    timecode(drag.mode == _DragMode.trimEnd ? drag.preview.endMs : drag.preview.startMs),
                                    style: TextStyle(fontSize: 10, color: AppTheme.textPrimary),
                                  ),
                                ),
                              ),
                            ),
                        ]),
                      ),
                    ),
                  );
                }),
              ),
            ]),
          ),
        ),
      ]),
    );
  }

  /// Track header: the track icon; for Voice, Music and Sound FX it is also the mute toggle.
  Widget _header(MobileEditIr ir, TrackKind k) {
    if (!TimelineOps.mutableTracks.contains(k)) {
      return Tooltip(message: k.label, child: Icon(_icons[k], size: 16, color: _colors[k]));
    }
    final muted = TimelineOps.isTrackMuted(ir, k);
    return Semantics(
      button: true,
      toggled: muted,
      label: muted ? 'Unmute ${k.label}' : 'Mute ${k.label}',
      excludeSemantics: true,
      child: Tooltip(
        message: k.label,
        child: InkWell(
          onTap: () => _toggleMute(k, muted),
          child: Center(
            child: Icon(
              muted ? Icons.volume_off_rounded : _icons[k],
              size: 16,
              color: muted ? AppTheme.textMuted : _colors[k],
            ),
          ),
        ),
      ),
    );
  }

  void _toggleMute(TrackKind k, bool muted) {
    final ir = widget.controller.ir!;
    if (!muted) _restoreDb[k] = TimelineOps.trackVolumes(ir, k);
    final restore = _restoreDb[k] ?? const <String, double>{};
    widget.onEdit(
      (ir) => TimelineOps.setTrackMuted(ir, k, !muted, restoreDb: restore),
      done: '${k.label} ${muted ? 'unmuted' : 'muted'}',
    );
  }

  Future<void> _showAddVideoSheet(BuildContext context, {int? atIndex}) async {
    final isStart = atIndex == 0;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Icon(Icons.video_library_rounded, color: AppTheme.primary),
                SizedBox(width: 8),
                Text(
                  isStart ? 'Add Video to Beginning' : 'Add Video to End of Timeline',
                  style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                ),
              ]),
              SizedBox(height: 6),
              Text(
                isStart
                    ? 'Prepend an intro or opening clip before your current video.'
                    : 'Append another video clip to continue the timeline sequence.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              SizedBox(height: 16),
              ListTile(
                leading: Container(
                  padding: EdgeInsets.all(8),
                  decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                  child: Icon(Icons.add_photo_alternate_rounded, color: AppTheme.primary),
                ),
                title: Text('Choose from Gallery / Device'),
                subtitle: Text('Pick an MP4 video clip from phone storage'),
                onTap: () async {
                  Navigator.pop(ctx);
                  final f = await ImagePicker().pickVideo(source: ImageSource.gallery);
                  if (f == null) return;
                  try {
                    await widget.controller.addVideoClip(f.path, atIndex: atIndex);
                  } catch (e) {
                    if (context.mounted) showError(context, 'This video could not be added: ${errorText(e)}');
                  }
                },
              ),
              ListTile(
                leading: Container(
                  padding: EdgeInsets.all(8),
                  decoration: BoxDecoration(color: AppTheme.accentBlue.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                  child: Icon(Icons.movie_filter_rounded, color: AppTheme.accentBlue),
                ),
                title: Text('Search Stock Video'),
                subtitle: Text('Search Pexels & Pixabay library'),
                onTap: () {
                  Navigator.pop(ctx);
                  widget.onOpenTool(StudioTool.broll);
                },
              ),
              ListTile(
                leading: Container(
                  padding: EdgeInsets.all(8),
                  decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                  child: Icon(Icons.folder_copy_rounded, color: AppTheme.accent),
                ),
                title: Text('Assets & Library'),
                subtitle: Text('Open the full assets bottom sheet'),
                onTap: () {
                  Navigator.pop(ctx);
                  widget.onOpenTool(StudioTool.library);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The block for [it] plus, when it is the selected item, its two trim handles.
  List<Widget> _placed({
    required TimelineItem it,
    required TimelineItem original,
    required int index,
    required double Function(int) x,
    required int Function(double) msPerPx,
    required int total,
    required bool muted,
  }) {
    final c = widget.controller;
    final k = it.kind;
    final left = x(it.startMs);
    final w = math.max(14.0, x(it.endMs) - x(it.startMs));
    final selected = k == TrackKind.video ? c.selectedClip == index : _selectedId == it.id;
    Widget handle(_DragMode mode) => Positioned(
          left: (mode == _DragMode.trimStart ? left : left + w) - _handleHit,
          width: _handleHit * 2,
          top: 0,
          bottom: 0,
          child: Semantics(
            label: mode == _DragMode.trimStart ? 'Trim start of ${k.label}' : 'Trim end of ${k.label}',
            child: GestureDetector(
              key: Key('trim-${mode == _DragMode.trimStart ? 'start' : 'end'}-${it.id}'),
              behavior: HitTestBehavior.opaque,
              onHorizontalDragStart: (_) => _begin(original, mode),
              onHorizontalDragUpdate: (d) => _update(d.primaryDelta ?? 0, msPerPx, total),
              onHorizontalDragEnd: (_) => _commit(),
              onHorizontalDragCancel: _cancel,
              child: Center(
                child: Container(
                  width: 6,
                  height: 18,
                  decoration: BoxDecoration(color: AppTheme.textPrimary, borderRadius: BorderRadius.circular(3)),
                ),
              ),
            ),
          ),
        );
    return [
      Positioned(
        left: left,
        width: w,
        top: 3,
        bottom: 3,
        child: _Block(
          item: it,
          color: _colors[k]!,
          selected: selected,
          muted: muted,
          onTap: () => _onItem(original, index),
          onLongPressStart: _movable(k) ? () => _begin(original, _DragMode.move) : null,
          onLongPressMove: _movable(k) ? (dx) => _moveTo(dx, msPerPx, total) : null,
          onLongPressEnd: _movable(k) ? _commit : null,
        ),
      ),
      if (selected && _trimmable(k)) ...[handle(_DragMode.trimStart), handle(_DragMode.trimEnd)],
    ];
  }

  void _begin(TimelineItem it, _DragMode mode) {
    HapticFeedback.selectionClick();
    final ir = widget.controller.ir;
    _snapPoints = ir == null ? const [] : TimelineOps.snapPoints(ir, playheadMs: widget.controller.playheadMs, excludeId: it.id);
    _snappedTo = null;
    setState(() => _drag = _Drag(it, mode, it));
  }

  /// Snap targets for the item being dragged, and the last edge it snapped to (for the haptic tick).
  List<int> _snapPoints = const [];
  int? _snappedTo;

  /// Snaps [ms] to a nearby cut / playhead / item edge within ~10 px; ticks once per new snap.
  int? _snap(int ms, int Function(double) msPerPx) {
    final hit = TimelineOps.snapMs(ms, _snapPoints, msPerPx(10).abs());
    if (hit != null && hit != _snappedTo) HapticFeedback.selectionClick();
    _snappedTo = hit;
    return hit;
  }

  /// Long-press move: [dx] is the total offset from where the press started. Either edge can snap.
  void _moveTo(double dx, int Function(double) msPerPx, int total) {
    final d = _drag;
    if (d == null) return;
    final len = d.item.endMs - d.item.startMs;
    var s = (d.item.startMs + msPerPx(dx)).clamp(0, math.max(0, total - len)).toInt();
    final byStart = _snap(s, msPerPx);
    if (byStart != null) {
      s = byStart;
    } else {
      final byEnd = _snap(s + len, msPerPx);
      if (byEnd != null) s = byEnd - len;
    }
    s = s.clamp(0, math.max(0, total - len)).toInt();
    setState(() => _drag = d.withPreview(s, s + len));
  }

  /// Trim: [delta] is the incremental drag in pixels. Keeps at least 300 ms.
  void _update(double delta, int Function(double) msPerPx, int total) {
    final d = _drag;
    if (d == null) return;
    d.accumPx += delta;
    final shift = msPerPx(d.accumPx);
    int edge(int raw) => _snap(raw, msPerPx) ?? raw;
    final p = d.mode == _DragMode.trimStart
        ? d.withPreview(edge(d.item.startMs + shift).clamp(0, d.item.endMs - 300).toInt(), d.item.endMs)
        : d.withPreview(d.item.startMs, edge(d.item.endMs + shift).clamp(d.item.startMs + 300, total).toInt());
    setState(() => _drag = p);
  }

  void _cancel() => setState(() => _drag = null);

  void _commit() {
    final d = _drag;
    setState(() => _drag = null);
    if (d == null) return;
    final it = d.item;
    final p = d.preview;
    if (p.startMs == it.startMs && p.endMs == it.endMs) return;
    if (d.mode == _DragMode.move) {
      widget.onEdit((ir) => TimelineOps.moveItem(ir, it.kind, it.id, p.startMs), done: 'Moved to ${timecode(p.startMs)}');
    } else {
      widget.onEdit((ir) => TimelineOps.setItemRange(ir, it.kind, it.id, p.startMs, p.endMs), done: 'Trimmed ${it.kind.label.toLowerCase()}');
    }
  }

  void _onItem(TimelineItem it, int index) {
    final c = widget.controller;
    if (it.kind == TrackKind.video) {
      c.select(c.selectedClip == index ? null : index);
      widget.onScrub(it.startMs);
      return;
    }
    widget.onScrub(it.startMs);
    if (it.kind == TrackKind.voice) return; // speech follows the clips; the header mutes it
    setState(() => _selectedId = it.id);
    showTimelineItemSheet(context, c, it, onEdit: widget.onEdit, onOpenTool: widget.onOpenTool);
  }
}

enum _DragMode { move, trimStart, trimEnd }

class _Drag {
  _Drag(this.item, this.mode, this.preview);
  final TimelineItem item;
  final _DragMode mode;
  final TimelineItem preview;
  double accumPx = 0;

  _Drag withPreview(int start, int end) =>
      _Drag(item, mode, TimelineItem(
        item.kind,
        item.id,
        start,
        end,
        item.label,
        mediaUrl: item.mediaUrl,
        thumbnailUrl: item.thumbnailUrl,
        isImage: item.isImage,
      ))..accumPx = accumPx;
}

class _Block extends StatelessWidget {
  const _Block({
    required this.item,
    required this.color,
    required this.selected,
    required this.onTap,
    this.muted = false,
    this.onLongPressStart,
    this.onLongPressMove,
    this.onLongPressEnd,
  });
  final TimelineItem item;
  final Color color;
  final bool selected;
  final bool muted;
  final VoidCallback onTap;
  final VoidCallback? onLongPressStart;
  final ValueChanged<double>? onLongPressMove;
  final VoidCallback? onLongPressEnd;

  @override
  Widget build(BuildContext context) {
    final hasVisual = (item.kind == TrackKind.broll || item.kind == TrackKind.video) &&
        (item.thumbnailUrl != null || item.mediaUrl != null);
    final thumb = item.thumbnailUrl ?? item.mediaUrl;

    return Semantics(
      button: true,
      label: '${item.kind.label}: ${item.label}, ${timecode(item.startMs)} to ${timecode(item.endMs)}'
          '${muted ? ', muted' : ''}',
      child: GestureDetector(
        onTap: onTap,
        onLongPressStart: onLongPressStart == null ? null : (_) => onLongPressStart!(),
        onLongPressMoveUpdate: onLongPressMove == null ? null : (d) => onLongPressMove!(d.offsetFromOrigin.dx),
        onLongPressEnd: onLongPressEnd == null ? null : (_) => onLongPressEnd!(),
        child: Opacity(
          opacity: muted ? 0.55 : 1,
          child: Container(
            margin: EdgeInsets.symmetric(horizontal: 0.5),
            decoration: BoxDecoration(
              color: color.withValues(alpha: selected ? 0.7 : 0.35),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(
                color: selected ? Colors.white : color.withValues(alpha: 0.8),
                width: selected ? 2.0 : 1.0,
              ),
              boxShadow: selected
                  ? [BoxShadow(color: color.withValues(alpha: 0.5), blurRadius: 4, spreadRadius: 1)]
                  : null,
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (hasVisual && thumb != null) ...[
                  // Visual Thumbnail Background
                  Positioned.fill(
                    child: VideoThumbnails.isLocalVideo(thumb)
                        ? FutureBuilder<String?>(
                            future: VideoThumbnails.frameFor(thumb),
                            builder: (_, snap) => snap.data == null
                                ? Container(color: color.withValues(alpha: 0.3))
                                : Image.file(io.File(snap.data!), fit: BoxFit.cover, cacheWidth: 240,
                                    errorBuilder: (_, _, _) => Container(color: color.withValues(alpha: 0.3))),
                          )
                        : thumb.startsWith('http')
                        ? Image.network(
                            thumb,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => Container(color: color.withValues(alpha: 0.3)),
                          )
                        : (kIsWeb
                            ? Image.network(
                                thumb, cacheWidth: 240,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => Container(color: color.withValues(alpha: 0.3)),
                              )
                            : Image.file(
                                io.File(thumb),
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => Container(color: color.withValues(alpha: 0.3)),
                              )),
                  ),
                  // Dark gradient overlay for text readability
                  Positioned.fill(
                    child: Container(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.black.withValues(alpha: 0.35),
                            Colors.black.withValues(alpha: 0.75),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
                // Content Label and Badges
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                  child: Row(
                    children: [
                      // Flexible: on very short items the icons shrink instead of overflowing the block.
                      if (item.kind == TrackKind.broll)
                        Flexible(
                          child: Icon(
                            item.isImage ? Icons.image_rounded : Icons.movie_filter_rounded,
                            size: 11,
                            color: selected ? Colors.white : color,
                          ),
                        )
                      else if (item.kind == TrackKind.video)
                        Flexible(child: Icon(Icons.videocam_rounded, size: 11, color: Colors.white)),
                      if (item.kind == TrackKind.broll || item.kind == TrackKind.video)
                        Flexible(child: SizedBox(width: 3)),
                      Expanded(
                        child: Text(
                          item.label,
                          maxLines: 1,
                          overflow: TextOverflow.clip,
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                            shadows: const [Shadow(color: Colors.black, blurRadius: 2)],
                          ),
                        ),
                      ),
                      if (muted)
                        Flexible(
                          child: Padding(
                            padding: EdgeInsets.only(left: 2),
                            child: Container(
                              padding: EdgeInsets.all(1),
                              decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(2)),
                              child: Icon(Icons.volume_off_rounded, size: 9, color: AppTheme.error),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AddClipButton extends StatelessWidget {
  const _AddClipButton({required this.tooltip, required this.onTap});
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Tooltip(
        message: tooltip,
        child: Material(
          color: AppTheme.accentBlue.withValues(alpha: 0.25),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
            side: BorderSide(color: AppTheme.accentBlue, width: 1.5),
          ),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(6),
            child: Center(
              child: Icon(Icons.add_rounded, size: 18, color: Colors.white),
            ),
          ),
        ),
      );
}

/// Inspector for one placed item: move, nudge, trim, volume/style, replace, delete.
Future<void> showTimelineItemSheet(
  BuildContext context,
  StudioController c,
  TimelineItem item, {
  required EditFn onEdit,
  required ValueChanged<StudioTool> onOpenTool,
}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: SafeArea(child: TimelineItemInspector(c: c, item: item, onEdit: onEdit, onOpenTool: onOpenTool)),
      ),
    );

class TimelineItemInspector extends StatefulWidget {
  const TimelineItemInspector({super.key, required this.c, required this.item, required this.onEdit, required this.onOpenTool});
  final StudioController c;
  final TimelineItem item;
  final EditFn onEdit;
  final ValueChanged<StudioTool> onOpenTool;

  @override
  State<TimelineItemInspector> createState() => _TimelineItemInspectorState();
}

class _TimelineItemInspectorState extends State<TimelineItemInspector> {
  late RangeValues _range = RangeValues(widget.item.startMs.toDouble(), widget.item.endMs.toDouble());
  late double _volume = _sfx?.volumeDb ??
      widget.c.ir!.audio.voiceovers.where((v) => v.id == widget.item.id).firstOrNull?.volumeDb ??
      widget.c.ir!.audio.music.firstOrNull?.volumeDb ??
      -12;
  late final _text = TextEditingController(text: _caption?.text ?? '');
  late double _intensity = _effect?.intensity ?? 0.6;
  late double _brollOpacity = _overlay?.opacity ?? 1.0;

  TimelineItem get it => widget.item;
  MobileEditIr get ir => widget.c.ir!;
  EditIrSfx? get _sfx => ir.audio.sfx.where((e) => e.id == it.id).firstOrNull;
  EditIrCaption? get _caption => ir.captions.where((e) => e.id == it.id).firstOrNull;
  EditIrEffect? get _effect => ir.effects.where((e) => e.id == it.id).firstOrNull;
  EditIrOverlay? get _overlay => ir.overlays.where((e) => e.id == it.id).firstOrNull;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _apply(MobileEditIr Function(MobileEditIr) op, String done) {
    Navigator.pop(context);
    widget.onEdit(op, done: done);
  }

  void _nudge(int deltaMs) =>
      _apply((ir) => TimelineOps.moveItem(ir, it.kind, it.id, it.startMs + deltaMs), 'Moved ${deltaMs > 0 ? 'later' : 'earlier'}');

  @override
  Widget build(BuildContext context) {
    final movable = it.kind != TrackKind.music && it.kind != TrackKind.video;
    final total = ir.durationMs.toDouble();
    final o = _overlay;
    final fit = o?.fit ?? 'cover';
    final layer = o?.layer;
    final isPip = o?.isLayer ?? false;
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(it.kind.label, style: Theme.of(context).textTheme.labelSmall),
          Text(it.label, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleMedium),
          Text('${timecode(it.startMs)} – ${timecode(it.endMs)}', style: Theme.of(context).textTheme.bodySmall),
          SizedBox(height: 12),
          if (movable) ...[
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: () => _nudge(-500), child: Text('← 0.5 s'))),
              SizedBox(width: 8),
              Expanded(
                child: FilledButton.tonal(
                  onPressed: () => _apply((ir) => TimelineOps.moveItem(ir, it.kind, it.id, widget.c.playheadMs), 'Moved to the playhead'),
                  child: Text('To playhead'),
                ),
              ),
              SizedBox(width: 8),
              Expanded(child: OutlinedButton(onPressed: () => _nudge(500), child: Text('0.5 s →'))),
            ]),
            SizedBox(height: 12),
          ],
          if (it.kind != TrackKind.video) ...[
            Text('Start and end', style: Theme.of(context).textTheme.labelMedium),
            RangeSlider(
              values: _range,
              min: 0,
              max: total,
              divisions: math.max(1, total ~/ 100),
              labels: RangeLabels(timecode(_range.start.round()), timecode(_range.end.round())),
              onChanged: (v) => setState(() => _range = v),
            ),
            OutlinedButton(
              onPressed: () => _apply(
                (ir) => TimelineOps.setItemRange(ir, it.kind, it.id, _range.start.round(), _range.end.round()),
                'Timing updated',
              ),
              child: Text('Apply timing'),
            ),
          ],
          if (it.kind == TrackKind.sfx || it.kind == TrackKind.music || it.kind == TrackKind.voiceover) ...[
            SizedBox(height: 12),
            Text('Volume ${_volume.toStringAsFixed(0)} dB', style: Theme.of(context).textTheme.labelMedium),
            Slider(value: _volume.clamp(-40, 6).toDouble(), min: -40, max: 6, divisions: 46, onChanged: (v) => setState(() => _volume = v)),
            OutlinedButton(
              onPressed: () => _apply(
                (ir) => switch (it.kind) {
                  TrackKind.sfx => TimelineOps.setSfxVolume(ir, it.id, _volume),
                  TrackKind.voiceover => TimelineOps.updateVoiceover(ir, it.id, volumeDb: _volume),
                  _ => TimelineOps.updateMusic(ir, volumeDb: _volume),
                },
                'Volume updated',
              ),
              child: Text('Apply volume'),
            ),
          ],
          if (it.kind == TrackKind.effect) ...[
            SizedBox(height: 12),
            Text('Strength ${(_intensity * 100).round()}%', style: Theme.of(context).textTheme.labelMedium),
            Slider(value: _intensity, min: 0.1, max: 1, divisions: 9, onChanged: (v) => setState(() => _intensity = v)),
            OutlinedButton(
              onPressed: () => _apply((ir) => TimelineOps.setEffectIntensity(ir, it.id, _intensity), 'Strength updated'),
              child: Text('Apply strength'),
            ),
          ],
          if (it.kind == TrackKind.text) ...[
            SizedBox(height: 12),
            TextField(controller: _text, decoration: fieldDecoration('Text')),
            SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => _apply((ir) => TimelineOps.editText(ir, it.id, text: _text.text), 'Text updated'),
              child: Text('Update text'),
            ),
            SizedBox(height: 8),
            Text('Style', style: Theme.of(context).textTheme.labelMedium),
            SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 6, children: [
              for (final t in TextTemplate.all)
                ActionChip(
                  label: Text(t.name),
                  onPressed: () => _apply((ir) => TimelineOps.editText(ir, it.id, style: t.style()), 'Style: ${t.name}'),
                ),
            ]),
          ],
          if (it.kind == TrackKind.captions) ...[
            SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(context);
                widget.onOpenTool(StudioTool.captions);
              },
              icon: Icon(Icons.closed_caption_rounded),
              label: Text('Change caption style'),
            ),
          ],
          if (it.kind == TrackKind.broll && o != null) ...[
            SizedBox(height: 12),
            Text('Overlay Audio', style: Theme.of(context).textTheme.labelMedium),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(o.muted ? 'Muted (Silent Overlay)' : 'Video Audio Enabled'),
              subtitle: Text(o.muted ? 'Only primary video/speech plays' : 'B-roll audio mixes with speech'),
              value: o.muted,
              onChanged: (v) => _apply(
                (ir) => TimelineOps.updateOverlay(ir, it.id, muted: v),
                v ? 'Overlay audio muted' : 'Overlay audio enabled',
              ),
            ),
            OutlinedButton.icon(
              onPressed: () => _apply(
                (ir) => TimelineOps.updateOverlay(ir, it.id, muted: true),
                'Overlay audio removed',
              ),
              icon: Icon(Icons.volume_off_rounded),
              label: Text('Remove overlay audio'),
            ),

            SizedBox(height: 12),
            Text('Layout', style: Theme.of(context).textTheme.labelMedium),
            SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 6, children: [
              ChoiceChip(
                label: Text('Full screen'),
                selected: fit == 'cover' && !isPip,
                onSelected: (_) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, fit: 'cover', clearLayer: true), 'Layout: full screen'),
              ),
              ChoiceChip(
                label: Text('Fit whole frame'),
                selected: fit == 'contain' && !isPip,
                onSelected: (_) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, fit: 'contain', clearLayer: true), 'Layout: whole frame'),
              ),
              ChoiceChip(
                label: Text('Picture-in-picture'),
                selected: isPip,
                onSelected: (_) => _apply(
                  (ir) => TimelineOps.updateOverlay(ir, it.id, fit: 'contain', layer: layer ?? EditIrLayer.legacyPip),
                  'Layout: picture-in-picture (drag it on the preview to move it)',
                ),
              ),
            ]),
            if (isPip && layer != null) ...[
              SizedBox(height: 10),
              Text('Position', style: Theme.of(context).textTheme.labelMedium),
              Wrap(spacing: 8, runSpacing: 6, children: [
                for (final (label, x, y) in const [
                  ('Top left', 0.25, 0.22), ('Top right', 0.75, 0.22), ('Centre', 0.5, 0.5), ('Bottom left', 0.25, 0.78), ('Bottom right', 0.75, 0.78),
                ])
                  ActionChip(
                    label: Text(label),
                    onPressed: () => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, layer: layer.copyWith(x: x, y: y)), 'Moved to ${label.toLowerCase()}'),
                  ),
              ]),
              SizedBox(height: 8),
              Text('Shape', style: Theme.of(context).textTheme.labelMedium),
              Wrap(spacing: 8, runSpacing: 6, children: [
                ChoiceChip(
                  label: Text('Square'),
                  selected: o.mask == null,
                  onSelected: (_) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, clearMask: true), 'Shape: square'),
                ),
                ChoiceChip(
                  label: Text('Circle'),
                  selected: o.mask?.shape == 'circle',
                  onSelected: (_) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, mask: EditIrMask.circle), 'Shape: circle'),
                ),
                ChoiceChip(
                  label: Text('Rounded'),
                  selected: o.mask?.shape == 'rounded',
                  onSelected: (_) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, mask: EditIrMask.rounded), 'Shape: rounded corners'),
                ),
              ]),
              SizedBox(height: 8),
              Text('Size ${(layer.scale * 100).round()}%', style: Theme.of(context).textTheme.labelMedium),
              Slider(
                value: layer.scale.clamp(0.1, 1.0),
                min: 0.1,
                max: 1.0,
                divisions: 18,
                label: '${(layer.scale * 100).round()}%',
                // Keyframed size is edited at the playhead's keyframe; otherwise the base size changes.
                onChanged: (v) => _apply(
                  (ir) => layer.keyframes.any((k) => k.scale != null)
                      ? TimelineOps.setLayerKeyframe(ir, it.id, widget.c.playheadMs, scale: v)
                      : TimelineOps.updateOverlay(ir, it.id, layer: layer.copyWith(scale: v)),
                  'Size ${(v * 100).round()}%',
                ),
              ),
              Text('Rotation ${layer.rotation.round()}°', style: Theme.of(context).textTheme.labelMedium),
              Slider(
                value: layer.rotation.clamp(-180, 180),
                min: -180,
                max: 180,
                divisions: 72,
                label: '${layer.rotation.round()}°',
                onChanged: (v) => _apply(
                  (ir) => layer.keyframes.any((k) => k.rotation != null)
                      ? TimelineOps.setLayerKeyframe(ir, it.id, widget.c.playheadMs, rotation: v)
                      : TimelineOps.updateOverlay(ir, it.id, layer: layer.copyWith(rotation: v)),
                  'Rotation ${v.round()}°',
                ),
              ),
              Text('Animation in', style: Theme.of(context).textTheme.labelMedium),
              SizedBox(height: 6),
              Wrap(spacing: 8, runSpacing: 6, children: [
                ChoiceChip(
                  label: Text('None'),
                  selected: layer.keyframes.isEmpty,
                  onSelected: (_) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, layer: layer.copyWith(keyframes: const [])), 'No animation'),
                ),
                for (final (key, label) in const [('zoom_in', 'Zoom in'), ('slide_left', 'Slide in'), ('slide_up', 'Rise'), ('fade', 'Fade'), ('spin', 'Spin')])
                  ActionChip(
                    label: Text(label),
                    onPressed: () => _apply(
                      (ir) => TimelineOps.updateOverlay(ir, it.id, layer: layer.copyWith(keyframes: TimelineOps.layerEntrance(layer, key))),
                      'Animation: ${label.toLowerCase()}',
                    ),
                  ),
              ]),
              SizedBox(height: 10),
              Text('Keyframes', style: Theme.of(context).textTheme.labelMedium),
              Text(
                'Add a keyframe, move the playhead, then drag, resize or rotate the layer and add another: it animates between them.',
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
              SizedBox(height: 6),
              Wrap(spacing: 8, runSpacing: 6, children: [
                ActionChip(
                  avatar: Icon(Icons.diamond_outlined, size: 18),
                  label: Text('Add at ${timecode(widget.c.playheadMs)}'),
                  onPressed: () => _apply((ir) => TimelineOps.setLayerKeyframe(ir, it.id, widget.c.playheadMs), 'Keyframe added'),
                ),
                for (final k in layer.keyframes)
                  InputChip(
                    label: Text('${(k.atMs / 1000).toStringAsFixed(1)} s'),
                    onPressed: () => widget.c.seek(it.startMs + k.atMs),
                    onDeleted: () => _apply((ir) => TimelineOps.removeLayerKeyframe(ir, it.id, k.atMs), 'Keyframe removed'),
                  ),
              ]),
            ],

            SizedBox(height: 12),
            SizedBox(
              height: 44,
              child: OutlinedButton.icon(
                onPressed: widget.c.processing != null
                    ? null
                    : () async {
                        try {
                          await widget.c.removeOverlayBackground(it.id);
                          if (context.mounted) showSuccess(context, 'Background removed');
                        } catch (e) {
                          if (context.mounted) showError(context, e);
                        }
                        if (mounted) setState(() {});
                      },
                icon: Icon(Icons.person_outline_rounded),
                label: Text(widget.c.processing ?? 'Remove background (keep the person)'),
              ),
            ),
            SizedBox(height: 12),
            Text('Green screen', style: Theme.of(context).textTheme.labelMedium),
            SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 6, children: [
              ChoiceChip(
                label: Text('Off'),
                selected: o.chromaKey == null,
                onSelected: (_) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, clearChromaKey: true), 'Green screen off'),
              ),
              for (final (label, key) in const [('Remove green', EditIrChromaKey.green), ('Remove blue', EditIrChromaKey.blue)])
                ChoiceChip(
                  label: Text(label),
                  selected: o.chromaKey?.color == key.color,
                  // Keying turns a cutaway into a full-frame layer so the main video shows through.
                  onSelected: (_) => _apply(
                    (ir) => TimelineOps.updateOverlay(ir, it.id, chromaKey: key, fit: 'contain', layer: layer ?? const EditIrLayer(x: 0.5, y: 0.5, scale: 1)),
                    '${label.replaceFirst('Remove', 'Removing')} background',
                  ),
                ),
            ]),
            if (o.chromaKey != null) ...[
              Text('Key strength ${(o.chromaKey!.similarity * 100).round()}%', style: Theme.of(context).textTheme.labelMedium),
              Slider(
                value: o.chromaKey!.similarity,
                min: 0.05,
                max: 0.8,
                divisions: 15,
                onChanged: (v) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, chromaKey: o.chromaKey!.copyWith(similarity: v)), 'Key strength ${(v * 100).round()}%'),
              ),
              Text('Edge softness ${(o.chromaKey!.smoothness * 100).round()}%', style: Theme.of(context).textTheme.labelMedium),
              Slider(
                value: o.chromaKey!.smoothness,
                min: 0,
                max: 0.5,
                divisions: 10,
                onChanged: (v) => _apply((ir) => TimelineOps.updateOverlay(ir, it.id, chromaKey: o.chromaKey!.copyWith(smoothness: v)), 'Edge softness ${(v * 100).round()}%'),
              ),
            ],

            SizedBox(height: 12),
            Text('Opacity ${(_brollOpacity * 100).round()}%', style: Theme.of(context).textTheme.labelMedium),
            Slider(
              value: _brollOpacity.clamp(0.1, 1.0),
              min: 0.1,
              max: 1.0,
              divisions: 9,
              onChanged: (v) => setState(() => _brollOpacity = v),
            ),
            OutlinedButton(
              onPressed: () => _apply(
                (ir) => TimelineOps.updateOverlay(ir, it.id, opacity: _brollOpacity),
                'Opacity set to ${(_brollOpacity * 100).round()}%',
              ),
              child: Text('Apply opacity'),
            ),
          ],
          if (it.kind == TrackKind.music) ...[
            SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(context);
                widget.onOpenTool(StudioTool.music);
              },
              icon: Icon(Icons.swap_horiz_rounded),
              label: Text('Replace music'),
            ),
          ],
          if (it.kind == TrackKind.broll) ...[
            SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () {
                Navigator.pop(context);
                widget.onOpenTool(StudioTool.broll);
              },
              icon: Icon(Icons.swap_horiz_rounded),
              label: Text('Replace with different B-roll clip'),
            ),
          ],
          SizedBox(height: 16),
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppTheme.error),
            onPressed: () => _apply((ir) => TimelineOps.deleteItem(ir, it.kind, it.id), '${it.kind.label} removed'),
            icon: Icon(Icons.delete_outline_rounded),
            label: Text('Delete ${it.kind.label.toLowerCase()}'),
          ),
        ]),
      ),
    );
  }
}
