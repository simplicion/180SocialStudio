"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformAiVaultService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("@workspace/db");
const openai_1 = __importDefault(require("openai"));
const generative_ai_1 = require("@google/generative-ai");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const DEFAULT_MODELS = {
    openai: 'gpt-4o',
    gemini: 'gemini-1.5-flash',
    claude: 'claude-3-5-sonnet-20241022',
    groq: 'llama-3.3-70b-versatile',
    cartesia: 'sonic-3.6',
    custom: 'default'
};
const DISPLAY_NAMES = {
    openai: 'OpenAI (GPT-4o / GPT-4o-mini)',
    gemini: 'Google Gemini (1.5 Flash / Pro)',
    claude: 'Anthropic Claude (3.5 Sonnet / Haiku)',
    groq: 'Groq Cloud (Llama 3.3 / Mixtral)',
    cartesia: 'Cartesia Neural Audio & STT (Voiceforce Voice AI)',
    custom: 'Custom Enterprise LLM (Self-hosted / OpenAI Compatible)'
};
/**
 * Platform AI Vault Service
 *
 * Implements enterprise-grade secret management and AES-256-GCM envelope encryption
 * for platform AI API keys stored securely in the database.
 */
class PlatformAiVaultService {
    static cachedDecrypted = null;
    static CACHE_TTL_MS = 60 * 1000; // 60 seconds
    /**
     * Resolves master encryption key with multi-tiered fallback:
     * 1. PLATFORM_AI_ENCRYPTION_KEY
     * 2. SOCIAL_TOKEN_ENCRYPTION_KEY
     * 3. ENCRYPTION_KEY
     * 4. HKDF derivation from JWT_SECRET (deterministic, NIST-compliant)
     */
    static getVaultKey() {
        const raw = (process.env.PLATFORM_AI_ENCRYPTION_KEY ||
            process.env.AI_TOKEN_ENCRYPTION_KEY ||
            process.env.ENCRYPTION_KEY ||
            '').trim();
        let keyBuf;
        if (raw) {
            if (/^[0-9a-fA-F]{64}$/.test(raw)) {
                keyBuf = Buffer.from(raw, 'hex');
            }
            else {
                try {
                    const b = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
                    if (b.length === 32)
                        keyBuf = b;
                    else
                        keyBuf = crypto_1.default.createHash('sha256').update(raw).digest();
                }
                catch {
                    keyBuf = crypto_1.default.createHash('sha256').update(raw).digest();
                }
            }
        }
        else {
            // Safe HKDF key derivation from platform JWT_SECRET
            const secret = process.env.JWT_SECRET || process.env.SUPERADMIN_JWT_SECRET;
            if (!secret) {
                throw new Error('PLATFORM_AI_VAULT_NOT_CONFIGURED: set PLATFORM_AI_VAULT_KEY or JWT_SECRET to encrypt/decrypt platform AI keys.');
            }
            keyBuf = Buffer.from(crypto_1.default.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from('180-platform-ai-vault-v1'), 32));
        }
        const id = crypto_1.default.createHash('sha256').update(keyBuf).digest('hex').slice(0, 8);
        return { id, key: keyBuf };
    }
    /**
     * Encrypts an API key using AES-256-GCM with a cryptographically random 12-byte IV
     * and provider-bound Additional Authenticated Data (AAD).
     */
    static encryptApiKey(plainKey, provider) {
        const trimmed = plainKey.trim();
        if (!trimmed)
            throw new Error('API key cannot be empty');
        const { id, key } = this.getVaultKey();
        const iv = crypto_1.default.randomBytes(12);
        const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
        const aad = `180-platform-ai:${provider.toLowerCase()}`;
        cipher.setAAD(Buffer.from(aad, 'utf8'));
        const ct = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return ['v1', id, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
    }
    /**
     * Decrypts an AES-256-GCM envelope and verifies integrity using the auth tag and AAD.
     */
    static decryptApiKey(envelope, provider) {
        if (!envelope || !envelope.startsWith('v1.')) {
            throw new Error('Invalid vault envelope format');
        }
        const parts = envelope.split('.');
        if (parts.length !== 5) {
            throw new Error('Malformed vault envelope');
        }
        const [, , ivB, tagB, ctB] = parts;
        const { key } = this.getVaultKey();
        const aad = `180-platform-ai:${provider.toLowerCase()}`;
        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
        try {
            return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
        }
        catch (err) {
            throw new Error(`Failed to decrypt credentials for ${provider}: Authentication check failed (tampered data or changed encryption key)`);
        }
    }
    /**
     * Generates a safe masked preview string for UI presentation.
     * Never exposes full secret in API responses.
     */
    static maskApiKey(key) {
        const trimmed = (key || '').trim();
        if (!trimmed)
            return '';
        if (trimmed.length <= 8) {
            return '••••••••';
        }
        if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-ant-') || trimmed.startsWith('gsk_')) {
            const prefix = trimmed.slice(0, 7);
            const suffix = trimmed.slice(-4);
            return `${prefix}••••••••${suffix}`;
        }
        const prefix = trimmed.slice(0, 6);
        const suffix = trimmed.slice(-4);
        return `${prefix}••••••••${suffix}`;
    }
    /**
     * Invalidate runtime cached keys (called whenever superadmin updates a key).
     */
    static invalidateCache() {
        this.cachedDecrypted = null;
    }
    /**
     * Fetches raw stored PlatformSettings.aiConfig JSON from database.
     */
    static async getStoredAiConfig() {
        try {
            const settings = await db_1.prisma.platformSettings.findFirst({
                select: { aiConfig: true }
            });
            let cfg = settings?.aiConfig || {};
            if (typeof cfg === 'string') {
                try {
                    cfg = JSON.parse(cfg);
                }
                catch {
                    cfg = {};
                }
            }
            if (!cfg || typeof cfg !== 'object')
                cfg = {};
            if (!cfg.providers || typeof cfg.providers !== 'object')
                cfg.providers = {};
            return cfg;
        }
        catch (err) {
            console.error('[PlatformAiVault] Error loading stored AI config:', err);
            return { providers: {} };
        }
    }
    /**
     * Saves updated PlatformAiConfigStorage back to PlatformSettings in database.
     */
    static async saveAiConfig(config) {
        const settings = await db_1.prisma.platformSettings.findFirst({ select: { id: true } });
        if (!settings) {
            await db_1.prisma.platformSettings.create({
                data: {
                    platformName: '180workspace',
                    aiConfig: config
                }
            });
        }
        else {
            await db_1.prisma.platformSettings.update({
                where: { id: settings.id },
                data: { aiConfig: config }
            });
        }
        this.invalidateCache();
    }
    /**
     * Returns public summary of all AI providers for the Super Admin panel.
     * Masked keys only; plaintext is strictly guarded.
     */
    static async getAdminSummary() {
        const stored = await this.getStoredAiConfig();
        const supported = ['openai', 'gemini', 'claude', 'groq', 'cartesia', 'custom'];
        const defaultProvider = stored.defaultProvider || 'openai';
        const providers = supported.map((prov) => {
            const rec = stored.providers[prov];
            const hasDbKey = !!rec && !!rec.encryptedKey && rec.isActive !== false;
            // Fallback check against process.env
            let envKey = '';
            if (prov === 'openai')
                envKey = process.env.OPENAI_API_KEY || '';
            else if (prov === 'gemini')
                envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
            else if (prov === 'claude')
                envKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
            else if (prov === 'groq')
                envKey = process.env.GROQ_API_KEY || '';
            else if (prov === 'cartesia')
                envKey = process.env.CARTESIA_API_KEY || '';
            else if (prov === 'custom')
                envKey = process.env.CUSTOM_AI_KEY || '';
            const isConfigured = hasDbKey || !!envKey;
            const source = hasDbKey ? 'database' : (envKey ? 'env' : 'none');
            const keyPreview = hasDbKey ? (rec?.keyPreview || '••••••••') : (envKey ? this.maskApiKey(envKey) : null);
            const model = rec?.model || DEFAULT_MODELS[prov] || '';
            const isActive = rec?.isActive !== undefined ? rec.isActive : true;
            return {
                provider: prov,
                displayName: DISPLAY_NAMES[prov] || prov.toUpperCase(),
                isConfigured,
                keyPreview,
                model,
                endpointUrl: rec?.endpointUrl || (prov === 'custom' ? (process.env.CUSTOM_AI_URL || '') : undefined),
                isActive,
                isDefault: defaultProvider === prov,
                updatedAt: rec?.updatedAt,
                source
            };
        });
        return {
            defaultProvider,
            encryptionProtocol: 'AES-256-GCM (NIST SP 800-38D Authenticated Envelope)',
            providers
        };
    }
    /**
     * Adds or updates a platform AI provider key in the database with AES-256-GCM encryption.
     */
    static async setProviderKey(params) {
        const { provider, apiKey, model, endpointUrl, isActive = true, updatedBy } = params;
        const normProvider = provider.toLowerCase().trim();
        if (!['openai', 'gemini', 'claude', 'groq', 'cartesia', 'custom'].includes(normProvider)) {
            throw new Error(`Unsupported AI provider: ${provider}`);
        }
        const encryptedKey = this.encryptApiKey(apiKey, normProvider);
        const keyPreview = this.maskApiKey(apiKey);
        const stored = await this.getStoredAiConfig();
        stored.providers[normProvider] = {
            encryptedKey,
            keyPreview,
            model: model?.trim() || stored.providers[normProvider]?.model || DEFAULT_MODELS[normProvider],
            endpointUrl: endpointUrl?.trim() || stored.providers[normProvider]?.endpointUrl,
            isActive,
            updatedAt: new Date().toISOString(),
            updatedBy
        };
        // If no default provider was set, make this the default
        if (!stored.defaultProvider) {
            stored.defaultProvider = normProvider;
        }
        await this.saveAiConfig(stored);
        return { success: true, preview: keyPreview };
    }
    /**
     * Updates model, endpoint, or active status without changing the encrypted key.
     */
    static async updateProviderMetadata(params) {
        const { provider, model, endpointUrl, isActive } = params;
        const normProvider = provider.toLowerCase().trim();
        const stored = await this.getStoredAiConfig();
        const existing = stored.providers[normProvider];
        if (!existing) {
            throw new Error(`Provider ${provider} is not configured yet. Please provide an API key first.`);
        }
        if (model !== undefined)
            existing.model = model.trim();
        if (endpointUrl !== undefined)
            existing.endpointUrl = endpointUrl.trim();
        if (isActive !== undefined)
            existing.isActive = isActive;
        existing.updatedAt = new Date().toISOString();
        await this.saveAiConfig(stored);
    }
    /**
     * Sets the platform-wide default AI provider.
     */
    static async setDefaultProvider(provider) {
        const normProvider = provider.toLowerCase().trim();
        const stored = await this.getStoredAiConfig();
        stored.defaultProvider = normProvider;
        await this.saveAiConfig(stored);
    }
    /**
     * Removes an AI provider key from the database.
     */
    static async deleteProviderKey(provider) {
        const normProvider = provider.toLowerCase().trim();
        const stored = await this.getStoredAiConfig();
        if (stored.providers[normProvider]) {
            delete stored.providers[normProvider];
            if (stored.defaultProvider === normProvider) {
                const remaining = Object.keys(stored.providers);
                stored.defaultProvider = remaining.length > 0 ? remaining[0] : 'openai';
            }
            await this.saveAiConfig(stored);
        }
    }
    /**
     * Performs a live connection verification ping against the specified AI provider.
     * Can test either an in-memory key (before saving) or the stored decrypted key.
     */
    static async testConnection(params) {
        const { provider } = params;
        const normProvider = provider.toLowerCase().trim();
        let keyToTest = params.apiKey?.trim();
        let endpointToTest = params.endpointUrl?.trim();
        let modelToTest = params.model?.trim() || DEFAULT_MODELS[normProvider] || 'default';
        // If key was not provided, decrypt from database or fallback to env
        if (!keyToTest) {
            const stored = await this.getStoredAiConfig();
            const rec = stored.providers[normProvider];
            if (rec?.encryptedKey) {
                keyToTest = this.decryptApiKey(rec.encryptedKey, normProvider);
                if (!endpointToTest && rec.endpointUrl)
                    endpointToTest = rec.endpointUrl;
                if (!params.model && rec.model)
                    modelToTest = rec.model;
            }
            else {
                if (normProvider === 'openai')
                    keyToTest = process.env.OPENAI_API_KEY || '';
                else if (normProvider === 'gemini')
                    keyToTest = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
                else if (normProvider === 'claude')
                    keyToTest = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
                else if (normProvider === 'groq')
                    keyToTest = process.env.GROQ_API_KEY || '';
                else if (normProvider === 'custom') {
                    keyToTest = process.env.CUSTOM_AI_KEY || '';
                    if (!endpointToTest)
                        endpointToTest = process.env.CUSTOM_AI_URL || '';
                }
            }
        }
        if (!keyToTest) {
            throw new Error(`No API key available to test for ${provider}. Please enter a key.`);
        }
        const startTime = Date.now();
        try {
            if (normProvider === 'openai') {
                const openai = new openai_1.default({ apiKey: keyToTest });
                const res = await openai.chat.completions.create({
                    model: modelToTest || 'gpt-4o-mini',
                    messages: [{ role: 'user', content: 'Ping' }],
                    max_tokens: 5
                });
                const latencyMs = Date.now() - startTime;
                return {
                    success: true,
                    latencyMs,
                    message: `OpenAI responded successfully (${res.choices[0]?.message?.content?.trim() || 'OK'}).`,
                    modelUsed: modelToTest || 'gpt-4o-mini'
                };
            }
            if (normProvider === 'gemini') {
                const genAI = new generative_ai_1.GoogleGenerativeAI(keyToTest);
                const candidateModel = modelToTest || 'gemini-1.5-flash';
                const model = genAI.getGenerativeModel({
                    model: candidateModel,
                    generationConfig: { maxOutputTokens: 5 }
                });
                const res = await model.generateContent('Ping');
                const latencyMs = Date.now() - startTime;
                return {
                    success: true,
                    latencyMs,
                    message: `Google Gemini responded successfully (${res.response.text()?.trim() || 'OK'}).`,
                    modelUsed: candidateModel
                };
            }
            if (normProvider === 'claude') {
                const anthropic = new sdk_1.default({ apiKey: keyToTest });
                const candidateModel = modelToTest || 'claude-3-5-sonnet-20241022';
                const res = await anthropic.messages.create({
                    model: candidateModel,
                    max_tokens: 5,
                    messages: [{ role: 'user', content: 'Ping' }]
                });
                const latencyMs = Date.now() - startTime;
                const text = res.content[0]?.text || 'OK';
                return {
                    success: true,
                    latencyMs,
                    message: `Anthropic Claude responded successfully (${text.trim()}).`,
                    modelUsed: candidateModel
                };
            }
            if (normProvider === 'groq') {
                const groqOpenai = new openai_1.default({
                    apiKey: keyToTest,
                    baseURL: 'https://api.groq.com/openai/v1'
                });
                const candidateModel = modelToTest || 'llama-3.3-70b-versatile';
                const res = await groqOpenai.chat.completions.create({
                    model: candidateModel,
                    messages: [{ role: 'user', content: 'Ping' }],
                    max_tokens: 5
                });
                const latencyMs = Date.now() - startTime;
                return {
                    success: true,
                    latencyMs,
                    message: `Groq Cloud responded successfully (${res.choices[0]?.message?.content?.trim() || 'OK'}).`,
                    modelUsed: candidateModel
                };
            }
            if (normProvider === 'custom') {
                const url = endpointToTest || 'https://api.openai.com/v1';
                const customClient = new openai_1.default({
                    apiKey: keyToTest,
                    baseURL: url
                });
                const candidateModel = modelToTest || 'default';
                const res = await customClient.chat.completions.create({
                    model: candidateModel,
                    messages: [{ role: 'user', content: 'Ping' }],
                    max_tokens: 5
                });
                const latencyMs = Date.now() - startTime;
                return {
                    success: true,
                    latencyMs,
                    message: `Custom endpoint responded successfully.`,
                    modelUsed: candidateModel
                };
            }
            throw new Error(`Unsupported provider: ${provider}`);
        }
        catch (err) {
            const latencyMs = Date.now() - startTime;
            const errMsg = err?.response?.data?.error?.message || err?.message || 'Connection test failed';
            throw new Error(`Provider verification failed (${latencyMs}ms): ${errMsg}`);
        }
    }
    /**
     * Resolves active decrypted platform AI settings with 60s memory caching.
     * Used by AICompanyConfigService and the AI kernel during runtime execution.
     */
    static async getDecryptedPlatformAiSettings() {
        const now = Date.now();
        if (this.cachedDecrypted && this.cachedDecrypted.expiresAt > now) {
            return this.cachedDecrypted.settings;
        }
        const stored = await this.getStoredAiConfig();
        const settings = {
            defaultProvider: stored.defaultProvider || 'openai',
            openaiKey: '',
            geminiKey: '',
            claudeKey: '',
            groqKey: '',
            cartesiaKey: '',
            customAiKey: '',
            customAiUrl: '',
            customAiModel: '',
            models: {}
        };
        for (const [prov, rec] of Object.entries(stored.providers)) {
            if (!rec || !rec.encryptedKey || rec.isActive === false)
                continue;
            try {
                const decrypted = this.decryptApiKey(rec.encryptedKey, prov);
                if (prov === 'openai') {
                    settings.openaiKey = decrypted;
                    settings.models.openai = rec.model || DEFAULT_MODELS.openai;
                }
                else if (prov === 'gemini') {
                    settings.geminiKey = decrypted;
                    settings.models.gemini = rec.model || DEFAULT_MODELS.gemini;
                }
                else if (prov === 'claude') {
                    settings.claudeKey = decrypted;
                    settings.models.claude = rec.model || DEFAULT_MODELS.claude;
                }
                else if (prov === 'groq') {
                    settings.groqKey = decrypted;
                    settings.models.groq = rec.model || DEFAULT_MODELS.groq;
                }
                else if (prov === 'cartesia') {
                    settings.cartesiaKey = decrypted;
                    settings.models.cartesia = rec.model || DEFAULT_MODELS.cartesia;
                }
                else if (prov === 'custom') {
                    settings.customAiKey = decrypted;
                    settings.customAiUrl = rec.endpointUrl || '';
                    settings.customAiModel = rec.model || '';
                    settings.models.custom = rec.model;
                }
            }
            catch (err) {
                console.error(`[PlatformAiVault] Failed to decrypt ${prov} key from database:`, err.message);
            }
        }
        this.cachedDecrypted = {
            settings,
            expiresAt: now + this.CACHE_TTL_MS
        };
        return settings;
    }
}
exports.PlatformAiVaultService = PlatformAiVaultService;
