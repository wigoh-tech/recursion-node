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

// === Widget Tags Configuration ===
const widgetTags = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SVG', 'IMG', 'IMAGE', 'VIDEO',
  'SPAN', 'BUTTON', 'A', 'TEXT', 'WOW-IMAGE', 'WOW-VIDEO', 'WOW-SVG', 'WOW-ICON', 'WOW-CANVAS'
]);

// === Layout Styles Configuration ===
const allowedLayoutStyles = new Set([
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent',
  'alignSelf', 'order', 'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'gridColumnStart',
  'gridColumnEnd', 'gridRowStart', 'gridRowEnd', 'gridArea', 'placeItems', 'placeContent',
  'placeSelf', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'backgroundColor'
]);

// === Widget Font/Text Styles ===
const fontAndTextStyles = new Set([
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textAlign', 'textDecoration', 'textDecorationColor', 'textShadow', 'textTransform',
  'textOverflow', 'whiteSpace', 'wordBreak', 'wordWrap', 'overflowWrap',
  'textSizeAdjust', 'caretColor', 'color', 'outlineColor', 'textEmphasisColor',
  '-webkitTextFillColor', '-webkitTextStrokeColor'
]);

// === Widget Image/SVG/Video Styles ===
const svgImageStyles = new Set([
  'fill', 'stroke', 'strokeWidth', 'strokeOpacity', 'vectorEffect', 'transformOrigin',
  'perspectiveOrigin', 'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'blockSize', 'inlineSize',
  'insetBlockStart', 'insetBlockEnd', 'insetInlineStart', 'insetInlineEnd',
  '-webkitTapHighlightColor'
]);

// === Common Background & Color Styles ===
const colorBackgroundStyles = new Set([
  'background', 'backgroundColor', 'backgroundImage', 'color'
]);

// === Helper Functions ===
function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function filterLayoutStyles(styles) {
  const result = {};
  for (const key in styles) {
    const camelKey = toCamelCase(key);
    if (allowedLayoutStyles.has(camelKey)) {
      result[key] = styles[key];
    }
  }
  return result;
}

function filterWidgetStyles(styles) {
  const result = {};
  for (const key in styles) {
    const camelKey = toCamelCase(key);
    if (
      fontAndTextStyles.has(camelKey) ||
      svgImageStyles.has(camelKey) ||
      colorBackgroundStyles.has(camelKey)
    ) {
      result[key] = styles[key];
    }
  }
  return result;
}

function splitNode(node) {
  if (!node || typeof node !== 'object') return { layout: null, widget: null };

  const isWidget = widgetTags.has((node.tag || '').toUpperCase());

  const layoutStyles = node.styles ? filterLayoutStyles(node.styles) : {};
  const widgetStyles = node.styles ? filterWidgetStyles(node.styles) : {};

  const children = Array.isArray(node.children) ? node.children.map(splitNode) : [];

  const layoutChildren = children.map(c => c.layout).filter(Boolean);
  const widgetChildren = children.map(c => c.widget).filter(Boolean);

  const baseProps = {
    tag: node.tag,
    id: node.id || '',
    className: node.className || '',
    html: node.html
  };

  const layoutNode = !isWidget && (Object.keys(layoutStyles).length > 0 || layoutChildren.length > 0)
    ? {
        ...baseProps,
        ...(Object.keys(layoutStyles).length > 0 ? { styles: layoutStyles } : {}),
        ...(layoutChildren.length > 0 ? { children: layoutChildren } : {})
      }
    : null;

  const widgetNode = isWidget
    ? {
        ...baseProps,
        ...(Object.keys(widgetStyles).length > 0 ? { styles: widgetStyles } : {}),
        ...(widgetChildren.length > 0 ? { children: widgetChildren } : {})
      }
    : widgetChildren.length > 0 ? widgetChildren.length === 1 ? widgetChildren[0] : widgetChildren : null;

  return { layout: layoutNode, widget: widgetNode };
}

// === INITIAL PREPARATION STEPS ===

