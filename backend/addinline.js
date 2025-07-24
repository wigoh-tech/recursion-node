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

// Initialize OpenAI with API key from environment
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Global variable to hold all sections
let allSections = [];
let browserProcess = null;

// === INITIAL PREPARATION STEPS ===

// Step 1: Extract individual sections from raw.html
async function extractAndSaveSections(rawHtmlContent, computedStyles, outputDir) {
  console.log('🔍 Extracting and saving sections...');
  
  // Create directories for output
  await fs.mkdir(path.join(outputDir, 'sections'), { recursive: true });
  
  // Process HTML to find sections
  const $ = cheerio.load(rawHtmlContent);
  const htmlSections = $('body > section, html > section').toArray();
  const sections = htmlSections.length > 0 
    ? htmlSections 
    : $('section').filter((i, el) => $(el).parents('section').length === 0).toArray();
  
  console.log(`   Found ${sections.length} sections`);
  
  const sectionFiles = [];
  const computedKeys = Object.keys(computedStyles);
  
  for (let i = 0; i < sections.length; i++) {
    const $section = $(sections[i]);
    const sectionHtml = $.html($section);
    const sectionId = $section.attr('id') || `section_${i}`;
    
    // Find matching computed styles
    let computedSection = null;
    for (const key of computedKeys) {
      if (key.includes(sectionId) || computedStyles[key]?.id === sectionId) {
        computedSection = computedStyles[key];
        break;
      }
    }
    
    // Fallback to index-based matching if no ID match
    if (!computedSection && computedKeys[i]) {
      computedSection = computedStyles[computedKeys[i]];
    }
    
    // Save HTML section
    const htmlFilename = `sections/section_${i}.html`;
    await fs.writeFile(path.join(outputDir, htmlFilename), sectionHtml);
    
    // Save computed styles section
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
    
    console.log(`   ✅ Saved section ${i} (${sectionId})`);
  }
  
  return sectionFiles;
}

class CleanHtmlStyleProcessor {
    constructor() {
        this.unmatchedElements = [];
    }

