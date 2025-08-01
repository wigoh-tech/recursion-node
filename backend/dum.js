// const express = require('express');
// const fs = require('fs/promises');
// const path = require('path');
// const { OpenAI } = require('openai');
// const cheerio = require('cheerio');
// const axios = require('axios');
// const { z } = require('zod');
// const { exec } = require('child_process');
// const { promisify } = require('util');
// require('dotenv').config();

// const execPromise = promisify(exec);
// const app = express();
// const PORT = process.env.PORT || 3000;

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY
// });

// let allSections = [];
// let browserProcess = null;

// class EnhancedHtmlStyleProcessor {
//     constructor() {
//         this.unmatchedElements = [];
//         this.elementIndex = 0;
//         this.processedElements = new Set();
//     }

//     camelToKebab(str) {
//         return str.replace(/([A-Z])/g, '-$1').toLowerCase();
//     }

//     styleObjectToString(styleObj) {
//         return Object.entries(styleObj)
//             .map(([key, value]) => {
//                 const cssKey = this.camelToKebab(key);
//                 let cssValue = String(value).trim();
//                 if (!isNaN(cssValue)) {
//                     if (['width','height','margin','padding','top','left','right','bottom','font-size','line-height','border-radius'].some(prop => cssKey.includes(prop))) {
//                         cssValue = cssValue + (cssValue.includes('%') ? '' : 'px');
//                     }
//                 }
//                 return `${cssKey}: ${cssValue}`;
//             })
//             .join('; ');
//     }

//     safeStringTrim(value) {
//         if (value === null || value === undefined) return '';
//         if (Array.isArray(value)) return value.join(' ').trim();
//         return String(value).trim();
//     }

//     extractAttributesFromHtml(htmlString) {
//         if (!htmlString) return {};
//         try {
//             const $ = cheerio.load(htmlString);
//             const element = $.root().children().first();
//             const attributes = {};
//             if (element.length > 0) {
//                 const attrs = element.get(0).attribs || {};
//                 if (attrs.id) attributes.id = attrs.id;
//                 if (attrs.class) attributes.className = attrs.class;
//                 if (attrs['data-mesh-id']) attributes.dataMeshId = attrs['data-mesh-id'];
//                 if (attrs['data-testid']) attributes.dataTestId = attrs['data-testid'];
//                 if (attrs['data-test-id']) attributes.dataTestId = attrs['data-test-id'];
//             }
//             if (Object.keys(attributes).length === 0) {
//                 const meshIdMatch = htmlString.match(/data-mesh-id=["']([^"']+)["']/);
//                 if (meshIdMatch) attributes.dataMeshId = meshIdMatch[1];
//                 const testIdMatch = htmlString.match(/data-testid=["']([^"']+)["']/);
//                 if (testIdMatch) attributes.dataTestId = testIdMatch[1];
//                 const idMatch = htmlString.match(/\sid=["']([^"']+)["']/);
//                 if (idMatch) attributes.id = idMatch[1];
//                 const classMatch = htmlString.match(/class=["']([^"']*)["']/);
//                 if (classMatch && classMatch[1].trim()) attributes.className = classMatch[1];
//             }
//             return attributes;
//         } catch (error) {
//             return {};
//         }
//     }

//     enrichElementData(element, parentPath = '') {
//         const enriched = {
//             id: this.safeStringTrim(element.id || element.elementId || element.compId),
//             className: this.safeStringTrim(element.className || element.class || element.cssClass),
//             dataTestId: this.safeStringTrim(element.dataTestId || element['data-test-id'] || element.testId || element['data-testid']),
//             dataMeshId: this.safeStringTrim(element.dataMeshId || element['data-mesh-id'] || element.meshId),
//             styles: element.styles || element.style || element.css || {},
//             html: this.safeStringTrim(element.html || element.innerHTML || element.outerHTML),
//             path: element.path || parentPath,
//             parentId: element.parentId || '',
//             tagName: element.tagName || element.tag || '',
//             textContent: this.safeStringTrim(element.textContent || element.text || element.innerText || ''),
//             originalIndex: this.elementIndex++
//         };

//         if (enriched.html) {
//             const htmlAttrs = this.extractAttributesFromHtml(enriched.html);
//             if (!enriched.id && htmlAttrs.id) enriched.id = htmlAttrs.id;
//             if (!enriched.className && htmlAttrs.className) enriched.className = htmlAttrs.className;
//             if (!enriched.dataMeshId && htmlAttrs.dataMeshId) enriched.dataMeshId = htmlAttrs.dataMeshId;
//             if (!enriched.dataTestId && htmlAttrs.dataTestId) enriched.dataTestId = htmlAttrs.dataTestId;
//         }

//         return enriched;
//     }

//     createElementSignature(element) {
//         const parts = [];
//         if (element.id) parts.push(`id:${element.id}`);
//         if (element.dataMeshId) parts.push(`mesh:${element.dataMeshId}`);
//         if (element.dataTestId) parts.push(`test:${element.dataTestId}`);
//         if (element.className) parts.push(`class:${element.className}`);
//         if (element.textContent) parts.push(`text:${element.textContent.substring(0,20)}`);
//         if (element.tagName) parts.push(`tag:${element.tagName}`);
//         parts.push(`idx:${element.originalIndex}`);
//         return parts.join('|');
//     }

//     escapeCSSValue(value) {
//         if (!value || typeof value !== 'string') return '';
//         return value
//             .replace(/\\/g, '\\\\')
//             .replace(/"/g, '\\"')
//             .replace(/'/g, "\\'")
//             .replace(/\n/g, '\\n')
//             .replace(/\r/g, '\\r')
//             .replace(/\t/g, '\\t');
//     }

//     isValidCSSSelector(selector) {
//         if (!selector || typeof selector !== 'string' || selector.trim() === '') return false;
//         if (selector.includes('[]') || selector.includes('""') || selector.includes("''")) return false;
//         const openBrackets = (selector.match(/\[/g) || []).length;
//         const closeBrackets = (selector.match(/\]/g) || []).length;
//         if (openBrackets !== closeBrackets) return false;
//         try {
//             const testHtml = '<div></div>';
//             const testCheerio = require('cheerio').load(testHtml);
//             testCheerio(selector);
//             return true;
//         } catch (error) {
//             return false;
//         }
//     }

//     safeQuerySelector($, selector, description = '') {
//         if (!this.isValidCSSSelector(selector)) return $();
//         try {
//             return $(selector);
//         } catch (error) {
//             return $();
//         }
//     }

//     findPreciseMatch($, element) {
//         let candidates = [];
        
//         if (element.id && element.id.trim()) {
//             const escapedId = this.escapeCSSValue(element.id);
//             const idSelector = `#${escapedId}`;
//             const idMatches = this.safeQuerySelector($, idSelector, 'for ID');
//             if (idMatches.length === 1) {
//                 return { element: idMatches.first(), confidence: 100, method: 'unique-id' };
//             } else if (idMatches.length > 1) {
//                 candidates = candidates.concat(
//                     idMatches.toArray().map((el, idx) => ({
//                         element: $(el),
//                         confidence: 90 - idx,
//                         method: 'id-with-disambiguation'
//                     }))
//                 );
//             }
//         }
        
