// @ts-nocheck
import { prisma } from '@workspace/db';
import { aiProviderService, AISettings } from './ai-provider.service';
import { PlatformAiVaultService } from './platform-ai-vault.service';

export interface CompanyAIStatus {
    isConfigured: boolean;
    provider: string;
    model: string;
    status: 'connected' | 'ready' | 'unconfigured' | 'error';
    lastTested: string | null;
    companyName?: string;
}

export class AICompanyConfigService {
    /**
     * Resolves the company AI configuration and returns typed AISettings.
     * All AI keys are sourced natively and exclusively from server environment variables (.env)
     * or the secure platform vault. Tenant metadata BYOK overrides are removed.
     */
    static async getCompanyAISettings(companyId?: string): Promise<{ settings: AISettings; companyName: string; metadata: any }> {
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

        if (!hasKeyFor(aiProvider)) {
            if (geminiKey) aiProvider = 'gemini';
            else if (openaiKey) aiProvider = 'openai';
            else if (claudeKey) aiProvider = 'claude';
            else if (groqKey) aiProvider = 'groq';
            else if (customAiKey && customAiUrl) aiProvider = 'custom';
            else aiProvider = configuredProvider || 'openai';
        }

        const settings: AISettings = {
            aiProvider,
            geminiKey,
            openaiKey,
            claudeKey,
            groqKey,
            cartesiaKey,
            customAiKey,
            customAiUrl,
            customAiModel
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

        let modelDisplay = 'OpenAI GPT-4o / GPT-4o-mini (Platform Native)';
        if (provider === 'gemini') modelDisplay = 'Google Gemini 1.5 Flash (Platform Native)';
        else if (provider === 'openai') modelDisplay = 'OpenAI GPT-4o / GPT-4o-mini (Platform Native)';
        else if (provider === 'claude') modelDisplay = 'Claude 3.5 Sonnet (Platform Native)';
        else if (provider === 'groq') modelDisplay = 'Groq Cloud Llama 3.3 (Platform Native)';
        else if (provider === 'custom') modelDisplay = settings.customAiModel || 'Custom Enterprise LLM';

        return {
            isConfigured,
            provider,
            model: modelDisplay,
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
                    displayName: 'Google Gemini (1.5 Flash / Pro)',
                    isConfigured: !!settings.geminiKey,
                    keyPreview: mask(settings.geminiKey),
                    isDefault: activeProvider === 'gemini',
                },
                openai: {
                    displayName: 'OpenAI (GPT-4o / GPT-4o-mini)',
                    isConfigured: !!settings.openaiKey,
                    keyPreview: mask(settings.openaiKey),
                    isDefault: activeProvider === 'openai',
                },
                claude: {
                    displayName: 'Anthropic Claude (3.5 Sonnet)',
                    isConfigured: !!settings.claudeKey,
                    keyPreview: mask(settings.claudeKey),
                    isDefault: activeProvider === 'claude',
                },
                groq: {
                    displayName: 'Groq Cloud (Llama 3.3)',
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
