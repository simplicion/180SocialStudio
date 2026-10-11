import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:social_studio_mobile/main.dart';

void main() {
  testWidgets('Social Studio App boots successfully', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: SocialStudioApp(),
      ),
    );

    // Initial frame should render without crashing
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.byType(SocialStudioApp), findsOneWidget);
  });
}
