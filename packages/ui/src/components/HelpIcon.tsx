'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import clsx from 'clsx';

interface HelpIconProps {
    slug?: string;
    className?: string;
    helpText?: string;
    text?: string;
}

export default function HelpIcon({ slug = 'general', className, helpText, text }: HelpIconProps) {
    const displayHelp = text || helpText || "Help & Docs";
    const [showTooltip, setShowTooltip] = useState(false);

    return (
        <div className="relative inline-flex items-center">
            <a
                href='/help-support'
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className={clsx(
                    "group w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors",
                    className
                )}
            >
                <HelpCircle className="w-[14px] h-[14px] text-gray-400 dark:text-zinc-500 group-hover:text-indigo-500 dark:group-hover:text-zinc-200 transition-colors" />
            </a>

            {showTooltip && (
                <div
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-900 dark:bg-zinc-800 text-white text-[11px] font-medium rounded-lg shadow-xl whitespace-nowrap z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-1 duration-150"
                >
                    {displayHelp}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-zinc-800" />
                </div>
            )}
        </div>
    );
}
