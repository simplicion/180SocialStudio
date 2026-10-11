'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, Sparkles, Send, Bot, User, Loader2, GripVertical,
    Minimize2, Maximize2, Layout, FileText, Globe, Layers,
    CheckCircle2, RefreshCw, Palette, HelpCircle, ArrowRight,
    Copy, Check, ExternalLink, ShieldCheck, ChevronRight, Code2
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { AILogo, AILogoIcon } from './AILogo';

export type AIDrawerMode = 'form' | 'website' | 'document' | 'general';

export interface UniversalAIDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    mode: AIDrawerMode;
    entityId?: string;
    entityName?: string;
    stateContext?: any;
    onApply?: (data: any) => void;
    apiClient?: {
        get: (url: string, config?: any) => Promise<any>;
        post: (url: string, data?: any, config?: any) => Promise<any>;
    };
    customEndpoint?: string;
    customTitle?: string;
    customSubtitle?: string;
    showBackdrop?: boolean;
}

interface Message {
    id: string;
    sender: 'assistant' | 'user';
    text: string;
    timestamp: string;
    astData?: any;
}

const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 360;
const MAX_WIDTH = 960;

const MODE_CONFIG: Record<AIDrawerMode, {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    themeGradient: string;
    welcomeText: (name?: string) => string;
    quickPrompts: { label: string; prompt: string }[];
    endpoint: string;
}> = {
    form: {
        title: 'AI Form Architect',
        subtitle: 'Live Dynamic Question & Theme Engine',
        icon: <Layers className="w-4 h-4 text-violet-300" />,
        themeGradient: 'from-violet-600 via-indigo-600 to-purple-600',
        welcomeText: (name) => `👋 Hello! I am your **180 Workspace AI Form Architect**.\n\nI have full live awareness of your form${name ? ` **"${name}"**` : ''}. Instruct me to generate new questions, change color themes, add 5-star ratings or resume uploads, or split your form into multi-step pages.`,
        quickPrompts: [
            { label: '📋 Client Onboarding', prompt: 'Build a comprehensive Client Onboarding form with contact info, company size, budget range, timeline, and requirements' },
            { label: '💼 Job Application with Resume', prompt: 'Create a job application form with role selection, experience years, portfolio link, and resume file upload' },
            { label: '⭐ NPS & Customer Feedback', prompt: 'Generate a customer satisfaction & Net Promoter Score survey with 5-star rating questions' },
            { label: '🪔 Festive Diwali Contest', prompt: 'Create a Diwali festive promotional contest form with discount claims and WhatsApp number' },
            { label: '🟢 Emerald Green Theme', prompt: 'Switch the form accent color to emerald green (#059669) and change button text to "Submit Application"' },
            { label: '➕ Add Rating & File Upload', prompt: 'Add a 5-star experience rating question and supporting document file upload field' }
        ],
        endpoint: '/api/v1/ai/forms/patch'
    },
    website: {
        title: 'AI Website Architect',
        subtitle: 'Live Landing Page & AST Synthesizer',
        icon: <Globe className="w-4 h-4 text-indigo-300" />,
        themeGradient: 'from-indigo-600 via-blue-600 to-purple-600',
        welcomeText: (name) => `👋 Hello! I am your **180 Workspace AI Website Architect**.\n\nI have full live awareness of your website canvas${name ? ` **"${name}"**` : ''}. Instruct me to generate complete landing pages, change visual themes, add pricing matrices, or insert customer testimonials.`,
        quickPrompts: [
            { label: '🚀 SaaS Landing Page', prompt: 'Generate a high-converting modern dark-mode SaaS landing page with hero, 3 feature cards, pricing tiers, and contact CTA' },
            { label: '🪔 Festive Diwali Campaign', prompt: 'Build a festive Diwali promotional campaign page with 40% discount offer cards, value props, and lead form' },
            { label: '⭐ Add Customer Testimonials', prompt: 'Add a customer testimonials and social proof review section with 5-star ratings' },
            { label: '🟢 Switch to Emerald Theme', prompt: 'Switch the visual theme to emerald green (#10b981) with modern glassmorphism' },
            { label: '🟣 Switch to Royal Purple', prompt: 'Change visual theme to royal purple (#8b5cf6) with dark slate background' },
            { label: '💰 Add Pricing Matrix', prompt: 'Add a 3-tier pricing matrix: Starter $29, Growth $79, Enterprise $199' }
        ],
        endpoint: '/api/v1/ai/websites/patch'
    },
    document: {
        title: 'AI Document Architect',
        subtitle: 'Live Contract & Report Synthesizer',
        icon: <FileText className="w-4 h-4 text-emerald-300" />,
        themeGradient: 'from-emerald-600 via-teal-600 to-cyan-600',
        welcomeText: (name) => `👋 Hello! I am your **180 Workspace AI Document Architect**.\n\nI can draft corporate contracts, proposals, executive summaries, and legal clauses with full context awareness of ${name ? `**"${name}"**` : 'your active document'}.`,
        quickPrompts: [
            { label: '📄 Client Proposal', prompt: 'Draft a comprehensive client proposal with scope of work, timeline milestones, and investment breakdown' },
            { label: '💼 Master Service Agreement', prompt: 'Generate a standard Master Service Agreement with payment terms, IP assignment, and liability clauses' },
            { label: '📊 Executive Summary', prompt: 'Synthesize an executive summary highlighting key quarterly business goals and risk mitigation' },
            { label: '✍️ Polish & Professional Tone', prompt: 'Rewrite this document with executive-level corporate clarity and persuasive tone' },
            { label: '📋 Add Signature Block', prompt: 'Add a formal two-party signing block with dates and legal representations' }
        ],
        endpoint: '/api/v1/ai/documents/generate-section'
    },
    general: {
        title: 'Orbit Copilot',
        subtitle: 'Powered by Orbit Intelligence',
        icon: <Sparkles className="w-4 h-4 text-amber-300" />,
        themeGradient: 'from-indigo-600 via-purple-600 to-pink-600',
        welcomeText: () => `👋 Hello! I am your **Orbit Copilot**.\n\nHow can I help you automate, design, or execute today?`,
        quickPrompts: [
            { label: '⚡ Summarize Context', prompt: 'Summarize the key objectives and action items for this workspace.' },
            { label: '📈 Sales Forecast', prompt: 'Analyze our current pipeline and provide revenue projections.' },
            { label: '📧 Draft Outreach Email', prompt: 'Draft a high-converting cold email for prospective enterprise clients.' }
        ],
        endpoint: '/api/v1/ai/chat'
    }
};

