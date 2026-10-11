import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../util/json.dart';
import 'api_client.dart';
import 'api_exception.dart';

/// Native device token for the media routes (`x-device-token`).
///
/// `POST /api/desktop/devices/register { label, platform: ios|android, deviceId? }` → token
/// valid for 30 days. The stored `deviceId` is sent back so a renewal reuses the same slot.
/// A reinstall wipes secure storage on Android, so a stable `installKey` (ANDROID_ID, hashed per user on the server)
/// is sent too: the server then renews the existing device instead of taking a new slot. iOS keeps the Keychain
/// (and so the deviceId) across reinstalls. At the limit (20) the server evicts the least-recently-seen idle device.
class DeviceRegistration {
  DeviceRegistration(this._api, {String? platformOverride, Future<String?> Function()? installKeyReader})
      : _platformOverride = platformOverride,
        _installKeyReader = installKeyReader;

  final ApiClient _api;
  final String? _platformOverride;
  final Future<String?> Function()? _installKeyReader;

  static const _deviceChannel = MethodChannel('com.workspace180.socialmanager/device');

  /// Stable per-install key, or null (unsupported platform / channel missing). Never throws.
  Future<String?> installKey() async {
    try {
      if (_installKeyReader != null) return await _installKeyReader();
      if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
      final v = await _deviceChannel.invokeMethod<String>('installKey');
      return (v == null || v.length < 8) ? null : 'android:$v';
    } catch (_) {
      return null;
    }
  }

  static const _renewBefore = Duration(days: 2);

  String get platform {
    if (_platformOverride != null) return _platformOverride;
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.iOS:
        return 'ios';
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.windows:
        return 'windows';
      case TargetPlatform.macOS:
        return 'macos';
      case TargetPlatform.linux:
        return 'linux';
      default:
        return 'unknown';
    }
  }

  Future<String> ensureToken({bool forceRenew = false}) async {
    final tokens = _api.tokens;
    final existing = await tokens.deviceToken;
    final expiresAt = await tokens.deviceExpiresAt;
    final fresh = expiresAt != null && expiresAt.isAfter(DateTime.now().add(_renewBefore));
    if (!forceRenew && existing != null && existing.isNotEmpty && fresh) return existing;

    final deviceId = await tokens.deviceId;
    final r = await _api.post('/api/desktop/devices/register', body: compact({
      'label': '180 Social Studio ($platform)',
      'platform': platform,
      'deviceId': deviceId,
      'installKey': await installKey(),
    }));
    final token = jStr(r['token']);
    final id = jStr(r['deviceId']);
    if (token == null || id == null) {
      throw ApiException(kind: ApiErrorKind.server, message: 'Device registration returned no token.');
    }
    final exp = jDate(r['expiresAt']) ?? DateTime.now().add(Duration(days: 30));
    await tokens.saveDevice(deviceId: id, token: token, expiresAt: exp);
    return token;
  }

  /// Stores (or clears, with null) this device's push token: `PUT /desktop/devices/:id/push-token`.
  /// The server delivers publish / approval / reconnect notifications to it (FCM).
  Future<void> setPushToken({required String provider, required String? token}) async {
    final id = await _api.tokens.deviceId ?? (await ensureToken().then((_) => _api.tokens.deviceId));
    if (id == null) return;
    await _api.put('/api/desktop/devices/$id/push-token', body: {'provider': provider, 'token': token});
  }

  /// Returns the current device's registered ID if any.
  Future<String?> get currentDeviceId => _api.tokens.deviceId;

  /// Lists all active devices registered under this account (`GET /api/desktop/devices`).
  Future<List<Map<String, dynamic>>> listDevices() async {
    final r = await _api.get('/api/desktop/devices');
    final list = (r['devices'] as List?)?.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList();
    return list ?? [];
  }

  /// Revokes a specific device slot on the server (`DELETE /api/desktop/devices/:deviceId`).
  Future<void> revokeDevice(String deviceId) async {
    await _api.delete('/api/desktop/devices/$deviceId');
    final myId = await _api.tokens.deviceId;
    if (myId == deviceId) {
      await _api.tokens.clearDeviceToken();
    }
  }

  /// Frees this device's slot on the server (used on sign-out). Best effort.
  Future<void> revoke() async {
    final id = await _api.tokens.deviceId;
    if (id == null) return;
    try {
      await _api.delete('/api/desktop/devices/$id');
    } catch (_) {
      // The token expires on its own; sign-out must not be blocked by this.
    }
    await _api.tokens.clearDeviceToken();
  }
}
