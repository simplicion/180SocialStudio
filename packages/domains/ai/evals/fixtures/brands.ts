/**
 * Eval fixtures: 12 brands across industries, each with the topic a user would type and a FROZEN set of web
 * research results, so runs are comparable over time. The research URLs are fixture inputs (they only need to be
 * stable, the pipeline never fetches them); the grounding metric checks citations against exactly this list.
 */
import type { AutopilotBrandContext } from '../../src/content/autopilot/types';
import type { AutopilotPlatform } from '../../src/content/autopilot/schemas';
import type { WebSearchResult } from '../../src/content/autopilot/research';

export interface EvalFixture {
    id: string;
    brand: AutopilotBrandContext;
    platforms: AutopilotPlatform[];
    /** What the user typed in the calendar generator (campaign name / goals / reference). */
    campaignName: string;
    goals: string[];
    referenceInspirations?: string;
    /** Frozen research the search provider returns for every query of this fixture. */
    research: WebSearchResult[];
}

function brand(b: Omit<AutopilotBrandContext, 'promptContext' | 'defaultHashtags' | 'standardCtas' | 'forbiddenWords'> & Partial<AutopilotBrandContext>): AutopilotBrandContext {
    const ctx: AutopilotBrandContext = {
        forbiddenWords: [], defaultHashtags: [], standardCtas: [], promptContext: '', ...b,
    };
    ctx.promptContext = [
        'BRAND CONSCIOUSNESS',
        `- Brand: ${ctx.brandName}`,
        `- Industry: ${ctx.industry}`,
        `- Positioning: ${ctx.positioning}`,
        `- Tone of voice: ${ctx.tone}`,
        `- Target audience: ${ctx.audience}`,
        ctx.forbiddenWords.length ? `- Never use these words: ${ctx.forbiddenWords.join(', ')}` : '',
        ctx.standardCtas.length ? `- Preferred CTAs: ${ctx.standardCtas.join(' | ')}` : '',
        ctx.defaultHashtags.length ? `- Brand hashtags: ${ctx.defaultHashtags.join(' ')}` : '',
    ].filter(Boolean).join('\n');
    return ctx;
}

const r = (title: string, url: string, snippet: string, publishedAt = '2026-10-20'): WebSearchResult => ({ title, url, snippet, publishedAt });

