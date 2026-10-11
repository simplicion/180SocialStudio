import 'package:flutter_test/flutter_test.dart';
import 'package:social_studio_mobile/core/network/api_exception.dart';
import 'package:social_studio_mobile/core/providers.dart';
import 'package:social_studio_mobile/features/auth/auth_provider.dart';
import 'package:social_studio_mobile/features/auth/auth_repository.dart';
import 'package:social_studio_mobile/features/common/feature_lock_view.dart';
import 'package:social_studio_mobile/features/dashboard/studio_dashboard_screen.dart';
import 'package:social_studio_mobile/features/director/ai_director_service.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

/// `moduleGuard` 403 body (system-configs/middleware/auth/module-guard.ts).
Map<String, dynamic> appDisabled(String app) =>
    {'error': 'App Disabled', 'message': 'The $app application is currently disabled for your workspace.', 'code': 'APP_DISABLED'};

final _media = MediaAnalysis(durationMs: 10000, width: 1080, height: 1920);

Future<ApiException> _directorError(WidgetTester tester, AppHarness h) async {
  try {
    await drive(tester, h.container.read(aiDirectorServiceProvider).direct(prompt: 'cut the pauses', history: const [], media: _media));
  } on ApiException catch (e) {
    return e;
  }
  fail('the director call should have thrown');
}

void main() {
  appTest('APP_DISABLED from a media-editor route is thrown to the caller and does not lock the app', (tester) async {
    final b = seededBackend()..json('POST', '/api/v1/media-editor/ai-direct', appDisabled('video-editor'), status: 403);
    final h = await pumpApp(tester, b);
    final e = await _directorError(tester, h);
    await settle(tester);
    expect(e.kind, ApiErrorKind.appDisabled);
    expect(e.message, contains('video-editor'));
    expect(h.container.read(sessionProvider).value!.entitlement.hasSocial, isTrue);
    expect(find.byType(StudioDashboardScreen), findsOneWidget);
    expect(find.byType(FeatureLockView), findsNothing);
  });

  appTest('APP_DISABLED from a social-media route locks the session', (tester) async {
    final b = seededBackend();
    final h = await pumpApp(tester, b);
    b.json('GET', '$sm/projects', appDisabled('social-media'), status: 403);
    expect(await driveError(tester, h.container.read(socialApiProvider).listProjects()), isA<ApiException>());
    await settle(tester);
    final ent = h.container.read(sessionProvider).value!.entitlement;
    expect(ent.hasSocial, isFalse);
    expect(ent.lockReason, LockReason.appNotEnabled);
    expect(find.byType(FeatureLockView), findsOneWidget);
  });

  appTest('subscription-expired on a media-editor route still locks the app', (tester) async {
    final b = seededBackend()
      ..json('POST', '/api/v1/media-editor/ai-direct',
          {'subscriptionExpired': true, 'status': 'expired', 'message': 'Your subscription has expired. Please upgrade to continue.'},
          status: 403);
    final h = await pumpApp(tester, b);
    final e = await _directorError(tester, h);
    await settle(tester);
    expect(e.kind, ApiErrorKind.subscriptionExpired);
    expect(h.container.read(sessionProvider).value!.entitlement.lockReason, LockReason.subscriptionExpired);
    expect(find.byType(FeatureLockView), findsOneWidget);
  });

  appTest('company-suspended on a media-editor route still locks the app', (tester) async {
    final b = seededBackend()
      ..json('GET', '/api/v1/media-editor/stock/unified',
          {'companySuspended': true, 'status': 'suspended', 'message': 'Your company workspace has been suspended.'},
          status: 403);
    final h = await pumpApp(tester, b);
    expect(await driveError(tester, h.container.read(aiDirectorServiceProvider).resolveStockVideo('beach')), isA<ApiException>());
    await settle(tester);
    expect(h.container.read(sessionProvider).value!.entitlement.lockReason, LockReason.companySuspended);
    expect(find.byType(FeatureLockView), findsOneWidget);
  });

  test('guard bodies map to the right error kinds', () {
    expect(ApiException.fromResponse(403, appDisabled('x')).kind, ApiErrorKind.appDisabled);
    expect(ApiException.fromResponse(403, {'subscriptionExpired': true}).kind, ApiErrorKind.subscriptionExpired);
    expect(ApiException.fromResponse(403, {'companySuspended': true}).kind, ApiErrorKind.companySuspended);
    expect(FakeResponse.error(403, 'Forbidden').status, 403);
  });
}
