'use client';

import React, { useState } from 'react';
import { Heart, MessageCircle, Bookmark, Share2, Music, Sparkles } from 'lucide-react';

interface TikTokPreviewProps {
    creatorHandle?: string;
    caption: string;
    mediaUrl?: string;
    soundTitle?: string;
}

export function TikTokPreview({
    creatorHandle = '180creator',
    caption,
    mediaUrl = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
    soundTitle = 'Original Sound - 180workspace Official'
}: TikTokPreviewProps) {
    const [liked, setLiked] = useState(false);
    const [saved, setSaved] = useState(false);

    return (
        <div className="w-full max-w-[320px] mx-auto bg-black rounded-[28px] overflow-hidden border-[6px] border-slate-900 shadow-2xl relative text-white font-sans aspect-[9/16] flex flex-col justify-between select-none">
            {/* Background Video / Mock Media */}
            <div className="absolute inset-0 z-0 bg-slate-950">
                <img src={mediaUrl} alt="TikTok video" className="w-full h-full object-cover opacity-90" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/85" />
            </div>

            {/* Top Navigation Simulation */}
            <div className="relative z-10 flex items-center justify-center gap-6 p-4 pt-5 text-sm font-bold text-white/70">
                <span className="cursor-pointer hover:text-white transition-colors">Following</span>
                <span className="cursor-pointer text-white border-b-2 border-white pb-0.5">For You</span>
            </div>

            {/* Right Action Stack */}
            <div className="relative z-10 self-end mr-3 flex flex-col items-center gap-4 text-center mb-12">
                {/* Creator Avatar with Follow Plus */}
                <div className="relative mb-2">
                    <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden">
                        <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80" alt="Avatar" className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                        +
                    </span>
                </div>

                <button onClick={() => setLiked(!liked)} className="flex flex-col items-center gap-0.5">
                    <div className={`p-1.5 rounded-full transition-transform active:scale-125 ${liked ? 'text-rose-500' : 'text-white'}`}>
                        <Heart className={`w-8 h-8 ${liked ? 'fill-rose-500' : ''}`} />
                    </div>
                    <span className="text-[10px] font-bold">{liked ? '24.1K' : '24.0K'}</span>
                </button>

                <div className="flex flex-col items-center gap-0.5 cursor-pointer">
                    <MessageCircle className="w-8 h-8" />
                    <span className="text-[10px] font-bold">1,820</span>
                </div>

                <button onClick={() => setSaved(!saved)} className="flex flex-col items-center gap-0.5">
                    <Bookmark className={`w-8 h-8 ${saved ? 'fill-amber-400 text-amber-400' : ''}`} />
                    <span className="text-[10px] font-bold">4,120</span>
                </button>

                <div className="flex flex-col items-center gap-0.5 cursor-pointer">
                    <Share2 className="w-7 h-7" />
                    <span className="text-[10px] font-bold">980</span>
                </div>

                {/* Rotating Vinyl Disc */}
                <div className="w-9 h-9 rounded-full bg-slate-900 border-2 border-slate-700 p-1 mt-1 animate-spin-slow flex items-center justify-center">
                    <div className="w-4 h-4 rounded-full bg-rose-500" />
                </div>
            </div>

            {/* Bottom Caption & Audio Bar */}
            <div className="relative z-10 p-4 pb-5 space-y-2">
                <p className="font-bold text-sm tracking-wide">@{creatorHandle}</p>
                <p className="text-xs text-white/90 line-clamp-3 leading-relaxed whitespace-pre-wrap">
                    {caption || 'Add your viral hooks, storytelling, and hashtags... #viral #growth'}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-white/80 pt-1">
                    <Music className="w-3.5 h-3.5 animate-bounce" />
                    <div className="truncate max-w-[200px]">{soundTitle}</div>
                </div>
            </div>
        </div>
    );
}
