"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSmsConfirmationTool = exports.bookAppointmentTool = exports.scheduleMeetingTool = exports.processAgentRequestTool = exports.listAgentRequestsTool = exports.featureNavigationGuideTool = exports.createSupportTicketTool = exports.scheduleSocialPostTool = exports.createWebsiteTool = exports.searchBusinessKnowledgeTool = exports.searchKnowledgeBaseTool = exports.sendDocumentToClientTool = exports.deleteDocumentTool = exports.generateDocumentAstTool = exports.getFormSubmissionsTool = exports.deleteFormTool = exports.generateFormAstTool = exports.getPayrollAndSalarySummaryTool = exports.logExpenseTransactionTool = exports.createInvoiceTool = exports.getFinancialSummaryTool = exports.checkMyLeaveBalanceTool = exports.submitMyLeaveRequestTool = exports.manageLeaveRequestTool = exports.terminateEmployeeTool = exports.hireEmployeeTool = exports.addEmployeeTool = exports.getHrWorkforceSummaryTool = exports.createSalesOrderTool = exports.checkProductPriceTool = exports.createCrmClientTool = exports.deleteLeadTool = exports.convertLeadToClientTool = exports.assignLeadTool = exports.createLeadTool = exports.getCrmMetricsTool = exports.logMyTimesheetTool = exports.logProjectTimesheetTool = exports.createMilestoneTool = exports.deleteTaskTool = exports.deleteProjectTool = exports.updateTaskStatusTool = exports.getMyTasksTool = exports.getProjectHealthTool = exports.createProjectTool = exports.batchCreateTasksTool = exports.createTaskTool = void 0;
exports.registerAllBuiltInTools = registerAllBuiltInTools;
// @ts-nocheck
const ai_tool_registry_1 = require("./ai-tool-registry");
// Import all modular domain tools from their dedicated domain provider modules
const projects_provider_1 = require("../providers/projects.provider");
Object.defineProperty(exports, "createTaskTool", { enumerable: true, get: function () { return projects_provider_1.createTaskTool; } });
Object.defineProperty(exports, "batchCreateTasksTool", { enumerable: true, get: function () { return projects_provider_1.batchCreateTasksTool; } });
Object.defineProperty(exports, "createProjectTool", { enumerable: true, get: function () { return projects_provider_1.createProjectTool; } });
Object.defineProperty(exports, "getProjectHealthTool", { enumerable: true, get: function () { return projects_provider_1.getProjectHealthTool; } });
Object.defineProperty(exports, "getMyTasksTool", { enumerable: true, get: function () { return projects_provider_1.getMyTasksTool; } });
Object.defineProperty(exports, "updateTaskStatusTool", { enumerable: true, get: function () { return projects_provider_1.updateTaskStatusTool; } });
Object.defineProperty(exports, "deleteProjectTool", { enumerable: true, get: function () { return projects_provider_1.deleteProjectTool; } });
Object.defineProperty(exports, "deleteTaskTool", { enumerable: true, get: function () { return projects_provider_1.deleteTaskTool; } });
Object.defineProperty(exports, "createMilestoneTool", { enumerable: true, get: function () { return projects_provider_1.createMilestoneTool; } });
Object.defineProperty(exports, "logProjectTimesheetTool", { enumerable: true, get: function () { return projects_provider_1.logProjectTimesheetTool; } });
Object.defineProperty(exports, "logMyTimesheetTool", { enumerable: true, get: function () { return projects_provider_1.logMyTimesheetTool; } });
const crm_provider_1 = require("../providers/crm.provider");
Object.defineProperty(exports, "getCrmMetricsTool", { enumerable: true, get: function () { return crm_provider_1.getCrmMetricsTool; } });
Object.defineProperty(exports, "createLeadTool", { enumerable: true, get: function () { return crm_provider_1.createLeadTool; } });
Object.defineProperty(exports, "assignLeadTool", { enumerable: true, get: function () { return crm_provider_1.assignLeadTool; } });
Object.defineProperty(exports, "convertLeadToClientTool", { enumerable: true, get: function () { return crm_provider_1.convertLeadToClientTool; } });
Object.defineProperty(exports, "deleteLeadTool", { enumerable: true, get: function () { return crm_provider_1.deleteLeadTool; } });
Object.defineProperty(exports, "createCrmClientTool", { enumerable: true, get: function () { return crm_provider_1.createCrmClientTool; } });
Object.defineProperty(exports, "checkProductPriceTool", { enumerable: true, get: function () { return crm_provider_1.checkProductPriceTool; } });
Object.defineProperty(exports, "createSalesOrderTool", { enumerable: true, get: function () { return crm_provider_1.createSalesOrderTool; } });
const hrms_provider_1 = require("../providers/hrms.provider");
Object.defineProperty(exports, "getHrWorkforceSummaryTool", { enumerable: true, get: function () { return hrms_provider_1.getHrWorkforceSummaryTool; } });
Object.defineProperty(exports, "addEmployeeTool", { enumerable: true, get: function () { return hrms_provider_1.addEmployeeTool; } });
Object.defineProperty(exports, "hireEmployeeTool", { enumerable: true, get: function () { return hrms_provider_1.hireEmployeeTool; } });
Object.defineProperty(exports, "terminateEmployeeTool", { enumerable: true, get: function () { return hrms_provider_1.terminateEmployeeTool; } });
Object.defineProperty(exports, "manageLeaveRequestTool", { enumerable: true, get: function () { return hrms_provider_1.manageLeaveRequestTool; } });
Object.defineProperty(exports, "submitMyLeaveRequestTool", { enumerable: true, get: function () { return hrms_provider_1.submitMyLeaveRequestTool; } });
Object.defineProperty(exports, "checkMyLeaveBalanceTool", { enumerable: true, get: function () { return hrms_provider_1.checkMyLeaveBalanceTool; } });
const finance_provider_1 = require("../providers/finance.provider");
Object.defineProperty(exports, "getFinancialSummaryTool", { enumerable: true, get: function () { return finance_provider_1.getFinancialSummaryTool; } });
Object.defineProperty(exports, "createInvoiceTool", { enumerable: true, get: function () { return finance_provider_1.createInvoiceTool; } });
Object.defineProperty(exports, "logExpenseTransactionTool", { enumerable: true, get: function () { return finance_provider_1.logExpenseTransactionTool; } });
Object.defineProperty(exports, "getPayrollAndSalarySummaryTool", { enumerable: true, get: function () { return finance_provider_1.getPayrollAndSalarySummaryTool; } });
const forms_provider_1 = require("../providers/forms.provider");
Object.defineProperty(exports, "generateFormAstTool", { enumerable: true, get: function () { return forms_provider_1.generateFormAstTool; } });
Object.defineProperty(exports, "deleteFormTool", { enumerable: true, get: function () { return forms_provider_1.deleteFormTool; } });
Object.defineProperty(exports, "getFormSubmissionsTool", { enumerable: true, get: function () { return forms_provider_1.getFormSubmissionsTool; } });
const documents_provider_1 = require("../providers/documents.provider");
Object.defineProperty(exports, "generateDocumentAstTool", { enumerable: true, get: function () { return documents_provider_1.generateDocumentAstTool; } });
Object.defineProperty(exports, "deleteDocumentTool", { enumerable: true, get: function () { return documents_provider_1.deleteDocumentTool; } });
Object.defineProperty(exports, "sendDocumentToClientTool", { enumerable: true, get: function () { return documents_provider_1.sendDocumentToClientTool; } });
Object.defineProperty(exports, "searchKnowledgeBaseTool", { enumerable: true, get: function () { return documents_provider_1.searchKnowledgeBaseTool; } });
Object.defineProperty(exports, "searchBusinessKnowledgeTool", { enumerable: true, get: function () { return documents_provider_1.searchBusinessKnowledgeTool; } });
const websites_provider_1 = require("../providers/websites.provider");
Object.defineProperty(exports, "createWebsiteTool", { enumerable: true, get: function () { return websites_provider_1.createWebsiteTool; } });
Object.defineProperty(exports, "scheduleSocialPostTool", { enumerable: true, get: function () { return websites_provider_1.scheduleSocialPostTool; } });
Object.defineProperty(exports, "createSupportTicketTool", { enumerable: true, get: function () { return websites_provider_1.createSupportTicketTool; } });
Object.defineProperty(exports, "featureNavigationGuideTool", { enumerable: true, get: function () { return websites_provider_1.featureNavigationGuideTool; } });
const voiceforce_provider_1 = require("../providers/voiceforce.provider");
Object.defineProperty(exports, "listAgentRequestsTool", { enumerable: true, get: function () { return voiceforce_provider_1.listAgentRequestsTool; } });
Object.defineProperty(exports, "processAgentRequestTool", { enumerable: true, get: function () { return voiceforce_provider_1.processAgentRequestTool; } });
Object.defineProperty(exports, "scheduleMeetingTool", { enumerable: true, get: function () { return voiceforce_provider_1.scheduleMeetingTool; } });
Object.defineProperty(exports, "bookAppointmentTool", { enumerable: true, get: function () { return voiceforce_provider_1.bookAppointmentTool; } });
Object.defineProperty(exports, "sendSmsConfirmationTool", { enumerable: true, get: function () { return voiceforce_provider_1.sendSmsConfirmationTool; } });
/**
 * Registers all built-in tools into the singleton AI Tool Registry
 */
