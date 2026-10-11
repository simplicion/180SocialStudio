'use client';

import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, Share2, MoreVertical, Play } from 'lucide-react';

interface YouTubeShortsPreviewProps {
    channelName?: string;
    title: string;
    mediaUrl?: string;
}

export function YouTubeShortsPreview({
    channelName = '180workspace Engineering',
    title,
    mediaUrl = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80'
}: YouTubeShortsPreviewProps) {
    const [liked, setLiked] = useState(false);

    return (
        <div className="w-full max-w-[320px] mx-auto bg-black rounded-[28px] overflow-hidden border-[6px] border-slate-900 shadow-2xl relative text-white font-sans aspect-[9/16] flex flex-col justify-between select-none">
            {/* Background Media */}
            <div className="absolute inset-0 z-0 bg-slate-950">
                <img src={mediaUrl} alt="Shorts media" className="w-full h-full object-cover opacity-90" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/85" />
            </div>

            {/* Top Bar */}
            <div className="relative z-10 flex items-center justify-between p-4 pt-5">
                <div className="flex items-center gap-1.5 font-bold text-sm">
                    <span className="w-4 h-4 rounded-sm bg-red-600 flex items-center justify-center">
                        <Play className="w-2.5 h-2.5 fill-white" />
                    </span>
                    <span>Shorts</span>
                </div>
                <MoreVertical className="w-5 h-5 text-white/80 cursor-pointer" />
            </div>

            {/* Right Action Stack */}
            <div className="relative z-10 self-end mr-3 flex flex-col items-center gap-4 text-center mb-12">
                <button onClick={() => setLiked(!liked)} className="flex flex-col items-center gap-1">
                    <div className={`p-2 rounded-full bg-black/40 backdrop-blur-sm transition-transform active:scale-125 ${liked ? 'text-red-500' : 'text-white'}`}>
                        <ThumbsUp className={`w-6 h-6 ${liked ? 'fill-red-500' : ''}`} />
                    </div>
                    <span className="text-[11px] font-medium">{liked ? '8.4K' : '8.3K'}</span>
                </button>

                <div className="flex flex-col items-center gap-1">
                    <div className="p-2 rounded-full bg-black/40 backdrop-blur-sm">
                        <ThumbsDown className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-medium">Dislike</span>
                </div>

                <div className="flex flex-col items-center gap-1">
                    <div className="p-2 rounded-full bg-black/40 backdrop-blur-sm">
                        <MessageSquare className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-medium">342</span>
                </div>

                <div className="flex flex-col items-center gap-1">
                    <div className="p-2 rounded-full bg-black/40 backdrop-blur-sm">
                        <Share2 className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-medium">Share</span>
                </div>
            </div>

            {/* Bottom Title & Channel Info */}
            <div className="relative z-10 p-4 pb-5 space-y-2.5">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center font-bold text-xs">
                        180
                    </div>
                    <span className="font-bold text-xs truncate max-w-[140px]">@{channelName}</span>
                    <button className="px-3 py-1 rounded-full text-[11px] font-bold bg-white text-black hover:bg-slate-200 transition-colors">
                        Subscribe
                    </button>
                </div>
                <p className="text-xs font-semibold text-white/95 line-clamp-2 leading-relaxed">
                    {title || 'How to build production-grade video rendering pipelines #Shorts'}
                </p>
            </div>
        </div>
    );
}
