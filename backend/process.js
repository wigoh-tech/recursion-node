const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { OpenAI } = require('openai');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI with API key from environment
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

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
    if (allowedLayoutStyles.has(camelKey) || camelKey.startsWith('background')) {
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
        //   type: widget.tagName,
        //   tagName: widget.tagName,
          className: widget.classes,
        //   idAttr: widget.id,
          innerHTML: widget.html,
        //   textContent: widget.textContent,
          styles: widgetResult?.styles || {},
        //   attributes: widget.attributes
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
            placeholder: `{{widget-${widgetCount}}}`,
            html: $.html($element),
            tagName: tagName.toLowerCase(),
            selector: tagName,
            classes: $element.attr('class') || '',
            id: $element.attr('id') || '',
            attributes: this.getElementAttributes($element),
            textContent: $element.text().trim().substring(0, 100) 
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
5. Include pseudo-element styles if present (:before, :after, :hover, etc.)
6. Return as a clean JSON object

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
        max_tokens: 2000
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
  
  // SOLUTION 1: Extract and protect placeholders before AI processing
  const placeholderMap = new Map();
  let protectedHtml = templateHtml;
  
  // Find all {{template-n}} placeholders and replace with unique tokens
  const placeholderRegex = /\{\{template-\d+\}\}/g;
  let match;
  let counter = 0;
  
  while ((match = placeholderRegex.exec(templateHtml)) !== null) {
    const placeholder = match[0];
    const token = `__PROTECTED_PLACEHOLDER_${counter}__`;
    placeholderMap.set(token, placeholder);
    protectedHtml = protectedHtml.replace(placeholder, token);
    counter++;
  }
  
  const prompt = `
CRITICAL REQUIREMENTS - FOLLOW EXACTLY:

1. PLACEHOLDER PROTECTION:
   - NEVER modify or remove ANY tokens that start with __PROTECTED_PLACEHOLDER_
   - Keep all __PROTECTED_PLACEHOLDER_ tokens in their exact original positions

2. DIV REMOVAL LOGIC:
   - Check each div element for these CSS properties: grid, flex, position
   - Grid properties: display:grid, grid-template-*, grid-column, grid-row, grid-gap, gap, etc.
   - Flex properties: display:flex, flex-direction, justify-content, align-items, flex-wrap, etc.
   - Position properties: position (relative/absolute/fixed/sticky), top, right, bottom, left, z-index
   - IF a div has data-test-id AND does NOT have any of the above three property types, REMOVE the entire div element
   - IF a div has NO data-test-id, keep it regardless of CSS properties

3. INLINE STYLE APPLICATION:
   - For divs that are kept, convert matching layout CSS properties to inline styles
   - Only apply: Grid, Flex, Position, and Size properties (width, height, min-width, max-width, etc.)
   - Keep all HTML structure, attributes unchanged for remaining elements

4. PRESERVATION RULES:
   - Maintain all original class names and IDs for kept elements
   - Do not add any additional elements
   - ALL __PROTECTED_PLACEHOLDER_ tokens MUST remain in the output

HTML to process (WITH PROTECTED TOKENS):
${protectedHtml}

Layout Styles Data:
${JSON.stringify(layoutsData, null, 2)}

PROCESSING STEPS:
1. Parse HTML and identify all div elements
2. For each div with data-test-id, check if it has grid/flex/position properties
3. Remove divs with data-test-id that lack these properties
4. Apply inline styles to remaining divs that have matching styles
5. Preserve all __PROTECTED_PLACEHOLDER_ tokens

Return ONLY the processed HTML with:
- Unnecessary divs removed (based on criteria above)
- Inline styles applied to remaining elements
- NO explanations, NO code blocks, NO markdown formatting
- ALL __PROTECTED_PLACEHOLDER_ tokens preserved exactly
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: `You are an expert HTML/CSS optimizer specializing in layout cleanup. Your tasks:
1. Remove unnecessary div elements with data-test-id that lack grid, flex, or position properties
2. Apply inline styles for layout properties to remaining elements
3. NEVER modify __PROTECTED_PLACEHOLDER_ tokens
4. Maintain HTML structure integrity`
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0,  // Set to 0 for maximum consistency
    max_tokens: 4000
  });

  let styledHtml = completion.choices[0]?.message?.content || '';
  
  // Clean up any markdown formatting
  styledHtml = styledHtml.replace(/```html/g, '').replace(/```/g, '').trim();
  
  // Restore original placeholders
  for (const [token, placeholder] of placeholderMap) {
    styledHtml = styledHtml.replace(new RegExp(token, 'g'), placeholder);
  }
  
  // VALIDATION: Check if all original placeholders are present
  const originalPlaceholders = templateHtml.match(/\{\{template-\d+\}\}/g) || [];
  const finalPlaceholders = styledHtml.match(/\{\{template-\d+\}\}/g) || [];
  
  if (originalPlaceholders.length !== finalPlaceholders.length) {
    console.error(`❌ ERROR: Placeholder count mismatch!`);
    console.error(`Original: ${originalPlaceholders.length}, Final: ${finalPlaceholders.length}`);
    console.error(`Missing placeholders:`, originalPlaceholders.filter(p => !finalPlaceholders.includes(p)));
    
    // Fallback: Use enhanced manual style application with div removal
    console.log(`   🔄 Falling back to manual style application with div cleanup...`);
    styledHtml = await applyInlineStylesManuallyWithCleanup(templateHtml, layoutsData);
  }
  
  // Additional validation: Check for proper div removal
  const removedDivs = countDivs(templateHtml) - countDivs(styledHtml);
  if (removedDivs > 0) {
    console.log(`   🗑️  Removed ${removedDivs} unnecessary div(s) with data-test-id`);
  }
  
  const layoutInlineFile = `layout_inlineStyles_${sectionIndex}.html`;
  await fs.writeFile(
    path.join(outputDir, layoutInlineFile),
    styledHtml
  );
  
  console.log(`   ✅ Applied inline styles and cleaned up divs, saved to ${layoutInlineFile}`);
  
  return {
    styledHtml,
    layoutInlineFile
  };
}

// Helper function to count divs for validation
function countDivs(html) {
  const divMatches = html.match(/<div[^>]*>/g);
  return divMatches ? divMatches.length : 0;
}

// Enhanced fallback function with div cleanup
async function applyInlineStylesManuallyWithCleanup(templateHtml, layoutsData) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(templateHtml);
  
  // Process each div element
  $('div').each((index, element) => {
    const $div = $(element);
    const testId = $div.attr('data-test-id');
    
    // If div has data-test-id, check for required properties
    if (testId) {
      const hasLayoutProperties = checkForLayoutProperties($div, layoutsData, testId);
      
      if (!hasLayoutProperties) {
        // Remove div and its contents
        $div.remove();
        console.log(`   🗑️  Removed div with data-test-id="${testId}" (no layout properties)`);
        return;
      }
    }
    
    // Apply inline styles for remaining divs
    applyInlineStyles($div, layoutsData, testId);
  });
  
  return $.html();
}

// Helper function to check if element has grid/flex/position properties
function checkForLayoutProperties($element, layoutsData, testId) {
  if (!testId || !layoutsData[testId]) return false;
  
  const styles = layoutsData[testId];
  const layoutProps = [
    // Grid properties
    'display', 'grid-template-columns', 'grid-template-rows', 'grid-gap', 'gap',
    'grid-column', 'grid-row', 'grid-area', 'grid-template-areas',
    
    // Flex properties
    'flex-direction', 'justify-content', 'align-items', 'align-content',
    'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex',
    
    // Position properties
    'position', 'top', 'right', 'bottom', 'left', 'z-index'
  ];
  
  // Check if display is grid or flex
  if (styles.display === 'grid' || styles.display === 'flex') return true;
  
  // Check for any other layout properties
  return layoutProps.some(prop => styles.hasOwnProperty(prop));
}

// Helper function to apply inline styles
function applyInlineStyles($element, layoutsData, testId) {
  if (!testId || !layoutsData[testId]) return;
  
  const styles = layoutsData[testId];
  const existingStyle = $element.attr('style') || '';
  const newStyles = [];
  
  // Apply layout-related styles
  Object.keys(styles).forEach(property => {
    const value = styles[property];
    if (value && isLayoutProperty(property)) {
      newStyles.push(`${property}: ${value}`);
    }
  });
  
  if (newStyles.length > 0) {
    const combinedStyles = existingStyle ? 
      `${existingStyle}; ${newStyles.join('; ')}` : 
      newStyles.join('; ');
    $element.attr('style', combinedStyles);
  }
}

// Helper function to identify layout properties
function isLayoutProperty(property) {
  const layoutProperties = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'grid-template-columns', 'grid-template-rows', 'grid-gap', 'gap',
    'grid-column', 'grid-row', 'grid-area', 'grid-template-areas',
    'flex-direction', 'justify-content', 'align-items', 'align-content',
    'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex'
  ];
  
  return layoutProperties.includes(property);
}

async function generateBareMinimumHtml(sectionIndex, styledHtml, outputDir) {
  console.log(`   🔧 Step 3: Generating bare minimum HTML for section ${sectionIndex}...`);
  
  const prompt = `
CRITICAL REQUIREMENTS:
1. MUST wrap final output in {{template-n}} tags
2. MUST preserve ALL {{template-xx}} placeholders
3. MUST achieve 70-80% line reduction
4. MUST maintain pixel-perfect visual match
5. MUST use line-styles only (no classes, no <style> tags)
6. MUST use maximum CSS shorthand
7. MUST remove all unnecessary elements and wrappers
8. MUST use modern CSS techniques (Flexbox/Grid)

OPTIMIZATION TECHNIQUES TO USE:
- Remove ALL unnecessary wrapper divs
- Use CSS Grid/Flexbox efficiently
- Maximum CSS shorthand (inset, margin/padding shorthand)
- Combine redundant styles
- Eliminate empty/irrelevant elements

Original HTML (${styledHtml.split('\n').length} lines):
${styledHtml}

Provide optimized HTML wrapped in {{template-n}} tags (target ${Math.round(styledHtml.split('\n').length * 0.2)} lines):
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [
      {
        role: "system",
        content: `You are an HTML optimization expert. You MUST:
1. Maintain identical visual output 
2. Preserve ALL {{template-xx}} placeholders
3. Achieve maximum line reduction
4. Wrap output in {{template-n}} tags
5. Use maximum CSS shorthand
6. Keep only relavant elements`
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 4000
  });

  let bareHtml = completion.choices[0]?.message?.content || '';
  
  // Extract content from template tags
  const templateMatch = bareHtml.match(/\{\{template-n\}\}([\s\S]*?)\{\{\/template-n\}\}/);
  if (templateMatch) {
    bareHtml = templateMatch[1].trim();
  } else {
    bareHtml = bareHtml.replace(/```html/g, '').replace(/```/g, '').trim();
  }
  
  const bareMinimumFile = `bareminimum_section_${sectionIndex}.html`;
  await fs.writeFile(
    path.join(outputDir, bareMinimumFile),
    bareHtml
  );
  
  console.log(`   ✅ Generated bare minimum HTML, saved to ${bareMinimumFile}`);
  
  return {
    bareHtml,
    bareMinimumFile
  };
}

