#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const htmlFiles = fs
    .readdirSync(rootDir)
    .filter((file) => file.endsWith('.html') && file !== 'candidate-preview.html')
    .sort((a, b) => a.localeCompare(b));

const requiredMetaPatterns = [
    { name: 'meta description', regex: /<meta\s+name=["']description["']/i },
    { name: 'canonical', regex: /<link\s+rel=["']canonical["']/i },
    { name: 'og:title', regex: /<meta\s+property=["']og:title["']/i },
    { name: 'og:description', regex: /<meta\s+property=["']og:description["']/i },
    { name: 'og:image', regex: /<meta\s+property=["']og:image["']/i },
    { name: 'twitter:card', regex: /<meta\s+name=["']twitter:card["']/i }
];

function isExternalRef(value) {
    return /^(?:[a-z]+:)?\/\//i.test(value);
}

function isSkippableRef(value) {
    return (
        !value ||
        value.startsWith('#') ||
        value.startsWith('mailto:') ||
        value.startsWith('tel:') ||
        value.startsWith('javascript:') ||
        value.startsWith('data:')
    );
}

function normalizeRef(value) {
    return value.split('#')[0].split('?')[0];
}

let missingAssets = [];
let missingMeta = [];

for (const file of htmlFiles) {
    const absolutePath = path.join(rootDir, file);
    const html = fs.readFileSync(absolutePath, 'utf8');

    const isPrivatePage = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
    for (const pattern of requiredMetaPatterns) {
        if (isPrivatePage && /^(og:|twitter:)/.test(pattern.name)) {
            continue;
        }
        if (!pattern.regex.test(html)) {
            missingMeta.push(`${file}: missing ${pattern.name}`);
        }
    }

    const refRegex = /<(?:img|script|a|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = refRegex.exec(html)) !== null) {
        const rawRef = match[1].trim();
        if (isSkippableRef(rawRef) || isExternalRef(rawRef)) {
            continue;
        }

        const relativeRef = normalizeRef(rawRef);
        if (!relativeRef) {
            continue;
        }

        const targetPath = path.resolve(rootDir, relativeRef);
        if (!fs.existsSync(targetPath)) {
            missingAssets.push(`${file}: missing "${relativeRef}"`);
        }
    }
}

const problems = [...missingMeta, ...missingAssets];

if (problems.length === 0) {
    console.log(`[QA] PASS - checked ${htmlFiles.length} html files.`);
    process.exit(0);
}

console.error(`[QA] FAIL - ${problems.length} issue(s) found.`);
for (const line of problems) {
    console.error(`- ${line}`);
}
process.exit(1);
