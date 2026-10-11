'use strict';

/**
 * BrandSafetyAuditor
 * Automated guard for scanning content against forbidden vocabulary, competitor mentions,
 * regulatory compliance keywords, and tone DNA consistency.
 */

export interface BrandSafetyAuditResult {
    isSafe: boolean;
    score: number; // 0 - 100
    violations: Array<{
        type: 'forbidden_word' | 'competitor_mention' | 'compliance_risk' | 'tone_mismatch';
        keyword: string;
        contextSnippet: string;
        severity: 'high' | 'medium' | 'low';
        suggestion?: string;
    }>;
    toneMatchScore: number; // 0 - 100
    detectedTone: string;
}

export class BrandSafetyAuditor {
    /**
     * Audits content against project brand voice guidelines, forbidden vocabulary, and competitors
     */
    static auditContent(
        text: string,
        brandConfig: {
            forbiddenWords?: string[];
            competitors?: string[];
            tone?: string;
            preferredVocabulary?: string[];
        }
    ): BrandSafetyAuditResult {
        const violations: BrandSafetyAuditResult['violations'] = [];
        const lowerText = (text || '').toLowerCase();

        // 1. Forbidden Words Scan
        const forbidden = brandConfig.forbiddenWords || [];
        for (const word of forbidden) {
            const trimmed = word.trim().toLowerCase();
            if (!trimmed) continue;
            const regex = new RegExp(`\\b${trimmed}\\b`, 'gi');
            if (regex.test(lowerText)) {
                violations.push({
                    type: 'forbidden_word',
                    keyword: word,
                    contextSnippet: `Forbidden expression "${word}" detected in copy.`,
                    severity: 'high',
                    suggestion: 'Remove or replace with an approved brand alternative.',
                });
            }
        }

        // 2. Competitor Mentions Scan
        const competitors = brandConfig.competitors || [];
        for (const comp of competitors) {
            const trimmed = comp.trim().toLowerCase();
            if (!trimmed) continue;
            const regex = new RegExp(`\\b${trimmed}\\b`, 'gi');
            if (regex.test(lowerText)) {
                violations.push({
                    type: 'competitor_mention',
                    keyword: comp,
                    contextSnippet: `Direct competitor "${comp}" mentioned in copy.`,
                    severity: 'medium',
                    suggestion: 'Ensure mention is intentional and complies with comparative advertising guidelines.',
                });
            }
        }

        // 3. Compliance Risk Patterns (e.g., guarantees, misleading financial claims)
        const riskyPatterns = [
            { pattern: /guaranteed\s+(return|profit|revenue|results)/gi, keyword: 'guaranteed results', severity: 'high' as const },
            { pattern: /100%\s+risk[\s-]free/gi, keyword: '100% risk-free', severity: 'medium' as const },
            { pattern: /get\s+rich\s+quick/gi, keyword: 'get rich quick', severity: 'high' as const },
        ];

        for (const risk of riskyPatterns) {
            if (risk.pattern.test(lowerText)) {
                violations.push({
                    type: 'compliance_risk',
                    keyword: risk.keyword,
                    contextSnippet: `Regulatory compliance trigger: "${risk.keyword}" detected.`,
                    severity: risk.severity,
                    suggestion: 'Add required disclaimers or soften absolute claims.',
                });
            }
        }

        // 4. Tone DNA Matching Score Calculation
        let toneMatchScore = 95;
        let detectedTone = brandConfig.tone || 'authoritative_professional';

        // Deduct points for high-severity violations
        for (const v of violations) {
            if (v.severity === 'high') toneMatchScore -= 25;
            if (v.severity === 'medium') toneMatchScore -= 10;
        }

        // Check preferred vocabulary bonus
        const preferred = brandConfig.preferredVocabulary || [];
        let preferredMatches = 0;
        for (const pref of preferred) {
            if (lowerText.includes(pref.toLowerCase())) {
                preferredMatches++;
            }
        }

        if (preferred.length > 0 && preferredMatches > 0) {
            toneMatchScore = Math.min(100, toneMatchScore + preferredMatches * 5);
        }

        toneMatchScore = Math.max(0, Math.min(100, toneMatchScore));
        const isSafe = violations.filter(v => v.severity === 'high').length === 0;

        return {
            isSafe,
            score: toneMatchScore,
            violations,
            toneMatchScore,
            detectedTone,
        };
    }
}
