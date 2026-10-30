import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:social_studio_mobile/core/services/platform_capability_registry.dart';
import 'package:social_studio_mobile/core/services/user_assisted_publishers.dart';
import 'package:social_studio_mobile/data/models/platform.dart';
import 'package:social_studio_mobile/data/models/user_assisted_publish_package.dart';
import 'package:social_studio_mobile/features/posts/finish_publishing_sheet.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('User-Assisted Publishing Payload Models', () {
    test('XPublishPayload serializes to and from json accurately', () {
      final payload = XPublishPayload(
        text: 'Exciting announcement from 180 Workspace! #buildinpublic',
        mediaPath: '/cache/videos/export.mp4',
        mimeType: 'video/mp4',
        sourceContentId: 'post_123',
        projectId: 'proj_abc',
      );

      final json = payload.toJson();
      expect(json['platform'], 'x');
      expect(json['text'], 'Exciting announcement from 180 Workspace! #buildinpublic');
      expect(json['mediaPath'], '/cache/videos/export.mp4');

      final restored = XPublishPayload.fromJson(json);
      expect(restored.text, payload.text);
      expect(restored.mediaPath, payload.mediaPath);
      expect(restored.mimeType, 'video/mp4');
    });

    test('UserAssistedPublishPackage bundles X payload', () {
      final package = UserAssistedPublishPackage(
        id: 'post_999',
        projectId: 'proj_1',
        title: 'Universal Post Title',
        caption: 'Universal Post Caption',
        xPayload: XPublishPayload(text: 'X Caption #growth'),
      );

      final json = package.toJson();
      expect(json['id'], 'post_999');
      expect(json['xPayload']['text'], 'X Caption #growth');

      final restored = UserAssistedPublishPackage.fromJson(json);
      expect(restored.xPayload?.text, 'X Caption #growth');
    });
  });

  group('Publishing Validation Layer', () {
    test('CentralizedManualPublisher validates text length and empty checks', () {
      final empty = CentralizedManualPublisher.validate(
        UniversalPlatformPayload(platform: SocialPlatform.instagram, caption: '   '),
      );
      expect(empty, contains('Post content cannot be empty for Instagram.'));

      final valid = CentralizedManualPublisher.validate(
        UniversalPlatformPayload(platform: SocialPlatform.instagram, caption: 'Valid post caption'),
      );
      expect(valid, isEmpty);

      final longText = 'A' * 2201;
      final overLimit = CentralizedManualPublisher.validate(
        UniversalPlatformPayload(platform: SocialPlatform.instagram, caption: longText),
      );
      expect(overLimit.any((issue) => issue.contains('2,200 characters')), isTrue);
    });
  });

  group('Platform Capability Registry', () {
    test('Instagram is identified with supported capabilities', () {
      final cap = PlatformCapabilityRegistry.getCapabilities(SocialPlatform.instagram);
      expect(cap.userAssistedPublishing, isTrue);
      expect(cap.apiPublishing, isTrue);
    });

    test('Builds official web fallback URLs accurately', () {
      final url = PlatformCapabilityRegistry.getWebComposeUrl(SocialPlatform.instagram, text: 'Hello World');
      expect(url.toString(), 'https://www.instagram.com/');
    });
  });

  group('UI & Dialog Interactions', () {
    testWidgets('PostPublishReturnDialog responds accurately to user choices', (tester) async {
      String? recordedStatus;

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (ctx) => ElevatedButton(
              onPressed: () => PostPublishReturnDialog.show(
                ctx,
                platform: 'X',
                onConfirm: (status) async => recordedStatus = status,
              ),
              child: const Text('Show Dialog'),
            ),
          ),
        ),
      );

      // Open dialog
      await tester.tap(find.text('Show Dialog'));
      await tester.pumpAndSettle();

      expect(find.text('Did you publish on X?'), findsOneWidget);
      expect(find.text('Yes, I posted'), findsOneWidget);
      expect(find.text('Not yet'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);

      // Tap Yes, I posted
      await tester.tap(find.text('Yes, I posted'));
      await tester.pumpAndSettle();

      expect(recordedStatus, 'user_confirmed');
    });

    testWidgets('CentralizedManualPublishSheet displays Instagram section', (tester) async {
      final package = UserAssistedPublishPackage(
        id: 'post_test_ui',
        projectId: 'proj_ui',
        title: 'Test Discussion Title',
        caption: 'This is the test copy for publishing.',
        platformPayloads: {
          SocialPlatform.instagram: UniversalPlatformPayload(
            platform: SocialPlatform.instagram,
            caption: 'This is the test copy for publishing.',
          ),
        },
              );

      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: Scaffold(
              body: CentralizedManualPublishSheet(package: package),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Finish Publishing'), findsOneWidget);
      expect(find.text('Post on Instagram'), findsWidgets);
      expect(find.text('180 Workspace never automatically clicks the final platform Post button. You review and confirm publication in the native app.'), findsOneWidget);
    });
  });
}
