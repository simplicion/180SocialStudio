import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';
import '../network/device_registration.dart';
import '../providers.dart';

/// What Settings shows for push notifications.
enum PushState {
  /// Not checked yet.
  unknown,

  /// Firebase could not start on this build (no google-services config / unsupported platform).
  notConfiguredOnDevice,

  /// The server has no Firebase credentials (`PUSH_NOT_CONFIGURED`); nothing would be delivered.
  notConfiguredOnServer,

  /// The user declined the notification permission (Android 13+ / iOS).
  permissionDenied,

  /// Token registered with the server for this device.
  enabled,

  /// Registration failed for another reason (network, server error); retryable.
  error,
}

class PushStatus {
  PushStatus(this.state, {this.message});
  final PushState state;
  final String? message;

  String get label => switch (state) {
        PushState.unknown => 'Checking…',
        PushState.notConfiguredOnDevice => 'Push not configured in this build',
        PushState.notConfiguredOnServer => 'Push not configured on the server',
        PushState.permissionDenied => 'Notifications are turned off',
        PushState.enabled => 'On for this device',
        PushState.error => 'Could not enable notifications',
      };
}

/// Firebase Cloud Messaging integration: permission (Android 13+ POST_NOTIFICATIONS), token registration and refresh
/// against `PUT /api/desktop/devices/:id/push-token`, and tap → deep link to the post (`data.link` /
/// `workspace180://posts/<id>`). Everything is gated: without Firebase config the app keeps working and Settings
/// says "Push not configured". Tests replace [pushServiceProvider] with a fake.
class PushNotificationService extends StateNotifier<PushStatus> {
  PushNotificationService(this._api, this._device) : super(PushStatus(PushState.unknown));

  final ApiClient _api;
  final DeviceRegistration _device;
  StreamSubscription<String>? _refreshSub;
  StreamSubscription<RemoteMessage>? _openSub;
  bool _firebaseReady = false;
  Future<void>? _initFuture;

  /// Starts Firebase and wires tap handling. Never throws.
  Future<void> init({required void Function(String location) navigate}) => _initFuture ??= _init(navigate);

  Future<void> _init(void Function(String location) navigate) async {
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      _firebaseReady = true;
    } catch (e) {
      debugPrint('[Push] Firebase unavailable: $e');
      state = PushStatus(PushState.notConfiguredOnDevice, message: 'This build has no Firebase configuration.');
      return;
    }
    try {
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _route(initial, navigate);
      _openSub = FirebaseMessaging.onMessageOpenedApp.listen((m) => _route(m, navigate));
    } catch (e) {
      debugPrint('[Push] tap handling unavailable: $e');
    }
  }

  static String? locationFor(Map<String, dynamic> data) {
    final link = data['link']?.toString();
    if (link != null) {
      final uri = Uri.tryParse(link);
      if (uri != null && uri.host == 'posts' && uri.pathSegments.isNotEmpty) return '/posts/${uri.pathSegments.first}';
    }
    final postId = data['postId']?.toString();
    return postId == null || postId.isEmpty ? null : '/posts/$postId';
  }

  void _route(RemoteMessage m, void Function(String) navigate) {
    final loc = locationFor(m.data);
    if (loc != null) navigate(loc);
  }

  /// Asks for permission (only when [prompt]) and registers the token. Call after sign-in and from Settings.
  Future<void> enable({bool prompt = true}) async {
    if (_initFuture != null) await _initFuture;
    if (!_firebaseReady) {
      state = PushStatus(PushState.notConfiguredOnDevice, message: 'This build has no Firebase configuration.');
      return;
    }
    try {
      final server = await _api.get('/api/desktop/push/status');
      if (server['configured'] != true) {
        state = PushStatus(PushState.notConfiguredOnServer, message: 'Your workspace server has no Firebase credentials yet.');
        return;
      }
      final messaging = FirebaseMessaging.instance;
      final settings = prompt ? await messaging.requestPermission() : await messaging.getNotificationSettings();
      if (settings.authorizationStatus == AuthorizationStatus.denied || settings.authorizationStatus == AuthorizationStatus.notDetermined) {
        state = PushStatus(PushState.permissionDenied, message: 'Allow notifications for 180 Social in system settings.');
        return;
      }
      final token = await messaging.getToken();
      if (token == null) throw StateError('FCM returned no token');
      await _device.setPushToken(provider: 'fcm', token: token);
      _refreshSub ??= messaging.onTokenRefresh.listen((t) => unawaited(_device.setPushToken(provider: 'fcm', token: t).catchError((_) {})));
      state = PushStatus(PushState.enabled);
    } catch (e) {
      state = PushStatus(PushState.error, message: '$e');
    }
  }

  @override
  void dispose() {
    _refreshSub?.cancel();
    _openSub?.cancel();
    super.dispose();
  }
}

final pushServiceProvider = StateNotifierProvider<PushNotificationService, PushStatus>(
  (ref) => PushNotificationService(ref.watch(apiClientProvider), ref.watch(deviceRegistrationProvider)),
);
