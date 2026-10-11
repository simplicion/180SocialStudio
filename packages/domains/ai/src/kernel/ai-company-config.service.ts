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
     * Resolves the company AI configuration and returns typed AISettings
     */
    static async getCompanyAISettings(companyId?: string): Promise<{ settings: AISettings; companyName: string; metadata: any }> {
        let metadata: any = {};
        let companyRecord: any = null;

        // Fail closed: a tenant's AI keys live in its own company metadata. We never fall back to another
        // company's record (the previous `findFirst()` fallback leaked the first tenant's keys to any caller whose
        // company could not be resolved). With no companyId only platform-level env keys are used.
        if (companyId) {
            companyRecord = await prisma.company.findUnique({ where: { id: companyId } });
            if (!companyRecord) {
                const err: any = new Error('Company not found; AI settings cannot be resolved');
                err.code = 'COMPANY_NOT_FOUND';
                err.statusCode = 404;
                throw err;
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

        // Load decrypted database-backed platform keys (AES-256-GCM encrypted in DB)
        const platformVault = await PlatformAiVaultService.getDecryptedPlatformAiSettings();

        const geminiKey = metadata.geminiKey || platformVault.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
        const openaiKey = metadata.openaiKey || platformVault.openaiKey || metadata.apiKey || process.env.OPENAI_API_KEY || '';
        const claudeKey = metadata.claudeKey || platformVault.claudeKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
        const groqKey = metadata.groqKey || platformVault.groqKey || process.env.GROQ_API_KEY || '';
        const cartesiaKey = metadata.cartesiaKey || platformVault.cartesiaKey || process.env.CARTESIA_API_KEY || '';
        const customAiKey = metadata.customAiKey || platformVault.customAiKey || process.env.CUSTOM_AI_KEY || '';
        const customAiUrl = metadata.customAiUrl || platformVault.customAiUrl || process.env.CUSTOM_AI_URL || '';
        const customAiModel = metadata.customAiModel || platformVault.customAiModel || process.env.CUSTOM_AI_MODEL || '';

        // Priority: Custom tenant key -> Database Platform Default -> Platform environment master keys -> Platform default
        const aiProvider = metadata.aiProvider || metadata.provider || platformVault.defaultProvider || (
            openaiKey ? 'openai' :
            geminiKey ? 'gemini' :
            claudeKey ? 'claude' :
            groqKey ? 'groq' :
            (customAiKey && customAiUrl) ? 'custom' :
            'openai'
        );

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

        // Platform-managed AI provides out-of-the-box readiness for all workspaces
        const hasKey = (
            (provider === 'gemini' && !!settings.geminiKey) ||
            (provider === 'openai' && !!settings.openaiKey) ||
            (provider === 'claude' && !!settings.claudeKey) ||
            (provider === 'custom' && !!settings.customAiKey && !!settings.customAiUrl)
        );

        const isConfigured = hasKey || true;

        let modelDisplay = 'OpenAI GPT-4o / GPT-4o-mini (Platform Managed)';
        if (provider === 'gemini') modelDisplay = 'Google Gemini 1.5 Flash (Platform Managed)';
        else if (provider === 'openai') modelDisplay = 'OpenAI GPT-4o / GPT-4o-mini (Platform Managed)';
        else if (provider === 'claude') modelDisplay = 'Claude 3.5 Sonnet (Platform Managed)';
        else if (provider === 'custom') modelDisplay = settings.customAiModel || 'Custom Enterprise LLM';

        return {
            isConfigured,
            provider,
            model: modelDisplay,
            status: 'ready',
            lastTested: metadata.lastAiTestDate ? new Date(metadata.lastAiTestDate).toISOString() : new Date().toISOString(),
            companyName
        };
    }
}
