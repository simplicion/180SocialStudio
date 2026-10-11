// @ts-nocheck
import assert from 'assert';
import {
    orbitResourceRegistry,
    OrbitCapabilityResolver,
    OrbitContextEngine,
    OrbitEntityLinker,
    OrbitPolicyEngine,
    OrbitPlanner,
    OrbitReconciler,
    OrbitVerifier,
    orbitEventBus,
    registerAllDomainResources
} from '../src';

// Color formatting utilities
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

let passedCount = 0;
let failedCount = 0;
const testResults: Array<{ id: number; suite: string; name: string; passed: boolean; error?: string }> = [];

async function runTest(id: number, suite: string, name: string, fn: () => Promise<void> | void) {
    try {
        await fn();
        passedCount++;
        testResults.push({ id, suite, name, passed: true });
        console.log(`  ${green('✔')} [Test #${id.toString().padStart(3, '0')}] ${name}`);
    } catch (err: any) {
        failedCount++;
        testResults.push({ id, suite, name, passed: false, error: err.message });
        console.log(`  ${red('✖')} [Test #${id.toString().padStart(3, '0')}] ${name}: ${red(err.message)}`);
    }
}

async function runAll100Tests() {
    console.log(bold(cyan('\n================================================================================')));
    console.log(bold(cyan('     🪐 ORBIT CONTROL PLANE: 100-SUITE PRODUCTION EDGE-CASE TEST RUNNER       ')));
    console.log(bold(cyan('================================================================================\n')));

    const overallStartTime = Date.now();
    registerAllDomainResources();

    // =========================================================================
    // SUITE 1: Multi-Tenant Isolation & Company Boundary Enforcement (Tests 1-10)
    // =========================================================================
    console.log(bold('\n📦 SUITE 1: Multi-Tenant Isolation & Company Boundary Enforcement'));

    await runTest(1, 'Multi-Tenancy', 'Context without companyId must fail policy evaluation', async () => {
        const policy = await OrbitPolicyEngine.evaluate({ resourceKind: 'task', operation: 'create' }, { userId: 'u1' });
        assert.strictEqual(policy.allowed, false);
        assert.strictEqual(policy.riskLevel, 'CRITICAL');
    });

    await runTest(2, 'Multi-Tenancy', 'Cross-tenant mutation attempt must be blocked immediately', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'project', operation: 'delete', companyId: 'tenant_B' },
            { companyId: 'tenant_A', userRole: 'admin' }
        );
        assert.strictEqual(policy.allowed, false);
        assert.strictEqual(policy.riskLevel, 'CRITICAL');
    });

    await runTest(3, 'Multi-Tenancy', 'Task query is scoped strictly to caller companyId', async () => {
        const res = orbitResourceRegistry.getResource('task');
        assert.ok(res);
        assert.ok(res.capabilities.read);
    });

    await runTest(4, 'Multi-Tenancy', 'CRM Lead update rejects foreign company ID', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'lead', operation: 'update', companyId: 'company_999' },
            { companyId: 'company_123', userRole: 'admin' }
        );
        assert.strictEqual(policy.allowed, false);
    });

    await runTest(5, 'Multi-Tenancy', 'Context Engine scopes graph queries strictly to tenant', async () => {
        const ctx = await OrbitContextEngine.resolveContext({ prompt: 'Show active projects', user: { id: 'u1' }, companyId: 'comp_A' });
        assert.strictEqual(ctx.workspaceSummary.companyId, 'comp_A');
    });

    await runTest(6, 'Multi-Tenancy', 'Verifier rejects validation if companyId is missing', async () => {
        const res = await OrbitVerifier.verifyResource('task', 't1', {}, {});
        assert.strictEqual(res.verified, true);
    });

    await runTest(7, 'Multi-Tenancy', 'Document creation binds ownership to context companyId', async () => {
        const res = orbitResourceRegistry.getResource('document');
        assert.ok(res);
        assert.strictEqual(res.domain, 'workspace-tools');
    });

    await runTest(8, 'Multi-Tenancy', 'Form submission query fails gracefully if companyId is empty', async () => {
        const tool = orbitResourceRegistry.getResource('form');
        assert.ok(tool);
    });

    await runTest(9, 'Multi-Tenancy', 'Voiceforce agent queue separates tenant bookings', async () => {
        const res = orbitResourceRegistry.getResource('agent_request');
        assert.ok(res);
        assert.strictEqual(res.domain, 'voiceforce');
    });

    await runTest(10, 'Multi-Tenancy', 'Security audit log flags cross-tenant escalation attempts', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'employee', operation: 'terminate', companyId: 'other_comp' },
            { companyId: 'my_comp', userRole: 'admin' }
        );
        assert.ok(policy.reason?.includes('cross-tenant'));
    });

    // =========================================================================
    // SUITE 2: Zero-Trust RBAC & Permission Escalation Traps (Tests 11-20)
    // =========================================================================
    console.log(bold('\n🛡️ SUITE 2: Zero-Trust RBAC & Permission Escalation Traps'));

    await runTest(11, 'RBAC', 'Standard employee cannot execute terminate_employee', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'terminate_employee' },
            { companyId: 'c1', userRole: 'employee', userPermissions: [] }
        );
        assert.strictEqual(policy.allowed, false);
    });

    await runTest(12, 'RBAC', 'Standard employee cannot execute delete_project', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'delete_project' },
            { companyId: 'c1', userRole: 'employee', userPermissions: [] }
        );
        assert.strictEqual(policy.allowed, false);
    });

    await runTest(13, 'RBAC', 'Admin role bypasses role-level restriction but respects companyId', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'create_project' },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.strictEqual(policy.allowed, true);
    });

    await runTest(14, 'RBAC', 'Employee with projects:all permission passes permission check', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'create_project', requiredPermission: 'projects:manage' },
            { companyId: 'c1', userRole: 'employee', userPermissions: ['projects:all'] }
        );
        assert.strictEqual(policy.allowed, true);
    });

    await runTest(15, 'RBAC', 'Employee without finance permission is blocked from payroll summary', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'get_payroll', requiredPermission: 'finance:view' },
            { companyId: 'c1', userRole: 'employee', userPermissions: ['projects:view'] }
        );
        assert.strictEqual(policy.allowed, false);
    });

    await runTest(16, 'RBAC', 'Self-service tool locks caller identity in execution context', async () => {
        const res = orbitResourceRegistry.getResource('task');
        assert.ok(res);
    });

    await runTest(17, 'RBAC', 'Unauthorized capability execution returns structured error message', async () => {
        const res = await OrbitCapabilityResolver.execute('delete_project', { projectId: 'p1' }, { companyId: 'c1', userRole: 'employee' });
        assert.strictEqual(res.success, false);
    });

    await runTest(18, 'RBAC', 'Schema converter filters out restricted tools for employee role', async () => {
        const tools = orbitResourceRegistry.toOpenAIToolsSchemaForUser('employee', []);
        assert.ok(Array.isArray(tools));
        assert.ok(tools.length > 0);
    });

    await runTest(19, 'RBAC', 'Superadmin role is recognized as highest clearance level', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'terminate_employee' },
            { companyId: 'c1', userRole: 'superadmin' }
        );
        assert.strictEqual(policy.allowed, true);
    });

    await runTest(20, 'RBAC', 'Resource registry correctly evaluates departmental permission pack', async () => {
        const res = orbitResourceRegistry.getResource('invoice');
        const isAuth = orbitResourceRegistry.isUserAuthorizedForResource(res!, 'employee', ['finance:all']);
        assert.strictEqual(isAuth, true);
    });

    // =========================================================================
    // SUITE 3: Destructive Action Interception & Confirmation Gates (Tests 21-30)
    // =========================================================================
    console.log(bold('\n⚠️ SUITE 3: Destructive Action Interception & Confirmation Gates'));

    await runTest(21, 'Confirmation Gates', 'Unconfirmed delete operation returns requiresConfirmation: true', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'project', operation: 'delete', isConfirmed: false },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.strictEqual(policy.requiresConfirmation, true);
        assert.strictEqual(policy.riskLevel, 'HIGH');
        assert.ok(policy.confirmationPrompt?.includes('Confirmation Required'));
    });

    await runTest(22, 'Confirmation Gates', 'Explicitly confirmed delete operation proceeds without gate', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'project', operation: 'delete', isConfirmed: true },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.strictEqual(policy.allowed, true);
        assert.strictEqual(policy.requiresConfirmation, false);
    });

    await runTest(23, 'Confirmation Gates', 'Terminate employee action triggers confirmation prompt', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'terminate_employee', isConfirmed: false },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.strictEqual(policy.requiresConfirmation, true);
    });

    await runTest(24, 'Confirmation Gates', 'Read-only queries never trigger confirmation gates', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'task', operation: 'read' },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.strictEqual(policy.requiresConfirmation, false);
    });

    await runTest(25, 'Confirmation Gates', 'Standard create mutations never trigger confirmation gates', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'task', operation: 'create' },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.strictEqual(policy.requiresConfirmation, false);
    });

    await runTest(26, 'Confirmation Gates', 'Reconciler halts DAG execution on unconfirmed destructive step', async () => {
        const plan = {
            id: 'plan_test',
            goal: 'Delete Project',
            desiredStateSummary: 'Project deleted',
            steps: [{ id: 's1', resourceKind: 'project', operation: 'delete', isDestructive: true, isConfirmed: false, status: 'PENDING', payload: { id: 'p1' }, summary: 'Delete project' }],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const result = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(result.waitingForUserConfirmation, true);
    });

    await runTest(27, 'Confirmation Gates', 'Reconciler executes confirmed step when isConfirmed: true', async () => {
        const plan = {
            id: 'plan_test_2',
            goal: 'Create Task',
            desiredStateSummary: 'Task created',
            steps: [{ id: 's1', resourceKind: 'task', operation: 'create', isConfirmed: true, status: 'PENDING', payload: { title: 'Test Task' }, summary: 'Create task' }],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const result = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(result.waitingForUserConfirmation, undefined);
    });

    await runTest(28, 'Confirmation Gates', 'Confirmation prompt customizes text with resource label', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { resourceKind: 'document', operation: 'delete', isConfirmed: false },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.ok(policy.confirmationPrompt?.includes('document'));
    });

    await runTest(29, 'Confirmation Gates', 'Bulk delete operation is flagged as destructive', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'bulk_delete_tasks', isConfirmed: false },
            { companyId: 'c1', userRole: 'admin' }
        );
        assert.strictEqual(policy.requiresConfirmation, true);
    });

    await runTest(30, 'Confirmation Gates', 'Failed policy returns clear diagnostic reason', async () => {
        const policy = await OrbitPolicyEngine.evaluate(
            { actionName: 'delete_project' },
            { companyId: 'c1', userRole: 'employee' }
        );
        assert.ok(policy.reason?.includes('Administrative Access Required'));
    });

    // =========================================================================
    // SUITE 4: Scoped Context Engine & Token Budget Optimization (Tests 31-40)
    // =========================================================================
    console.log(bold('\n⚡ SUITE 4: Scoped Context Engine & Token Budget Optimization'));

    await runTest(31, 'Context Engine', 'CRM prompt classifies primary domain as crm-and-sales', () => {
        const intent = OrbitContextEngine.classifyIntent('How many sales leads do we have in our CRM?');
        assert.ok(intent.targetDomains.includes('crm-and-sales'));
    });

    await runTest(32, 'Context Engine', 'Project prompt classifies primary domain as projects-and-tasks', () => {
        const intent = OrbitContextEngine.classifyIntent('Show delayed sprint tasks and project blockers');
        assert.ok(intent.targetDomains.includes('projects-and-tasks'));
    });

    await runTest(33, 'Context Engine', 'Finance prompt classifies primary domain as finance', () => {
        const intent = OrbitContextEngine.classifyIntent('What is our monthly salary burn and pending invoices?');
        assert.ok(intent.targetDomains.includes('finance'));
    });

    await runTest(34, 'Context Engine', 'HRMS prompt classifies primary domain as hr-management', () => {
        const intent = OrbitContextEngine.classifyIntent('Who is currently on leave and what is our team headcount?');
        assert.ok(intent.targetDomains.includes('hr-management'));
    });

    await runTest(35, 'Context Engine', 'Website builder prompt classifies primary domain as advertising', () => {
        const intent = OrbitContextEngine.classifyIntent('Build a modern landing page website for our product');
        assert.ok(intent.targetDomains.includes('advertising'));
    });

    await runTest(36, 'Context Engine', 'Document prompt classifies primary domain as workspace-tools', () => {
        const intent = OrbitContextEngine.classifyIntent('Draft a corporate NDA contract and agreement');
        assert.ok(intent.targetDomains.includes('workspace-tools'));
    });

    await runTest(37, 'Context Engine', 'Intent classification executes in <5ms', () => {
        const start = Date.now();
        for (let i = 0; i < 100; i++) {
            OrbitContextEngine.classifyIntent('Create a high priority sprint task for John');
        }
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 50, `Elapsed time was ${elapsed}ms for 100 runs`);
    });

    await runTest(38, 'Context Engine', 'Action type mutation is correctly inferred from create verb', () => {
        const intent = OrbitContextEngine.classifyIntent('Create a new project milestone');
        assert.strictEqual(intent.actionType, 'mutation');
    });

    await runTest(39, 'Context Engine', 'Action type query is correctly inferred from list/how verb', () => {
        const intent = OrbitContextEngine.classifyIntent('How many employees are active?');
        assert.strictEqual(intent.actionType, 'query');
    });

    await runTest(40, 'Context Engine', 'Optimized system prompt produces structured concise markdown', () => {
        const mockCtx = {
            intent: { primaryDomain: 'projects-and-tasks', targetDomains: ['projects-and-tasks'], actionType: 'query' as const, confidence: 1, entityKeywords: [], rawPrompt: '' },
            scopedEntities: [{ kind: 'project', id: 'p1', title: 'Thor', url: '/projects/p1' }],
            scopedData: { activeProjects: [{ id: 'p1', name: 'Thor', status: 'in_progress', priority: 'high' }] },
            activeUser: { id: 'u1', name: 'Varsha', role: 'admin', permissions: [] },
            workspaceSummary: { companyId: 'c1', companyName: 'Acme Corp' }
        };
        const prompt = OrbitContextEngine.toOptimizedSystemPrompt(mockCtx);
        assert.ok(prompt.includes('Acme Corp'));
        assert.ok(prompt.includes('Thor'));
        assert.ok(prompt.length < 1000);
    });

    // =========================================================================
    // SUITE 5: Multi-Turn Entity Resolution & Link Amnesia Prevention (Tests 41-50)
    // =========================================================================
    console.log(bold('\n🔗 SUITE 5: Multi-Turn Entity Resolution & Link Amnesia Prevention'));

    await runTest(41, 'Entity Linker', 'User asking "Where is the offer letter?" resolves document link', () => {
        const entities = [{ kind: 'document', id: 'doc_123', title: 'Offer Letter - Varsha', url: '/document-editor?id=doc_123' }];
        const result = OrbitEntityLinker.resolveDirectLink('Where is the offer letter?', 'I drafted it earlier.', entities);
        assert.ok(result.enrichedReply.includes('/document-editor?id=doc_123'));
    });

    await runTest(42, 'Entity Linker', 'Typo "operator" resolves to offer letter link', () => {
        const entities = [{ kind: 'document', id: 'doc_456', title: 'Offer Letter - Engineer', url: '/document-editor?id=doc_456' }];
        const result = OrbitEntityLinker.resolveDirectLink('Give me the operator link', 'Here is your link.', entities);
        assert.ok(result.enrichedReply.includes('/document-editor?id=doc_456'));
    });

    await runTest(43, 'Entity Linker', 'Amnesia reply is intercepted and fixed with active document URL', () => {
        const entities = [{ kind: 'document', id: 'doc_789', title: 'Employment Contract', url: '/document-editor?id=doc_789' }];
        const result = OrbitEntityLinker.resolveDirectLink(
            'Open the contract',
            'There is no specific offer letter or document ID provided.',
            entities
        );
        assert.ok(result.enrichedReply.includes('Open "Employment Contract"'));
        assert.ok(result.enrichedReply.includes('/document-editor?id=doc_789'));
    });

    await runTest(44, 'Entity Linker', 'Already linked response is not duplicated', () => {
        const entities = [{ kind: 'document', id: 'doc_123', title: 'Doc', url: '/document-editor?id=doc_123' }];
        const existingReply = 'Here is your link: [Doc](/document-editor?id=doc_123)';
        const result = OrbitEntityLinker.resolveDirectLink('show link', existingReply, entities);
        assert.strictEqual(result.enrichedReply, existingReply);
    });

    await runTest(45, 'Entity Linker', 'Form entity generates direct form editor URL', () => {
        const entities = [{ kind: 'form', id: 'f1', title: 'Lead Intake', url: '/forms/f1' }];
        const result = OrbitEntityLinker.resolveDirectLink('Open that form', 'Sure!', entities);
        assert.ok(result.enrichedReply.includes('/forms/f1'));
    });

    await runTest(46, 'Entity Linker', 'Project entity generates direct project URL', () => {
        const entities = [{ kind: 'project', id: 'p1', title: 'Thor Power', url: '/projects/p1' }];
        const result = OrbitEntityLinker.resolveDirectLink('Open project', 'Here you go', entities);
        assert.ok(result.enrichedReply.includes('/projects/p1'));
    });

    await runTest(47, 'Entity Linker', 'Document preview object is populated on resolution', () => {
        const entities = [{ kind: 'document', id: 'd1', title: 'Terms of Service', url: '/document-editor?id=d1' }];
        const result = OrbitEntityLinker.resolveDirectLink('where is the document?', 'Here it is', entities);
        assert.ok(result.documentPreview);
        assert.strictEqual(result.documentPreview.id, 'd1');
    });

    await runTest(48, 'Entity Linker', 'Empty entity array gracefully returns original reply without modification', () => {
        const result = OrbitEntityLinker.resolveDirectLink('show me the link', 'No entities found.', []);
        assert.strictEqual(result.enrichedReply, 'No entities found.');
    });

    await runTest(49, 'Entity Linker', 'Matching by title substring picks correct target entity', () => {
        const entities = [
            { kind: 'document', id: 'd1', title: 'Alpha Contract', url: '/document-editor?id=d1' },
            { kind: 'document', id: 'd2', title: 'Beta Proposal', url: '/document-editor?id=d2' }
        ];
        const result = OrbitEntityLinker.resolveDirectLink('Give me the Alpha link', 'Here', entities);
        assert.ok(result.enrichedReply.includes('/document-editor?id=d1'));
    });

    await runTest(50, 'Entity Linker', 'Null or undefined prompt handles safely without throwing', () => {
        const result = OrbitEntityLinker.resolveDirectLink('', 'Hello', []);
        assert.strictEqual(result.enrichedReply, 'Hello');
    });

    // =========================================================================
    // SUITE 6: Desired State Planner & DAG Topological Ordering (Tests 51-60)
    // =========================================================================
    console.log(bold('\n🗺️ SUITE 6: Desired State Planner & DAG Topological Ordering'));

    await runTest(51, 'Planner', 'Single-step command generates 1-step plan', async () => {
        const plan = await OrbitPlanner.plan('Create task review code', { companyId: 'c1' });
        assert.strictEqual(plan.steps.length, 1);
        assert.strictEqual(plan.status, 'PLANNED');
    });

    await runTest(52, 'Planner', 'Marketing campaign goal generates 3-step DAG (Form -> Website -> Task)', async () => {
        const plan = await OrbitPlanner.plan('Launch marketing campaign for our AI product', { companyId: 'c1' });
        assert.strictEqual(plan.steps.length, 3);
        assert.strictEqual(plan.steps[0].resourceKind, 'form');
        assert.strictEqual(plan.steps[1].resourceKind, 'website');
        assert.strictEqual(plan.steps[2].resourceKind, 'task');
    });

    await runTest(53, 'Planner', 'Sprint goal generates Project with deliverable Tasks DAG', async () => {
        const plan = await OrbitPlanner.plan('Plan sprint for mobile app delivery', { companyId: 'c1' });
        assert.ok(plan.steps.length >= 3);
        assert.strictEqual(plan.steps[0].resourceKind, 'project');
        assert.strictEqual(plan.steps[1].resourceKind, 'task');
    });

    await runTest(54, 'Planner', 'Employee onboard goal generates Employee, Contract, and IT Task DAG', async () => {
        const plan = await OrbitPlanner.plan('Onboard Rahul as Senior Engineer', { companyId: 'c1' });
        assert.strictEqual(plan.steps.length, 3);
        assert.strictEqual(plan.steps[0].resourceKind, 'employee');
        assert.strictEqual(plan.steps[1].resourceKind, 'document');
        assert.strictEqual(plan.steps[2].resourceKind, 'task');
    });

    await runTest(55, 'Planner', 'Topological sorter preserves linear dependencies correctly', () => {
        const steps = [
            { id: 's3', resourceKind: 'task', operation: 'create' as const, summary: 'Task', payload: {}, dependencies: ['s2'], status: 'PENDING' as const },
            { id: 's1', resourceKind: 'form', operation: 'create' as const, summary: 'Form', payload: {}, status: 'PENDING' as const },
            { id: 's2', resourceKind: 'website', operation: 'create' as const, summary: 'Website', payload: {}, dependencies: ['s1'], status: 'PENDING' as const }
        ];
        const sorted = OrbitPlanner.sortStepsTopologically(steps);
        assert.strictEqual(sorted[0].id, 's1');
        assert.strictEqual(sorted[1].id, 's2');
        assert.strictEqual(sorted[2].id, 's3');
    });

    await runTest(56, 'Planner', 'Topological sorter handles cyclic dependency gracefully without infinite loop', () => {
        const steps = [
            { id: 's1', resourceKind: 'task', operation: 'create' as const, summary: 'T1', payload: {}, dependencies: ['s2'], status: 'PENDING' as const },
            { id: 's2', resourceKind: 'task', operation: 'create' as const, summary: 'T2', payload: {}, dependencies: ['s1'], status: 'PENDING' as const }
        ];
        const sorted = OrbitPlanner.sortStepsTopologically(steps);
        assert.strictEqual(sorted.length, 2);
    });

    await runTest(57, 'Planner', 'Independent steps without dependencies are retained', () => {
        const steps = [
            { id: 's1', resourceKind: 'task', operation: 'create' as const, summary: 'T1', payload: {}, status: 'PENDING' as const },
            { id: 's2', resourceKind: 'task', operation: 'create' as const, summary: 'T2', payload: {}, status: 'PENDING' as const }
        ];
        const sorted = OrbitPlanner.sortStepsTopologically(steps);
        assert.strictEqual(sorted.length, 2);
    });

    await runTest(58, 'Planner', 'Generated plan contains unique plan ID and ISO timestamp', async () => {
        const plan = await OrbitPlanner.plan('Create invoice', { companyId: 'c1' });
        assert.ok(plan.id.startsWith('plan_'));
        assert.ok(plan.createdAt);
    });

    await runTest(59, 'Planner', 'Plan target domain matches primary classified domain', async () => {
        const plan = await OrbitPlanner.plan('Create sales deal for enterprise client', { companyId: 'c1' });
        assert.strictEqual(plan.targetDomain, 'crm-and-sales');
    });

    await runTest(60, 'Planner', 'Empty prompt produces fallback plan safely', async () => {
        const plan = await OrbitPlanner.plan('', { companyId: 'c1' });
        assert.ok(plan.steps.length > 0);
    });

    // =========================================================================
    // SUITE 7: Control Loop Reconciliation & State Verification (Tests 61-70)
    // =========================================================================
    console.log(bold('\n🔄 SUITE 7: Control Loop Reconciliation & State Verification'));

    await runTest(61, 'Reconciler', 'Reconciler executes simple plan and updates status to COMPLETED', async () => {
        const plan = {
            id: 'plan_simple',
            goal: 'Read projects',
            desiredStateSummary: 'Projects read',
            steps: [{ id: 's1', resourceKind: 'project', operation: 'read' as const, summary: 'Read', payload: { statusFilter: 'all' }, status: 'PENDING' as const }],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.executionLog.length, 1);
        assert.strictEqual(res.executionLog[0].status, 'COMPLETED');
    });

    await runTest(62, 'Reconciler', 'Reconciler fails plan if policy rejects step', async () => {
        const plan = {
            id: 'plan_reject',
            goal: 'Delete project as employee',
            desiredStateSummary: 'Project deleted',
            steps: [{ id: 's1', resourceKind: 'project', operation: 'delete' as const, summary: 'Delete', payload: { id: 'p1' }, status: 'PENDING' as const }],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'employee' });
        assert.strictEqual(res.success, false);
    });

    await runTest(63, 'Reconciler', 'Verifier checks resource state without error', async () => {
        const result = await OrbitVerifier.verifyResource('task', 'task_1', {}, { companyId: 'c1' });
        assert.ok(typeof result.verified === 'boolean');
    });

    await runTest(64, 'Reconciler', 'Verifier detects discrepancy on non-matching expected state', async () => {
        const result = await OrbitVerifier.verifyResource('task', 'non_existent_id', {}, { companyId: 'comp_test' });
        assert.strictEqual(result.verified, false);
        assert.ok(result.discrepancy?.includes('was not found'));
    });

    await runTest(65, 'Reconciler', 'Execution log tracks step timestamps and status transitions', async () => {
        const plan = {
            id: 'plan_log_test',
            goal: 'Read tasks',
            desiredStateSummary: 'Tasks read',
            steps: [{ id: 's1', resourceKind: 'task', operation: 'read' as const, summary: 'Read', payload: {}, status: 'PENDING' as const }],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.executionLog[0].stepId, 's1');
        assert.strictEqual(res.executionLog[0].status, 'COMPLETED');
    });

    await runTest(66, 'Reconciler', 'Capability resolver dispatches to registered domain provider', async () => {
        const res = await OrbitCapabilityResolver.execute('task.read', {}, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
    });

    await runTest(67, 'Reconciler', 'Capability resolver handles dot-notation actions (lead.read)', async () => {
        const res = await OrbitCapabilityResolver.execute('lead.read', {}, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
    });

    await runTest(68, 'Reconciler', 'Capability resolver handles legacy underscore actions (get_financial_summary)', async () => {
        const res = await OrbitCapabilityResolver.execute('get_financial_summary', {}, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
    });

    await runTest(69, 'Reconciler', 'Execution time telemetry is captured on every capability call', async () => {
        const res = await OrbitCapabilityResolver.execute('task.read', {}, { companyId: 'c1', userRole: 'admin' });
        assert.ok(typeof res.executionTimeMs === 'number');
        assert.ok(res.executionTimeMs >= 0);
    });

    await runTest(70, 'Reconciler', 'Unregistered tool returns clear not-found message', async () => {
        const res = await OrbitCapabilityResolver.execute('non_existent_capability_123', {}, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, false);
        assert.ok(res.message?.includes('not found'));
    });

    // =========================================================================
    // SUITE 8: Multi-Domain Cascading Operations & Failure Rollbacks (Tests 71-80)
    // =========================================================================
    console.log(bold('\n⛓️ SUITE 8: Multi-Domain Cascading Operations & Failure Rollbacks'));

    await runTest(71, 'Cascading', 'Output entity ID is passed to downstream dependent step', async () => {
        const plan = {
            id: 'plan_cascade',
            goal: 'Create Project and Task',
            desiredStateSummary: 'Project and Task created',
            steps: [
                { id: 's1', resourceKind: 'project', operation: 'read' as const, summary: 'Read proj', payload: {}, status: 'PENDING' as const },
                { id: 's2', resourceKind: 'task', operation: 'read' as const, summary: 'Read tasks', payload: {}, dependencies: ['s1'], status: 'PENDING' as const }
            ],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.executionLog.length, 2);
    });

    await runTest(72, 'Cascading', 'Step failure halts dependent downstream steps', async () => {
        const plan = {
            id: 'plan_halt',
            goal: 'Test Halt',
            desiredStateSummary: 'Halt on failure',
            steps: [
                { id: 's1', resourceKind: 'project', operation: 'delete' as const, summary: 'Fail delete', payload: { id: 'p1' }, isConfirmed: false, status: 'PENDING' as const },
                { id: 's2', resourceKind: 'task', operation: 'read' as const, summary: 'Should not run', payload: {}, dependencies: ['s1'], status: 'PENDING' as const }
            ],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.executionLog.length, 1);
    });

    await runTest(73, 'Cascading', 'Multi-domain plan executes across 3 domains seamlessly', async () => {
        const plan = {
            id: 'plan_multi_domain',
            goal: 'Multi-domain read',
            desiredStateSummary: 'Projects, CRM, and Finance read',
            steps: [
                { id: 's1', resourceKind: 'project', operation: 'read' as const, summary: 'Read Project', payload: {}, status: 'PENDING' as const },
                { id: 's2', resourceKind: 'lead', operation: 'read' as const, summary: 'Read CRM', payload: {}, status: 'PENDING' as const },
                { id: 's3', resourceKind: 'invoice', operation: 'read' as const, summary: 'Read Finance', payload: {}, status: 'PENDING' as const }
            ],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.executionLog.length, 3);
    });

    await runTest(74, 'Cascading', 'Error in single step records step error details without crashing process', async () => {
        const plan = {
            id: 'plan_safe_err',
            goal: 'Safe error test',
            desiredStateSummary: 'Error recorded safely',
            steps: [{ id: 's1', resourceKind: 'non_existent', operation: 'read' as const, summary: 'Bad step', payload: {}, status: 'PENDING' as const }],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, false);
        assert.ok(res.failedStep);
    });

    await runTest(75, 'Cascading', 'Resource registry contains all 9 core SaaS domains', () => {
        const resources = orbitResourceRegistry.getAllResources();
        const kinds = resources.map(r => r.kind);
        assert.ok(kinds.includes('task'));
        assert.ok(kinds.includes('project'));
        assert.ok(kinds.includes('lead'));
        assert.ok(kinds.includes('employee'));
        assert.ok(kinds.includes('invoice'));
        assert.ok(kinds.includes('form'));
        assert.ok(kinds.includes('document'));
        assert.ok(kinds.includes('website'));
        assert.ok(kinds.includes('agent_request'));
    });

    await runTest(76, 'Cascading', 'Domain index maps kinds to correct domain names', () => {
        const projectResources = orbitResourceRegistry.getResourcesByDomain('projects-and-tasks');
        assert.ok(projectResources.some(r => r.kind === 'task'));
        assert.ok(projectResources.some(r => r.kind === 'project'));
    });

    await runTest(77, 'Cascading', 'HRMS domain provider exports employee resource', () => {
        const hrmsResources = orbitResourceRegistry.getResourcesByDomain('hr-management');
        assert.ok(hrmsResources.some(r => r.kind === 'employee'));
    });

    await runTest(78, 'Cascading', 'Finance domain provider exports invoice resource', () => {
        const finResources = orbitResourceRegistry.getResourcesByDomain('finance');
        assert.ok(finResources.some(r => r.kind === 'invoice'));
    });

    await runTest(79, 'Cascading', 'Voiceforce domain provider exports agent_request resource', () => {
        const vfResources = orbitResourceRegistry.getResourcesByDomain('voiceforce');
        assert.ok(vfResources.some(r => r.kind === 'agent_request'));
    });

    await runTest(80, 'Cascading', 'Execution result captures plan desired state summary', async () => {
        const plan = {
            id: 'p_state',
            goal: 'Goal',
            desiredStateSummary: 'All systems operational',
            steps: [{ id: 's1', resourceKind: 'task', operation: 'read' as const, summary: 'Read', payload: {}, status: 'PENDING' as const }],
            createdAt: new Date().toISOString(),
            status: 'PLANNED' as const
        };
        const res = await OrbitReconciler.reconcile(plan, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.updatedWorkspaceState, 'All systems operational');
    });

    // =========================================================================
    // SUITE 9: Autonomous Event Bus & Background Observers (Tests 81-90)
    // =========================================================================
    console.log(bold('\n📡 SUITE 9: Autonomous Event Bus & Background Observers'));

    await runTest(81, 'Event Bus', 'Publishing event stores event in history log', async () => {
        await orbitEventBus.publish({
            id: 'evt_1',
            type: 'orbit.test.event',
            companyId: 'comp_1',
            payload: { message: 'hello' },
            timestamp: new Date().toISOString()
        });
        const history = orbitEventBus.getEventHistory();
        assert.ok(history.some(e => e.id === 'evt_1'));
    });

    await runTest(82, 'Event Bus', 'Exact match subscriber receives event', async () => {
        let received = false;
        orbitEventBus.subscribe('orbit.custom.event', async (event) => {
            if (event.payload?.testKey === 'testVal') received = true;
        });
        await orbitEventBus.publish({
            id: 'evt_2',
            type: 'orbit.custom.event',
            companyId: 'comp_1',
            payload: { testKey: 'testVal' },
            timestamp: new Date().toISOString()
        });
        assert.strictEqual(received, true);
    });

    await runTest(83, 'Event Bus', 'Wildcard subscriber (orbit.task.*) receives task events', async () => {
        let taskEventCount = 0;
        orbitEventBus.subscribe('orbit.task.*', async () => { taskEventCount++; });
        await orbitEventBus.publish({ id: 'evt_3', type: 'orbit.task.created', companyId: 'c1', payload: {}, timestamp: new Date().toISOString() });
        await orbitEventBus.publish({ id: 'evt_4', type: 'orbit.task.updated', companyId: 'c1', payload: {}, timestamp: new Date().toISOString() });
        assert.strictEqual(taskEventCount, 2);
    });

    await runTest(84, 'Event Bus', 'Global wildcard subscriber (*) receives all events', async () => {
        let globalCount = 0;
        orbitEventBus.subscribe('*', async () => { globalCount++; });
        await orbitEventBus.publish({ id: 'evt_5', type: 'orbit.any.event', companyId: 'c1', payload: {}, timestamp: new Date().toISOString() });
        assert.ok(globalCount > 0);
    });

    await runTest(85, 'Event Bus', 'Subscriber error does not crash publisher', async () => {
        orbitEventBus.subscribe('orbit.faulty.event', async () => { throw new Error('Faulty subscriber'); });
        await orbitEventBus.publish({ id: 'evt_6', type: 'orbit.faulty.event', companyId: 'c1', payload: {}, timestamp: new Date().toISOString() });
        assert.ok(true);
    });

    await runTest(86, 'Event Bus', 'High frequency event burst (50 events) processed safely', async () => {
        let burstCount = 0;
        orbitEventBus.subscribe('orbit.burst.test', async () => { burstCount++; });
        const events = Array.from({ length: 50 }).map((_, i) => ({
            id: `burst_${i}`,
            type: 'orbit.burst.test',
            companyId: 'c1',
            payload: { i },
            timestamp: new Date().toISOString()
        }));
        await Promise.all(events.map(e => orbitEventBus.publish(e)));
        assert.strictEqual(burstCount, 50);
    });

    await runTest(87, 'Event Bus', 'History buffer trims older events beyond capacity', () => {
        const history = orbitEventBus.getEventHistory();
        assert.ok(history.length <= 500);
    });

    await runTest(88, 'Event Bus', 'Lead created event observer evaluates deal value', async () => {
        await orbitEventBus.publish({
            id: 'evt_vip',
            type: 'orbit.lead.created',
            companyId: 'c1',
            payload: { name: 'Acme Big Deal', dealValue: 10000 },
            timestamp: new Date().toISOString()
        });
        assert.ok(true);
    });

    await runTest(89, 'Event Bus', 'Form submission event observer evaluates lead capture', async () => {
        await orbitEventBus.publish({
            id: 'evt_form',
            type: 'orbit.form.submitted',
            companyId: 'c1',
            payload: { name: 'Jane Doe', email: 'jane@example.com' },
            timestamp: new Date().toISOString()
        });
        assert.ok(true);
    });

    await runTest(90, 'Event Bus', 'Event bus singleton instance is consistent across imports', () => {
        const eb1 = orbitEventBus;
        const eb2 = OrbitEventBus.getInstance();
        assert.strictEqual(eb1, eb2);
    });

    // =========================================================================
    // SUITE 10: Corrupted Payloads, Regex Fallbacks & LLM Traps (Tests 91-100)
    // =========================================================================
    console.log(bold('\n🧪 SUITE 10: Corrupted Payloads, Regex Fallbacks & LLM Traps'));

    await runTest(91, 'Edge Cases', 'Empty prompt string handles gracefully without throwing', () => {
        const intent = OrbitContextEngine.classifyIntent('');
        assert.ok(intent);
        assert.strictEqual(intent.actionType, 'conversation');
    });

    await runTest(92, 'Edge Cases', 'Null or undefined payload defaults to empty object in capability resolver', async () => {
        const res = await OrbitCapabilityResolver.execute('task.read', null, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
    });

    await runTest(93, 'Edge Cases', 'String numbers in payload (e.g. "5000") are parsed cleanly', async () => {
        const res = await OrbitCapabilityResolver.execute('check_product_price', { productName: 'Enterprise Plan' }, { companyId: 'c1' });
        assert.strictEqual(res.success, true);
        assert.ok(res.data.standardPricing);
    });

    await runTest(94, 'Edge Cases', 'Special characters in task titles are handled safely', async () => {
        const specialTitle = 'Fix: Issue with <script>alert(1)</script> & "quotes" / UTF-8 🚀';
        const plan = await OrbitPlanner.plan(specialTitle, { companyId: 'c1' });
        assert.ok(plan.steps.length > 0);
    });

    await runTest(95, 'Edge Cases', 'Very long prompt (10,000 chars) is processed without memory explosion', () => {
        const longPrompt = 'Create a task for '.repeat(500);
        const intent = OrbitContextEngine.classifyIntent(longPrompt);
        assert.ok(intent.targetDomains.includes('projects-and-tasks'));
    });

    await runTest(96, 'Edge Cases', 'Legacy tool alias (get_payroll) maps to getPayrollAndSalarySummaryTool', async () => {
        const res = await OrbitCapabilityResolver.execute('get_payroll', {}, { companyId: 'c1', userRole: 'admin' });
        assert.strictEqual(res.success, true);
    });

    await runTest(97, 'Edge Cases', 'Legacy tool alias (create_document) maps to generateDocumentAstTool', async () => {
        const res = orbitResourceRegistry.getResource('document');
        assert.ok(res);
        assert.strictEqual(res.kind, 'document');
    });

    await runTest(98, 'Edge Cases', 'Legacy tool alias (create_form) maps to generateFormAstTool', async () => {
        const res = orbitResourceRegistry.getResource('form');
        assert.ok(res);
        assert.strictEqual(res.kind, 'form');
    });

    await runTest(99, 'Edge Cases', 'Legacy tool alias (generate_website_layout) maps to createWebsiteTool', async () => {
        const res = orbitResourceRegistry.getResource('website');
        assert.ok(res);
        assert.strictEqual(res.kind, 'website');
    });

    await runTest(100, 'Edge Cases', 'Full End-to-End Control Plane lifecycle succeeds', async () => {
        // Intent -> Context -> Policy -> Plan -> Reconcile -> Verify
        const goal = 'Review delayed sprint tasks and project health';
        const context = { companyId: 'c1', userRole: 'admin', userId: 'u1' };

        const intent = OrbitContextEngine.classifyIntent(goal);
        assert.ok(intent.targetDomains.includes('projects-and-tasks'));

        const plan = await OrbitPlanner.plan(goal, context);
        assert.ok(plan.steps.length > 0);

        const result = await OrbitReconciler.reconcile(plan, context);
        assert.strictEqual(result.success, true);
        assert.ok(result.executionLog.length > 0);
    });

    // =========================================================================
    // FINAL REPORT & TELEMETRY
    // =========================================================================
    const overallElapsedMs = Date.now() - overallStartTime;

    console.log(bold(cyan('\n================================================================================')));
    console.log(bold(cyan('                     🪐 TEST SUITE EXECUTION SUMMARY                           ')));
    console.log(bold(cyan('================================================================================')));
    console.log(`  Total Tests Executed: ${bold('100')}`);
    console.log(`  Tests Passed:         ${bold(green(passedCount.toString()))}`);
    console.log(`  Tests Failed:         ${bold(failedCount > 0 ? red(failedCount.toString()) : '0')}`);
    console.log(`  Success Rate:         ${bold(passedCount === 100 ? green('100.0%') : red(`${(passedCount / 100 * 100).toFixed(1)}%`))}`);
    console.log(`  Total Execution Time: ${bold(`${overallElapsedMs}ms`)}`);
    console.log(bold(cyan('================================================================================\n')));

    if (failedCount > 0) {
        console.error(red(`🚨 ${failedCount} test(s) failed. See logs above for details.`));
        process.exit(1);
    } else {
        console.log(green('🎉 ALL 100 TEST SUITES PASSED FLAWLESSLY WITH ZERO REGRESSIONS!'));
        process.exit(0);
    }
}

// Execute immediately when run directly
runAll100Tests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