function registerAllBuiltInTools(targetRegistry) {
    const reg = targetRegistry || ai_tool_registry_1.aiToolRegistry || ai_tool_registry_1.AIToolRegistry.getInstance();
    if (!reg || typeof reg.registerTool !== 'function')
        return;
    // Projects & Tasks
    reg.registerTool(projects_provider_1.createTaskTool);
    reg.registerTool(projects_provider_1.batchCreateTasksTool);
    reg.registerTool(projects_provider_1.createProjectTool);
    reg.registerTool(projects_provider_1.getProjectHealthTool);
    reg.registerTool(projects_provider_1.getMyTasksTool);
    reg.registerTool(projects_provider_1.updateTaskStatusTool);
    reg.registerTool(projects_provider_1.deleteProjectTool);
    reg.registerTool(projects_provider_1.deleteTaskTool);
    reg.registerTool(projects_provider_1.createMilestoneTool);
    reg.registerTool(projects_provider_1.logProjectTimesheetTool);
    reg.registerTool(projects_provider_1.logMyTimesheetTool);
    // CRM & Sales
    reg.registerTool(crm_provider_1.getCrmMetricsTool);
    reg.registerTool(crm_provider_1.createLeadTool);
    reg.registerTool(crm_provider_1.assignLeadTool);
    reg.registerTool(crm_provider_1.convertLeadToClientTool);
    reg.registerTool(crm_provider_1.deleteLeadTool);
    reg.registerTool(crm_provider_1.createCrmClientTool);
    reg.registerTool(crm_provider_1.checkProductPriceTool);
    reg.registerTool(crm_provider_1.createSalesOrderTool);
    // HRMS
    reg.registerTool(hrms_provider_1.getHrWorkforceSummaryTool);
    reg.registerTool(hrms_provider_1.addEmployeeTool);
    reg.registerTool(hrms_provider_1.hireEmployeeTool);
    reg.registerTool(hrms_provider_1.terminateEmployeeTool);
    reg.registerTool(hrms_provider_1.manageLeaveRequestTool);
    reg.registerTool(hrms_provider_1.submitMyLeaveRequestTool);
    reg.registerTool(hrms_provider_1.checkMyLeaveBalanceTool);
    // Finance
    reg.registerTool(finance_provider_1.getFinancialSummaryTool);
    reg.registerTool(finance_provider_1.createInvoiceTool);
    reg.registerTool(finance_provider_1.logExpenseTransactionTool);
    reg.registerTool(finance_provider_1.getPayrollAndSalarySummaryTool);
    reg.registerTool({ ...finance_provider_1.getPayrollAndSalarySummaryTool, name: 'get_payroll' });
    reg.registerTool({ ...finance_provider_1.getPayrollAndSalarySummaryTool, name: 'get_payroll_and_salary_summary' });
    // Forms
    reg.registerTool(forms_provider_1.generateFormAstTool);
    reg.registerTool({ ...forms_provider_1.generateFormAstTool, name: 'create_form' });
    reg.registerTool(forms_provider_1.deleteFormTool);
    reg.registerTool(forms_provider_1.getFormSubmissionsTool);
    reg.registerTool({ ...forms_provider_1.getFormSubmissionsTool, name: 'get_form_leads' });
    reg.registerTool({ ...forms_provider_1.getFormSubmissionsTool, name: 'get_forms_analytics' });
    // Documents
    reg.registerTool(documents_provider_1.generateDocumentAstTool);
    reg.registerTool({ ...documents_provider_1.generateDocumentAstTool, name: 'create_document' });
    reg.registerTool(documents_provider_1.deleteDocumentTool);
    reg.registerTool(documents_provider_1.sendDocumentToClientTool);
    reg.registerTool({ ...documents_provider_1.sendDocumentToClientTool, name: 'send_document' });
    reg.registerTool(documents_provider_1.searchKnowledgeBaseTool);
    reg.registerTool(documents_provider_1.searchBusinessKnowledgeTool);
    // Websites & Social
    reg.registerTool(websites_provider_1.createWebsiteTool);
    reg.registerTool({ ...websites_provider_1.createWebsiteTool, name: 'generate_website_layout' });
    reg.registerTool(websites_provider_1.scheduleSocialPostTool);
    reg.registerTool(websites_provider_1.createSupportTicketTool);
    reg.registerTool(websites_provider_1.featureNavigationGuideTool);
    // Voiceforce & Calendar
    reg.registerTool(voiceforce_provider_1.listAgentRequestsTool);
    reg.registerTool({ ...voiceforce_provider_1.listAgentRequestsTool, name: 'get_agent_requests' });
    reg.registerTool({ ...voiceforce_provider_1.listAgentRequestsTool, name: 'view_agent_queue' });
    reg.registerTool(voiceforce_provider_1.processAgentRequestTool);
    reg.registerTool({ ...voiceforce_provider_1.processAgentRequestTool, name: 'approve_agent_request' });
    reg.registerTool(voiceforce_provider_1.scheduleMeetingTool);
    reg.registerTool(voiceforce_provider_1.bookAppointmentTool);
    reg.registerTool(voiceforce_provider_1.sendSmsConfirmationTool);
}
// Automatically register upon module import
registerAllBuiltInTools();
