/**
 * Build/deploy step: downloads WS1's curated brand fonts (Google Fonts, OFL/Apache) as TTF into a folder the carousel
 * compiler reads. Usage: npx tsx packages/domains/social-media/scripts/fetch-brand-fonts.ts [targetDir]
 * Then set CREATIVE_FONTS_DIR=<targetDir> on the server. Without it, fonts are fetched on first use and cached in tmp.
 */
import path from 'path';
import { BRAND_FONTS } from '../src/brand-consciousness';
import { downloadBrandFonts } from '../src/creative/fonts';

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'assets', 'brand-fonts'));
downloadBrandFonts(BRAND_FONTS, dir).then((r) => {
    const failed = r.filter((x) => !x.ok);
    console.log(`Fonts in ${dir}: ${r.length - failed.length}/${r.length}`);
    if (failed.length) {
        console.error('Failed:', failed.map((f) => f.family).join(', '));
        process.exit(1);
    }
});
