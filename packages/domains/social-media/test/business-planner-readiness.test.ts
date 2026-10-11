import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialPostService } from '../src/social-post.service';
import { PlatformMediaGuard } from '../src/media-platform-guard';
import { SmartTimezoneScheduler } from '../src/smart-timezone-scheduler';
import { BrandSafetyAuditor } from '../src/brand-safety-auditor';

test('Business Planner: Platform Media Guard computes LinkedIn constraints accurately', () => {
    // 1. Valid LinkedIn text post within 3000 chars
    const validLi = PlatformMediaGuard.validateForPlatform('linkedin', {
        caption: 'Excited to announce our autonomous B2B workspace #WorkGraph #AI',
        aspectRatio: '16:9',
        durationSeconds: 120,
        fileSizeMB: 50,
    });
    assert.equal(validLi.valid, true);
    assert.equal(validLi.errors.length, 0);

    // 2. Over-length caption (> 3000 chars)
    const overLengthLi = PlatformMediaGuard.validateForPlatform('linkedin', {
        caption: 'A'.repeat(3050),
    });
    assert.equal(overLengthLi.valid, false);
    assert.ok(overLengthLi.errors.some(e => e.includes('exceeds linkedin limit of 3000 chars')));

    // 3. Over-length video (> 900s)
    const longVideoLi = PlatformMediaGuard.validateForPlatform('linkedin', {
        caption: 'Video presentation',
        durationSeconds: 1000,
    });
    assert.equal(longVideoLi.valid, false);
    assert.ok(longVideoLi.errors.some(e => e.includes('exceeds linkedin max duration of 900s')));
});

test('Business Planner: Brand Safety Auditor computes violations for brand risk patterns', () => {
    const brandConfig = {
        forbiddenWords: ['cheap', 'guaranteed ROI'],
        competitors: ['CompetitorCorp'],
        tone: 'professional',
    };

    const dirtyContent = 'Try our cheap tool with guaranteed ROI better than CompetitorCorp!';
    const audit = BrandSafetyAuditor.auditContent(dirtyContent, brandConfig);

    assert.equal(audit.isSafe, false);
    assert.ok(audit.violations.some(v => v.type === 'forbidden_word' && v.keyword === 'cheap'));
    assert.ok(audit.violations.some(v => v.type === 'competitor_mention' && v.keyword === 'CompetitorCorp'));
    assert.ok(audit.score < 80);
});

test('Business Planner: Smart Timezone Scheduler detects spacing collisions', () => {
    const existing = [
        { id: 'post_alpha', scheduledFor: new Date('2026-10-20T10:00:00Z'), socialAccountId: 'li_acc_1' },
    ];
    const collidingTime = new Date('2026-10-20T10:07:00Z'); // 7 mins gap

    const collision = SmartTimezoneScheduler.checkScheduleCollision(collidingTime, existing, 'li_acc_1', 15);
    assert.equal(collision.hasCollision, true);
    assert.equal(collision.conflictingPostIds[0], 'post_alpha');
    assert.ok(collision.warningMessage?.includes('Algorithmic Spacing Warning'));
});
