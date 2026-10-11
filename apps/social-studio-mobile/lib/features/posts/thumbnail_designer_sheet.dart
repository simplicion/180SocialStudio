import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/media/asset_cache.dart';
import '../../core/native_engine/media_engine_service.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/universal_skeleton.dart';
import '../../data/models/social_post.dart';

/// Opens the AI thumbnail designer for a video post. Returns the chosen thumbnail URL (already saved on the post).
Future<String?> showThumbnailDesigner(BuildContext context, SocialPost post, String videoUrl) => showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.surface,
      builder: (_) => FractionallySizedBox(heightFactor: 0.92, child: ThumbnailDesignerSheet(post: post, videoUrl: videoUrl)),
    );

enum _Stage { scouting, designing, ready, failed, manual }

/// AI thumbnail designer: the phone's Frame Scout picks the best real frames, the server's design team
/// (copywriter → art director → measured render → QA critic) returns three designs, and the creator picks one.
/// Second path: "Design it myself" (frame + text, no AI) through the same compositor and QA.
class ThumbnailDesignerSheet extends ConsumerStatefulWidget {
  const ThumbnailDesignerSheet({super.key, required this.post, required this.videoUrl});
  final SocialPost post;
  final String videoUrl;

  @override
  ConsumerState<ThumbnailDesignerSheet> createState() => _ThumbnailDesignerSheetState();
}

class _ThumbnailDesignerSheetState extends ConsumerState<ThumbnailDesignerSheet> {
  _Stage _stage = _Stage.scouting;
  String _format = '9:16';
  List<Map<String, dynamic>> _frames = const [];
  List<Json> _variants = const [];
  Object? _error;
  String? _saving;
  // Manual mode.
  int _manualFrame = 0;
  final _manualText = TextEditingController();
  String _manualLayout = 'text_top';
  Json? _manualResult;

  @override
  void initState() {
    super.initState();
    _run();
  }

  @override
  void dispose() {
    _manualText.dispose();
    super.dispose();
  }

  Future<void> _scout() async {
    if (_frames.isNotEmpty) return;
    final path = await AssetCache.instance.ensure(widget.videoUrl, kind: AssetKind.video);
    final dir = await getTemporaryDirectory();
    final out = '${dir.path}/thumb_frames_${widget.post.id}';
    _frames = await MediaEngineService.thumbnailCandidates(sourcePath: path, outputDir: out, count: 4);
    if (_frames.isEmpty) throw MediaEngineException('NO_FRAMES', 'No usable frames were found in this video.');
  }

  Json _frameJson(Map<String, dynamic> f) => {
        'imageBase64': base64Encode(File('${f['path']}').readAsBytesSync()),
        'tMs': (f['tMs'] as num).toInt(),
        'faces': [
          for (final face in (f['faces'] as List? ?? const []).whereType<Map>())
            {
              'x': face['x'], 'y': face['y'], 'w': face['w'], 'h': face['h'],
              if (face['smile'] != null) 'smile': face['smile'],
              if (face['eyesOpen'] != null) 'eyesOpen': face['eyesOpen'],
            },
        ],
        if (f['sharpness'] != null) 'sharpness': (f['sharpness'] as num).toDouble().clamp(0.0, 1.0),
        if (f['brightness'] != null) 'brightness': (f['brightness'] as num).toDouble().clamp(0.0, 1.0),
      };

