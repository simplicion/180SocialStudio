import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/util/json.dart';
import '../../core/widgets/common.dart';
import 'cc_widgets.dart';
import 'create_tab.dart' show FeedPreview;
import '../projects/project_provider.dart';
import 'check_results.dart';

/// Rule-based checks for one platform. No AI involved: every score is computed from the text or numbers typed in,
/// so the same input always gives the same result.
/// Tool ids for [CheckTab.tools]: hook, reaction, caption, script, voice, profile, result.
const checkToolIds = ['hook', 'reaction', 'caption', 'script', 'voice', 'profile', 'result'];

class CheckTab extends ConsumerStatefulWidget {
  const CheckTab({super.key, required this.platform, this.tools, this.projectId});
  final String platform;

  /// Only these tools (null = all). Trend Lab's Check My Content opens one tool at a time.
  final Set<String>? tools;

  /// Project for the reaction simulator and connected-account audit (defaults to the active project).
  final String? projectId;

  @override
  ConsumerState<CheckTab> createState() => _CheckTabState();
}

class _CheckTabState extends ConsumerState<CheckTab> with AutomaticKeepAliveClientMixin {
  final _hook = TextEditingController();
  final _caption = TextEditingController();
  final _title = TextEditingController();
  final _script = TextEditingController();
  final _voice = TextEditingController();
  final _handle = TextEditingController();
  final _name = TextEditingController();
  final _bio = TextEditingController();
  final _about = TextEditingController();
  final _link = TextEditingController();
  final _views = TextEditingController();
  final _median = TextEditingController();
  final _shares = TextEditingController();
  final _hold = TextEditingController();
  final _react = TextEditingController();
  bool _spoken = true;
  bool? _photo;
  bool? _banner;
  String _reactKind = 'hook';

  late final _all = [_hook, _caption, _title, _script, _voice, _handle, _name, _bio, _about, _link, _views, _median, _shares, _hold, _react];

  bool _on(String id) => widget.tools == null || widget.tools!.contains(id);

  String? get _projectId => widget.projectId ?? ref.read(activeProjectProvider).valueOrNull?.id;

  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() {
    for (final c in _all) {
      c.dispose();
    }
    super.dispose();
  }

  Future<Json?> _tool(String tool, Json body, {required TextEditingController needs, required String hint}) async {
    if (needs.text.trim().isEmpty) {
      showInfo(context, hint);
      return null;
    }
    return ref.read(socialApiProvider).platformTool(widget.platform, tool, body);
  }

