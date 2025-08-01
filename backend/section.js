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



// async function generateBareMinimumHtml(sectionIndex, widgetsHtmlInput, outputDir) {
//   console.log(`\n🚀 Starting bare minimum HTML generation for section ${sectionIndex}`);
//   console.log('='.repeat(60));
  
//   // Step 1: Locate and read the widgets-extracted HTML file
//   console.log(`🔍 Step 1: Locating widgets-extracted HTML for section ${sectionIndex}...`);
//   const widgetsHtmlPath = path.join(outputDir, `widgets_extracted_${sectionIndex}.html`);
  
//   if (!await fs.access(widgetsHtmlPath).then(() => true).catch(() => false)) {
//     console.error('❌ Error: Widgets-extracted HTML file not found');
//     throw new Error(`Widgets-extracted HTML file not found at ${widgetsHtmlPath}`);
//   }

//   const widgetsHtml = await fs.readFile(widgetsHtmlPath, 'utf8');
//   console.log(`   ✅ Found widgets-extracted HTML (${widgetsHtml.length} bytes)`);
//   console.log('   - File:', widgetsHtmlPath);

//   // Step 2: Extract ALL bgLayers divs and send to AI
//   console.log('\n🎨 Step 2: Extracting and processing ALL bgLayers divs...');
//   const $ = cheerio.load(widgetsHtml);
  
//   // Find all bgLayers divs
//   const bgLayerDivs = [];
//   $('div[id^="bgLayers"]').each((index, element) => {
//     const $element = $(element);
//     const id = $element.attr('id');
//     bgLayerDivs.push({
//       id: id,
//       element: element,
//       html: $.html($element)
//     });
//   });

//   console.log(`   - Found ${bgLayerDivs.length} bgLayers divs to process`);

//   // Process ALL bgLayers with OpenAI
//   const bgTemplates = {};
//   const TIMEOUT = 180000;

//   for (let i = 0; i < bgLayerDivs.length; i++) {
//     const divData = bgLayerDivs[i];
//     const { id, html } = divData;
    
//     console.log(`\n   🔧 Processing bgLayers ${i + 1}/${bgLayerDivs.length}: ${id}`);
//     console.log(`   - Original size: ${html.length} bytes`);

//     try {
//       console.log('   ⚙️  Sending bgLayers to OpenAI for bare minimum...');
//       const startTime = Date.now();
      
//       const optimizedHtml = await Promise.race([
//         optimizeWithAI(html, id),
//         new Promise((_, reject) => 
//           setTimeout(() => reject(new Error('Timeout after 180 seconds')), TIMEOUT)
//         )
//       ]);
      
//       const duration = Date.now() - startTime;
//       console.log(`   ⏱️  Completed in ${duration}ms`);
      
//       // Store optimized HTML with bg-01, bg-02 format
//       const bgKey = `bg-${String(i + 1).padStart(2, '0')}`;
//       bgTemplates[`{{${bgKey}}}`] = optimizedHtml;

//       console.log(`   ✅ Optimized to ${optimizedHtml.length} bytes`);
//       console.log(`   🔽 Reduction: ${Math.round((1 - (optimizedHtml.length / html.length)) * 100)}%`);
      
//       // Replace the original bgLayers div with placeholder
//       $(divData.element).replaceWith(`{{${bgKey}}}`);
      
//     } catch (error) {
//       console.error(`   ❌ OpenAI processing failed for ${id}: ${error.message}`);
//       console.log('   ↪️  Using empty placeholder for this bgLayers');
      
//       const bgKey = `bg-${String(i + 1).padStart(2, '0')}`;
//       bgTemplates[`{{${bgKey}}}`] = '';
//       $(divData.element).replaceWith(`{{${bgKey}}}`);
//     }
//   }

//   // Step 3: Save bgLayers JSON and HTML with bgLayers placeholders
//   console.log('\n💾 Step 3: Saving bgLayers results and intermediate HTML...');
  
//   // Save bgLayers JSON
//   const bgJsonFile = `bg_${sectionIndex}.json`;
//   const bgJsonPath = path.join(outputDir, bgJsonFile);
//   await fs.writeFile(bgJsonPath, JSON.stringify(bgTemplates, null, 2));
//   console.log(`   ✅ Saved bgLayers JSON to: ${bgJsonPath}`);

