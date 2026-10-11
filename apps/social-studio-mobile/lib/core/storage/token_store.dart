import 'dart:convert';

import 'key_value_store.dart';

/// Holds the session credentials in secure storage, with an in-memory cache so the HTTP layer
/// does not hit the Keychain on every request.
class TokenStore {
  TokenStore(this._store);

  final KeyValueStore _store;

  static const _kAccess = 'auth.accessToken';
  static const _kRefresh = 'auth.refreshToken';
  static const _kDeviceToken = 'device.token';
  static const _kDeviceId = 'device.id';
  static const _kDeviceExpiresAt = 'device.expiresAt';
  static const _kProfile = 'auth.cachedProfile';

  String? _access;
  String? _refresh;
  String? _deviceToken;
  bool _loaded = false;

  Future<void> _ensureLoaded() async {
    if (_loaded) return;
    _access = await _store.read(_kAccess);
    _refresh = await _store.read(_kRefresh);
    _deviceToken = await _store.read(_kDeviceToken);
    _loaded = true;
  }

  Future<String?> get accessToken async {
    await _ensureLoaded();
    return _access;
  }

  Future<String?> get refreshToken async {
    await _ensureLoaded();
    return _refresh;
  }

  Future<String?> get deviceToken async {
    await _ensureLoaded();
    return _deviceToken;
  }

  Future<void> saveSession({required String accessToken, String? refreshToken}) async {
    _access = accessToken;
    await _store.write(_kAccess, accessToken);
    if (refreshToken != null) {
      _refresh = refreshToken;
      await _store.write(_kRefresh, refreshToken);
    }
    _loaded = true;
  }

  Future<void> saveAccessToken(String token) async {
    _access = token;
    await _store.write(_kAccess, token);
  }

  Future<String?> get deviceId => _store.read(_kDeviceId);

  Future<DateTime?> get deviceExpiresAt async {
    final raw = await _store.read(_kDeviceExpiresAt);
    final ms = raw == null ? null : int.tryParse(raw);
    return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms);
  }

  Future<void> saveDevice({required String deviceId, required String token, required DateTime expiresAt}) async {
    _deviceToken = token;
    await _store.write(_kDeviceId, deviceId);
    await _store.write(_kDeviceToken, token);
    await _store.write(_kDeviceExpiresAt, expiresAt.millisecondsSinceEpoch.toString());
  }

  Future<void> clearDeviceToken() async {
    _deviceToken = null;
    await _store.delete(_kDeviceToken);
    await _store.delete(_kDeviceExpiresAt);
  }

  /// The last `/api/auth/me` payload, used only to render the UI when the device is offline
  /// at launch. It carries no credentials.
  Future<Map<String, dynamic>?> get cachedProfile async {
    final raw = await _store.read(_kProfile);
    if (raw == null) return null;
    try {
      return (jsonDecode(raw) as Map).cast<String, dynamic>();
    } catch (_) {
      return null;
    }
  }

  Future<void> saveProfile(Map<String, dynamic> profile) => _store.write(_kProfile, jsonEncode(profile));

  /// Signs out locally. The device id is kept so the next login renews the same device slot.
  Future<void> clearSession() async {
    _access = null;
    _refresh = null;
    _deviceToken = null;
    await _store.delete(_kAccess);
    await _store.delete(_kRefresh);
    await _store.delete(_kDeviceToken);
    await _store.delete(_kDeviceExpiresAt);
    await _store.delete(_kProfile);
  }
}
