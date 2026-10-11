import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';
export interface ElementNode {
    id: string;
    type: 'section' | 'box' | 'row' | 'column' | 'text' | 'media' | 'button' | 'line' | 'floating' | 'code';
    data?: any;
    style?: any;
    /** Per-device style overrides merged over `style` (desktop = base). See docs/website-builder/AUDIT_AND_PLAN.md §2. */
    responsive?: {
        tablet?: Record<string, any>;
        mobile?: Record<string, any>;
    };
    hiddenOn?: {
        desktop?: boolean;
        tablet?: boolean;
        mobile?: boolean;
    };
    children?: ElementNode[];
    animation?: any;
    name?: string;
}
export type WebsiteBuilderErrorCode = 'AI_NOT_CONFIGURED' | 'AI_PROVIDER_ERROR' | 'AI_INVALID_OUTPUT' | 'INVALID_INPUT' | 'COMPANY_REQUIRED' | 'WEBSITE_NOT_FOUND' | 'SAVE_FAILED';
export declare class WebsiteBuilderError extends Error {
    readonly code: WebsiteBuilderErrorCode;
    readonly statusCode: number;
    constructor(code: WebsiteBuilderErrorCode, message: string);
}
export declare const WEBSITE_ELEMENT_TYPES: readonly ["section", "box", "row", "column", "text", "media", "button", "line", "code", "floating"];
export declare const WEBSITE_SANITIZE_LIMITS: {
    maxDepth: number;
    maxNodes: number;
    maxChildren: number;
    maxSections: number;
    maxTextLength: number;
    maxStyleKeys: number;
    maxStyleValueLength: number;
};
/** Removes executable markup from rich text / HTML (scripts, event handlers, javascript: URLs). */
export declare function sanitizeRichText(input: unknown, maxLength?: number): string;
/** Plain text: strips all tags. */
export declare function sanitizePlainText(input: unknown, maxLength?: number): string;
/** Absolute http(s) URL or ''. Used for media sources. */
export declare function sanitizeHttpUrl(input: unknown): string;
/** Link target: in-page anchor, site-relative path, http(s), mailto: or tel:. Anything else becomes '#'. */
export declare function sanitizeLink(input: unknown): string;
/** CSS-in-JS style object: camelCase keys, string/number values, no `;{}<>`, no script URLs or expressions. */
export declare function sanitizeStyle(input: unknown): Record<string, any>;
/**
 * Validates one untrusted node (from an LLM). Only allowed element types survive; ids are regenerated;
 * depth, node count and children are capped; text is stripped of scripts; URLs must be http(s).
 */
export declare function sanitizeElementNode(raw: unknown, depth?: number, ctx?: {
    count: number;
}): ElementNode | null;
/** Validates a list of top-level sections. Non-section top-level nodes are wrapped in a section. */
export declare function sanitizeSections(raw: unknown, ctx?: {
    count: number;
}): ElementNode[];
export declare function sanitizeBrand(raw: unknown): Record<string, string>;
/**
 * Validates a full LLM website response `{ title, brand, sections }`.
 * Throws AI_INVALID_OUTPUT when nothing renderable survives.
 */
export declare function sanitizeGeneratedWebsite(parsed: unknown): {
    title: string;
    brand: Record<string, string>;
    sections: ElementNode[];
};
export declare class WebsiteAIBuilderService implements IUniversalBuilder {
    readonly builderType = "website";
    private createBox;
    private createRow;
    private createText;
    private createMedia;
    private createButton;
    private createGrid;
    private createCard;
    private createFloating;
    /** Resolves the company's AI client or throws AI_NOT_CONFIGURED. Never falls back to another company. */
    private resolveCompanyClient;
    /** Facts about the business the model may use (company profile only; nothing invented). */
    private loadBusinessContext;
    private callModel;
    /**
     * Generates a new website with the company's LLM. The model outputs element trees (ElementNode schema),
     * which are validated/sanitized before saving. `mode: 'template'` builds a user-chosen starter template
     * instead (no model call, clearly labelled as a template).
     */
    compileAST(params: BuilderGenerationParams): Promise<BuilderResult>;
    /** Creates the Website row + subdomain registry entry, scoped to the company. */
    private persistNewWebsite;
    /**
     * Starter templates (festival / e-commerce / agency / general). User-chosen via `mode: 'template'`;
     * no model call, and the reply says the content is placeholder template copy.
     */
    private compileStarterTemplate;
    private extractSectionTitle;
    private createHeroSection;
    private createTestimonialsSection;
    private createPricingSection;
    private createFAQSection;
    private createFeaturesSection;
    private createStatsSection;
    private createTeamSection;
    private createContactSection;
    private createCtaSection;
    private isGreetingOrChitchat;
    private extractJSON;
    private createTailoredLandingPage;
    private createThankYouSections;
    /** User-chosen starter template sections (sample copy, clearly labelled as such in the reply). */
    private buildTemplateSections;
    /**
     * Conversational website editing. Exact structural commands (clear page, delete section N / by name,
     * set an explicit hex theme colour, insert a named starter template) run deterministically. Everything
     * else goes to the company's LLM, whose element output is validated before it is applied. Provider or
     * parse failures throw typed errors; they are never replaced by canned content.
     */
    patchAST(entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult>;
    deleteEntity(entityId: string, companyId: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
export default WebsiteAIBuilderService;
