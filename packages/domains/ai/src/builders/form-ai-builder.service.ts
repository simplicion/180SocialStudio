// @ts-nocheck
import { prisma } from '@workspace/db';
import crypto from 'crypto';
import { aiProviderService } from '../kernel/ai-provider.service';
import { AICompanyConfigService } from '../kernel/ai-company-config.service';
import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';

export interface FormASTField {
    id?: string;
    label: string;
    name?: string;
    type: 'TEXT' | 'TEXTAREA' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'DATE' | 'SELECT' | 'RADIO' | 'CHECKBOX' | 'RATING' | 'FILE_UPLOAD' | 'HEADING' | 'DIVIDER' | 'PARAGRAPH';
    required: boolean;
    placeholder?: string;
    description?: string;
    options?: any;
    order: number;
    mapping?: string;
    pageId?: string;
    validation?: any;
}

export class FormAIBuilderService implements IUniversalBuilder {
    readonly builderType = 'form';

    private generate10CharId(): string {
        return Math.random().toString(36).substring(2, 12);
    }

    private generateApiKey(): string {
        return `fkey_${crypto.randomBytes(16).toString('hex')}`;
    }

    private isGreetingOrChitchat(text: string): boolean {
        const clean = text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
        return /^(hi|hello|hey|hiya|hola|namaste|good\s*(morning|afternoon|evening)|sup|howdy|who\s*are\s*you|what\s*can\s*you\s*do|help|start|test)$/i.test(clean);
    }

