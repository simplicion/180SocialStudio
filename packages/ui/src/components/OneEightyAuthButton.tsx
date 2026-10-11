'use client';

import React, { useState, useEffect } from 'react';

export interface OneEightyAuthButtonProps {
  clientId: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  uxMode?: 'popup' | 'redirect';
  authBase?: string;
  text?: string;
  subText?: string;
  variant?: 'dark' | 'light';
  className?: string;
  onSuccess?: (code: string) => void;
  onError?: (error: string) => void;
}

export const OneEightyAuthButton: React.FC<OneEightyAuthButtonProps> = ({
  clientId,
  redirectUri,
  scope = 'openid identity:read identity:email',
  state,
  uxMode = 'popup',
  authBase,
  text = 'Get Started',
  subText = 'with 180 Profile',
  variant = 'dark',
  className = '',
  onSuccess,
  onError,
}) => {
  const [loading, setLoading] = useState(false);

  const getResolvedAuthBase = () => {
    if (authBase) return authBase;
    if (typeof window !== 'undefined') {
      const isInternalDev = (window as any).__180_INTERNAL_DEV__ === true || (window as any).__180_ENV__ === 'development';
      return isInternalDev ? 'http://localhost:3009/auth/login' : 'https://profile.180workspace.com/auth/login';
    }
    return 'https://profile.180workspace.com/auth/login';
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;
      const data = typeof event.data === 'string' ? (() => { try { return JSON.parse(event.data); } catch (_) { return null; } })() : event.data;
      if (!data) return;

      if (data.type === '180_AUTH_SUCCESS' || data.type === '180_IDENTITY_SUCCESS') {
        const code = data.code || data.authToken || data.token || data.accessToken;
        setLoading(false);
        if (onSuccess) onSuccess(code);
      } else if (data.type === '180_AUTH_ERROR' || data.type === '180_IDENTITY_ERROR') {
        setLoading(false);
        if (onError) onError(data.error_description || data.error || data.message || 'Authentication failed');
      } else if (data.type === '180_IDENTITY_CLOSE' || data.type === '180_AUTH_CLOSE') {
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess, onError]);

  const handleClick = async () => {
    // 1. If 180 Core SDK is present in window, use its adaptive bottom-sheet / modal engine
    if (typeof window !== 'undefined' && (window as any).OneEighty?.auth?.signIn) {
      setLoading(true);
      try {
        const result = await (window as any).OneEighty.auth.signIn({
          clientId,
          scope,
          redirectUri,
          state,
          uxMode: uxMode === 'redirect' ? 'fullscreen' : 'auto',
          onSuccess: (res: any) => {
            setLoading(false);
            if (onSuccess) onSuccess(res?.code || res?.token || res?.accessToken);
          },
          onError: (err: any) => {
            setLoading(false);
            if (onError) onError(err?.message || 'Authentication failed');
          },
          onCancel: () => {
            setLoading(false);
          },
        });
        if (result && onSuccess) {
          onSuccess(result.code || result.token || result.accessToken);
        }
      } catch (err: any) {
        if (onError) onError(err?.message || 'Authentication failed');
      } finally {
        setLoading(false);
      }
      return;
    }

    // 2. Direct Web Fallback (Popup or Redirect)
    const base = getResolvedAuthBase();
    const resolvedRedirect = redirectUri || (typeof window !== 'undefined' ? window.location.href : '');
    const resolvedState = state || 'st_' + Math.random().toString(36).substring(2, 12);

    const authUrl = `${base}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(
      resolvedRedirect
    )}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(resolvedState)}&response_type=code&ux_mode=${uxMode}`;

    if (uxMode === 'redirect') {
      window.location.href = authUrl;
      return;
    }

    // Popup flow
    setLoading(true);
    const width = 450;
    const height = 680;
    const left = window.screen.width ? (window.screen.width - width) / 2 : 100;
    const top = window.screen.height ? (window.screen.height - height) / 2 : 100;

    const popup = window.open(
      authUrl,
      '180_profile_auth',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=no,toolbar=no,resizable=yes`
    );

    // Watch for closed popup
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setLoading(false);
      }
    }, 800);
  };

  const isDark = variant === 'dark';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-3.5 px-5 py-2.5 rounded-2xl font-sans transition-all duration-200 cursor-pointer select-none active:scale-[0.98] outline-none group text-left ${
        isDark
          ? 'bg-[#09090b] hover:bg-[#121215] text-white border border-white/15 shadow-[0_4px_16px_rgba(0,0,0,0.35)] hover:border-white/30'
          : 'bg-white hover:bg-zinc-50 text-zinc-950 border border-zinc-200/90 shadow-[0_2px_10px_rgba(0,0,0,0.06)] hover:border-zinc-300'
      } ${className}`}
      aria-label={`${text} ${subText}`}
    >
      {/* 180 Brand Logo Emblem (Large Left Icon) */}
      <div className="relative shrink-0 flex items-center justify-center">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#6366f1] via-[#8b5cf6] to-[#d946ef] p-[1.5px] shadow-sm group-hover:shadow-md transition-shadow">
          <div className="w-full h-full bg-[#09090b] rounded-[10px] flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2L2 7L12 12L22 7L12 2Z"
                stroke="url(#gradient-brand)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 17L12 22L22 17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 12L12 17L22 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient id="gradient-brand" x1="2" y1="2" x2="22" y2="12" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#818cf8" />
                  <stop offset="1" stopColor="#c084fc" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      {/* Typography: Big Primary Text + Small Gradient Subtitle */}
      <div className="flex flex-col text-left leading-none py-0.5">
        <span
          className={`text-[15px] font-bold tracking-tight mb-1 ${
            isDark ? 'text-white' : 'text-zinc-950'
          }`}
        >
          {loading ? 'Connecting...' : text}
        </span>
        <span className="text-[11px] font-semibold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          {subText}
        </span>
      </div>
    </button>
  );
};

export default OneEightyAuthButton;
