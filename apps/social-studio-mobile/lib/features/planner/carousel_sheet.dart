import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/util/poll_backoff.dart';
import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/common.dart';
import '../../data/models/autopilot.dart';

/// Designs carousel slides for a calendar piece or post on the server (brand fonts/colours + image model),
/// then shows the finished slides. The server attaches them to the piece/post itself.
Future<void> showCarouselSheet(
  BuildContext context, {
  required String projectId,
  String? pieceId,
  String? postId,
  String? title,
}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppTheme.surfaceElevated,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.9,
        child: CarouselSheet(projectId: projectId, pieceId: pieceId, postId: postId, title: title),
      ),
    );

class CarouselSheet extends ConsumerStatefulWidget {
  const CarouselSheet({super.key, required this.projectId, this.pieceId, this.postId, this.title, this.pollInterval});
  final String projectId;
  final String? pieceId;
  final String? postId;
  final String? title;

  /// Test hook; defaults to 2 s.
  final Duration? pollInterval;

  @override
  ConsumerState<CarouselSheet> createState() => _CarouselSheetState();
}

class _CarouselSheetState extends ConsumerState<CarouselSheet> {
  String _format = 'portrait';
  CreativeJob? _job;
  Object? _error;
  bool _starting = false;
  int? _regenerating;
  Timer? _timer;
  int _polls = 0;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _start({bool stockPhotos = false}) async {
    setState(() {
      _starting = true;
      _error = null;
      _job = null;
    });
    try {
      final job = await ref.read(socialApiProvider).startCreative(
            widget.projectId,
            pieceId: widget.pieceId,
            postId: widget.postId,
            format: _format,
            useImageModel: !stockPhotos,
          );
      if (!mounted) return;
      setState(() => _job = job);
      _schedule();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  void _schedule() {
    _timer?.cancel();
    if (_job == null || _job!.isFinished) return;
    _timer = Timer(pollDelay(_polls++, override: widget.pollInterval), _poll);
  }

  Future<void> _poll() async {
    final id = _job?.id;
    if (id == null) return;
    try {
      final job = await ref.read(socialApiProvider).getCreativeJob(widget.projectId, id);
      if (!mounted) return;
      setState(() {
        _job = job;
        _error = null;
        if (job.isFinished) _regenerating = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
      if (e is ApiException && !e.isTransient) return;
    }
    _schedule();
  }

  Future<void> _regenerate(int index) async {
    final id = _job?.id;
    if (id == null) return;
    setState(() => _regenerating = index);
    try {
      final job = await ref.read(socialApiProvider).regenerateSlide(widget.projectId, id, index);
      if (!mounted) return;
      setState(() => _job = job);
      _schedule();
    } catch (e) {
      if (!mounted) return;
      setState(() => _regenerating = null);
      showError(context, e);
    }
  }

  bool get _imageModelMissing {
    final e = _error;
    return (e is ApiException && e.code == 'IMAGE_MODEL_NOT_CONFIGURED') || _job?.errorCode == 'IMAGE_MODEL_NOT_CONFIGURED';
  }

  @override
  Widget build(BuildContext context) {
    final job = _job;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: EdgeInsets.fromLTRB(16, 8, 8, 0),
        child: Row(children: [
          Expanded(
            child: Text(widget.title?.isNotEmpty == true ? widget.title! : 'Carousel',
                style: Theme.of(context).textTheme.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          IconButton(tooltip: 'Close', icon: Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context)),
        ]),
      ),
      Expanded(
        child: ListView(padding: EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
          if (job == null && !_starting) ..._setup(context),
          if (_starting || (job != null && !job.isFinished)) _progress(context, job),
          if (_error != null || (job?.isFailed ?? false)) _failure(context, job),
          if (job != null && job.isDone) ..._result(context, job),
        ]),
      ),
    ]);
  }

  List<Widget> _setup(BuildContext context) => [
        Text('Slides are designed in your brand fonts and colours, with photos from your image model.',
            style: Theme.of(context).textTheme.bodyMedium),
        SizedBox(height: 16),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'portrait', label: Text('Portrait 4:5')),
            ButtonSegment(value: 'square', label: Text('Square 1:1')),
          ],
          selected: {_format},
          onSelectionChanged: (s) => setState(() => _format = s.first),
        ),
        SizedBox(height: 20),
        ElevatedButton.icon(
          onPressed: _start,
          icon: Icon(Icons.auto_awesome_rounded),
          label: Text('Design slides'),
        ),
      ];

  Widget _progress(BuildContext context, CreativeJob? job) => Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Column(children: [
          Text(job?.step.isNotEmpty == true ? job!.step : 'Starting…', style: Theme.of(context).textTheme.titleSmall),
          SizedBox(height: 12),
          LinearProgressIndicator(value: job?.fraction, minHeight: 6),
          SizedBox(height: 12),
          Text('Usually under a minute. The slides are saved to this piece when done.',
              textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
        ]),
      );

  Widget _failure(BuildContext context, CreativeJob? job) {
    if (_imageModelMissing) {
      return SectionCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('No image model is set up for this workspace', style: TextStyle(fontWeight: FontWeight.w700)),
          SizedBox(height: 6),
          Text('Add an image API key in Settings → AI on the web app, or design the slides with free stock photos (or text-only slides if none are available).'),
          SizedBox(height: 12),
          ElevatedButton(onPressed: () => _start(stockPhotos: true), child: Text('Use stock photos')),
          TextButton(onPressed: _start, child: Text('Try again')),
        ]),
      );
    }
    if (job != null && job.isFailed) {
      return SectionCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('The slides could not be designed', style: TextStyle(fontWeight: FontWeight.w700)),
          SizedBox(height: 6),
          Text(job.errorMessage ?? 'The server stopped at "${job.step}".'),
          SizedBox(height: 12),
          ElevatedButton(onPressed: _start, child: Text('Try again')),
          TextButton(onPressed: () => _start(stockPhotos: true), child: Text('Try with stock photos')),
        ]),
      );
    }
    return ErrorView(error: _error!, compact: true, onRetry: _job == null ? _start : _poll);
  }

  List<Widget> _result(BuildContext context, CreativeJob job) => [
        if (job.warnings.isNotEmpty)
          Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: StatusChip(label: job.warnings.first, color: AppTheme.warning, icon: Icons.info_rounded),
          ),
        if (job.slides.isEmpty) EmptyView(icon: Icons.view_carousel_rounded, title: 'The server returned no slides.', actionLabel: 'Try again', onAction: _start),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: _format == 'square' ? 0.82 : 0.68,
          children: [
            for (final s in job.slides)
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.network(
                      s.url, cacheWidth: 720,
                      fit: BoxFit.cover,
                      semanticLabel: 'Slide ${s.index + 1}',
                      loadingBuilder: (_, child, p) => p == null ? child : Container(color: AppTheme.surface),
                      errorBuilder: (_, _, _) => Container(
                        color: AppTheme.surface,
                        alignment: Alignment.center,
                        child: Icon(Icons.broken_image_rounded),
                      ),
                    ),
                  ),
                ),
                TextButton.icon(
                  onPressed: _regenerating == null ? () => _regenerate(s.index) : null,
                  icon: Icon(Icons.refresh_rounded, size: 16),
                  label: Text(_regenerating == s.index ? 'Redesigning…' : 'Slide ${s.index + 1}: redo'),
                ),
              ]),
          ],
        ),
        SizedBox(height: 12),
        Text('Saved to this piece. Open it in Posts to review and publish.',
            textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
        TextButton(onPressed: () => setState(() => _job = null), child: Text('Design a new set')),
      ];
}