    // Convert camelCase to kebab-case for CSS properties
    camelToKebab(str) {
        return str.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    // Convert style object to CSS string with proper formatting
    styleObjectToString(styleObj) {
        return Object.entries(styleObj)
            .map(([key, value]) => {
                const cssKey = this.camelToKebab(key);
                // Ensure proper CSS value formatting
                let cssValue = String(value).trim();
                
                // Add units if needed for numeric values
                if (!isNaN(cssValue) && cssValue !== '' && cssValue !== '0') {
                    if (['width', 'height', 'margin', 'padding', 'top', 'left', 'right', 'bottom', 
                         'font-size', 'line-height', 'border-radius'].some(prop => cssKey.includes(prop))) {
                        cssValue = cssValue + (cssValue.includes('%') ? '' : 'px');
                    }
                }
                
                return `${cssKey}: ${cssValue}`;
            })
            .join('; ');
    }

    // Helper function to safely convert value to string and trim
    safeStringTrim(value) {
        if (value === null || value === undefined) {
            return '';
        }
        
        if (Array.isArray(value)) {
            return value.join(' ').trim();
        }
        
        return String(value).trim();
    }

    // Extract attributes from HTML string
    extractAttributesFromHtml(htmlString) {
        if (!htmlString) return {};
        
        try {
            // Try with cheerio first
            const $ = cheerio.load(htmlString);
            const element = $.root().children().first();
            
            const attributes = {};
            
            if (element.length > 0) {
                const attrs = element.get(0).attribs || {};
                
                // Extract common attributes
                if (attrs.id) attributes.id = attrs.id;
                if (attrs.class) attributes.className = attrs.class;
                if (attrs['data-mesh-id']) attributes.dataMeshId = attrs['data-mesh-id'];
                if (attrs['data-testid']) attributes.dataTestId = attrs['data-testid'];
                if (attrs['data-test-id']) attributes.dataTestId = attrs['data-test-id'];
                
                console.log(`   🔍 Cheerio extracted attributes:`, attributes);
            }
            
            // Fallback: regex-based extraction if cheerio fails
            if (Object.keys(attributes).length === 0) {
                console.log(`   🔄 Trying regex fallback for HTML: ${htmlString.substring(0, 100)}...`);
                
                // Extract data-mesh-id
                const meshIdMatch = htmlString.match(/data-mesh-id=["']([^"']+)["']/);
                if (meshIdMatch) {
                    attributes.dataMeshId = meshIdMatch[1];
                    console.log(`   ✓ Regex found dataMeshId: ${attributes.dataMeshId}`);
                }
                
                // Extract data-testid
                const testIdMatch = htmlString.match(/data-testid=["']([^"']+)["']/);
                if (testIdMatch) {
                    attributes.dataTestId = testIdMatch[1];
                    console.log(`   ✓ Regex found dataTestId: ${attributes.dataTestId}`);
                }
                
                // Extract id
                const idMatch = htmlString.match(/\sid=["']([^"']+)["']/);
                if (idMatch) {
                    attributes.id = idMatch[1];
                    console.log(`   ✓ Regex found id: ${attributes.id}`);
                }
                
                // Extract class
                const classMatch = htmlString.match(/class=["']([^"']*)["']/);
                if (classMatch && classMatch[1].trim()) {
                    attributes.className = classMatch[1];
                    console.log(`   ✓ Regex found className: ${attributes.className}`);
                }
            }
            
            return attributes;
        } catch (error) {
            console.log(`   Error extracting HTML attributes: ${error.message}`);
            return {};
        }
    }

    // Enhanced element data extraction with HTML fallback
    enrichElementData(element) {
        // Start with existing data
        const enriched = {
            id: this.safeStringTrim(element.id || element.elementId || element.compId),
            className: this.safeStringTrim(element.className || element.class || element.cssClass),
            dataTestId: this.safeStringTrim(element.dataTestId || element['data-test-id'] || element.testId || element['data-testid']),
            dataMeshId: this.safeStringTrim(element.dataMeshId || element['data-mesh-id'] || element.meshId),
            styles: element.styles || element.style || element.css || {},
            html: this.safeStringTrim(element.html || element.innerHTML || element.outerHTML),
            path: element.path || ''
        };

        console.log(`   📋 Initial element data:`);
        console.log(`   - ID: "${enriched.id}"`);
        console.log(`   - ClassName: "${enriched.className}"`);
        console.log(`   - DataMeshId: "${enriched.dataMeshId}"`);
        console.log(`   - DataTestId: "${enriched.dataTestId}"`);
        console.log(`   - HTML: ${enriched.html ? `"${enriched.html.substring(0, 100)}..."` : 'none'}`);

        // If we have HTML, ALWAYS try to extract attributes (even if some exist)
        if (enriched.html) {
            console.log(`   🔍 Extracting attributes from HTML...`);
            const htmlAttrs = this.extractAttributesFromHtml(enriched.html);
            
            // Update missing attributes with extracted ones
            if (!enriched.id && htmlAttrs.id) {
                enriched.id = htmlAttrs.id;
                console.log(`   ✅ Updated ID from HTML: ${enriched.id}`);
            }
            if (!enriched.className && htmlAttrs.className) {
                enriched.className = htmlAttrs.className;
                console.log(`   ✅ Updated className from HTML: ${enriched.className}`);
            }
            if (!enriched.dataMeshId && htmlAttrs.dataMeshId) {
                enriched.dataMeshId = htmlAttrs.dataMeshId;
                console.log(`   ✅ Updated dataMeshId from HTML: ${enriched.dataMeshId}`);
            }
            if (!enriched.dataTestId && htmlAttrs.dataTestId) {
                enriched.dataTestId = htmlAttrs.dataTestId;
                console.log(`   ✅ Updated dataTestId from HTML: ${enriched.dataTestId}`);
            }
        }

        console.log(`   📋 Final enriched element data:`);
        console.log(`   - ID: "${enriched.id}"`);
        console.log(`   - ClassName: "${enriched.className}"`);
        console.log(`   - DataMeshId: "${enriched.dataMeshId}"`);
        console.log(`   - DataTestId: "${enriched.dataTestId}"`);

        return enriched;
    }

    // Extract unique characteristics from HTML string
    extractHtmlCharacteristics(htmlString) {
        if (!htmlString) return null;
        
        try {
            const $ = cheerio.load(htmlString);
            const element = $.root().children().first();
            
            if (element.length === 0) return null;
            
            const characteristics = {
                tagName: element.get(0).tagName.toLowerCase(),
                attributes: {},
                textContent: element.text().trim(),
                innerHTML: element.html(),
                hasChildren: element.children().length > 0,
                childCount: element.children().length
            };
            
            // Extract all attributes
            const attrs = element.get(0).attribs || {};
            Object.keys(attrs).forEach(attr => {
                characteristics.attributes[attr] = attrs[attr];
            });
            
            return characteristics;
        } catch (error) {
            console.log(`   Error extracting HTML characteristics: ${error.message}`);
            return null;
        }
    }

    // Find elements by HTML content similarity
    findByHtmlSimilarity($, targetHtml, threshold = 0.8) {
        const targetChars = this.extractHtmlCharacteristics(targetHtml);
        if (!targetChars) return [];
        
        const candidates = [];
        
        // Search for elements with the same tag name
        $(targetChars.tagName).each((i, el) => {
            const $el = $(el);
            let similarity = 0;
            let maxSimilarity = 0;
            
            // Check tag name match (base score)
            similarity += 0.2;
            maxSimilarity += 0.2;
            
            // Check attributes similarity
            const elAttrs = el.attribs || {};
            const targetAttrs = targetChars.attributes;
            
            const allAttrKeys = new Set([...Object.keys(elAttrs), ...Object.keys(targetAttrs)]);
            let matchingAttrs = 0;
            
            allAttrKeys.forEach(attr => {
                maxSimilarity += 0.1;
                if (elAttrs[attr] && targetAttrs[attr] && elAttrs[attr] === targetAttrs[attr]) {
                    similarity += 0.1;
                    matchingAttrs++;
                }
            });
            
            // Check text content similarity
            if (targetChars.textContent) {
                maxSimilarity += 0.3;
                const elText = $el.text().trim();
                if (elText === targetChars.textContent) {
                    similarity += 0.3;
                } else if (elText.includes(targetChars.textContent) || targetChars.textContent.includes(elText)) {
                    similarity += 0.15;
                }
            }
            
            // Check child count similarity
            maxSimilarity += 0.1;
            const elChildCount = $el.children().length;
            if (elChildCount === targetChars.childCount) {
                similarity += 0.1;
            }
            
            const finalSimilarity = maxSimilarity > 0 ? similarity / maxSimilarity : 0;
            
            if (finalSimilarity >= threshold) {
                candidates.push({
                    element: $el,
                    similarity: finalSimilarity,
                    matchingAttrs: matchingAttrs
                });
            }
        });
        
        return candidates.sort((a, b) => b.similarity - a.similarity);
    }

    // Create a unique selector from HTML structure
    createStructuralSelector($, htmlString) {
        const characteristics = this.extractHtmlCharacteristics(htmlString);
        if (!characteristics) return null;
        
        const attrs = characteristics.attributes;
        
        // Prioritize unique attributes
        if (attrs.id) return `#${attrs.id}`;
        if (attrs['data-mesh-id']) return `[data-mesh-id="${attrs['data-mesh-id']}"]`;
        if (attrs['data-testid']) return `[data-testid="${attrs['data-testid']}"]`;
        if (attrs['data-test-id']) return `[data-test-id="${attrs['data-test-id']}"]`;
        
        // Use class if available
        let selector = characteristics.tagName;
        if (attrs.class) {
            const classes = attrs.class.split(' ').filter(c => c.trim());
            if (classes.length > 0) {
                selector += `.${classes[0]}`;
            }
        }
        
        return selector;
    }

    // Enhanced selector generation
    generateSpecificSelectors(htmlString, $dom = null) {
        if (!htmlString) return [];
        
        const selectors = [];
        
        try {
            // Create structural selector from HTML
            if ($dom) {
                const structuralSelector = this.createStructuralSelector($dom, htmlString);
                if (structuralSelector) {
                    selectors.push({
                        type: 'structural',
                        selector: structuralSelector,
                        priority: 25
                    });
                }
                
                // Try HTML similarity matching
                const similarElements = this.findByHtmlSimilarity($dom, htmlString, 0.7);
                
                similarElements.slice(0, 2).forEach((candidate, index) => {
                    const element = candidate.element;
                    
                    let elementSelector = '';
                    const elementId = element.attr('id');
                    const elementClasses = element.attr('class') ? element.attr('class').split(' ').filter(c => c.trim()) : [];
                    const elementDataMeshId = element.attr('data-mesh-id');
                    const elementDataTestId = element.attr('data-testid') || element.attr('data-test-id');
                    
                    if (elementId) {
                        elementSelector = `#${elementId}`;
                    } else if (elementDataMeshId) {
                        elementSelector = `[data-mesh-id="${elementDataMeshId}"]`;
                    } else if (elementDataTestId) {
                        elementSelector = `[data-testid="${elementDataTestId}"]`;
                    } else if (elementClasses.length > 0) {
                        elementSelector = `.${elementClasses[0]}`;
                    }
                    
                    if (elementSelector) {
                        selectors.push({
                            type: 'html-similarity',
                            selector: elementSelector,
                            priority: 18 - index
                        });
                    }
                });
            }
            
            // Fallback: extract from HTML string
            const $ = cheerio.load(htmlString);
            const targetElement = $.root().children().first();
            
            if (targetElement.length > 0) {
                const tagName = targetElement.get(0).tagName.toLowerCase();
                const elementId = targetElement.attr('id');
                const elementClasses = targetElement.attr('class') ? targetElement.attr('class').split(' ').filter(c => c.trim()) : [];
                const elementDataMeshId = targetElement.attr('data-mesh-id');
                const elementDataTestId = targetElement.attr('data-testid') || targetElement.attr('data-test-id');
                
                if (elementId) {
                    selectors.push({ type: 'basic', selector: `#${elementId}`, priority: 20 });
                }
                
                if (elementDataMeshId) {
                    selectors.push({ type: 'basic', selector: `[data-mesh-id="${elementDataMeshId}"]`, priority: 15 });
                }
                
                if (elementDataTestId) {
                    selectors.push({ type: 'basic', selector: `[data-testid="${elementDataTestId}"]`, priority: 12 });
                }
                
                elementClasses.forEach((className, index) => {
                    if (className.trim()) {
                        selectors.push({ type: 'basic', selector: `.${className}`, priority: 8 - index });
                    }
                });
            }
            
        } catch (error) {
            console.log(`Error generating selectors: ${error.message}`);
        }
        
        return selectors.sort((a, b) => b.priority - a.priority);
    }

    // Extract elements from layout JSON
    extractElements(layoutData) {
        let elements = [];
        
        const findElements = (obj, path = '') => {
            if (obj === null || typeof obj !== 'object') return;
            
            if (Array.isArray(obj)) {
                obj.forEach((item, index) => {
                    findElements(item, `${path}[${index}]`);
                });
                return;
            }
            
            const hasStyleInfo = obj.styles || obj.className || obj.id || obj.dataTestId || obj['data-test-id'];
            const hasLayoutInfo = obj.type || obj.tag || obj.tagName || obj.element || obj.component || obj.html;
            
            if (hasStyleInfo || hasLayoutInfo) {
                const element = this.enrichElementData({
                    ...obj,
                    path: path
                });
                
                if (element.styles && Object.keys(element.styles).length > 0 &&
                    (element.id || element.className || element.dataTestId || element.dataMeshId || element.html)) {
                    elements.push(element);
                }
            }
            
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'object' && value !== null) {
                    findElements(value, `${path}.${key}`);
                }
            }
        };
        