//         if (element.dataMeshId && element.dataMeshId.trim()) {
//             const escapedMeshId = this.escapeCSSValue(element.dataMeshId);
//             const meshSelector = `[data-mesh-id="${escapedMeshId}"]`;
//             const meshMatches = this.safeQuerySelector($, meshSelector, 'for data-mesh-id');
//             if (meshMatches.length === 1) {
//                 return { element: meshMatches.first(), confidence: 95, method: 'unique-mesh-id' };
//             } else if (meshMatches.length > 1) {
//                 candidates = candidates.concat(
//                     meshMatches.toArray().map((el, idx) => ({
//                         element: $(el),
//                         confidence: 85 - idx,
//                         method: 'mesh-id-with-disambiguation'
//                     }))
//                 );
//             }
//         }
        
//         if (element.dataTestId && element.dataTestId.trim()) {
//             const escapedTestId = this.escapeCSSValue(element.dataTestId);
//             const testIdSelectors = [
//                 `[data-testid="${escapedTestId}"]`,
//                 `[data-test-id="${escapedTestId}"]`
//             ];
//             for (const selector of testIdSelectors) {
//                 const testMatches = this.safeQuerySelector($, selector, 'for data-testid');
//                 if (testMatches.length === 1) {
//                     return { element: testMatches.first(), confidence: 80, method: 'unique-test-id' };
//                 } else if (testMatches.length > 1) {
//                     candidates = candidates.concat(
//                         testMatches.toArray().map((el, idx) => ({
//                             element: $(el),
//                             confidence: 70 - idx,
//                             method: 'test-id-with-disambiguation'
//                         }))
//                     );
//                 }
//             }
//         }
        
//         if (element.className && element.className.trim()) {
//             const classes = element.className.split(' ').filter(c => c.trim());
//             for (const className of classes) {
//                 if (!className.match(/^[a-zA-Z_-][a-zA-Z0-9_-]*$/)) continue;
//                 const classSelector = `.${className}`;
//                 const classMatches = this.safeQuerySelector($, classSelector, `for class ${className}`);
//                 if (classMatches.length > 0) {
//                     classMatches.each((idx, el) => {
//                         const $el = $(el);
//                         let contextScore = 0;
//                         if (element.textContent && $el.text().trim() === element.textContent) contextScore += 30;
//                         if (element.tagName && $el.get(0).tagName.toLowerCase() === element.tagName.toLowerCase()) contextScore += 20;
//                         if (element.parentId && element.parentId.trim()) {
//                             const escapedParentId = this.escapeCSSValue(element.parentId);
//                             const parentSelector = `#${escapedParentId}`;
//                             if (this.isValidCSSSelector(parentSelector)) {
//                                 const parent = $el.closest(parentSelector);
//                                 if (parent.length > 0) contextScore += 25;
//                             }
//                         }
//                         candidates.push({
//                             element: $el,
//                             confidence: 40 + contextScore - idx,
//                             method: `class-context-${className}`
//                         });
//                     });
//                 }
//             }
//         }
        
//         candidates.sort((a, b) => b.confidence - a.confidence);
//         if (candidates.length > 0) return candidates[0];
//         return null;
//     }

//     applyStylesToElement($, element, styleString) {
//         const elementSignature = this.createElementSignature(element);
//         if (this.processedElements.has(elementSignature)) {
//             return { success: false, reason: 'already-processed' };
//         }
//         const match = this.findPreciseMatch($, element);
//         if (!match) return { success: false, reason: 'no-match-found' };
//         const $targetElement = match.element;
//         if ($targetElement.get(0).tagName && $targetElement.get(0).tagName.toLowerCase() === 'html') {
//             return { success: false, reason: 'html-element-skipped' };
//         }
//         const existingStyle = $targetElement.attr('style') || '';
//         const existingStyles = existingStyle ? existingStyle.split(';').map(s => s.trim()).filter(s => s) : [];
//         const newStyles = styleString.split(';').map(s => s.trim()).filter(s => s);
//         const styleMap = new Map();
//         existingStyles.forEach(style => {
//             const [prop, value] = style.split(':').map(s => s.trim());
//             if (prop && value) styleMap.set(prop, value);
//         });
//         newStyles.forEach(style => {
//             const [prop, value] = style.split(':').map(s => s.trim());
//             if (prop && value) styleMap.set(prop, value);
//         });
//         const finalStyle = Array.from(styleMap.entries())
//             .map(([prop, value]) => `${prop}: ${value}`)
//             .join('; ');
//         $targetElement.attr('style', finalStyle);
//         this.processedElements.add(elementSignature);
//         return { success: true, method: match.method, confidence: match.confidence };
//     }

//     extractElements(layoutData) {
//         let elements = [];
//         const findElements = (obj, path = '', parentId = '') => {
//             if (obj === null || typeof obj !== 'object') return;
//             if (Array.isArray(obj)) {
//                 obj.forEach((item, index) => {
//                     findElements(item, `${path}[${index}]`, parentId);
//                 });
//                 return;
//             }
//             const hasStyleInfo = obj.styles || obj.className || obj.id || obj.dataTestId || obj['data-test-id'];
//             const hasLayoutInfo = obj.type || obj.tag || obj.tagName || obj.element || obj.component || obj.html;
//             if (hasStyleInfo || hasLayoutInfo) {
//                 const element = this.enrichElementData({
//                     ...obj,
//                     path: path,
//                     parentId: parentId
//                 });
//                 if (element.styles && Object.keys(element.styles).length > 0 &&
//                     (element.id || element.className || element.dataTestId || element.dataMeshId || element.html)) {
//                     elements.push(element);
//                 }
//             }
//             const currentId = obj.id || obj.elementId || obj.compId || parentId;
//             for (const [key, value] of Object.entries(obj)) {
//                 if (typeof value === 'object' && value !== null) {
//                     findElements(value, `${path}.${key}`, currentId);
//                 }
//             }
//         };
//         findElements(layoutData);
//         return elements;
//     }

//     async processHtml(rawHtml, layoutJson, outputDir, sectionIndex) {
//         const $ = cheerio.load(rawHtml);
//         const elements = this.extractElements(layoutJson);
//         if (elements.length === 0) {
//             return {
//                 styledHtml: this.formatCleanHtml(rawHtml),
//                 layoutInlineFile: null
//             };
//         }
//         let successCount = 0;
//         let failureCount = 0;
//         elements.sort((a, b) => {
//             let scoreA = 0, scoreB = 0;
//             if (a.id) scoreA += 100;
//             if (b.id) scoreB += 100;
//             if (a.dataMeshId) scoreA += 50;
//             if (b.dataMeshId) scoreB += 50;
//             if (a.dataTestId) scoreA += 30;
//             if (b.dataTestId) scoreB += 30;
//             return scoreA === scoreB ? a.originalIndex - b.originalIndex : scoreB - scoreA;
//         });
//         elements.forEach((element) => {
//             if (!element.styles || Object.keys(element.styles).length === 0) return;
//             const styleString = this.styleObjectToString(element.styles);
//             const result = this.applyStylesToElement($, element, styleString);
//             result.success ? successCount++ : failureCount++;
//         });
//         const styledHtml = this.formatCleanHtml($.html());
//         const layoutInlineFile = `layout_inlineStyles_${sectionIndex}.html`;
//         await fs.writeFile(path.join(outputDir, layoutInlineFile), styledHtml);
//         return {
//             styledHtml,
//             layoutInlineFile
//         };
//     }

