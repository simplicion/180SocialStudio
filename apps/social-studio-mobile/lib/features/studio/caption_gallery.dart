import 'dart:io';

import 'package:flutter/material.dart';

import '../../core/native_engine/edit_ir.dart';
import '../../core/theme/app_theme.dart';
import 'caption_catalog.dart';
import 'caption_template_apply.dart';
import 'studio_controller.dart';
// The Studio preview's own caption painter (studio_session_screen.dart), so a gallery card draws captions exactly
// as the preview does instead of a second renderer. It is marked @visibleForTesting there; the renderer owner is
// asked to make it public (see docs/social-studio-mobile/CAPTIONS_V2.md).
// ignore: invalid_use_of_visible_for_testing_member
import 'studio_session_screen.dart' show captionPreviewLayer;
import 'video_thumbnails.dart';

/// Length of the looping preview: the first 3 s of the user's clip.
const captionPreviewLoopMs = 3000;

/// The user's own captions for the first 3 s of the timeline: the speech captions that start there, else captions
/// built from the transcript's words, else one sample line. Times stay on the timeline (0..3000 ms).
List<EditIrCaption> captionPreviewSource(StudioController c) {
  final ir = c.ir;
  if (ir == null) return const [];
  final own = [
    for (final x in ir.captions)
      if (x.kind == 'caption' && x.startMs < captionPreviewLoopMs) x,
  ];
  if (own.isNotEmpty) return own;
  final words = [
    for (final w in c.words)
      if (w.startMs < captionPreviewLoopMs) EditIrWord(text: w.text, startMs: w.startMs, endMs: w.endMs),
  ];
  if (words.isNotEmpty) {
    final out = <EditIrCaption>[];
    for (var i = 0; i < words.length; i += 3) {
      final g = words.sublist(i, (i + 3).clamp(0, words.length));
      out.add(
        EditIrCaption(
          id: 'preview_$i',
          startMs: g.first.startMs,
          endMs: g.last.endMs,
          text: EditIrCaption.joinWordsForScript([for (final w in g) w.text]),
          words: g,
        ),
      );
    }
    return out;
  }
  const sample = ['Your', 'captions', 'here'];
  return [
    EditIrCaption(
      id: 'preview_sample',
      startMs: 0,
      endMs: captionPreviewLoopMs,
      text: sample.join(' '),
      words: [
        for (final (i, w) in sample.indexed) EditIrWord(text: w, startMs: i * 800, endMs: i * 800 + 700),
      ],
    ),
  ];
}

/// Template gallery: every caption template as a 9:16 card that plays its look over the first 3 s of the user's
/// clip (frames of the clip behind the user's own captions, drawn by the preview's caption painter). One tap picks
/// a template ([onSelect]).
class CaptionGallery extends StatefulWidget {
  const CaptionGallery({
    super.key,
    required this.controller,
    required this.selectedId,
    required this.onSelect,
    this.animate = true,
    this.templates,
  });

  final StudioController controller;
  final String? selectedId;
  final ValueChanged<CaptionTemplate> onSelect;

  /// Off in tests that settle the widget tree (a looping animation never settles).
  final bool animate;

  /// Defaults to CaptionCatalog.templates.
  final List<CaptionTemplate>? templates;

  @override
  State<CaptionGallery> createState() => _CaptionGalleryState();
}

class _CaptionGalleryState extends State<CaptionGallery> with SingleTickerProviderStateMixin {
  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: captionPreviewLoopMs),
  );

  /// Frames of the clip at 0 / 1 / 2 s (null until extracted, or when the clip has none).
  List<String?> _frames = const [null, null, null];

  @override
  void initState() {
    super.initState();
    if (widget.animate) _clock.repeat();
    _loadFrames();
  }

  @override
  void didUpdateWidget(CaptionGallery old) {
    super.didUpdateWidget(old);
    if (widget.animate && !_clock.isAnimating) _clock.repeat();
    if (!widget.animate && _clock.isAnimating) _clock.stop();
  }

  Future<void> _loadFrames() async {
    final c = widget.controller;
    final clip = c.ir?.clips.firstOrNull;
    final path = clip != null ? (c.sourcePaths[clip.assetId] ?? c.sourcePath) : c.sourcePath;
    if (path == null || !VideoThumbnails.isLocalVideo(path)) return;
    final out = <String?>[];
    for (final at in const [0, 1000, 2000]) {
      out.add(await VideoThumbnails.frameFor(path, atMs: at));
    }
    if (mounted) setState(() => _frames = out);
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final templates = widget.templates ?? CaptionCatalog.templates;
    final source = captionPreviewSource(widget.controller);
    final ir = widget.controller.ir;
    return SizedBox(
      height: 190,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: templates.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final t = templates[i];
          final styled = [
            for (final cap in source)
              EditIrCaption(
                id: cap.id,
                startMs: cap.startMs,
                endMs: cap.endMs,
                text: cap.text,
                words: cap.words,
                style: CaptionTemplateApply.styleFor(
                  t,
                  text: cap.text,
                  canvasW: ir?.canvas.width ?? 1080,
                  canvasH: ir?.canvas.height ?? 1920,
                ).style,
              ),
          ];
          return _TemplateCard(
            key: ValueKey('caption-template-${t.id}'),
            template: t,
            captions: styled,
            frames: _frames,
            clock: _clock,
            controller: widget.controller,
            canvasWidth: ir?.canvas.width ?? 1080,
            selected: widget.selectedId != null && CaptionCatalog.canonicalId(widget.selectedId!) == t.id,
            onTap: () => widget.onSelect(t),
          );
        },
      ),
    );
  }
}

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({
    super.key,
    required this.template,
    required this.captions,
    required this.frames,
    required this.clock,
    required this.controller,
    required this.canvasWidth,
    required this.selected,
    required this.onTap,
  });

  final CaptionTemplate template;
  final List<EditIrCaption> captions;
  final List<String?> frames;
  final Animation<double> clock;
  final StudioController controller;
  final int canvasWidth;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: 'Caption template ${template.name}',
      child: GestureDetector(
        onTap: onTap,
        child: Column(
          children: [
            Container(
              width: 90,
              height: 160,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: Colors.black,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: selected ? AppTheme.primary : AppTheme.border, width: selected ? 3 : 1),
              ),
              child: AnimatedBuilder(
                animation: clock,
                builder: (context, _) {
                  final t = (clock.value * captionPreviewLoopMs).round();
                  final frame = frames[(t ~/ 1000).clamp(0, frames.length - 1)];
                  final active = captions.where((c) => t >= c.startMs && t < c.endMs).firstOrNull;
                  return Stack(
                    fit: StackFit.expand,
                    children: [
                      if (frame != null)
                        Image.file(File(frame), fit: BoxFit.cover, gaplessPlayback: true)
                      else
                        const DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [Color(0xFF2A2F3A), Color(0xFF0E1015)],
                            ),
                          ),
                        ),
                      if (active != null)
                        IgnorePointer(
                          // The preview painter is draggable; a gallery card only shows it.
                          // ignore: invalid_use_of_visible_for_testing_member
                          child: captionPreviewLayer(
                            key: ValueKey('${template.id}-${active.id}'),
                            caption: active,
                            t: t,
                            canvasWidth: canvasWidth,
                            controller: controller,
                          ),
                        ),
                    ],
                  );
                },
              ),
            ),
            const SizedBox(height: 4),
            SizedBox(
              width: 90,
              child: Text(
                template.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: selected ? FontWeight.bold : FontWeight.w500,
                  color: selected ? AppTheme.primary : AppTheme.textSecondary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