        console.log('Extracting elements from layout JSON...');
        findElements(layoutData);
        console.log(`Total elements found: ${elements.length}`);
        
        return elements;
    }

    // Validate CSS selectors
    isValidSelector(selector) {
        if (!selector || typeof selector !== 'string' || selector.trim() === '') {
            return false;
        }
        
        if (selector.includes('[]') || selector.includes('""') || selector.includes("''")) {
            return false;
        }
        
        try {
            const testElement = '<div></div>';
            const $ = cheerio.load(testElement);
            $(selector);
            return true;
        } catch (error) {
            return false;
        }
    }

    // Enhanced element matching with clean inline styles
    tryMatchElement($, element, styleString) {
        let foundMatch = false;
        let matchCount = 0;

        const applyStyles = (selector, selectorDescription) => {
            if (!this.isValidSelector(selector)) {
                return false;
            }
            
            try {
                const $matches = $(selector);
                if ($matches.length > 0) {
                    $matches.each((i, el) => {
                        // Skip HTML element - don't apply styles to <html> tag
                        if (el.tagName && el.tagName.toLowerCase() === 'html') {
                            console.log(`   ⚠️ Skipping HTML element - styles not applied to <html> tag`);
                            return;
                        }
                        
                        const existingStyle = $(el).attr('style') || '';
                        // Clean merge of styles - avoid duplicates
                        const existingStyles = existingStyle ? existingStyle.split(';').map(s => s.trim()).filter(s => s) : [];
                        const newStyles = styleString.split(';').map(s => s.trim()).filter(s => s);
                        
                        // Merge and deduplicate styles
                        const allStyles = [...existingStyles, ...newStyles];
                        const styleMap = new Map();
                        
                        allStyles.forEach(style => {
                            const [prop, value] = style.split(':').map(s => s.trim());
                            if (prop && value) {
                                styleMap.set(prop, value);
                            }
                        });
                        
                        const finalStyle = Array.from(styleMap.entries())
                            .map(([prop, value]) => `${prop}: ${value}`)
                            .join('; ');
                        
                        $(el).attr('style', finalStyle);
                        matchCount++;
                    });
                    
                    if (matchCount > 0) {
                        console.log(`✅ Applied styles to ${matchCount} element(s) using ${selectorDescription}`);
                        return true;
                    }
                }
            } catch (error) {
                console.log(`❌ Error applying selector "${selector}": ${error.message}`);
            }
            return false;
        };

        // Try direct attributes first (skip if targeting HTML element)
        if (element.id && element.id.toLowerCase() !== 'html' && applyStyles(`#${element.id}`, `ID "${element.id}"`)) {
            return { foundMatch: true, matchCount };
        }

        if (element.dataMeshId && applyStyles(`[data-mesh-id="${element.dataMeshId}"]`, `data-mesh-id "${element.dataMeshId}"`)) {
            return { foundMatch: true, matchCount };
        }

        if (element.dataTestId) {
            if (applyStyles(`[data-testid="${element.dataTestId}"]`, `data-testid "${element.dataTestId}"`)) {
                return { foundMatch: true, matchCount };
            }
            if (applyStyles(`[data-test-id="${element.dataTestId}"]`, `data-test-id "${element.dataTestId}"`)) {
                return { foundMatch: true, matchCount };
            }
        }

        if (element.className) {
            const classes = element.className.split(' ').filter(c => c.trim());
            for (const className of classes) {
                if (applyStyles(`.${className}`, `class "${className}"`)) {
                    return { foundMatch: true, matchCount };
                }
            }
        }

        // Try HTML-based matching (but skip html selectors) - ALWAYS try this for elements with HTML
        if (element.html) {
            console.log(`   🔍 Trying HTML-based matching for element with HTML content`);
            const selectors = this.generateSpecificSelectors(element.html, $);
            
            for (const selectorObj of selectors) {
                // Skip if selector targets html element
                if (selectorObj.selector.toLowerCase().startsWith('html')) {
                    console.log(`   ⚠️ Skipping HTML element selector: ${selectorObj.selector}`);
                    continue;
                }
                
                console.log(`   🎯 Trying selector: ${selectorObj.selector} (${selectorObj.type}, priority: ${selectorObj.priority})`);
                if (applyStyles(selectorObj.selector, `HTML-based (${selectorObj.type})`)) {
                    return { foundMatch: true, matchCount };
                }
            }
        }

        // Add to unmatched list
        this.unmatchedElements.push({
            element: element,
            styleString: styleString
        });

        return { foundMatch: false, matchCount: 0 };
    }

    // Clean HTML output formatting
    formatCleanHtml(html) {
        // Remove any existing <style> tags
        const $ = cheerio.load(html);
        $('style').remove();
        
        // Ensure proper HTML5 doctype and structure
        let cleanHtml = $.html();
        
        if (!cleanHtml.includes('<!DOCTYPE html>')) {
            cleanHtml = '<!DOCTYPE html>\n' + cleanHtml;
        }
        
        // Format the HTML nicely
        cleanHtml = cleanHtml
            .replace(/>\s*</g, '>\n<')  // Add newlines between tags
            .replace(/\n\s*\n/g, '\n')  // Remove empty lines
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
        
        return cleanHtml;
    }

    // Process HTML with clean output
    async processHtml(rawHtml, layoutJson, outputDir, sectionIndex) {
        console.log(`   🎨 Processing section ${sectionIndex} with CleanHtmlStyleProcessor...`);
        
        const $ = cheerio.load(rawHtml);
        const elements = this.extractElements(layoutJson);
        
        console.log(`   Found ${elements.length} elements to process`);
        
        if (elements.length === 0) {
            console.log('⚠️  No elements found to process.');
            return {
                styledHtml: this.formatCleanHtml(rawHtml),
                layoutInlineFile: null
            };
        }
        
        let totalMatchCount = 0;
        let unmatchedCount = 0;
        let processedElements = 0;
        
        elements.forEach((element, index) => {
            if (!element.styles || Object.keys(element.styles).length === 0) {
                return;
            }
            
            processedElements++;
            const styleString = this.styleObjectToString(element.styles);
            
            console.log(`\n   📍 Processing element ${processedElements}/${elements.length}:`);
            console.log(`      ID: ${element.id || 'none'}`);
            console.log(`      ClassName: ${element.className || 'none'}`);
            console.log(`      DataMeshId: ${element.dataMeshId || 'none'}`);
            console.log(`      DataTestId: ${element.dataTestId || 'none'}`);
            console.log(`      HTML: ${element.html ? 'present' : 'none'}`);
            console.log(`      Styles: ${styleString}`);
            
            const { foundMatch, matchCount } = this.tryMatchElement($, element, styleString);
            
            if (foundMatch) {
                totalMatchCount += matchCount;
            } else {
                unmatchedCount++;
                console.log(`      ❌ Failed: No matching elements found`);
            }
        });
        
        console.log(`\n   📊 Processing Summary:`);
        console.log(`      Successfully matched: ${processedElements - unmatchedCount}/${processedElements}`);
        console.log(`      Total style applications: ${totalMatchCount}`);
        
        if (this.unmatchedElements.length > 0) {
            console.log(`\n   ⚠️  Unmatched elements:`);
            this.unmatchedElements.forEach((unmatched, index) => {
                console.log(`      ${index + 1}. Element with dataMeshId: ${unmatched.element.dataMeshId || 'none'}`);
            });
        }
        
        const styledHtml = this.formatCleanHtml($.html());
        const layoutInlineFile = `layout_inlineStyles_${sectionIndex}.html`;
        
        await fs.writeFile(
            path.join(outputDir, layoutInlineFile),
            styledHtml
        );
        
        console.log(`   ✅ Applied inline styles successfully, saved to ${layoutInlineFile}`);
        
        return {
            styledHtml,
            layoutInlineFile
        };
    }
}

