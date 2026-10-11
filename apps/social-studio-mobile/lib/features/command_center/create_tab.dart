import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import 'cc_widgets.dart';

/// AI drafting for one platform: an idea becomes a native post (ranked hooks, timed script or slides, caption),
/// and long-form text is mined for standalone posts. Output is the workspace's own AI provider, never a template.
class CreateTab extends ConsumerStatefulWidget {
  const CreateTab({super.key, required this.platform, this.projectId});
  final String platform;
  final String? projectId;

  @override
  ConsumerState<CreateTab> createState() => _CreateTabState();
}

class _CreateTabState extends ConsumerState<CreateTab> with AutomaticKeepAliveClientMixin {
  final _idea = TextEditingController();
  final _keywords = TextEditingController();
  final _source = TextEditingController();
  String _format = 'video';

  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() {
    _idea.dispose();
    _keywords.dispose();
    _source.dispose();
    super.dispose();
  }

  bool get _hasCarousel => commandPlatforms.firstWhere((p) => p.id == widget.platform).carousel;

  Future<Json?> _draft() async {
    if (_idea.text.trim().length < 8) {
      showInfo(context, 'Describe the idea in a sentence first.');
      return null;
    }
    final keywords = _keywords.text.split(',').map((k) => k.trim()).where((k) => k.isNotEmpty).toList();
    final r = await ref.read(socialApiProvider).platformAi(widget.platform, 'draft', {
      'idea': _idea.text.trim(),
      'format': _format,
      'projectId': ?widget.projectId,
      if (keywords.isNotEmpty) 'keywords': keywords,
    });
    return jMap(r['draft']);
  }

  Future<Json?> _repurpose() async {
    if (_source.text.trim().split(RegExp(r'\s+')).length < 60) {
      showInfo(context, 'Paste at least a few paragraphs to repurpose.');
      return null;
    }
    return ref.read(socialApiProvider).platformAi(widget.platform, 'repurpose', {'text': _source.text.trim(), 'projectId': ?widget.projectId});
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final label = platformLabel(widget.platform);
    return ListView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        ToolCard(
          title: 'Draft a $label post',
          subtitle: 'Written to $label\'s rules in your brand voice, then scored. Facts come only from your idea and brand profile.',
          children: [
            TextField(controller: _idea, minLines: 3, maxLines: 6, maxLength: 4000, decoration: fieldDecoration('Your idea', hint: 'What do you want to say, and to whom?')),
            SizedBox(height: 4),
            Wrap(spacing: 8, children: [
              for (final f in [('video', 'Video'), if (_hasCarousel) ('carousel', 'Carousel'), ('text', 'Text post')])
                ChoiceChip(
                  materialTapTargetSize: MaterialTapTargetSize.padded,
                  label: Text(f.$2),
                  selected: _format == f.$1,
                  onSelected: (_) => setState(() => _format = f.$1),
                ),
            ]),
            SizedBox(height: 12),
            TextField(controller: _keywords, decoration: fieldDecoration('Search keywords (optional)', hint: 'comma separated')),
            SizedBox(height: 12),
            ToolRunner(label: 'Write it', icon: Icons.auto_awesome_rounded, ai: true, run: _draft, result: (context, d) => _DraftResult(draft: d)),
          ],
        ),
        ToolCard(
          title: 'Repurpose long-form',
          subtitle: 'Paste a transcript, article or newsletter. Each idea is tied to an exact quote from your text.',
          children: [
            TextField(controller: _source, minLines: 4, maxLines: 10, maxLength: 30000, decoration: fieldDecoration('Source text')),
            SizedBox(height: 4),
            ToolRunner(label: 'Find posts in this', icon: Icons.recycling_rounded, ai: true, run: _repurpose, result: (context, d) => _RepurposeResult(data: d, onUse: (hook, format) {
              setState(() {
                _idea.text = hook;
                if (format != 'carousel' || _hasCarousel) _format = format;
              });
              showInfo(context, 'Added to "Your idea" above.');
            })),
          ],
        ),
      ],
    );
  }
}

