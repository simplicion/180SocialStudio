"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AiService = exports.aiProviderService = exports.AIProviderService = void 0;
const generative_ai_1 = require("@google/generative-ai");
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class AIProviderService {
    static instance;
    static getInstance() {
        if (!AIProviderService.instance) {
            AIProviderService.instance = new AIProviderService();
        }
        return AIProviderService.instance;
    }
    /**
     * Instantiates an active LLM client from configured company settings.
     * All providers now support `generate`, `generateStream`, and `generateWithTools`.
     */
    async getClient(settings) {
        if (!settings || !settings.aiProvider || settings.aiProvider === 'none')
            return null;
        const provider = settings.aiProvider;
        try {
            if (provider === 'gemini') {
                const key = (settings.geminiKey || '').trim();
                if (!key)
                    return null;
                const genAI = new generative_ai_1.GoogleGenerativeAI(key);
                const candidateModels = [
                    'gemini-1.5-flash',
                    'gemini-1.5-flash-latest',
                    'gemini-2.0-flash',
                    'gemini-1.5-pro',
                    'gemini-pro'
                ];
                return {
                    provider: 'gemini',
                    generate: async (prompt, options = {}) => {
                        const generationConfig = options.max_tokens ? { maxOutputTokens: options.max_tokens } : {};
                        let lastErr = null;
                        for (const modelName of candidateModels) {
                            try {
                                const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
                                const result = await model.generateContent(prompt);
                                return result.response.text();
                            }
                            catch (err) {
                                lastErr = err;
                            }
                        }
                        throw lastErr || new Error('All Gemini candidate models failed.');
                    },
                    generateStream: async (prompt, options = {}, onChunk) => {
                        const generationConfig = options.max_tokens ? { maxOutputTokens: options.max_tokens } : {};
                        let lastErr = null;
                        for (const modelName of candidateModels) {
                            try {
                                const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
                                const result = await model.generateContentStream(prompt);
                                let text = '';
                                for await (const chunk of result.stream) {
                                    const chunkText = chunk.text();
                                    text += chunkText;
                                    if (onChunk)
                                        onChunk(chunkText);
                                }
                                return text;
                            }
                            catch (err) {
                                lastErr = err;
                            }
                        }
                        throw lastErr || new Error('All Gemini candidate models failed.');
                    },
                    generateWithTools: async (prompt, tools = [], options = {}) => {
                        const generationConfig = options.max_tokens ? { maxOutputTokens: options.max_tokens } : {};
                        const functionDeclarations = (tools || []).map((t) => ({
                            name: t.function?.name || t.name,
                            description: t.function?.description || t.description,
                            parameters: t.function?.parameters || t.parameters || { type: 'object', properties: {} }
                        }));
                        let lastErr = null;
                        for (const modelName of candidateModels) {
                            try {
                                const model = genAI.getGenerativeModel({
                                    model: modelName,
                                    tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
                                    generationConfig
                                });
                                const result = await model.generateContent(prompt);
                                const response = result.response;
                                let text = '';
                                try {
                                    text = response.text() || '';
                                }
                                catch (e) {
                                    // Response may only contain function call parts
                                    text = '';
                                }
                                const functionCalls = typeof response.functionCalls === 'function' ? response.functionCalls() : [];
                                const toolCalls = (functionCalls || []).map((fc, idx) => ({
                                    id: `gemini_${Date.now()}_${idx}`,
                                    name: fc.name,
                                    args: fc.args || {}
                                }));
                                return {
                                    text,
                                    toolCalls: toolCalls.length > 0 ? toolCalls : undefined
                                };
                            }
                            catch (err) {
                                lastErr = err;
                            }
                        }
                        // Fallback to text generation if tool execution fails
                        return { text: '' };
                    }
                };
            }
            if (provider === 'openai') {
                const key = (settings.openaiKey || '').trim();
                if (!key)
                    return null;
                const openai = new openai_1.default({ apiKey: key });
                return {
                    provider: 'openai',
                    generate: async (prompt, options = {}) => {
                        const reqOptions = {
                            messages: [{ role: 'user', content: prompt }],
                            model: options.model || 'gpt-4o',
                            temperature: options.temperature || 0.7
                        };
                        if (options.max_tokens)
                            reqOptions.max_tokens = options.max_tokens;
                        const completion = await openai.chat.completions.create(reqOptions);
                        return completion.choices[0]?.message?.content || '';
                    },
                    generateStream: async (prompt, options = {}, onChunk) => {
                        const reqOptions = {
                            messages: [{ role: 'user', content: prompt }],
                            model: options.model || 'gpt-4o',
                            stream: true,
                            temperature: options.temperature || 0.7
                        };
                        if (options.max_tokens)
                            reqOptions.max_tokens = options.max_tokens;
                        const stream = await openai.chat.completions.create(reqOptions);
                        let text = '';
                        for await (const chunk of stream) {
                            const content = chunk.choices[0]?.delta?.content || '';
                            text += content;
                            if (onChunk && content)
                                onChunk(content);
                        }
                        return text;
                    },
                    generateWithTools: async (prompt, tools = [], options = {}) => {
                        const reqOptions = {
                            messages: [{ role: 'user', content: prompt }],
                            model: options.model || 'gpt-4o',
                            temperature: options.temperature || 0.2
                        };
                        if (tools && tools.length > 0)
                            reqOptions.tools = tools;
                        if (options.max_tokens)
                            reqOptions.max_tokens = options.max_tokens;
                        const completion = await openai.chat.completions.create(reqOptions);
                        const msg = completion.choices[0]?.message;
                        const toolCalls = (msg?.tool_calls || []).map((tc) => ({
                            id: tc.id,
                            name: tc.function?.name,
                            args: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function?.arguments || {})
                        }));
                        return {
                            text: msg?.content || '',
                            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
                        };
                    }
                };
            }
            if (provider === 'claude') {
                const key = (settings.claudeKey || '').trim();
                if (!key)
                    return null;
                const anthropic = new sdk_1.default({ apiKey: key });
                return {
                    provider: 'claude',
                    generate: async (prompt, options = {}) => {
                        const reqOptions = {
                            model: options.model || 'claude-3-5-sonnet-20240620',
                            max_tokens: options.max_tokens || 1024,
                            messages: [{ role: 'user', content: prompt }]
                        };
                        const msg = await anthropic.messages.create(reqOptions);
                        return msg.content[0]?.text || '';
                    },
                    generateStream: async (prompt, options = {}, onChunk) => {
                        const reqOptions = {
                            model: options.model || 'claude-3-5-sonnet-20240620',
                            max_tokens: options.max_tokens || 1024,
                            messages: [{ role: 'user', content: prompt }],
                            stream: true
                        };
                        const stream = await anthropic.messages.create(reqOptions);
                        let text = '';
                        for await (const event of stream) {
                            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                                const chunk = event.delta.text;
                                text += chunk;
                                if (onChunk)
                                    onChunk(chunk);
                            }
                        }
                        return text;
                    },
                    generateWithTools: async (prompt, tools = [], options = {}) => {
                        const claudeTools = tools.map((t) => ({
                            name: t.function?.name || t.name,
                            description: t.function?.description || t.description,
                            input_schema: t.function?.parameters || t.parameters || { type: 'object', properties: {} }
                        }));
                        const reqOptions = {
                            model: options.model || 'claude-3-5-sonnet-20240620',
                            max_tokens: options.max_tokens || 1024,
                            messages: [{ role: 'user', content: prompt }]
                        };
                        if (claudeTools.length > 0)
                            reqOptions.tools = claudeTools;
                        const msg = await anthropic.messages.create(reqOptions);
                        const textBlock = msg.content.find((c) => c.type === 'text');
                        const toolUseBlocks = msg.content.filter((c) => c.type === 'tool_use');
                        const toolCalls = toolUseBlocks.map(tb => ({
                            id: tb.id,
                            name: tb.name,
                            args: tb.input || {}
                        }));
                        return {
                            text: textBlock?.text || '',
                            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
                        };
                    }
                };
            }
            if (provider === 'custom') {
                const key = (settings.customAiKey || '').trim();
                const baseURL = (settings.customAiUrl || '').trim();
                if (!key || !baseURL)
                    return null;
                const customOpenAI = new openai_1.default({
                    apiKey: key,
                    baseURL
                });
                return {
                    provider: 'custom',
                    generate: async (prompt, options = {}) => {
                        const reqOptions = {
                            messages: [{ role: 'user', content: prompt }],
                            model: settings.customAiModel || options.model || 'default-model',
                            temperature: options.temperature || 0.7
                        };
                        if (options.max_tokens)
                            reqOptions.max_tokens = options.max_tokens;
                        const completion = await customOpenAI.chat.completions.create(reqOptions);
                        return completion.choices[0]?.message?.content || '';
                    },
                    generateStream: async (prompt, options = {}, onChunk) => {
                        const reqOptions = {
                            messages: [{ role: 'user', content: prompt }],
                            model: settings.customAiModel || options.model || 'default-model',
                            stream: true,
                            temperature: options.temperature || 0.7
                        };
                        if (options.max_tokens)
                            reqOptions.max_tokens = options.max_tokens;
                        const stream = await customOpenAI.chat.completions.create(reqOptions);
                        let text = '';
                        for await (const chunk of stream) {
                            const content = chunk.choices[0]?.delta?.content || '';
                            text += content;
                            if (onChunk && content)
                                onChunk(content);
                        }
                        return text;
                    },
                    generateWithTools: async (prompt, tools = [], options = {}) => {
                        const reqOptions = {
                            messages: [{ role: 'user', content: prompt }],
                            model: settings.customAiModel || options.model || 'default-model',
                            temperature: options.temperature || 0.2
                        };
                        if (tools && tools.length > 0)
                            reqOptions.tools = tools;
                        if (options.max_tokens)
                            reqOptions.max_tokens = options.max_tokens;
                        const completion = await customOpenAI.chat.completions.create(reqOptions);
                        const msg = completion.choices[0]?.message;
                        const toolCalls = (msg?.tool_calls || []).map((tc) => ({
                            id: tc.id,
                            name: tc.function?.name,
                            args: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function?.arguments || {})
                        }));
                        return {
                            text: msg?.content || '',
                            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
                        };
                    }
                };
            }
        }
        catch (error) {
            console.error('[AIProviderService] Error initializing AI client:', error);
            return null;
        }
        return null;
    }
    /**
     * Convenience method: Generate insights using the company's AI provider.
     * Direct port of old `aiService.getInsights()`.
     */
    async getInsights(prompt, settings, options = {}) {
        const client = await this.getClient(settings);
        if (!client) {
            return 'AI Insights currently unavailable. Please configure your AI provider in Settings.';
        }
        try {
            return await client.generate(prompt, options);
        }
        catch (err) {
            console.error(`[AIProviderService] Insight generation failed (${client.provider}):`, err.message);
            return 'Failed to generate AI insights. Please check your API key and connection settings.';
        }
    }
    /**
     * Convenience method: Stream insights using the company's AI provider.
     * Direct port of old `aiService.getInsightsStream()`.
     */
    async getInsightsStream(prompt, settings, options = {}, onChunk) {
        const client = await this.getClient(settings);
        if (!client) {
            const msg = 'AI Insights currently unavailable. Please configure your AI provider in Settings.';
            if (onChunk)
                onChunk(msg);
            return msg;
        }
        try {
            if (!client.generateStream) {
                const res = await client.generate(prompt, options);
                if (onChunk)
                    onChunk(res);
                return res;
            }
            return await client.generateStream(prompt, options, onChunk);
        }
        catch (err) {
            console.error(`[AIProviderService] Insight streaming failed (${client.provider}):`, err.message);
            const errMsg = 'Failed to generate AI insights. Please check your API key and connection settings.';
            if (onChunk)
                onChunk(errMsg);
            return errMsg;
        }
    }
    /**
     * Live test connection for any provider
     */
    async testConnection(provider, apiKey, customUrl, customModel) {
        const trimmedKey = (apiKey || '').trim();
        if (!trimmedKey) {
            throw new Error('API Key is required.');
        }
        if (provider === 'gemini') {
            if (trimmedKey.startsWith('AQ.') || trimmedKey.startsWith('ya29.')) {
                throw new Error('The key entered appears to be an OAuth Access Token. The Gemini API expects an API Key generated from Google AI Studio (https://aistudio.google.com/app/apikey), which typically starts with "AIzaSy...". If using Vertex/Cloud, select the "Custom (Unified)" provider.');
            }
            const genAI = new generative_ai_1.GoogleGenerativeAI(trimmedKey);
            const candidateModels = [
                'gemini-1.5-flash',
                'gemini-1.5-flash-latest',
                'gemini-2.0-flash',
                'gemini-1.5-pro',
                'gemini-pro'
            ];
            let lastErr = null;
            for (const modelName of candidateModels) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent("Say '180 Workspace AI Connection Successful'");
                    const text = result.response.text();
                    if (text) {
                        return { success: true, message: `Connected to Google Gemini (${modelName})`, text };
                    }
                }
                catch (err) {
                    lastErr = err;
                }
            }
            const msg = lastErr?.message || '';
            if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
                throw new Error('Invalid Gemini API Key. Please verify key from Google AI Studio (https://aistudio.google.com/app/apikey).');
            }
            if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
                throw new Error('Gemini API Quota Exceeded. Please check your project billing or rate limits.');
            }
            throw new Error(`Gemini connection error: ${msg}`);
        }
        if (provider === 'openai') {
            const openai = new openai_1.default({ apiKey: trimmedKey });
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: "Say '180 Workspace AI Connection Successful'" }],
                max_tokens: 20
            });
            return {
                success: true,
                message: 'Connected to OpenAI',
                text: response.choices[0]?.message?.content || ''
            };
        }
        if (provider === 'claude') {
            const anthropic = new sdk_1.default({ apiKey: trimmedKey });
            const response = await anthropic.messages.create({
                model: 'claude-3-5-sonnet-20240620',
                messages: [{ role: 'user', content: "Say '180 Workspace AI Connection Successful'" }],
                max_tokens: 20
            });
            const block = response.content[0];
            return {
                success: true,
                message: 'Connected to Anthropic Claude',
                text: block.type === 'text' ? block.text : ''
            };
        }
        if (provider === 'custom') {
            if (!customUrl)
                throw new Error('Custom Base URL is required.');
            const customOpenAI = new openai_1.default({ apiKey: trimmedKey, baseURL: customUrl.trim() });
            const response = await customOpenAI.chat.completions.create({
                model: customModel || 'default-model',
                messages: [{ role: 'user', content: "Say '180 Workspace AI Connection Successful'" }],
                max_tokens: 20
            });
            return {
                success: true,
                message: 'Connected to Custom AI Endpoint',
                text: response.choices[0]?.message?.content || ''
            };
        }
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
}
exports.AIProviderService = AIProviderService;
exports.aiProviderService = AIProviderService.getInstance();
exports.AiService = AIProviderService;
exports.aiService = exports.aiProviderService;
