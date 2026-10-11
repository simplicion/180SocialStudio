import { orbitResourceRegistry } from '../control-plane/registry/resource-registry';
import { taskResource, projectResource } from './projects.provider';
import { leadResource } from './crm.provider';
import { employeeResource } from './hrms.provider';
import { invoiceResource } from './finance.provider';
import { formResource } from './forms.provider';
import { documentResource } from './documents.provider';
import { websiteResource } from './websites.provider';
import { agentRequestResource } from './voiceforce.provider';

export * from './projects.provider';
export * from './crm.provider';
export * from './hrms.provider';
export * from './finance.provider';
export * from './forms.provider';
export * from './documents.provider';
export * from './websites.provider';
export * from './voiceforce.provider';

/**
 * Registers all core SaaS domain resources into the central Orbit Resource Registry
 */
export function registerAllDomainResources() {
    orbitResourceRegistry.registerResource(taskResource);
    orbitResourceRegistry.registerResource(projectResource);
    orbitResourceRegistry.registerResource(leadResource);
    orbitResourceRegistry.registerResource(employeeResource);
    orbitResourceRegistry.registerResource(invoiceResource);
    orbitResourceRegistry.registerResource(formResource);
    orbitResourceRegistry.registerResource(documentResource);
    orbitResourceRegistry.registerResource(websiteResource);
    orbitResourceRegistry.registerResource(agentRequestResource);
}

// Auto-register upon module load
registerAllDomainResources();