//     formatCleanHtml(html) {
//         const $ = cheerio.load(html);
//         $('style').remove();
//         let cleanHtml = $.html();
//         if (!cleanHtml.includes('<!DOCTYPE html>')) {
//             cleanHtml = '<!DOCTYPE html>\n' + cleanHtml;
//         }
//         return cleanHtml
//             .replace(/>\s*</g, '>\n<')
//             .replace(/\n\s*\n/g, '\n')
//             .split('\n')
//             .map(line => line.trim())
//             .filter(line => line.length > 0)
//             .join('\n');
//     }
// }

// async function extractAndSaveSections(rawHtmlContent, computedStyles, outputDir) {
//     await fs.mkdir(path.join(outputDir, 'sections'), { recursive: true });
//     const $ = cheerio.load(rawHtmlContent);
//     const htmlSections = $('body > section, html > section').toArray();
//     const sections = htmlSections.length > 0 
//         ? htmlSections 
//         : $('section').filter((i, el) => $(el).parents('section').length === 0).toArray();
//     const sectionFiles = [];
//     const computedKeys = Object.keys(computedStyles);
//     for (let i = 0; i < sections.length; i++) {
//         const $section = $(sections[i]);
//         const sectionHtml = $.html($section);
//         const sectionId = $section.attr('id') || `section_${i}`;
//         let computedSection = null;
//         for (const key of computedKeys) {
//             if (key.includes(sectionId) || computedStyles[key]?.id === sectionId) {
//                 computedSection = computedStyles[key];
//                 break;
//             }
//         }
//         if (!computedSection && computedKeys[i]) {
//             computedSection = computedStyles[computedKeys[i]];
//         }
//         const htmlFilename = `sections/section_${i}.html`;
//         await fs.writeFile(path.join(outputDir, htmlFilename), sectionHtml);
//         const computedFilename = `sections/section_${i}_computed.json`;
//         await fs.writeFile(
//             path.join(outputDir, computedFilename),
//             JSON.stringify({ [sectionId]: computedSection || {} }, null, 2)
//         );
//         sectionFiles.push({
//             index: i,
//             sectionId,
//             htmlFile: htmlFilename,
//             computedFile: computedFilename
//         });
//     }
//     return sectionFiles;
// }

// async function processSectionRecursive(sectionIndex, sectionFiles, outputDir, globalTemplates, processedSections) {
//     if (sectionIndex >= sectionFiles.length) {
//         return {
//             sectionFiles,
//             processedSections,
//             globalTemplates,
//             summary: {
//                 totalSections: sectionFiles.length,
//                 successfulSections: processedSections.filter(s => !s.failed).length,
//                 failedSections: processedSections.filter(s => s.failed).length,
//                 averageCompression: processedSections.filter(s => !s.failed).length > 0
//                     ? (processedSections.filter(s => !s.failed).reduce((sum, s) => sum + parseFloat(s.stats?.compressionRatio || '0'), 0) / processedSections.filter(s => !s.failed).length).toFixed(1) + '%'
//                     : '0%'
//             }
//         };
//     }

//     const section = sectionFiles[sectionIndex];
//     try {
//         const sectionHtml = await fs.readFile(path.join(outputDir, section.htmlFile), 'utf8');
//         const computedData = JSON.parse(await fs.readFile(path.join(outputDir, section.computedFile), 'utf8'));
//         const styleProcessor = new EnhancedHtmlStyleProcessor();
//         const step1Result = await styleProcessor.processHtml(sectionHtml, computedData, outputDir, section.index);
//         const step2Result = await generateBareMinimumHtml(section.index, step1Result.styledHtml, outputDir);
//         const step3Result = await assembleFinalWebsite(section.index, outputDir);
//         const sectionData = {
//             index: section.index,
//             html: step3Result.finalHtml,
//             completed: true
//         };
//         allSections.push(sectionData);
//         processedSections.push({
//             index: section.index,
//             sectionKey: Object.keys(computedData)[0] || `section_${section.index}`,
//             files: {
//                 original: section.htmlFile,
//                 computed: section.computedFile,
//                 layoutInline: step1Result.layoutInlineFile,
//                 bareMinimum: step2Result.bareMinimumFile
//             },
//             stats: {
//                 originalSize: sectionHtml.length,
//                 finalSize: step3Result.finalHtml.length,
//                 compressionRatio: ((sectionHtml.length - step3Result.finalHtml.length) / sectionHtml.length * 100).toFixed(1) + '%'
//             }
//         });
//         await updateBrowserDisplay(outputDir, section.index === 0);
//         return processSectionRecursive(sectionIndex + 1, sectionFiles, outputDir, globalTemplates, processedSections);
//     } catch (error) {
//         processedSections.push({
//             index: section.index,
//             error: error.message,
//             failed: true
//         });
//         return processSectionRecursive(sectionIndex + 1, sectionFiles, outputDir, globalTemplates, processedSections);
//     }
// }

// async function processAllSections(rawHtmlContent, computedStyles, outputDir) {
//     allSections = [];
//     browserProcess = null;
//     const sectionFiles = await extractAndSaveSections(rawHtmlContent, computedStyles, outputDir);
//     return processSectionRecursive(0, sectionFiles, outputDir, [], []);
// }

// app.post('/api/migrate', async (req, res) => {
//     try {
//         const outputDir = path.join(__dirname, 'output');
//         try { await fs.mkdir(outputDir, { recursive: true }); } catch (err) {}
//         const computedStylesPath = path.join(__dirname, 'computed-styles.json');
//         const rawHtmlPath = path.join(__dirname, 'raw.html');
//         let computedStyles, rawHtmlContent;
//         try {
//             const computedStylesContent = await fs.readFile(computedStylesPath, 'utf8');
//             computedStyles = JSON.parse(computedStylesContent);
//         } catch (error) {
//             return res.status(400).json({ error: 'Could not load computed-styles.json', message: error.message });
//         }
//         try {
//             rawHtmlContent = await fs.readFile(rawHtmlPath, 'utf8');
//         } catch (error) {
//             return res.status(400).json({ error: 'Could not load raw.html', message: error.message });
//         }
//         const results = await processAllSections(rawHtmlContent, computedStyles, outputDir);
//         const migrationReport = {
//             success: true,
//             timestamp: new Date().toISOString(),
//             ...results,
//             message: `Successfully processed ${results.summary.successfulSections}/${results.summary.totalSections} sections`
//         };
//         await fs.writeFile(
//             path.join(outputDir, 'migration_report.json'),
//             JSON.stringify(migrationReport, null, 2)
//         );
//         res.json(migrationReport);
//     } catch (error) {
//         res.status(500).json({
//             error: 'Migration failed',
//             message: error.message
//         });
//     }
// });

