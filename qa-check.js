#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const mode = process.argv.includes('--dist') ? 'dist' : 'source';
const siteDir = mode === 'dist' ? path.join(rootDir, 'dist') : rootDir;
const ignoredDirectories = new Set(['.git', '.wrangler', '.wrangler-config', 'node_modules', 'dist', '_candidates', '_originals']);
const ignoredFiles = new Set(['candidate-preview.html']);
const requiredMetaPatterns = [
    { name: 'meta description', regex: /<meta\s+name=["']description["']/i },
    { name: 'canonical', regex: /<link\s+rel=["']canonical["']/i },
    { name: 'og:title', regex: /<meta\s+property=["']og:title["']/i },
    { name: 'og:description', regex: /<meta\s+property=["']og:description["']/i },
    { name: 'og:image', regex: /<meta\s+property=["']og:image["']/i },
    { name: 'twitter:card', regex: /<meta\s+name=["']twitter:card["']/i }
];

function findHtmlFiles(directory, relative = '') {
    const files = [];
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        if (item.isDirectory()) {
            if (!ignoredDirectories.has(item.name)) {
                files.push(...findHtmlFiles(path.join(directory, item.name), path.join(relative, item.name)));
            }
        } else if (item.name.endsWith('.html') && !ignoredFiles.has(item.name)) {
            files.push(path.join(relative, item.name));
        }
    }
    return files.sort((a, b) => a.localeCompare(b));
}

function isExternalRef(value) {
    return /^(?:[a-z]+:)?\/\//i.test(value);
}

function isSkippableRef(value) {
    return !value || value.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(value);
}

function localReference(file, rawRef, baseHref) {
    const value = rawRef.trim().split('#')[0].split('?')[0];
    if (!value) return '';
    const baseDir = baseHref && baseHref.startsWith('/') ? baseHref.slice(1) : path.dirname(file);
    const candidate = value.startsWith('/') ? value.slice(1) : path.join(baseDir, value);
    return path.normalize(candidate);
}

function checkLocalizedHomepage(file, html, problems) {
    const normalized = file.split(path.sep).join('/');
    const route = normalized === 'index.html' ? '/' : `/${normalized.replace(/index\.html$/, '')}`;
    const languages = { '/': 'en', '/vi/': 'vi', '/th/': 'th', '/id/': 'id' };
    if (!languages[route]) return;

    const expectedUrl = `https://novagardenhome.com${route}`;
    if (!new RegExp(`<html\\s+lang=["']${languages[route]}["']`, 'i').test(html)) problems.push(`${normalized}: incorrect html lang`);
    if (!html.includes(`rel="canonical" href="${expectedUrl}"`)) problems.push(`${normalized}: incorrect canonical`);
    for (const [hrefRoute, lang] of Object.entries(languages)) {
        if (!html.includes(`hreflang="${lang}" href="https://novagardenhome.com${hrefRoute}"`)) {
            problems.push(`${normalized}: missing hreflang ${lang}`);
        }
    }
}

const htmlFiles = findHtmlFiles(siteDir);
const problems = [];

for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(siteDir, file), 'utf8');
    const isPrivatePage = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
    const baseHref = html.match(/<base\s+href=["']([^"']+)["']/i)?.[1] || '';
    for (const pattern of requiredMetaPatterns) {
        if (isPrivatePage && /^(og:|twitter:)/.test(pattern.name)) continue;
        if (!pattern.regex.test(html)) problems.push(`${file}: missing ${pattern.name}`);
    }

    const refRegex = /<(?:img|script|a|link|source)\b[^>]*\b(?:src|srcset|href)=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = refRegex.exec(html)) !== null) {
        const rawRef = match[1].trim();
        if (isSkippableRef(rawRef) || isExternalRef(rawRef)) continue;
        const target = localReference(file, rawRef, baseHref);
        if (target && !fs.existsSync(path.join(siteDir, target))) problems.push(`${file}: missing "${rawRef}"`);
    }
    if (mode === 'dist') checkLocalizedHomepage(file, html, problems);
}

if (problems.length === 0) {
    console.log(`[QA] PASS - ${mode} checked ${htmlFiles.length} html files.`);
    process.exit(0);
}

console.error(`[QA] FAIL - ${mode} found ${problems.length} issue(s).`);
for (const problem of problems) console.error(`- ${problem}`);
process.exit(1);
