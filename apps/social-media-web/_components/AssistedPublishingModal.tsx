"use client";

import React, { useState } from 'react';
import { X, Copy, Download, ExternalLink, CheckCircle, Video, Image as ImageIcon } from 'lucide-react';

interface AssistedPublishingModalProps {
    isOpen: boolean;
    onClose: () => void;
    platform: string;
    caption: string;
    title?: string;
    mediaUrl?: string;
    mediaType?: 'video' | 'image';
    onConfirmPublished: () => void;
}

const PLATFORM_COMPOSER_URLS: Record<string, (text: string, title?: string) => string> = {
    x: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
    reddit: (text, title) => `https://www.reddit.com/submit?title=${encodeURIComponent(title || '')}&text=${encodeURIComponent(text)}`,
    tiktok: () => `https://www.tiktok.com/upload`,
    pinterest: () => `https://www.pinterest.com/pin-builder/`,
    instagram: () => `https://www.instagram.com/`,
    threads: () => `https://www.threads.net/`,
    facebook: () => `https://www.facebook.com/`,
    linkedin: () => `https://www.linkedin.com/feed/?shareActive=true`,
    youtube: () => `https://studio.youtube.com/channel/upload`,
};

const PLATFORM_COLORS: Record<string, string> = {
    x: 'bg-black text-white',
    reddit: 'bg-[#FF4500] text-white',
    tiktok: 'bg-[#25F4EE] text-black',
    pinterest: 'bg-[#E60023] text-white',
    instagram: 'bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white',
    threads: 'bg-black text-white',
    facebook: 'bg-[#1877F2] text-white',
    linkedin: 'bg-[#0A66C2] text-white',
    youtube: 'bg-[#FF0000] text-white',
};

export function AssistedPublishingModal({
    isOpen,
    onClose,
    platform,
    caption,
    title,
    mediaUrl,
    mediaType = 'video',
    onConfirmPublished
}: AssistedPublishingModalProps) {
    const [copiedCaption, setCopiedCaption] = useState(false);
    const [copiedTitle, setCopiedTitle] = useState(false);

    if (!isOpen) return null;

    const handleCopyCaption = async () => {
        try {
            await navigator.clipboard.writeText(caption);
            setCopiedCaption(true);
            setTimeout(() => setCopiedCaption(false), 2000);
        } catch (err) {}
    };

    const handleCopyTitle = async () => {
        if (!title) return;
        try {
            await navigator.clipboard.writeText(title);
            setCopiedTitle(true);
            setTimeout(() => setCopiedTitle(false), 2000);
        } catch (err) {}
    };

    const getWebComposerUrl = () => {
        const builder = PLATFORM_COMPOSER_URLS[platform.toLowerCase()];
        return builder ? builder(caption, title) : '#';
    };

    const pColor = PLATFORM_COLORS[platform.toLowerCase()] || 'bg-zinc-800 text-white';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className={`px-6 py-4 flex items-center justify-between ${pColor}`}>
                    <h2 className="text-lg font-bold capitalize flex items-center gap-2">
                        <span>Publish to {platform}</span>
                        <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-black uppercase tracking-wider">Manual Assist</span>
                    </h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20 transition">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        This platform requires manual confirmation. We've prepared everything you need. Just copy your content, download the media, and open the web composer to post.
                    </p>

                    {/* Pre-filled Copy Section */}
                    <div className="space-y-4">
                        {title && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">Title</label>
                                <div className="relative group">
                                    <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-800 dark:text-zinc-200 pr-12">
                                        {title}
                                    </div>
                                    <button 
                                        onClick={handleCopyTitle}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white dark:bg-zinc-700 shadow-sm border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                                        title="Copy Title"
                                    >
                                        {copiedTitle ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">Caption</label>
                            <div className="relative group">
                                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-800 dark:text-zinc-200 pr-12 min-h-[100px] whitespace-pre-wrap">
                                    {caption}
                                </div>
                                <button 
                                    onClick={handleCopyCaption}
                                    className="absolute right-2 top-2 p-2 bg-white dark:bg-zinc-700 shadow-sm border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                                    title="Copy Caption"
                                >
                                    {copiedCaption ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Media Download & Web Composer */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                        {mediaUrl ? (
                            <a 
                                href={mediaUrl}
                                download
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-sm font-bold rounded-xl transition"
                            >
                                {mediaType === 'video' ? <Video className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                                <span>Download {mediaType === 'video' ? 'Video' : 'Image'}</span>
                            </a>
                        ) : (
                            <div className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-50 dark:bg-zinc-900 text-zinc-400 text-sm font-medium rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
                                No media attached
                            </div>
                        )}

                        <a 
                            href={getWebComposerUrl()}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-center gap-2 px-4 py-3 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 text-sm font-bold rounded-xl transition"
                        >
                            <ExternalLink className="w-4 h-4" />
                            <span>Open Web Composer</span>
                        </a>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="p-4 bg-zinc-50 dark:bg-zinc-950/60 border-t border-zinc-100 dark:border-zinc-800">
                    <button 
                        onClick={onConfirmPublished}
                        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white text-sm font-black rounded-xl shadow-lg shadow-emerald-500/20 transition active:scale-95 cursor-pointer"
                    >
                        <CheckCircle className="w-5 h-5" />
                        <span>Yes, I Published It</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
