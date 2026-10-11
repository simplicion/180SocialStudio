export declare class AIBusinessInsightsService {
    /**
     * Fully dynamic computation of business telemetry & live LLM executive synthesis.
     * ZERO hardcoding - queries real workspace tables and generates real AI summaries.
     */
    static getDashboardInsights(companyId?: string): Promise<{
        isConfigured: boolean;
        summary: string;
        metrics: {};
        error?: undefined;
        text?: undefined;
    } | {
        isConfigured: boolean;
        summary: string;
        metrics: {
            activeEmployees: any;
            activeProjects: any;
            completedProjects: any;
            pendingTasks: any;
            overdueTasks: any;
            completedTasks: any;
            leadsCount: any;
            unpaidInvoices: any;
        };
        error?: undefined;
        text?: undefined;
    } | {
        isConfigured: boolean;
        error: string;
        summary: string;
        text: string;
        metrics: {
            activeEmployees: any;
            activeProjects: any;
            completedProjects: any;
            pendingTasks: any;
            overdueTasks: any;
            completedTasks: any;
            leadsCount: any;
            unpaidInvoices: any;
        };
    }>;
}