    private extractJSON(rawText: string): any {
        try {
            // Remove markdown code fences if present
            let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            }
            return JSON.parse(cleaned);
        } catch {
            return null;
        }
    }

    async compileAST(params: BuilderGenerationParams): Promise<BuilderResult> {
        const { prompt, companyId, userId } = params;
        const textPrompt = (prompt || '').trim();

        let effectiveCompanyId = companyId;
        if (!effectiveCompanyId) {
            const firstCompany = await prisma.company.findFirst().catch(() => null);
            effectiveCompanyId = firstCompany?.id;
        }

        const { settings, companyName } = await AICompanyConfigService.getCompanyAISettings(effectiveCompanyId);
        const lowerPrompt = textPrompt.toLowerCase();

        let formTitle = '';
        let formDescription = '';
        let primaryColor = '#4f46e5';
        let submitButtonText = 'Submit Form';
        let fields: FormASTField[] = [];
        let pages: Array<{ id: string; title: string; description?: string; order: number }> = [
            { id: 'page_1', title: 'Page 1', description: '', order: 0 }
        ];

        // 1. Try Live LLM Generation if AI Provider is active
        let llmGenerated = false;
        try {
            const client = await aiProviderService.getClient(settings);
            if (client) {
                const systemPrompt = `You are the 180 Workspace AI Form Architect.
Create a comprehensive, production-ready form schema based on the user's prompt for company: "${companyName}".

User Prompt: "${textPrompt}"

Multi-step / Multi-page Instructions:
If the user requests a multi-page, multi-step, multi-stage form, or if the form logically divides into clear distinct phases (e.g. 1. Contact & Identity, 2. Experience / Details, 3. Documents & Confirmation), create multiple page objects in the "pages" array and assign each question to its appropriate "pageId". If it is a simple single-page form, provide 1 page with id "page_1".

Return ONLY a raw JSON object with this exact structure:
{
  "title": "Clean Form Title",
  "description": "Short explanation of the form purpose",
  "primaryColor": "#hexColor",
  "submitButtonText": "Button CTA Text",
  "pages": [
    {
      "id": "page_1",
      "title": "Step 1: Basic Information",
      "description": "Enter your contact details"
    },
    {
      "id": "page_2",
      "title": "Step 2: Role Qualifications",
      "description": "Provide professional background"
    }
  ],
  "fields": [
    {
      "label": "Question Label",
      "type": "TEXT" | "TEXTAREA" | "EMAIL" | "PHONE" | "NUMBER" | "DATE" | "SELECT" | "RADIO" | "CHECKBOX" | "RATING" | "FILE_UPLOAD" | "HEADING" | "DIVIDER",
      "required": boolean,
      "placeholder": "placeholder example",
      "description": "optional field description",
      "options": ["Option 1", "Option 2"], // only for SELECT, RADIO, CHECKBOX
      "pageId": "page_1"
    }
  ]
}`;
                const response = await client.generate(systemPrompt);
                const parsed = this.extractJSON(response);
                if (parsed && Array.isArray(parsed.fields) && parsed.fields.length > 0) {
                    formTitle = parsed.title || `${companyName} Intake Form`;
                    formDescription = parsed.description || 'Please complete the form below.';
                    primaryColor = parsed.primaryColor || '#4f46e5';
                    submitButtonText = parsed.submitButtonText || 'Submit Form';

                    if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
                        pages = parsed.pages.map((p: any, pIdx: number) => ({
                            id: p.id || `page_${pIdx + 1}`,
                            title: p.title || `Page ${pIdx + 1}`,
                            description: p.description || '',
                            order: typeof p.order === 'number' ? p.order : pIdx
                        }));
                    } else {
                        pages = [{ id: 'page_1', title: 'Page 1', description: '', order: 0 }];
                    }

                    const validPageIds = new Set(pages.map(p => p.id));
                    const defaultPageId = pages[0]?.id || 'page_1';

                    fields = parsed.fields.map((f: any, idx: number) => {
                        const targetPageId = f.pageId && validPageIds.has(f.pageId) ? f.pageId : defaultPageId;
                        return {
                            label: f.label || `Question ${idx + 1}`,
                            type: f.type || 'TEXT',
                            required: !!f.required,
                            placeholder: f.placeholder || undefined,
                            description: f.description || undefined,
                            options: Array.isArray(f.options) ? f.options : undefined,
                            order: idx,
                            pageId: targetPageId,
                            mapping: (f.label || `field_${idx + 1}`).toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30)
                        };
                    });
                    llmGenerated = true;
                }
            }
        } catch (err) {
            console.warn('[FormAIBuilder] Live LLM generation fallback triggered:', err);
        }

        // 2. Intelligent NLP Heuristic Fallback Engine
        if (!llmGenerated) {
            const isMultiPage = /multi[- ]?(page|step)|steps|pages/i.test(lowerPrompt);

            if (lowerPrompt.includes('job') || lowerPrompt.includes('career') || lowerPrompt.includes('hire') || lowerPrompt.includes('candidate') || lowerPrompt.includes('resume') || lowerPrompt.includes('applicant')) {
                formTitle = `${companyName || 'Apex'} Job Application & Candidate Intake`;
                formDescription = 'Submit your application, work experience, and portfolio for open positions.';
                primaryColor = '#059669';
                submitButtonText = 'Submit Application';

                if (isMultiPage) {
                    pages = [
                        { id: 'page_1', title: 'Step 1: Contact Information', description: 'Your personal and contact details', order: 0 },
                        { id: 'page_2', title: 'Step 2: Experience & Portfolio', description: 'Your career background and role fit', order: 1 },
                        { id: 'page_3', title: 'Step 3: Resume & Motivation', description: 'Upload CV and cover note', order: 2 }
                    ];
                    fields = [
                        { label: 'Full Legal Name', type: 'TEXT', required: true, placeholder: 'e.g. Eleanor Vance', order: 0, pageId: 'page_1' },
                        { label: 'Email Address', type: 'EMAIL', required: true, placeholder: 'eleanor@example.com', order: 1, pageId: 'page_1' },
                        { label: 'Contact Phone Number', type: 'PHONE', required: true, placeholder: '+1 (555) 234-5678', order: 2, pageId: 'page_1' },
                        { label: 'Role Applying For', type: 'SELECT', required: true, options: ['Senior Frontend Engineer', 'Full Stack Developer', 'Product Designer', 'Technical Product Manager', 'DevOps Specialist'], order: 3, pageId: 'page_2' },
                        { label: 'Years of Relevant Experience', type: 'NUMBER', required: true, placeholder: 'e.g. 5', order: 4, pageId: 'page_2' },
                        { label: 'LinkedIn / GitHub / Portfolio Link', type: 'TEXT', required: false, placeholder: 'https://linkedin.com/in/username', order: 5, pageId: 'page_2' },
                        { label: 'Upload Resume & Cover Letter', type: 'FILE_UPLOAD', required: true, description: 'PDF or DOCX format (Max 10MB)', order: 6, pageId: 'page_3' },
                        { label: 'Why are you excited to join our team?', type: 'TEXTAREA', required: false, placeholder: 'Share what drives you and highlights of your past achievements...', order: 7, pageId: 'page_3' }
                    ];
                } else {
                    fields = [
                        { label: 'Full Legal Name', type: 'TEXT', required: true, placeholder: 'e.g. Eleanor Vance', order: 0, pageId: 'page_1' },
                        { label: 'Email Address', type: 'EMAIL', required: true, placeholder: 'eleanor@example.com', order: 1, pageId: 'page_1' },
                        { label: 'Contact Phone Number', type: 'PHONE', required: true, placeholder: '+1 (555) 234-5678', order: 2, pageId: 'page_1' },
                        { label: 'Role Applying For', type: 'SELECT', required: true, options: ['Senior Frontend Engineer', 'Full Stack Developer', 'Product Designer', 'Technical Product Manager', 'DevOps Specialist'], order: 3, pageId: 'page_1' },
                        { label: 'Years of Relevant Experience', type: 'NUMBER', required: true, placeholder: 'e.g. 5', order: 4, pageId: 'page_1' },
                        { label: 'LinkedIn / GitHub / Portfolio Link', type: 'TEXT', required: false, placeholder: 'https://linkedin.com/in/username', order: 5, pageId: 'page_1' },
                        { label: 'Upload Resume & Cover Letter', type: 'FILE_UPLOAD', required: true, description: 'PDF or DOCX format (Max 10MB)', order: 6, pageId: 'page_1' },
                        { label: 'Why are you excited to join our team?', type: 'TEXTAREA', required: false, placeholder: 'Share what drives you and highlights of your past achievements...', order: 7, pageId: 'page_1' }
                    ];
                }
            } else if (lowerPrompt.includes('diwali') || lowerPrompt.includes('festival') || lowerPrompt.includes('contest') || lowerPrompt.includes('offer') || lowerPrompt.includes('holiday')) {
                formTitle = `${companyName || 'Apex'} Festive Diwali Special Contest & Lead Pass`;
                formDescription = 'Register for exclusive festival giveaways, 40% discount vouchers, and VIP campaign consultation.';
                primaryColor = '#ea580c';
                submitButtonText = 'Claim Festive Voucher';
                fields = [
                    { label: 'Full Name', type: 'TEXT', required: true, placeholder: 'Enter your name', order: 0, pageId: 'page_1' },
                    { label: 'WhatsApp / Mobile Number', type: 'PHONE', required: true, placeholder: '+91 98765 43210', order: 1, pageId: 'page_1' },
                    { label: 'Business Email', type: 'EMAIL', required: true, placeholder: 'name@business.com', order: 2, pageId: 'page_1' },
                    { label: 'Business / Company Name', type: 'TEXT', required: true, placeholder: 'e.g. Sharma Enterprises', order: 3, pageId: 'page_1' },
                    { label: 'Interested Campaign Tier', type: 'RADIO', required: true, options: ['Diwali Spark Starter (₹24,999)', 'Festive Booster (₹59,999)', 'Grand Dominance (₹1,29,999)'], order: 4, pageId: 'page_1' },
                    { label: 'Expected Monthly Ad Budget', type: 'SELECT', required: true, options: ['₹50k - ₹1.5 Lakhs', '₹1.5 Lakhs - ₹5 Lakhs', '₹5 Lakhs+'], order: 5, pageId: 'page_1' },
                    { label: 'How did you hear about our Diwali promotion?', type: 'SELECT', required: false, options: ['Instagram / Facebook Ads', 'Google Search', 'LinkedIn', 'Referral / Colleague'], order: 6, pageId: 'page_1' }
                ];
            } else if (lowerPrompt.includes('feedback') || lowerPrompt.includes('nps') || lowerPrompt.includes('satisfaction') || lowerPrompt.includes('survey')) {
                formTitle = `${companyName || 'Apex'} Customer Satisfaction & NPS Survey`;
                formDescription = 'Help us improve our platform and services. Your transparent feedback guides our roadmap.';
                primaryColor = '#7c3aed';
                submitButtonText = 'Send Feedback';
                fields = [
                    { label: 'Your Name (Optional)', type: 'TEXT', required: false, placeholder: 'Optional', order: 0, pageId: 'page_1' },
                    { label: 'Email Address', type: 'EMAIL', required: true, placeholder: 'your@email.com', order: 1, pageId: 'page_1' },
                    { label: 'How satisfied are you with our platform overall?', type: 'RATING', required: true, description: '1 = Very Dissatisfied, 5 = Extremely Satisfied', order: 2, pageId: 'page_1' },
                    { label: 'How likely are you to recommend us to a colleague or peer?', type: 'RATING', required: true, description: 'Net Promoter Score Scale', order: 3, pageId: 'page_1' },
                    { label: 'Which feature do you find most valuable?', type: 'SELECT', required: true, options: ['AI Autonomous Copilot', 'AST Document Synthesizer', 'CRM & Pipeline Engine', 'Real-time Financial Radar', 'Forms & Ingestion Hub'], order: 4, pageId: 'page_1' },
                    { label: 'What is one area or feature we can improve for you?', type: 'TEXTAREA', required: false, placeholder: 'Tell us how we can make your daily work easier...', order: 5, pageId: 'page_1' }
                ];
            } else if (lowerPrompt.includes('support') || lowerPrompt.includes('ticket') || lowerPrompt.includes('help') || lowerPrompt.includes('issue') || lowerPrompt.includes('bug')) {
                formTitle = `${companyName || 'Apex'} Customer Support & Ticket Portal`;
                formDescription = 'Submit a support ticket and our engineering team will respond within 2 hours.';
                primaryColor = '#2563eb';
                submitButtonText = 'Submit Support Ticket';
                fields = [
                    { label: 'Your Full Name', type: 'TEXT', required: true, placeholder: 'e.g. David Miller', order: 0, pageId: 'page_1' },
                    { label: 'Work Email Address', type: 'EMAIL', required: true, placeholder: 'david@company.com', order: 1, pageId: 'page_1' },
                    { label: 'Issue Category', type: 'SELECT', required: true, options: ['Billing & Invoicing', 'AI Copilot / Generation Issue', 'CRM Integration', 'Account Access & Security', 'Bug Report / Other'], order: 2, pageId: 'page_1' },
                    { label: 'Urgency / Severity Level', type: 'RADIO', required: true, options: ['Low - General Inquiry', 'Medium - Feature Impaired', 'High - Critical Blocker'], order: 3, pageId: 'page_1' },
                    { label: 'Detailed Issue Description', type: 'TEXTAREA', required: true, placeholder: 'Describe the steps to reproduce the issue...', order: 4, pageId: 'page_1' },
                    { label: 'Attach Screenshots or Logs', type: 'FILE_UPLOAD', required: false, description: 'Images or error log files', order: 5, pageId: 'page_1' }
                ];
            } else if (lowerPrompt.includes('onboard') || lowerPrompt.includes('client') || lowerPrompt.includes('intake')) {
                formTitle = `${companyName || 'Apex'} Client Onboarding & Project Intake`;
                formDescription = 'Welcome! Please share your project scope, brand assets, and team contacts to begin delivery.';
                primaryColor = '#4f46e5';
                submitButtonText = 'Start Onboarding';

                if (isMultiPage) {
                    pages = [
                        { id: 'page_1', title: 'Step 1: Company Profile', description: 'Tell us about your organization', order: 0 },
                        { id: 'page_2', title: 'Step 2: Project Scope & Deliverables', description: 'Key goals, timelines, and requirements', order: 1 },
                        { id: 'page_3', title: 'Step 3: Brand Assets & Materials', description: 'Upload guidelines and assets', order: 2 }
                    ];
                    fields = [
                        { label: 'Primary Contact Name', type: 'TEXT', required: true, placeholder: 'e.g. Alex Morgan', order: 0, pageId: 'page_1' },
                        { label: 'Company Work Email', type: 'EMAIL', required: true, placeholder: 'alex@company.com', order: 1, pageId: 'page_1' },
                        { label: 'Company / Organization Name', type: 'TEXT', required: true, placeholder: 'Acme Global Inc.', order: 2, pageId: 'page_1' },
                        { label: 'Project Objective & Deliverables', type: 'TEXTAREA', required: true, placeholder: 'Describe key milestones and goals...', order: 3, pageId: 'page_2' },
                        { label: 'Target Launch Date', type: 'DATE', required: true, order: 4, pageId: 'page_2' },
                        { label: 'Upload Brand Guidelines & Assets', type: 'FILE_UPLOAD', required: false, description: 'Logos, Figma links, or brand book', order: 5, pageId: 'page_3' }
                    ];
                } else {
                    fields = [
                        { label: 'Primary Contact Name', type: 'TEXT', required: true, placeholder: 'e.g. Alex Morgan', order: 0, pageId: 'page_1' },
                        { label: 'Company Work Email', type: 'EMAIL', required: true, placeholder: 'alex@company.com', order: 1, pageId: 'page_1' },
                        { label: 'Company / Organization Name', type: 'TEXT', required: true, placeholder: 'Acme Global Inc.', order: 2, pageId: 'page_1' },
                        { label: 'Project Objective & Deliverables', type: 'TEXTAREA', required: true, placeholder: 'Describe key milestones and goals...', order: 3, pageId: 'page_1' },
                        { label: 'Target Launch Date', type: 'DATE', required: true, order: 4, pageId: 'page_1' },
                        { label: 'Upload Brand Guidelines & Assets', type: 'FILE_UPLOAD', required: false, description: 'Logos, Figma links, or brand book', order: 5, pageId: 'page_1' }
                    ];
                }
            } else {
                formTitle = `${companyName || 'Apex'} Lead Intake & Project Discovery`;
                formDescription = 'Collect client requirements, budget range, and timeline expectations for immediate sales follow-up.';
                primaryColor = '#4f46e5';
                submitButtonText = 'Submit Project Details';

                if (isMultiPage) {
                    pages = [
                        { id: 'page_1', title: 'Step 1: Contact Details', description: 'Who can we get in touch with?', order: 0 },
                        { id: 'page_2', title: 'Step 2: Project Specifications', description: 'Budget and timeline expectations', order: 1 }
                    ];
                    fields = [
                        { label: 'Full Name', type: 'TEXT', required: true, placeholder: 'e.g. Jordan Smith', order: 0, pageId: 'page_1' },
                        { label: 'Work Email Address', type: 'EMAIL', required: true, placeholder: 'jordan@enterprise.com', order: 1, pageId: 'page_1' },
                        { label: 'Phone Number', type: 'PHONE', required: true, placeholder: '+1 (555) 432-1098', order: 2, pageId: 'page_1' },
                        { label: 'Company / Organization Name', type: 'TEXT', required: true, placeholder: 'Acme Corp', order: 3, pageId: 'page_1' },
                        { label: 'Estimated Project Budget', type: 'SELECT', required: true, options: ['$5,000 - $15,000', '$15,000 - $50,000', '$50,000 - $100,000', '$100,000+'], order: 4, pageId: 'page_2' },
                        { label: 'Target Launch Timeline', type: 'SELECT', required: true, options: ['Immediately (< 2 weeks)', 'Within 1 Month', '1 - 3 Months', 'Exploring Options'], order: 5, pageId: 'page_2' },
                        { label: 'Project Scope & Requirements', type: 'TEXTAREA', required: true, placeholder: 'Briefly summarize your project goals, key features, and deliverables...', order: 6, pageId: 'page_2' }
                    ];
                } else {
                    fields = [
                        { label: 'Full Name', type: 'TEXT', required: true, placeholder: 'e.g. Jordan Smith', order: 0, pageId: 'page_1' },
                        { label: 'Work Email Address', type: 'EMAIL', required: true, placeholder: 'jordan@enterprise.com', order: 1, pageId: 'page_1' },
                        { label: 'Phone Number', type: 'PHONE', required: true, placeholder: '+1 (555) 432-1098', order: 2, pageId: 'page_1' },
                        { label: 'Company / Organization Name', type: 'TEXT', required: true, placeholder: 'Acme Corp', order: 3, pageId: 'page_1' },
                        { label: 'Estimated Project Budget', type: 'SELECT', required: true, options: ['$5,000 - $15,000', '$15,000 - $50,000', '$50,000 - $100,000', '$100,000+'], order: 4, pageId: 'page_1' },
                        { label: 'Target Launch Timeline', type: 'SELECT', required: true, options: ['Immediately (< 2 weeks)', 'Within 1 Month', '1 - 3 Months', 'Exploring Options'], order: 5, pageId: 'page_1' },
                        { label: 'Project Scope & Requirements', type: 'TEXTAREA', required: true, placeholder: 'Briefly summarize your project goals, key features, and deliverables...', order: 6, pageId: 'page_1' }
                    ];
                }
            }
        }

        const formCode = this.generate10CharId();
        const slug = formCode;
        const apiKey = this.generateApiKey();

        const formSettings = {
            buttonColor: primaryColor,
            buttonTextColor: '#ffffff',
            submitButtonText,
            backgroundType: 'default',
            backgroundColor: '#f8fafc',
            pixelEventName: 'Lead',
            successMessage: 'Thank you! Your submission has been received.',
            headerImage: '',
            footerImage: '',
            footerText: `© ${new Date().getFullYear()} ${companyName || '180 Workspace'}. All rights reserved.`,
            pages,
            salesSettings: {
                isSalesActivity: true,
                targetStage: 'Lead',
                defaultDealValue: 0,
                autoCreateActivity: true
            }
        };

        // Create in PostgreSQL database
        const form = await prisma.form.create({
            data: {
                title: formTitle,
                description: formDescription,
                slug,
                apiKey,
                formType: 'SALES_ACTIVITY',
                formCode,
                settings: formSettings as any,
                companyId: effectiveCompanyId,
                fields: {
                    create: fields.map((f, index) => ({
                        label: f.label,
                        type: f.type,
                        required: !!f.required,
                        placeholder: f.placeholder || null,
                        description: f.description || null,
                        options: f.options ? f.options : null,
                        order: index,
                        mapping: f.mapping || (f.label.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30)),
                        validation: { pageId: f.pageId || pages[0]?.id || 'page_1' }
                    }))
                }
            },
            include: {
                fields: { orderBy: { order: 'asc' } }
            }
        });

        const editUrl = `/forms/${form.id}`;
        const shareUrl = `/f/${form.formCode}`;

        const pageBreakdown = pages.length > 1
            ? `• **Multi-Step Structure**: ${pages.length} pages (${pages.map(p => p.title).join(' → ')})\n`
            : '';

        const reply = `✨ **${formTitle}** has been synthesized by Orbit AI!\n\n` +
            `• **Questions**: ${fields.length} tailored intake questions\n` +
            pageBreakdown +
            `• **Sales Pipeline**: Automatically synced to CRM Leads\n` +
            `• **Theme**: ${primaryColor} accent styling\n\n` +
            `You can review and customize your live form in the **Form Builder** below.`;

        return {
            success: true,
            builderType: this.builderType,
            entityId: form.id,
            title: formTitle,
            editUrl,
            shareUrl,
            reply,
            ast: {
                form,
                fields: form.fields.map(f => ({
                    ...f,
                    pageId: f.validation?.pageId || 'page_1'
                })),
                settings: formSettings,
                pages
            },
            actionCards: [
                { type: 'edit', label: 'Open in Form Builder →', url: editUrl },
                { type: 'preview', label: 'View Public Form', url: shareUrl }
            ]
        };
    }

    async patchAST(entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult> {
        const textInstruction = (instruction || params.prompt || '').trim();
        const lower = textInstruction.toLowerCase();

        const activeState = params.stateContext || params.existingAST;
        const form = await prisma.form.findUnique({
            where: { id: entityId },
            include: { fields: { orderBy: { order: 'asc' } } }
        }).catch(() => null);

        if (!form && !activeState) {
            return {
                success: false,
                builderType: this.builderType,
                entityId,
                title: 'Form Not Found',
                editUrl: `/forms`,
                reply: `❌ Form with ID ${entityId} could not be found.`,
                ast: null
            };
        }

        // Live Context Ground Truth: Use stateContext from active editor if provided, otherwise DB form
        let currentFields: any[] = Array.isArray(activeState?.fields)
            ? [...activeState.fields]
            : [...(form?.fields || [])];

        let updatedSettings = activeState?.settings
            ? { ...activeState.settings }
            : (typeof form?.settings === 'object' && form?.settings !== null ? { ...form.settings } : {});

        // Robust pages resolution: priority order = activeState.pages -> activeState.settings.pages -> DB settings.pages -> default
        const rawPages = (Array.isArray(activeState?.pages) && activeState.pages.length > 0)
            ? activeState.pages
            : (Array.isArray(updatedSettings.pages) && updatedSettings.pages.length > 0)
                ? updatedSettings.pages
                : (typeof form?.settings === 'object' && Array.isArray((form?.settings as any)?.pages) && (form?.settings as any).pages.length > 0)
                    ? (form?.settings as any).pages
                    : [{ id: 'page_1', title: 'Page 1', description: '', order: 0 }];

        let currentPages: Array<{ id: string; title: string; description?: string; order: number }> = rawPages.map((p: any, idx: number) => ({
            id: p.id || `page_${idx + 1}`,
            title: p.title || `Page ${idx + 1}`,
            description: p.description || '',
            order: typeof p.order === 'number' ? p.order : idx
        }));

        const activePageId = params.stateContext?.activePageId || currentPages[0]?.id || 'page_1';

        // Normalize fields with order and pageId
        currentFields = currentFields.map((f: any, idx: number) => ({
            ...f,
            order: typeof f.order === 'number' ? f.order : idx,
            pageId: f.pageId || f.validation?.pageId || currentPages[0]?.id || 'page_1'
        }));

        let currentTitle = params.stateContext?.title || form?.title || 'Active Form';
        let currentDescription = params.stateContext?.description !== undefined ? params.stateContext.description : (form?.description || '');
        const editUrl = `/forms/${entityId}`;

        // 1. Conversational Greeting & Consciousness Inquiry
        if (this.isGreetingOrChitchat(textInstruction)) {
            const pagesSummary = currentPages.map((p, pIdx) => {
                const pFields = currentFields.filter(f => (f.pageId || 'page_1') === p.id);
                const sampleQuestions = pFields.length > 0
                    ? `\n    ${pFields.map((f, i) => `• Q${i + 1}: **${f.label}** (\`${f.type}\`${f.required ? ', Required' : ''})`).join('\n    ')}`
                    : ' *(No questions on this page yet)*';
                return `  **Page ${pIdx + 1}: "${p.title}"** (\`${p.id}\`):\n${sampleQuestions}`;
            }).join('\n\n');

            return {
                success: true,
                builderType: this.builderType,
                entityId,
                title: currentTitle,
                editUrl,
                reply: `👋 Hello! I am your **180 Workspace AI Form Architect**.\n\nI have live awareness of your active form **"${currentTitle}"** with **${currentFields.length} questions** across **${currentPages.length} step(s)**:\n\n${pagesSummary}\n\n**Instruct me to continue building:**\n• *"Convert this into a multi-page form"* (or *"Make it 2 steps"*)\n• *"Add a new page for Verification & Uploads"*\n• *"Move question 3 to page 2"*\n• *"Add a 5-star experience rating question"*\n• *"Add a resume file upload question"*\n• *"Change theme color to emerald green (#059669)"*\n• *"Delete page 2"* or *"Remove phone number"*`,
                ast: {
                    form: { ...(form || {}), id: entityId, title: currentTitle, description: currentDescription },
                    fields: currentFields,
                    settings: { ...updatedSettings, pages: currentPages },
                    pages: currentPages
                },
                actionCards: [
                    { type: 'edit', label: 'View in Form Builder →', url: editUrl }
                ]
            };
        }

        let effectiveCompanyId = form?.companyId || params.companyId;
        const { settings, companyName } = await AICompanyConfigService.getCompanyAISettings(effectiveCompanyId);

        let aiHandled = false;
        let aiReply = '';
        const addedDetails: string[] = [];

        const history = Array.isArray(params.history) ? params.history : [];
        const lastAssistantMsg = [...history].reverse().find((m: any) => (m.role === 'assistant' || m.sender === 'assistant'))?.text || '';

        // 1.5 Affirmative Follow-up Intent ("yes", "sure", "do it", "go ahead", "add it", "okay")
        const isAffirmative = /^(?:yes|yeah|yep|sure|ok|okay|do it|go ahead|please do|add it|sounds good|proceed|fine|confirm|definitely|absolutely)\b/i.test(textInstruction.trim());
        if (!aiHandled && isAffirmative) {
            const lastLower = lastAssistantMsg.toLowerCase();
            if (lastLower.includes('rating') || lastLower.includes('star') || lastLower.includes('nps')) {
                currentFields.push({
                    id: crypto.randomUUID(),
                    type: 'RATING',
                    label: 'Overall Experience Rating',
                    required: false,
                    order: currentFields.length,
                    pageId: activePageId,
                    options: ['1', '2', '3', '4', '5']
                });
                aiReply = `⭐ **Rating Question Added**: Appended a 5-star experience rating question to **Step ${currentPages.findIndex(p => p.id === activePageId) + 1}**.\n\n💬 Would you like to add a **File Upload** or **Long Text Feedback** question next?`;
                aiHandled = true;
            } else if (lastLower.includes('file') || lastLower.includes('upload') || lastLower.includes('resume') || lastLower.includes('prescription')) {
                currentFields.push({
                    id: crypto.randomUUID(),
                    type: 'FILE_UPLOAD',
                    label: lastLower.includes('prescription') ? 'Upload Doctor Prescription' : 'Upload Supporting File / Resume',
                    required: false,
                    order: currentFields.length,
                    pageId: activePageId
                });
                aiReply = `📎 **File Upload Question Added**: Appended file upload field to **Step ${currentPages.findIndex(p => p.id === activePageId) + 1}**!`;
                aiHandled = true;
            } else if (lastLower.includes('phone') || lastLower.includes('contact')) {
                currentFields.push({
                    id: crypto.randomUUID(),
                    type: 'PHONE',
                    label: 'Phone Number',
                    required: true,
                    order: currentFields.length,
                    pageId: activePageId
                });
                aiReply = `📞 **Phone Field Added**: Appended phone number field to **Step ${currentPages.findIndex(p => p.id === activePageId) + 1}**!`;
                aiHandled = true;
            } else if (lastLower.includes('multi-page') || lastLower.includes('step')) {
                currentPages = [
                    { id: 'page_1', title: 'Step 1: Contact Details', description: 'Basic information', order: 0 },
                    { id: 'page_2', title: 'Step 2: Key Questions', description: 'Detailed responses', order: 1 }
                ];
                if (currentFields.length > 0) {
                    const half = Math.ceil(currentFields.length / 2);
                    currentFields = currentFields.map((f, i) => ({
                        ...f,
                        pageId: i < half ? 'page_1' : 'page_2'
                    }));
                }
                aiReply = `📑 **Converted to Multi-Page**: Split your form into 2 structured steps with balanced questions!`;
                aiHandled = true;
            } else {
                currentFields.push({
                    id: crypto.randomUUID(),
                    type: 'TEXTAREA',
                    label: 'Additional Comments & Notes',
                    required: false,
                    order: currentFields.length,
                    pageId: activePageId
                });
                aiReply = `✅ **Confirmed**: Added an open feedback text field to your active page.\n\n💬 Would you like to add an **Experience Rating**, **File Upload**, or **Phone Field** next?`;
                aiHandled = true;
            }
        }

        // 1.8 Domain-Specific Form Generation Intent (e.g. "form for medicine product", "patient intake form")
        const isMedicineForm = /medicine|medical|pharma|patient|doctor|prescription|health|clinic/i.test(textInstruction) &&
            /form|intake|survey|inquiry|consultation/i.test(textInstruction);
        if (!aiHandled && isMedicineForm) {
            currentTitle = 'Patient Medical Intake & Consultation';
            currentPages = [
                { id: 'page_1', title: 'Step 1: Patient Information', description: 'Basic contact and medical profile', order: 0 },
                { id: 'page_2', title: 'Step 2: Symptoms & Medical History', description: 'Clinical assessment details', order: 1 },
                { id: 'page_3', title: 'Step 3: Prescription & Verification', description: 'Prescription upload and consent', order: 2 }
            ];
            currentFields = [
                { id: crypto.randomUUID(), type: 'TEXT', label: 'Full Patient Name', required: true, order: 0, pageId: 'page_1' },
                { id: crypto.randomUUID(), type: 'EMAIL', label: 'Email Address', required: true, order: 1, pageId: 'page_1' },
                { id: crypto.randomUUID(), type: 'PHONE', label: 'Phone Number', required: true, order: 2, pageId: 'page_1' },
                { id: crypto.randomUUID(), type: 'DATE', label: 'Date of Birth', required: true, order: 3, pageId: 'page_1' },
                { id: crypto.randomUUID(), type: 'SELECT', label: 'Gender', required: true, order: 4, pageId: 'page_1', options: ['Male', 'Female', 'Other', 'Prefer not to say'] },
                { id: crypto.randomUUID(), type: 'TEXTAREA', label: 'Primary Symptoms & Health Goals', required: true, order: 5, pageId: 'page_2' },
                { id: crypto.randomUUID(), type: 'TEXTAREA', label: 'Current Medications & Known Allergies', required: false, order: 6, pageId: 'page_2' },
                { id: crypto.randomUUID(), type: 'SELECT', label: 'Severity of Condition', required: true, order: 7, pageId: 'page_2', options: ['Mild / Routine', 'Moderate', 'Severe / Urgent'] },
                { id: crypto.randomUUID(), type: 'FILE_UPLOAD', label: 'Upload Existing Prescription or Lab Report (Optional)', required: false, order: 8, pageId: 'page_3' },
                { id: crypto.randomUUID(), type: 'CHECKBOX', label: 'I consent to tele-health medical evaluation and confidential data processing', required: true, order: 9, pageId: 'page_3' }
            ];
            updatedSettings.buttonColor = '#059669';
            updatedSettings.submitButtonText = 'Submit Medical Inquiry';
            aiReply = `✨ **Medical & Patient Intake Form Synthesized!**\n\nI have generated a clinical-grade, multi-step intake form with **10 comprehensive questions** across **3 structured steps**:\n• **Step 1: Patient Information**: Name, Email, Phone, DOB, Gender.\n• **Step 2: Symptoms & Medical History**: Symptoms, current medications/allergies, condition severity.\n• **Step 3: Prescription & Consent**: Prescription document upload & medical consent check.\n\n---\n💬 **To help tailor this form to your exact workflow:**\n1. **Doctor / Specialist Assignment**: Should this form automatically assign submissions to a specific medical department or practitioner?\n2. **Insurance Information**: Would you like to add fields for Insurance Provider and Policy Number?\n3. **Payment / Consultation Fee**: Do you collect a tele-health consultation fee upon submission?`;
            aiHandled = true;
        }

        // 2. Clear Form / Delete All Questions Intent
        const isClearFormIntent = /(?:del(?:e)?t(?:e)?|clear|reset|erase|wipe)\s+(?:this\s+)?(?:form|all|questions?|fields?|everything)/i.test(textInstruction);
        if (isClearFormIntent) {
            currentFields = [];
            aiReply = `🗑️ **Form Cleared**: All questions in **"${currentTitle}"** have been cleared. You now have a blank form canvas ready for new fields.`;
            aiHandled = true;
        }

        // 3. Multi-Page Structural Operations (Deterministic NLP Heuristics)

        // 3.1 Convert to Multi-Page / Split into Multi-Step
        const isConvertToMultiPageIntent = /convert.*(?:multi[- ]?(?:page|step)|pages|steps)|make.*(?:multi[- ]?(?:page|step)|(\d+)\s*(?:pages|steps))|split.*(?:pages|steps)/i.test(textInstruction);
        if (!aiHandled && isConvertToMultiPageIntent) {
            let targetPageCount = 2;
            const countMatch = textInstruction.match(/(\d+)\s*(?:pages|steps)/i);
            if (countMatch) {
                targetPageCount = Math.max(2, Math.min(5, parseInt(countMatch[1], 10)));
            } else if (/three|3/i.test(textInstruction)) {
                targetPageCount = 3;
            } else if (/four|4/i.test(textInstruction)) {
                targetPageCount = 4;
            } else if (currentFields.length >= 6) {
                targetPageCount = 3;
            }

            // Create target pages if needed
            const pageThemes = [
                { title: 'Step 1: Contact & Profile', description: 'Basic information and identity' },
                { title: 'Step 2: Key Details & Preferences', description: 'Core requirements and questions' },
                { title: 'Step 3: Verification & Attachments', description: 'Supporting files and confirmation' },
                { title: 'Step 4: Additional Notes', description: 'Final comments and review' }
            ];

            const newPages: Array<{ id: string; title: string; description?: string; order: number }> = [];
            for (let pIdx = 0; pIdx < targetPageCount; pIdx++) {
                const existingPage = currentPages[pIdx];
                const theme = pageThemes[pIdx] || { title: `Step ${pIdx + 1}: Details`, description: '' };
                newPages.push({
                    id: existingPage?.id || `page_${pIdx + 1}`,
                    title: existingPage?.title && existingPage.title !== 'Page 1' ? existingPage.title : theme.title,
                    description: existingPage?.description || theme.description,
                    order: pIdx
                });
            }
            currentPages = newPages;

            // Distribute fields evenly across the new pages
            if (currentFields.length > 0) {
                const fieldsPerPage = Math.ceil(currentFields.length / targetPageCount);
                currentFields = currentFields.map((f, idx) => {
                    const assignedPageIndex = Math.min(Math.floor(idx / fieldsPerPage), targetPageCount - 1);
                    const assignedPageId = currentPages[assignedPageIndex].id;
                    return {
                        ...f,
                        order: idx,
                        pageId: assignedPageId,
                        validation: { ...(f.validation || {}), pageId: assignedPageId }
                    };
                });
            }

            const pageListDesc = currentPages.map((p) => {
                const count = currentFields.filter(f => f.pageId === p.id).length;
                return `• **${p.title}**: ${count} question(s)`;
            }).join('\n');

            aiReply = `📑 **Form Converted to Multi-Step**: Split **"${currentTitle}"** into **${currentPages.length} steps**!\n\n${pageListDesc}\n\nYour users will now experience a clean step-by-step progress bar as they complete the form.`;
            aiHandled = true;
        }

        // 3.2 Add Page Intent (e.g. "add a page", "add new page for documents", "create step 2", "add one more page")
        const isAddPageIntent = /(?:add|create|append|insert)\s+(?:a\s+|one\s+|another\s+)?(?:new\s+)?(?:page|step)/i.test(textInstruction);
        if (!aiHandled && isAddPageIntent) {
            const pageNum = currentPages.length + 1;
            let customTitle = `Step ${pageNum}: Additional Information`;

            const titleMatch = textInstruction.match(/(?:for|called|named|titled)\s+["']?([^"'\n]+?)["']?(?:\s*$|\s+page|\s+step)/i);
            if (titleMatch && titleMatch[1].trim()) {
                const rawCustom = titleMatch[1].trim();
                customTitle = `Step ${pageNum}: ${rawCustom.charAt(0).toUpperCase() + rawCustom.slice(1)}`;
            }

            const newPageId = `page_${pageNum}_${Date.now().toString(36).substring(2, 6)}`;
            const newPage = {
                id: newPageId,
                title: customTitle,
                description: '',
                order: currentPages.length
            };
            currentPages.push(newPage);

            aiReply = `📄 **New Page Added**: Created **"${customTitle}"** (\`${newPageId}\`)! Your form now has **${currentPages.length} steps**.\n\nYou can now tell me to *"move question X to page ${pageNum}"* or *"add a rating question to page ${pageNum}"*.`;
            aiHandled = true;
        }

        // 3.3 Delete Page Intent (e.g. "delete page 2", "remove step 3")
        const isDeletePageIntent = /(?:del(?:e)?t(?:e)?|remove|drop)\s+(?:the\s+)?(?:page|step)\s+(\d+|last)/i.test(textInstruction);
        if (!aiHandled && isDeletePageIntent) {
            if (currentPages.length <= 1) {
                aiReply = `⚠️ **Cannot Delete Page**: A form must have at least one active page.`;
                aiHandled = true;
            } else {
                const match = textInstruction.match(/(?:page|step)\s+(\d+|last)/i);
                let targetIdx = -1;
                if (match) {
                    if (match[1].toLowerCase() === 'last') {
                        targetIdx = currentPages.length - 1;
                    } else {
                        targetIdx = parseInt(match[1], 10) - 1;
                    }
                }

                if (targetIdx >= 0 && targetIdx < currentPages.length) {
                    const removedPage = currentPages[targetIdx];
                    currentPages.splice(targetIdx, 1);
                    currentPages = currentPages.map((p, idx) => ({ ...p, order: idx }));

                    // Preserve all questions from deleted page by safely moving them to page 1
                    const fallbackPageId = currentPages[0].id;
                    let movedCount = 0;
                    currentFields = currentFields.map(f => {
                        if (f.pageId === removedPage.id) {
                            movedCount++;
                            return { ...f, pageId: fallbackPageId, validation: { ...(f.validation || {}), pageId: fallbackPageId } };
                        }
                        return f;
                    });

                    aiReply = `🗑️ **Page Removed**: Deleted **"${removedPage.title}"**. ${movedCount > 0 ? `All ${movedCount} question(s) from that page were preserved and moved to **"${currentPages[0].title}"**.` : ''} Your form now has **${currentPages.length} steps**.`;
                    aiHandled = true;
                }
            }
        }

        // 3.4 Move Question to Page Intent (e.g. "move question 3 to page 2", "move phone to page 1", "put resume on step 2")
        const isMoveQuestionIntent = /(?:move|put|transfer|shift)\s+(?:question|field)?\s*([a-z0-9_\s-]+?)\s+(?:to|into|on)\s+(?:page|step)\s+(\d+|[a-z0-9_]+)/i.test(textInstruction);
        if (!aiHandled && isMoveQuestionIntent) {
            const moveMatch = textInstruction.match(/(?:move|put|transfer|shift)\s+(?:question|field)?\s*([a-z0-9_\s-]+?)\s+(?:to|into|on)\s+(?:page|step)\s+(\d+|[a-z0-9_]+)/i);
            if (moveMatch) {
                const qKey = moveMatch[1].trim().toLowerCase();
                const targetPageArg = moveMatch[2].trim().toLowerCase();

                let fieldIdx = -1;
                if (/^\d+$/.test(qKey)) {
                    fieldIdx = parseInt(qKey, 10) - 1;
                } else {
                    fieldIdx = currentFields.findIndex(f => (f.label || '').toLowerCase().includes(qKey) || (f.type || '').toLowerCase().includes(qKey));
                }

                let targetPage = null;
                if (/^\d+$/.test(targetPageArg)) {
                    const pageNum = parseInt(targetPageArg, 10);
                    targetPage = currentPages[pageNum - 1] || null;
                } else {
                    targetPage = currentPages.find(p => p.id === targetPageArg || p.title.toLowerCase().includes(targetPageArg));
                }

                if (fieldIdx >= 0 && fieldIdx < currentFields.length && targetPage) {
                    const field = currentFields[fieldIdx];
                    currentFields[fieldIdx] = {
                        ...field,
                        pageId: targetPage.id,
                        validation: { ...(field.validation || {}), pageId: targetPage.id }
                    };
                    aiReply = `🔄 **Question Reassigned**: Moved **"${field.label}"** to **"${targetPage.title}"** (\`${targetPage.id}\`).`;
                    aiHandled = true;
                }
            }
        }

        // 3.5 Rename Page Intent (e.g. "rename page 1 to Personal Info", "change step 2 title to Uploads")
        const isRenamePageIntent = /(?:rename|change title of)\s+(?:page|step)\s+(\d+)\s+(?:to\s+|as\s+)(["']?[^"'\n]+["']?)/i.test(textInstruction);
        if (!aiHandled && isRenamePageIntent) {
            const match = textInstruction.match(/(?:rename|change title of)\s+(?:page|step)\s+(\d+)\s+(?:to\s+|as\s+)(["']?[^"'\n]+["']?)/i);
            if (match) {
                const pageIdx = parseInt(match[1], 10) - 1;
                const newTitle = match[2].replace(/["']/g, '').trim();
                if (pageIdx >= 0 && pageIdx < currentPages.length && newTitle) {
                    currentPages[pageIdx].title = newTitle;
                    aiReply = `✏️ **Page Renamed**: Updated Step ${pageIdx + 1} title to **"${newTitle}"**.`;
                    aiHandled = true;
                }
            }
        }

        // 4. Remove Single Question Intent (e.g. "remove phone", "delete question 2", "remove rating", "delete resume upload")
        if (!aiHandled) {
            const deleteFieldMatch = textInstruction.match(/(?:del(?:e)?t(?:e)?|remove|drop|erase)\s+(?:the\s+)?([a-z0-9_\s-]+?)(?:\s+question|\s+field|$)/i);
            if (deleteFieldMatch) {
                const targetKey = deleteFieldMatch[1].trim().toLowerCase();
                let foundIndex = -1;

                if (targetKey.includes('phone') || targetKey.includes('mobile') || targetKey.includes('whatsapp')) {
                    foundIndex = currentFields.findIndex(f => f.type === 'PHONE' || (f.label || '').toLowerCase().includes('phone'));
                } else if (targetKey.includes('rating') || targetKey.includes('star') || targetKey.includes('nps')) {
                    foundIndex = currentFields.findIndex(f => f.type === 'RATING' || (f.label || '').toLowerCase().includes('rating'));
                } else if (targetKey.includes('resume') || targetKey.includes('file') || targetKey.includes('upload') || targetKey.includes('attachment')) {
                    foundIndex = currentFields.findIndex(f => f.type === 'FILE_UPLOAD' || (f.label || '').toLowerCase().includes('resume') || (f.label || '').toLowerCase().includes('file'));
                } else if (targetKey.includes('email')) {
                    foundIndex = currentFields.findIndex(f => f.type === 'EMAIL' || (f.label || '').toLowerCase().includes('email'));
                } else if (targetKey.includes('name')) {
                    foundIndex = currentFields.findIndex(f => (f.label || '').toLowerCase().includes('name'));
                } else if (/\d+/.test(targetKey)) {
                    const numMatch = targetKey.match(/\d+/);
                    if (numMatch) {
                        const idx = parseInt(numMatch[0], 10) - 1;
                        if (idx >= 0 && idx < currentFields.length) foundIndex = idx;
                    }
                }

                if (foundIndex !== -1) {
                    const removed = currentFields[foundIndex];
                    const removedLabel = removed.label || `Question ${foundIndex + 1}`;
                    currentFields.splice(foundIndex, 1);
                    // re-index orders
                    currentFields = currentFields.map((f, idx) => ({ ...f, order: idx }));
                    aiReply = `🗑️ **Question Removed**: Removed **"${removedLabel}"** from **"${currentTitle}"** while keeping your other ${currentFields.length} questions intact.`;
                    aiHandled = true;
                }
            }
        }

        // 5. Live LLM Synthesizer with Incremental Consciousness & Multi-Page Awareness
        if (!aiHandled) {
            try {
                const client = await aiProviderService.getClient(settings);
                if (client) {
                    const existingSummary = currentFields.map((f, i) => `  ${i + 1}. [${f.type}] "${f.label}" (Page: "${f.pageId || 'page_1'}", Required: ${!!f.required})`).join('\n');
                    const pagesSummary = currentPages.map((p, i) => `  ${i + 1}. [ID: "${p.id}"] "${p.title}"`).join('\n');
                    const conversationHistoryText = history.length > 0
                        ? history.slice(-6).map((m: any) => `${m.role === 'user' || m.sender === 'user' ? 'User' : 'AI Form Architect'}: "${(m.text || m.content || '').replace(/\s+/g, ' ').trim()}"`).join('\n')
                        : '  (New session)';

                    const patchPrompt = `You are the 180 Workspace AI Form Architect with live consciousness of the current form canvas.
CURRENT FORM: "${currentTitle}" (Company: "${companyName}")
BUTTON COLOR: "${updatedSettings.buttonColor || '#4f46e5'}"
SUBMIT BUTTON TEXT: "${updatedSettings.submitButtonText || 'Submit Form'}"
CURRENT PAGES (${currentPages.length}):
${pagesSummary}
CURRENT QUESTIONS (${currentFields.length}):
${existingSummary || '  (Empty form)'}

RECENT CONVERSATION HISTORY:
${conversationHistoryText}

USER INSTRUCTION: "${textInstruction}"

CRITICAL INTERACTION & CONSCIOUSNESS RULES:
1. NEVER say "instruction was unclear", "no changes needed", or refuse to update the form.
2. If user instruction is brief, vague, or underspecified:
   - PROACTIVELY TAKE INITIATIVE: Generate sensible, high-value questions immediately so the user has a functioning baseline.
   - COMMUNICATE INTERACTIVELY: In your "reply", explain what questions were added, AND ask 2-3 intelligent, interactive clarifying questions with concrete suggestions (e.g. "Would you like to collect phone numbers?", "Should this be split into multi-step?", "Do you need file attachments?").
3. If the user replies with a short affirmation like "yes", "sure", "do it", "add it", check the RECENT CONVERSATION HISTORY to see what you previously suggested, and execute that action!
4. If the user asks to add questions (e.g. rating, file upload, dropdown, phone, budget, date), return action "ADD_FIELDS" with the array of NEW fields to append. If the user specifies a page (or if only 1 page exists), assign "pageId" appropriately (default to active page "${activePageId}"). NEVER delete existing fields!
5. If the user asks to remove/delete questions or clear form, return "REMOVE_FIELD" or "CLEAR_FORM".
6. If the user asks to change theme color or button text, return "UPDATE_SETTINGS".
7. If the user asks to convert to multi-step, add/delete/rename pages, or split questions across pages, return "MANAGE_PAGES" with "updatedPages" array and optional "fieldPageAssignments" mapping field index or label to target pageId.
8. Return a valid JSON object ONLY:
{
  "action": "ADD_FIELDS" | "REMOVE_FIELD" | "CLEAR_FORM" | "UPDATE_SETTINGS" | "MANAGE_PAGES" | "CONVERSATIONAL",
  "reply": "Clear, markdown-formatted explanation of what was updated, PLUS 2-3 interactive clarifying questions to refine it",
  "title": "Optional new title if requested",
  "buttonColor": "Optional new hex color",
  "submitButtonText": "Optional new button text",
  "updatedPages": [
    { "id": "page_1", "title": "Step 1: Contact Details", "description": "" },
    { "id": "page_2", "title": "Step 2: Experience", "description": "" }
  ],
  "fieldPageAssignments": {
    "0": "page_1",
    "1": "page_2"
  },
  "newFields": [
    {
      "label": "Question label",
      "type": "TEXT" | "TEXTAREA" | "EMAIL" | "PHONE" | "NUMBER" | "DATE" | "SELECT" | "RADIO" | "CHECKBOX" | "RATING" | "FILE_UPLOAD" | "HEADING" | "DIVIDER",
      "required": boolean,
      "placeholder": "placeholder",
      "description": "description",
      "options": ["Option 1", "Option 2"],
      "pageId": "page_1"
    }
  ]
}`;
                    const rawResponse = await client.generate(patchPrompt);
                    const parsed = this.extractJSON(rawResponse);

                    if (parsed && parsed.action) {
                        if (parsed.buttonColor) updatedSettings.buttonColor = parsed.buttonColor;
                        if (parsed.submitButtonText) updatedSettings.submitButtonText = parsed.submitButtonText;
                        if (parsed.title) currentTitle = parsed.title;

                        // Handle Multi-Page management from LLM
                        if ((parsed.action === 'MANAGE_PAGES' || Array.isArray(parsed.updatedPages)) && Array.isArray(parsed.updatedPages) && parsed.updatedPages.length > 0) {
                            currentPages = parsed.updatedPages.map((p: any, idx: number) => ({
                                id: p.id || `page_${idx + 1}`,
                                title: p.title || `Step ${idx + 1}`,
                                description: p.description || '',
                                order: typeof p.order === 'number' ? p.order : idx
                            }));

                            if (parsed.fieldPageAssignments && typeof parsed.fieldPageAssignments === 'object') {
                                Object.entries(parsed.fieldPageAssignments).forEach(([key, targetPageId]) => {
                                    const idx = parseInt(key, 10);
                                    if (!isNaN(idx) && idx >= 0 && idx < currentFields.length) {
                                        currentFields[idx].pageId = targetPageId as string;
                                        currentFields[idx].validation = { ...(currentFields[idx].validation || {}), pageId: targetPageId };
                                    }
                                });
                            }
                        }

                        if (parsed.action === 'ADD_FIELDS' && Array.isArray(parsed.newFields) && parsed.newFields.length > 0) {
                            for (const f of parsed.newFields) {
                                const newIdx = currentFields.length;
                                const targetPageId = f.pageId || activePageId || currentPages[currentPages.length - 1]?.id || 'page_1';
                                currentFields.push({
                                    label: f.label || `Question ${newIdx + 1}`,
                                    type: f.type || 'TEXT',
                                    required: !!f.required,
                                    placeholder: f.placeholder || null,
                                    description: f.description || null,
                                    options: Array.isArray(f.options) ? f.options : null,
                                    order: newIdx,
                                    pageId: targetPageId,
                                    mapping: (f.label || `field_${newIdx + 1}`).toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30),
                                    validation: { pageId: targetPageId }
                                } as any);
                                addedDetails.push(`Added "${f.label}" (${f.type}) to ${currentPages.find(p => p.id === targetPageId)?.title || 'Page'}`);
                            }
                        }

                        if (parsed.reply) {
                            aiReply = parsed.reply;
                            aiHandled = true;
                        }
                    }
                }
            } catch (err) {
                console.warn('[FormAIBuilder] Live LLM patch error, falling back to NLP engine:', err);
            }
        }

        // 6. Robust NLP Heuristic Fallback Engine
        if (!aiHandled) {
            const targetAppendPageId = activePageId || currentPages[currentPages.length - 1]?.id || 'page_1';

            // A. Color Palette / Theme updates
            if (lower.includes('emerald') || lower.includes('green')) {
                updatedSettings.buttonColor = '#059669';
                addedDetails.push('Switched theme color to Emerald Green (#059669)');
            } else if (lower.includes('purple') || lower.includes('violet')) {
                updatedSettings.buttonColor = '#7c3aed';
                addedDetails.push('Switched theme color to Royal Purple (#7c3aed)');
            } else if (lower.includes('blue') || lower.includes('indigo')) {
                updatedSettings.buttonColor = '#2563eb';
                addedDetails.push('Switched theme color to Indigo Blue (#2563eb)');
            } else if (lower.includes('orange') || lower.includes('amber') || lower.includes('gold')) {
                updatedSettings.buttonColor = '#ea580c';
                addedDetails.push('Switched theme color to Warm Amber (#ea580c)');
            } else if (lower.includes('pink') || lower.includes('rose')) {
                updatedSettings.buttonColor = '#db2777';
                addedDetails.push('Switched theme color to Rose Pink (#db2777)');
            } else if (lower.includes('dark') || lower.includes('black') || lower.includes('zinc')) {
                updatedSettings.buttonColor = '#18181b';
                addedDetails.push('Switched theme color to Dark Slate (#18181b)');
            }

            // B. Add Rating / NPS field
            if (lower.includes('rating') || lower.includes('nps') || lower.includes('satisfaction') || lower.includes('star')) {
                currentFields.push({
                    label: 'How would you rate your overall experience?',
                    type: 'RATING',
                    required: true,
                    description: '1 = Poor, 5 = Exceptional',
                    order: currentFields.length,
                    mapping: 'experience_rating',
                    pageId: targetAppendPageId,
                    validation: { pageId: targetAppendPageId }
                } as any);
                addedDetails.push('Appended 5-star experience rating question');
            }

            // C. Add File Upload field
            if (lower.includes('file') || lower.includes('upload') || lower.includes('resume') || lower.includes('attachment') || lower.includes('document')) {
                currentFields.push({
                    label: 'Upload Supporting Document / Resume',
                    type: 'FILE_UPLOAD',
                    required: false,
                    description: 'PDF, PNG, JPG, or DOCX (Max 10MB)',
                    order: currentFields.length,
                    mapping: 'supporting_document',
                    pageId: targetAppendPageId,
                    validation: { pageId: targetAppendPageId }
                } as any);
                addedDetails.push('Appended document / resume file upload field');
            }

            // D. Add Phone Number field
            if (lower.includes('phone') || lower.includes('whatsapp') || lower.includes('mobile')) {
                currentFields.push({
                    label: 'Phone / WhatsApp Number',
                    type: 'PHONE',
                    required: true,
                    placeholder: '+1 (555) 000-0000',
                    order: currentFields.length,
                    mapping: 'phone_number',
                    pageId: targetAppendPageId,
                    validation: { pageId: targetAppendPageId }
                } as any);
                addedDetails.push('Appended contact phone number field');
            }

            // E. Add Dropdown / Selection Question
            if (lower.includes('dropdown') || lower.includes('select') || lower.includes('options') || lower.includes('department')) {
                currentFields.push({
                    label: 'Select Your Department / Role',
                    type: 'SELECT',
                    required: true,
                    options: ['Engineering & Product', 'Sales & Marketing', 'Operations & Support', 'Executive / Founder', 'Other'],
                    order: currentFields.length,
                    mapping: 'department_role',
                    pageId: targetAppendPageId,
                    validation: { pageId: targetAppendPageId }
                } as any);
                addedDetails.push('Appended department selection dropdown question');
            }

            // F. Add Budget Radio Buttons
            if (lower.includes('budget') || lower.includes('pricing') || lower.includes('investment')) {
                currentFields.push({
                    label: 'Estimated Project Budget',
                    type: 'RADIO',
                    required: true,
                    options: ['Under ₹25,000 ($300)', '₹25,000 – ₹75,000 ($1,000)', '₹75,000 – ₹2,00,000 ($2,500)', '₹2,00,000+ ($5,000+)'],
                    order: currentFields.length,
                    mapping: 'project_budget',
                    pageId: targetAppendPageId,
                    validation: { pageId: targetAppendPageId }
                } as any);
                addedDetails.push('Appended project budget radio options');
            }

            // G. Update Submit Button Text
            if (lower.includes('submit button') || lower.includes('button text')) {
                const match = textInstruction.match(/(?:submit button|button text)(?:\s+to\s+|\s*:\s*|\s+is\s+)(["']?[^"'\n]+["']?)/i);
                if (match) {
                    updatedSettings.submitButtonText = match[1].replace(/["']/g, '').trim();
                    addedDetails.push(`Updated button text to "${updatedSettings.submitButtonText}"`);
                }
            }

            // H. Title change
            if (lower.includes('change title') || lower.includes('rename form')) {
                const titleMatch = textInstruction.match(/(?:change title|rename form)(?:\s+to\s+|\s*:\s*)(["']?[^"'\n]+["']?)/i);
                if (titleMatch) {
                    currentTitle = titleMatch[1].replace(/["']/g, '').trim();
                    addedDetails.push(`Renamed form to "${currentTitle}"`);
                }
            }

            if (!aiReply) {
                if (addedDetails.length > 0) {
                    aiReply = `✨ **Form Updated**: ${addedDetails.join(', ')}! All other existing ${currentFields.length - addedDetails.length} questions have been preserved intact.`;
                } else {
                    currentFields.push({
                        label: 'Additional Feedback or Requirements',
                        type: 'TEXTAREA',
                        required: false,
                        description: 'Please provide any additional details',
                        order: currentFields.length,
                        mapping: 'feedback_notes',
                        pageId: targetAppendPageId,
                        validation: { pageId: targetAppendPageId }
                    } as any);
                    aiReply = `✨ **Form Enhanced**: Added an open **Feedback / Additional Details** field to your form.\n\n---\n💬 **To help customize this form further:**\n1. What is the primary purpose or industry for this form?\n2. Would you like to add an **Experience Rating (1-5 stars)** or a **Document / File Upload**?\n3. Would you prefer this as a **Multi-Step Form** with multiple pages?`;
                }
            }
        }

        // Save updated pages in form settings
        updatedSettings.pages = currentPages;

        // Delete existing fields and re-create updated list in database transaction if form exists in DB
        if (form) {
            await prisma.$transaction(async (tx) => {
                await tx.formField.deleteMany({ where: { formId: entityId } });
                if (currentFields.length > 0) {
                    await tx.formField.createMany({
                        data: currentFields.map((f, i) => {
                            const fieldPageId = f.pageId || f.validation?.pageId || currentPages[0]?.id || 'page_1';
                            return {
                                formId: entityId,
                                label: f.label || `Question ${i + 1}`,
                                type: f.type || 'TEXT',
                                required: !!f.required,
                                placeholder: f.placeholder || null,
                                description: f.description || null,
                                options: f.options || null,
                                order: i,
                                mapping: f.mapping || `field_${i + 1}`,
                                validation: { ...(f.validation || {}), pageId: fieldPageId }
                            };
                        })
                    });
                }

                await tx.form.update({
                    where: { id: entityId },
                    data: {
                        title: currentTitle,
                        description: currentDescription,
                        settings: updatedSettings as any
                    }
                });
            }, { timeout: 25000 }).catch((err) => {
                console.warn('[FormAIBuilder] DB save warning:', err.message);
            });
        }

        const updatedForm = form ? await prisma.form.findUnique({
            where: { id: entityId },
            include: { fields: { orderBy: { order: 'asc' } } }
        }).catch(() => null) : null;

        const resolvedFields = (updatedForm?.fields || currentFields).map((f: any, idx: number) => ({
            ...f,
            order: idx,
            pageId: f.pageId || f.validation?.pageId || currentPages[0]?.id || 'page_1'
        }));

        return {
            success: true,
            builderType: this.builderType,
            entityId,
            title: updatedForm?.title || currentTitle,
            editUrl,
            reply: aiReply,
            ast: {
                form: updatedForm || { id: entityId, title: currentTitle, description: currentDescription },
                fields: resolvedFields,
                settings: updatedSettings,
                pages: currentPages
            },
            actionCards: [
                { type: 'edit', label: 'View in Form Builder →', url: editUrl }
            ]
        };
    }

    async deleteEntity(entityId: string, companyId: string) {
        await prisma.form.deleteMany({ where: { id: entityId, companyId } });
        return { success: true, message: `Form ${entityId} deleted.` };
    }
}