export function UniversalAIDrawer({
    isOpen,
    onClose,
    mode,
    entityId,
    entityName,
    stateContext,
    onApply,
    apiClient,
    customEndpoint,
    customTitle,
    customSubtitle,
    showBackdrop = false
}: UniversalAIDrawerProps) {
    const config = MODE_CONFIG[mode] || MODE_CONFIG.general;

    // Width State & Resizing
    const [drawerWidth, setDrawerWidth] = useState<number>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('180_ai_drawer_width');
            if (saved) {
                const parsed = parseInt(saved, 10);
                if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
                    return parsed;
                }
            }
        }
        return DEFAULT_WIDTH;
    });

    const [isResizing, setIsResizing] = useState(false);
    const [inputPrompt, setInputPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            sender: 'assistant',
            text: config.welcomeText(entityName),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
    ]);

    const [aiStatus, setAiStatus] = useState<{ isConfigured: boolean; model: string }>({
        isConfigured: true,
        model: 'Google Gemini 1.5 Flash'
    });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Fetch AI System Status on Mount
    useEffect(() => {
        if (isOpen) {
            const fetchStatus = async () => {
                try {
                    let res: any = null;
                    if (apiClient) {
                        res = await apiClient.get('/api/v1/ai/status');
                    } else if (typeof window !== 'undefined') {
                        const raw = await fetch('/api/v1/ai/status');
                        res = await raw.json();
                    }
                    if (res?.data || res) {
                        const data = res.data || res;
                        setAiStatus({
                            isConfigured: data.isConfigured !== false,
                            model: data.model || 'Google Gemini 1.5 Flash'
                        });
                    }
                } catch {
                    // Default fallback
                }
            };
            fetchStatus();
        }
    }, [isOpen, apiClient]);

    // Scroll to bottom on message updates
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    // Resizing Handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const newWidth = window.innerWidth - e.clientX;
            const clamped = Math.min(Math.max(newWidth, MIN_WIDTH), Math.min(MAX_WIDTH, window.innerWidth - 80));
            setDrawerWidth(clamped);
        };

        const handleMouseUp = () => {
            if (isResizing) {
                setIsResizing(false);
                localStorage.setItem('180_ai_drawer_width', drawerWidth.toString());
            }
        };

        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, drawerWidth]);

    const handleSetPresetWidth = (width: number) => {
        setDrawerWidth(width);
        localStorage.setItem('180_ai_drawer_width', width.toString());
    };

    if (!isOpen) return null;

    const handleSendPrompt = async (promptToSend?: string) => {
        const query = (promptToSend || inputPrompt).trim();
        if (!query || isLoading) return;

        const userMsg: Message = {
            id: `user-${Date.now()}`,
            sender: 'user',
            text: query,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => [...prev, userMsg]);
        if (!promptToSend) setInputPrompt('');
        setIsLoading(true);

        const endpoint = customEndpoint || config.endpoint;
        const loadingToast = toast.loading(`AI Synthesizing ${config.title}...`);

        try {
            const historyPayload = messages.slice(-10).map(m => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                sender: m.sender,
                text: m.text,
                content: m.text
            }));

            const payload: any = {
                instruction: query,
                prompt: query,
                stateContext,
                history: historyPayload
            };

            if (mode === 'form') {
                payload.formId = entityId;
            } else if (mode === 'website') {
                payload.websiteId = entityId;
            } else if (mode === 'document') {
                payload.documentId = entityId;
            }

            let resData: any = null;
            if (apiClient) {
                const res = await apiClient.post(endpoint, payload);
                resData = res?.data || res;
            } else {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                resData = await res.json();
            }

            if (resData && (resData.success !== false)) {
                if (onApply && resData.ast) {
                    if (mode === 'form') {
                        const ast = resData.ast;
                        onApply({
                            title: ast.form?.title,
                            description: ast.form?.description,
                            fields: ast.fields,
                            settings: ast.settings,
                            pages: ast.pages
                        });
                    } else if (mode === 'website') {
                        onApply(resData.ast);
                    } else {
                        onApply(resData.ast || resData);
                    }
                }

                const assistantMsg: Message = {
                    id: `ai-${Date.now()}`,
                    sender: 'assistant',
                    text: resData.reply || `✅ Changes synthesized and applied live!`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    astData: resData.ast
                };

                setMessages(prev => [...prev, assistantMsg]);
                toast.success('Live Changes Applied!', { id: loadingToast });
            } else {
                throw new Error(resData?.message || 'Failed to update canvas');
            }
        } catch (error: any) {
            console.error('[UniversalAIDrawer] Execution error:', error);
            const errorMsg: Message = {
                id: `ai-err-${Date.now()}`,
                sender: 'assistant',
                text: `⚠️ **AI Update Error**: ${error?.response?.data?.message || error?.message || 'Failed to apply changes. Please try again.'}`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => [...prev, errorMsg]);
            toast.error('Failed to apply changes', { id: loadingToast });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyText = (id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendPrompt();
        }
    };

    return (
        <>
            {/* Optional Backdrop (Non-blocking by default so user can edit/view live canvas) */}
            {showBackdrop && (
                <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Universal Sticky Right-Docked Drawer (Top to Bottom) */}
            <aside
                style={{ width: `${drawerWidth}px` }}
                className={clsx(
                    "fixed top-0 bottom-0 right-0 h-screen z-50 flex flex-col",
                    "bg-white/95 dark:bg-zinc-950/95 backdrop-blur-2xl",
                    "border-l border-zinc-200/80 dark:border-zinc-800",
                    "shadow-2xl shadow-zinc-950/20 text-zinc-900 dark:text-zinc-100",
                    "transition-all duration-75 select-none",
                    isResizing && "select-none cursor-col-resize pointer-events-auto"
                )}
            >
                {/* Left Edge Drag Resizer Handle */}
                <div
                    onMouseDown={handleMouseDown}
                    className={clsx(
                        "absolute left-0 top-0 bottom-0 w-2.5 -translate-x-1/2 cursor-col-resize z-50",
                        "group flex items-center justify-center transition-colors",
                        isResizing ? "bg-indigo-500/40" : "hover:bg-indigo-500/20"
                    )}
                    title="Drag to resize drawer width"
                >
                    <div className="w-1 h-8 rounded-full bg-zinc-400/50 dark:bg-zinc-600/50 group-hover:bg-indigo-500 transition-colors flex items-center justify-center">
                        <div className="w-0.5 h-4 bg-white/70 rounded-full" />
                    </div>
                </div>

                {/* Header: Title, Live Sync Status, Preset Widths, Close */}
                <div className="flex-shrink-0 px-4 py-3.5 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/60 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <AILogo size={32} className="rounded-xl flex-shrink-0 shadow-md shadow-indigo-500/20" />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="text-xs font-black tracking-tight text-zinc-900 dark:text-zinc-100 uppercase truncate">
                                    {customTitle || config.title}
                                </h3>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    Live Sync
                                </span>
                            </div>
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                {customSubtitle || config.subtitle}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Width Preset Buttons */}
                        <div className="hidden sm:flex items-center bg-zinc-200/60 dark:bg-zinc-800/80 rounded-lg p-0.5 border border-zinc-300/40 dark:border-zinc-700/50 text-[10px] font-semibold text-zinc-600 dark:text-zinc-400">
                            <button
                                type="button"
                                onClick={() => handleSetPresetWidth(380)}
                                className={clsx(
                                    "px-1.5 py-0.5 rounded-md transition-colors",
                                    drawerWidth <= 400 ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs" : "hover:text-zinc-900 dark:hover:text-zinc-100"
                                )}
                                title="Compact Width (380px)"
                            >
                                S
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSetPresetWidth(500)}
                                className={clsx(
                                    "px-1.5 py-0.5 rounded-md transition-colors",
                                    drawerWidth > 400 && drawerWidth <= 600 ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs" : "hover:text-zinc-900 dark:hover:text-zinc-100"
                                )}
                                title="Standard Width (500px)"
                            >
                                M
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSetPresetWidth(720)}
                                className={clsx(
                                    "px-1.5 py-0.5 rounded-md transition-colors",
                                    drawerWidth > 600 ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs" : "hover:text-zinc-900 dark:hover:text-zinc-100"
                                )}
                                title="Wide View (720px)"
                            >
                                L
                            </button>
                        </div>

                        {/* Close Drawer Button */}
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-xl hover:bg-zinc-200/70 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                            title="Close AI Drawer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Quick Prompts Carousel Bar */}
                <div className="flex-shrink-0 px-3.5 py-2 bg-zinc-100/60 dark:bg-zinc-900/40 border-b border-zinc-200/60 dark:border-zinc-800/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    <span className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500 flex items-center gap-1 flex-shrink-0">
                        <Sparkles className="w-3 h-3 text-amber-500" /> Prompts:
                    </span>
                    {config.quickPrompts.map((qp, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => handleSendPrompt(qp.prompt)}
                            disabled={isLoading}
                            className="px-2.5 py-1 rounded-full text-xs font-medium bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/80 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all flex-shrink-0 whitespace-nowrap shadow-2xs"
                        >
                            {qp.label}
                        </button>
                    ))}
                </div>

                {/* Chat Scroll View */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={clsx(
                                "flex gap-2.5 max-w-full",
                                msg.sender === 'user' ? "justify-end" : "justify-start"
                            )}
                        >
                            {msg.sender === 'assistant' && (
                                <AILogo size={24} className="rounded-lg shadow-xs flex-shrink-0 mt-0.5" />
                            )}

                            <div
                                className={clsx(
                                    "rounded-2xl p-3.5 text-xs max-w-[88%] leading-relaxed space-y-2 group relative shadow-2xs",
                                    msg.sender === 'user'
                                        ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-tr-xs"
                                        : "bg-zinc-100/90 dark:bg-zinc-900/90 text-zinc-800 dark:text-zinc-200 rounded-tl-xs border border-zinc-200/70 dark:border-zinc-800"
                                )}
                            >
                                <div className="flex items-center justify-between gap-4 text-[10px] opacity-60">
                                    <span className="font-semibold">{msg.sender === 'assistant' ? config.title : 'You'}</span>
                                    <span>{msg.timestamp}</span>
                                </div>

                                <div className="leading-relaxed">
                                    <DrawerMarkdown content={msg.text} isUser={msg.sender === 'user'} />
                                </div>

                                {msg.sender === 'assistant' && (
                                    <div className="pt-1.5 flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            type="button"
                                            onClick={() => handleCopyText(msg.id, msg.text)}
                                            className="p-1 rounded-md bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 transition-colors"
                                            title="Copy message"
                                        >
                                            {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {msg.sender === 'user' && (
                                <div className="w-6 h-6 rounded-lg bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <User className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-200" />
                                </div>
                            )}
                        </div>
                    ))}

                    {isLoading && (
                        <div className="flex gap-2.5 items-center text-xs text-indigo-600 dark:text-indigo-400">
                            <AILogo size={24} className="rounded-lg shadow-xs flex-shrink-0 animate-pulse" />
                            <div className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-3 flex items-center gap-2">
                                <span className="animate-pulse font-medium">Synthesizing live changes with {aiStatus.model}...</span>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Bottom Input Box Area */}
                <div className="flex-shrink-0 p-3.5 bg-zinc-50/90 dark:bg-zinc-900/90 border-t border-zinc-200/80 dark:border-zinc-800/80 space-y-2">
                    <div className="relative rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-300/80 dark:border-zinc-700 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all shadow-inner">
                        <textarea
                            ref={textareaRef}
                            value={inputPrompt}
                            onChange={(e) => setInputPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={
                                mode === 'form' ? "e.g. Add a 5-star experience rating or switch to emerald green..." :
                                mode === 'website' ? "e.g. Add customer testimonials and switch theme to royal purple..." :
                                mode === 'document' ? "e.g. Draft a 3-page master services agreement with IP clauses..." :
                                "Ask anything or instruct AI to synthesize..."
                            }
                            rows={2}
                            disabled={isLoading}
                            className="w-full resize-none bg-transparent p-3 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none max-h-32"
                        />

                        <div className="px-3 pb-2.5 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-zinc-400 hidden sm:inline">
                                Press <kbd className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-300 dark:border-zinc-700 font-mono text-[9px]">Enter</kbd> to build
                            </span>

                            <button
                                type="button"
                                onClick={() => handleSendPrompt()}
                                disabled={!inputPrompt.trim() || isLoading}
                                className={clsx(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-md transition-all",
                                    !inputPrompt.trim() || isLoading
                                        ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed"
                                        : clsx("bg-gradient-to-r hover:scale-102 active:scale-98 shadow-indigo-500/20 cursor-pointer", config.themeGradient)
                                )}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        <span>Building...</span>
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-3 h-3" />
                                        <span>Build Live</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-zinc-400 px-1">
                        <span className="flex items-center gap-1 truncate">
                            <ShieldCheck className="w-3 h-3 text-emerald-500" /> Powered by {aiStatus.model}
                        </span>
                        <span className="truncate">180 Workspace Autonomous OS</span>
                    </div>
                </div>
            </aside>
        </>
    );
}

/**
 * Rich Markdown Renderer for AI Drawer responses
 */
export function DrawerMarkdown({ content, isUser = false }: { content: string; isUser?: boolean }) {
    if (!content) return null;

    if (isUser) {
        return <div className="whitespace-pre-wrap break-words">{content}</div>;
    }

    // Split text into code blocks and normal text sections
    const codeBlockRegex = /(```[\s\S]*?```)/g;
    const segments = content.split(codeBlockRegex);

    return (
        <div className="space-y-2 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
            {segments.map((segment, segIdx) => {
                if (segment.startsWith('```')) {
                    return <DrawerCodeBlock key={segIdx} codeText={segment} />;
                }
                return <DrawerMarkdownSection key={segIdx} text={segment} />;
            })}
        </div>
    );
}

function DrawerCodeBlock({ codeText }: { codeText: string }) {
    const [copied, setCopied] = useState(false);
    const match = codeText.match(/^```(\w+)?\n?([\s\S]*?)```$/);
    const language = match?.[1] || 'code';
    const code = (match?.[2] || codeText.slice(3, -3)).trim();

    // If it's an action JSON block, render an autonomous update card
    try {
        if (code.startsWith('{') && code.includes('"action"')) {
            const parsed = JSON.parse(code);
            if (parsed.action) {
                const actionName = parsed.action.replace(/_/g, ' ');
                const payload = parsed.payload || {};
                const targetName = payload.name || payload.title || payload.description || '';
                return (
                    <div className="my-2 p-3 rounded-xl bg-gradient-to-r from-zinc-900 via-indigo-950 to-zinc-900 border border-indigo-500/40 text-white shadow-md flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-300">
                                <Sparkles className="w-3.5 h-3.5" />
                            </div>
                            <div>
                                <div className="text-[11px] font-bold capitalize text-zinc-100 flex items-center gap-1.5">
                                    <span>{actionName}</span>
                                    {targetName && <span className="text-indigo-300 font-semibold">"{targetName}"</span>}
                                </div>
                                <div className="text-[10px] text-zinc-400">Autonomous Canvas Update</div>
                            </div>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                            <span>Applied</span>
                        </span>
                    </div>
                );
            }
        }
    } catch {}

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="my-2.5 rounded-xl overflow-hidden border border-zinc-700 dark:border-zinc-800 bg-zinc-900 text-zinc-100 font-mono text-[11px] shadow-sm">
            <div className="flex items-center justify-between px-3 py-1 bg-zinc-800/90 border-b border-zinc-700/80 text-zinc-400 text-[10px]">
                <div className="flex items-center gap-1.5">
                    <Code2 className="w-3 h-3 text-indigo-400" />
                    <span className="uppercase tracking-wider font-semibold text-zinc-300">{language}</span>
                </div>
                <button
                    onClick={handleCopy}
                    type="button"
                    className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
                    title="Copy code"
                >
                    {copied ? (
                        <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                        </>
                    )}
                </button>
            </div>
            <pre className="p-3 overflow-x-auto text-zinc-200 leading-relaxed">
                <code>{code}</code>
            </pre>
        </div>
    );
}

