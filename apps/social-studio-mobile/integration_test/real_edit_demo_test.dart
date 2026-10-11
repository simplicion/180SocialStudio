// A real creator edit made with the manual editor (TimelineOps — the same pure ops the Studio buttons call) and
// rendered by the on-device Media3 engine. Companion to the AI-Director-only run of the same footage.
//
// Fixtures (pushed by the host after install, see tool/run_render_tests.sh pattern) in <ext>/test_assets:
//   interview.mp4  NASA astronaut Anne McClain, KOMO-TV ISS downlink (public domain), 45 s, 1280x720 + AAC
//   words.json     word timings of interview.mp4 ({"words":[{text,startMs,endMs}]})
//   broll.mp4      Pexels 7169782 "a woman wearing a space helmet" (Pexels licence), 720x1366
//   music.mp3      ccMixter "Persephone" by snowflake (CC BY 2.5)
//   sticker.png    Microsoft Fluent Emoji 3D "Rocket" (MIT)
// Evidence (manual_edit.mp4, manual_edit_ir.json, report) goes to <ext>/evidence.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('manual edit: talking-head interview → 9:16 Reel', (tester) async {
    final ext = (await getExternalStorageDirectory())!;
    final dir = '${ext.path}/test_assets';
    Directory(dir).createSync(recursive: true);
    File('$dir/.waiting').writeAsStringSync('1');
    final names = ['interview.mp4', 'words.json', 'broll.mp4', 'music.mp3', 'sticker.png'];
    final deadline = DateTime.now().add(const Duration(minutes: 3));
    while (!(names.every((n) => File('$dir/$n').existsSync()) && File('$dir/.ready').existsSync()) && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    final evidence = Directory('${ext.path}/evidence')..createSync(recursive: true);

    final info = await MediaEngineService.getVideoInfo('$dir/interview.mp4');
    final words = [
      for (final w in (jsonDecode(File('$dir/words.json').readAsStringSync())['words'] as List)) TranscriptWord.fromJson(w as Map<String, dynamic>),
    ];
    final log = <String>[];
    final sw = Stopwatch()..start();

    // 1. Import → 9:16 project, reframed on the astronaut (centre of the frame, face in the upper third).
    var ir = TimelineOps.initial(
      projectId: 'manual-edit-demo',
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      words: words,
      focus: (x: 0.5, y: 0.3),
    );
    log.add('import ${info.width}x${info.height} ${info.durationMs}ms → 9:16');

    // 2. Cut the pauses, the filler "you know", the interviewer's question and the dead air (from the end backwards
    //    so earlier timeline times still equal source times).
    for (final r in const [[42700, 45000], [25000, 36700], [16400, 16950], [11850, 12400], [4990, 5950], [0, 800]]) {
      ir = TimelineOps.removeRange(ir, r[0], r[1]);
      log.add('cut ${r[0]}–${r[1]}');
    }
    // 3. Re-order: open on the strongest line (aboard the ISS), then the lab, then home, then Washington from orbit.
    ir = TimelineOps.moveClip(ir, 2, 0);
    ir = TimelineOps.moveClip(ir, 3, 1);
    log.add('reorder → ${ir.clips.map((c) => '${c.sourceStartMs}').join(', ')}');
    expect(ir.clips.map((c) => c.sourceStartMs).toList(), [12400, 16950, 800, 5950, 36700]);

    int at(int sourceMs) => TimelineOps.sourceToTimeline(ir, sourceMs)!;

    // 4. Look: gentle grade on every clip, a crossfade where the story turns to "home", a flash into the last beat.
    ir = TimelineOps.setFilter(ir, EditIrFilter(contrast: 1.08, saturation: 1.12, temperature: 0.12, vignette: 0.25));
    ir = TimelineOps.setTransition(ir, EditIrTransition(type: 'CROSSFADE', durationMs: 300), index: 2);
    ir = TimelineOps.addEffect(ir, 'flash', startMs: ir.clips[4].timelineStartMs);
    // 5. Hook title, word captions, punch-ins on the key phrases.
    ir = TimelineOps.addText(ir, '6 MONTHS IN SPACE', startMs: 0, durationMs: 2800, positionY: 0.14);
    ir = TimelineOps.autoCaptions(ir, words, preset: 'BOLD_POP', highlightColor: '#FFD400', positionY: 0.7);
    ir = TimelineOps.addZoom(ir, startMs: at(13500), durationMs: 1800, scale: 1.25, centerX: 0.5, centerY: 0.32);
    ir = TimelineOps.addZoom(ir, startMs: at(40240), durationMs: 1600, scale: 1.3, centerX: 0.5, centerY: 0.32);
    // 6. B-roll cutaway on "national orbiting laboratory", a 3D rocket sticker on the hook.
    ir = TimelineOps.addBroll(ir, {'kind': 'url', 'url': 'https://www.pexels.com/video/7169782/'}, startMs: at(17380), durationMs: 2600);
    ir = TimelineOps.addSticker(ir, {'kind': 'url', 'url': 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/Rocket/3D/rocket_3d.png'},
        startMs: 300, durationMs: 2500);
    // 7. Music under the voice, ducked on speech.
    ir = TimelineOps.setMusic(ir, url: 'https://ccmixter.org/content/snowflake/snowflake_-_Persephone.mp3', title: 'Persephone — snowflake (CC BY)', volumeDb: -18);
    ir = ir.copyWith(
      audio: EditIrAudio(
        originalVolumeDb: ir.audio.originalVolumeDb,
        music: ir.audio.music,
        speechRangesMs: TimelineOps.speechRanges(words, ir),
        sfx: ir.audio.sfx,
        voiceovers: ir.audio.voiceovers,
      ),
    );
    final editMs = sw.elapsedMilliseconds;
    File('${evidence.path}/manual_edit_ir.json').writeAsStringSync(const JsonEncoder.withIndent(' ').convert(ir.toJson()));

    // 8. Export on the phone.
    final broll = ir.overlays.firstWhere((o) => o.id.startsWith('b'));
    final sticker = ir.overlays.firstWhere((o) => o.id.startsWith('st'));
    final out = '${evidence.path}/manual_edit.mp4';
    RenderResult? result;
    sw.reset();
    await for (final p in MediaEngineService.renderEditIr(
      editIr: ir,
      outputPath: out,
      assetPaths: {'primary': '$dir/interview.mp4'},
      overlayPaths: {broll.id: '$dir/broll.mp4', sticker.id: '$dir/sticker.png'},
      musicPaths: {ir.audio.music.first.id: '$dir/music.mp3'},
    )) {
      if (p.result != null) result = p.result;
    }
    final renderMs = sw.elapsedMilliseconds;
    final outInfo = await MediaEngineService.getVideoInfo(out);
    final report = {
      'ops': log,
      'durationMs': ir.durationMs,
      'clips': ir.clips.length,
      'captions': ir.captions.length,
      'overlays': ir.overlays.length,
      'zooms': ir.zooms.length,
      'effects': ir.effects.length,
      'speechRanges': ir.audio.speechRangesMs.length,
      'editMs': editMs,
      'renderMs': renderMs,
      'output': {'w': outInfo.displayWidth, 'h': outInfo.displayHeight, 'rotation': outInfo.rotation, 'durationMs': outInfo.durationMs, 'bytes': File(out).lengthSync()},
    };
    File('${evidence.path}/manual_edit_report.json').writeAsStringSync(const JsonEncoder.withIndent(' ').convert(report));
    // ignore: avoid_print
    print('MANUAL_EDIT_REPORT ${jsonEncode(report)}');
    // Hand the evidence to the host before `flutter test` uninstalls the app (the host touches .pulled).
    File('${evidence.path}/.done').writeAsStringSync('1');
    final pullBy = DateTime.now().add(const Duration(minutes: 2));
    while (!File('${evidence.path}/.pulled').existsSync() && DateTime.now().isBefore(pullBy)) {
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    expect(result, isNotNull);
    expect(outInfo.displayWidth, 1080);
    expect(outInfo.displayHeight, 1920);
    expect((outInfo.durationMs - ir.durationMs).abs(), lessThan(400));
  });
}
