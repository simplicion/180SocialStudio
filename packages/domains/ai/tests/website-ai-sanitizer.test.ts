/**
 * Website AI builder: output validation/sanitization + typed AI_NOT_CONFIGURED.
 * Run: npx tsx --test --test-force-exit packages/domains/ai/tests/website-ai-sanitizer.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeElementNode,
    sanitizeSections,
    sanitizeGeneratedWebsite,
    sanitizeStyle,
    sanitizeRichText,
    sanitizeLink,
    sanitizeHttpUrl,
    sanitizeBrand,
    WEBSITE_ELEMENT_TYPES,
    WEBSITE_SANITIZE_LIMITS,
    WebsiteBuilderError,
    WebsiteAIBuilderService,
} from '../src/builders/website-ai-builder.service';
import { AICompanyConfigService } from '../src/kernel/ai-company-config.service';
import { aiProviderService } from '../src/kernel/ai-provider.service';

const ALLOWED = new Set<string>(WEBSITE_ELEMENT_TYPES);

function walk(node: any, fn: (n: any, depth: number) => void, depth = 0) {
    fn(node, depth);
    for (const c of node.children || []) walk(c, fn, depth + 1);
}

test('only allowed element types survive; unknown containers become boxes, unknown leaves are dropped', () => {
    const out = sanitizeSections([
        {
            type: 'section',
            children: [
                { type: 'iframe', data: { src: 'https://evil.example' } },
                { type: 'grid', children: [{ type: 'text', data: { content: 'Hi' } }] },
                { type: 'image', data: { imageUrl: 'https://cdn.example.com/a.png' } },
                { type: 'section', children: [{ type: 'button', data: { content: 'Go', link: '/start' } }] },
            ],
        },
    ]);
    assert.equal(out.length, 1);
    const types: string[] = [];
    walk(out[0], (n) => types.push(n.type));
    assert.ok(types.every((t) => ALLOWED.has(t)), `unexpected types: ${types}`);
    assert.deepEqual(out[0].children!.map((c) => c.type), ['box', 'media', 'box']);
});

test('ids are always regenerated and unique', () => {
    const out = sanitizeSections([
        { id: 'x', type: 'section', children: [{ id: 'x', type: 'text', data: { content: 'a' } }, { id: 'x', type: 'text', data: { content: 'b' } }] },
    ]);
    const ids: string[] = [];
    walk(out[0], (n) => ids.push(n.id));
    assert.ok(!ids.includes('x'));
    assert.equal(new Set(ids).size, ids.length);
});

test('scripts, event handlers and javascript: URLs are stripped from text', () => {
    const html = 'Hello <script>alert(1)</script><b onclick="steal()">bold</b> <a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>';
    const clean = sanitizeRichText(html);
    assert.ok(!/script/i.test(clean));
    assert.ok(!/onclick|onerror/i.test(clean));
    assert.ok(!/javascript:/i.test(clean));
    assert.ok(clean.includes('<b>bold</b>'));

    const node = sanitizeElementNode({ type: 'text', data: { content: html } })!;
    assert.ok(!/script|onclick|javascript:/i.test(node.data.content));
});

test('URLs: media must be http(s); links allow anchors, relative paths, http(s), mailto and tel', () => {
    assert.equal(sanitizeHttpUrl('javascript:alert(1)'), '');
    assert.equal(sanitizeHttpUrl('data:image/png;base64,AAA'), '');
    assert.equal(sanitizeHttpUrl('//cdn.example.com/a.png'), '');
    assert.equal(sanitizeHttpUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
    assert.equal(sanitizeLink('javascript:alert(1)'), '#');
    assert.equal(sanitizeLink('//evil.example'), '#');
    assert.equal(sanitizeLink('#contact'), '#contact');
    assert.equal(sanitizeLink('/about'), '/about');
    assert.equal(sanitizeLink('mailto:a@b.co'), 'mailto:a@b.co');
    assert.equal(sanitizeLink('https://example.org/x'), 'https://example.org/x');

    const media = sanitizeElementNode({ type: 'media', data: { imageUrl: 'javascript:alert(1)', alt: '<b>x</b>' } })!;
    assert.equal(media.data.imageUrl, '');
    assert.equal(media.data.alt, 'x');
    const btn = sanitizeElementNode({ type: 'button', data: { content: '<i>Buy</i>', link: 'vbscript:x' } })!;
    assert.deepEqual(btn.data, { content: 'Buy', link: '#' });
});

test('style: CSS injection removed, unsafe url() dropped, tagName whitelisted, numbers kept', () => {
    const s = sanitizeStyle({
        color: 'red;}</style><script>',
        backgroundImage: 'url(javascript:alert(1))',
        background: 'url("https://cdn.example.com/bg.jpg")',
        width: 'expression(alert(1))',
        paddingY: 6,
        tagName: 'script',
        'font-size': '2rem',
        fontSize: '2rem',
    });
    assert.equal(s.color, 'red/stylescript');
    assert.ok(!('backgroundImage' in s));
    assert.equal(s.background, 'url("https://cdn.example.com/bg.jpg")');
    assert.ok(!('width' in s));
    assert.equal(s.paddingY, 6);
    assert.ok(!('tagName' in s));
    assert.ok(!('font-size' in s));
    assert.equal(sanitizeStyle({ tagName: 'H1' }).tagName, 'h1');
});

test('responsive and hiddenOn overrides are kept and sanitized', () => {
    const n = sanitizeElementNode({
        type: 'text',
        data: { content: 'Title' },
        style: { tagName: 'h1', fontSize: '4rem' },
        responsive: { mobile: { fontSize: '2.25rem', color: 'x;{}' }, desktop: { fontSize: '9rem' } },
        hiddenOn: { mobile: true, tablet: 'yes' },
    })!;
    assert.deepEqual(n.responsive, { mobile: { fontSize: '2.25rem', color: 'x' } });
    assert.deepEqual(n.hiddenOn, { mobile: true });
});

test('depth, children and node-count caps are enforced', () => {
    let deep: any = { type: 'text', data: { content: 'leaf' } };
    for (let i = 0; i < 30; i++) deep = { type: 'box', children: [deep] };
    const out = sanitizeSections([{ type: 'section', children: [deep] }]);
    let maxDepth = 0;
    walk(out[0], (_n, d) => { maxDepth = Math.max(maxDepth, d); });
    assert.ok(maxDepth <= WEBSITE_SANITIZE_LIMITS.maxDepth);

    const wide = { type: 'section', children: Array.from({ length: 200 }, () => ({ type: 'text', data: { content: 'x' } })) };
    assert.equal(sanitizeSections([wide])[0].children!.length, WEBSITE_SANITIZE_LIMITS.maxChildren);

    const many = Array.from({ length: 50 }, () => ({ type: 'section', children: Array.from({ length: 40 }, () => ({ type: 'text', data: { content: 'x' } })) }));
    let count = 0;
    sanitizeSections(many).forEach((s) => walk(s, () => count++));
    assert.ok(count <= WEBSITE_SANITIZE_LIMITS.maxNodes);
});

test('leaf nodes never carry children; top-level non-sections are wrapped in a section', () => {
    const out = sanitizeSections([{ type: 'text', data: { content: 'loose' }, children: [{ type: 'text' }] }]);
    assert.equal(out[0].type, 'section');
    assert.equal(out[0].children![0].type, 'text');
    assert.equal(out[0].children![0].children, undefined);
});

test('sanitizeGeneratedWebsite: valid output passes; empty or junk throws AI_INVALID_OUTPUT', () => {
    const ok = sanitizeGeneratedWebsite({
        title: '<b>Acme</b> Bakery',
        brand: { primaryColor: '#f59e0b', textColor: 'red', headingFont: 'Playfair Display', bodyFont: 'x;y' },
        sections: [{ type: 'section', name: 'Hero', children: [{ type: 'text', data: { content: 'Fresh bread' }, style: { tagName: 'h1' } }] }],
    });
    assert.equal(ok.title, 'Acme Bakery');
    assert.deepEqual(ok.brand, { primaryColor: '#f59e0b', headingFont: 'Playfair Display' });
    assert.equal(ok.sections[0].name, 'Hero');

    for (const bad of [null, 'text', [], { sections: [] }, { sections: [{ type: 'script' }] }, { sections: [{ type: 'section', children: [] }] }]) {
        assert.throws(() => sanitizeGeneratedWebsite(bad), (e: any) => e instanceof WebsiteBuilderError && e.code === 'AI_INVALID_OUTPUT' && e.statusCode === 502);
    }
    assert.deepEqual(sanitizeBrand({ primaryColor: '#12345' }), {});
});

test('compileAST: no AI provider -> typed AI_NOT_CONFIGURED (503), no canned site', async (t) => {
    const origSettings = AICompanyConfigService.getCompanyAISettings;
    const origClient = aiProviderService.getClient;
    (AICompanyConfigService as any).getCompanyAISettings = async () => ({ settings: { aiProvider: 'none' }, companyName: 'Acme', metadata: {} });
    (aiProviderService as any).getClient = async () => null;
    t.after(() => {
        (AICompanyConfigService as any).getCompanyAISettings = origSettings;
        (aiProviderService as any).getClient = origClient;
    });

    const svc = new WebsiteAIBuilderService();
    await assert.rejects(
        svc.compileAST({ prompt: 'A site for my bakery', companyId: 'company-1', userId: 'user-1' }),
        (e: any) => e.code === 'AI_NOT_CONFIGURED' && e.statusCode === 503
    );
    await assert.rejects(
        svc.compileAST({ prompt: 'A site for my bakery', companyId: '' as any, userId: 'user-1' }),
        (e: any) => e.code === 'COMPANY_REQUIRED'
    );
});

test('compileAST: provider failure -> AI_PROVIDER_ERROR, unparseable output -> AI_INVALID_OUTPUT', async (t) => {
    const origSettings = AICompanyConfigService.getCompanyAISettings;
    const origClient = aiProviderService.getClient;
    let mode: 'throw' | 'junk' = 'throw';
    (AICompanyConfigService as any).getCompanyAISettings = async () => ({ settings: { aiProvider: 'openai' }, companyName: 'Acme', metadata: {} });
    (aiProviderService as any).getClient = async () => ({
        provider: 'openai',
        generate: async () => {
            if (mode === 'throw') throw new Error('429 rate limited');
            return 'Sure! Here is your website.';
        },
    });
    t.after(() => {
        (AICompanyConfigService as any).getCompanyAISettings = origSettings;
        (aiProviderService as any).getClient = origClient;
    });

    const svc = new WebsiteAIBuilderService();
    // loadBusinessContext swallows DB errors (no DB in unit tests) and continues with the company name.
    await assert.rejects(svc.compileAST({ prompt: 'bakery', companyId: 'company-1', userId: 'u' }), (e: any) => e.code === 'AI_PROVIDER_ERROR');
    mode = 'junk';
    await assert.rejects(svc.compileAST({ prompt: 'bakery', companyId: 'company-1', userId: 'u' }), (e: any) => e.code === 'AI_INVALID_OUTPUT');
});
