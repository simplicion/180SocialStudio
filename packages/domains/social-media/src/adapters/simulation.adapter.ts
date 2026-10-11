/**
 * Sandbox publisher (SIMULATE_SOCIAL_PUBLISHING=true, never in production: getPublisher only wraps publishers with
 * this class when isSimulationMode() is true, which is hard-off under NODE_ENV=production).
 * Runs the platform's REAL validate() so every limit (caption length, carousel size, durations, boards, titles…)
 * is still enforced, then returns a result that is unmistakably fake: externalId `sim_<platform>_…`,
 * meta.simulated = true and a permalink on the platform's domain that does not exist.
 */
import { isSimulationMode, type PublishPlatform } from '../publishing/config';
import { PublishError } from '../publishing/errors';
import { PlatformPublisher, PublishInput, PublishOutcome } from './types';

export class SimulatedPlatformPublisher implements PlatformPublisher {
    constructor(
        readonly platform: PublishPlatform,
        private readonly realPublisher?: PlatformPublisher
    ) {}

    validate(input: PublishInput): string[] {
        // Run authentic platform validation rules so the user gets genuine validity feedback. Only the account
        // identity of sandbox accounts is adapted (a sandbox LinkedIn account has no real author URN).
        if (this.realPublisher) {
            return this.realPublisher.validate(sandboxAccountShape(this.platform, input));
        }
        return [];
    }

    async publish(input: PublishInput, _accessToken: string): Promise<PublishOutcome> {
        if (!isSimulationMode()) {
            // Defence in depth: a stale reference must never fake a publish once the sandbox is off (or in production).
            throw new PublishError('PUBLISH_NOT_CONFIGURED', 'Simulated publishing is disabled on this server.', { platform: this.platform });
        }
        const issues = this.validate(input);
        if (issues.length) throw new PublishError('VALIDATION_FAILED', issues.join(' '), { platform: this.platform, details: { issues, simulated: true } });
        // Simulate realistic network round-trip latency
        const delay = 350 + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, delay));

        const simId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const handle = input.account.username || 'creator';

        let permalink: string;
        switch (this.platform) {
            case 'instagram':
                permalink = `https://www.instagram.com/p/C_${simId}/`;
                break;
            case 'threads':
                permalink = `https://www.threads.net/@${handle}/post/${simId}`;
                break;
            case 'facebook':
                permalink = `https://www.facebook.com/permalink.php?story_fbid=${simId}`;
                break;
            case 'youtube':
                permalink = `https://youtu.be/sim_${simId}`;
                break;
            case 'linkedin':
                permalink = `https://www.linkedin.com/feed/update/urn:li:share:${simId}`;
                break;
            case 'x':
                permalink = `https://x.com/${handle}/status/${simId}`;
                break;
            default:
                permalink = `https://${this.platform}.com/post/${simId}`;
        }

        return {
            externalId: `sim_${this.platform}_${simId}`,
            url: permalink,
            state: 'published',
            warning: 'Simulated publish (sandbox mode): nothing was posted to the platform.',
            meta: {
                simulated: true,
                label: 'SIMULATED',
                platform: this.platform,
                accountName: input.account.accountName,
                format: input.format,
                mediaCount: input.media.length,
                simulatedAt: new Date().toISOString(),
            },
        };
    }
}

/** Sandbox accounts carry placeholder ids; give them the identity shape the real validator expects. */
function sandboxAccountShape(platform: PublishPlatform, input: PublishInput): PublishInput {
    const id = input.account.platformAccountId || '';
    const sandboxId = /^(sim_|sandbox_|mock_)/.test(id) || input.account.metadata?.simulated === true;
    if (platform === 'linkedin' && sandboxId && !/^urn:li:(person|organization):/.test(id)) {
        return { ...input, account: { ...input.account, platformAccountId: `urn:li:person:${id}` } };
    }
    return input;
}