// app.get('/api/status', async (req, res) => {
//     try {
//         const computedStylesExists = await fs.access(path.join(__dirname, 'computed-styles.json')).then(() => true).catch(() => false);
//         const rawHtmlExists = await fs.access(path.join(__dirname, 'raw.html')).then(() => true).catch(() => false);
//         res.json({
//             status: 'ready',
//             openaiConfigured: !!process.env.OPENAI_API_KEY,
//             filesReady: {
//                 computedStyles: computedStylesExists,
//                 rawHtml: rawHtmlExists
//             },
//             timestamp: new Date().toISOString()
//         });
//     } catch (error) {
//         res.json({
//             status: 'error',
//             message: error.message,
//             timestamp: new Date().toISOString()
//         });
//     }
// });

// app.get('/api/files', async (req, res) => {
//     try {
//         const outputDir = path.join(__dirname, 'output');
//         let files = [];
//         try {
//             const dirContents = await fs.readdir(outputDir);
//             files = dirContents.filter(file => file.endsWith('.json') || file.endsWith('.html'));
//         } catch (error) {}
//         const fileCategories = {
//             sections: files.filter(f => f.startsWith('section_') && !f.includes('computed')),
//             computed: files.filter(f => f.includes('computed')),
//             layouts: files.filter(f => f.startsWith('layout_')),
//             bareMinimum: files.filter(f => f.startsWith('bareminimum_')),
//             reports: files.filter(f => f.includes('report') || f.includes('summary'))
//         };
//         res.json({ files, count: files.length, categories: fileCategories });
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// });

// app.get('/', (req, res) => {
//     res.send(`
// <!DOCTYPE html>
// <html lang="en">
// <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>Section-by-Section HTML Migration System</title>
//     <style>
//         body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
//         .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
//         .button { background: #007bff; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer; margin: 10px 5px; }
//         .button:hover { background: #0056b3; }
//         .button:disabled { background: #ccc; cursor: not-allowed; }
//         .button.secondary { background: #6c757d; }
//         .button.secondary:hover { background: #545b62; }
//         .status { margin: 20px 0; padding: 15px; border-radius: 5px; }
//         .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
//         .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
//         .warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
//         .loading { background: #cce5ff; border: 1px solid #99d6ff; color: #004085; }
//         .info { background: #e8f4fd; border: 1px solid #bee5eb; color: #0c5460; }
//         pre { background: #f8f9fa; padding: 15px; border-radius: 5px; overflow-x: auto; font-size: 12px; max-height: 400px; overflow-y: auto; }
//         .step { margin: 10px 0; padding: 10px; background: #f8f9fa; border-left: 4px solid #007bff; }
//         .files-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; margin: 20px 0; }
//         .file-item { background: #e9ecef; padding: 10px; border-radius: 5px; font-size: 12px; }
//         h1 { color: #333; margin-bottom: 10px; }
//         h3 { color: #495057; margin-top: 30px; }
//         .progress { background: #e9ecef; border-radius: 5px; height: 20px; margin: 10px 0; }
//         .progress-bar { background: #007bff; height: 100%; border-radius: 5px; transition: width 0.3s; }
//     </style>
// </head>
// <body>
//     <div class="container">
//         <h1>🚀 Section-by-Section HTML Migration System</h1>
//         <p><strong>Recursive Processing Pipeline:</strong></p>
//         <div class="step">Step 1: Extract sections from raw HTML</div>
//         <div class="step">Step 2: Process sections with EnhancedHtmlStyleProcessor</div>
//         <div class="step">Step 3: Generate optimized HTML</div>
//         <div style="margin: 30px 0;">
//             <button id="migrateBtn" class="button" onclick="startMigration()">🚀 START MIGRATION</button>
//             <button class="button secondary" onclick="checkStatus()">📊 CHECK STATUS</button>
//             <button class="button secondary" onclick="listFiles()">📁 LIST OUTPUT FILES</button>
//         </div>
//         <div id="status"></div>
//         <div id="progress" style="display: none;">
//             <div class="progress">
//                 <div id="progressBar" class="progress-bar" style="width: 0%;"></div>
//             </div>
//             <div id="progressText">Initializing...</div>
//         </div>
//         <div id="results"></div>
//     </div>
//     <script>
//         let migrationInProgress = false;
//         async function startMigration() {
//             if (migrationInProgress) return;
//             const btn = document.getElementById('migrateBtn');
//             const status = document.getElementById('status');
//             const results = document.getElementById('results');
//             const progress = document.getElementById('progress');
//             migrationInProgress = true;
//             btn.disabled = true;
//             btn.textContent = '⏳ PROCESSING...';
//             status.innerHTML = '<div class="status loading">🔄 Starting recursive section-by-section migration...</div>';
//             results.innerHTML = '';
//             progress.style.display = 'block';
//             try {
//                 const response = await fetch('/api/migrate', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
//                 const data = await response.json();
//                 if (data.success) {
//                     status.innerHTML = \`
//                         <div class="status success">
//                             ✅ Migration completed successfully!<br>
//                             📊 Processed: \${data.summary.successfulSections}/\${data.summary.totalSections} sections<br>
//                             📉 Average compression: \${data.summary.averageCompression}
//                         </div>
//                     \`;
//                     results.innerHTML = '<h3>📋 Detailed Results:</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
//                     document.getElementById('progressBar').style.width = '100%';
//                     document.getElementById('progressText').textContent = 'Migration completed successfully!';
//                     window.open('/output/all_sections.html', '_blank');
//                 } else {
//                     status.innerHTML = '<div class="status error">❌ Migration failed: ' + (data.message || 'Unknown error') + '</div>';
//                     if (data.errors) {
//                         results.innerHTML = '<h3>❌ Errors:</h3><pre>' + JSON.stringify(data.errors, null, 2) + '</pre>';
//                     }
//                 }
//             } catch (error) {
//                 status.innerHTML = '<div class="status error">❌ Network Error: ' + error.message + '</div>';
//             } finally {
//                 migrationInProgress = false;
//                 btn.disabled = false;
//                 btn.textContent = '🚀 START MIGRATION';
//                 setTimeout(() => { progress.style.display = 'none'; }, 3000);
//             }
//         }
//         async function checkStatus() {
//             try {
//                 const response = await fetch('/api/status');
//                 const data = await response.json();
//                 let statusClass = 'info';
//                 let statusIcon = '📊';
//                 if (!data.openaiConfigured) {
//                     statusClass = 'error';
//                     statusIcon = '❌';
//                 } else if (!data.filesReady.computedStyles || !data.filesReady.rawHtml) {
//                     statusClass = 'warning';
//                     statusIcon = '⚠️';
//                 } else {
//                     statusClass = 'success';
//                     statusIcon = '✅';
//                 }
//                 document.getElementById('status').innerHTML = \`
//                     <div class="status \${statusClass}">
//                         \${statusIcon} System Status<br>
//                         OpenAI API: \${data.openaiConfigured ? '✅ Configured' : '❌ Not configured'}<br>
//                         computed-styles.json: \${data.filesReady.computedStyles ? '✅ Found' : '❌ Missing'}<br>
//                         raw.html: \${data.filesReady.rawHtml ? '✅ Found' : '❌ Missing'}
//                     </div>
//                 \`;
//             } catch (error) {
//                 document.getElementById('status').innerHTML = '<div class="status error">❌ Status check failed: ' + error.message + '</div>';
//             }
//         }
//         async function listFiles() {
//             try {
//                 const response = await fetch('/api/files');
//                 const data = await response.json();
//                 if (data.files.length === 0) {
//                     document.getElementById('results').innerHTML = '<div class="status info">📁 No output files found yet. Run migration first.</div>';
//                 } else {
//                     const filesByStep = {
//                         'Sections': data.categories.sections,
//                         'Computed Styles': data.categories.computed,
//                         'Layouts': data.categories.layouts,
//                         'Bare Minimum': data.categories.bareMinimum,
//                         'Reports': data.categories.reports
//                     };
//                     let html = '<h3>📁 Output Files (' + data.count + ' total)</h3>';
//                     for (const [step, files] of Object.entries(filesByStep)) {
//                         if (files.length > 0) {
//                             html += '<h4>' + step + ' (' + files.length + ' files)</h4>';
//                             html += '<div class="files-grid">';
//                             files.forEach(file => {
//                                 html += '<div class="file-item">📄 ' + file + '</div>';
//                             });
//                             html += '</div>';
//                         }
//                     }
//                     document.getElementById('results').innerHTML = html;
//                 }
//             } catch (error) {
//                 document.getElementById('results').innerHTML = '<div class="status error">❌ File listing failed: ' + error.message + '</div>';
//             }
//         }
//         window.addEventListener('load', checkStatus);
//         function simulateProgress() {
//             if (!migrationInProgress) return;
//             const progressBar = document.getElementById('progressBar');
//             const progressText = document.getElementById('progressText');
//             const currentWidth = parseInt(progressBar.style.width) || 0;
//             if (currentWidth < 90) {
//                 progressBar.style.width = (currentWidth + Math.random() * 10) + '%';
//                 progressText.textContent = 'Processing sections... ' + Math.round(currentWidth) + '% complete';
//                 setTimeout(simulateProgress, 2000);
//             }
//         }
//         document.getElementById('migrateBtn').addEventListener('click', () => {
//             setTimeout(simulateProgress, 1000);
//         });
//     </script>
// </body>
// </html>
//     `);
// });

