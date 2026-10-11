'use client';

import React, { useState } from 'react';
import { ThumbsUp, MessageSquare, Repeat2, Send, Globe, ChevronLeft, ChevronRight, FileText } from 'lucide-react';

interface LinkedInPreviewProps {
    authorName?: string;
    authorHeadline?: string;
    authorAvatar?: string;
    content: string;
    mediaUrls?: string[];
    isPdfCarousel?: boolean;
    pdfPageCount?: number;
}

export function LinkedInPreview({
    authorName = 'Alex Mercer',
    authorHeadline = 'Founder & Product Architect @ 180workspace | Scaling AI SaaS',
    authorAvatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
    content,
    mediaUrls = [],
    isPdfCarousel = false,
    pdfPageCount = 5
}: LinkedInPreviewProps) {
    const [expanded, setExpanded] = useState(false);
    const [currentPdfSlide, setCurrentPdfSlide] = useState(1);
    const [reacted, setReacted] = useState(false);

    const isLongText = content.length > 210;
    const displayText = isLongText && !expanded ? content.slice(0, 210) + '...' : content;
    const activeMedia = mediaUrls && mediaUrls[0];

    return (
        <div className="w-full max-w-[420px] mx-auto bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden font-sans text-slate-900">
            {/* Header */}
            <div className="flex items-start justify-between p-4 pb-2.5">
                <div className="flex items-start gap-3">
                    <img src={authorAvatar} alt={authorName} className="w-11 h-11 rounded-full object-cover border border-slate-100" />
                    <div>
                        <h4 className="text-xs font-bold leading-tight hover:text-blue-600 cursor-pointer">{authorName}</h4>
                        <p className="text-[11px] text-slate-500 line-clamp-1 leading-snug mt-0.5">{authorHeadline}</p>
                        <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            Just now &bull; <Globe className="w-3 h-3 text-slate-400" />
                        </p>
                    </div>
                </div>
                <button className="text-blue-600 hover:bg-blue-50 text-xs font-semibold px-2 py-1 rounded-md transition-colors">
                    + Follow
                </button>
            </div>

            {/* Post Commentary & 210-Char "See More" Fold */}
            <div className="px-4 py-2 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                {displayText || 'Draft your high-leverage LinkedIn insight here...'}
                {isLongText && !expanded && (
                    <button 
                        onClick={() => setExpanded(true)}
                        className="text-slate-500 hover:text-blue-600 font-semibold ml-1 cursor-pointer"
                    >
                        ...see more
                    </button>
                )}
            </div>

            {/* Media Area / PDF Document Carousel */}
            {isPdfCarousel ? (
                <div className="relative bg-slate-900 text-white aspect-[4/5] flex flex-col justify-between p-6 overflow-hidden">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                        <div className="flex items-center gap-1.5 font-semibold">
                            <FileText className="w-4 h-4 text-blue-400" />
                            <span>Document Carousel</span>
                        </div>
                        <span className="bg-black/50 px-2 py-0.5 rounded-full text-[10px] font-mono">
                            {currentPdfSlide} / {pdfPageCount}
                        </span>
                    </div>

                    {/* Simulated Slide Body */}
                    <div className="my-auto text-center space-y-3 px-2">
                        <div className="inline-block px-2.5 py-1 bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-full text-[10px] font-bold uppercase tracking-wider">
                            Slide {currentPdfSlide}
                        </div>
                        <h3 className="text-lg font-extrabold text-white leading-tight">
                            {currentPdfSlide === 1 ? '5 Rules for 10x Team Output' : `Key Takeaway #${currentPdfSlide}: Focus on Systems`}
                        </h3>
                        <p className="text-xs text-slate-300 leading-relaxed">
                            Swipe through this document to learn the frameworks used by hyper-growth startups.
                        </p>
                    </div>

                    {/* Document Navigation Controls */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
                        <button
                            disabled={currentPdfSlide === 1}
                            onClick={() => setCurrentPdfSlide(p => Math.max(1, p - 1))}
                            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="flex gap-1">
                            {Array.from({ length: pdfPageCount }).map((_, i) => (
                                <span
                                    key={i}
                                    className={`w-1.5 h-1.5 rounded-full transition-all ${currentPdfSlide === i + 1 ? 'bg-blue-400 w-3' : 'bg-white/30'}`}
                                />
                            ))}
                        </div>
                        <button
                            disabled={currentPdfSlide === pdfPageCount}
                            onClick={() => setCurrentPdfSlide(p => Math.min(pdfPageCount, p + 1))}
                            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            ) : activeMedia ? (
                <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                    <img src={activeMedia} alt="LinkedIn Post media" className="w-full h-full object-cover" />
                </div>
            ) : null}

            {/* Social Reaction Counts */}
            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <div className="flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-white text-[9px]">👍</span>
                    <span className="w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center text-white text-[9px]">❤️</span>
                    <span className="font-semibold text-slate-700 ml-1">{reacted ? '129' : '128'}</span>
                </div>
                <span>14 comments &bull; 3 reposts</span>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-4 p-1 text-slate-600 font-semibold text-[11px]">
                <button
                    onClick={() => setReacted(!reacted)}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-50 transition-colors ${reacted ? 'text-blue-600' : ''}`}
                >
                    <ThumbsUp className={`w-4 h-4 ${reacted ? 'fill-blue-600' : ''}`} />
                    <span>Like</span>
                </button>
                <button className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-50 transition-colors">
                    <MessageSquare className="w-4 h-4" />
                    <span>Comment</span>
                </button>
                <button className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-50 transition-colors">
                    <Repeat2 className="w-4 h-4" />
                    <span>Repost</span>
                </button>
                <button className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg hover:bg-slate-50 transition-colors">
                    <Send className="w-4 h-4" />
                    <span>Send</span>
                </button>
            </div>
        </div>
    );
}