function DrawerMarkdownSection({ text }: { text: string }) {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;

    const flushList = () => {
        if (currentList) {
            if (currentList.type === 'ul') {
                elements.push(
                    <ul key={`ul-${elements.length}`} className="my-1.5 space-y-1 pl-1">
                        {currentList.items.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-zinc-700 dark:text-zinc-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                                <div className="flex-1 min-w-0">{item}</div>
                            </li>
                        ))}
                    </ul>
                );
            } else {
                elements.push(
                    <ol key={`ol-${elements.length}`} className="my-1.5 space-y-1 pl-1">
                        {currentList.items.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-zinc-700 dark:text-zinc-300">
                                <span className="font-bold text-indigo-600 dark:text-indigo-400 text-[11px] mt-0.5 shrink-0 min-w-[16px]">{i + 1}.</span>
                                <div className="flex-1 min-w-0">{item}</div>
                            </li>
                        ))}
                    </ol>
                );
            }
            currentList = null;
        }
    };

    lines.forEach((line, lineIndex) => {
        const trimmed = line.trim();

        if (!trimmed) {
            flushList();
            return;
        }

        // Headings
        if (trimmed.startsWith('#### ')) {
            flushList();
            elements.push(
                <h5 key={`h4-${lineIndex}`} className="font-bold text-zinc-900 dark:text-zinc-100 text-[11px] mt-2.5 mb-1 uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    {formatDrawerMarkdownInline(trimmed.slice(5))}
                </h5>
            );
            return;
        }
        if (trimmed.startsWith('### ')) {
            flushList();
            elements.push(
                <h4 key={`h3-${lineIndex}`} className="font-bold text-zinc-900 dark:text-zinc-100 text-xs mt-3 mb-1 tracking-tight">
                    {formatDrawerMarkdownInline(trimmed.slice(4))}
                </h4>
            );
            return;
        }
        if (trimmed.startsWith('## ')) {
            flushList();
            elements.push(
                <h3 key={`h2-${lineIndex}`} className="font-extrabold text-zinc-900 dark:text-zinc-100 text-sm mt-3 mb-1.5 tracking-tight">
                    {formatDrawerMarkdownInline(trimmed.slice(3))}
                </h3>
            );
            return;
        }
        if (trimmed.startsWith('# ')) {
            flushList();
            elements.push(
                <h2 key={`h1-${lineIndex}`} className="font-black text-zinc-900 dark:text-zinc-100 text-base mt-3 mb-1.5 tracking-tight">
                    {formatDrawerMarkdownInline(trimmed.slice(2))}
                </h2>
            );
            return;
        }

        // Blockquotes
        if (trimmed.startsWith('> ')) {
            flushList();
            elements.push(
                <div key={`quote-${lineIndex}`} className="my-2 p-2.5 border-l-3 border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 rounded-r-lg text-zinc-700 dark:text-zinc-300 italic text-[11px]">
                    {formatDrawerMarkdownInline(trimmed.slice(2))}
                </div>
            );
            return;
        }

        // Unordered List Items (- or * or •)
        const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
        if (ulMatch) {
            if (!currentList || currentList.type !== 'ul') {
                flushList();
                currentList = { type: 'ul', items: [] };
            }
            currentList.items.push(formatDrawerMarkdownInline(ulMatch[1]));
            return;
        }

        // Ordered List Items (1. , 2. )
        const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
        if (olMatch) {
            if (!currentList || currentList.type !== 'ol') {
                flushList();
                currentList = { type: 'ol', items: [] };
            }
            currentList.items.push(formatDrawerMarkdownInline(olMatch[1]));
            return;
        }

        // Normal paragraph line
        flushList();
        elements.push(
            <p key={`p-${lineIndex}`} className="leading-relaxed">
                {formatDrawerMarkdownInline(line)}
            </p>
        );
    });

    flushList();
    return <>{elements}</>;
}

