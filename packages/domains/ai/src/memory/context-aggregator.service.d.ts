export interface WorkspaceCompanyContext {
    companyName: string;
    todayDate: string;
    clients: {
        id: string;
        name: string;
        email: string;
        companyName?: string;
    }[];
    employees: {
        id: string;
        name: string;
        email: string;
        designation?: string;
    }[];
    activeProjectsCount: number;
    openTasksCount: number;
    recentLeads: {
        id: string;
        title: string;
        status: string;
        value?: number;
    }[];
}
export declare class ContextAggregatorService {
    /**
     * Gathers a lightning-fast snapshot of the company's operational state
     */
    static getCompanyContext(companyId?: string): Promise<WorkspaceCompanyContext>;
}
