const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const configPath = path.join(root, 'assets/scripts/core/GameBrandConfig.ts');
const htmlPath = path.join(root, 'build-templates/web-mobile/index.html');

const config = fs.readFileSync(configPath, 'utf8');
const match = config.match(/export const GAME_NAME\s*=\s*['"]([^'"]+)['"]/);
if (!match) {
    console.error('[sync-brand-title] GAME_NAME not found in GameBrandConfig.ts');
    process.exit(1);
}

const gameName = match[1];
let html = fs.readFileSync(htmlPath, 'utf8');
const titleRe = /^([ \t]*<title>)([\s\S]*?)(<\/title>)/m;
if (!titleRe.test(html)) {
    console.error('[sync-brand-title] <title> tag not found in index.html');
    process.exit(1);
}

const nextHtml = html.replace(titleRe, `$1${gameName}$3`);
if (nextHtml === html) {
    console.log(`[sync-brand-title] already up to date: ${gameName}`);
    process.exit(0);
}

fs.writeFileSync(htmlPath, nextHtml);
console.log(`[sync-brand-title] web title -> ${gameName}`);
