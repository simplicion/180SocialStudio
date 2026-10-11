/**
 * Provider factory for YouTube integrations.
 * Resolves between MockYouTubeProvider and YouTubeLiveProvider based on
 * server environment configuration and simulation settings.
 */

import { getYouTubeProviderMode } from './config';
import { YouTubeLiveProvider } from './live.provider';
import { MockYouTubeProvider } from './mock.provider';
import { IYouTubeProvider } from './types';

let cachedLiveProvider: YouTubeLiveProvider | null = null;
let cachedMockProvider: MockYouTubeProvider | null = null;

export class YouTubeProviderFactory {
    static getProvider(mode?: 'mock' | 'live'): IYouTubeProvider {
        const resolvedMode = mode || getYouTubeProviderMode();
        if (resolvedMode === 'mock') {
            if (!cachedMockProvider) {
                cachedMockProvider = new MockYouTubeProvider();
            }
            return cachedMockProvider;
        }
        if (!cachedLiveProvider) {
            cachedLiveProvider = new YouTubeLiveProvider();
        }
        return cachedLiveProvider;
    }

    /** Testing hook: override the mock instance */
    static setMockProvider(provider: MockYouTubeProvider | null) {
        cachedMockProvider = provider;
    }

    /** Testing hook: override the live instance */
    static setLiveProvider(provider: YouTubeLiveProvider | null) {
        cachedLiveProvider = provider;
    }

    /** Reset all singletons */
    static reset() {
        cachedMockProvider = null;
        cachedLiveProvider = null;
    }
}