// app.listen(PORT, () => {
//     console.log(`Server running on http://localhost:${PORT}`);
// });

// module.exports = app;

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { OpenAI } = require('openai');
const cheerio = require('cheerio');
const axios = require('axios');
const { z } = require('zod');
const { exec } = require('child_process');
const { promisify } = require('util');
const { JSDOM } = require('jsdom');
require('dotenv').config();

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let allSections = [];
let browserProcess = null;

// Widget elements to extract
const WIDGET_ELEMENTS = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'svg', 'img', 'image', 
    'video', 'span', 'button', 'a', 'text', 'wow-image', 'wix-video', 
    'wow-svg', 'wow-icon', 'wow-canvas'
];

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

async function extractWidgetsFromHtml(htmlContent, sectionIndex, outputDir) {
    try {
        const dom = new JSDOM(htmlContent);
        const document = dom.window.document;
        const widgets = {};
        let widgetCounter = 1;

        function processElement(element) {
            if (element.nodeType === 1) { // Element node
                const tagName = element.tagName.toLowerCase();
                
                if (WIDGET_ELEMENTS.includes(tagName)) {
                    const widgetKey = `{{widget-${widgetCounter}}}`;
                    widgets[widgetKey] = element.outerHTML;
                    
                    const placeholder = document.createTextNode(widgetKey);
                    element.parentNode.replaceChild(placeholder, element);
                    
                    widgetCounter++;
                } else {
                    const children = Array.from(element.childNodes);
                    children.forEach(child => processElement(child));
                }
            }
        }

        const body = document.body || document.documentElement;
        if (body) {
            const children = Array.from(body.childNodes);
            children.forEach(child => processElement(child));
        }

        const modifiedHtml = dom.serialize();
        const widgetsFile = `widgets_${sectionIndex}.json`;
        const htmlOutputFile = `widgets_extracted_${sectionIndex}.html`;

        await fs.writeFile(path.join(outputDir, widgetsFile), JSON.stringify(widgets, null, 2));
        await fs.writeFile(path.join(outputDir, htmlOutputFile), modifiedHtml);

        return {
            widgets,
            modifiedHtml,
            widgetsFile,
            htmlOutputFile
        };
    } catch (error) {
        console.error(`Error extracting widgets for section ${sectionIndex}:`, error);
        return {
            error: error.message,
            failed: true
        };
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

async function generateBareMinimumHtml(sectionIndex, widgetsHtmlInput, outputDir) {
  console.log(`\n🚀 Starting bare minimum HTML generation for section ${sectionIndex}`);
  console.log('='.repeat(60));
  
  // Step 1: Locate and read the widgets-extracted HTML file
  console.log(`🔍 Step 1: Locating widgets-extracted HTML for section ${sectionIndex}...`);
  const widgetsHtmlPath = path.join(outputDir, `widgets_extracted_${sectionIndex}.html`);
  
  if (!await fs.access(widgetsHtmlPath).then(() => true).catch(() => false)) {
    console.error('❌ Error: Widgets-extracted HTML file not found');
    throw new Error(`Widgets-extracted HTML file not found at ${widgetsHtmlPath}`);
  }

  const widgetsHtml = await fs.readFile(widgetsHtmlPath, 'utf8');
  console.log(`   ✅ Found widgets-extracted HTML (${widgetsHtml.length} bytes)`);
  console.log('   - File:', widgetsHtmlPath);

  // Step 2: Analyze HTML structure and extract IDs
  console.log('\n📊 Step 2: Analyzing HTML structure and extracting IDs...');
  const $ = cheerio.load(widgetsHtml);
  
  // Extract topmost div IDs (components that are not nested inside other components)
  const topLevelDivs = [];
  $('div[id]').each((index, element) => {
    const $element = $(element);
    const id = $element.attr('id');
    
    // Check if this div is not nested inside another div with an ID
    const parentWithId = $element.parents('div[id]').first();
    if (parentWithId.length === 0) {
      topLevelDivs.push({
        id: id,
        element: element,
        html: $.html($element)
      });
    }
  });

  // Extract bgLayers IDs
  const bgLayerDivs = [];
  $('div[id^="bgLayers"]').each((index, element) => {
    const $element = $(element);
    const id = $element.attr('id');
    bgLayerDivs.push({
      id: id,
      element: element,
      html: $.html($element)
    });
  });

  console.log(`   - Found ${topLevelDivs.length} top-level div IDs`);
  console.log(`   - Found ${bgLayerDivs.length} bgLayers div IDs`);

  // Step 3: Process each div with OpenAI and save to JSON
  console.log('\n🤖 Step 3: Processing divs with OpenAI...');
  const templates = {};
  const allDivs = [...topLevelDivs, ...bgLayerDivs];
  let processedCount = 0;

  const TIMEOUT = 180000; 

  for (const divData of allDivs) {
    const { id, html } = divData;
    processedCount++;
    const paddedIndex = processedCount.toString().padStart(4, '0');
    const templateKey = `template-${paddedIndex}`;
    
    console.log(`\n   🔧 Processing ${processedCount}/${allDivs.length}: ${id}`);
    console.log(`   - Original size: ${html.length} bytes`);

    try {
      console.log('   ⚙️  Sending to OpenAI for optimization...');
      const startTime = Date.now();
      
      // Send to OpenAI with timeout (process all components regardless of size)
      const optimizedHtml = await Promise.race([
        optimizeWithAI(html, id),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout after 60 seconds')), TIMEOUT)
        )
      ]);
      
      const duration = Date.now() - startTime;
      console.log(`   ⏱️  Completed in ${duration}ms`);
      
      // Store only the optimized HTML string
      templates[templateKey] = optimizedHtml;

      console.log(`   ✅ Optimized to ${optimizedHtml.length} bytes`);
      console.log(`   🔽 Reduction: ${Math.round((1 - (optimizedHtml.length / html.length)) * 100)}%`);
      
      // Replace the original div with the template placeholder
      $(divData.element).replaceWith(`{{${templateKey}}}`);
      
    } catch (error) {
      console.error(`   ❌ OpenAI processing failed: ${error.message}`);
      console.log('   ↪️  Skipping this component (no fallback to original)');
      
      // Option 1: Store an empty string (or error message)
      templates[templateKey] = '';
      // Option 2: You can also remove the placeholder entirely:
      // $(divData.element).remove();
      // Option 3: Or insert a visible error marker:
      // templates[templateKey] = `<div style="color:red;">Optimization failed: ${error.message}</div>`;

      // Still replace with template placeholder (so the pipeline continues)
      $(divData.element).replaceWith(`{{${templateKey}}}`);
    }
  }

  // Step 4: Generate final output
  console.log('\n✨ Step 4: Generating final output...');
  const bareHtml = $.html();
  const finalSize = bareHtml.length;
  const originalSize = widgetsHtml.length;
  const sizeReduction = Math.round((1 - (finalSize / originalSize)) * 100);
  
  console.log(`   - Original size: ${originalSize} bytes`);
  console.log(`   - Bare HTML size: ${finalSize} bytes`);
  console.log(`   - Total reduction: ${sizeReduction}%`);
  console.log(`   - Components processed: ${processedCount}`);

  // Step 5: Save files
  console.log('\n💾 Step 5: Saving files...');
  
  // Save bare minimum HTML with template placeholders
  const bareMinimumFile = `bareminimum_section_${sectionIndex}.html`;
  const bareMinimumPath = path.join(outputDir, bareMinimumFile);
  await fs.writeFile(bareMinimumPath, bareHtml);
  
  // Save templates JSON
  const bareMinimumJsonFile = `bareminimum_${sectionIndex}.json`;
  const bareMinimumJsonPath = path.join(outputDir, bareMinimumJsonFile);
  await fs.writeFile(bareMinimumJsonPath, JSON.stringify(templates, null, 2));
  
  console.log(`   ✅ Saved bare minimum HTML to: ${bareMinimumPath}`);
  console.log(`   ✅ Saved templates JSON to: ${bareMinimumJsonPath}`);
  
  console.log('\n🏁 Bare minimum HTML generation complete!');
  console.log('='.repeat(60));

  return {
    bareHtml,
    bareMinimumFile,
    bareMinimumJsonFile,
    templates,
    stats: {
      originalSize,
      finalSize,
      sizeReduction,
      componentsProcessed: processedCount,
      topLevelDivs: topLevelDivs.length,
      bgLayerDivs: bgLayerDivs.length
    }
  };
}
const OPTIMIZATION_PROMPT = `
You are a Wix HTML optimization expert. Carefully reduce this HTML while maintaining identical rendering.

STRICT RULES:
1. OUTPUT ONLY THE OPTIMIZED HTML
2. Merge nested divs with identical dimensions/positioning
3. Remove empty divs that only contain other divs
4. Preserve all data-* attributes and Wix classes
5. Combine style properties using shorthand
6. Keep all functional attributes (id, class)
7. Maintain pixel-perfect layout

CRITICAL: The output must render exactly the same as input.

EXAMPLE INPUT:
<div id="bgLayers_comp-lt8qhfaf" data-hook="bgLayers" data-motion-part="BG_LAYER comp-lt8qhfaf" class="MW5IZ" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px;">
  <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px;"></div>
  <div id="bgMedia_comp-lt8qhfaf" data-motion-part="BG_MEDIA comp-lt8qhfaf" class="VgO9Yg" style="height: 421px;"></div>
</div>

EXAMPLE OUTPUT:
<div id="bgLayers_comp-lt8qhfaf" data-hook="bgLayers" data-motion-part="BG_LAYER comp-lt8qhfaf" data-testid="colorUnderlay" class="MW5IZ LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:421px"></div>

EXAMPLE INPUT:
<div id="comp-irqduxcu" class="comp-irqduxcu YzqVZ wixui-column-strip__column" style="bottom: 0px; flex-basis: 0%; flex-grow: 325; height: 421px; left: 0px; min-height: auto; position: relative; right: 0px; top: 0px; width: 641.711px;">
  <div id="bgLayers_comp-irqduxcu" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxcu" class="MW5IZ" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px; width: 641.711px;">
    <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px; width: 641.711px;"></div>
    <div id="bgMedia_comp-irqduxcu" data-motion-part="BG_MEDIA comp-irqduxcu" class="VgO9Yg" style="height: 421px; width: 641.711px"></div>
  </div>
  <div data-mesh-id="comp-irqduxcuinlineContent" data-testid="inline-content" class="" style="bottom: 0px; height: 421px; left: 0px; position: relative; right: 0px; top: 0px; width: 641.711px;">
    <div data-mesh-id="comp-irqduxcuinlineContent-gridContainer" data-testid="mesh-container-content" style="display: grid; grid-template-columns: 641.711px; grid-template-rows: 150px 42.5px 228.5px; height: 421px; min-height: 421px; width: 641.711px;">
      <div id="comp-isejheta" class="comp-isejheta wixui-vector-image" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 2; grid-row-start: 1; height: 48px; left: 143px; min-height: auto; min-width: auto; position: relative; right: -143px; top: 0px; width: 50px;">
        <div data-testid="svgRoot-comp-isejheta" class="AKxYR5 VZMYf comp-isejheta" style="bottom: 0px; height: 48px; left: 0px; position: absolute; right: 0px; top: 0px; width: 50px;">
          {{template-1}}
        </div>
      </div>
      <div id="comp-irqduxd4" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxd4 wixui-rich-text" data-testid="richTextElement" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 3; grid-row-start: 2; height: 23.5px; left: 72px; min-height: auto; min-width: auto; position: relative; right: -72px; top: 0px; width: 193px;">
        {{template-2}}
      </div>
      <div id="comp-irqduxcy" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxcy wixui-rich-text" data-testid="richTextElement" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 4; grid-row-start: 3; height: 108.812px; left: 23px; min-height: auto; min-width: auto; position: relative; right: -23px; top: 0px; width: 288px;">
        {{template-3}}
      </div>
    </div>
  </div>
</div>

EXAMPLE OUTPUT:
<div id="comp-irqduxcu" data-mesh-id="comp-irqduxcuinlineContent-gridContainer" class="comp-irqduxcu YzqVZ wixui-column-strip__column MW5IZ LWbAav Kv1aVt VgO9Yg" style="bottom:0;flex-basis:0%;flex-grow:325;height:421px;left:0;min-height:auto;position:relative;right:0;top:0;width:641.711px;display:grid;grid-template-columns:641.711px;grid-template-rows:150px 42.5px 228.5px;min-height:421px">
<div id="bgLayers_comp-lt8qhfaf" data-hook="bgLayers" data-motion-part="BG_LAYER comp-lt8qhfaf" data-testid="colorUnderlay" class="MW5IZ LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:421px"></div>
<div id="comp-isejheta" data-testid="svgRoot-comp-isejheta" class="comp-isejheta wixui-vector-image AKxYR5 VZMYf" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:2;grid-row-start:1;height:48px;left:143px;min-height:auto;min-width:auto;position:relative;right:-143px;top:0;width:50px">{{template-1}}</div>
<div id="comp-irqduxd4" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxd4 wixui-rich-text" data-testid="richTextElement" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:3;grid-row-start:2;height:23.5px;left:72px;min-height:auto;min-width:auto;position:relative;right:-72px;top:0;width:193px">{{template-2}}</div>
<div id="comp-irqduxcy" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxcy wixui-rich-text" data-testid="richTextElement" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:4;grid-row-start:3;height:108.812px;left:23px;min-height:auto;min-width:auto;position:relative;right:-23px;top:0;width:288px">{{template-3}}</div>
</div>

EXAMPLE INPUT:
<div id="comp-irte5pmq" class="Vd6aQZ ignore-focus comp-irte5pmq" role="region" tabindex="-1" aria-label="Who are we" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 2; grid-row-start: 1; height: 90px; left: 0px; min-height: auto; min-width: auto; position: relative; right: 0px; top: 0px;">
  <div id="whoarewe"></div>
  {{template-10}}
</div>

EXAMPLE OUTPUT:
<div id="whoarewe" class="Vd6aQZ ignore-focus comp-irte5pmq" role="region" tabindex="-1" aria-label="Who are we" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:2;grid-row-start:1;height:90px;left:0;min-height:auto;min-width:auto;position:relative;right:0;top:0">{{template-10}}</div>

HTML TO OPTIMIZE:
`;

async function optimizeWithAI(html, divId) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const prompt = `${OPTIMIZATION_PROMPT}\n${html}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 8192,
    });

    const optimizedHtml = response.choices[0].message.content.trim();

    // Clean up any potential markdown formatting
    const cleanHtml = optimizedHtml
      .replace(/^```html\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return cleanHtml;

  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error(`OpenAI optimization failed: ${error.message}`);
  }
}