//   // Save HTML with bgLayers placeholders
//   const htmlWithBgPlaceholders = $.html();
//   const bgPlaceholderHtmlFile = `bg_placeholder_${sectionIndex}.html`;
//   const bgPlaceholderHtmlPath = path.join(outputDir, bgPlaceholderHtmlFile);
//   await fs.writeFile(bgPlaceholderHtmlPath, htmlWithBgPlaceholders);
//   console.log(`   ✅ Saved HTML with bgLayers placeholders to: ${bgPlaceholderHtmlPath}`);

//   // Step 4: Load the saved HTML and extract top-most divs
//   console.log('\n📊 Step 4: Loading saved HTML and extracting top-most divs...');
  
//   // Read the saved HTML file with bgLayers placeholders
//   const savedHtml = await fs.readFile(bgPlaceholderHtmlPath, 'utf8');
//   const $saved = cheerio.load(savedHtml);
  
//   // Extract top-most div IDs (divs that are not nested inside other divs with IDs)
//   const topMostDivs = [];
//   $saved('div[id]').each((index, element) => {
//     const $element = $saved(element);
//     const id = $element.attr('id');
    
//     // Skip if this is a bgLayers placeholder or contains only placeholder content
//     if (id && !id.startsWith('bgLayers')) {
//       // Check if this div is not nested inside another div with an ID
//       const parentWithId = $element.parents('div[id]').first();
//       if (parentWithId.length === 0) {
//         topMostDivs.push({
//           id: id,
//           element: element,
//           html: $saved.html($element)
//         });
//       }
//     }
//   });

//   console.log(`   - Found ${topMostDivs.length} top-most divs to process`);

//   // Step 5: Send top-most divs to AI for bare minimum
//   console.log('\n🤖 Step 5: Processing top-most divs with OpenAI...');
  
//   const componentTemplates = {};
//   let processedCount = 0;

//   for (const divData of topMostDivs) {
//     const { id, html } = divData;
//     processedCount++;
    
//     console.log(`\n   🔧 Processing top-most div ${processedCount}/${topMostDivs.length}: ${id}`);
//     console.log(`   - Original size: ${html.length} bytes`);

//     try {
//       console.log('   ⚙️  Sending top-most div to OpenAI for bare minimum...');
//       const startTime = Date.now();
      
//       const optimizedHtml = await Promise.race([
//         optimizeWithAI(html, id),
//         new Promise((_, reject) => 
//           setTimeout(() => reject(new Error('Timeout after 180 seconds')), TIMEOUT)
//         )
//       ]);
      
//       const duration = Date.now() - startTime;
//       console.log(`   ⏱️  Completed in ${duration}ms`);
      
//       // Store optimized HTML with template-2000+ format
//       const templateKey = `template-${String(2000 + processedCount).padStart(4, '0')}`;
//       componentTemplates[`{{${templateKey}}}`] = optimizedHtml;

//       console.log(`   ✅ Optimized to ${optimizedHtml.length} bytes`);
//       console.log(`   🔽 Reduction: ${Math.round((1 - (optimizedHtml.length / html.length)) * 100)}%`);
      
//       // Replace the original div with component placeholder
//       $saved(divData.element).replaceWith(`{{${templateKey}}}`);
      
//     } catch (error) {
//       console.error(`   ❌ OpenAI processing failed for ${id}: ${error.message}`);
//       console.log('   ↪️  Using empty placeholder for this component');
      
//       const templateKey = `template-${String(2000 + processedCount).padStart(4, '0')}`;
//       componentTemplates[`{{${templateKey}}}`] = '';
//       $saved(divData.element).replaceWith(`{{${templateKey}}}`);
//     }
//   }

//   // Step 6: Generate final bare minimum HTML
//   console.log('\n✨ Step 6: Generating final bare minimum HTML...');
//   const finalBareHtml = $saved.html();
//   const finalSize = finalBareHtml.length;
//   const originalSize = widgetsHtml.length;
//   const sizeReduction = Math.round((1 - (finalSize / originalSize)) * 100);
  
//   console.log(`   - Original size: ${originalSize} bytes`);
//   console.log(`   - Final bare HTML size: ${finalSize} bytes`);
//   console.log(`   - Total reduction: ${sizeReduction}%`);
//   console.log(`   - bgLayers processed: ${bgLayerDivs.length}`);
//   console.log(`   - Top-most divs processed: ${processedCount}`);

//   // Step 7: Save final files
//   console.log('\n💾 Step 7: Saving final files...');
  
//   // Save final bare minimum HTML with all placeholders
//   const bareMinimumFile = `bareminimum_section_${sectionIndex}.html`;
//   const bareMinimumPath = path.join(outputDir, bareMinimumFile);
//   await fs.writeFile(bareMinimumPath, finalBareHtml);
  