async function generateBareMinimumHtml(sectionIndex, styledHtml, outputDir) {
    console.log(`   🔧 Step 3: Generating bare minimum HTML for section ${sectionIndex}...`);
    
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
<div id="comp-irqduxcu" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxcu" data-testid="colorUnderlay" data-mesh-id="comp-irqduxcuinlineContent-gridContainer" class="comp-irqduxcu YzqVZ wixui-column-strip__column MW5IZ LWbAav Kv1aVt VgO9Yg" style="bottom:0;flex-basis:0%;flex-grow:325;height:421px;left:0;min-height:auto;position:relative;right:0;top:0;width:641.711px;display:grid;grid-template-columns:641.711px;grid-template-rows:150px 42.5px 228.5px;min-height:421px">
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

    async function optimizeWithAI(html, attempt = 1) {
        try {
            console.log(`Optimization attempt ${attempt}...`);
            
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-3.5-turbo',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'Output only optimized HTML with no explanations or markdown.' 
                        },
                        { 
                            role: 'user', 
                            content: OPTIMIZATION_PROMPT + html 
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 2048
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const rawOutput = response.data.choices[0].message.content;
            const cleaned = rawOutput.replace(/```(html)?/g, '').trim();
            
            // Simple cleanup - remove comments and normalize whitespace
            const optimized = cleaned
                .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();
            
            // Basic validation - just check if it looks like HTML
            if (!optimized.startsWith('<') || !optimized.includes('</')) {
                throw new Error('Invalid HTML structure returned');
            }
            
            // Verify meaningful optimization (optional check)
            if (optimized.length > html.length * 0.9) {
                console.log('Warning: Minimal optimization achieved');
            }
            
            return optimized;

        } catch (error) {
            console.log(`Attempt ${attempt} failed: ${error.message}`);
            if (attempt >= 3) {
                console.warn('Returning original HTML after 3 attempts');
                return html;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            return optimizeWithAI(html, attempt + 1);
        }
    }

    try {
        const html = styledHtml;
        const $ = cheerio.load(html);

        // Find ONLY the topmost components and bgLayers components
        // 1. Top-level components (divs with IDs that have class starting with 'comp-')
        // 2. bgLayers components (divs with IDs starting with 'bgLayers')
        const topLevelComponents = $('div[id][class*="comp-"]').toArray()
            .filter(div => {
                const $div = $(div);
                // Check if this div has any parent divs with comp- class
                return $div.parents('div[id][class*="comp-"]').length === 0;
            });

        // Find bgLayers components (these are background layer components)
        const bgLayersComponents = $('div[id^="bgLayers"]').toArray()
            .filter(div => {
                const $div = $(div);
                // Only include if it's not already part of a top-level component
                return !topLevelComponents.some(comp => $(comp).find(div).length > 0);
            });

        // Combine both types of components
        const allComponents = [...topLevelComponents, ...bgLayersComponents];

        console.log(`Found ${topLevelComponents.length} top-level components and ${bgLayersComponents.length} bgLayers components to optimize`);

        const templates = {};
        for (const [index, div] of allComponents.entries()) {
            const $div = $(div);
            const original = $.html($div);
            const originalDivCount = $div.find('div').length + 1;

            const componentType = $div.attr('id').startsWith('bgLayers') ? 'bgLayers' : 'component';
            console.log(`Processing ${componentType} ${index + 1}: ${$div.attr('id')} (${originalDivCount} divs)...`);

            // Only optimize if the component is reasonably sized (avoid huge components)
            if (originalDivCount > 50) {
                console.log(`Skipping optimization for large component (${originalDivCount} divs)`);
                templates[`template-${2000 + index}`] = original;
            } else {
                const optimized = await optimizeWithAI(original);
                const $optimized = cheerio.load(optimized);
                const optimizedDivCount = $optimized('div').length;
                
                console.log(`Optimized from ${originalDivCount} to ${optimizedDivCount} divs`);
                templates[`template-${2000 + index}`] = optimized;
            }
            
            $div.replaceWith(`{{template-${2000 + index}}`);
        }

        // Get the final optimized HTML
        const bareHtml = $.html();

        // Save the bare minimum HTML
        const bareMinimumFile = `bareminimum_section_${sectionIndex}.html`;
        await fs.writeFile(
            path.join(outputDir, bareMinimumFile),
            bareHtml
        );

        // Save the templates if needed
        const templatesFile = `bareminimum_templates_${sectionIndex}.json`;
        await fs.writeFile(
            path.join(outputDir, templatesFile),
            JSON.stringify(templates, null, 2)
        );

        console.log(`   ✅ Generated bare minimum HTML, saved to ${bareMinimumFile}`);
        
        return {
            bareHtml,
            bareMinimumFile,
            templatesFile
        };

    } catch (error) {
        console.error('❌ Processing failed:', error);
        
        // Fallback: Return the original HTML
        const bareMinimumFile = `bareminimum_section_${sectionIndex}.html`;
        await fs.writeFile(
            path.join(outputDir, bareMinimumFile),
            styledHtml
        );
        
        return {
            bareHtml: styledHtml,
            bareMinimumFile,
            error: error.message
        };
    }
}

class WebsiteBuilder {
    constructor(outputDir) {
        this.outputDir = outputDir;
        this.templateFile = path.join(outputDir, 'bareminimum_section_0.html');
        this.data1File = path.join(outputDir, 'bareminimum_templates_0.json');
        this.data2File = path.join(outputDir, 'template_section_0_placeholders.json');
        this.currentHTML = '';
        this.data1 = {};
        this.data2 = {};
    }

    async loadData() {
        try {
            // Load data1 (bareminimum templates)
            const data1Content = await fs.readFile(this.data1File, 'utf8');
            this.data1 = JSON.parse(data1Content);

            // Load data2 (placeholders)
            const data2Content = await fs.readFile(this.data2File, 'utf8');
            const data2Array = JSON.parse(data2Content);
            this.data2 = {};
            data2Array.forEach(item => {
                if (item.id) {
                    this.data2[item.id] = item;
                }
            });

            console.log('Data loaded - Data1 keys:', Object.keys(this.data1));
            console.log('Data loaded - Data2 keys:', Object.keys(this.data2));
        } catch (error) {
            console.error('Error loading data:', error);
            throw error;
        }
    }

    buildElementFromData2(item) {
        if (!item) return '';

        const { id, className, innerHTML, styles } = item;
        const tagName = 'div'; // Default to div for widgets
        
        let element = `<${tagName}`;
        
        if (id) element += ` id="${id}"`;
        if (className) element += ` class="${className}"`;
        
        // Enhanced style handling
        if (styles && typeof styles === 'object' && Object.keys(styles).length > 0) {
            const styleString = Object.keys(styles)
                .map(key => {
                    const value = styles[key];
                    // Handle CSS property conversion (camelCase to kebab-case if needed)
                    const cssProperty = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                    // Ensure proper CSS value format
                    return `${cssProperty}: ${value}`;
                })
                .join('; ');
            element += ` style="${styleString}"`;
        }
        
        element += '>';
        
        if (innerHTML) {
            element += innerHTML;
        }
        
        element += `</${tagName}>`;
        return element;
    }

    processTemplates(content) {
        if (!content || typeof content !== 'string') return content;

        let processedContent = content;
        let hasReplacements = true;
        let iterations = 0;
        const maxIterations = 10; // Prevent infinite loops

        while (hasReplacements && iterations < maxIterations) {
            hasReplacements = false;
            iterations++;

            // Replace {{template-n}} with data1 content
            processedContent = processedContent.replace(/\{\{(template-\d+)\}\}/g, (match, templateId) => {
                if (this.data1[templateId]) {
                    hasReplacements = true;
                    return this.data1[templateId];
                }
                return match;
            });

            // Replace {{template-n}} with data2 content
            processedContent = processedContent.replace(/\{\{(template-\d+)\}\}/g, (match, templateId) => {
                if (this.data2[templateId]) {
                    hasReplacements = true;
                    return this.buildElementFromData2(this.data2[templateId]);
                }
                return match;
            });
        }

        return processedContent;
    }

    async buildWebsite() {
        try {
            await this.loadData();
            
            // Read template file
            const templateContent = await fs.readFile(this.templateFile, 'utf8');
            
            // Process templates recursively
            const finalHtml = this.processTemplates(templateContent);
            this.currentHTML = finalHtml;
            
            return finalHtml;
        } catch (error) {
            console.error('Build failed:', error);
            throw error;
        }
    }
}

async function assembleFinalWebsite(sectionIndex, outputDir) {
    console.log(`   🏗️ Step 4: Processing section ${sectionIndex}...`);
    
    try {
        const builder = new WebsiteBuilder(outputDir);
        
        // Set the input files dynamically
        builder.templateFile = path.join(outputDir, `bareminimum_section_${sectionIndex}.html`);
        builder.data1File = path.join(outputDir, `bareminimum_templates_${sectionIndex}.json`);
        builder.data2File = path.join(outputDir, `template_section_${sectionIndex}_placeholders.json`);
        
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

async function updateBrowserDisplay(outputDir, shouldOpenBrowser = false) {
    if (allSections.length === 0) {
        console.log('No sections to display');
        return;
    }

    // Create HTML with all sections
    const completeHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Migrated Website Sections</title>
    <style>
        body { 
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .section-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            padding: 20px;
        }
        .section-header {
            font-size: 18px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 1px solid #eee;
        }
        .section-status {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            margin-left: 10px;
        }
        .completed {
            background: #d4edda;
            color: #155724;
        }
        .processing {
            background: #cce5ff;
            color: #004085;
        }
    </style>
    <script>
        // Auto-refresh every 5 seconds to check for new sections
        setTimeout(() => {
            window.location.reload();
        }, 5000);
    </script>
</head>
<body>
    <h1>Migrated Website Sections (${allSections.length} total)</h1>
    ${allSections.map(section => `
        <div class="section-container">
            <div class="section-header">
                Section ${section.index}
                <span class="section-status ${section.completed ? 'completed' : 'processing'}">
                    ${section.completed ? '✓ Completed' : '⏳ Processing...'}
                </span>
            </div>
            ${section.html}
        </div>
    `).join('\n')}
</body>
</html>
    `;

    // Save to temporary file
    const tempFile = path.join(outputDir, 'all_sections.html');
    await fs.writeFile(tempFile, completeHtml);
    
    const fullPath = path.resolve(tempFile);
    const fileUrl = `file://${fullPath}`;
    
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
            console.log('✅ Browser opened with sections');
        } catch (error) {
            console.log(`✅ Sections available at: ${fileUrl}`);
            console.log(`ℹ️ Could not automatically open browser: ${error.message}`);
        }
    } else {
        // For subsequent sections, refresh the existing browser tab
        try {
            const refreshCommand = platform === 'darwin' 
                ? `osascript -e 'tell application "Google Chrome" to tell window 1 to tell active tab to set URL to "${fileUrl}"'`
                : platform === 'win32'
                    ? `start "" "${fileUrl}"` // Windows will reuse the same window
                    : `xdg-open "${fileUrl}"`; // Linux will reuse the same window
            
            await execPromise(refreshCommand);
            console.log('✅ Browser refreshed with updated sections');
        } catch (error) {
            console.log('✅ Sections updated (could not refresh browser automatically)');
        }
    }
}

async function processAllSections(rawHtmlContent, computedStyles, outputDir) {
    console.log('🚀 Starting enhanced section-by-section migration process...\n');
    
    // Clear previous sections
    allSections = [];
    browserProcess = null;
    
    // === INITIAL PREPARATION STEPS ===
    console.log('=== INITIAL PREPARATION STEPS ===');
    const sectionFiles = await extractAndSaveSections(rawHtmlContent, computedStyles, outputDir);
    
    // === RECURSIVE PROCESSING ===
    console.log('=== RECURSIVE SECTION PROCESSING ===');
    
    const globalTemplates = [];
    const processedSections = [];
    const styleProcessor = new CleanHtmlStyleProcessor();
    
    for (let i = 0; i < sectionFiles.length; i++) {
        console.log(`\n--- Processing Section ${i} ---`);
        
        try {
            // Read section HTML
            const sectionHtml = await fs.readFile(
                path.join(outputDir, `sections/section_${i}.html`), 
                'utf8'
            );
            
            // Read computed data
            const computedData = JSON.parse(
                await fs.readFile(path.join(outputDir, `sections/section_${i}_computed.json`), 'utf8')
            );
            
            // Step 1: Process section with CleanHtmlStyleProcessor (replaces both widget processing and inline styles)
            const step1Result = await styleProcessor.processHtml(
                sectionHtml, 
                computedData, 
                outputDir, 
                i
            );
            
            // Step 2: Generate bare minimum HTML
            const step2Result = await generateBareMinimumHtml(
                i, step1Result.styledHtml, outputDir
            );
            
            // Step 3: Process section (stores in memory and updates browser)
            const step3Result = await assembleFinalWebsite(
                i, outputDir
            );
            
            // Mark section as completed
            allSections.find(s => s.index === i).completed = true;
            await updateBrowserDisplay(outputDir);
            
            // Track section processing results
            processedSections.push({
                index: i,
                sectionKey: Object.keys(computedData)[0] || `section_${i}`,
                files: {
                    original: `section_${i}.html`,
                    computed: `sections/section_${i}_computed.json`,
                    layoutInline: step1Result.layoutInlineFile,
                    bareMinimum: step2Result.bareMinimumFile
                },
                stats: {
                    originalSize: sectionHtml.length,
                    finalSize: step3Result.finalHtml.length,
                    compressionRatio: ((sectionHtml.length - step3Result.finalHtml.length) / sectionHtml.length * 100).toFixed(1) + '%'
                }
            });
            
            console.log(`✅ Section ${i} completed successfully`);
            console.log(`   - Compression: ${processedSections[i].stats.compressionRatio}`);
            
        } catch (error) {
            console.error(`❌ Error processing section ${i}:`, error.message);
            processedSections.push({
                index: i,
                error: error.message,
                failed: true
            });
        }
    }
    
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

// === API Routes ===
app.post('/api/migrate', async (req, res) => {
    try {
        console.log('🚀 Starting enhanced HTML migration process...');
        
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ 
                error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.' 
            });
        }

        // Ensure output directory exists
        const outputDir = path.join(__dirname, 'output');
        try {
            await fs.mkdir(outputDir, { recursive: true });
        } catch (err) {
            // Directory might already exist
        }

        // Load input files
        const computedStylesPath = path.join(__dirname, 'computed-styles.json');
        const rawHtmlPath = path.join(__dirname, 'raw.html');

        let computedStyles, rawHtmlContent;
        
        try {
            const computedStylesContent = await fs.readFile(computedStylesPath, 'utf8');
            computedStyles = JSON.parse(computedStylesContent);
        } catch (error) {
            return res.status(400).json({ 
                error: 'Could not load computed-styles.json', 
                message: error.message 
            });
        }

        try {
            rawHtmlContent = await fs.readFile(rawHtmlPath, 'utf8');
        } catch (error) {
            return res.status(400).json({ 
                error: 'Could not load raw.html', 
                message: error.message 
            });
        }

        // Process all sections
        const results = await processAllSections(rawHtmlContent, computedStyles, outputDir);

        // Generate final migration report
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

        console.log('\n🎉 Enhanced migration completed!');
        console.log(`✅ Successfully processed: ${results.summary.successfulSections} sections`);
        console.log(`❌ Failed: ${results.summary.failedSections} sections`);
        console.log(`📉 Average compression: ${results.summary.averageCompression}`);

        res.json(migrationReport);

    } catch (error) {
        console.error('Migration failed:', error);
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

// File listing endpoint
app.get('/api/files', async (req, res) => {
    try {
        const outputDir = path.join(__dirname, 'output');
        let files = [];
        
        try {
            const dirContents = await fs.readdir(outputDir);
            files = dirContents.filter(file => file.endsWith('.json') || file.endsWith('.html'));
        } catch (error) {
            // Output directory doesn't exist yet
        }
        
        // Categorize files
        const fileCategories = {
            sections: files.filter(f => f.startsWith('section_') && !f.includes('computed')),
            computed: files.filter(f => f.includes('computed')),
            layouts: files.filter(f => f.startsWith('layout_')),
            bareMinimum: files.filter(f => f.startsWith('bareminimum_')),
            reports: files.filter(f => f.includes('report') || f.includes('summary'))
        };
        
        res.json({ 
            files, 
            count: files.length,
            categories: fileCategories
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve the HTML interface
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
        <div class="step">Step 2: Process sections with CleanHtmlStyleProcessor</div>
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
                const response = await fetch('/api/migrate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
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
                    
                    // Update progress bar to 100%
                    document.getElementById('progressBar').style.width = '100%';
                    document.getElementById('progressText').textContent = 'Migration completed successfully!';
                    
                    // Open the built website in a new tab
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
                setTimeout(() => {
                    progress.style.display = 'none';
                }, 3000);
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
        
        // Check status on page load
        window.addEventListener('load', checkStatus);
        
        // Simulate progress updates (in a real implementation, you'd use WebSockets or Server-Sent Events)
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
        
        // Start progress simulation when migration begins
        document.getElementById('migrateBtn').addEventListener('click', () => {
            setTimeout(simulateProgress, 1000);
        });
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Section-by-Section Migration Server running on http://localhost:${PORT}`);
    console.log(`📋 OpenAI API Key configured: ${!!process.env.OPENAI_API_KEY}`);
    console.log(`📁 Working directory: ${__dirname}`);
    console.log(`📂 Output directory: ${path.join(__dirname, 'output')}`);
    console.log(`\n📋 Required files:`);
    console.log(`   - computed-styles.json (computed styles data)`);
    console.log(`   - raw.html (raw HTML content)`);
    console.log(`\n🔄 Processing pipeline:`);
    console.log(`   1. Extract sections from raw HTML`);
    console.log(`   2. Process sections with CleanHtmlStyleProcessor`);
    console.log(`   3. Generate optimized HTML`);
});

module.exports = app;