class _DraftResult extends StatelessWidget {
  const _DraftResult({required this.draft});
  final Json draft;

  @override
  Widget build(BuildContext context) {
    final hooks = jList(draft['hooks'], (m) => m);
    final script = jMap(draft['script']);
    final beats = jList(script['beats'], (m) => m);
    final slides = jList(draft['slides'], (m) => m);
    final lint = jMap(draft['copyLint']);
    final voice = jMap(draft['voice']);
    final unverified = jStrList(draft['unverifiedFigures']);
    final thread = jStrList(draft['thread']);
    final caption = jStrOr(draft['caption'], '');
    final hashtags = jStrList(draft['hashtags']);
    final title = jStr(draft['title']);

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (unverified.isNotEmpty)
        _Banner(
          color: AppTheme.warning,
          text: 'Check these figures before posting, they are not in your idea or brand profile: ${unverified.join(', ')}',
        ),
      _label('Hooks, best first'),
      for (final h in hooks)
        Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ScoreBadge(score: jInt(h['totalScore']) ?? 0),
            SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SelectableText(jStrOr(h['hook'], ''), style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                if (jStr(h['dealbreaker']) ?? jStr(h['formulaName']) case final note?) Text(note, style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
              ]),
            ),
          ]),
        ),
      if (jStrOr(draft['onScreenHook'], '').isNotEmpty) ...[_label('On-screen hook'), SelectableText(jStrOr(draft['onScreenHook'], ''), style: TextStyle(fontWeight: FontWeight.w700))],
      if (title != null && title.isNotEmpty) ...[
        _label('Title'),
        SelectableText(title, style: TextStyle(fontWeight: FontWeight.w700)),
        SizedBox(height: 6),
        CheckList(checks: jList(jMap(draft['titleLint'])['checks'], (m) => m)),
      ],
      if (beats.isNotEmpty) ...[
        _label('Script · ${(jDouble(script['totalSeconds']) ?? 0).toStringAsFixed(0)}s at ${jInt(script['wpm']) ?? 0} wpm'),
        for (final b in beats)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(
                width: 52,
                child: Text(jStrOr(b['timecode'], ''), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.accent, fontFeatures: const [FontFeature.tabularFigures()])),
              ),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SelectableText(jStrOr(b['spokenWords'], ''), style: TextStyle(fontSize: 14, height: 1.35)),
                  for (final f in jStrList(b['flags'])) Text(f, style: TextStyle(fontSize: 11, color: AppTheme.warning)),
                ]),
              ),
            ]),
          ),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
          onPressed: () => copyText(context, jStrOr(script['teleprompterText'], ''), 'Script'),
          icon: Icon(Icons.copy_rounded, size: 16),
          label: Text('Copy script'),
        ),
      ],
      if (slides.isNotEmpty) ...[
        _label('Slides'),
        for (var i = 0; i < slides.length; i++)
          Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${i + 2}. ${jStrOr(slides[i]['headline'], '')}', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              if (jStrOr(slides[i]['body'], '').isNotEmpty) Text(jStrOr(slides[i]['body'], ''), style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            ]),
          ),
      ],
      _label('Caption'),
      FeedPreview(lint: lint),
      SizedBox(height: 8),
      SelectableText(caption, style: TextStyle(fontSize: 13, height: 1.4)),
      if (hashtags.isNotEmpty) Padding(padding: EdgeInsets.only(top: 6), child: Text(hashtags.join(' '), style: TextStyle(fontSize: 13, color: AppTheme.accent))),
      SizedBox(height: 8),
      OutlinedButton.icon(
        style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
        onPressed: () => copyText(context, hashtags.isEmpty ? caption : '$caption\n\n${hashtags.join(' ')}', 'Caption'),
        icon: Icon(Icons.copy_rounded, size: 16),
        label: Text('Copy caption'),
      ),
      if (thread.length > 1) ...[
        _label('As a thread (${thread.length} posts)'),
        for (final t in thread) Padding(padding: EdgeInsets.only(bottom: 8), child: SelectableText(t, style: TextStyle(fontSize: 13))),
      ],
      _label('Checks'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ScoreBadge(score: jInt(lint['score']) ?? 0, label: 'copy'),
        if (jInt(voice['overallScore']) case final v?) ScoreBadge(score: v, label: 'human voice'),
      ]),
      SizedBox(height: 8),
      CheckList(checks: jList(lint['checks'], (m) => m).where((c) => jStr(c['status']) != 'PASS').toList()),
    ]);
  }
}