export const EVAL_FIXTURES: EvalFixture[] = [
    {
        id: 'dentist',
        brand: brand({ brandName: 'Northwind Dental', industry: 'dental clinic', positioning: 'gentle dentistry for anxious adults', tone: 'warm, calm, plain-spoken', audience: 'adults who avoid the dentist out of fear', forbiddenWords: ['painless'], standardCtas: ['Book a no-pressure consult'] }),
        platforms: ['instagram', 'facebook'],
        campaignName: 'Dental anxiety month',
        goals: ['get nervous patients to book a first consult'],
        research: [
            r('Survey: 1 in 3 adults delay dental care because of anxiety', 'https://fixtures.example/dental/anxiety-survey', 'A new national survey finds a third of adults postpone checkups due to fear, with cost the second reason.'),
            r('Sedation options explained: what patients ask most', 'https://fixtures.example/dental/sedation-faq', 'Nitrous oxide, oral sedation and IV sedation compared; patients most often ask whether they will remember the visit.'),
            r('Viral thread: people share the one thing that made the dentist less scary', 'https://fixtures.example/dental/viral-thread', 'Thousands of replies cite dentists explaining each step before doing it and agreeing a stop signal.'),
        ],
    },
    {
        id: 'saas',
        brand: brand({ brandName: 'Ledgerly', industry: 'B2B SaaS accounting automation', positioning: 'month-end close in 3 days for finance teams of 5-50', tone: 'sharp, practical, no jargon', audience: 'controllers and finance managers at mid-size companies' }),
        platforms: ['linkedin', 'youtube'],
        campaignName: 'Faster month-end close',
        goals: ['book demos with controllers', 'build authority on close automation'],
        research: [
            r('Report: average month-end close still takes 6.4 days', 'https://fixtures.example/saas/close-benchmark', 'Benchmark of 900 finance teams shows little improvement since 2022; reconciliations are the biggest bottleneck.'),
            r('Controllers debate: should AI touch the general ledger?', 'https://fixtures.example/saas/ai-ledger-debate', 'A heated discussion among finance leaders on audit trails, explainability and where automation should stop.'),
            r('New lease accounting guidance update announced', 'https://fixtures.example/saas/lease-guidance', 'Standard setters announced clarifications affecting how mid-size firms document lease modifications.'),
        ],
    },
    {
        id: 'fitness',
        brand: brand({ brandName: 'Strong After 40', industry: 'online fitness coaching', positioning: 'strength training for busy people over 40', tone: 'encouraging, direct, evidence-based', audience: 'men and women over 40 who stopped exercising', standardCtas: ['DM "START" for the free plan'] }),
        platforms: ['instagram', 'youtube', 'tiktok'],
        campaignName: 'Creatine and strength over 40',
        goals: ['grow followers', 'get DMs for the free plan'],
        research: [
            r('Creatine for women over 40: what new studies show', 'https://fixtures.example/fitness/creatine-women', 'Recent trials suggest benefits for muscle and possibly cognition in midlife women; dosing debates continue.'),
            r('Reddit thread: "I started lifting at 45, here is year one"', 'https://fixtures.example/fitness/reddit-year-one', 'A highly upvoted post detailing progress, injuries avoided and the routine that stuck.'),
            r('Walking pad trend: does it count as exercise?', 'https://fixtures.example/fitness/walking-pad', 'Under-desk treadmills are booming; trainers split on whether steps replace strength work.'),
        ],
    },
    {
        id: 'restaurant',
        brand: brand({ brandName: 'Casa Brasa', industry: 'neighbourhood wood-fire restaurant', positioning: 'live-fire cooking with local produce', tone: 'warm, sensory, playful', audience: 'local foodies and families within 5 miles', defaultHashtags: ['#CasaBrasa'] }),
        platforms: ['instagram', 'facebook'],
        campaignName: 'Autumn menu launch',
        goals: ['fill weekday tables', 'promote the autumn tasting menu'],
        research: [
            r('Diners are choosing "experience" weeknights over weekend splurges', 'https://fixtures.example/food/weeknight-trend', 'Restaurant data shows Tuesday to Thursday bookings up as diners trade one big night for smaller outings.'),
            r('Behind-the-pass videos outperform plated food shots', 'https://fixtures.example/food/behind-pass', 'Creators report kitchen process clips earn more saves than finished-dish photos.'),
            r('Pumpkin fatigue? Chefs pivot to quince and chestnut', 'https://fixtures.example/food/autumn-produce', 'Seasonal menus move beyond pumpkin spice toward lesser-used autumn produce.'),
        ],
    },
    {
        id: 'realestate',
        brand: brand({ brandName: 'Harbor Homes', industry: 'residential real estate agency', positioning: 'first-time buyer specialists', tone: 'reassuring, clear, honest', audience: 'first-time home buyers aged 25-38' }),
        platforms: ['instagram', 'linkedin', 'facebook'],
        campaignName: 'First home in a high-rate market',
        goals: ['generate buyer consultation leads'],
        research: [
            r('Mortgage rates dip for third straight week', 'https://fixtures.example/re/rates-dip', 'Average 30-year fixed rates fell slightly; economists caution against waiting for big drops.'),
            r('First-time buyers share hidden costs nobody warned them about', 'https://fixtures.example/re/hidden-costs', 'Closing costs, inspections and HOA fees top the list in a widely shared community thread.'),
            r('Rent vs buy calculators are misleading, analysts say', 'https://fixtures.example/re/rent-vs-buy', 'Popular calculators ignore maintenance and opportunity cost, skewing results.'),
        ],
    },
    {
        id: 'fashion',
        brand: brand({ brandName: 'Thread & Theory', industry: 'sustainable fashion label', positioning: 'capsule wardrobes that last 10 years', tone: 'confident, minimal, witty', audience: 'women 25-40 who want fewer, better clothes', forbiddenWords: ['cheap', 'fast fashion haul'] }),
        platforms: ['instagram', 'tiktok'],
        campaignName: 'Winter capsule',
        goals: ['drive capsule collection sales'],
        research: [
            r('"Underconsumption core" keeps trending on short video', 'https://fixtures.example/fashion/underconsumption', 'Creators show rewearing the same pieces; comments praise honesty and cost-per-wear math.'),
            r('Fabric guide: why wool blends pill', 'https://fixtures.example/fashion/pilling', 'Shoppers ask how to judge quality online; fiber content and weave matter most.'),
            r('Resale platforms report record winter coat listings', 'https://fixtures.example/fashion/resale-coats', 'Pre-owned outerwear demand rises as shoppers look for quality at lower cost.'),
        ],
    },
    {
        id: 'finance',
        brand: brand({ brandName: 'Money with Maya', industry: 'personal finance creator', positioning: 'plain-English money habits for people in their 20s', tone: 'friendly, frank, a little funny', audience: 'people 21-30 living paycheck to paycheck' }),
        platforms: ['instagram', 'youtube', 'tiktok'],
        campaignName: 'Budgeting for the holidays',
        goals: ['grow the newsletter', 'increase saves and shares'],
        research: [
            r('Buy-now-pay-later use hits record ahead of holidays', 'https://fixtures.example/fin/bnpl-record', 'Young shoppers increasingly split purchases; late fees and stacking loans are rising concerns.'),
            r('"Loud budgeting" trend: saying no out loud', 'https://fixtures.example/fin/loud-budgeting', 'People openly decline expensive plans and share it online; the trend has millions of views.'),
            r('High-yield savings rates edge down', 'https://fixtures.example/fin/hysa-rates', 'Rates remain above historic averages but have slipped for the second month.'),
        ],
    },
    {
        id: 'agency',
        brand: brand({ brandName: 'Signal Studio', industry: 'performance marketing agency', positioning: 'paid social for DTC brands doing $1-10M', tone: 'confident, data-led, candid', audience: 'DTC founders and heads of growth' }),
        platforms: ['linkedin', 'instagram'],
        campaignName: 'Creative fatigue',
        goals: ['book strategy calls with DTC founders'],
        research: [
            r('Ad platforms push more automated creative testing', 'https://fixtures.example/agency/auto-creative', 'New tools generate variations automatically; marketers worry about brand control.'),
            r('Founders share CAC jumped this quarter', 'https://fixtures.example/agency/cac-jump', 'A founder community thread reports rising acquisition costs and blames creative fatigue.'),
            r('UGC rates rise as demand for creator ads grows', 'https://fixtures.example/agency/ugc-rates', 'Creator ad pricing up as brands shift budgets from studio shoots to UGC.'),
        ],
    },
    {
        id: 'edtech',
        brand: brand({ brandName: 'CodePath Kids', industry: 'coding classes for children', positioning: 'project-based coding for ages 8-14', tone: 'curious, upbeat, parent-friendly', audience: 'parents of children 8-14' }),
        platforms: ['facebook', 'instagram', 'youtube'],
        campaignName: 'Screen time vs creating',
        goals: ['sign up families for a trial class'],
        research: [
            r('Parents debate screen time limits as AI tools enter classrooms', 'https://fixtures.example/edu/screen-time', 'Survey shows parents distinguish passive scrolling from creative screen use.'),
            r('Kids build games with AI helpers: teachers react', 'https://fixtures.example/edu/ai-games', 'Teachers say AI speeds up projects but kids still need to learn debugging.'),
            r('Coding clubs see waitlists in suburbs', 'https://fixtures.example/edu/waitlists', 'After-school coding programmes report demand outstripping places.'),
        ],
    },
    {
        id: 'skincare',
        brand: brand({ brandName: 'Lumen Skin', industry: 'skincare e-commerce', positioning: 'barrier-first skincare with short ingredient lists', tone: 'calm, scientific, no hype', audience: 'adults with sensitive skin', forbiddenWords: ['miracle', 'cure', 'anti-aging'] }),
        platforms: ['instagram', 'tiktok'],
        campaignName: 'Winter skin barrier',
        goals: ['sell the barrier repair kit'],
        research: [
            r('Dermatologists warn about over-exfoliation trend', 'https://fixtures.example/skin/over-exfoliation', 'Multi-step acid routines linked to irritation; experts urge simpler routines in winter.'),
            r('"Skin cycling" searches fall as minimal routines rise', 'https://fixtures.example/skin/minimal-routines', 'Interest shifts from elaborate routines to fewer products.'),
            r('Ceramides explained: what the label numbers mean', 'https://fixtures.example/skin/ceramides', 'Consumers ask how to compare ceramide concentrations across brands.'),
        ],
    },
    {
        id: 'consultant',
        brand: brand({ brandName: 'Priya Rao Leadership', industry: 'executive leadership coaching', positioning: 'helping new managers lead former peers', tone: 'thoughtful, direct, human', audience: 'first-time managers in tech companies' }),
        platforms: ['linkedin'],
        campaignName: 'First 90 days as a manager',
        goals: ['grow LinkedIn authority', 'fill the next cohort'],
        research: [
            r('Return-to-office mandates strain new managers', 'https://fixtures.example/lead/rto', 'New managers report being caught between policy and team frustration.'),
            r('"Unbossing" trend: companies cut middle management', 'https://fixtures.example/lead/unbossing', 'Flatter structures leave remaining managers with larger teams.'),
            r('Viral post: "my old teammate is now my report"', 'https://fixtures.example/lead/peer-to-manager', 'A post with thousands of comments on the awkwardness of managing former peers.'),
        ],
    },
    {
        id: 'gym',
        brand: brand({ brandName: 'Ironside Gym', industry: 'local independent gym', positioning: 'community strength gym, no mirrors-and-ego culture', tone: 'gritty, welcoming, funny', audience: 'locals 20-50 intimidated by big-box gyms', standardCtas: ['Claim a free week'] }),
        platforms: ['instagram', 'facebook', 'tiktok'],
        campaignName: 'Gym anxiety',
        goals: ['get free-week sign-ups'],
        research: [
            r('"Gymtimidation" content trends as January approaches', 'https://fixtures.example/gym/gymtimidation', 'Creators address first-day nerves; comments full of people saying they never went back.'),
            r('Strength training overtakes cardio in new-member goals', 'https://fixtures.example/gym/strength-goals', 'Gyms report more new members asking for lifting guidance than treadmill time.'),
            r('Gym etiquette debate: filming in the gym', 'https://fixtures.example/gym/filming-debate', 'A viral argument about members filming workouts and privacy.'),
        ],
    },
];

/** quick = 3 diverse fixtures (B2C video, B2B text, local business). */
export const QUICK_SUITE = ['fitness', 'saas', 'restaurant'];
