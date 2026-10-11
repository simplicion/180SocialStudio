"use client";

import React, { useState, useRef, useEffect } from 'react';
import { 
    Trash2, 
    CheckSquare, 
    Square, 
    ChevronDown, 
    X, 
    Check, 
    ArrowRightLeft, 
    Download, 
    Layers,
    ListFilter,
    Hash
} from 'lucide-react';
import clsx from 'clsx';
import ConfirmModal from './ConfirmModal';
import { LogoLoader } from './LogoLoader';

export interface BulkActionCustomAction {
    id: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'success';
    onClick: () => Promise<void> | void;
    disabled?: boolean;
}

export interface BulkActionBarProps {
    /** Number of currently selected items */
    selectedCount: number;
    /** Total number of items available across the view/filter */
    totalCount: number;
    /** Optional entity label (e.g. "leads", "deals", "clients", "documents") */
    itemLabel?: string;
    /** Optional secondary metric or total value badge text (e.g. "$41,972 total value") */
    sublabel?: string;
    /** Callback to select all items */
    onSelectAll?: () => void;
    /** Callback to clear/deselect all items */
    onDeselectAll: () => void;
    /** Callback when user picks a specific amount (e.g. first 5, 10, 25, or custom number N) */
    onSelectAmount?: (amount: number) => void;
    /** Callback when bulk delete is triggered */
    onDeleteSelected?: () => Promise<void> | void;
    /** Whether bulk deletion is currently executing */
    isDeleting?: boolean;
    /** Custom title for the delete confirmation modal */
    deleteModalTitle?: string;
    /** Custom description for the delete confirmation modal */
    deleteModalMessage?: string;
    /** Additional custom action buttons (e.g. Move Stage, Export, etc.) */
    customActions?: BulkActionCustomAction[];
    /** Custom dropdown menus / content */
    children?: React.ReactNode;
    /** Preset amounts for quick selection (default: [5, 10, 25, 50]) */
    presetAmounts?: number[];
    /** Custom class name */
    className?: string;
}

