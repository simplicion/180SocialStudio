'use client';

import React, { useState, useEffect } from 'react';
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

export interface DomainManagerProps {
  targetType: 'ADVERTISING_WEBSITE' | 'TRAFFIC_LINK' | 'COMPANY_PROFILE';
  targetId: string;
  targetName?: string;
  initialDomain?: string | null;
  apiBaseUrl?: string;
  onDomainSaved?: (domain: string) => void;
  onDomainRemoved?: () => void;
  onClose?: () => void;
}

export const DomainManager: React.FC<DomainManagerProps> = ({
  targetType,
  targetId,
  targetName = 'Resource',
  initialDomain = null,
  apiBaseUrl = '',
  onDomainSaved,
  onDomainRemoved,
  onClose
}) => {
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
        const res = await fetch(getApiUrl(`/api/v1/domains/check-availability?slug=${encodeURIComponent(cleanSubdomain)}&targetId=${encodeURIComponent(targetId)}`));
        if (res.ok) {
          const json = await res.json();
          setAvailabilityResult({
            checked: true,
            available: json.data?.available ?? false,
            reason: json.data?.reason
          });
        } else {
          setAvailabilityResult({
            checked: true,
            available: false,
            reason: 'Unable to verify availability.'
          });
        }
      } catch (err) {
        setAvailabilityResult({
          checked: true,
          available: false,
          reason: 'Network error checking availability.'
        });
      } finally {
        setCheckingAvailability(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [cleanSubdomain, domainMode, targetId, apiBaseUrl]);

  useEffect(() => {
    if (initialDomain) {
      if (initialDomain.includes(platformRoot)) {
        setDomainMode('subdomain');
        setSubdomainSlug(initialDomain.replace(`.${platformRoot}`, ''));
      } else {
        setDomainMode('custom_domain');
        setCustomDomainInput(initialDomain);
      }
      fetchDomainStatus(initialDomain);
    } else {
      setActiveDomainData(null);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [initialDomain, platformRoot]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fetchDomainStatus = async (domainToFetch: string) => {
    try {
      setLoading(true);
      const res = await fetch(getApiUrl(`/api/v1/domains/${encodeURIComponent(domainToFetch)}/status`));
      if (res.ok) {
        const json = await res.json();
        setActiveDomainData(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch domain status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectSubdomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanSubdomain) return;
    if (cleanSubdomain.length < 2) {
      setErrorMessage('Subdomain must be at least 2 characters.');
      return;
    }
    if (!availabilityResult?.available) {
      setErrorMessage('Please choose an available subdomain.');
      return;
    }

    const fullDomain = `${cleanSubdomain}.${platformRoot}`;
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(getApiUrl('/api/v1/domains'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: fullDomain,
          type: targetType,
          targetId
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to connect subdomain');
      }

      setActiveDomainData(json.data);
      setSuccessMessage(`Subdomain https://${fullDomain} connected successfully!`);
      if (onDomainSaved) onDomainSaved(fullDomain);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to connect subdomain');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCustomDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanCustomInput) return;

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(getApiUrl('/api/v1/domains'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: cleanCustomInput,
          type: targetType,
          targetId
        })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to register custom domain');
      }

      setActiveDomainData(json.data);
      setSuccessMessage(`Domain ${cleanCustomInput} added. Please configure the DNS records below.`);
      if (onDomainSaved) onDomainSaved(cleanCustomInput);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to add custom domain');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!activeDomainData?.domain) return;
    setVerifying(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const base = apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
      const res = await fetch(`${base}/api/v1/domains/${encodeURIComponent(activeDomainData.domain)}/verify`, {
        method: 'POST'
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Domain verification failed');
      }

      setActiveDomainData(json.data);
      if (json.data.status === 'ACTIVE') {
        setSuccessMessage('Domain verified and SSL certificate active!');
      } else {
        setErrorMessage('DNS records not detected yet. DNS propagation may take a few minutes.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Verification check failed');
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
      await fetch(getApiUrl(`/api/v1/domains/${encodeURIComponent(activeDomainData.domain)}`), {
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

  return (
    <div className="space-y-4 text-xs">
      {errorMessage && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 flex items-start gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">{errorMessage}</div>
        </div>
      )}

      {successMessage && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 flex items-start gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">{successMessage}</div>
        </div>
      )}

      {/* No active domain connected: show connection options */}
      {!activeDomainData ? (
        <div className="space-y-3.5">
          {/* Segmented Mode Selector */}
          <div className="grid grid-cols-2 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl gap-1">
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
                      Checking availability...
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
          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="font-mono font-bold text-zinc-900 dark:text-white text-xs truncate">
                  {activeDomainData.domain}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                  {activeDomainData.status === 'ACTIVE' ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3 h-3" /> SSL Active & Routing
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                      <Clock className="w-3 h-3" /> Pending DNS Setup
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeDomainData.status !== 'ACTIVE' && (
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${verifying ? 'animate-spin' : ''}`} />
                  Verify
                </button>
              )}
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="p-1.5 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                title="Disconnect Domain"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* DNS Configuration Table */}
          {activeDomainData.records && activeDomainData.records.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Required DNS Records
                </span>
                <span className="text-zinc-400">
                  Configure at your DNS provider
                </span>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 font-semibold">
                      <th className="py-2 px-2.5">Type</th>
                      <th className="py-2 px-2.5">Name</th>
                      <th className="py-2 px-2.5">Value</th>
                      <th className="py-2 px-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-mono">
                    {activeDomainData.records.map((record, idx) => (
                      <tr key={idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                        <td className="py-2 px-2.5 font-bold text-indigo-600 dark:text-indigo-400">{record.type}</td>
                        <td className="py-2 px-2.5 text-zinc-700 dark:text-zinc-300">
                          <span className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                            {record.name}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-zinc-600 dark:text-zinc-400 max-w-[140px] truncate" title={record.value}>
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
  );
};