// Step 1: Extract individual sections from raw.html
async function extractSectionsFromHtml(rawHtmlContent, outputDir) {
  console.log('🔍 Step 1: Extracting individual sections from raw.html...');
  
  const $ = cheerio.load(rawHtmlContent);
  
  // Find only top-level sections (direct children of body or html)
  const topLevelSections = $('body > section, html > section').toArray();
  
  // If no direct children, fall back to all sections but filter for top-level ones
  const sections = topLevelSections.length > 0 
    ? topLevelSections 
    : $('section').filter((i, el) => {
        // A section is top-level if it's not nested inside another section
        return $(el).parents('section').length === 0;
      }).toArray();
  
  console.log(`   Found ${sections.length} top-level sections`);
  
  const sectionFiles = [];
  
  for (let i = 0; i < sections.length; i++) {
    const sectionHtml = $.html(sections[i]);
    const filename = `section_${i}.html`;
    const filepath = path.join(outputDir, filename);
    
    await fs.writeFile(filepath, sectionHtml);
    sectionFiles.push({
      index: i,
      filename,
      size: sectionHtml.length
    });
    
    console.log(`   ✅ Saved ${filename} (${sectionHtml.length} chars)`);
  }
  
  return sectionFiles;
}

// Step 2: Split computed styles into widgets and layouts for each section
async function splitComputedStyles(computedStyles, outputDir) {
  console.log('🔧 Step 2: Splitting computed styles into widgets and layouts...');
  
  const sectionKeys = Object.keys(computedStyles);
  const splitResults = [];
  
  for (let i = 0; i < sectionKeys.length; i++) {
    const sectionKey = sectionKeys[i];
    const sectionData = computedStyles[sectionKey];
    
    // Split into widgets and layouts
    const { layout, widget } = splitNode(sectionData);
    
    // Save widgets JSON
    const widgetsFilename = `widgets_json_${i}.json`;
    const widgetsData = widget ? { [sectionKey]: widget } : {};
    await fs.writeFile(
      path.join(outputDir, widgetsFilename),
      JSON.stringify(widgetsData, null, 2)
    );
    
    // Save layouts JSON
    const layoutsFilename = `layouts_json_${i}.json`;
    const layoutsData = layout ? { [sectionKey]: layout } : {};
    await fs.writeFile(
      path.join(outputDir, layoutsFilename),
      JSON.stringify(layoutsData, null, 2)
    );
    
    splitResults.push({
      index: i,
      sectionKey,
      widgetsFile: widgetsFilename,
      layoutsFile: layoutsFilename,
      hasWidgets: !!widget,
      hasLayouts: !!layout
    });
    
    console.log(`   ✅ Section ${i} (${sectionKey}): widgets=${!!widget}, layouts=${!!layout}`);
  }
  
  return splitResults;
}

// === RECURSIVE PROCESSING STEPS ===

// Step 1 of recursive process: Replace widgets with placeholders
async function processWidgetPlaceholders(sectionIndex, sectionHtml, widgetsData, outputDir, globalTemplates) {
  console.log(`   🎯 Step 1: Processing widget placeholders for section ${sectionIndex}...`);
  
  try {
    // Initialize the widget processor with in-memory data
    const processor = new WidgetProcessor({
      htmlContent: sectionHtml,
      computedStyles: widgetsData
    });

    await processor.init();
    const widgets = await processor.extractWidgets();
    const results = await processor.processAllWidgets();

    // Get the processed HTML with placeholders
    const processedHtml = processor.getProcessedHtml();

    // Collect all templates from the processing
    const templates = [];
    for (const widget of widgets) {
      try {
        const widgetResult = results.find(r => r.widget_id === widget.placeholder);
        
        templates.push({
          id: widget.placeholder.replace(/\{\{|\}\}/g, ''),
          tagName: widget.tagName,
          className: widget.classes,
          innerHTML: widget.html,
          styles: widgetResult?.styles || {},
        });
      } catch (error) {
        console.error(`Failed to process widget ${widget.id}:`, error.message);
      }
    }

    // Save template section HTML
    const templateSectionFile = `template_section_${sectionIndex}.html`;
    await fs.writeFile(
      path.join(outputDir, templateSectionFile),
      processedHtml
    );

    // Save local placeholders
    const placeholdersFile = `template_section_${sectionIndex}_placeholders.json`;
    await fs.writeFile(
      path.join(outputDir, placeholdersFile),
      JSON.stringify(templates, null, 2)
    );

    // Update global templates
    globalTemplates.push(...templates);

    console.log(`   ✅ Created ${templates.length} placeholders, saved to ${templateSectionFile}`);

    return {
      processedHtml,
      templates,
      templateSectionFile,
      placeholdersFile
    };

  } catch (error) {
    console.error('Failed to process widget placeholders:', error);
    throw error;
  }
}

