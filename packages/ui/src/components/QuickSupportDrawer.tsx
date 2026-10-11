'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
    LifeBuoy, X, Upload, Image as ImageIcon, 
    Trash2, CheckCircle2, Monitor, MapPin, 
    Clock, Shield, Send, Eye, RefreshCw,
    Paperclip, Plus, ArrowRight
} from 'lucide-react';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';

export interface AttachmentFile {
    id: string;
    name: string;
    size: number;
    type: string;
    dataUrl: string;
}

export interface QuickSupportSubmissionData {
    category: string;
    priority: string;
    subject: string;
    description: string;
    routeUrl: string;
    timeZone: string;
    location: string;
    attachments: AttachmentFile[];
    metadata: {
        userAgent: string;
        screenResolution: string;
        viewportSize: string;
        timestamp: string;
        language: string;
        timeZone: string;
    };
}

export interface QuickSupportWidgetProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit?: (data: QuickSupportSubmissionData) => Promise<{ success: boolean; ticketId?: string; message?: string }>;
    apiEndpoint?: string;
    userContext?: {
        name?: string;
        email?: string;
        companyName?: string;
        role?: string;
    };
    customRouteUrl?: string;
}

const CATEGORIES = [
    { id: 'bug_report', label: 'Bug / Broken UI', priority: 'high' },
    { id: 'data_error', label: 'Data & Sync', priority: 'high' },
    { id: 'performance', label: 'Slow Performance', priority: 'medium' },
    { id: 'auth_access', label: 'Access / Auth', priority: 'high' },
    { id: 'billing', label: 'Billing', priority: 'medium' },
    { id: 'feature_request', label: 'Feature Request', priority: 'low' },
    { id: 'other', label: 'General', priority: 'medium' },
];

const MAX_IMAGES = 10;
const MAX_TOTAL_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
}

