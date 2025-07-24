const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { OpenAI } = require('openai');
const cheerio = require('cheerio');
const axios = require('axios');
const { z } = require('zod');
const { exec } = require('child_process');
const { promisify } = require('util');
require('dotenv').config();

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let allSections = [];
let browserProcess = null;

class EnhancedHtmlStyleProcessor {
    constructor() {
        this.unmatchedElements = [];
        this.elementIndex = 0;
        this.processedElements = new Set();
    }

    camelToKebab(str) {
        return str.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    styleObjectToString(styleObj) {
        return Object.entries(styleObj)
            .map(([key, value]) => {
                const cssKey = this.camelToKebab(key);
                let cssValue = String(value).trim();
                if (!isNaN(cssValue)) {
                    if (['width','height','margin','padding','top','left','right','bottom','font-size','line-height','border-radius'].some(prop => cssKey.includes(prop))) {
                        cssValue = cssValue + (cssValue.includes('%') ? '' : 'px');
                    }
                }
                return `${cssKey}: ${cssValue}`;
            })
            .join('; ');
    }

    safeStringTrim(value) {
        if (value === null || value === undefined) return '';
        if (Array.isArray(value)) return value.join(' ').trim();
        return String(value).trim();
    }

    extractAttributesFromHtml(htmlString) {
        if (!htmlString) return {};
        try {
            const $ = cheerio.load(htmlString);
            const element = $.root().children().first();
            const attributes = {};
            if (element.length > 0) {
                const attrs = element.get(0).attribs || {};
                if (attrs.id) attributes.id = attrs.id;
                if (attrs.class) attributes.className = attrs.class;
                if (attrs['data-mesh-id']) attributes.dataMeshId = attrs['data-mesh-id'];
                if (attrs['data-testid']) attributes.dataTestId = attrs['data-testid'];
                if (attrs['data-test-id']) attributes.dataTestId = attrs['data-test-id'];
            }
            if (Object.keys(attributes).length === 0) {
                const meshIdMatch = htmlString.match(/data-mesh-id=["']([^"']+)["']/);
                if (meshIdMatch) attributes.dataMeshId = meshIdMatch[1];
                const testIdMatch = htmlString.match(/data-testid=["']([^"']+)["']/);
                if (testIdMatch) attributes.dataTestId = testIdMatch[1];
                const idMatch = htmlString.match(/\sid=["']([^"']+)["']/);
                if (idMatch) attributes.id = idMatch[1];
                const classMatch = htmlString.match(/class=["']([^"']*)["']/);
                if (classMatch && classMatch[1].trim()) attributes.className = classMatch[1];
            }
            return attributes;
        } catch (error) {
            return {};
        }
    }

    enrichElementData(element, parentPath = '') {
        const enriched = {
            id: this.safeStringTrim(element.id || element.elementId || element.compId),
            className: this.safeStringTrim(element.className || element.class || element.cssClass),
            dataTestId: this.safeStringTrim(element.dataTestId || element['data-test-id'] || element.testId || element['data-testid']),
            dataMeshId: this.safeStringTrim(element.dataMeshId || element['data-mesh-id'] || element.meshId),
            styles: element.styles || element.style || element.css || {},
            html: this.safeStringTrim(element.html || element.innerHTML || element.outerHTML),
            path: element.path || parentPath,
            parentId: element.parentId || '',
            tagName: element.tagName || element.tag || '',
            textContent: this.safeStringTrim(element.textContent || element.text || element.innerText || ''),
            originalIndex: this.elementIndex++
        };

        if (enriched.html) {
            const htmlAttrs = this.extractAttributesFromHtml(enriched.html);
            if (!enriched.id && htmlAttrs.id) enriched.id = htmlAttrs.id;
            if (!enriched.className && htmlAttrs.className) enriched.className = htmlAttrs.className;
            if (!enriched.dataMeshId && htmlAttrs.dataMeshId) enriched.dataMeshId = htmlAttrs.dataMeshId;
            if (!enriched.dataTestId && htmlAttrs.dataTestId) enriched.dataTestId = htmlAttrs.dataTestId;
        }

        return enriched;
    }

    createElementSignature(element) {
        const parts = [];
        if (element.id) parts.push(`id:${element.id}`);
        if (element.dataMeshId) parts.push(`mesh:${element.dataMeshId}`);
        if (element.dataTestId) parts.push(`test:${element.dataTestId}`);
        if (element.className) parts.push(`class:${element.className}`);
        if (element.textContent) parts.push(`text:${element.textContent.substring(0,20)}`);
        if (element.tagName) parts.push(`tag:${element.tagName}`);
        parts.push(`idx:${element.originalIndex}`);
        return parts.join('|');
    }

    escapeCSSValue(value) {
        if (!value || typeof value !== 'string') return '';
        return value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    isValidCSSSelector(selector) {
        if (!selector || typeof selector !== 'string' || selector.trim() === '') return false;
        if (selector.includes('[]') || selector.includes('""') || selector.includes("''")) return false;
        const openBrackets = (selector.match(/\[/g) || []).length;
        const closeBrackets = (selector.match(/\]/g) || []).length;
        if (openBrackets !== closeBrackets) return false;
        try {
            const testHtml = '<div></div>';
            const testCheerio = require('cheerio').load(testHtml);
            testCheerio(selector);
            return true;
        } catch (error) {
            return false;
        }
    }

    safeQuerySelector($, selector, description = '') {
        if (!this.isValidCSSSelector(selector)) return $();
        try {
            return $(selector);
        } catch (error) {
            return $();
        }
    }

    findPreciseMatch($, element) {
        let candidates = [];
        
        if (element.id && element.id.trim()) {
            const escapedId = this.escapeCSSValue(element.id);
            const idSelector = `#${escapedId}`;
            const idMatches = this.safeQuerySelector($, idSelector, 'for ID');
            if (idMatches.length === 1) {
                return { element: idMatches.first(), confidence: 100, method: 'unique-id' };
            } else if (idMatches.length > 1) {
                candidates = candidates.concat(
                    idMatches.toArray().map((el, idx) => ({
                        element: $(el),
                        confidence: 90 - idx,
                        method: 'id-with-disambiguation'
                    }))
                );
            }
        }
        
        if (element.dataMeshId && element.dataMeshId.trim()) {
            const escapedMeshId = this.escapeCSSValue(element.dataMeshId);
            const meshSelector = `[data-mesh-id="${escapedMeshId}"]`;
            const meshMatches = this.safeQuerySelector($, meshSelector, 'for data-mesh-id');
            if (meshMatches.length === 1) {
                return { element: meshMatches.first(), confidence: 95, method: 'unique-mesh-id' };
            } else if (meshMatches.length > 1) {
                candidates = candidates.concat(
                    meshMatches.toArray().map((el, idx) => ({
                        element: $(el),
                        confidence: 85 - idx,
                        method: 'mesh-id-with-disambiguation'
                    }))
                );
            }
        }
        
        if (element.dataTestId && element.dataTestId.trim()) {
            const escapedTestId = this.escapeCSSValue(element.dataTestId);
            const testIdSelectors = [
                `[data-testid="${escapedTestId}"]`,
                `[data-test-id="${escapedTestId}"]`
            ];
            for (const selector of testIdSelectors) {
                const testMatches = this.safeQuerySelector($, selector, 'for data-testid');
                if (testMatches.length === 1) {
                    return { element: testMatches.first(), confidence: 80, method: 'unique-test-id' };
                } else if (testMatches.length > 1) {
                    candidates = candidates.concat(
                        testMatches.toArray().map((el, idx) => ({
                            element: $(el),
                            confidence: 70 - idx,
                            method: 'test-id-with-disambiguation'
                        }))
                    );
                }
            }
        }
        
        if (element.className && element.className.trim()) {
            const classes = element.className.split(' ').filter(c => c.trim());
            for (const className of classes) {
                if (!className.match(/^[a-zA-Z_-][a-zA-Z0-9_-]*$/)) continue;
                const classSelector = `.${className}`;
                const classMatches = this.safeQuerySelector($, classSelector, `for class ${className}`);
                if (classMatches.length > 0) {
                    classMatches.each((idx, el) => {
                        const $el = $(el);
                        let contextScore = 0;
                        if (element.textContent && $el.text().trim() === element.textContent) contextScore += 30;
                        if (element.tagName && $el.get(0).tagName.toLowerCase() === element.tagName.toLowerCase()) contextScore += 20;
                        if (element.parentId && element.parentId.trim()) {
                            const escapedParentId = this.escapeCSSValue(element.parentId);
                            const parentSelector = `#${escapedParentId}`;
                            if (this.isValidCSSSelector(parentSelector)) {
                                const parent = $el.closest(parentSelector);
                                if (parent.length > 0) contextScore += 25;
                            }
                        }
                        candidates.push({
                            element: $el,
                            confidence: 40 + contextScore - idx,
                            method: `class-context-${className}`
                        });
                    });
                }
            }
        }
        
        candidates.sort((a, b) => b.confidence - a.confidence);
        if (candidates.length > 0) return candidates[0];
        return null;
    }

    applyStylesToElement($, element, styleString) {
        const elementSignature = this.createElementSignature(element);
        if (this.processedElements.has(elementSignature)) {
            return { success: false, reason: 'already-processed' };
        }
        const match = this.findPreciseMatch($, element);
        if (!match) return { success: false, reason: 'no-match-found' };
        const $targetElement = match.element;
        if ($targetElement.get(0).tagName && $targetElement.get(0).tagName.toLowerCase() === 'html') {
            return { success: false, reason: 'html-element-skipped' };
        }
        const existingStyle = $targetElement.attr('style') || '';
        const existingStyles = existingStyle ? existingStyle.split(';').map(s => s.trim()).filter(s => s) : [];
        const newStyles = styleString.split(';').map(s => s.trim()).filter(s => s);
        const styleMap = new Map();
        existingStyles.forEach(style => {
            const [prop, value] = style.split(':').map(s => s.trim());
            if (prop && value) styleMap.set(prop, value);
        });
        newStyles.forEach(style => {
            const [prop, value] = style.split(':').map(s => s.trim());
            if (prop && value) styleMap.set(prop, value);
        });
        const finalStyle = Array.from(styleMap.entries())
            .map(([prop, value]) => `${prop}: ${value}`)
            .join('; ');
        $targetElement.attr('style', finalStyle);
        this.processedElements.add(elementSignature);
        return { success: true, method: match.method, confidence: match.confidence };
    }

    extractElements(layoutData) {
        let elements = [];
        const findElements = (obj, path = '', parentId = '') => {
            if (obj === null || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    findElements(item, `${path}[${index}]`, parentId);
                });
                return;
            }
            const hasStyleInfo = obj.styles || obj.className || obj.id || obj.dataTestId || obj['data-test-id'];
            const hasLayoutInfo = obj.type || obj.tag || obj.tagName || obj.element || obj.component || obj.html;
            if (hasStyleInfo || hasLayoutInfo) {
                const element = this.enrichElementData({
                    ...obj,
                    path: path,
                    parentId: parentId
                });
                if (element.styles && Object.keys(element.styles).length > 0 &&
                    (element.id || element.className || element.dataTestId || element.dataMeshId || element.html)) {
                    elements.push(element);
                }
            }
            const currentId = obj.id || obj.elementId || obj.compId || parentId;
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'object' && value !== null) {
                    findElements(value, `${path}.${key}`, currentId);
                }
            }
        };
        findElements(layoutData);
        return elements;
    }

    async processHtml(rawHtml, layoutJson, outputDir, sectionIndex) {
        const $ = cheerio.load(rawHtml);
        const elements = this.extractElements(layoutJson);
        if (elements.length === 0) {
            return {
                styledHtml: this.formatCleanHtml(rawHtml),
                layoutInlineFile: null
            };
        }
        let successCount = 0;
        let failureCount = 0;
        elements.sort((a, b) => {
            let scoreA = 0, scoreB = 0;
            if (a.id) scoreA += 100;
            if (b.id) scoreB += 100;
            if (a.dataMeshId) scoreA += 50;
            if (b.dataMeshId) scoreB += 50;
            if (a.dataTestId) scoreA += 30;
            if (b.dataTestId) scoreB += 30;
            return scoreA === scoreB ? a.originalIndex - b.originalIndex : scoreB - scoreA;
        });
        elements.forEach((element) => {
            if (!element.styles || Object.keys(element.styles).length === 0) return;
            const styleString = this.styleObjectToString(element.styles);
            const result = this.applyStylesToElement($, element, styleString);
            result.success ? successCount++ : failureCount++;
        });
        const styledHtml = this.formatCleanHtml($.html());
        const layoutInlineFile = `layout_inlineStyles_${sectionIndex}.html`;
        await fs.writeFile(path.join(outputDir, layoutInlineFile), styledHtml);
        return {
            styledHtml,
            layoutInlineFile
        };
    }

    formatCleanHtml(html) {
        const $ = cheerio.load(html);
        $('style').remove();
        let cleanHtml = $.html();
        if (!cleanHtml.includes('<!DOCTYPE html>')) {
            cleanHtml = '<!DOCTYPE html>\n' + cleanHtml;
        }
        return cleanHtml
            .replace(/>\s*</g, '>\n<')
            .replace(/\n\s*\n/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
    }
}