class WebsiteBuilder {
    constructor(outputDir) {
        this.outputDir = outputDir;
        this.templateFile = path.join(outputDir, 'bareminimum_section_0.html');
        this.data1File = path.join(outputDir, 'bareminimum_0.json');
        this.data2File = path.join(outputDir, 'widgets_0.json');
        this.currentHTML = '';
        this.data1 = {};
        this.data2 = {};
    }

    async loadData() {
        try {
            // Load data1 (bareminimum templates - template-nnnn format)
            const data1Content = await fs.readFile(this.data1File, 'utf8');
            this.data1 = JSON.parse(data1Content);

            // Load data2 (widgets - {{widget-n}} format keys with HTML values)
            const data2Content = await fs.readFile(this.data2File, 'utf8');
            this.data2 = JSON.parse(data2Content);

            console.log('Data loaded - Data1 keys:', Object.keys(this.data1));
            console.log('Data loaded - Data2 keys:', Object.keys(this.data2));
        } catch (error) {
            console.error('Error loading data:', error);
            throw error;
        }
    }

    processTemplates(content) {
        if (!content || typeof content !== 'string') return content;

        let processedContent = content;
        let hasReplacements = true;
        let iterations = 0;
        const maxIterations = 20; // Increased for nested templates

        while (hasReplacements && iterations < maxIterations) {
            hasReplacements = false;
            iterations++;

            // First pass: Replace {{template-nnnn}} patterns with data1 content
            const templateMatches = processedContent.match(/\{\{template-\d+\}\}/g);
            if (templateMatches) {
                for (const match of templateMatches) {
                    const templateId = match.replace(/[{}]/g, ''); // Remove braces to get "template-nnnn"
                    if (this.data1[templateId]) {
                        processedContent = processedContent.replace(match, this.data1[templateId]);
                        hasReplacements = true;
                        console.log(`Replaced ${match} with data1[${templateId}]`);
                    }
                }
            }

            // Second pass: Replace {{widget-n}} patterns with data2 content
            const widgetMatches = processedContent.match(/\{\{widget-\d+\}\}/g);
            if (widgetMatches) {
                for (const match of widgetMatches) {
                    // The key in data2 already includes the braces
                    if (this.data2[match]) {
                        processedContent = processedContent.replace(match, this.data2[match]);
                        hasReplacements = true;
                        console.log(`Replaced ${match} with data2 content`);
                    }
                }
            }

            // Third pass: Handle any other placeholder patterns that might exist
            // This catches any remaining {{...}} patterns
            const otherMatches = processedContent.match(/\{\{[^}]+\}\}/g);
            if (otherMatches) {
                for (const match of otherMatches) {
                    // Check if it exists as-is in data2 (for cases like {{widget-1}})
                    if (this.data2[match]) {
                        processedContent = processedContent.replace(match, this.data2[match]);
                        hasReplacements = true;
                        console.log(`Replaced ${match} with data2 content (direct match)`);
                    }
                    // Check if removing braces gives us a data1 key
                    else {
                        const withoutBraces = match.replace(/[{}]/g, '');
                        if (this.data1[withoutBraces]) {
                            processedContent = processedContent.replace(match, this.data1[withoutBraces]);
                            hasReplacements = true;
                            console.log(`Replaced ${match} with data1[${withoutBraces}]`);
                        }
                    }
                }
            }
        }

