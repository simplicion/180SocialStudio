// The same footage as real_edit_demo_test.dart, edited ONLY by the AI Director, through the real app path:
// StudioController.load (on-device analysis + server transcription) → askDirector (POST /ai-direct, platform AI
// key resolved by the backend) → startExport (stock media resolved/downloaded, Media3 render on the phone).
//
// Host pushes to <ext>/test_assets: interview.mp4 and session.json ({accessToken, refreshToken} of a dev test user).
// Backend: a local dev server reachable from the emulator at API_BASE (default http://10.0.2.2:4002).
// Evidence: <ext>/evidence/director_edit.mp4, director_edit_ir.json, director_report.json.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:social_studio_mobile/core/media/asset_cache.dart';
import 'package:social_studio_mobile/core/native_engine/media_engine_service.dart';
import 'package:social_studio_mobile/core/network/api_client.dart';
import 'package:social_studio_mobile/core/network/audio_transcription_service.dart';
import 'package:social_studio_mobile/core/network/device_registration.dart';
import 'package:social_studio_mobile/core/storage/key_value_store.dart';
import 'package:social_studio_mobile/core/storage/token_store.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/studio/studio_controller.dart';

const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:4002');

/// The whole brief, in one message, the way a creator would type it.
const prompt = 'Turn this interview into a punchy ~30 second vertical Reel. Open on her strongest line, cut the pauses, '
    'filler words and the interviewer\'s question, add a short hook title and bold word-by-word captions, a couple of '
    'punch-in zooms on key phrases, a space B-roll cutaway, one fitting sticker, a light colour grade and calm '
    'background music ducked under her voice.';

Future<void> until(bool Function() done, Duration max) async {
  final end = DateTime.now().add(max);
  while (!done() && DateTime.now().isBefore(end)) {
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('AI Director only: talking-head interview → 9:16 Reel', (tester) async {
    final ext = (await getExternalStorageDirectory())!;
    final dir = '${ext.path}/test_assets';
    Directory(dir).createSync(recursive: true);
    File('$dir/.waiting').writeAsStringSync('1');
    await until(() => ['interview.mp4', 'session.json', '.ready'].every((n) => File('$dir/$n').existsSync()), const Duration(minutes: 3));
    final evidence = Directory('${ext.path}/evidence')..createSync(recursive: true);
    final report = <String, dynamic>{};
    void save() => File('${evidence.path}/director_report.json').writeAsStringSync(const JsonEncoder.withIndent(' ').convert(report));

    final session = jsonDecode(File('$dir/session.json').readAsStringSync()) as Map<String, dynamic>;
    final tokens = TokenStore(InMemoryKeyValueStore());
    await tokens.saveSession(accessToken: session['accessToken'] as String, refreshToken: session['refreshToken'] as String?);
    final api = ApiClient(tokens: tokens, baseUrl: apiBase);
    final device = DeviceRegistration(api);
    final c = StudioController(director: AiDirectorService(api, device), transcriber: AudioTranscriptionService(api, device));

    final sw = Stopwatch()..start();
    await c.load('$dir/interview.mp4');
    // The app's own analysis: transcription (server), faces, silences, beats, scenes run in the background.
    await until(() => c.transcriptState == TranscriptState.ready || c.transcriptState == TranscriptState.failed, const Duration(minutes: 4));
    await until(() => c.faces != null && c.silences != null, const Duration(minutes: 2));
    report['analysis'] = {
      'ms': sw.elapsedMilliseconds,
      'transcript': c.transcriptState.name,
      'transcriptError': c.transcriptError?.toString(),
      'words': c.words.length,
      'faces': c.faces?.length,
      'silences': c.silences?.length,
    };
    save();

    sw.reset();
    await c.askDirector(prompt);
    final reply = c.messages.last;
    final r = reply.response;
    report['director'] = {
      'ms': sw.elapsedMilliseconds,
      'reply': reply.text,
      'applied': reply.applied,
      if (r != null) ...{
        'planner': r.plannerSource,
        'plannerReason': r.plannerReason,
        'summary': r.summary,
        'operations': r.operations.map((o) => o['type'] ?? o['op'] ?? o['tool']).toList(),
        'appliedOperations': r.appliedOperations,
        'rejectedOperations': r.rejectedOperations,
        'warnings': r.warnings,
        'requiresConfirmation': r.requiresConfirmation,
      },
    };
    save();
    expect(r, isNotNull, reason: 'Director failed: ${reply.text}');
    // A plan that asks for confirmation is accepted the way the user would tap "Apply".
    if (!reply.applied && r!.requiresConfirmation) c.applyProposal(c.messages.length - 1);
    final ir = c.ir!;
    File('${evidence.path}/director_edit_ir.json').writeAsStringSync(const JsonEncoder.withIndent(' ').convert(ir.toJson()));
    report['timeline'] = {
      'durationMs': ir.durationMs,
      'clips': ir.clips.length,
      'captions': ir.captions.length,
      'overlays': ir.overlays.map((o) => '${o.mediaType}:${o.source['kind']}').toList(),
      'zooms': ir.zooms.length,
      'effects': ir.effects.map((e) => e.type).toList(),
      'music': ir.audio.music.length,
      'sfx': ir.audio.sfx.length,
    };
    save();

    sw.reset();
    await c.startExport();
    await until(() => !(c.export?.running ?? false), const Duration(minutes: 20));
    final ex = c.export!;
    report['export'] = {
      'ms': sw.elapsedMilliseconds,
      'error': ex.error?.toString(),
      'warnings': ex.warnings,
      'credits': ex.credits,
      'output': ex.result?.outputPath,
    };
    // A new file (copySync keeps the app-private mode, which adb cannot read).
    if (ex.result != null) File('${evidence.path}/director_edit.mp4').writeAsBytesSync(File(ex.result!.outputPath).readAsBytesSync());
    if (ex.error != null) {
      // What the export actually read for each overlay (resolved URL → cached file → the phone's probe).
      report['overlayFiles'] = [
        for (final o in c.ir!.overlays)
          await () async {
            final url = o.source['url'] as String?;
            final path = url == null ? null : AssetCache.instance.cachedPath(url);
            Object? probe;
            if (path != null) {
              try {
                final m = await MediaEngineService.getVideoInfo(path);
                probe = {'durationMs': m.durationMs, 'w': m.displayWidth, 'h': m.displayHeight, 'hasVideo': m.hasVideo};
              } catch (e) {
                probe = '$e';
              }
            }
            return {'id': o.id, 'mediaType': o.mediaType, 'source': o.source, 'sourceStartMs': o.sourceStartMs, 'path': path,
              'bytes': path == null ? null : File(path).lengthSync(), 'probe': probe};
          }(),
      ];
    }
    save();
    // ignore: avoid_print
    print('DIRECTOR_REPORT ${jsonEncode(report)}');

    File('${evidence.path}/.done').writeAsStringSync('1');
    await until(() => File('${evidence.path}/.pulled').existsSync(), const Duration(minutes: 2));
    expect(ex.error, isNull);
  });
}
