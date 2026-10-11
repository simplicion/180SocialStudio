'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Globe, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Copy, 
  Check, 
  Trash2, 
  RefreshCw, 
  ShieldCheck, 
  X,
  Zap
} from 'lucide-react';
import { LogoLoader } from './LogoLoader';

export interface DnsRecord {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  ttl?: number;
  description: string;
  status?: 'valid' | 'pending' | 'failed';
}

export interface DomainData {
  domain: string;
  type: 'ADVERTISING_WEBSITE' | 'TRAFFIC_LINK' | 'COMPANY_PROFILE';
  targetId: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'FAILED' | 'REMOVED';
  sslStatus: 'PENDING' | 'ACTIVE' | 'FAILED';
  isApex: boolean;
  records: DnsRecord[];
  verifiedAt?: string | null;
}

export interface DomainManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'ADVERTISING_WEBSITE' | 'TRAFFIC_LINK' | 'COMPANY_PROFILE';
  targetId: string;
  targetName?: string;
  initialDomain?: string | null;
  apiBaseUrl?: string;
  onDomainSaved?: (domain: string) => void;
  onDomainRemoved?: () => void;
}

export const DomainManagerModal: React.FC<DomainManagerModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetName = 'Resource',
  initialDomain = null,
  apiBaseUrl = '',
  onDomainSaved,
  onDomainRemoved
}) => {
  const [mounted, setMounted] = useState(false);
  const [domainMode, setDomainMode] = useState<'subdomain' | 'custom_domain'>('subdomain');
  const [subdomainSlug, setSubdomainSlug] = useState('');
  const [customDomainInput, setCustomDomainInput] = useState(initialDomain || '');
  const [activeDomainData, setActiveDomainData] = useState<DomainData | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityResult, setAvailabilityResult] = useState<{
    checked: boolean;
    available: boolean;
    reason?: string;
  } | null>(null);

  const platformRoot = (typeof window !== 'undefined' && (process.env.NEXT_PUBLIC_ROOT_DOMAIN || process.env.NEXT_PUBLIC_MAIN_DOMAIN)) 
    ? (process.env.NEXT_PUBLIC_ROOT_DOMAIN || process.env.NEXT_PUBLIC_MAIN_DOMAIN) 
    : (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? (window.location.port ? `${window.location.hostname}:${window.location.port}` : window.location.hostname)
        : (process.env.NEXT_PUBLIC_ROOT_DOMAIN || '180workspace.com'));

  const cleanCustomInput = customDomainInput.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const isApex = cleanCustomInput ? cleanCustomInput.split('.').filter(Boolean).length <= 2 : false;
  const cleanSubdomain = subdomainSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  const getApiUrl = (endpoint: string) => {
    let base = apiBaseUrl || '';
    if (!base && typeof window !== 'undefined') {
      base = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
      if (!base) {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        base = isLocal ? 'http://localhost:4002' : 'https://api.180workspace.com';
      }
    }
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${base}${cleanEndpoint}`;
  };

  const getAuthHeaders = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('platform_auth_token') ||
        document.cookie.match(/(^| )platform_auth_token=([^;]+)/)?.[2];
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  };

  const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
    const url = getApiUrl(endpoint);
    const res = await fetch(url, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers || {})
      }
    });

    const contentType = res.headers.get('content-type') || '';
    let json: any = null;
    if (contentType.includes('application/json')) {
      json = await res.json();
    } else {
      const text = await res.text();
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'Domain service endpoint is unavailable.' : text || `Server error (${res.status})`);
      }
      return { success: true, data: text };
    }

    if (!res.ok) {
      throw new Error(json.error || json.message || `Request failed with status ${res.status}`);
    }

    return json;
  };

  // Live debounced availability check
  useEffect(() => {
    if (domainMode !== 'subdomain' || !cleanSubdomain || cleanSubdomain.length < 2) {
      setAvailabilityResult(null);
      setCheckingAvailability(false);
      return;
    }

    setCheckingAvailability(true);
    const timer = setTimeout(async () => {
      try {
        const json = await apiRequest(`/api/v1/domains/check-availability?slug=${encodeURIComponent(cleanSubdomain)}&targetId=${encodeURIComponent(targetId)}`);
        setAvailabilityResult({
          checked: true,
          available: json.data?.available ?? false,
          reason: json.data?.reason
        });
      } catch (err: any) {
        setAvailabilityResult({
          checked: true,
          available: false,
          reason: err.message || 'Unable to verify availability.'
        });
      } finally {
        setCheckingAvailability(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [cleanSubdomain, domainMode, targetId, apiBaseUrl]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && initialDomain) {
      if (platformRoot && initialDomain.includes(platformRoot)) {
        setDomainMode('subdomain');
        setSubdomainSlug(initialDomain.replace(`.${platformRoot}`, ''));
      } else {
        setDomainMode('custom_domain');
        setCustomDomainInput(initialDomain);
      }
      fetchDomainStatus(initialDomain);
    } else if (isOpen) {
      setActiveDomainData(null);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen, initialDomain, platformRoot]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fetchDomainStatus = async (domainToFetch: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await apiRequest(`/api/v1/domains/${encodeURIComponent(domainToFetch)}/status`);
      if (data.data) {
        setActiveDomainData(data.data);
      }
    } catch (err: any) {
      console.warn('Could not fetch domain status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectSubdomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanSubdomain || cleanSubdomain.length < 2) {
      setErrorMessage('Please enter a valid subdomain prefix (e.g. "promo" or "mybrand")');
      return;
    }

    const fullSubdomain = `${cleanSubdomain}.${platformRoot}`;
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const json = await apiRequest('/api/v1/domains', {
        method: 'POST',
        body: JSON.stringify({
          domain: fullSubdomain,
          type: targetType,
          targetId
        })
      });

      setActiveDomainData({
        ...json.data,
        status: 'ACTIVE',
        sslStatus: 'ACTIVE',
        verifiedAt: new Date().toISOString()
      });
      setSuccessMessage(`Connected to https://${fullSubdomain}`);
      if (onDomainSaved) onDomainSaved(fullSubdomain);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error connecting platform subdomain');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCustomDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanCustomInput || !cleanCustomInput.includes('.')) {
      setErrorMessage('Please enter a valid custom domain (e.g. "yourbrand.com" or "go.yourbrand.com")');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const json = await apiRequest('/api/v1/domains', {
        method: 'POST',
        body: JSON.stringify({
          domain: cleanCustomInput,
          type: targetType,
          targetId
        })
      });

      setActiveDomainData(json.data);
      if (onDomainSaved) onDomainSaved(cleanCustomInput);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error connecting custom domain');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyDns = async () => {
    if (!activeDomainData?.domain) return;
    setVerifying(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const json = await apiRequest(`/api/v1/domains/${encodeURIComponent(activeDomainData.domain)}/verify`, {
        method: 'POST'
      });

      setActiveDomainData(prev => prev ? {
        ...prev,
        status: json.status,
        sslStatus: json.sslStatus,
        records: json.records || prev.records,
        verifiedAt: json.verified ? new Date().toISOString() : prev.verifiedAt
      } : null);

      if (json.verified) {
        setSuccessMessage('DNS verified successfully! Free SSL certificate is active.');
      } else {
        setErrorMessage(json.diagnostics?.message || 'DNS records not detected yet. Please allow a few minutes to propagate.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to verify DNS records');
    } finally {
      setVerifying(false);
    }
  };

  const handleDisconnect = async () => {
    if (!activeDomainData?.domain) return;
    if (!window.confirm(`Disconnect ${activeDomainData.domain}?`)) {
      return;
    }

    setLoading(true);
    try {
      await apiRequest(`/api/v1/domains/${encodeURIComponent(activeDomainData.domain)}`, {
        method: 'DELETE'
      });

      setActiveDomainData(null);
      setCustomDomainInput('');
      setSubdomainSlug('');
      setSuccessMessage('Domain disconnected.');
      if (onDomainRemoved) onDomainRemoved();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to disconnect domain');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] relative z-10 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                Domain Settings
                {activeDomainData?.status === 'ACTIVE' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-zinc-500">{targetName}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed font-medium">{successMessage}</div>
            </div>
          )}

          {!activeDomainData ? (
            <div className="space-y-4">
              {/* Option Selector Toggle */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl">
                <button
                  type="button"
                  onClick={() => { setDomainMode('subdomain'); setErrorMessage(null); }}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                    domainMode === 'subdomain'
                      ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-300 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>Platform Subdomain</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setDomainMode('custom_domain'); setErrorMessage(null); }}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                    domainMode === 'custom_domain'
                      ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-300 shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Custom Domain</span>
                </button>
              </div>

              {/* Mode 1: Platform Subdomain */}
              {domainMode === 'subdomain' && (
                <form onSubmit={handleConnectSubdomain} className="space-y-3 pt-1">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                        Subdomain Prefix
                      </label>
                      {checkingAvailability && (
                        <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                          <LogoLoader className="w-3 h-3 animate-spin text-indigo-500" />
                          Checking...
                        </span>
                      )}
                    </div>
                    <div className="flex items-center rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
                      <input
                        type="text"
                        value={subdomainSlug}
                        onChange={(e) => setSubdomainSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        placeholder="mybrand"
                        className="flex-1 px-3 py-2.5 bg-transparent text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none font-mono text-xs"
                      />
                      <span className="px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-300 font-mono text-xs border-l border-zinc-200 dark:border-zinc-700 select-none">
                        .{platformRoot}
                      </span>
                    </div>

                    {/* Live availability feedback */}
                    {cleanSubdomain.length >= 2 && !checkingAvailability && availabilityResult?.checked && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                        {availabilityResult.available ? (
                          <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <strong>{cleanSubdomain}.{platformRoot}</strong> is available!
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                            <AlertCircle className="w-3.5 h-3.5" />
                            {availabilityResult.reason || 'Subdomain is not available'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading || checkingAvailability || !availabilityResult?.available}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    {loading ? <LogoLoader className="w-4 h-4 animate-spin text-white" /> : <Zap className="w-3.5 h-3.5" />}
                    {checkingAvailability 
                      ? 'Checking Availability...' 
                      : availabilityResult?.available 
                        ? 'Connect Subdomain Instantly' 
                        : 'Enter Available Subdomain'}
                  </button>
                </form>
              )}

              {/* Mode 2: External Custom Domain */}
              {domainMode === 'custom_domain' && (
                <form onSubmit={handleConnectCustomDomain} className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                      Domain Name
                    </label>
                    <input
                      type="text"
                      value={customDomainInput}
                      onChange={(e) => setCustomDomainInput(e.target.value)}
                      placeholder="go.yourbrand.com or yourbrand.com"
                      className="w-full px-3 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !cleanCustomInput}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5"
                  >
                    {loading ? <LogoLoader className="w-4 h-4 animate-spin text-white" /> : <Globe className="w-3.5 h-3.5" />}
                    Add Domain & Get DNS Records
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* Connected Domain View */
            <div className="space-y-4">
              {/* Domain Header Card */}
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Connected Host</span>
                  <div className="text-sm font-bold text-zinc-900 dark:text-white font-mono">
                    {activeDomainData.domain}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {platformRoot && !activeDomainData.domain.includes(platformRoot) && (
                    <button
                      onClick={handleVerifyDns}
                      disabled={verifying}
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold rounded-lg transition-all flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${verifying ? 'animate-spin' : ''}`} />
                      {verifying ? 'Checking...' : 'Verify DNS'}
                    </button>
                  )}
                  <button
                    onClick={handleDisconnect}
                    disabled={loading}
                    className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                    title="Disconnect"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Status Banner */}
              <div className={`p-3 rounded-lg border flex items-center gap-2 ${
                activeDomainData.status === 'ACTIVE'
                  ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300'
              }`}>
                {activeDomainData.status === 'ACTIVE' ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                )}
                <span className="text-[11px] font-medium">
                  {activeDomainData.status === 'ACTIVE' 
                    ? 'Active and routing traffic with SSL' 
                    : 'Pending DNS verification at your registrar'}
                </span>
              </div>

              {/* DNS Records Table (Only for External Domains) */}
              {platformRoot && !activeDomainData.domain.includes(platformRoot) && (
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                    Required DNS Configuration
                  </span>

                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead>
                        <tr className="bg-zinc-100 dark:bg-zinc-900/80 text-zinc-600 dark:text-zinc-400 font-semibold">
                          <th className="py-2 px-2.5 border-b border-zinc-200 dark:border-zinc-800">Type</th>
                          <th className="py-2 px-2.5 border-b border-zinc-200 dark:border-zinc-800">Name</th>
                          <th className="py-2 px-2.5 border-b border-zinc-200 dark:border-zinc-800">Target</th>
                          <th className="py-2 px-2.5 border-b border-zinc-200 dark:border-zinc-800 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-mono">
                        {activeDomainData.records?.map((record, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30">
                            <td className="py-2 px-2.5 font-bold text-indigo-600 dark:text-indigo-400">
                              {record.type}
                            </td>
                            <td className="py-2 px-2.5 text-zinc-700 dark:text-zinc-300">
                              {record.name}
                            </td>
                            <td className="py-2 px-2.5 text-zinc-700 dark:text-zinc-300 truncate max-w-[150px]">
                              {record.value}
                            </td>
                            <td className="py-2 px-2.5 text-right">
                              <button
                                onClick={() => copyToClipboard(record.value, `rec-${idx}`)}
                                className="p-1 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                title="Copy Value"
                              >
                                {copiedKey === `rec-${idx}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-900/30">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold text-xs rounded-lg hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