async function extractAndSaveSections(rawHtmlContent, computedStyles, outputDir) {
    await fs.mkdir(path.join(outputDir, 'sections'), { recursive: true });
    const $ = cheerio.load(rawHtmlContent);
    const htmlSections = $('body > section, html > section').toArray();
    const sections = htmlSections.length > 0 
        ? htmlSections 
        : $('section').filter((i, el) => $(el).parents('section').length === 0).toArray();
    const sectionFiles = [];
    const computedKeys = Object.keys(computedStyles);
    for (let i = 0; i < sections.length; i++) {
        const $section = $(sections[i]);
        const sectionHtml = $.html($section);
        const sectionId = $section.attr('id') || `section_${i}`;
        let computedSection = null;
        for (const key of computedKeys) {
            if (key.includes(sectionId) || computedStyles[key]?.id === sectionId) {
                computedSection = computedStyles[key];
                break;
            }
        }
        if (!computedSection && computedKeys[i]) {
            computedSection = computedStyles[computedKeys[i]];
        }
        const htmlFilename = `sections/section_${i}.html`;
        await fs.writeFile(path.join(outputDir, htmlFilename), sectionHtml);
        const computedFilename = `sections/section_${i}_computed.json`;
        await fs.writeFile(
            path.join(outputDir, computedFilename),
            JSON.stringify({ [sectionId]: computedSection || {} }, null, 2)
        );
        sectionFiles.push({
            index: i,
            sectionId,
            htmlFile: htmlFilename,
            computedFile: computedFilename
        });
    }
    return sectionFiles;
}

