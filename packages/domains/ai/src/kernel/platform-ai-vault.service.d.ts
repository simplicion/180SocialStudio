export interface PlatformAiKeyRecord {
    encryptedKey: string;
    keyPreview: string;
    model?: string;
    endpointUrl?: string;
    isActive: boolean;
    updatedAt: string;
    updatedBy?: string;
}
export interface PlatformAiConfigStorage {
    defaultProvider?: string;
    providers: {
        openai?: PlatformAiKeyRecord;
        gemini?: PlatformAiKeyRecord;
        claude?: PlatformAiKeyRecord;
        groq?: PlatformAiKeyRecord;
        cartesia?: PlatformAiKeyRecord;
        custom?: PlatformAiKeyRecord;
        [key: string]: PlatformAiKeyRecord | undefined;
    };
}
export interface PlatformAiProviderSummary {
    provider: string;
    displayName: string;
    isConfigured: boolean;
    keyPreview: string | null;
    model: string;
    endpointUrl?: string;
    isActive: boolean;
    isDefault: boolean;
    updatedAt?: string;
    source: 'database' | 'env' | 'none';
}
export interface DecryptedPlatformAiSettings {
    defaultProvider: string;
    openaiKey: string;
    geminiKey: string;
    claudeKey: string;
    groqKey: string;
    cartesiaKey: string;
    customAiKey: string;
    customAiUrl: string;
    customAiModel: string;
    models: {
        openai?: string;
        gemini?: string;
        claude?: string;
        groq?: string;
        cartesia?: string;
        custom?: string;
    };
}
/**
 * Platform AI Vault Service
 *
 * Implements enterprise-grade secret management and AES-256-GCM envelope encryption
 * for platform AI API keys stored securely in the database.
 */
export declare class PlatformAiVaultService {
    private static cachedDecrypted;
    private static readonly CACHE_TTL_MS;
    /**
     * Resolves master encryption key with multi-tiered fallback:
     * 1. PLATFORM_AI_ENCRYPTION_KEY
     * 2. SOCIAL_TOKEN_ENCRYPTION_KEY
     * 3. ENCRYPTION_KEY
     * 4. HKDF derivation from JWT_SECRET (deterministic, NIST-compliant)
     */
    private static getVaultKey;
    /**
     * Encrypts an API key using AES-256-GCM with a cryptographically random 12-byte IV
     * and provider-bound Additional Authenticated Data (AAD).
     */
    static encryptApiKey(plainKey: string, provider: string): string;
    /**
     * Decrypts an AES-256-GCM envelope and verifies integrity using the auth tag and AAD.
     */
    static decryptApiKey(envelope: string, provider: string): string;
    /**
     * Generates a safe masked preview string for UI presentation.
     * Never exposes full secret in API responses.
     */
    static maskApiKey(key: string): string;
    /**
     * Invalidate runtime cached keys (called whenever superadmin updates a key).
     */
    static invalidateCache(): void;
    /**
     * Fetches raw stored PlatformSettings.aiConfig JSON from database.
     */
    static getStoredAiConfig(): Promise<PlatformAiConfigStorage>;
    /**
     * Saves updated PlatformAiConfigStorage back to PlatformSettings in database.
     */
    static saveAiConfig(config: PlatformAiConfigStorage): Promise<void>;
    /**
     * Returns public summary of all AI providers for the Super Admin panel.
     * Masked keys only; plaintext is strictly guarded.
     */
    static getAdminSummary(): Promise<{
        defaultProvider: string;
        encryptionProtocol: string;
        providers: PlatformAiProviderSummary[];
    }>;
    /**
     * Adds or updates a platform AI provider key in the database with AES-256-GCM encryption.
     */
    static setProviderKey(params: {
        provider: string;
        apiKey: string;
        model?: string;
        endpointUrl?: string;
        isActive?: boolean;
        updatedBy?: string;
    }): Promise<{
        success: boolean;
        preview: string;
    }>;
    /**
     * Updates model, endpoint, or active status without changing the encrypted key.
     */
    static updateProviderMetadata(params: {
        provider: string;
        model?: string;
        endpointUrl?: string;
        isActive?: boolean;
    }): Promise<void>;
    /**
     * Sets the platform-wide default AI provider.
     */
    static setDefaultProvider(provider: string): Promise<void>;
    /**
     * Removes an AI provider key from the database.
     */
    static deleteProviderKey(provider: string): Promise<void>;
    /**
     * Performs a live connection verification ping against the specified AI provider.
     * Can test either an in-memory key (before saving) or the stored decrypted key.
     */
    static testConnection(params: {
        provider: string;
        apiKey?: string;
        endpointUrl?: string;
        model?: string;
    }): Promise<{
        success: boolean;
        latencyMs: number;
        message: string;
        modelUsed: string;
    }>;
    /**
     * Resolves active decrypted platform AI settings with 60s memory caching.
     * Used by AICompanyConfigService and the AI kernel during runtime execution.
     */
    static getDecryptedPlatformAiSettings(): Promise<DecryptedPlatformAiSettings>;
}
