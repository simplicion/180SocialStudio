import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';

void main() {
  test('an assistant turn carries its proposed plan in history, so "yes" executes that plan', () {
    expect(historyText('Good to go?', const []), 'Good to go?');
    expect(
      historyText('Here is what I will do. Good to go?', const ['Trim the dead air', 'Add captions']),
      'Here is what I will do. Good to go?\nPlan:\n1. Trim the dead air\n2. Add captions',
    );
  });
}