// === MAIN MIGRATION PROCESS ===
async function processAllSections(rawHtmlContent, computedStyles, outputDir) {
  console.log('🚀 Starting enhanced section-by-section migration process...\n');
  
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
          finalSize: step3Result.bareHtml.length,
          compressionRatio: ((sectionHtml.length - step3Result.bareHtml.length) / sectionHtml.length * 100).toFixed(1) + '%'
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
                            📊 Processed: \${data.processedSections}/\${data.totalSections} sections<br>
                            🎯 Total widgets: \${data.summary.totalWidgets}<br>
                            📉 Average compression: \${data.summary.averageCompression}
                        </div>
                    \`;
                    results.innerHTML = '<h3>📋 Detailed Results:</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
                    
                    // Update progress bar to 100%
                    document.getElementById('progressBar').style.width = '100%';
                    document.getElementById('progressText').textContent = 'Migration completed successfully!';
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
                        'Step 1': data.files.filter(f => f.startsWith('step1_')),
                        'Step 2': data.files.filter(f => f.startsWith('step2_')),
                        'Step 3': data.files.filter(f => f.startsWith('step3_')),
                        'Step 4': data.files.filter(f => f.startsWith('step4_')),
                        'Final': data.files.filter(f => f.startsWith('final_') || f.startsWith('migration_'))
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


// const express = require('express');
// const fs = require('fs/promises');
// const path = require('path');
// const { OpenAI } = require('openai');
// const cheerio = require('cheerio');
// require('dotenv').config();

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Initialize OpenAI with API key from environment
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY
// });

// app.use(express.json({ limit: '50mb' }));
// app.use(express.static('public'));

// // === Widget Tags Configuration ===
// const widgetTags = new Set([
//   'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SVG', 'IMG', 'IMAGE', 'VIDEO',
//   'SPAN', 'BUTTON', 'A', 'TEXT', 'WOW-IMAGE', 'WOW-VIDEO', 'WOW-SVG', 'WOW-ICON', 'WOW-CANVAS'
// ]);

// // === Layout Styles Configuration ===
// const allowedLayoutStyles = new Set([
//   'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent',
//   'alignSelf', 'order', 'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
//   'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'gridColumnStart',
//   'gridColumnEnd', 'gridRowStart', 'gridRowEnd', 'gridArea', 'placeItems', 'placeContent',
//   'placeSelf', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
//   'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'backgroundColor'
// ]);

// // === Widget Font/Text Styles ===
// const fontAndTextStyles = new Set([
//   'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
//   'textAlign', 'textDecoration', 'textDecorationColor', 'textShadow', 'textTransform',
//   'textOverflow', 'whiteSpace', 'wordBreak', 'wordWrap', 'overflowWrap',
//   'textSizeAdjust', 'caretColor', 'color', 'outlineColor', 'textEmphasisColor',
//   '-webkitTextFillColor', '-webkitTextStrokeColor'
// ]);

// // === Widget Image/SVG/Video Styles ===
// const svgImageStyles = new Set([
//   'fill', 'stroke', 'strokeWidth', 'strokeOpacity', 'vectorEffect', 'transformOrigin',
//   'perspectiveOrigin', 'display', 'position', 'top', 'right', 'bottom', 'left',
//   'width', 'height', 'blockSize', 'inlineSize',
//   'insetBlockStart', 'insetBlockEnd', 'insetInlineStart', 'insetInlineEnd',
//   '-webkitTapHighlightColor'
// ]);

// // === Common Background & Color Styles ===
// const colorBackgroundStyles = new Set([
//   'background', 'backgroundColor', 'backgroundImage', 'color'
// ]);

// // === Helper Functions ===
// function toCamelCase(str) {
//   return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
// }

// function filterLayoutStyles(styles) {
//   const result = {};
//   for (const key in styles) {
//     const camelKey = toCamelCase(key);
//     if (allowedLayoutStyles.has(camelKey) || camelKey.startsWith('background')) {
//       result[key] = styles[key];
//     }
//   }
//   return result;
// }

// function filterWidgetStyles(styles) {
//   const result = {};
//   for (const key in styles) {
//     const camelKey = toCamelCase(key);
//     if (
//       fontAndTextStyles.has(camelKey) ||
//       svgImageStyles.has(camelKey) ||
//       colorBackgroundStyles.has(camelKey)
//     ) {
//       result[key] = styles[key];
//     }
//   }
//   return result;
// }

// function splitNode(node) {
//   if (!node || typeof node !== 'object') return { layout: null, widget: null };

//   const isWidget = widgetTags.has((node.tag || '').toUpperCase());

//   const layoutStyles = node.styles ? filterLayoutStyles(node.styles) : {};
//   const widgetStyles = node.styles ? filterWidgetStyles(node.styles) : {};

//   const children = Array.isArray(node.children) ? node.children.map(splitNode) : [];

//   const layoutChildren = children.map(c => c.layout).filter(Boolean);
//   const widgetChildren = children.map(c => c.widget).filter(Boolean);

//   const baseProps = {
//     tag: node.tag,
//     id: node.id || '',
//     className: node.className || '',
//     html: node.html
//   };

//   const layoutNode = !isWidget && (Object.keys(layoutStyles).length > 0 || layoutChildren.length > 0)
//     ? {
//         ...baseProps,
//         ...(Object.keys(layoutStyles).length > 0 ? { styles: layoutStyles } : {}),
//         ...(layoutChildren.length > 0 ? { children: layoutChildren } : {})
//       }
//     : null;

//   const widgetNode = isWidget
//     ? {
//         ...baseProps,
//         ...(Object.keys(widgetStyles).length > 0 ? { styles: widgetStyles } : {}),
//         ...(widgetChildren.length > 0 ? { children: widgetChildren } : {})
//       }
//     : widgetChildren.length > 0 ? widgetChildren.length === 1 ? widgetChildren[0] : widgetChildren : null;

//   return { layout: layoutNode, widget: widgetNode };
// }

// // === INITIAL PREPARATION STEPS ===

// // Step 1: Extract individual sections from raw.html
// async function extractSectionsFromHtml(rawHtmlContent, outputDir) {
//   console.log('🔍 Step 1: Extracting individual sections from raw.html...');
  
//   const $ = cheerio.load(rawHtmlContent);
  
//   // Find only top-level sections (direct children of body or html)
//   const topLevelSections = $('body > section, html > section').toArray();
  
//   // If no direct children, fall back to all sections but filter for top-level ones
//   const sections = topLevelSections.length > 0 
//     ? topLevelSections 
//     : $('section').filter((i, el) => {
//         // A section is top-level if it's not nested inside another section
//         return $(el).parents('section').length === 0;
//       }).toArray();
  
//   console.log(`   Found ${sections.length} top-level sections`);
  
//   const sectionFiles = [];
  
//   for (let i = 0; i < sections.length; i++) {
//     const sectionHtml = $.html(sections[i]);
//     const filename = `section_${i}.html`;
//     const filepath = path.join(outputDir, filename);
    
//     await fs.writeFile(filepath, sectionHtml);
//     sectionFiles.push({
//       index: i,
//       filename,
//       size: sectionHtml.length
//     });
    
//     console.log(`   ✅ Saved ${filename} (${sectionHtml.length} chars)`);
//   }
  
//   return sectionFiles;
// }

// // Step 2: Split computed styles into widgets and layouts for each section
// async function splitComputedStyles(computedStyles, outputDir) {
//   console.log('🔧 Step 2: Splitting computed styles into widgets and layouts...');
  
//   const sectionKeys = Object.keys(computedStyles);
//   const splitResults = [];
  
//   for (let i = 0; i < sectionKeys.length; i++) {
//     const sectionKey = sectionKeys[i];
//     const sectionData = computedStyles[sectionKey];
    
//     // Split into widgets and layouts
//     const { layout, widget } = splitNode(sectionData);
    
//     // Save widgets JSON
//     const widgetsFilename = `widgets_json_${i}.json`;
//     const widgetsData = widget ? { [sectionKey]: widget } : {};
//     await fs.writeFile(
//       path.join(outputDir, widgetsFilename),
//       JSON.stringify(widgetsData, null, 2)
//     );
    
//     // Save layouts JSON
//     const layoutsFilename = `layouts_json_${i}.json`;
//     const layoutsData = layout ? { [sectionKey]: layout } : {};
//     await fs.writeFile(
//       path.join(outputDir, layoutsFilename),
//       JSON.stringify(layoutsData, null, 2)
//     );
    
//     splitResults.push({
//       index: i,
//       sectionKey,
//       widgetsFile: widgetsFilename,
//       layoutsFile: layoutsFilename,
//       hasWidgets: !!widget,
//       hasLayouts: !!layout
//     });
    
//     console.log(`   ✅ Section ${i} (${sectionKey}): widgets=${!!widget}, layouts=${!!layout}`);
//   }
  
//   return splitResults;
// }

// // === RECURSIVE PROCESSING STEPS ===

// // Step 1 of recursive process: Replace widgets with placeholders
// async function processWidgetPlaceholders(sectionIndex, sectionHtml, widgetsData, outputDir, globalTemplates) {
//   console.log(`   🎯 Step 1: Processing widget placeholders for section ${sectionIndex}...`);
  
//   try {
//     // Initialize the widget processor with in-memory data
//     const processor = new WidgetProcessor({
//       htmlContent: sectionHtml,
//       computedStyles: widgetsData
//     });

//     await processor.init();
//     const widgets = await processor.extractWidgets();
//     const results = await processor.processAllWidgets();

//     // Get the processed HTML with placeholders
//     const processedHtml = processor.getProcessedHtml();

//     // Collect all templates from the processing
//     const templates = [];
//     for (const widget of widgets) {
//       try {
//         const widgetResult = results.find(r => r.widget_id === widget.placeholder);
        
//         templates.push({
//           id: widget.placeholder.replace(/\{\{|\}\}/g, ''),
//         //   type: widget.tagName,
//         //   tagName: widget.tagName,
//           className: widget.classes,
//         //   idAttr: widget.id,
//           innerHTML: widget.html,
//         //   textContent: widget.textContent,
//           styles: widgetResult?.styles || {},
//         //   attributes: widget.attributes
//         });
//       } catch (error) {
//         console.error(`Failed to process widget ${widget.id}:`, error.message);
//       }
//     }

//     // Save template section HTML
//     const templateSectionFile = `template_section_${sectionIndex}.html`;
//     await fs.writeFile(
//       path.join(outputDir, templateSectionFile),
//       processedHtml
//     );

//     // Save local placeholders
//     const placeholdersFile = `template_section_${sectionIndex}_placeholders.json`;
//     await fs.writeFile(
//       path.join(outputDir, placeholdersFile),
//       JSON.stringify(templates, null, 2)
//     );

//     // Update global templates
//     globalTemplates.push(...templates);

//     console.log(`   ✅ Created ${templates.length} placeholders, saved to ${templateSectionFile}`);

//     return {
//       processedHtml,
//       templates,
//       templateSectionFile,
//       placeholdersFile
//     };

//   } catch (error) {
//     console.error('Failed to process widget placeholders:', error);
//     throw error;
//   }
// }

// // WidgetProcessor class implementation
// class WidgetProcessor {
//   constructor(options = {}) {
//     this.widgets = [];
//     this.computedStyles = options.computedStyles || null;
//     this.htmlContent = options.htmlContent || '';
//     this.processedHtml = '';
//     this.openai = new OpenAI({
//       apiKey: process.env.OPENAI_API_KEY
//     });
//   }

//   async init() {
//     try {
//       if (!this.computedStyles) {
//         throw new Error('Computed styles data is required');
//       }
      
//       console.log('✓ Initialized successfully');
//       console.log(`✓ Loaded computed styles with ${Object.keys(this.computedStyles).length} entries`);
//     } catch (error) {
//       console.error('❌ Initialization failed:', error.message);
//       throw error;
//     }
//   }

//   async extractWidgets() {
//     try {
//       console.log('📖 Processing HTML content...');
//       const $ = cheerio.load(this.htmlContent);

//       // Use the same widget tags as defined in the main code
//       const widgetElements = [
//         'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'svg', 'img', 'image', 'video',
//         'span', 'button', 'a', 'text', 'wow-image', 'wow-video', 'wow-svg', 
//         'wow-icon', 'wow-canvas'
//       ];

//       let widgetCount = 0;

//       // Extract only specified widget elements
//       widgetElements.forEach(tagName => {
//         $(tagName).each((index, element) => {
//           const $element = $(element);
//           widgetCount++;
          
//           const widget = {
//             id: widgetCount,
//             placeholder: `{{template-${widgetCount}}}`,
//             html: $.html($element),
//             tagName: tagName.toLowerCase(),
//             selector: tagName,
//             classes: $element.attr('class') || '',
//             id: $element.attr('id') || '',
//             attributes: this.getElementAttributes($element),
//             textContent: $element.text().trim().substring(0, 100) // First 100 chars for reference
//           };

//           this.widgets.push(widget);
          
//           // Replace with placeholder
//           $element.replaceWith(widget.placeholder);
//         });
//       });

//       // Store processed HTML
//       this.processedHtml = $.html();
      
//       console.log(`✓ Extracted ${this.widgets.length} widget elements`);
//       console.log(`✓ Widget types found: ${this.getWidgetStats()}`);
      
//       return this.widgets;
//     } catch (error) {
//       console.error('❌ Widget extraction failed:', error.message);
//       throw error;
//     }
//   }

//   getWidgetStats() {
//     const stats = {};
//     this.widgets.forEach(widget => {
//       stats[widget.tagName] = (stats[widget.tagName] || 0) + 1;
//     });
//     return Object.entries(stats).map(([tag, count]) => `${tag}(${count})`).join(', ');
//   }

//   getElementAttributes(element) {
//     const attributes = {};
//     if (element.attribs) {
//       Object.keys(element.attribs).forEach(key => {
//         // Skip class and id as they're handled separately
//         if (key !== 'class' && key !== 'id') {
//           attributes[key] = element.attribs[key];
//         }
//       });
//     }
//     return attributes;
//   }

//   getProcessedHtml() {
//     return this.processedHtml;
//   }

//   async processWidgetWithAI(widget) {
//     try {
//       console.log(`🤖 Processing widget-${widget.id} with AI...`);
      
//       const prompt = `
// Analyze this HTML widget element and extract its styles and attributes. Return a clean JSON object with the following structure:

// {
//   "widget_id": "${widget.placeholder}",
//   "type": "${widget.tagName}",
//   "styles": {
//     // All relevant CSS styles for this widget
//   }
// }

// Widget HTML:
// ${widget.html}

// Text Content: ${widget.textContent}

// Requirements:
// 1. Extract only styles that apply to this specific widget
// 2. Convert styles to camelCase format
// 3. Include only relevant styles for the widget type
// 4. Preserve all important attributes
// 5. Return valid JSON only
// `;

//       const response = await this.openai.chat.completions.create({
//         model: 'gpt-3.5-turbo',
//         messages: [
//           {
//             role: 'system',
//             content: 'You are a CSS expert that converts computed styles to clean CSS objects. Return only valid JSON.'
//           },
//           {
//             role: 'user',
//             content: prompt
//           }
//         ],
//         temperature: 0.1,
//         max_tokens: 2000
//       });

//       const result = response.choices[0].message.content;
//       let cleanedResult = result.replace(/```json|```/g, '').trim();
      
//       try {
//         return JSON.parse(cleanedResult);
//       } catch (parseError) {
//         console.warn(`⚠️ Failed to parse AI response for widget-${widget.id}`);
//         return {
//           widget_id: widget.placeholder,
//           error: 'Failed to parse JSON response',
//           raw_response: result
//         };
//       }
//     } catch (error) {
//       console.error(`❌ AI processing failed for widget-${widget.id}:`, error.message);
//       return {
//         widget_id: widget.placeholder,
//         error: error.message
//       };
//     }
//   }

//   async processAllWidgets() {
//     console.log(`🚀 Starting AI processing for ${this.widgets.length} widgets...`);
    
//     const results = [];
    
//     for (const widget of this.widgets) {
//       try {
//         const result = await this.processWidgetWithAI(widget);
//         results.push(result);
        
//         // Add delay to respect API rate limits
//         await new Promise(resolve => setTimeout(resolve, 500));
//       } catch (error) {
//         console.error(`❌ Failed to process widget-${widget.id}:`, error.message);
//         results.push({
//           widget_id: widget.placeholder,
//           error: error.message
//         });
//       }
//     }

//     return results;
//   }
// }

// async function applyInlineLayoutStyles(sectionIndex, templateHtml, layoutsData, outputDir) {
//   console.log(`   🎨 Step 2: Applying inline layout styles for section ${sectionIndex}...`);
  
//   // Extract and protect placeholders before AI processing
//   const placeholderMap = new Map();
//   let protectedHtml = templateHtml;
  
//   // Find all {{template-n}} placeholders and replace with unique tokens
//   const placeholderRegex = /\{\{template-\d+\}\}/g;
//   let match;
//   let counter = 0;
  
//   while ((match = placeholderRegex.exec(templateHtml)) !== null) {
//     const placeholder = match[0];
//     const token = `__PROTECTED_PLACEHOLDER_${counter}__`;
//     placeholderMap.set(token, placeholder);
//     protectedHtml = protectedHtml.replace(placeholder, token);
//     counter++;
//   }
  
//   const prompt = `
//  PROCESS THIS HTML CONTENT WITH THESE REQUIREMENTS:
//         1. Apply ONLY grid/flex/position CSS properties from the JSON layout
//         2. PRESERVE ALL {{template-n}} PLACEHOLDERS EXACTLY AS THEY ARE
//         3. Return ONLY the modified HTML with inline styles
//         4. Do not modify any content between {{ and }}
//         5. Do not add any explanations or additional text


// HTML to process (WITH PROTECTED TOKENS):
// ${protectedHtml}

// Layout Styles Data:
// ${JSON.stringify(layoutsData, null, 2)}

// `;

//   const completion = await openai.chat.completions.create({
//     model: 'gpt-4o-mini',
//     messages: [
//       {
//         role: 'user',
//         content: prompt
//       }
//     ],
//     temperature: 0.3,  // Set to 0 for maximum consistency
//     max_tokens: 4096
//   });

//   let styledHtml = completion.choices[0]?.message?.content || '';
  
//   // Clean up any markdown formatting
//   styledHtml = styledHtml.replace(/```html/g, '').replace(/```/g, '').trim();
  
//   // Restore original placeholders
//   for (const [token, placeholder] of placeholderMap) {
//     styledHtml = styledHtml.replace(new RegExp(token, 'g'), placeholder);
//   }
  
//   // VALIDATION: Check if all original placeholders are present
//   const originalPlaceholders = templateHtml.match(/\{\{template-\d+\}\}/g) || [];
//   const finalPlaceholders = styledHtml.match(/\{\{template-\d+\}\}/g) || [];
  
//   if (originalPlaceholders.length !== finalPlaceholders.length) {
//     console.error(`❌ ERROR: Placeholder count mismatch!`);
//     console.error(`Original: ${originalPlaceholders.length}, Final: ${finalPlaceholders.length}`);
//     console.error(`Missing placeholders:`, originalPlaceholders.filter(p => !finalPlaceholders.includes(p)));
    
//     // Fallback: Use original HTML with manual inline style application
//     console.log(`   🔄 Falling back to manual style application...`);
//     styledHtml = await applyInlineStylesManually(templateHtml, layoutsData);
//   }
  
//   const layoutInlineFile = `layout_inlineStyles_${sectionIndex}.html`;
//   await fs.writeFile(
//     path.join(outputDir, layoutInlineFile),
//     styledHtml
//   );
  
//   console.log(`   ✅ Applied inline styles, saved to ${layoutInlineFile}`);
  
//   return {
//     styledHtml,
//     layoutInlineFile
//   };
// }

// async function applyInlineStylesManually(html, layoutsData) {
//   // Fallback implementation for when AI fails
//   // This would need to be implemented based on your specific requirements
//   return html;
// }

// async function generateBareMinimumHtml(sectionIndex, styledHtml, outputDir) {
//   console.log(`   🔧 Step 3: Generating bare minimum HTML for section ${sectionIndex}...`);
  
//   const prompt = `
// CRITICAL REQUIREMENTS:
// 1. MUST wrap final output in {{template-n}} tags
// 2. MUST preserve ALL {{template-xx}} placeholders
// 3. MUST achieve 70-80% line reduction
// 4. MUST maintain pixel-perfect visual match
// 5. MUST use line-styles only (no classes, no <style> tags)
// 6. MUST use maximum CSS shorthand
// 7. MUST remove all unnecessary elements and wrappers
// 8. MUST use modern CSS techniques (Flexbox/Grid)

// OPTIMIZATION TECHNIQUES TO USE:
// - Remove ALL unnecessary wrapper divs
// - Use CSS Grid/Flexbox efficiently
// - Maximum CSS shorthand (inset, margin/padding shorthand)
// - Combine redundant styles
// - Eliminate empty/irrelevant elements

// Original HTML (${styledHtml.split('\n').length} lines):
// ${styledHtml}

// Provide optimized HTML wrapped in {{template-n}} tags (target ${Math.round(styledHtml.split('\n').length * 0.2)} lines):
// `;

//   const completion = await openai.chat.completions.create({
//     model: "gpt-4-turbo",
//     messages: [
//       {
//         role: "system",
//         content: `You are an HTML optimization expert. You MUST:
// 1. Maintain identical visual output 
// 2. Preserve ALL {{template-xx}} placeholders
// 3. Achieve maximum line reduction
// 4. Wrap output in {{template-n}} tags
// 5. Use maximum CSS shorthand
// 6. Keep only relavant elements`
//       },
//       {
//         role: "user",
//         content: prompt
//       }
//     ],
//     temperature: 0.1,
//     max_tokens: 4000
//   });

//   let bareHtml = completion.choices[0]?.message?.content || '';
  
//   // Extract content from template tags
//   const templateMatch = bareHtml.match(/\{\{template-n\}\}([\s\S]*?)\{\{\/template-n\}\}/);
//   if (templateMatch) {
//     bareHtml = templateMatch[1].trim();
//   } else {
//     bareHtml = bareHtml.replace(/```html/g, '').replace(/```/g, '').trim();
//   }
  
//   const bareMinimumFile = `bareminimum_section_${sectionIndex}.html`;
//   await fs.writeFile(
//     path.join(outputDir, bareMinimumFile),
//     bareHtml
//   );
  
//   console.log(`   ✅ Generated bare minimum HTML, saved to ${bareMinimumFile}`);
  
//   return {
//     bareHtml,
//     bareMinimumFile
//   };
// }

// // === MAIN MIGRATION PROCESS ===
// async function processAllSections(rawHtmlContent, computedStyles, outputDir) {
//   console.log('🚀 Starting enhanced section-by-section migration process...\n');
  
//   // === INITIAL PREPARATION STEPS ===
//   console.log('=== INITIAL PREPARATION STEPS ===');
  
//   // Step 1: Extract sections from raw HTML
//   const sectionFiles = await extractSectionsFromHtml(rawHtmlContent, outputDir);
  
//   // Step 2: Split computed styles into widgets and layouts
//   const splitResults = await splitComputedStyles(computedStyles, outputDir);
  
//   console.log(`✅ Preparation complete: ${sectionFiles.length} sections extracted and styles split\n`);
  
//   // === RECURSIVE PROCESSING ===
//   console.log('=== RECURSIVE SECTION PROCESSING ===');
  
//   const globalTemplates = [];
//   const processedSections = [];
  
//   for (let i = 0; i < sectionFiles.length; i++) {
//     console.log(`\n--- Processing Section ${i} ---`);
    
//     try {
//       // Read section HTML
//       const sectionHtml = await fs.readFile(
//         path.join(outputDir, `section_${i}.html`), 
//         'utf8'
//       );
      
//       // Read widgets data
//       const widgetsData = JSON.parse(
//         await fs.readFile(path.join(outputDir, `widgets_json_${i}.json`), 'utf8')
//       );
      
//       // Read layouts data
//       const layoutsData = JSON.parse(
//         await fs.readFile(path.join(outputDir, `layouts_json_${i}.json`), 'utf8')
//       );
      
//       // Step 1: Process widget placeholders
//       const step1Result = await processWidgetPlaceholders(
//         i, sectionHtml, widgetsData, outputDir, globalTemplates
//       );
      
//       // Step 2: Apply inline layout styles
//       const step2Result = await applyInlineLayoutStyles(
//         i, step1Result.processedHtml, layoutsData, outputDir
//       );
      
//       // Step 3: Generate bare minimum HTML
//       const step3Result = await generateBareMinimumHtml(
//         i, step2Result.styledHtml, outputDir
//       );
      
//       // Track section processing results
//       processedSections.push({
//         index: i,
//         sectionKey: splitResults[i]?.sectionKey || `section_${i}`,
//         files: {
//           original: `section_${i}.html`,
//           template: step1Result.templateSectionFile,
//           placeholders: step1Result.placeholdersFile,
//           layoutInline: step2Result.layoutInlineFile,
//           bareMinimum: step3Result.bareMinimumFile
//         },
//         stats: {
//           templatesCreated: step1Result.templates.length,
//           originalSize: sectionHtml.length,
//           finalSize: step3Result.bareHtml.length,
//           compressionRatio: ((sectionHtml.length - step3Result.bareHtml.length) / sectionHtml.length * 100).toFixed(1) + '%'
//         }
//       });
      
//       console.log(`✅ Section ${i} completed successfully`);
//       console.log(`   - Templates created: ${step1Result.templates.length}`);
//       console.log(`   - Compression: ${processedSections[i].stats.compressionRatio}`);
      
//     } catch (error) {
//       console.error(`❌ Error processing section ${i}:`, error.message);
//       processedSections.push({
//         index: i,
//         error: error.message,
//         failed: true
//       });
//     }
//   }
  
//   // Save global templates
//   await fs.writeFile(
//     path.join(outputDir, 'template.json'),
//     JSON.stringify(globalTemplates, null, 2)
//   );
  
//   console.log(`\n✅ Global templates saved: ${globalTemplates.length} total templates`);
  
//   return {
//     sectionFiles,
//     splitResults,
//     processedSections,
//     globalTemplates,
//     summary: {
//       totalSections: sectionFiles.length,
//       successfulSections: processedSections.filter(s => !s.failed).length,
//       failedSections: processedSections.filter(s => s.failed).length,
//       totalTemplates: globalTemplates.length,
//       averageCompression: processedSections.filter(s => !s.failed).length > 0
//         ? (processedSections.filter(s => !s.failed).reduce((sum, s) => sum + parseFloat(s.stats?.compressionRatio || '0'), 0) / processedSections.filter(s => !s.failed).length).toFixed(1) + '%'
//         : '0%'
//     }
//   };
// }

// // === API Routes ===
// app.post('/api/migrate', async (req, res) => {
//   try {
//     console.log('🚀 Starting enhanced HTML migration process...');
    
//     if (!process.env.OPENAI_API_KEY) {
//       return res.status(500).json({ 
//         error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.' 
//       });
//     }

//     // Ensure output directory exists
//     const outputDir = path.join(__dirname, 'output');
//     try {
//       await fs.mkdir(outputDir, { recursive: true });
//     } catch (err) {
//       // Directory might already exist
//     }

//     // Load input files
//     const computedStylesPath = path.join(__dirname, 'computed-styles.json');
//     const rawHtmlPath = path.join(__dirname, 'raw.html');

//     let computedStyles, rawHtmlContent;
    
//     try {
//       const computedStylesContent = await fs.readFile(computedStylesPath, 'utf8');
//       computedStyles = JSON.parse(computedStylesContent);
//     } catch (error) {
//       return res.status(400).json({ 
//         error: 'Could not load computed-styles.json', 
//         message: error.message 
//       });
//     }

//     try {
//       rawHtmlContent = await fs.readFile(rawHtmlPath, 'utf8');
//     } catch (error) {
//       return res.status(400).json({ 
//         error: 'Could not load raw.html', 
//         message: error.message 
//       });
//     }

//     // Process all sections
//     const results = await processAllSections(rawHtmlContent, computedStyles, outputDir);

//     // Generate final migration report
//     const migrationReport = {
//       success: true,
//       timestamp: new Date().toISOString(),
//       ...results,
//       message: `Successfully processed ${results.summary.successfulSections}/${results.summary.totalSections} sections`
//     };

//     await fs.writeFile(
//       path.join(outputDir, 'migration_report.json'),
//       JSON.stringify(migrationReport, null, 2)
//     );

//     console.log('\n🎉 Enhanced migration completed!');
//     console.log(`✅ Successfully processed: ${results.summary.successfulSections} sections`);
//     console.log(`❌ Failed: ${results.summary.failedSections} sections`);
//     console.log(`📊 Total templates created: ${results.summary.totalTemplates}`);
//     console.log(`📉 Average compression: ${results.summary.averageCompression}`);

//     res.json(migrationReport);

//   } catch (error) {
//     console.error('Migration failed:', error);
//     res.status(500).json({
//       error: 'Migration failed',
//       message: error.message
//     });
//   }
// });

// // Status endpoint
// app.get('/api/status', async (req, res) => {
//   try {
//     const computedStylesExists = await fs.access(path.join(__dirname, 'computed-styles.json')).then(() => true).catch(() => false);
//     const rawHtmlExists = await fs.access(path.join(__dirname, 'raw.html')).then(() => true).catch(() => false);
    
//     res.json({
//       status: 'ready',
//       openaiConfigured: !!process.env.OPENAI_API_KEY,
//       filesReady: {
//         computedStyles: computedStylesExists,
//         rawHtml: rawHtmlExists
//       },
//       timestamp: new Date().toISOString()
//     });
//   } catch (error) {
//     res.json({
//       status: 'error',
//       message: error.message,
//       timestamp: new Date().toISOString()
//     });
//   }
// });

// // File listing endpoint
// app.get('/api/files', async (req, res) => {
//   try {
//     const outputDir = path.join(__dirname, 'output');
//     let files = [];
    
//     try {
//       const dirContents = await fs.readdir(outputDir);
//       files = dirContents.filter(file => file.endsWith('.json') || file.endsWith('.html'));
//     } catch (error) {
//       // Output directory doesn't exist yet
//     }
    
//     // Categorize files
//     const fileCategories = {
//       preparation: files.filter(f => f.startsWith('section_') || f.startsWith('widgets_json_') || f.startsWith('layouts_json_')),
//       templates: files.filter(f => f.startsWith('template_section_') || f === 'template.json'),
//       layouts: files.filter(f => f.startsWith('layout_inlineStyles_')),
//       bareMinimum: files.filter(f => f.startsWith('bareminimum_section_')),
//       reports: files.filter(f => f.includes('report') || f.includes('summary'))
//     };
    
//     res.json({ 
//       files, 
//       count: files.length,
//       categories: fileCategories
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/', (req, res) => {
//   res.send(`
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
//         <div class="step">Step 1: Extract widgets & layout from computed styles</div>
//         <div class="step">Step 2: Process section HTML with AI template generation</div>
//         <div class="step">Step 3: Apply inline layout styles</div>
//         <div class="step">Step 4: Generate bare minimum optimized HTML</div>
        
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
//                 const response = await fetch('/api/migrate', {
//                     method: 'POST',
//                     headers: { 'Content-Type': 'application/json' }
//                 });
                
//                 const data = await response.json();
                
//                 if (data.success) {
//                     status.innerHTML = \`
//                         <div class="status success">
//                             ✅ Migration completed successfully!<br>
//                             📊 Processed: \${data.processedSections}/\${data.totalSections} sections<br>
//                             🎯 Total widgets: \${data.summary.totalWidgets}<br>
//                             📉 Average compression: \${data.summary.averageCompression}
//                         </div>
//                     \`;
//                     results.innerHTML = '<h3>📋 Detailed Results:</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
                    
//                     // Update progress bar to 100%
//                     document.getElementById('progressBar').style.width = '100%';
//                     document.getElementById('progressText').textContent = 'Migration completed successfully!';
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
//                 setTimeout(() => {
//                     progress.style.display = 'none';
//                 }, 3000);
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
//                         'Step 1': data.files.filter(f => f.startsWith('step1_')),
//                         'Step 2': data.files.filter(f => f.startsWith('step2_')),
//                         'Step 3': data.files.filter(f => f.startsWith('step3_')),
//                         'Step 4': data.files.filter(f => f.startsWith('step4_')),
//                         'Final': data.files.filter(f => f.startsWith('final_') || f.startsWith('migration_'))
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
        
//         // Check status on page load
//         window.addEventListener('load', checkStatus);
        
//         // Simulate progress updates (in a real implementation, you'd use WebSockets or Server-Sent Events)
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
        
//         // Start progress simulation when migration begins
//         document.getElementById('migrateBtn').addEventListener('click', () => {
//             setTimeout(simulateProgress, 1000);
//         });
//     </script>
// </body>
// </html>
//   `);
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Section-by-Section Migration Server running on http://localhost:${PORT}`);
//   console.log(`📋 OpenAI API Key configured: ${!!process.env.OPENAI_API_KEY}`);
//   console.log(`📁 Working directory: ${__dirname}`);
//   console.log(`📂 Output directory: ${path.join(__dirname, 'output')}`);
//   console.log(`\n📋 Required files:`);
//   console.log(`   - computed-styles.json (computed styles data)`);
//   console.log(`   - raw.html (raw HTML content)`);
//   console.log(`\n🔄 Processing pipeline:`);
//   console.log(`   Step 1: Extract widgets & layout from computed styles`);
//   console.log(`   Step 2: Process section HTML with AI template generation`);
//   console.log(`   Step 3: Apply inline layout styles`);
//   console.log(`   Step 4: Generate optimized bare minimum HTML`);
// });

// module.exports = app;