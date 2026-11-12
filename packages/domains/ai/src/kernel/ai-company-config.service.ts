// @ts-nocheck
import { prisma } from '@workspace/db';
import { aiProviderService, AISettings } from './ai-provider.service';
import { PlatformAiVaultService } from './platform-ai-vault.service';
import { ModelPurpose, modelDisplay, normalizeProvider, resolveModel } from './model-config';

/**
 * Which provider runs (pure, for tests).
 * - Director: AI_DIRECTOR_PROVIDER if it has a key, else the configured default (AI_PROVIDER / DEFAULT_AI_PROVIDER /
 *   vault default) if it has a key, else the first provider with a key in quality order: Claude, OpenAI, Gemini,
 *   Groq, custom. A director provider without a key is logged.
 * - Everything else (unchanged): the configured default if it has a key, else Gemini, OpenAI, Claude, Groq, custom.
 */
export function chooseAiProvider(p: { purpose?: ModelPurpose; configured: string; director?: string; hasKeyFor: (prov: string) => boolean }): string {
    const configured = normalizeProvider(p.configured);
    if (p.purpose === 'director') {
        const director = normalizeProvider(p.director);
        let chosen = '';
        if (director && p.hasKeyFor(director)) chosen = director;
        else if (configured && p.hasKeyFor(configured)) chosen = configured;
        else chosen = ['claude', 'openai', 'gemini', 'groq', 'custom'].find(p.hasKeyFor) || configured || 'claude';
        if (director && director !== chosen) console.warn(`[AI config] AI_DIRECTOR_PROVIDER="${director}" has no key; the Director uses "${chosen}"`);
        return chosen;
    }
    if (configured && p.hasKeyFor(configured)) return configured;
    return ['gemini', 'openai', 'claude', 'groq', 'custom'].find(p.hasKeyFor) || configured || 'openai';
}

export interface CompanyAIStatus {
    isConfigured: boolean;
    provider: string;
    model: string;
    status: 'connected' | 'ready' | 'unconfigured' | 'error';
    /** The model the AI Director plans edits with (provider · model id). */
    directorModel?: string;
    lastTested: string | null;
    companyName?: string;
}

export class AICompanyConfigService {
    /**
     * Resolves the company AI configuration and returns typed AISettings.
     * All AI keys are sourced natively and exclusively from server environment variables (.env)
     * or the secure platform vault. Tenant metadata BYOK overrides are removed.
     */
    static async getCompanyAISettings(companyId?: string, opts: { purpose?: ModelPurpose } = {}): Promise<{ settings: AISettings; companyName: string; metadata: any }> {
        let metadata: any = {};
        let companyRecord: any = null;

        if (companyId) {
            try {
                companyRecord = await prisma.company.findUnique({ where: { id: companyId } });
            } catch (e) {
                companyRecord = null;
            }
        }

        if (companyRecord) {
            let meta = companyRecord?.metadata || {};
            if (typeof meta === 'string') {
                try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
            }
            if (typeof meta === 'string') {
                try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
            }
            metadata = meta;
        }

        const companyName = companyRecord?.name || '180 Workspace Enterprise';

        // Load decrypted database-backed platform vault keys if present
        let platformVault: any = {};
        try {
            platformVault = await PlatformAiVaultService.getDecryptedPlatformAiSettings();
        } catch (e) {
            platformVault = {};
        }

        // Native Server Environment: all AI keys come directly from process.env (or secure platform vault)
        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || platformVault.geminiKey || '';
        const openaiKey = process.env.OPENAI_API_KEY || platformVault.openaiKey || '';
        const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || platformVault.claudeKey || '';
        const groqKey = process.env.GROQ_API_KEY || platformVault.groqKey || '';
        const cartesiaKey = process.env.CARTESIA_API_KEY || platformVault.cartesiaKey || '';
        const customAiKey = process.env.CUSTOM_AI_KEY || platformVault.customAiKey || '';
        const customAiUrl = process.env.CUSTOM_AI_URL || platformVault.customAiUrl || '';
        const customAiModel = process.env.CUSTOM_AI_MODEL || platformVault.customAiModel || '';

        // Provider precedence:
        // 1. Explicit env configuration (AI_PROVIDER or DEFAULT_AI_PROVIDER) IF that provider has a key
        // 2. Auto-fallback to any provider that has a valid API key configured in .env
        const configuredProvider = (process.env.AI_PROVIDER || process.env.DEFAULT_AI_PROVIDER || platformVault.defaultProvider || '').toLowerCase().trim();
        let aiProvider = configuredProvider;

        const hasKeyFor = (prov: string) => {
            if (prov === 'gemini') return !!geminiKey;
            if (prov === 'openai') return !!openaiKey;
            if (prov === 'claude') return !!claudeKey;
            if (prov === 'groq') return !!groqKey;
            if (prov === 'custom') return !!(customAiKey && customAiUrl);
            return false;
        };

        aiProvider = chooseAiProvider({ purpose: opts.purpose, configured: configuredProvider, director: process.env.AI_DIRECTOR_PROVIDER, hasKeyFor });

        const settings: AISettings = {
            aiProvider,
            geminiKey,
            openaiKey,
            claudeKey,
            groqKey,
            cartesiaKey,
            customAiKey,
            customAiUrl,
            customAiModel,
            models: platformVault.models || {}
        };

        return { settings, companyName, metadata };
    }