//   // Save components JSON as bareminimum_0.json
//   const componentsJsonFile = `bareminimum_${sectionIndex}.json`;
//   const componentsJsonPath = path.join(outputDir, componentsJsonFile);
//   await fs.writeFile(componentsJsonPath, JSON.stringify(componentTemplates, null, 2));
  
//   console.log(`   ✅ Saved final bare minimum HTML to: ${bareMinimumPath}`);
//   console.log(`   ✅ Saved components JSON to: ${componentsJsonPath}`);
  
//   console.log('\n🏁 Bare minimum HTML generation complete!');
//   console.log('='.repeat(60));

//   return {
//     bareHtml: finalBareHtml,
//     bareMinimumFile,
//     bgJsonFile,
//     componentsJsonFile,
//     bgPlaceholderHtmlFile,
//     bgTemplates,
//     componentTemplates,
//     stats: {
//       originalSize,
//       finalSize,
//       sizeReduction,
//       bgLayersProcessed: bgLayerDivs.length,
//       topMostDivsProcessed: processedCount,
//       totalComponentsProcessed: bgLayerDivs.length + processedCount
//     }
//   };
// }

// const OPTIMIZATION_PROMPT = `
// You are a Wix HTML optimization expert. Carefully reduce this HTML while maintaining identical rendering.

// STRICT RULES:
// 1. OUTPUT ONLY THE OPTIMIZED HTML
// 2. Merge nested divs with identical dimensions/positioning
// 3. Remove empty divs that only contain other divs
// 4. Preserve all data-* attributes and Wix classes
// 5. Combine style properties using shorthand
// 6. Keep all functional attributes (id, class)
// 7. Maintain pixel-perfect layout

// CRITICAL: The output must render exactly the same as input.

// BGLAYERS EXAMPLE INPUT:
// <div id="bgLayers_comp-lt8qhfaf" data-hook="bgLayers" data-motion-part="BG_LAYER comp-lt8qhfaf" class="MW5IZ" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px;">
//   <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px;"></div>
//   <div id="bgMedia_comp-lt8qhfaf" data-motion-part="BG_MEDIA comp-lt8qhfaf" class="VgO9Yg" style="height: 421px;"></div>
// </div>

// BGLAYERS EXAMPLE OUTPUT:
// <div id="bgLayers_comp-lt8qhfaf" data-hook="bgLayers" data-motion-part="BG_LAYER comp-lt8qhfaf" data-testid="colorUnderlay" class="MW5IZ LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:421px"></div>

// COMPLEX BGLAYERS EXAMPLE INPUT:
// <div id="bgLayers_comp-irqduxf8" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxf8" class="MW5IWV" style="block-size: 881px; bottom: 0; height: 881px; inset: 0; position: absolute; right: 0; top: 0; transform-origin: 967.5px 440.5px; overflow: clip;">
//   <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="background-color: rgb(6, 21, 81); block-size: 881px; bottom: 0; height: 881px; inset: 0; position: absolute; right: 0; top: 0; transform-origin: 967.5px 440.5px;"></div>
//   <div id="bgMedia_comp-irqduxf8" data-motion-part="BG_MEDIA comp-irqduxf8" class="VgO9Yg" style="block-size: 3079px; height: 3079px; isolation: isolate; margin-block-start: -1099px; margin-top: -1099px; transform-origin: 967.5px 1539.5px;">{{widget-1}}</div>
// </div>

// COMPLEX BGLAYERS EXAMPLE OUTPUT:
// <div id="bgLayers_comp-irqduxf8" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxf8" data-testid="colorUnderlay" class="MW5IWV LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:881px;background-color:rgb(6,21,81);overflow:clip;transform-origin:967.5px 440.5px">{{widget-1}}</div>

