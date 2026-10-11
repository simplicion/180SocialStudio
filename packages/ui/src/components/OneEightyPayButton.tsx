'use client';

import React, { useState, useEffect } from 'react';

export interface OneEightyPayButtonProps {
  amount?: number;
  currency?: string;
  planCode?: string;
  title?: string;
  description?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
  payServerUrl?: string;
  uxMode?: 'bottom_sheet' | 'full_page' | 'popup' | 'auto';
  text?: string;
  subText?: string;
  variant?: 'dark' | 'light' | 'emerald';
  className?: string;
  onSuccess?: (result: any) => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

export const OneEightyPayButton: React.FC<OneEightyPayButtonProps> = ({
  amount = 0,
  currency = 'USD',
  planCode,
  title = 'Pay with 180 Pay',
  description,
  sessionId,
  metadata,
  payServerUrl,
  uxMode = 'auto',
  text,
  subText,
  variant = 'emerald',
  className = '',
  onSuccess,
  onError,
  onCancel,
}) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;
      const data = typeof event.data === 'string' ? (() => { try { return JSON.parse(event.data); } catch (_) { return null; } })() : event.data;
      if (!data) return;

      if (data.type === '180_PAY_SUCCESS' || data.type === '180_PAYMENT_SUCCESS') {
        setLoading(false);
        if (onSuccess) onSuccess(data);
      } else if (data.type === '180_PAY_ERROR' || data.type === '180_PAYMENT_ERROR') {
        setLoading(false);
        if (onError) onError(data.error_description || data.error || data.message || 'Payment failed');
      } else if (data.type === '180_PAYMENT_CLOSE' || data.type === '180_PAY_CLOSE') {
        setLoading(false);
        if (onCancel) onCancel();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess, onError, onCancel]);

  const handleClick = async () => {
    setLoading(true);
    try {
      // 1. If 180 Core SDK is available on window, use its unified pay service
      if (typeof window !== 'undefined' && (window as any).OneEighty?.pay?.checkout) {
        const result = await (window as any).OneEighty.pay.checkout({
          amount,
          currency,
          planCode,
          title,
          description,
          sessionId,
          metadata,
          payServerUrl,
          uxMode,
          onSuccess: (res: any) => {
            setLoading(false);
            if (onSuccess) onSuccess(res);
          },
          onError: (err: any) => {
            setLoading(false);
            if (onError) onError(err?.message || 'Payment failed');
          },
          onCancel: () => {
            setLoading(false);
            if (onCancel) onCancel();
          },
        });
        if (result && onSuccess) {
          onSuccess(result);
        }
      } else {
        // 2. Direct fallback
        const baseUrl = payServerUrl || (typeof window !== 'undefined' && window.location.hostname.endsWith('180workspace.com')
          ? 'https://pay.180workspace.com'
          : 'http://localhost:3009');
        const sid = sessionId || 'cs_' + Math.random().toString(36).substring(2, 14);
        const query = [
          amount ? `amount=${encodeURIComponent(amount)}` : '',
          currency ? `currency=${encodeURIComponent(currency)}` : '',
          planCode ? `plan=${encodeURIComponent(planCode)}` : '',
          title ? `title=${encodeURIComponent(title)}` : '',
          'ux_mode=bottom_sheet',
        ].filter(Boolean).join('&');

        const payUrl = `${baseUrl}/checkout/${encodeURIComponent(sid)}?${query}`;
        window.open(payUrl, '180_pay_checkout', 'width=480,height=720,scrollbars=yes');
      }
    } catch (err: any) {
      if (onError) onError(err?.message || 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  const isDark = variant === 'dark';
  const isEmerald = variant === 'emerald';

  const primaryLabel = text || (amount > 0 ? `Pay $${amount} ${currency}` : title);
  const secondaryLabel = subText || (planCode ? `Plan: ${planCode}` : 'Sovereign Escrow Checkout');

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-3 px-4 py-2.5 rounded-xl font-sans transition-all duration-200 cursor-pointer select-none active:scale-[0.98] outline-none group text-left ${
        isEmerald
          ? 'bg-[#09090b] hover:bg-[#121215] text-white border border-emerald-500/40 shadow-[0_4px_16px_rgba(16,185,129,0.15)] hover:border-emerald-500/60'
          : isDark
          ? 'bg-[#09090b] hover:bg-[#121215] text-white border border-white/15 shadow-[0_4px_16px_rgba(0,0,0,0.35)] hover:border-white/30'
          : 'bg-white hover:bg-zinc-50 text-zinc-950 border border-zinc-200/90 shadow-[0_2px_10px_rgba(0,0,0,0.06)] hover:border-zinc-300'
      } ${className}`}
      aria-label={`${primaryLabel} ${secondaryLabel}`}
    >
      {/* 180 Pay Currency/Escrow Icon Badge */}
      <div className="relative shrink-0 flex items-center justify-center">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
        </div>
      </div>

      {/* Label and Subtitle */}
      <div className="flex flex-col text-left leading-none py-0.5">
        <span className="text-[13.5px] font-bold tracking-tight text-white mb-0.5">
          {loading ? 'Processing...' : primaryLabel}
        </span>
        <span className="text-[10px] font-semibold text-emerald-400/90">
          {secondaryLabel}
        </span>
      </div>
    </button>
  );
};

export default OneEightyPayButton;
