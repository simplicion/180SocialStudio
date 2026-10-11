export interface ProfileInput {
    handle: string;
    nameField: string;
    bio: string;
    linkUrl?: string;
    linkCount?: number;
    hasProfilePhoto?: boolean;
    photoIsFaceCloseUp?: boolean;
    pinnedPostCount?: number;
    pinnedPostRoles?: string[];
    highlights?: string[];
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
    totalScore: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'NEEDS_REWRITE';
    items: RubricItemAudit[];
    prioritizedActionPlan: string[];
}
export declare class ProfileAuditor {
    static audit(input: ProfileInput): ProfileAuditReport;
}