// TOP-MOST DIV EXAMPLE INPUT:
// <div id="comp-irqduxcu" class="comp-irqduxcu YzqVZ wixui-column-strip__column" style="bottom: 0px; flex-basis: 0%; flex-grow: 325; height: 421px; left: 0px; min-height: auto; position: relative; right: 0px; top: 0px; width: 641.711px;">
//   <div id="bgLayers_comp-irqduxcu" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxcu" class="MW5IZ" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px; width: 641.711px;">
//     <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px; width: 641.711px;"></div>
//     <div id="bgMedia_comp-irqduxcu" data-motion-part="BG_MEDIA comp-irqduxcu" class="VgO9Yg" style="height: 421px; width: 641.711px"></div>
//   </div>
//   <div data-mesh-id="comp-irqduxcuinlineContent" data-testid="inline-content" class="" style="bottom: 0px; height: 421px; left: 0px; position: relative; right: 0px; top: 0px; width: 641.711px;">
//     <div data-mesh-id="comp-irqduxcuinlineContent-gridContainer" data-testid="mesh-container-content" style="display: grid; grid-template-columns: 641.711px; grid-template-rows: 150px 42.5px 228.5px; height: 421px; min-height: 421px; width: 641.711px;">
//       <div id="comp-isejheta" class="comp-isejheta wixui-vector-image" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 2; grid-row-start: 1; height: 48px; left: 143px; min-height: auto; min-width: auto; position: relative; right: -143px; top: 0px; width: 50px;">
//         <div data-testid="svgRoot-comp-isejheta" class="AKxYR5 VZMYf comp-isejheta" style="bottom: 0px; height: 48px; left: 0px; position: absolute; right: 0px; top: 0px; width: 50px;">
//           {{template-2001}}
//         </div>
//       </div>
//       <div id="comp-irqduxd4" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxd4 wixui-rich-text" data-testid="richTextElement" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 3; grid-row-start: 2; height: 23.5px; left: 72px; min-height: auto; min-width: auto; position: relative; right: -72px; top: 0px; width: 193px;">
//         {{template-2002}}
//       </div>
//       <div id="comp-irqduxcy" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxcy wixui-rich-text" data-testid="richTextElement" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 4; grid-row-start: 3; height: 108.812px; left: 23px; min-height: auto; min-width: auto; position: relative; right: -23px; top: 0px; width: 288px;">
//         {{template-2003}}
//       </div>
//     </div>
//   </div>
// </div>

// TOP-MOST DIV EXAMPLE OUTPUT:
// <div id="comp-irqduxcu" data-mesh-id="comp-irqduxcuinlineContent-gridContainer" class="comp-irqduxcu YzqVZ wixui-column-strip__column" style="bottom:0;flex-basis:0%;flex-grow:325;height:421px;left:0;min-height:auto;position:relative;right:0;top:0;width:641.711px;display:grid;grid-template-columns:641.711px;grid-template-rows:150px 42.5px 228.5px;min-height:421px">
// {{bg-01}}
// <div id="comp-isejheta" data-testid="svgRoot-comp-isejheta" class="comp-isejheta wixui-vector-image AKxYR5 VZMYf" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:2;grid-row-start:1;height:48px;left:143px;min-height:auto;min-width:auto;position:relative;right:-143px;top:0;width:50px">{{template-2001}}</div>
// <div id="comp-irqduxd4" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxd4 wixui-rich-text" data-testid="richTextElement" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:3;grid-row-start:2;height:23.5px;left:72px;min-height:auto;min-width:auto;position:relative;right:-72px;top:0;width:193px">{{template-2002}}</div>
// <div id="comp-irqduxcy" class="HcOXKn SxM0TO QxJLC3 lq2cno YQcXTT comp-irqduxcy wixui-rich-text" data-testid="richTextElement" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:4;grid-row-start:3;height:108.812px;left:23px;min-height:auto;min-width:auto;position:relative;right:-23px;top:0;width:288px">{{template-2003}}</div>
// </div>

// ANOTHER TOP-MOST DIV EXAMPLE INPUT:
// <div id="comp-irte5pmq" class="Vd6aQZ ignore-focus comp-irte5pmq" role="region" tabindex="-1" aria-label="Who are we" style="align-self: start; bottom: 0px; grid-column-end: 2; grid-column-start: 1; grid-row-end: 2; grid-row-start: 1; height: 90px; left: 0px; min-height: auto; min-width: auto; position: relative; right: 0px; top: 0px;">
//   <div id="whoarewe"></div>
//   {{template-2010}}
// </div>

// ANOTHER TOP-MOST DIV EXAMPLE OUTPUT:
// <div id="whoarewe" class="Vd6aQZ ignore-focus comp-irte5pmq" role="region" tabindex="-1" aria-label="Who are we" style="align-self:start;bottom:0;grid-column-end:2;grid-column-start:1;grid-row-end:2;grid-row-start:1;height:90px;left:0;min-height:auto;min-width:auto;position:relative;right:0;top:0">{{template-2010}}</div>

// HTML TO OPTIMIZE:
// `;



// BGLAYERS SPECIFIC OPTIMIZATION PROMPT