async function processSectionRecursive(sectionIndex, sectionFiles, outputDir, globalTemplates, processedSections) {
    if (sectionIndex >= sectionFiles.length) {
        return {
            sectionFiles,
            processedSections,
            globalTemplates,
            summary: {
                totalSections: sectionFiles.length,
                successfulSections: processedSections.filter(s => !s.failed).length,
                failedSections: processedSections.filter(s => s.failed).length,
                averageCompression: processedSections.filter(s => !s.failed).length > 0
                    ? (processedSections.filter(s => !s.failed).reduce((sum, s) => sum + parseFloat(s.stats?.compressionRatio || '0'), 0) / processedSections.filter(s => !s.failed).length).toFixed(1) + '%'
                    : '0%'
            }
        };
    }

    const section = sectionFiles[sectionIndex];
    try {
        const sectionHtml = await fs.readFile(path.join(outputDir, section.htmlFile), 'utf8');
        const computedData = JSON.parse(await fs.readFile(path.join(outputDir, section.computedFile), 'utf8'));
        const styleProcessor = new EnhancedHtmlStyleProcessor();
        const step1Result = await styleProcessor.processHtml(sectionHtml, computedData, outputDir, section.index);
        const step2Result = await generateBareMinimumHtml(section.index, step1Result.styledHtml, outputDir);
        const step3Result = await assembleFinalWebsite(section.index, outputDir);
        const sectionData = {
            index: section.index,
            html: step3Result.finalHtml,
            completed: true
        };
        allSections.push(sectionData);
        processedSections.push({
            index: section.index,
            sectionKey: Object.keys(computedData)[0] || `section_${section.index}`,
            files: {
                original: section.htmlFile,
                computed: section.computedFile,
                layoutInline: step1Result.layoutInlineFile,
                bareMinimum: step2Result.bareMinimumFile
            },
            stats: {
                originalSize: sectionHtml.length,
                finalSize: step3Result.finalHtml.length,
                compressionRatio: ((sectionHtml.length - step3Result.finalHtml.length) / sectionHtml.length * 100).toFixed(1) + '%'
            }
        });
        await updateBrowserDisplay(outputDir, section.index === 0);
        return processSectionRecursive(sectionIndex + 1, sectionFiles, outputDir, globalTemplates, processedSections);
    } catch (error) {
        processedSections.push({
            index: section.index,
            error: error.message,
            failed: true
        });
        return processSectionRecursive(sectionIndex + 1, sectionFiles, outputDir, globalTemplates, processedSections);
    }
}

