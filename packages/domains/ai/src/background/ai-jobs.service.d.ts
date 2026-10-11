export declare class AIJobsService {
    init(intervalMs?: number): void;
    stop(): void;
    static init(intervalMs?: number): void;
    static stop(): void;
    static scanDeadlines(): Promise<void>;
}
export declare const aiJobsService: typeof AIJobsService;
export declare const AiJobsService: typeof AIJobsService;
