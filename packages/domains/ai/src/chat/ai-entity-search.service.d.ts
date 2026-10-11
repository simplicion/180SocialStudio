export interface EntitySearchResult {
    id: string;
    name: string;
    subtitle: string;
}
export declare class AIEntitySearchService {
    /**
     * Searches entities (Clients, Employees, Projects) by query and type
     */
    static searchEntities(user: any, type: string, query: string): Promise<EntitySearchResult[]>;
}
