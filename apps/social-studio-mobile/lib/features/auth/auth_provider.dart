import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/util/json.dart';
import 'auth_repository.dart';

class Session {
  Session({required this.user, required this.company, required this.entitlement, this.offline = false});
  final SessionUser user;
  final SessionCompany company;
  final Entitlement entitlement;

  /// Restored from the cached profile because the server was unreachable at launch.
  final bool offline;

  Session copyWith({Entitlement? entitlement, bool? offline}) => Session(
        user: user,
        company: company,
        entitlement: entitlement ?? this.entitlement,
        offline: offline ?? this.offline,
      );
}

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(ref.watch(apiClientProvider)));

/// `AsyncValue<Session?>`: loading while restoring, `null` when signed out.
final sessionProvider = AsyncNotifierProvider<SessionController, Session?>(SessionController.new);

class SessionController extends AsyncNotifier<Session?> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  Future<Session?> build() async {
    final api = ref.read(apiClientProvider);
    api.onSessionExpired = _onExpired;
    api.onAccessLocked = lockFromError;
    return _restore();
  }

  Future<Session?> _restore() async {
    final tokens = ref.read(tokenStoreProvider);
    final refresh = await tokens.refreshToken;
    final access = await tokens.accessToken;
    if ((refresh == null || refresh.isEmpty) && (access == null || access.isEmpty)) return null;
    try {
      final me = await _repo.fetchMe();
      return await _establish(me);
    } on ApiException catch (e) {
      if (e.isNetwork) {
        final cached = await tokens.cachedProfile;
        if (cached != null) {
          final s = _fromMe(cached, Entitlement.unknown, offline: true);
          _publishUser(s);
          return s;
        }
        rethrow;
      }
      if (e.kind == ApiErrorKind.unauthorized) {
        await tokens.clearSession();
        return null;
      }
      rethrow;
    }
  }

  Session _fromMe(Json me, Entitlement ent, {bool offline = false}) => Session(
        user: SessionUser.fromJson(jMap(me['user'])),
        company: SessionCompany.fromJson(jMap(me['company'])),
        entitlement: ent,
        offline: offline,
      );

  Future<Session> _establish(Json me) async {
    final ent = await _repo.entitlement(me);
    await ref.read(tokenStoreProvider).saveProfile({'user': me['user'], 'company': me['company']});
    final s = _fromMe(me, ent);
    _publishUser(s);
    // Device token for the media routes; failures surface when those routes are used.
    unawaited(ref.read(deviceRegistrationProvider).ensureToken().then((_) {}, onError: (Object e) {
      debugPrint('[Session] device registration deferred: $e');
    }));
    return s;
  }

  void _publishUser(Session s) {
    ref.read(currentUserIdProvider.notifier).state = s.user.id;
    ref.read(outboxProvider).resumeAfterAuth();
  }

  Future<LoginResult> login({required String email, required String password, String? mfaToken}) async {
    final result = await _repo.login(email: email, password: password, mfaToken: mfaToken);
    if (result is LoginSuccess) state = AsyncData(await _establish(result.me));
    return result;
  }

  Future<LoginResult> loginWithGoogle(String idToken) async {
    final result = await _repo.loginWithGoogle(idToken);
    if (result is LoginSuccess) state = AsyncData(await _establish(result.me));
    return result;
  }

  Future<void> retryRestore() async {
    state = AsyncLoading();
    state = await AsyncValue.guard(_restore);
  }

  /// Re-checks subscription and feature flags (on app resume and from the lock screen).
  Future<void> refreshEntitlement() async {
    final current = state.valueOrNull;
    if (current == null) return;
    try {
      final me = await _repo.fetchMe();
      state = AsyncData(await _establish(me));
    } on ApiException catch (e) {
      if (e.isAccessLock) lockFromError(e);
    }
  }

  void lockFromError(ApiException e) {
    final current = state.valueOrNull;
    if (current == null) return;
    state = AsyncData(current.copyWith(
      entitlement: Entitlement(lockReason: AuthRepository.lockFor(e), message: e.message),
    ));
  }

  void _onExpired() {
    if (state.valueOrNull == null) return;
    state = AsyncData(null);
  }

  Future<void> logout() async {
    await ref.read(deviceRegistrationProvider).revoke();
    await _repo.logout();
    ref.read(currentUserIdProvider.notifier).state = null;
    state = AsyncData(null);
  }
}