export function QuickSupportDrawer({
    isOpen,
    onClose,
    onSubmit,
    apiEndpoint = '/api/v1/settings/support/quick',
    userContext,
    customRouteUrl
}: QuickSupportWidgetProps) {
    const [category, setCategory] = useState('bug_report');
    const [priority, setPriority] = useState('high');
    const [description, setDescription] = useState('');
    const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submittedTicket, setSubmittedTicket] = useState<{ id: string } | null>(null);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const widgetRef = useRef<HTMLDivElement>(null);

    // Auto-detected diagnostics captured silently (not displayed to keep UI minimal)
    const [telemetry, setTelemetry] = useState({
        routeUrl: '',
        formattedDate: '',
        formattedTime: '',
        timeZone: '',
        userAgent: '',
        screenResolution: '',
        viewportSize: '',
        language: '',
        timestamp: ''
    });

    useEffect(() => {
        if (typeof window !== 'undefined' && isOpen) {
            const now = new Date();
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            setTelemetry({
                routeUrl: customRouteUrl || window.location.pathname + window.location.search,
                formattedDate: now.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
                formattedTime: now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                timeZone: tz,
                userAgent: navigator.userAgent,
                screenResolution: `${window.screen.width}x${window.screen.height}`,
                viewportSize: `${window.innerWidth}x${window.innerHeight}`,
                language: navigator.language || 'en-US',
                timestamp: now.toISOString()
            });
        }
    }, [isOpen, customRouteUrl]);

    // Calculate total size of attachments
    const totalSize = attachments.reduce((sum, f) => sum + f.size, 0);

    // Process uploaded or pasted image files
    const processFiles = useCallback((files: FileList | File[]) => {
        const fileList = Array.from(files);
        if (fileList.length === 0) return;

        if (attachments.length + fileList.length > MAX_IMAGES) {
            toast.error(`Maximum limit is ${MAX_IMAGES} images. You can add ${Math.max(0, MAX_IMAGES - attachments.length)} more.`);
            return;
        }

        let newBatchSize = 0;
        const validFiles: File[] = [];

        for (const file of fileList) {
            if (!file.type.startsWith('image/')) {
                toast.error(`"${file.name}" is not a valid image format.`);
                continue;
            }
            newBatchSize += file.size;
            validFiles.push(file);
        }

        if (totalSize + newBatchSize > MAX_TOTAL_SIZE_BYTES) {
            toast.error(`Total attachments exceed 25MB limit. (Current: ${formatFileSize(totalSize + newBatchSize)})`);
            return;
        }

        validFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                if (dataUrl) {
                    setAttachments(prev => {
                        if (prev.length >= MAX_IMAGES) return prev;
                        return [
                            ...prev,
                            {
                                id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                                name: file.name || `screenshot_${prev.length + 1}.png`,
                                size: file.size,
                                type: file.type || 'image/png',
                                dataUrl
                            }
                        ];
                    });
                }
            };
            reader.readAsDataURL(file);
        });

        toast.success(`Attached ${validFiles.length} screenshot${validFiles.length > 1 ? 's' : ''}`);
    }, [attachments.length, totalSize]);

    // Clipboard Screenshot Paste Handler (Ctrl+V / Cmd+V)
    useEffect(() => {
        if (!isOpen) return;

        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            const imageFiles: File[] = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    if (blob) {
                        const file = new File([blob], `screenshot_${Date.now()}.png`, { type: blob.type || 'image/png' });
                        imageFiles.push(file);
                    }
                }
            }

            if (imageFiles.length > 0) {
                e.preventDefault();
                processFiles(imageFiles);
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [isOpen, processFiles]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFiles(e.dataTransfer.files);
        }
    };

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    };

    const resetForm = () => {
        setDescription('');
        setAttachments([]);
        setCategory('bug_report');
        setPriority('high');
        setSubmittedTicket(null);
    };

    const handleClose = () => {
        if (submitting) return;
        resetForm();
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim()) {
            toast.error('Please enter a description of the issue.');
            return;
        }

        setSubmitting(true);

        const categoryObj = CATEGORIES.find(c => c.id === category);
        const payload: QuickSupportSubmissionData = {
            category,
            priority,
            subject: `[Support Report] ${categoryObj?.label || category} on ${telemetry.routeUrl || 'Platform'}`,
            description: description.trim(),
            routeUrl: telemetry.routeUrl,
            timeZone: telemetry.timeZone,
            location: telemetry.timeZone,
            attachments,
            metadata: {
                userAgent: telemetry.userAgent,
                screenResolution: telemetry.screenResolution,
                viewportSize: telemetry.viewportSize,
                timestamp: telemetry.timestamp,
                language: telemetry.language,
                timeZone: telemetry.timeZone
            }
        };

        try {
            if (onSubmit) {
                const res = await onSubmit(payload);
                if (res.success) {
                    setSubmittedTicket({ id: res.ticketId || 'INC-' + Date.now().toString().slice(-6) });
                    toast.success('Incident reported successfully.');
                } else {
                    throw new Error(res.message || 'Submission failed');
                }
            } else {
                const res = await fetch(apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error || data.message || 'Failed to submit report');
                }

                setSubmittedTicket({ id: data.ticketId || data.ticket?.id || 'INC-' + Date.now().toString().slice(-6) });
                toast.success('Incident reported successfully.');
            }
        } catch (err: any) {
            console.error('Support report submit error:', err);
            toast.error(err.message || 'Failed to submit report. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
            {/* Floating Popover Container */}
            <div 
                ref={widgetRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={clsx(
                    "w-[420px] max-w-[calc(100vw-32px)] bg-white dark:bg-zinc-950 rounded-2xl shadow-2xl border flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200",
                    isDragging ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-zinc-200 dark:border-zinc-800"
                )}
            >
                {/* Header */}
                <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-rose-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 border border-white/20 shrink-0">
                            <LifeBuoy className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h4 className="text-sm font-black text-zinc-900 dark:text-white tracking-tight">
                                Quick Support
                            </h4>
                        </div>
                    </div>

                    <button
                        onClick={handleClose}
                        disabled={submitting}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body Content */}
                <div className="p-4 space-y-4">
                    {submittedTicket ? (
                        /* Compact Success Confirmation */
                        <div className="py-8 flex flex-col items-center text-center space-y-3 animate-in zoom-in-95 duration-200">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
                                <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <div className="space-y-1">
                                <h5 className="text-sm font-bold text-zinc-900 dark:text-white">Incident Reported</h5>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    Transmitted directly to platform engineering with telemetry.
                                </p>
                            </div>
                            <div className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300">
                                Ref: #{submittedTicket.id}
                            </div>
                            <div className="pt-2 flex items-center gap-2">
                                <button
                                    onClick={resetForm}
                                    className="px-3.5 py-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-bold shadow-xs hover:bg-zinc-800 transition-all"
                                >
                                    New Report
                                </button>
                                <button
                                    onClick={handleClose}
                                    className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-bold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Minimal Form */
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Horizontal Category Strip */}
                            <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                                {CATEGORIES.map(cat => {
                                    const isSelected = category === cat.id;
                                    return (
                                        <button
                                            key={cat.id}
                                            type="button"
                                            onClick={() => {
                                                setCategory(cat.id);
                                                setPriority(cat.priority);
                                            }}
                                            className={clsx(
                                                'px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all border shrink-0',
                                                isSelected
                                                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white shadow-xs'
                                                    : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'
                                            )}
                                        >
                                            {cat.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Textarea with Increased Height */}
                            <div className="relative">
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value.slice(0, 5000))}
                                    placeholder="Describe what happened in detail... (Tip: paste screenshot directly anywhere with Ctrl+V or Cmd+V)"
                                    rows={5}
                                    className="w-full text-xs min-h-[140px] bg-zinc-50/70 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white transition-all resize-y leading-relaxed font-sans"
                                    required
                                />
                                <div className="text-[10px] font-mono font-medium text-zinc-400 text-right mt-1">
                                    {description.length.toLocaleString()} / 5,000
                                </div>
                            </div>

                            {/* Attached Screenshots Thumbnails */}
                            {attachments.length > 0 && (
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
                                        <span>Attached Screenshots ({attachments.length}/{MAX_IMAGES})</span>
                                        <span>{formatFileSize(totalSize)} / 25MB</span>
                                    </div>
                                    <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                        {attachments.map((file) => (
                                            <div
                                                key={file.id}
                                                className="relative group rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 w-14 h-14 shrink-0 shadow-xs"
                                            >
                                                <img 
                                                    src={file.dataUrl} 
                                                    alt={file.name} 
                                                    className="w-full h-full object-cover cursor-pointer"
                                                    onClick={() => setLightboxImage(file.dataUrl)}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeAttachment(file.id);
                                                    }}
                                                    className="absolute top-1 right-1 p-0.5 rounded-full bg-zinc-900/90 text-white hover:bg-rose-600 transition-colors shadow-xs"
                                                    title="Remove"
                                                >
                                                    <X className="w-2.5 h-2.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Action Bar (Upload + Submit) */}
                            <div className="pt-1 flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files) processFiles(e.target.files);
                                        e.target.value = '';
                                    }}
                                />

                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-semibold flex items-center gap-1.5 transition-all"
                                    title="Attach screenshot or paste directly (Ctrl+V)"
                                >
                                    <Paperclip className="w-3.5 h-3.5" />
                                    <span>Attach Image</span>
                                </button>

                                <button
                                    type="submit"
                                    disabled={submitting || !description.trim()}
                                    className="px-4 py-1.5 rounded-lg bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-bold text-xs shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 active:scale-95"
                                >
                                    {submitting ? (
                                        <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            <span>Sending...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-3.5 h-3.5" />
                                            <span>Send Report</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>

            {/* Lightbox Modal */}
            {lightboxImage && (
                <div 
                    className="fixed inset-0 z-60 bg-black/95 backdrop-blur-xs flex items-center justify-center p-4"
                    onClick={() => setLightboxImage(null)}
                >
                    <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-xl shadow-2xl">
                        <img 
                            src={lightboxImage} 
                            alt="Screenshot preview" 
                            className="max-w-full max-h-[85vh] object-contain rounded-lg"
                        />
                        <button
                            onClick={() => setLightboxImage(null)}
                            className="absolute top-3 right-3 p-2 rounded-full bg-slate-900/80 text-white hover:bg-slate-900 transition-colors shadow-lg"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default QuickSupportDrawer;
