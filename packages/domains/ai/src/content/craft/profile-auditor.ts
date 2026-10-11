
export interface ProfileInput {
  handle: string;
  nameField: string;
  bio: string;
  linkUrl?: string;
  linkCount?: number;
  hasProfilePhoto?: boolean;
  photoIsFaceCloseUp?: boolean;
  pinnedPostCount?: number;
  pinnedPostRoles?: string[]; // e.g. ['proof', 'offer', 'introduction']
  highlights?: string[]; // e.g. ['Results', 'Pricing', 'How It Works', 'About']
  gridCoverHasText?: boolean;
  /** Creator/business account. Leave undefined when unknown so it is not scored. */
  isProfessionalAccount?: boolean;
}

export interface RubricItemAudit {
  id: string;
  name: string;
  maxPoints: number;
  awardedPoints: number;
  status: 'FULL' | 'PARTIAL' | 'FAIL';
  feedback: string;
  priorityOrder: number;
}

export interface ProfileAuditReport {
  handle: string;
  totalScore: number; // 0 - 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'NEEDS_REWRITE';
  items: RubricItemAudit[];
  prioritizedActionPlan: string[];
}

export class ProfileAuditor {
  public static audit(input: ProfileInput): ProfileAuditReport {
    const items: RubricItemAudit[] = [];

    // 1. Name Field (12 pts) - 30 chars limit, indexed for search
    const nameField = (input.nameField || '').trim();
    let namePts = 0;
    let nameFeedback = '';
    const hasSearchKeyword = /[|•\-/:]\s*[A-Za-z0-9]+/i.test(nameField) || nameField.length > 15;

    if (nameField.length > 0 && nameField.length <= 30 && hasSearchKeyword) {
      namePts = 12;
      nameFeedback = 'Name field includes name + searchable keyword within the 30-character limit.';
    } else if (nameField.length > 0 && !hasSearchKeyword) {
      namePts = 4;
      nameFeedback = 'Name field only has the name without search keywords (e.g. "Name | Specialty"). Wasted search indexing.';
    } else if (nameField.length > 30) {
      namePts = 2;
      nameFeedback = 'Name field exceeds 30 characters and will be clipped by Instagram.';
    } else {
      namePts = 0;
      nameFeedback = 'Name field is empty.';
    }
    items.push({
      id: 'name_field',
      name: 'Search-Indexed Name Field',
      maxPoints: 12,
      awardedPoints: namePts,
      status: namePts === 12 ? 'FULL' : namePts > 0 ? 'PARTIAL' : 'FAIL',
      feedback: nameFeedback,
      priorityOrder: 1
    });

    // 2. Bio First Line (12 pts) - names who it is for and what changes
    const bioLines = (input.bio || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lineOne = bioLines[0] || '';
    let lineOnePts = 0;
    let lineOneFeedback = '';

    if (/^(entrepreneur|coffee lover|dog (dad|mom)|founder|creator)\b/i.test(lineOne) || lineOne.includes('|') && lineOne.length < 35) {
      lineOnePts = 3;
      lineOneFeedback = 'Line one contains generic titles or emoji-bar lists instead of outcome for the audience.';
    } else if (lineOne.length >= 20 && /\b(for|help|teaching|building|turn|how to|scale|design)\b/i.test(lineOne)) {
      lineOnePts = 12;
      lineOneFeedback = 'Line one clearly states who this is for and what transformation or outcome they get.';
    } else if (lineOne.length > 0) {
      lineOnePts = 7;
      lineOneFeedback = 'Line one is present but could more sharply target audience and transformation.';
    } else {
      lineOnePts = 0;
      lineOneFeedback = 'Bio line one is empty.';
    }
    items.push({
      id: 'bio_first_line',
      name: 'Bio Line 1 (Transformation Statement)',
      maxPoints: 12,
      awardedPoints: lineOnePts,
      status: lineOnePts === 12 ? 'FULL' : lineOnePts > 0 ? 'PARTIAL' : 'FAIL',
      feedback: lineOneFeedback,
      priorityOrder: 2
    });

    // 3. Bio Body (8 pts) - proof point or specific offer
    const bioBody = bioLines.slice(1).join(' ');
    let bioBodyPts = 0;
    let bioBodyFeedback = '';

    if (/\b(\d+|client|featured in|trusted by|results|revenue|students|projects)\b/i.test(bioBody)) {
      bioBodyPts = 8;
      bioBodyFeedback = 'Bio body provides verifiable social proof or clear offer.';
    } else if (bioBody.length > 20) {
      bioBodyPts = 4;
      bioBodyFeedback = 'Bio body is present but lacks concrete social proof or clear mechanism.';
    } else {
      bioBodyPts = 1;
      bioBodyFeedback = 'Bio body is thin or absent.';
    }
    items.push({
      id: 'bio_body',
      name: 'Bio Proof & Specificity',
      maxPoints: 8,
      awardedPoints: bioBodyPts,
      status: bioBodyPts === 8 ? 'FULL' : bioBodyPts > 0 ? 'PARTIAL' : 'FAIL',
      feedback: bioBodyFeedback,
      priorityOrder: 3
    });

    // 4. Pinned Three (10 pts) - 3 posts doing 3 different jobs
    const pinnedCount = input.pinnedPostCount ?? 0;
    let pinnedPts = 0;
    let pinnedFeedback = '';

    if (pinnedCount === 3) {
      pinnedPts = 10;
      pinnedFeedback = 'All 3 pin slots active. Ensure they cover: 1) Proof, 2) Clear Offer, 3) Origin/About.';
    } else if (pinnedCount > 0 && pinnedCount < 3) {
      pinnedPts = 5;
      pinnedFeedback = `Only ${pinnedCount} pinned post(s). Pin all 3 slots to control first impression.`;
    } else {
      pinnedPts = 0;
      pinnedFeedback = 'Zero pinned posts. The top grid is whatever was posted last by accident.';
    }
    items.push({
      id: 'pinned_three',
      name: 'Top 3 Pinned Posts',
      maxPoints: 10,
      awardedPoints: pinnedPts,
      status: pinnedPts === 10 ? 'FULL' : pinnedPts > 0 ? 'PARTIAL' : 'FAIL',
      feedback: pinnedFeedback,
      priorityOrder: 4
    });

    // 5. Link (8 pts) - one destination matching bio
    const linkCount = input.linkCount ?? (input.linkUrl ? 1 : 0);
    let linkPts = 0;
    let linkFeedback = '';

    if (linkCount === 1) {
      linkPts = 8;
      linkFeedback = 'Single focused link. Direct doors convert significantly higher than menu trees.';
    } else if (linkCount === 2) {
      linkPts = 6;
      linkFeedback = 'Two links configured. Keep primary destination prominent.';
    } else if (linkCount > 2) {
      linkPts = 3;
      linkFeedback = `${linkCount} links create choice paralysis (menu tree syndrome). Reduce to 1-2.`;
    } else {
      linkPts = 0;
      linkFeedback = 'No link configured. Profile cannot capture leads or drive traffic.';
    }
    items.push({
      id: 'link',
      name: 'Destination Link Architecture',
      maxPoints: 8,
      awardedPoints: linkPts,
      status: linkPts === 8 ? 'FULL' : linkPts > 0 ? 'PARTIAL' : 'FAIL',
      feedback: linkFeedback,
      priorityOrder: 5
    });

    // 6. Highlights (8 pts) - 4 to 6 buyer-focused highlights
    const highlights = input.highlights || [];
    let highlightPts = 0;
    let highlightFeedback = '';

    const buyerQuestions = ['results', 'pricing', 'about', 'start here', 'services', 'reviews', 'faq'];
    const matchedBuyerHits = highlights.filter(h =>
      buyerQuestions.some(bq => h.toLowerCase().includes(bq))
    ).length;

    if (highlights.length >= 4 && highlights.length <= 6 && matchedBuyerHits >= 2) {
      highlightPts = 8;
      highlightFeedback = '4-6 highlights specifically titled for customer due diligence.';
    } else if (highlights.length > 0) {
      highlightPts = 4;
      highlightFeedback = 'Highlights exist but titles should answer buyer FAQs (Pricing, Results, How it works).';
    } else {
      highlightPts = 0;
      highlightFeedback = 'No story highlights active.';
    }
    items.push({
      id: 'highlights',
      name: 'Highlights Architecture',
      maxPoints: 8,
      awardedPoints: highlightPts,
      status: highlightPts === 8 ? 'FULL' : highlightPts > 0 ? 'PARTIAL' : 'FAIL',
      feedback: highlightFeedback,
      priorityOrder: 6
    });

    // 7. Grid Legibility (8 pts)
    const gridLegible = input.gridCoverHasText ?? true;
    const gridPts = gridLegible ? 8 : 2;
    items.push({
      id: 'grid_legibility',
      name: 'Thumbnail Grid Legibility',
      maxPoints: 8,
      awardedPoints: gridPts,
      status: gridLegible ? 'FULL' : 'FAIL',
      feedback: gridLegible
        ? 'Reel covers have bold, legible text centered for 1:1 and 4:5 grid crops.'
        : 'Covers lack centered readable text; stranger arriving from 1 reel cannot skim topics.',
      priorityOrder: 7
    });

    // 8. Profile Photo (6 pts)
    const faceCloseUp = input.photoIsFaceCloseUp ?? true;
    const photoPts = input.hasProfilePhoto ? (faceCloseUp ? 6 : 3) : 0;
    items.push({
      id: 'photo',
      name: 'Profile Photo Composition',
      maxPoints: 6,
      awardedPoints: photoPts,
      status: photoPts === 6 ? 'FULL' : photoPts > 0 ? 'PARTIAL' : 'FAIL',
      feedback: photoPts === 6
        ? 'Face fills ~60% of avatar circle, clear contrast, eyes visible.'
        : 'Photo is either distant, low contrast, or impersonal logo.',
      priorityOrder: 8
    });

    // 9. Handle (6 pts)
    const handle = (input.handle || '').replace(/^@/, '');
    const cleanHandle = !/[._]{2,}|\d{3,}/.test(handle) && handle.length > 2 && handle.length < 20;
    const handlePts = cleanHandle ? 6 : 3;
    items.push({
      id: 'handle',
      name: 'Handle Memorability & Pronounceability',
      maxPoints: 6,
      awardedPoints: handlePts,
      status: cleanHandle ? 'FULL' : 'PARTIAL',
      feedback: cleanHandle
        ? 'Handle is pronounceable out loud with no consecutive symbols.'
        : 'Handle contains multiple symbols or stacked digits, reducing word-of-mouth recall.',
      priorityOrder: 9
    });

    // Professional (creator/business) account: unlocks insights, contact buttons and category. Only scored when known;
    // an unknown setup is left out of the total instead of being credited.
    if (typeof input.isProfessionalAccount === 'boolean') {
      items.push({
        id: 'professional_setup',
        name: 'Professional Account & Action Setup',
        maxPoints: 22,
        awardedPoints: input.isProfessionalAccount ? 22 : 0,
        status: input.isProfessionalAccount ? 'FULL' : 'FAIL',
        feedback: input.isProfessionalAccount
          ? 'Professional account with category and contact actions.'
          : 'Switch to a professional (creator or business) account to unlock insights, category and contact buttons.',
        priorityOrder: 10
      });
    }

    const awarded = items.reduce((acc, it) => acc + it.awardedPoints, 0);
    const possible = items.reduce((acc, it) => acc + it.maxPoints, 0);
    const totalScore = possible > 0 ? Math.round((awarded / possible) * 100) : 0;

    let grade: ProfileAuditReport['grade'] = 'NEEDS_REWRITE';
    if (totalScore >= 90) grade = 'A+';
    else if (totalScore >= 80) grade = 'A';
    else if (totalScore >= 65) grade = 'B';
    else if (totalScore >= 50) grade = 'C';

    // Prioritized Action Plan
    const prioritizedActionPlan: string[] = [];
    const weakItems = items
      .filter(i => i.status !== 'FULL')
      .sort((a, b) => a.priorityOrder - b.priorityOrder);

    for (const wi of weakItems) {
      prioritizedActionPlan.push(`[Priority #${wi.priorityOrder}]: Fix ${wi.name} - ${wi.feedback}`);
    }

    return {
      handle: input.handle,
      totalScore,
      grade,
      items,
      prioritizedActionPlan
    };
  }
}