// WidgetProcessor class implementation
class WidgetProcessor {
  constructor(options = {}) {
    this.widgets = [];
    this.computedStyles = options.computedStyles || null;
    this.htmlContent = options.htmlContent || '';
    this.processedHtml = '';
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async init() {
    try {
      if (!this.computedStyles) {
        throw new Error('Computed styles data is required');
      }
      
      console.log('✓ Initialized successfully');
      console.log(`✓ Loaded computed styles with ${Object.keys(this.computedStyles).length} entries`);
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      throw error;
    }
  }

  async extractWidgets() {
    try {
      console.log('📖 Processing HTML content...');
      const $ = cheerio.load(this.htmlContent);

      // Use the same widget tags as defined in the main code
      const widgetElements = [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'svg', 'img', 'image', 'video',
        'span', 'button', 'a', 'text', 'wow-image', 'wow-video', 'wow-svg', 
        'wow-icon', 'wow-canvas'
      ];

      let widgetCount = 0;

      // Extract only specified widget elements
      widgetElements.forEach(tagName => {
        $(tagName).each((index, element) => {
          const $element = $(element);
          widgetCount++;
          
          const widget = {
            id: widgetCount,
            placeholder: `{{template-${widgetCount}}}`,
            html: $.html($element),
            tagName: tagName.toLowerCase(),
            selector: tagName,
            classes: $element.attr('class') || '',
            id: $element.attr('id') || '',
            attributes: this.getElementAttributes($element),
            textContent: $element.text().trim().substring(0, 100) // First 100 chars for reference
          };

          this.widgets.push(widget);
          
          // Replace with placeholder
          $element.replaceWith(widget.placeholder);
        });
      });

      // Store processed HTML
      this.processedHtml = $.html();
      
      console.log(`✓ Extracted ${this.widgets.length} widget elements`);
      console.log(`✓ Widget types found: ${this.getWidgetStats()}`);
      
      return this.widgets;
    } catch (error) {
      console.error('❌ Widget extraction failed:', error.message);
      throw error;
    }
  }

  getWidgetStats() {
    const stats = {};
    this.widgets.forEach(widget => {
      stats[widget.tagName] = (stats[widget.tagName] || 0) + 1;
    });
    return Object.entries(stats).map(([tag, count]) => `${tag}(${count})`).join(', ');
  }

  getElementAttributes(element) {
    const attributes = {};
    if (element.attribs) {
      Object.keys(element.attribs).forEach(key => {
        // Skip class and id as they're handled separately
        if (key !== 'class' && key !== 'id') {
          attributes[key] = element.attribs[key];
        }
      });
    }
    return attributes;
  }

  getProcessedHtml() {
    return this.processedHtml;
  }

  async processWidgetWithAI(widget) {
    try {
      console.log(`🤖 Processing widget-${widget.id} with AI...`);
      
      const prompt = `
Analyze this HTML widget element and the provided computed styles. Extract and convert the relevant styles to a clean CSS object format.

Widget ID: ${widget.id}
Widget HTML:
${widget.html}


Computed Styles:
${JSON.stringify(this.computedStyles, null, 2)}

Requirements:
1. Extract only the styles that apply to this specific ${widget.tagName} element
2. Convert from computed styles format to clean CSS properties
3. Remove any inline styles and use computed styles instead
4. Focus on styles relevant to this element type (${widget.tagName})
6. Include pseudo-element styles if present (:before, :after, :hover, etc.)
7. Return as a clean JSON object

Please return a JSON object with the following structure:
{
  "widget_id": "${widget.placeholder}", "html": "${widget.html}", "styles": { // Block inline styles // all the styles properties from json },
}
`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a CSS expert that converts computed styles to clean CSS objects. Return only valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4096
      });

      const result = response.choices[0].message.content;
      let cleanedResult = result.replace(/```json|```/g, '').trim();
      
      try {
        return JSON.parse(cleanedResult);
      } catch (parseError) {
        console.warn(`⚠️ Failed to parse AI response for widget-${widget.id}`);
        return {
          widget_id: widget.placeholder,
          error: 'Failed to parse JSON response',
          raw_response: result
        };
      }
    } catch (error) {
      console.error(`❌ AI processing failed for widget-${widget.id}:`, error.message);
      return {
        widget_id: widget.placeholder,
        error: error.message
      };
    }
  }

  async processAllWidgets() {
    console.log(`🚀 Starting AI processing for ${this.widgets.length} widgets...`);
    
    const results = [];
    
    for (const widget of this.widgets) {
      try {
        const result = await this.processWidgetWithAI(widget);
        results.push(result);
        
        // Add delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Failed to process widget-${widget.id}:`, error.message);
        results.push({
          widget_id: widget.placeholder,
          error: error.message
        });
      }
    }

    return results;
  }
}

