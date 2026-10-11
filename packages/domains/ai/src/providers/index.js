"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAllDomainResources = registerAllDomainResources;
const resource_registry_1 = require("../control-plane/registry/resource-registry");
const projects_provider_1 = require("./projects.provider");
const crm_provider_1 = require("./crm.provider");
const hrms_provider_1 = require("./hrms.provider");
const finance_provider_1 = require("./finance.provider");
const forms_provider_1 = require("./forms.provider");
const documents_provider_1 = require("./documents.provider");
const websites_provider_1 = require("./websites.provider");
const voiceforce_provider_1 = require("./voiceforce.provider");
__exportStar(require("./projects.provider"), exports);
__exportStar(require("./crm.provider"), exports);
__exportStar(require("./hrms.provider"), exports);
__exportStar(require("./finance.provider"), exports);
__exportStar(require("./forms.provider"), exports);
__exportStar(require("./documents.provider"), exports);
__exportStar(require("./websites.provider"), exports);
__exportStar(require("./voiceforce.provider"), exports);
/**
 * Registers all core SaaS domain resources into the central Orbit Resource Registry
 */
function registerAllDomainResources() {
    resource_registry_1.orbitResourceRegistry.registerResource(projects_provider_1.taskResource);
    resource_registry_1.orbitResourceRegistry.registerResource(projects_provider_1.projectResource);
    resource_registry_1.orbitResourceRegistry.registerResource(crm_provider_1.leadResource);
    resource_registry_1.orbitResourceRegistry.registerResource(hrms_provider_1.employeeResource);
    resource_registry_1.orbitResourceRegistry.registerResource(finance_provider_1.invoiceResource);
    resource_registry_1.orbitResourceRegistry.registerResource(forms_provider_1.formResource);
    resource_registry_1.orbitResourceRegistry.registerResource(documents_provider_1.documentResource);
    resource_registry_1.orbitResourceRegistry.registerResource(websites_provider_1.websiteResource);
    resource_registry_1.orbitResourceRegistry.registerResource(voiceforce_provider_1.agentRequestResource);
}
// Auto-register upon module load
registerAllDomainResources();
