// Workspace Tools Domain Services
export { CalendarService } from './calendar/calendar.service';
export { DocumentService } from './documents/document.service';
export { DocumentApprovalService } from './documents/document-approval.service';
export { AIDocumentService } from './documents/ai-document.service';
export { StorageService } from './storage/storage.service';
export { AssetService } from './assets/asset.service';

// Backward compatibility re-exports for monorepo packages transitioning to @workspace/ai
export {
    AIContentCalendarService,
    aiContentCalendarService,
    AiContentService,
    aiContentService,
    AIChatService as AiAssistantService,
    aiChatService as aiAssistantService,
    AIAutomationService,
    aiAutomationService,
    AICronService,
    aiCronService,
    AiCronService,
    AIJobsService,
    aiJobsService,
    AiJobsService,
    VectorStore as VectorStoreService,
    vectorStore as vectorStoreService,
    AIProviderService as AiService,
    aiProviderService as aiService
} from '@workspace/ai';