  Future<void> _run() async {
    setState(() {
      _stage = _Stage.scouting;
      _error = null;
    });
    try {
      await _scout();
      if (!mounted) return;
      setState(() => _stage = _Stage.designing);
      final projectId = widget.post.projectId;
      if (projectId == null) throw MediaEngineException('NO_PROJECT', 'This post is not in a project.');
      final r = await ref.read(socialApiProvider).designThumbnails(projectId, {
        'format': _format,
        if (widget.post.title != null) 'title': widget.post.title,
        if (widget.post.content.isNotEmpty) 'caption': widget.post.content,
        'frames': [for (final f in _frames) _frameJson(f)],
      });
      if (!mounted) return;
      setState(() {
        _variants = (r['variants'] as List? ?? const []).whereType<Map>().map((m) => m.cast<String, dynamic>()).toList();
        _stage = _Stage.ready;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _stage = _Stage.failed;
        });
      }
    }
  }

  Future<void> _use(String url) async {
    setState(() => _saving = url);
    try {
      final outcome = await ref.read(socialApiProvider).updatePost(widget.post.id, {'thumbnailUrl': url});
      if (!mounted) return;
      Navigator.pop(context, url);
      showSuccess(
        context,
        outcome.queued
            ? 'Thumbnail saved on this phone; it syncs when you are back online.'
            : 'Thumbnail saved. It is used as the YouTube thumbnail and the Reels cover.',
      );
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  Future<void> _renderManual() async {
    final text = _manualText.text.trim();
    if (text.isEmpty) return showError(context, 'Type the thumbnail text first (2–5 words).');
    setState(() => _saving = 'manual');
    try {
      await _scout();
      final projectId = widget.post.projectId;
      if (projectId == null) throw MediaEngineException('NO_PROJECT', 'This post is not in a project.');
      final f = _frames[_manualFrame.clamp(0, _frames.length - 1)];
      final r = await ref.read(socialApiProvider).renderThumbnail(projectId, {
        'format': _format,
        'frame': {'imageBase64': _frameJson(f)['imageBase64'], 'faces': _frameJson(f)['faces']},
        'spec': {
          'frameIndex': 0, 'layout': _manualLayout, 'headline': text, 'emphasis': null, 'font': 'Anton', 'uppercase': true,
          'textColor': '#FFFFFF', 'emphasisColor': '#FFD400', 'textStyle': 'outline', 'zoom': 1.15, 'accent': 'none',
        },
      });
      if (mounted) setState(() => _manualResult = r);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  Widget _qaChips(Json qa, double? score) {
    Widget chip(String label, bool ok) => Chip(
          visualDensity: VisualDensity.compact,
          avatar: Icon(ok ? Icons.check_circle_rounded : Icons.error_outline_rounded, size: 16, color: ok ? AppTheme.success : AppTheme.warning),
          label: Text(label, style: TextStyle(fontSize: 11)),
        );
    final contrast = (qa['contrast'] as num?)?.toDouble() ?? 0;
    return Wrap(spacing: 4, runSpacing: 2, children: [
      if (score != null) chip('QA ${score.toStringAsFixed(1)}/10', qa['passed'] == true),
      chip('Contrast ${contrast.toStringAsFixed(1)}:1', contrast >= 4.5),
      chip('Face clear', ((qa['faceOverlapPct'] as num?) ?? 0) <= 12),
      chip('Safe zone', qa['inSafeZone'] == true),
    ]);
  }

  Widget _variantCard(Json v) {
    final url = jStr(v['url']) ?? '';
    final aspect = _format == '9:16' ? 9 / 16 : 16 / 9;
    return SectionCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: AspectRatio(
            aspectRatio: aspect,
            child: Image.network(url, fit: BoxFit.cover, cacheWidth: 720,
                loadingBuilder: (_, child, p) => p == null ? child : UniversalSkeleton(type: SkeletonType.projects),
                errorBuilder: (_, _, _) => Center(child: Icon(Icons.broken_image_rounded))),
          ),
        ),
        SizedBox(height: 8),
        _qaChips(jMap(v['qa']), (v['score'] as num?)?.toDouble()),
        if ((jStr(v['notes']) ?? '').isNotEmpty) Text(jStr(v['notes'])!, style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
        SizedBox(height: 6),
        SizedBox(
          height: 44,
          child: FilledButton(
            onPressed: _saving == null ? () => _use(url) : null,
            child: Text(_saving == url ? 'Saving…' : 'Use this thumbnail'),
          ),
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
      child: ListView(children: [
        Text('Thumbnail', style: Theme.of(context).textTheme.titleLarge),
        Text('Made from the best real frame of your video, designed and checked by the AI design team.',
            style: TextStyle(color: AppTheme.textSecondary)),
        SizedBox(height: 10),
        Wrap(spacing: 8, children: [
          for (final (f, label) in const [('9:16', 'Reels / Shorts cover'), ('16:9', 'YouTube thumbnail')])
            ChoiceChip(
              label: Text(label),
              selected: _format == f,
              onSelected: _stage == _Stage.scouting || _stage == _Stage.designing
                  ? null
                  : (_) {
                      setState(() => _format = f);
                      if (_stage != _Stage.manual) _run();
                    },
            ),
        ]),
        SizedBox(height: 12),
        if (_stage == _Stage.scouting || _stage == _Stage.designing) ...[
          Text(_stage == _Stage.scouting ? 'Finding the best frames on your phone…' : 'Copywriter → art director → QA are designing 3 options…',
              style: TextStyle(color: AppTheme.textSecondary)),
          SizedBox(height: 8),
          SizedBox(height: 360, child: UniversalSkeleton(type: SkeletonType.projects)),
        ],
        if (_stage == _Stage.failed && _error != null) ...[
          ErrorView(error: _error!, compact: true, onRetry: _run),
          SizedBox(height: 8),
          SizedBox(height: 44, child: OutlinedButton.icon(onPressed: () => setState(() => _stage = _Stage.manual), icon: Icon(Icons.edit_rounded), label: Text('Design it myself'))),
        ],
        if (_stage == _Stage.ready) ...[
          if (_variants.isEmpty)
            EmptyView(icon: Icons.image_not_supported_rounded, title: 'No designs came back', message: 'Try again, or design it yourself.', actionLabel: 'Try again', onAction: _run)
          else
            for (final v in _variants) Padding(padding: EdgeInsets.only(bottom: 12), child: _variantCard(v)),
          TextButton.icon(onPressed: () => setState(() => _stage = _Stage.manual), icon: Icon(Icons.edit_rounded), label: Text('Design it myself instead')),
        ],
        if (_stage == _Stage.manual) ...[
          Text('Pick a frame', style: Theme.of(context).textTheme.labelLarge),
          SizedBox(height: 6),
          if (_frames.isEmpty)
            SizedBox(height: 44, child: OutlinedButton(onPressed: () => _scout().then((_) => setState(() {})), child: Text('Find frames')))
          else
            SizedBox(
              height: 110,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final (i, f) in _frames.indexed)
                  GestureDetector(
                    onTap: () => setState(() => _manualFrame = i),
                    child: Container(
                      margin: EdgeInsets.only(right: 8),
                      decoration: BoxDecoration(border: Border.all(color: i == _manualFrame ? AppTheme.primary : Colors.transparent, width: 3), borderRadius: BorderRadius.circular(8)),
                      child: ClipRRect(borderRadius: BorderRadius.circular(6), child: Image.file(File('${f['path']}'), height: 104, fit: BoxFit.cover)),
                    ),
                  ),
              ]),
            ),
          SizedBox(height: 10),
          TextField(controller: _manualText, maxLength: 36, decoration: fieldDecoration('Thumbnail text', hint: '2–5 words, e.g. "Stop wasting money"')),
          Wrap(spacing: 8, children: [
            for (final (l, label) in const [('text_top', 'Top'), ('text_bottom', 'Bottom'), ('face_left_text_right', 'Beside the face'), ('boxed_tag', 'Tag')])
              ChoiceChip(label: Text(label), selected: _manualLayout == l, onSelected: (_) => setState(() => _manualLayout = l)),
          ]),
          SizedBox(height: 8),
          SizedBox(height: 44, child: FilledButton(onPressed: _saving == null ? _renderManual : null, child: Text(_saving == 'manual' ? 'Rendering…' : 'Preview'))),
          if (_manualResult case final r?) ...[
            SizedBox(height: 12),
            _variantCard({'url': r['url'], 'qa': r['qa'], 'score': null, 'notes': ''}),
          ],
        ],
      ]),
    );
  }
}
