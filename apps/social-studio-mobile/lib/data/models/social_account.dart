import '../../core/util/json.dart';
import 'platform.dart';

/// A connected social channel. Tokens are never parsed or kept on the device even though the
/// current backend still returns them (FEATURE_PARITY §5.3).
class SocialAccount {
  SocialAccount({
    required this.id,
    required this.platform,
    required this.accountName,
    this.username,
    this.profileImageUrl,
    this.projectId,
    this.projectName,
    this.clientName,
    this.isActive = true,
    this.reauthRequired = false,
    this.tokenExpiresAt,
    this.capabilities = const [],
    this.tokenHealth,
    this.isSimulated = false,
    this.metadata = const {},
  });

  /// A sandbox account created by the server's SIMULATE_SOCIAL_PUBLISHING mode (dev only): posts to it are never
  /// sent to the platform.
  final bool isSimulated;

  final String id;
  final SocialPlatform platform;
  final String accountName;
  final String? username;
  final String? profileImageUrl;
  final String? projectId;
  final String? projectName;
  final String? clientName;
  final bool isActive;
  final bool reauthRequired;
  final DateTime? tokenExpiresAt;
  final List<String> capabilities;
  final Json metadata;

  /// Server-computed: ok | expiring_soon | expired | reauth_required (null on older servers).
  final String? tokenHealth;

  bool get isDefault => jBool(metadata['isDefault']) || jBool(metadata['isPrimary']);

  bool get tokenExpired => tokenHealth == 'expired' || (tokenExpiresAt != null && tokenExpiresAt!.isBefore(DateTime.now()));

  bool get expiresSoon =>
      tokenHealth == 'expiring_soon' ||
      (tokenExpiresAt != null && !tokenExpired && tokenExpiresAt!.difference(DateTime.now()).inDays < 7);

  bool get needsAttention => reauthRequired || tokenHealth == 'reauth_required' || tokenExpired;

  factory SocialAccount.fromJson(Json j) {
    final project = jMapOrNull(j['project']);
    final client = jMapOrNull(j['client']);
    final meta = jMap(j['metadata']);
    return SocialAccount(
      id: jStrOr(j['id'], ''),
      platform: SocialPlatform.parse(j['platform']),
      accountName: jStr(j['accountName']) ?? jStr(j['username']) ?? 'Unnamed account',
      username: jStr(j['username']),
      profileImageUrl: jStr(j['profileImageUrl']),
      projectId: jStr(j['projectId']),
      projectName: project == null ? null : jStr(project['name']),
      clientName: client == null ? null : jStr(client['name']),
      isActive: jBool(j['isActive'], true),
      reauthRequired: jBool(j['reauthRequired']),
      tokenExpiresAt: jDate(j['tokenExpiresAt']),
      capabilities: jStrList(j['capabilities']),
      tokenHealth: jStr(j['tokenHealth']),
      isSimulated: jBool(meta['simulated']),
      metadata: meta,
    );
  }
}

/// One account the provider offered after OAuth (a Facebook Page, an Instagram business account,
/// the LinkedIn member or one of their organisations).
class OAuthCandidate {
  OAuthCandidate({required this.candidateId, required this.kind, required this.accountName, this.username, this.profileImageUrl});
  final String candidateId;
  final String kind;
  final String accountName;
  final String? username;
  final String? profileImageUrl;

  factory OAuthCandidate.fromJson(Json j) => OAuthCandidate(
        candidateId: jStrOr(j['candidateId'], ''),
        kind: jStrOr(j['kind'], ''),
        accountName: jStrOr(j['accountName'], jStrOr(j['username'], 'Account')),
        username: jStr(j['username']),
        profileImageUrl: jStr(j['profileImageUrl']),
      );

  String get kindLabel => switch (kind) {
        'facebook_page' || 'page' => 'Facebook Page',
        'instagram_business' || 'instagram' => 'Instagram account',
        'linkedin_member' || 'member' || 'person' => 'Personal profile',
        'linkedin_organization' || 'organization' || 'organisation' => 'Company page',
        'channel' => 'YouTube channel',
        'user' => 'Profile',
        _ => kind.replaceAll('_', ' '),
      };
}
