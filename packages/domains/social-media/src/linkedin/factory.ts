/**
 * Provider factory for LinkedIn integrations.
 * Resolves between MockLinkedInProvider and LinkedInLiveProvider based on
 * server environment configuration and simulation settings.
 */

import { getLinkedInProviderMode, LinkedInProviderMode } from './config';
import { LinkedInLiveProvider } from './live.provider';
import { MockLinkedInProvider } from './mock.provider';
import { ILinkedInProvider } from './types';

let cachedLiveProvider: LinkedInLiveProvider | null = null;
let cachedMockProvider: MockLinkedInProvider | null = null;

export class LinkedInProviderFactory {
    static getProvider(mode?: LinkedInProviderMode): ILinkedInProvider {
        const resolvedMode = mode || getLinkedInProviderMode();
        if (resolvedMode === 'mock') {
            if (!cachedMockProvider) {
                cachedMockProvider = new MockLinkedInProvider();
            }
            return cachedMockProvider;
        }
        if (!cachedLiveProvider) {
            cachedLiveProvider = new LinkedInLiveProvider();
        }
        return cachedLiveProvider;
    }

    /** Testing hook: override the mock instance */
    static setMockProvider(provider: MockLinkedInProvider | null) {
        cachedMockProvider = provider;
    }

    /** Testing hook: override the live instance */
    static setLiveProvider(provider: LinkedInLiveProvider | null) {
        cachedLiveProvider = provider;
    }

    /** Reset all singletons */
    static reset() {
        cachedMockProvider = null;
        cachedLiveProvider = null;
    }
}
