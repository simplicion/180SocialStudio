"use client";
import { LogoLoader } from "./LogoLoader";
'use strict';

import React, { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { clsx } from 'clsx';


interface FavoriteButtonProps {
    recordId: string;
    type: 'Lead' | 'Opportunity' | 'Project' | 'Task' | 'Client' | 'Invoice' | 'User';
    label: string;
    href: string;
    className?: string;
}

const FavoriteButton: React.FC<FavoriteButtonProps> = ({ recordId, type, label, href, className }) => {
    const [isFavorite, setIsFavorite] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isToggling, setIsToggling] = useState(false);

    useEffect(() => {
        fetchStatus();
    }, [recordId]);

    const fetchStatus = async () => {
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('platform_auth_token') || localStorage.getItem('token') : null;
            const res = await fetch('/api/user-preferences', {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.ok) {
                const data = await res.json();
                const favorites = data.favorites || [];
                setIsFavorite(favorites.some((f: any) => f.recordId === recordId && f.type === type));
            }
        } catch (error) {
            console.error('Fetch favorite status error:', error);
        } finally {
            setLoading(false);
        }
    };

    const toggleFavorite = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setIsToggling(true);
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('platform_auth_token') || localStorage.getItem('token') : null;
            const res = await fetch('/api/user-preferences/favorites/toggle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    recordId,
                    type,
                    label,
                    href,
                }),
            });
            if (!res.ok) {
                throw new Error('Toggle favorite failed');
            }
            setIsFavorite(!isFavorite);
            toast.success(isFavorite ? 'Removed from favorites' : 'Added to favorites');

            // Dispatch custom event to notify sidebar
            window.dispatchEvent(new CustomEvent('favoritesUpdated'));
        } catch (error) {
            toast.error('Failed to update favorite');
        } finally {
            setIsToggling(false);
        }
    };

    if (loading) return <div className="w-8 h-8 flex items-center justify-center"><LogoLoader className="w-4 h-4 animate-spin text-gray-300 dark:text-zinc-600" /></div>;

    return (
        <button
            onClick={toggleFavorite}
            disabled={isToggling}
            className={clsx(
                "p-2 rounded-xl transition-all border min-h-[44px] min-w-[44px] flex items-center justify-center",
                isFavorite
                    ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-500 shadow-sm"
                    : "bg-white dark:bg-zinc-900 border-gray-100 dark:border-white/10 text-gray-400 dark:text-zinc-400 hover:text-amber-500 hover:border-amber-100 dark:hover:border-amber-500/20 hover:bg-amber-50/30 dark:hover:bg-amber-500/5",
                className
            )}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
            <Star className={clsx("w-5 h-5", isFavorite && "fill-current")} />
        </button>
    );
};

export default FavoriteButton;