async function processAllSections(rawHtmlContent, computedStyles, outputDir) {
    allSections = [];
    browserProcess = null;
    const sectionFiles = await extractAndSaveSections(rawHtmlContent, computedStyles, outputDir);
    return processSectionRecursive(0, sectionFiles, outputDir, [], []);
}

app.post('/api/migrate', async (req, res) => {
    try {
        const outputDir = path.join(__dirname, 'output');
        try { await fs.mkdir(outputDir, { recursive: true }); } catch (err) {}
        const computedStylesPath = path.join(__dirname, 'computed-styles.json');
        const rawHtmlPath = path.join(__dirname, 'raw.html');
        let computedStyles, rawHtmlContent;
        try {
            const computedStylesContent = await fs.readFile(computedStylesPath, 'utf8');
            computedStyles = JSON.parse(computedStylesContent);
        } catch (error) {
            return res.status(400).json({ error: 'Could not load computed-styles.json', message: error.message });
        }
        try {
            rawHtmlContent = await fs.readFile(rawHtmlPath, 'utf8');
        } catch (error) {
            return res.status(400).json({ error: 'Could not load raw.html', message: error.message });
        }
        const results = await processAllSections(rawHtmlContent, computedStyles, outputDir);
        const migrationReport = {
            success: true,
            timestamp: new Date().toISOString(),
            ...results,
            message: `Successfully processed ${results.summary.successfulSections}/${results.summary.totalSections} sections`
        };
        await fs.writeFile(
            path.join(outputDir, 'migration_report.json'),
            JSON.stringify(migrationReport, null, 2)
        );
        res.json(migrationReport);
    } catch (error) {
        res.status(500).json({
            error: 'Migration failed',
            message: error.message
        });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        const computedStylesExists = await fs.access(path.join(__dirname, 'computed-styles.json')).then(() => true).catch(() => false);
        const rawHtmlExists = await fs.access(path.join(__dirname, 'raw.html')).then(() => true).catch(() => false);
        res.json({
            status: 'ready',
            openaiConfigured: !!process.env.OPENAI_API_KEY,
            filesReady: {
                computedStyles: computedStylesExists,
                rawHtml: rawHtmlExists
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/files', async (req, res) => {
    try {
        const outputDir = path.join(__dirname, 'output');
        let files = [];
        try {
            const dirContents = await fs.readdir(outputDir);
            files = dirContents.filter(file => file.endsWith('.json') || file.endsWith('.html'));
        } catch (error) {}
        const fileCategories = {
            sections: files.filter(f => f.startsWith('section_') && !f.includes('computed')),
            computed: files.filter(f => f.includes('computed')),
            layouts: files.filter(f => f.startsWith('layout_')),
            bareMinimum: files.filter(f => f.startsWith('bareminimum_')),
            reports: files.filter(f => f.includes('report') || f.includes('summary'))
        };
        res.json({ files, count: files.length, categories: fileCategories });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Section-by-Section HTML Migration System</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .button { background: #007bff; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer; margin: 10px 5px; }
        .button:hover { background: #0056b3; }
        .button:disabled { background: #ccc; cursor: not-allowed; }
        .button.secondary { background: #6c757d; }
        .button.secondary:hover { background: #545b62; }
        .status { margin: 20px 0; padding: 15px; border-radius: 5px; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
        .loading { background: #cce5ff; border: 1px solid #99d6ff; color: #004085; }
        .info { background: #e8f4fd; border: 1px solid #bee5eb; color: #0c5460; }
        pre { background: #f8f9fa; padding: 15px; border-radius: 5px; overflow-x: auto; font-size: 12px; max-height: 400px; overflow-y: auto; }
        .step { margin: 10px 0; padding: 10px; background: #f8f9fa; border-left: 4px solid #007bff; }
        .files-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; margin: 20px 0; }
        .file-item { background: #e9ecef; padding: 10px; border-radius: 5px; font-size: 12px; }
        h1 { color: #333; margin-bottom: 10px; }
        h3 { color: #495057; margin-top: 30px; }
        .progress { background: #e9ecef; border-radius: 5px; height: 20px; margin: 10px 0; }
        .progress-bar { background: #007bff; height: 100%; border-radius: 5px; transition: width 0.3s; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Section-by-Section HTML Migration System</h1>
        <p><strong>Recursive Processing Pipeline:</strong></p>
        <div class="step">Step 1: Extract sections from raw HTML</div>
        <div class="step">Step 2: Process sections with EnhancedHtmlStyleProcessor</div>
        <div class="step">Step 3: Generate optimized HTML</div>
        <div style="margin: 30px 0;">
            <button id="migrateBtn" class="button" onclick="startMigration()">🚀 START MIGRATION</button>
            <button class="button secondary" onclick="checkStatus()">📊 CHECK STATUS</button>
            <button class="button secondary" onclick="listFiles()">📁 LIST OUTPUT FILES</button>
        </div>
        <div id="status"></div>
        <div id="progress" style="display: none;">
            <div class="progress">
                <div id="progressBar" class="progress-bar" style="width: 0%;"></div>
            </div>
            <div id="progressText">Initializing...</div>
        </div>
        <div id="results"></div>
    </div>
    <script>
        let migrationInProgress = false;
        async function startMigration() {
            if (migrationInProgress) return;
            const btn = document.getElementById('migrateBtn');
            const status = document.getElementById('status');
            const results = document.getElementById('results');
            const progress = document.getElementById('progress');
            migrationInProgress = true;
            btn.disabled = true;
            btn.textContent = '⏳ PROCESSING...';
            status.innerHTML = '<div class="status loading">🔄 Starting recursive section-by-section migration...</div>';
            results.innerHTML = '';
            progress.style.display = 'block';
            try {
                const response = await fetch('/api/migrate', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                const data = await response.json();
                if (data.success) {
                    status.innerHTML = \`
                        <div class="status success">
                            ✅ Migration completed successfully!<br>
                            📊 Processed: \${data.summary.successfulSections}/\${data.summary.totalSections} sections<br>
                            📉 Average compression: \${data.summary.averageCompression}
                        </div>
                    \`;
                    results.innerHTML = '<h3>📋 Detailed Results:</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
                    document.getElementById('progressBar').style.width = '100%';
                    document.getElementById('progressText').textContent = 'Migration completed successfully!';
                    window.open('/output/all_sections.html', '_blank');
                } else {
                    status.innerHTML = '<div class="status error">❌ Migration failed: ' + (data.message || 'Unknown error') + '</div>';
                    if (data.errors) {
                        results.innerHTML = '<h3>❌ Errors:</h3><pre>' + JSON.stringify(data.errors, null, 2) + '</pre>';
                    }
                }
            } catch (error) {
                status.innerHTML = '<div class="status error">❌ Network Error: ' + error.message + '</div>';
            } finally {
                migrationInProgress = false;
                btn.disabled = false;
                btn.textContent = '🚀 START MIGRATION';
                setTimeout(() => { progress.style.display = 'none'; }, 3000);
            }
        }
        async function checkStatus() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                let statusClass = 'info';
                let statusIcon = '📊';
                if (!data.openaiConfigured) {
                    statusClass = 'error';
                    statusIcon = '❌';
                } else if (!data.filesReady.computedStyles || !data.filesReady.rawHtml) {
                    statusClass = 'warning';
                    statusIcon = '⚠️';
                } else {
                    statusClass = 'success';
                    statusIcon = '✅';
                }
                document.getElementById('status').innerHTML = \`
                    <div class="status \${statusClass}">
                        \${statusIcon} System Status<br>
                        OpenAI API: \${data.openaiConfigured ? '✅ Configured' : '❌ Not configured'}<br>
                        computed-styles.json: \${data.filesReady.computedStyles ? '✅ Found' : '❌ Missing'}<br>
                        raw.html: \${data.filesReady.rawHtml ? '✅ Found' : '❌ Missing'}
                    </div>
                \`;
            } catch (error) {
                document.getElementById('status').innerHTML = '<div class="status error">❌ Status check failed: ' + error.message + '</div>';
            }
        }
        async function listFiles() {
            try {
                const response = await fetch('/api/files');
                const data = await response.json();
                if (data.files.length === 0) {
                    document.getElementById('results').innerHTML = '<div class="status info">📁 No output files found yet. Run migration first.</div>';
                } else {
                    const filesByStep = {
                        'Sections': data.categories.sections,
                        'Computed Styles': data.categories.computed,
                        'Layouts': data.categories.layouts,
                        'Bare Minimum': data.categories.bareMinimum,
                        'Reports': data.categories.reports
                    };
                    let html = '<h3>📁 Output Files (' + data.count + ' total)</h3>';
                    for (const [step, files] of Object.entries(filesByStep)) {
                        if (files.length > 0) {
                            html += '<h4>' + step + ' (' + files.length + ' files)</h4>';
                            html += '<div class="files-grid">';
                            files.forEach(file => {
                                html += '<div class="file-item">📄 ' + file + '</div>';
                            });
                            html += '</div>';
                        }
                    }
                    document.getElementById('results').innerHTML = html;
                }
            } catch (error) {
                document.getElementById('results').innerHTML = '<div class="status error">❌ File listing failed: ' + error.message + '</div>';
            }
        }
        window.addEventListener('load', checkStatus);
        function simulateProgress() {
            if (!migrationInProgress) return;
            const progressBar = document.getElementById('progressBar');
            const progressText = document.getElementById('progressText');
            const currentWidth = parseInt(progressBar.style.width) || 0;
            if (currentWidth < 90) {
                progressBar.style.width = (currentWidth + Math.random() * 10) + '%';
                progressText.textContent = 'Processing sections... ' + Math.round(currentWidth) + '% complete';
                setTimeout(simulateProgress, 2000);
            }
        }
        document.getElementById('migrateBtn').addEventListener('click', () => {
            setTimeout(simulateProgress, 1000);
        });
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;