async function applyInlineLayoutStyles(sectionIndex, templateHtml, layoutsData, outputDir) {
  console.log(`   🎨 Step 2: Applying inline layout styles for section ${sectionIndex}...`);
  
  // Extract and protect placeholders before AI processing
  const placeholderMap = new Map();
  let protectedHtml = templateHtml;
  
  // Find all {{template-n}} placeholders and replace with unique tokens
  const placeholderRegex = /\{\{template-\d+\}\}/g;
  const originalPlaceholders = templateHtml.match(placeholderRegex) || [];
  let counter = 0;
  
  // Create a more robust placeholder protection system
  for (const placeholder of originalPlaceholders) {
    const token = `__ULTRA_PROTECTED_PLACEHOLDER_${counter}_${Date.now()}__`;
    placeholderMap.set(token, placeholder);
    protectedHtml = protectedHtml.replace(placeholder, token);
    counter++;
  }
  
  console.log(`   📋 Found ${originalPlaceholders.length} placeholders to protect:`, originalPlaceholders);
  
  const prompt = `
CRITICAL INSTRUCTIONS - PLACEHOLDER PRESERVATION:
1. The HTML contains special tokens like "__ULTRA_PROTECTED_PLACEHOLDER_X_TIMESTAMP__"
2. These tokens are SACRED and must NEVER be removed, modified, or relocated
3. Apply CSS styling around these tokens but NEVER touch the tokens themselves
4. If you see a token, treat it as immutable content that cannot be changed
5. Return the complete HTML with all tokens intact

STYLING REQUIREMENTS:
- Apply ONLY grid/flex/position/background CSS properties from the JSON layout
- Add inline styles to HTML elements
- Do not modify any protected tokens
- Return clean HTML without markdown formatting

HTML to process:
${protectedHtml}

Layout Styles Data:
${JSON.stringify(layoutsData, null, 2)}

REMEMBER: Every single protected token must be in the output exactly as provided.
`;

  const maxAttempts = 3;
  let styledHtml = '';
  let success = false;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`   🔄 Attempt ${attempt}/${maxAttempts} - Processing with AI...`);
    
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a precise HTML processor. Your absolute priority is preserving all protected tokens exactly as they appear. Never remove, modify, or relocate any token that starts with "__ULTRA_PROTECTED_PLACEHOLDER_".'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,  // Lower temperature for more consistency
        max_tokens: 8192   // Increased token limit
      });

      styledHtml = completion.choices[0]?.message?.content || '';
      
      // Clean up any markdown formatting
      styledHtml = styledHtml.replace(/```html/g, '').replace(/```/g, '').trim();
      
      // Restore original placeholders
      for (const [token, placeholder] of placeholderMap) {
        styledHtml = styledHtml.replace(new RegExp(token, 'g'), placeholder);
      }
      
      // ENHANCED VALIDATION: Check if all original placeholders are present
      const finalPlaceholders = styledHtml.match(/\{\{template-\d+\}\}/g) || [];
      const missingPlaceholders = originalPlaceholders.filter(p => !finalPlaceholders.includes(p));
      
      if (missingPlaceholders.length === 0 && finalPlaceholders.length === originalPlaceholders.length) {
        console.log(`   ✅ Attempt ${attempt} successful - All ${originalPlaceholders.length} placeholders preserved!`);
        success = true;
        break;
      } else {
        console.warn(`   ⚠️  Attempt ${attempt} failed:`);
        console.warn(`      Original: ${originalPlaceholders.length}, Final: ${finalPlaceholders.length}`);
        console.warn(`      Missing: ${missingPlaceholders.join(', ')}`);
        
        // Debug: Check which tokens survived
        const survivingTokens = [];
        for (const [token, placeholder] of placeholderMap) {
          if (styledHtml.includes(token)) {
            survivingTokens.push(token);
          }
        }
        console.warn(`      Surviving tokens: ${survivingTokens.length}/${placeholderMap.size}`);
      }
      
      if (attempt < maxAttempts) {
        console.log(`   🔄 Retrying... (${maxAttempts - attempt} attempts remaining)`);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
    } catch (error) {
      console.error(`   ❌ Attempt ${attempt} failed with error:`, error.message);
      
      if (attempt < maxAttempts) {
        console.log(`   🔄 Retrying due to error... (${maxAttempts - attempt} attempts remaining)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  // If all attempts failed, try the dual HTML approach
  if (!success) {
    console.log(`   🔄 All AI attempts failed, trying dual HTML approach...`);
    
    try {
      const result = await applyStylesWithDualHTML(sectionIndex, templateHtml, layoutsData, outputDir);
      return result;
    } catch (dualError) {
      console.error(`❌ Dual HTML approach also failed:`, dualError.message);
      throw new Error(`Failed to apply inline styles after ${maxAttempts} attempts and dual HTML fallback`);
    }
  }
  
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

async function applyStylesWithDualHTML(sectionIndex, templateHtml, layoutsData, outputDir) {
  console.log(`   🎯 Trying dual HTML approach for section ${sectionIndex}...`);
  
  // Strategy: Create a placeholder-free version for AI processing, then merge results
  const placeholderRegex = /\{\{template-\d+\}\}/g;
  const originalPlaceholders = templateHtml.match(placeholderRegex) || [];
  
  // Create placeholder-free HTML for AI processing
  let cleanHtml = templateHtml;
  const placeholderPositions = [];
  
  // Replace placeholders with position markers
  let match;
  let offset = 0;
  while ((match = placeholderRegex.exec(templateHtml)) !== null) {
    const placeholder = match[0];
    const position = match.index;
    const marker = `<span data-placeholder-id="${offset}"></span>`;
    
    placeholderPositions.push({
      id: offset,
      placeholder: placeholder,
      originalPosition: position
    });
    
    cleanHtml = cleanHtml.replace(placeholder, marker);
    offset++;
  }
  
  console.log(`   📍 Created ${placeholderPositions.length} position markers`);
  
  const prompt = `
Apply inline CSS styles to this HTML based on the provided layout data.
Focus on adding grid/flex/position/background properties as inline styles.
Preserve all {{template-n}} markers exactly as they are.
Return only the styled HTML without any markdown formatting.

HTML:
${cleanHtml}

Layout Styles:
${JSON.stringify(layoutsData, null, 2)}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 8192
    });

    let styledHtml = completion.choices[0]?.message?.content || '';
    styledHtml = styledHtml.replace(/```html/g, '').replace(/```/g, '').trim();
    
    // Restore placeholders from position markers
    for (const pos of placeholderPositions) {
      const marker = `<span data-placeholder-id="${pos.id}"></span>`;
      styledHtml = styledHtml.replace(marker, pos.placeholder);
    }
    
    // Final validation
    const finalPlaceholders = styledHtml.match(/\{\{template-\d+\}\}/g) || [];
    
    if (finalPlaceholders.length === originalPlaceholders.length) {
      console.log(`   ✅ Dual HTML approach successful - All placeholders restored!`);
      
      const layoutInlineFile = `layout_inlineStyles_${sectionIndex}.html`;
      await fs.writeFile(
        path.join(outputDir, layoutInlineFile),
        styledHtml
      );
      
      return {
        styledHtml,
        layoutInlineFile
      };
    } else {
      throw new Error(`Dual HTML approach failed - placeholder count mismatch: ${finalPlaceholders.length} vs ${originalPlaceholders.length}`);
    }
    
  } catch (error) {
    throw new Error(`Dual HTML processing failed: ${error.message}`);
  }
}

