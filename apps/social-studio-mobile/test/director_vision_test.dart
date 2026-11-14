import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/director/vision_service.dart';
import 'package:social_studio_mobile/features/studio/director_panel.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// AI Director quality-fix plan, Phase 2: stills are looked at only with consent; the ShotLog rides with each turn.
void main() {
  test('keyframe times match the server algorithm (one per scene + every 2 s, capped at 60)', () {
    final t = keyframeTimesMs(10000, [3100, 7000]);
    expect(t, [...t]..sort());
    expect(t, containsAll([3400, 7300]));
    expect(t.every((x) => x < 10000), isTrue);
    expect(keyframeTimesMs(30 * 60 * 1000, const []).length, 60);
    expect(keyframeTimesMs(300, const []), [200]);
    // Same values as packages/video-contracts keyframeTimesMs(10000, [3100, 7000]).
    expect(t, [500, 2500, 3400, 4500, 6500, 7300, 8500]);
  });

  test('stills are at most 512 px on the long side', () {
    expect(frameWidthFor(1920, 1080), 512);
    expect(frameWidthFor(1080, 1920), 288);
    expect(frameWidthFor(320, 240), 320);
  });

  test('the ShotLog is sent with the media analysis', () {
    final log = {'version': 'shotlog/1', 'assetId': 'primary', 'sourceHash': 'abcdef0123', 'durationMs': 5000, 'model': 'm', 'frameCount': 0, 'shots': []};
    final j = MediaAnalysis(durationMs: 5000, width: 1080, height: 1920, shotLog: log).toJson();
    expect(j['shotLog'], log);
    expect(MediaAnalysis(durationMs: 5000, width: 1080, height: 1920).toJson().containsKey('shotLog'), isFalse);
    expect(ShotLogService.isValid(log), isTrue);
    expect(ShotLogService.isValid({'version': 'shotlog/9', 'shots': []}), isFalse);
  });

  test('consent: not asked, then remembered on the device', () async {
    SharedPreferences.setMockInitialValues({});
    expect(await VisionConsent.read(), isNull);
    await VisionConsent.write(true);
    expect(await VisionConsent.read(), isTrue);
    await VisionConsent.write(false);
    expect(await VisionConsent.read(), isFalse);
  });

  test('the file hash ignores the path and changes with the content', () async {
    final dir = await Directory.systemTemp.createTemp('vision_hash');
    final a = File('${dir.path}/a.mp4')..writeAsBytesSync(List.filled(1000, 1));
    final b = File('${dir.path}/b.mp4')..writeAsBytesSync(List.filled(1000, 1));
    final c = File('${dir.path}/c.mp4')..writeAsBytesSync(List.filled(1000, 2));
    expect(await sourceHash(a.path), await sourceHash(b.path));
    expect(await sourceHash(a.path), isNot(await sourceHash(c.path)));
    expect(await sourceHash('${dir.path}/missing.mp4'), isNull);
    await dir.delete(recursive: true);
  });

  testWidgets('the consent card explains the stills and reports the choice', (tester) async {
    bool? choice;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: VisionConsentCard(onAllow: () => choice = true, onDecline: () => choice = false)),
    ));
    expect(find.byKey(const ValueKey('director-vision-consent')), findsOneWidget);
    expect(find.textContaining('never the video itself'), findsOneWidget);
    expect(find.textContaining('deleted right away'), findsOneWidget);
    await tester.tap(find.text('Allow'));
    expect(choice, isTrue);
    await tester.tap(find.text('Not now'));
    expect(choice, isFalse);
  });

  // ── Phase 5: the visual check ─────────────────────────────────────────────────────────────────
  final ir = TimelineOps.initial(projectId: 'p', durationMs: 5000, width: 1080, height: 1920).toJson();

  test('checkpoints and the repair round are read from the response', () {
    final r = DirectorResponse.fromData({
      'plannerSource': 'llm',
      'summary': 'ok',
      'editIR': ir,
      'checkpoints': [
        {'tMs': 100, 'kind': 'hook', 'label': 'the opening (hook)', 'refs': []},
        {'tMs': 2400, 'kind': 'zoom', 'label': 'zoom 1.40x', 'refs': ['z1']},
      ],
      'visualRound': 1,
    });
    expect(r.checkpoints.length, 2);
    expect(r.checkpoints[1]['refs'], ['z1']);
    expect(r.visualRound, 1);
    final old = DirectorResponse.fromData({'plannerSource': 'llm', 'summary': 'ok', 'editIR': ir});
    expect(old.checkpoints, isEmpty);
    expect(old.visualRound, 0);
  });

  test('a repair turn carries the critique; normal turns do not', () {
    final media = MediaAnalysis(durationMs: 5000, width: 1080, height: 1920);
    final critique = {'round': 1, 'critique': {'score': 6.5, 'issues': []}};
    final repair = AiDirectorService.buildRequest(prompt: 'make it punchy', history: const [], media: media, visualCritique: critique);
    expect(repair['visualCritique'], critique);
    expect(AiDirectorService.buildRequest(prompt: 'x', history: const [], media: media).containsKey('visualCritique'), isFalse);
  });

  test('only critical and major issues trigger a repair', () {
    final c = {
      'score': 7,
      'issues': [
        {'severity': 'critical', 'kind': 'caption_over_face'},
        {'severity': 'major', 'kind': 'zoom_crops_head'},
        {'severity': 'minor', 'kind': 'color_inconsistent'},
      ],
    };
    expect(ShotLogService.repairableIssues(c).map((i) => i['kind']), ['caption_over_face', 'zoom_crops_head']);
    expect(ShotLogService.repairableIssues({'score': 9, 'issues': []}), isEmpty);
  });
}
