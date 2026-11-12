import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/studio/director_panel.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// AI Director quality-fix plan, Phase 0: an edit made by the offline rules (not the AI model) is clearly labelled.
void main() {
  final ir = TimelineOps.initial(projectId: 'p', durationMs: 5000, width: 1080, height: 1920).toJson();

  test('plannerFallback is parsed and marks the turn as a fallback', () {
    final r = DirectorResponse.fromData({
      'plannerSource': 'deterministic',
      'plannerReason': 'LLM call failed (gemini/gemini-x): 404 model not found',
      'plannerFallback': {'code': 'llm_error', 'reason': 'LLM call failed (gemini/gemini-x): 404 model not found'},
      'summary': 'ok',
      'editIR': ir,
    });
    expect(r.isFallback, isTrue);
    expect(r.fallbackCode, 'llm_error');
    expect(r.fallbackReason, contains('404'));
  });

  test('the rule-based greeting and LLM turns are not fallbacks', () {
    final greet = DirectorResponse.fromData({'plannerSource': 'deterministic', 'plannerReason': 'opening proposal', 'summary': 'hi', 'editIR': ir});
    final llm = DirectorResponse.fromData({'plannerSource': 'llm', 'summary': 'ok', 'editIR': ir});
    expect(greet.isFallback, isFalse);
    expect(llm.isFallback, isFalse);
  });

  test('older servers: the offline-director warning still marks a fallback', () {
    final r = DirectorResponse.fromData({
      'plannerSource': 'deterministic',
      'summary': 'ok',
      'warnings': ['planned by the offline rule-based director: no AI API key configured'],
      'editIR': ir,
    });
    expect(r.isFallback, isTrue);
    expect(r.fallbackCode, isNull);
  });

  testWidgets('the banner says the offline rules made the edit, with the reason', (tester) async {
    final r = DirectorResponse.fromData({
      'plannerSource': 'deterministic',
      'plannerFallback': {'code': 'no_key', 'reason': 'no AI API key configured in server environment (provider "none")'},
      'summary': 'ok',
      'editIR': ir,
    });
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: FallbackBanner(response: r))));
    expect(find.byKey(const ValueKey('director-fallback-banner')), findsOneWidget);
    expect(find.textContaining("isn't set up for this workspace"), findsOneWidget);
    expect(find.textContaining('basic offline rules made this edit'), findsOneWidget);
    expect(find.textContaining('no AI API key configured'), findsOneWidget);
  });
}