class _RepurposeResult extends StatelessWidget {
  const _RepurposeResult({required this.data, required this.onUse});
  final Json data;
  final void Function(String hook, String format) onUse;

  @override
  Widget build(BuildContext context) {
    final assets = jList(data['assets'], (m) => m);
    final dropped = jInt(data['dropped']) ?? 0;
    if (assets.isEmpty) {
      return Text('No standalone posts could be tied to an exact quote in this text. Try a longer or more specific source.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary));
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(
        '${assets.length} post ideas${dropped > 0 ? ' · $dropped dropped because they were not backed by your text' : ''}',
        style: TextStyle(fontSize: 12, color: AppTheme.textMuted, fontWeight: FontWeight.w600),
      ),
      SizedBox(height: 8),
      for (final a in assets)
        Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Container(
            padding: EdgeInsets.all(12),
            decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                StatusChip(label: jStrOr(a['format'], ''), color: AppTheme.accent),
                SizedBox(width: 6),
                StatusChip(label: jStrOr(a['type'], '').replaceAll('_', ' '), color: AppTheme.textSecondary),
                Spacer(),
                ScoreBadge(score: jInt(jMap(a['hook'])['totalScore']) ?? 0),
              ]),
              SizedBox(height: 8),
              SelectableText(jStrOr(jMap(a['hook'])['hook'], ''), style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              SizedBox(height: 4),
              Text(jStrOr(a['angle'], ''), style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
              SizedBox(height: 6),
              Text('From your text: "${jStrOr(a['sourceQuote'], '')}"', style: TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: AppTheme.textMuted)),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  style: TextButton.styleFrom(minimumSize: Size(44, 44)),
                  onPressed: () => onUse('${jStrOr(jMap(a['hook'])['hook'], '')}\n\n${jStrOr(a['angle'], '')}\n\nSource: ${jStrOr(a['sourceQuote'], '')}', jStrOr(a['format'], 'video')),
                  child: Text('Draft this'),
                ),
              ),
            ]),
          ),
        ),
    ]);
  }
}

/// What the feed shows before the fold, from a `copy/lint` result.
class FeedPreview extends StatelessWidget {
  const FeedPreview({super.key, required this.lint});
  final Json lint;

  @override
  Widget build(BuildContext context) {
    final truncated = jBool(lint['isTruncated']);
    return Container(
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppTheme.surfaceElevated, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppTheme.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('What the feed shows (first ${jInt(lint['foldChars']) ?? 0} characters)', style: TextStyle(fontSize: 11, color: AppTheme.textMuted, fontWeight: FontWeight.w700)),
        SizedBox(height: 6),
        Text.rich(TextSpan(children: [
          TextSpan(text: jStrOr(lint['feedCutout'], ''), style: TextStyle(fontSize: 14, color: AppTheme.textPrimary, height: 1.35)),
          if (truncated) TextSpan(text: ' ${jStrOr(lint['foldLabel'], '... more')}', style: TextStyle(fontSize: 14, color: AppTheme.textMuted)),
        ])),
      ]),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.color, required this.text});
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: EdgeInsets.only(bottom: 4),
        padding: EdgeInsets.all(12),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12), border: Border.all(color: color.withValues(alpha: 0.5))),
        child: Text(text, style: TextStyle(fontSize: 12, color: AppTheme.textPrimary)),
      );
}

Widget _label(String text) => Padding(
      padding: EdgeInsets.only(top: 14, bottom: 6),
      child: Text(text.toUpperCase(), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: AppTheme.textMuted)),
    );
