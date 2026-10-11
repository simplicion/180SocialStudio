export interface EntityReference {
    kind: string;
    id: string;
    title?: string;
    url?: string;
    metadata?: Record<string, any>;
}

export interface DomainIntent {
    primaryDomain: string;
    targetDomains: string[];
    actionType: 'query' | 'mutation' | 'plan' | 'guide' | 'conversation';
    confidence: number;
    entityKeywords: string[];
    rawPrompt: string;
}

export interface OrbitScopedContext {
    intent: DomainIntent;
    scopedEntities: EntityReference[];
    scopedData: Record<string, any>;
    activeUser: {
        id: string;
        name: string;
        role: string;
        permissions: string[];
    };
    workspaceSummary: {
        companyId: string;
        companyName: string;
    };
    recentContextHistory?: string;
}
