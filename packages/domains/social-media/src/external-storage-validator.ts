'use strict';

/**
 * ExternalStorageValidator
 * Validates external cloud storage links (Google Drive, Dropbox, Box, Frame.io)
 * and computes storage lifecycle retention countdowns.
 */

export interface CloudLinkValidationResult {
    isValid: boolean;
    provider: 'google_drive' | 'dropbox' | 'box' | 'frameio' | 'onedrive' | 'direct_url' | 'unknown';
    isShareable: boolean;
    fileId?: string;
    warning?: string;
    error?: string;
}

export interface StorageRetentionInfo {
    retentionDays: number;
    createdAt: Date;
    expiresAt: Date;
    isExpired: boolean;
    hoursRemaining: number;
    badgeStatus: 'active' | 'expiring_soon' | 'expired';
}

export class ExternalStorageValidator {
    /**
     * Validates and identifies cloud storage link formats
     */
    static validateCloudLink(urlStr: string): CloudLinkValidationResult {
        if (!urlStr || typeof urlStr !== 'string') {
            return {
                isValid: false,
                provider: 'unknown',
                isShareable: false,
                error: 'Empty or invalid URL provided.',
            };
        }

        const trimmed = urlStr.trim();

        // 1. Google Drive
        if (trimmed.includes('drive.google.com')) {
            const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
            const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
            const id = fileMatch ? fileMatch[1] : folderMatch ? folderMatch[1] : undefined;

            return {
                isValid: true,
                provider: 'google_drive',
                isShareable: trimmed.includes('sharing') || trimmed.includes('usp=sharing') || !!id,
                fileId: id,
                warning: !trimmed.includes('sharing')
                    ? 'Ensure link sharing permissions are set to "Anyone with the link can view/edit".'
                    : undefined,
            };
        }

        // 2. Dropbox
        if (trimmed.includes('dropbox.com')) {
            return {
                isValid: true,
                provider: 'dropbox',
                isShareable: trimmed.includes('dl=0') || trimmed.includes('dl=1') || trimmed.includes('/s/'),
                warning: 'Verify Dropbox shared link has not expired.',
            };
        }

        // 3. Frame.io
        if (trimmed.includes('frame.io')) {
            return {
                isValid: true,
                provider: 'frameio',
                isShareable: true,
            };
        }

        // 4. Box
        if (trimmed.includes('box.com')) {
            return {
                isValid: true,
                provider: 'box',
                isShareable: trimmed.includes('/s/'),
            };
        }

        // 5. OneDrive / SharePoint
        if (trimmed.includes('1drv.ms') || trimmed.includes('sharepoint.com')) {
            return {
                isValid: true,
                provider: 'onedrive',
                isShareable: true,
            };
        }

        // Direct HTTP/HTTPS Video or Media link
        if (trimmed.match(/^https?:\/\/.*\.(mp4|mov|avi|mkv|png|jpg|jpeg|webp)(\?.*)?$/i)) {
            return {
                isValid: true,
                provider: 'direct_url',
                isShareable: true,
            };
        }

        return {
            isValid: trimmed.startsWith('http://') || trimmed.startsWith('https://'),
            provider: 'unknown',
            isShareable: false,
            warning: 'Unrecognized cloud storage provider. Ensure media editor has direct access credentials.',
        };
    }

    /**
     * Calculates storage retention lifecycle for temporary rendering files
     */
    static calculateRetention(createdAtDate: Date | string, retentionDays: number = 7): StorageRetentionInfo {
        const created = typeof createdAtDate === 'string' ? new Date(createdAtDate) : createdAtDate;
        const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(created.getTime() + retentionMs);
        const now = new Date();

        const diffMs = expiresAt.getTime() - now.getTime();
        const hoursRemaining = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
        const isExpired = diffMs <= 0;

        let badgeStatus: StorageRetentionInfo['badgeStatus'] = 'active';
        if (isExpired) {
            badgeStatus = 'expired';
        } else if (hoursRemaining <= 24) {
            badgeStatus = 'expiring_soon';
        }

        return {
            retentionDays,
            createdAt: created,
            expiresAt,
            isExpired,
            hoursRemaining,
            badgeStatus,
        };
    }
}