export function BulkActionBar({
    selectedCount,
    totalCount,
    itemLabel = 'items',
    sublabel,
    onSelectAll,
    onDeselectAll,
    onSelectAmount,
    onDeleteSelected,
    isDeleting = false,
    deleteModalTitle,
    deleteModalMessage,
    customActions = [],
    children,
    presetAmounts = [5, 10, 25, 50],
    className
}: BulkActionBarProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isCustomAmountOpen, setIsCustomAmountOpen] = useState(false);
    const [customAmountInput, setCustomAmountInput] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsMenuOpen(false);
                setIsCustomAmountOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (selectedCount === 0) return null;

    const handleApplyCustomAmount = (e: React.FormEvent) => {
        e.preventDefault();
        const num = parseInt(customAmountInput, 10);
        if (!isNaN(num) && num > 0 && onSelectAmount) {
            onSelectAmount(Math.min(num, totalCount));
            setIsCustomAmountOpen(false);
            setIsMenuOpen(false);
            setCustomAmountInput('');
        }
    };

    const confirmTitle = deleteModalTitle || `Delete ${selectedCount} ${itemLabel}`;
    const confirmMessage = deleteModalMessage || `Are you sure you want to delete ${selectedCount} selected ${itemLabel}? This action cannot be undone.`;

    return (
        <>
            <div 
                className={clsx(
                    "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
                    "w-[95%] max-w-4xl",
                    "backdrop-blur-xl bg-white/95 dark:bg-zinc-950/95",
                    "border border-indigo-100 dark:border-zinc-800",
                    "shadow-[0_20px_50px_rgba(79,70,229,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)]",
                    "rounded-2xl p-3 sm:px-5 sm:py-3.5",
                    "flex flex-wrap items-center justify-between gap-3 sm:gap-4",
                    "animate-in slide-in-from-bottom-6 fade-in duration-300",
                    className
                )}
            >
                {/* Left Side: Counter, Info & Amount Dropdown */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-indigo-600 text-white font-black text-xs shadow-sm">
                            {selectedCount}
                        </span>
                        <div>
                            <p className="text-xs sm:text-sm font-bold text-gray-900 dark:text-zinc-100 leading-none">
                                {selectedCount} of {totalCount} {itemLabel} selected
                            </p>
                            {sublabel && (
                                <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">
                                    {sublabel}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Select Amount / Presets Menu */}
                    {onSelectAmount && (
                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => {
                                    setIsMenuOpen(prev => !prev);
                                    setIsCustomAmountOpen(false);
                                }}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 text-xs font-semibold rounded-lg transition-colors border border-gray-200/80 dark:border-zinc-700"
                                title="Select a specific quantity of items"
                            >
                                <ListFilter className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                <span>Select Amount</span>
                                <ChevronDown className={clsx("w-3 h-3 transition-transform", isMenuOpen && "rotate-180")} />
                            </button>

                            {/* Presets Popover Dropdown */}
                            {isMenuOpen && (
                                <div className="absolute left-0 bottom-full mb-2 w-56 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-100 dark:border-zinc-800 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                                    <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                                        Selection Presets
                                    </div>
                                    
                                    {onSelectAll && (
                                        <button
                                            onClick={() => {
                                                onSelectAll();
                                                setIsMenuOpen(false);
                                            }}
                                            className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 hover:text-indigo-600 rounded-lg flex items-center justify-between transition-colors"
                                        >
                                            <span>Select All ({totalCount})</span>
                                            <Check className={clsx("w-3.5 h-3.5 text-indigo-600", selectedCount === totalCount ? "opacity-100" : "opacity-0")} />
                                        </button>
                                    )}

                                    {presetAmounts.map((amt) => {
                                        if (amt > totalCount && totalCount > 0) return null;
                                        const isMatch = selectedCount === amt;
                                        return (
                                            <button
                                                key={amt}
                                                onClick={() => {
                                                    onSelectAmount(amt);
                                                    setIsMenuOpen(false);
                                                }}
                                                className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-zinc-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 hover:text-indigo-600 rounded-lg flex items-center justify-between transition-colors"
                                            >
                                                <span>First {amt} {itemLabel}</span>
                                                <Check className={clsx("w-3.5 h-3.5 text-indigo-600", isMatch ? "opacity-100" : "opacity-0")} />
                                            </button>
                                        );
                                    })}

                                    <div className="my-1 border-t border-gray-100 dark:border-zinc-800" />

                                    {/* Custom Amount Option */}
                                    {!isCustomAmountOpen ? (
                                        <button
                                            onClick={() => setIsCustomAmountOpen(true)}
                                            className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg flex items-center gap-2 transition-colors"
                                        >
                                            <Hash className="w-3.5 h-3.5" />
                                            <span>Custom amount...</span>
                                        </button>
                                    ) : (
                                        <form onSubmit={handleApplyCustomAmount} className="p-1.5 flex items-center gap-1.5">
                                            <input
                                                type="number"
                                                min="1"
                                                max={totalCount}
                                                autoFocus
                                                placeholder={`1 - ${totalCount}`}
                                                value={customAmountInput}
                                                onChange={(e) => setCustomAmountInput(e.target.value)}
                                                className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-zinc-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                                            />
                                            <button
                                                type="submit"
                                                className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors"
                                            >
                                                Apply
                                            </button>
                                        </form>
                                    )}

                                    <div className="my-1 border-t border-gray-100 dark:border-zinc-800" />

                                    <button
                                        onClick={() => {
                                            onDeselectAll();
                                            setIsMenuOpen(false);
                                        }}
                                        className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg flex items-center gap-2 transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        <span>Deselect All</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Side: Actions (Custom actions, children, and Delete Button) */}
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Extra Slot / Children (e.g. Stage Mover dropdown) */}
                    {children}

                    {/* Custom Action Buttons */}
                    {customActions.map((action) => {
                        const Icon = action.icon;
                        return (
                            <button
                                key={action.id}
                                onClick={action.onClick}
                                disabled={action.disabled}
                                className={clsx(
                                    "px-3 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50",
                                    action.variant === 'primary' && "bg-indigo-600 hover:bg-indigo-700 text-white",
                                    action.variant === 'success' && "bg-emerald-600 hover:bg-emerald-700 text-white",
                                    (!action.variant || action.variant === 'secondary') && "bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-100 border border-gray-200 dark:border-zinc-700"
                                )}
                            >
                                {Icon && <Icon className="w-3.5 h-3.5" />}
                                <span>{action.label}</span>
                            </button>
                        );
                    })}

                    {/* Bulk Delete Button */}
                    {onDeleteSelected && (
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            disabled={isDeleting}
                            className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                            {isDeleting ? (
                                <LogoLoader className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                            )}
                            <span>Delete Selected ({selectedCount})</span>
                        </button>
                    )}

                    {/* Dismiss Button */}
                    <button
                        onClick={onDeselectAll}
                        title="Clear selection"
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Bulk Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={showDeleteConfirm}
                title={confirmTitle}
                message={confirmMessage}
                confirmText={`Delete ${selectedCount} ${itemLabel}`}
                variant="danger"
                loading={isDeleting}
                onConfirm={async () => {
                    if (onDeleteSelected) {
                        await onDeleteSelected();
                    }
                    setShowDeleteConfirm(false);
                }}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </>
    );
}

export default BulkActionBar;