    /**
     * Gets the high-level AI status for frontend indicators
     */
    static async getStatus(companyId?: string): Promise<CompanyAIStatus> {
        const { settings, metadata, companyName } = await this.getCompanyAISettings(companyId);
        const provider = settings.aiProvider || 'openai';

        const hasKey = (
            (provider === 'gemini' && !!settings.geminiKey) ||
            (provider === 'openai' && !!settings.openaiKey) ||
            (provider === 'claude' && !!settings.claudeKey) ||
            (provider === 'groq' && !!settings.groqKey) ||
            (provider === 'custom' && !!settings.customAiKey && !!settings.customAiUrl)
        );

        const isConfigured = hasKey;

        // The models that actually run (env → saved choice → default), not a hardcoded label.
        const model = provider === 'custom' && settings.customAiModel ? settings.customAiModel : resolveModel(provider, 'general', { vaultModels: settings.models });
        const director = (await this.getCompanyAISettings(companyId, { purpose: 'director' })).settings;
        const directorModel = modelDisplay(director.aiProvider, resolveModel(director.aiProvider, 'director', { vaultModels: director.models }));

        return {
            isConfigured,
            provider,
            model: modelDisplay(provider, model),
            directorModel,
            status: isConfigured ? 'ready' : 'unconfigured',
            lastTested: metadata?.lastAiTestDate ? new Date(metadata.lastAiTestDate).toISOString() : new Date().toISOString(),
            companyName
        };
    }

    /**
     * Returns a safe summary of AI provider configurations.
     */
    static async getCompanyAISummary(companyId?: string) {
        const { settings, companyName } = await this.getCompanyAISettings(companyId);
        const mask = (key?: string) => {
            if (!key || key.length < 8) return null;
            return key.slice(0, 4) + '••••••••' + key.slice(-4);
        };

        const activeProvider = settings.aiProvider || 'openai';
        const label = (prov: string, name: string) => `${name} (${resolveModel(prov, 'general', { vaultModels: settings.models })})`;
        const hasActiveKey = (
            (activeProvider === 'builtin') ||
            (activeProvider === 'gemini' && !!settings.geminiKey) ||
            (activeProvider === 'openai' && !!settings.openaiKey) ||
            (activeProvider === 'claude' && !!settings.claudeKey) ||
            (activeProvider === 'groq' && !!settings.groqKey) ||
            (activeProvider === 'custom' && !!settings.customAiKey && !!settings.customAiUrl)
        );

        return {
            aiProvider: activeProvider,
            isConfigured: hasActiveKey,
            companyName,
            providers: {
                builtin: {
                    displayName: '180 Studio Native AI',
                    isConfigured: true,
                    keyPreview: 'Active',
                    isDefault: activeProvider === 'builtin',
                },
                gemini: {
                    displayName: label('gemini', 'Google Gemini'),
                    isConfigured: !!settings.geminiKey,
                    keyPreview: mask(settings.geminiKey),
                    isDefault: activeProvider === 'gemini',
                },
                openai: {
                    displayName: label('openai', 'OpenAI'),
                    isConfigured: !!settings.openaiKey,
                    keyPreview: mask(settings.openaiKey),
                    isDefault: activeProvider === 'openai',
                },
                claude: {
                    displayName: label('claude', 'Anthropic Claude'),
                    isConfigured: !!settings.claudeKey,
                    keyPreview: mask(settings.claudeKey),
                    isDefault: activeProvider === 'claude',
                },
                groq: {
                    displayName: label('groq', 'Groq Cloud'),
                    isConfigured: !!settings.groqKey,
                    keyPreview: mask(settings.groqKey),
                    isDefault: activeProvider === 'groq',
                },
            },
        };
    }

    /**
     * Updates company AI configuration - now a safe no-op since platform strictly uses native server env keys.
     */
    static async updateCompanyAISettings(companyId: string, updates: any) {
        if (!companyId) throw new Error('Company ID is required');
        return this.getCompanyAISummary(companyId);
    }
}