async function applyInlineStylesManually(html, layoutsData) {
  // Fallback implementation for when AI fails
  // This would need to be implemented based on your specific requirements
  return html;
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
      
      $div.replaceWith(`{{template-${2000 + index}}}`);
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

// === MODIFIED FINAL ASSEMBLY FUNCTION ===
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
// === MODIFIED MAIN PROCESSING FUNCTION ===
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
    
    // Step 1: Extract sections from raw HTML
    const sectionFiles = await extractSectionsFromHtml(rawHtmlContent, outputDir);
    
    // Step 2: Split computed styles into widgets and layouts
    const splitResults = await splitComputedStyles(computedStyles, outputDir);
    
    console.log(`✅ Preparation complete: ${sectionFiles.length} sections extracted and styles split\n`);
    
    // === RECURSIVE PROCESSING ===
    console.log('=== RECURSIVE SECTION PROCESSING ===');
    
    const globalTemplates = [];
    const processedSections = [];
    
    for (let i = 0; i < sectionFiles.length; i++) {
        console.log(`\n--- Processing Section ${i} ---`);
        
        try {
            // Read section HTML
            const sectionHtml = await fs.readFile(
                path.join(outputDir, `section_${i}.html`), 
                'utf8'
            );
            
            // Read widgets data
            const widgetsData = JSON.parse(
                await fs.readFile(path.join(outputDir, `widgets_json_${i}.json`), 'utf8')
            );
            
            // Read layouts data
            const layoutsData = JSON.parse(
                await fs.readFile(path.join(outputDir, `layouts_json_${i}.json`), 'utf8')
            );
            
            // Step 1: Process widget placeholders
            const step1Result = await processWidgetPlaceholders(
                i, sectionHtml, widgetsData, outputDir, globalTemplates
            );
            
            // Step 2: Apply inline layout styles
            const step2Result = await applyInlineLayoutStyles(
                i, step1Result.processedHtml, layoutsData, outputDir
            );
            
            // Step 3: Generate bare minimum HTML
            const step3Result = await generateBareMinimumHtml(
                i, step2Result.styledHtml, outputDir
            );
            
            // Step 4: Process section (stores in memory and updates browser)
            const step4Result = await assembleFinalWebsite(
                i, outputDir
            );
            
            // Mark section as completed
            allSections.find(s => s.index === i).completed = true;
            await updateBrowserDisplay(outputDir);
            
            // Track section processing results
            processedSections.push({
                index: i,
                sectionKey: splitResults[i]?.sectionKey || `section_${i}`,
                files: {
                    original: `section_${i}.html`,
                    template: step1Result.templateSectionFile,
                    placeholders: step1Result.placeholdersFile,
                    layoutInline: step2Result.layoutInlineFile,
                    bareMinimum: step3Result.bareMinimumFile
                },
                stats: {
                    templatesCreated: step1Result.templates.length,
                    originalSize: sectionHtml.length,
                    finalSize: step4Result.finalHtml.length,
                    compressionRatio: ((sectionHtml.length - step4Result.finalHtml.length) / sectionHtml.length * 100).toFixed(1) + '%'
                }
            });
            
            console.log(`✅ Section ${i} completed successfully`);
            console.log(`   - Templates created: ${step1Result.templates.length}`);
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
    
    // Save global templates
    await fs.writeFile(
        path.join(outputDir, 'template.json'),
        JSON.stringify(globalTemplates, null, 2)
    );
    
    console.log(`\n✅ Global templates saved: ${globalTemplates.length} total templates`);
    
    return {
        sectionFiles,
        splitResults,
        processedSections,
        globalTemplates,
        summary: {
            totalSections: sectionFiles.length,
            successfulSections: processedSections.filter(s => !s.failed).length,
            failedSections: processedSections.filter(s => s.failed).length,
            totalTemplates: globalTemplates.length,
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
    console.log(`📊 Total templates created: ${results.summary.totalTemplates}`);
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
      preparation: files.filter(f => f.startsWith('section_') || f.startsWith('widgets_json_') || f.startsWith('layouts_json_')),
      templates: files.filter(f => f.startsWith('template_section_') || f === 'template.json'),
      layouts: files.filter(f => f.startsWith('layout_inlineStyles_')),
      bareMinimum: files.filter(f => f.startsWith('bareminimum_section_')),
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
        <div class="step">Step 1: Extract widgets & layout from computed styles</div>
        <div class="step">Step 2: Process section HTML with AI template generation</div>
        <div class="step">Step 3: Apply inline layout styles</div>
        <div class="step">Step 4: Generate bare minimum optimized HTML</div>
        
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
                            🎯 Total templates: \${data.summary.totalTemplates}<br>
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
                        'Preparation': data.categories.preparation,
                        'Templates': data.categories.templates,
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
  console.log(`   Step 1: Extract widgets & layout from computed styles`);
  console.log(`   Step 2: Process section HTML with AI template generation`);
  console.log(`   Step 3: Apply inline layout styles`);
  console.log(`   Step 4: Generate optimized bare minimum HTML`);
});

module.exports = app;