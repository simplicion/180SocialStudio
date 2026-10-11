export declare class AIEmailAndMeetingService {
    /**
     * Processes meeting transcripts and extracts action items & summaries
     */
    static processMeetingTranscript(params: {
        transcript: string;
        title?: string;
        companyId?: string;
    }): Promise<{
        summary: string;
        actionItems: any[];
        success?: undefined;
        processedLength?: undefined;
    } | {
        success: boolean;
        summary: string;
        processedLength: number;
        actionItems?: undefined;
    } | {
        success: boolean;
        summary: string;
        actionItems: string[];
        processedLength?: undefined;
    }>;
}
