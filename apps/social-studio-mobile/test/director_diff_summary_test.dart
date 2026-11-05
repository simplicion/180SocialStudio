import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';
import 'package:social_studio_mobile/features/studio/timeline_ops.dart';

/// Phase 3.3: the proposal card shows what a turn changes; removals and cuts are flagged.
void main() {
  test('diffSummary and scope are read from the server response', () {
    final ir = TimelineOps.initial(projectId: 'p', durationMs: 5000, width: 1080, height: 1920).toJson();
    final r = DirectorResponse.fromData({
      'plannerSource': 'llm',
      'summary': 'ok',
      'reply': 'Cut the start.',
      'appliedOperations': ['Removed range 0.00s - 2.00s'],
      'requiresConfirmation': true,
      'editIR': ir,
      'scope': {'mode': 'modify_existing', 'targets': [], 'source': 'offline'},
      'diffSummary': {'text': '2.0 s cut · nothing removed', 'changes': ['2.0 s cut'], 'removed': 0, 'cutSec': 2, 'destructive': true},
    });
    expect(r.scopeMode, 'modify_existing');
    expect(r.diffSummary!.changes, ['2.0 s cut']);
    expect(r.diffSummary!.cutSec, 2);
    expect(r.diffSummary!.destructive, isTrue);
  });

  test('older servers without diffSummary still parse', () {
    final ir = TimelineOps.initial(projectId: 'p', durationMs: 5000, width: 1080, height: 1920).toJson();
    final r = DirectorResponse.fromData({'plannerSource': 'llm', 'summary': 'ok', 'editIR': ir});
    expect(r.diffSummary, isNull);
    expect(r.scopeMode, isNull);
  });
}