  String get _bioLabel => switch (widget.platform) { 'linkedin' => 'Headline', 'youtube' => 'Channel description', 'facebook' => 'Intro', _ => 'Bio' };

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final label = platformLabel(widget.platform);
    return ListView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        if (_on('hook')) ToolCard(
          title: 'Hook score',
          subtitle: 'Length, specifics, stakes, front-loading and who it speaks to. One hook per line to compare.',
          children: [
            TextField(controller: _hook, minLines: 2, maxLines: 5, decoration: fieldDecoration('Hook or opening line')),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('Spoken on camera', style: TextStyle(fontSize: 14)),
              subtitle: Text(_spoken ? 'Must be sayable in under 3 seconds' : 'First line of a text post', style: TextStyle(fontSize: 12)),
              value: _spoken,
              onChanged: (v) => setState(() => _spoken = v),
            ),
            ToolRunner(
              label: 'Score',
              run: () => _tool('hooks/score', {'hooks': _hook.text.split('\n').map((l) => l.trim()).where((l) => l.isNotEmpty).toList(), 'spoken': _spoken},
                  needs: _hook, hint: 'Type a hook first.'),
              result: (_, d) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (final h in jList(d['ranked'], (m) => m))
                  Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        ScoreBadge(score: jInt(h['totalScore']) ?? 0, label: jStrOr(h['grade'], '').toLowerCase()),
                        SizedBox(width: 10),
                        Expanded(child: Text(jStrOr(h['hook'], ''), style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                      ]),
                      if (jStr(h['formulaName']) case final f?) Padding(padding: EdgeInsets.only(top: 4), child: Text('Shape: $f', style: TextStyle(fontSize: 12, color: AppTheme.textMuted))),
                      for (final r in jStrList(h['recommendations']))
                        Padding(padding: EdgeInsets.only(top: 4), child: Text('• $r', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
                    ]),
                  ),
              ]),
            ),
          ],
        ),
        if (_on('reaction')) ToolCard(
          title: 'Audience reaction simulator',
          subtitle: 'Five people from your audience react to it: would they stop, finish, save or skip. Calibrated on your own results once you have 30 posts with numbers.',
          children: [
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: const [ButtonSegment(value: 'hook', label: Text('Hook')), ButtonSegment(value: 'caption', label: Text('Caption')), ButtonSegment(value: 'script', label: Text('Script'))],
              selected: {_reactKind},
              onSelectionChanged: (s) => setState(() => _reactKind = s.first),
            ),
            SizedBox(height: 12),
            TextField(controller: _react, minLines: _reactKind == 'hook' ? 2 : 5, maxLines: _reactKind == 'hook' ? 4 : 12, decoration: fieldDecoration(_reactKind == 'hook' ? 'Hook or opening line' : _reactKind == 'caption' ? 'Caption' : 'Script')),
            SizedBox(height: 12),
            ToolRunner(
              label: 'Simulate reactions',
              ai: true,
              run: () => _tool('check/reaction', {'kind': _reactKind, 'text': _react.text, 'projectId': ?_projectId}, needs: _react, hint: 'Paste what you want to test first.'),
              result: (_, d) => ReactionResult(data: d),
            ),
          ],
        ),
        if (_on('caption')) ToolCard(
          title: '$label caption check',
          subtitle: 'What shows before the fold, length, hashtags, links and the ask, by $label\'s rules.',
          children: [
            if (widget.platform == 'youtube') ...[TextField(controller: _title, decoration: fieldDecoration('Video title')), SizedBox(height: 12)],
            TextField(controller: _caption, minLines: 4, maxLines: 10, decoration: fieldDecoration(widget.platform == 'youtube' ? 'Description' : 'Caption or post')),
            SizedBox(height: 12),
            ToolRunner(
              label: 'Check',
              run: () => _tool('copy/lint', {'caption': _caption.text, if (_title.text.trim().isNotEmpty) 'title': _title.text.trim()}, needs: _caption, hint: 'Paste the caption first.'),
              result: (context, d) {
                final thread = jStrList(d['thread']);
                final titleChecks = jList(jMap(d['titleLint'])['checks'], (m) => m);
                return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    ScoreBadge(score: jInt(d['score']) ?? 0),
                    SizedBox(width: 10),
                    Text('${jInt(d['weightedLength']) ?? 0}/${jInt(d['maxChars']) ?? 0} chars · ${jStrList(d['hashtags']).length}/${jInt(d['hashtagMax']) ?? 0} hashtags',
                        style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                  ]),
                  SizedBox(height: 10),
                  FeedPreview(lint: d),
                  SizedBox(height: 10),
                  if (titleChecks.isNotEmpty) CheckList(checks: titleChecks),
                  CheckList(checks: jList(d['checks'], (m) => m)),
                  if (thread.length > 1) ...[
                    Text('Split into ${thread.length} posts', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textMuted)),
                    SizedBox(height: 6),
                    for (final t in thread) Padding(padding: EdgeInsets.only(bottom: 8), child: SelectableText(t, style: TextStyle(fontSize: 13))),
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
                      onPressed: () => copyText(context, thread.join('\n\n'), 'Thread'),
                      child: Text('Copy thread'),
                    ),
                  ],
                ]);
              },
            ),
          ],
        ),
        if (_on('script')) ToolCard(
          title: 'Script timing',
          subtitle: 'Times each line at $label\'s speaking pace and flags a slow hook, long lines with no cut, and a missing loop.',
          children: [
            TextField(controller: _script, minLines: 4, maxLines: 12, decoration: fieldDecoration('Script, one beat per line')),
            SizedBox(height: 12),
            ToolRunner(
              label: 'Time it',
              run: () => _tool('beat-sheet', {'script': _script.text}, needs: _script, hint: 'Paste the script first.'),
              result: (_, d) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('${(jDouble(d['totalSeconds']) ?? 0).toStringAsFixed(1)}s · ${jInt(d['totalWords']) ?? 0} words · hook ${(jDouble(d['hookDurationSec']) ?? 0).toStringAsFixed(1)}s',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                SizedBox(height: 8),
                for (final b in jList(d['beats'], (m) => m))
                  Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      SizedBox(width: 52, child: Text(jStrOr(b['timecode'], ''), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.accent))),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(jStrOr(b['text'], ''), style: TextStyle(fontSize: 13)),
                          for (final f in jStrList(b['flags'])) Text(f, style: TextStyle(fontSize: 11, color: AppTheme.warning)),
                        ]),
                      ),
                      Text('${(jDouble(b['durationSec']) ?? 0).toStringAsFixed(1)}s', style: TextStyle(fontSize: 11, color: AppTheme.textMuted)),
                    ]),
                  ),
                if (!jBool(d['loopDetected']) && jList(d['beats'], (m) => m).length > 2)
                  Text('No loop: end on a word from the hook so the replay is seamless.', style: TextStyle(fontSize: 12, color: AppTheme.warning)),
              ]),
            ),
          ],
        ),
        if (_on('voice')) ToolCard(
          title: 'Human voice',
          subtitle: 'Removes hidden characters, dashes and stock AI phrases, then scores how human the text reads.',
          children: [
            TextField(controller: _voice, minLines: 4, maxLines: 10, decoration: fieldDecoration('Text to clean')),
            SizedBox(height: 12),
            ToolRunner(
              label: 'Clean it',
              run: () => _tool('humanize', {'text': _voice.text}, needs: _voice, hint: 'Paste some text first.'),
              result: (context, d) {
                final cleaned = jStrOr(jMap(d['cleaned'])['cleanedText'], '');
                final after = jMap(d['after']);
                return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    ScoreBadge(score: jInt(jMap(d['before'])['overallScore']) ?? 0, label: 'before'),
                    ScoreBadge(score: jInt(after['overallScore']) ?? 0, label: 'after'),
                    Text('${jInt(jMap(d['cleaned'])['totalCleaned']) ?? 0} changes', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                  ]),
                  SizedBox(height: 10),
                  SelectableText(cleaned, style: TextStyle(fontSize: 13, height: 1.4)),
                  for (final r in jStrList(after['recommendations']))
                    Padding(padding: EdgeInsets.only(top: 6), child: Text('• $r', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary))),
                  SizedBox(height: 8),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(minimumSize: Size.fromHeight(44)),
                    onPressed: () => copyText(context, cleaned, 'Cleaned text'),
                    child: Text('Copy cleaned text'),
                  ),
                ]);
              },
            ),
          ],
        ),
        if (_on('profile')) ToolCard(
          title: '$label profile audit',
          subtitle: 'Scores only the fields you fill in, and lists what to fix first.',
          children: [
            if (widget.platform != 'linkedin') ...[
              ToolRunner(
                label: 'Use my connected account',
                run: () async {
                  final pid = _projectId;
                  if (pid == null) {
                    showInfo(context, 'Open a project first.');
                    return null;
                  }
                  return ref.read(socialApiProvider).platformTool(widget.platform, 'profile/audit-connected', {'projectId': pid});
                },
                result: (_, d) => ConnectedAuditResult(data: d),
              ),
              Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('Or fill it in by hand:', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
              ),
            ],
            TextField(controller: _handle, decoration: fieldDecoration('Handle')),
            SizedBox(height: 12),
            TextField(controller: _name, decoration: fieldDecoration(widget.platform == 'youtube' ? 'Channel name' : widget.platform == 'facebook' ? 'Page name' : 'Display name')),
            SizedBox(height: 12),
            TextField(controller: _bio, minLines: 2, maxLines: 5, decoration: fieldDecoration(_bioLabel)),
            if (widget.platform == 'linkedin' || widget.platform == 'facebook') ...[
              SizedBox(height: 12),
              TextField(controller: _about, minLines: 2, maxLines: 6, decoration: fieldDecoration('About')),
            ],
            SizedBox(height: 12),
            TextField(controller: _link, decoration: fieldDecoration('Link (leave empty if none)')),
            _TriState(label: 'Profile photo set', value: _photo, onChanged: (v) => setState(() => _photo = v)),
            _TriState(label: 'Banner or cover set', value: _banner, onChanged: (v) => setState(() => _banner = v)),
            SizedBox(height: 8),
            ToolRunner(
              label: 'Audit profile',
              run: () => _tool(
                  'profile/audit',
                  {
                    'handle': _handle.text.trim(),
                    if (_name.text.trim().isNotEmpty) 'displayName': _name.text.trim(),
                    if (_bio.text.trim().isNotEmpty) 'bio': _bio.text.trim(),
                    if (_about.text.trim().isNotEmpty) 'about': _about.text.trim(),
                    if (_bio.text.trim().isNotEmpty || _name.text.trim().isNotEmpty) 'linkUrl': _link.text.trim(),
                    'hasProfilePhoto': ?_photo,
                    'hasBanner': ?_banner,
                  },
                  needs: _handle,
                  hint: 'Enter the handle first.'),
              result: (_, d) {
                final items = jList(d['items'], (m) => m);
                if (items.isEmpty) return Text('Fill in the name and bio to get a score.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary));
                return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Align(alignment: Alignment.centerLeft, child: ScoreBadge(score: jInt(d['totalScore']) ?? 0, label: '${items.length} fields scored')),
                  SizedBox(height: 10),
                  for (final i in items)
                    Padding(
                      padding: EdgeInsets.only(bottom: 10),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Icon(statusIcon(jStrOr(i['status'], 'FAIL')), size: 16, color: statusColor(jStrOr(i['status'], 'FAIL'))),
                        SizedBox(width: 8),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${jStrOr(i['name'], '')} · ${jInt(i['awardedPoints']) ?? 0}/${jInt(i['maxPoints']) ?? 0}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                            Text(jStrOr(i['feedback'], ''), style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                          ]),
                        ),
                      ]),
                    ),
                ]);
              },
            ),
          ],
        ),
        if (_on('result')) ToolCard(
          title: 'Post result check',
          subtitle: 'Type the numbers from $label\'s insights for one post. Only the numbers you enter are judged.',
          children: [
            Row(children: [
              Expanded(child: TextField(controller: _views, keyboardType: TextInputType.number, decoration: fieldDecoration('Views'))),
              SizedBox(width: 8),
              Expanded(child: TextField(controller: _median, keyboardType: TextInputType.number, decoration: fieldDecoration('Your usual views'))),
            ]),
            SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: _shares, keyboardType: TextInputType.number, decoration: fieldDecoration('Shares'))),
              SizedBox(width: 8),
              Expanded(child: TextField(controller: _hold, keyboardType: TextInputType.number, decoration: fieldDecoration('% past 3s'))),
            ]),
            SizedBox(height: 12),
            ToolRunner(
              label: 'Read the result',
              run: () => _tool(
                  'posts/audit',
                  {
                    'views': num.tryParse(_views.text.trim()),
                    'medianViews': ?num.tryParse(_median.text.trim()),
                    'shares': ?num.tryParse(_shares.text.trim()),
                    'holdAt3sPercent': ?num.tryParse(_hold.text.trim()),
                  },
                  needs: _views,
                  hint: 'Enter the views first.'),
              result: (_, d) {
                final findings = jStrList(d['findings']);
                return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    if (jDouble(d['outlierMultiple']) case final m?) StatTile(label: 'vs your usual', value: '${m}x', color: m >= 3 ? AppTheme.success : null),
                    if (jDouble(d['sharesPer1k']) case final s?) StatTile(label: 'shares per 1,000', value: '$s'),
                  ]),
                  SizedBox(height: 8),
                  if (findings.isEmpty)
                    Text('Add your usual views, shares or the 3-second hold to get a diagnosis.', style: TextStyle(fontSize: 13, color: AppTheme.textSecondary))
                  else
                    for (final f in findings) Padding(padding: EdgeInsets.only(bottom: 6), child: Text('• $f', style: TextStyle(fontSize: 13))),
                ]);
              },
            ),
          ],
        ),
      ],
    );
  }
}

/// Yes / No / Not sure. "Not sure" leaves the field out of the score.
class _TriState extends StatelessWidget {
  const _TriState({required this.label, required this.value, required this.onChanged});
  final String label;
  final bool? value;
  final ValueChanged<bool?> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: 12),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(fontSize: 14))),
          SegmentedButton<int>(
            showSelectedIcon: false,
            segments: const [ButtonSegment(value: 1, label: Text('Yes')), ButtonSegment(value: 0, label: Text('No')), ButtonSegment(value: -1, label: Text('Skip'))],
            selected: {value == null ? -1 : value! ? 1 : 0},
            onSelectionChanged: (s) => onChanged(s.first == -1 ? null : s.first == 1),
          ),
        ]),
      );
}