        if (iterations >= maxIterations) {
            console.warn('Maximum iterations reached. Some templates may not have been processed.');
        }

        return processedContent;
    }

    // Helper method to clean up HTML and fix common issues
    cleanupHTML(html) {
        // Fix any malformed attributes or common HTML issues
        let cleaned = html;
        
        // Ensure proper spacing around attributes
        cleaned = cleaned.replace(/(\w+)=([^"'\s>]+)/g, '$1="$2"');
        
        // Fix any double-encoded quotes if they exist
        cleaned = cleaned.replace(/&quot;/g, '"');
        
        return cleaned;
    }

    // Method to validate the final HTML
    validatePlaceholders(html) {
        const remainingPlaceholders = html.match(/\{\{[^}]+\}\}/g);
        if (remainingPlaceholders) {
            console.warn('Warning: The following placeholders were not replaced:', remainingPlaceholders);
            return false;
        }
        return true;
    }

    async buildWebsite() {
        try {
            await this.loadData();
            
            // Read template file
            console.log('Reading template file:', this.templateFile);
            const templateContent = await fs.readFile(this.templateFile, 'utf8');
            console.log('Template content length:', templateContent.length);
            
            // Process templates recursively
            console.log('Processing templates...');
            let finalHtml = this.processTemplates(templateContent);
            
            // Clean up the HTML
            finalHtml = this.cleanupHTML(finalHtml);
            
            // Validate that all placeholders were replaced
            const isValid = this.validatePlaceholders(finalHtml);
            if (!isValid) {
                console.warn('Some placeholders remain unreplaced in the final HTML');
            }
            
            this.currentHTML = finalHtml;
            console.log('Website build completed. Final HTML length:', finalHtml.length);
            
            return finalHtml;
        } catch (error) {
            console.error('Build failed:', error);
            throw error;
        }
    }

    // Helper method to save the built HTML to a file
    async saveToFile(filename = 'output.html') {
        if (!this.currentHTML) {
            throw new Error('No HTML content to save. Run buildWebsite() first.');
        }
        
        const outputPath = path.join(this.outputDir, filename);
        await fs.writeFile(outputPath, this.currentHTML, 'utf8');
        console.log('HTML saved to:', outputPath);
        return outputPath;
    }

    // Method to get statistics about the build process
    getStats() {
        return {
            data1Templates: Object.keys(this.data1).length,
            data2Widgets: Object.keys(this.data2).length,
            finalHTMLLength: this.currentHTML.length,
            hasUnreplacedPlaceholders: !this.validatePlaceholders(this.currentHTML)
        };
    }
}

async function assembleFinalWebsite(sectionIndex, outputDir) {
    console.log(`   🏗️ Step 4: Processing section ${sectionIndex}...`);
    
    try {
        const builder = new WebsiteBuilder(outputDir);
        
        // Set the input files dynamically
        builder.templateFile = path.join(outputDir, `bareminimum_section_${sectionIndex}.html`);
        builder.data1File = path.join(outputDir, `bareminimum_${sectionIndex}.json`);
        builder.data2File = path.join(outputDir, `widgets_${sectionIndex}.json`);
        
        const finalHtml = await builder.buildWebsite();
        
        // Store the section HTML in memory
        const sectionData = {
            index: sectionIndex,
            html: finalHtml,
            completed: true
        };
        allSections.push(sectionData);
        
        console.log(`   ✅ Section ${sectionIndex} processed`);
        
        // Update the browser display after each section
        await updateBrowserDisplay(outputDir, sectionIndex === 0); // Open browser for first section
        
        return {
            finalHtml,
            finalFile: null
        };
        
    } catch (error) {
        console.error('❌ Section processing failed:', error.message);
        throw error;
    }
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
        
        // Step 1: Process inline layout styles
        const step1Result = await styleProcessor.processHtml(sectionHtml, computedData, outputDir, section.index);
        
        // Step 2: Extract widgets from the HTML (now step 2 instead of step 3)
        const step2Result = await extractWidgetsFromHtml(step1Result.styledHtml, section.index, outputDir);
        
        // Step 3: Generate bare minimum HTML (now step 3 instead of step 2)
        const step3Result = await generateBareMinimumHtml(section.index, step2Result.modifiedHtml, outputDir);
        
        // Step 4: Assemble final website
        const step4Result = await assembleFinalWebsite(section.index, outputDir);
        
        const sectionData = {
            index: section.index,
            html: step4Result.finalHtml,
            completed: true,
            widgets: step2Result.widgets || {}
        };
        
        allSections.push(sectionData);
        processedSections.push({
            index: section.index,
            sectionKey: Object.keys(computedData)[0] || `section_${section.index}`,
            files: {
                original: section.htmlFile,
                computed: section.computedFile,
                layoutInline: step1Result.layoutInlineFile,
                bareMinimum: step3Result.bareMinimumFile,
                widgets: step2Result.widgetsFile,
                widgetsHtml: step2Result.htmlOutputFile,
                final: step4Result.finalFile
            },
            stats: {
                originalSize: sectionHtml.length,
                finalSize: step4Result.finalHtml.length,
                compressionRatio: ((sectionHtml.length - step4Result.finalHtml.length) / sectionHtml.length * 100).toFixed(1) + '%',
                widgetsExtracted: step2Result.widgets ? Object.keys(step2Result.widgets).length : 0
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
async function updateBrowserDisplay(outputDir, shouldOpenBrowser = false) {
    if (allSections.length === 0) {
        console.log('No sections to display');
        return;
    }

    // Use a Set to track unique section indices and prevent duplicates
    const uniqueSections = new Map();
    
    // Filter out duplicates based on section index
    allSections.forEach(section => {
        if (!uniqueSections.has(section.index)) {
            uniqueSections.set(section.index, section);
        } else {
            // Keep the most recent version (assuming later ones are updates)
            const existing = uniqueSections.get(section.index);
            if (section.completed && !existing.completed) {
                uniqueSections.set(section.index, section);
            }
        }
    });

    // Convert back to array and sort by index for consistent ordering
    const sectionsToDisplay = Array.from(uniqueSections.values())
        .sort((a, b) => a.index - b.index);

    // Create HTML with unique sections only - no containers, full screen optimization
    const completeHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Migrated Website Sections</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { 
            width: 100%; 
            height: 100%; 
            overflow-x: auto; 
        }
    </style>
    <script>
        // Auto-refresh every 10 seconds
        setTimeout(() => {
            window.location.reload();
        }, 10000);
    </script>
</head>
<body>
    ${sectionsToDisplay.map(section => section.html).join('\n')}
</body>
</html>
    `;

    // Save to temporary file with timestamp to help with caching issues
    const tempFile = path.join(outputDir, 'all_sections.html');
    await fs.writeFile(tempFile, completeHtml);
    
    const fullPath = path.resolve(tempFile);
    const fileUrl = `file://${fullPath}?t=${Date.now()}`; // Add timestamp to prevent caching
    
    if (shouldOpenBrowser || !browserProcess) {
        // Open browser for first section or if not already open
        const platform = process.platform;
        let command;
        
        if (platform === 'win32') {
            command = `start "" "${fileUrl}"`;
        } else if (platform === 'darwin') {
            command = `open "${fileUrl}"`;
        } else {
            command = `xdg-open "${fileUrl}"`;
        }
        
        try {
            browserProcess = await execPromise(command);
            console.log(`✅ Browser opened with ${sectionsToDisplay.length} unique HTML sections (full screen)`);
        } catch (error) {
            console.log(`✅ Sections available at: ${fileUrl}`);
            console.log(`ℹ️ Could not automatically open browser: ${error.message}`);
        }
    } else {
        console.log(`✅ HTML updated with ${sectionsToDisplay.length} unique sections (auto-refresh in 10s)`);
    }
    
    // Debug logging to help identify duplication issues
    if (allSections.length !== sectionsToDisplay.length) {
        console.log(`ℹ️ Filtered ${allSections.length - sectionsToDisplay.length} duplicate sections`);
    }
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
            widgets: files.filter(f => f.startsWith('widgets_')),
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
        <div class="step">Step 3: Extract widgets from HTML</div>
        <div class="step">Step 4: Generate optimized HTML</div>
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
                        'Widgets': data.categories.widgets,
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