/**
 * Parses inline markdown tokens: bold-italic, bold, italic, code pills, and links
 */
function formatDrawerMarkdownInline(text: string): React.ReactNode {
    if (!text) return null;

    // Tokenizer regex matching bold-italic (***text***), bold (**text** or __text__), inline code (`code`), italic (*text* or _text_), and links ([text](url))
    const tokenRegex = /(\*\*\*(?:(?!\*\*\*).)+?\*\*\*|\*\*(?:(?!\*\*).)+?\*\*|__(?:(?!__).)+?__|`[^`\n]+?`|(?<!\*)\*(?:(?!\*).)+?\*(?!\*)|(?<!_)_(?:(?!_).)+?_(?!_)|\[[^\]\n]+?\]\([^)\n]+?\))/g;
    const parts = text.split(tokenRegex);

    return parts.map((part, index) => {
        if (!part) return null;

        // Bold Italic: ***text***
        if (part.startsWith('***') && part.endsWith('***') && part.length >= 6) {
            const inner = part.slice(3, -3);
            return (
                <strong key={index} className="font-bold italic text-zinc-950 dark:text-zinc-50">
                    {formatDrawerMarkdownInline(inner)}
                </strong>
            );
        }

        // Bold: **text** or __text__
        if (
            (part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
            (part.startsWith('__') && part.endsWith('__') && part.length >= 4)
        ) {
            const inner = part.slice(2, -2);
            return (
                <strong key={index} className="font-bold text-zinc-950 dark:text-zinc-50">
                    {formatDrawerMarkdownInline(inner)}
                </strong>
            );
        }

        // Inline Code: `code`
        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
            const inner = part.slice(1, -1);
            return (
                <code key={index} className="px-1.5 py-0.5 mx-0.5 rounded-md bg-zinc-200/80 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 font-mono text-[11px] font-semibold border border-zinc-300/60 dark:border-zinc-700/60 shadow-2xs">
                    {inner}
                </code>
            );
        }

        // Italic: *text* or _text_
        if (
            (part.startsWith('*') && part.endsWith('*') && part.length >= 2 && !part.startsWith('**')) ||
            (part.startsWith('_') && part.endsWith('_') && part.length >= 2 && !part.startsWith('__'))
        ) {
            const inner = part.slice(1, -1);
            return (
                <em key={index} className="italic text-zinc-800 dark:text-zinc-200">
                    {formatDrawerMarkdownInline(inner)}
                </em>
            );
        }

        // Markdown Link: [label](url)
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
            return (
                <a
                    key={index}
                    href={linkMatch[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold inline-flex items-center gap-0.5"
                >
                    <span>{linkMatch[1]}</span>
                </a>
            );
        }

        return part;
    });
}

export default UniversalAIDrawer;
