import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/director/ai_director_service.dart';
import 'network/api_client.dart';
import 'network/audio_transcription_service.dart';
import 'network/device_registration.dart';
import 'network/social_api_client.dart';
import 'offline/outbox.dart';
import 'routing/deep_links.dart';
import 'storage/key_value_store.dart';
import 'storage/token_store.dart';

/// Overridden in tests with [InMemoryKeyValueStore].
final keyValueStoreProvider = Provider<KeyValueStore>((ref) => SecureKeyValueStore());

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore(ref.watch(keyValueStoreProvider)));

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(tokens: ref.watch(tokenStoreProvider)));

final outboxStorageProvider = Provider<OutboxStorage>((ref) => kIsWeb ? MemoryOutboxStorage() : FileOutboxStorage());

/// The signed-in user id, published by the session controller for the outbox.
final currentUserIdProvider = StateProvider<String?>((ref) => null);

final outboxProvider = ChangeNotifierProvider<Outbox>((ref) {
  final api = ref.watch(apiClientProvider);
  final outbox = Outbox(
    api: api,
    storage: ref.watch(outboxStorageProvider),
    currentUserId: () => ref.read(currentUserIdProvider),
  );
  api.onReachability = outbox.reportReachable;
  outbox.init();
  return outbox;
});

final deviceRegistrationProvider =
    Provider<DeviceRegistration>((ref) => DeviceRegistration(ref.watch(apiClientProvider)));

final socialApiProvider = Provider<SocialApi>((ref) => SocialApi(
      ref.watch(apiClientProvider),
      // `.notifier`: the API needs the outbox instance, not a rebuild on every sync-state change
      // (that reloaded every screen whenever the device went on/offline).
      outbox: ref.watch(outboxProvider.notifier),
      device: ref.watch(deviceRegistrationProvider),
    ));

final transcriptionServiceProvider = Provider<AudioTranscriptionService>(
    (ref) => AudioTranscriptionService(ref.watch(apiClientProvider), ref.watch(deviceRegistrationProvider)));

final aiDirectorServiceProvider = Provider<AiDirectorService>(
    (ref) => AiDirectorService(ref.watch(apiClientProvider), ref.watch(deviceRegistrationProvider)));

final deepLinksProvider = Provider<DeepLinkService>((ref) {
  final s = DeepLinkService();
  ref.onDispose(s.dispose);
  return s;
});
