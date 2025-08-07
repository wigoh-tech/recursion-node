const express = require('express');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
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

let mainOpenAI;
if (isMainThread) {
  mainOpenAI = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

let allSections = [];
let browserProcess = null;

// Widget elements to extract
const WIDGET_ELEMENTS = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'svg', 'img', 'image',
    'video', 'span', 'button', 'a', 'text', 'wow-image', 'wix-video',
    'wow-svg', 'wow-icon', 'wow-canvas'
];

// ===== ZOD VALIDATION SCHEMAS =====
const CSSPositionSchema = z.object({
  position: z.enum(['static', 'relative', 'absolute', 'fixed', 'sticky']).optional(),
  top: z.string().optional(),
  right: z.string().optional(),
  bottom: z.string().optional(),
  left: z.string().optional(),
  zIndex: z.union([z.string(), z.number()]).optional()
});

const CSSBackgroundSchema = z.object({
  backgroundColor: z.string().optional(),
  backgroundImage: z.string().optional(),
  backgroundSize: z.string().optional(),
  backgroundPosition: z.string().optional(),
  backgroundRepeat: z.string().optional(),
  backgroundAttachment: z.string().optional(),
  backgroundClip: z.string().optional(),
  backgroundOrigin: z.string().optional(),
  background: z.string().optional()
});

const CSSFlexSchema = z.object({
  display: z.string().optional(),
  flexDirection: z.string().optional(),
  flexWrap: z.string().optional(),
  flexFlow: z.string().optional(),
  justifyContent: z.string().optional(),
  alignItems: z.string().optional(),
  alignContent: z.string().optional(),
  flex: z.string().optional(),
  flexGrow: z.union([z.string(), z.number()]).optional(),
  flexShrink: z.union([z.string(), z.number()]).optional(),
  flexBasis: z.string().optional(),
  alignSelf: z.string().optional(),
  order: z.union([z.string(), z.number()]).optional(),
  gap: z.string().optional(),
  rowGap: z.string().optional(),
  columnGap: z.string().optional()
});

const CSSGridSchema = z.object({
  display: z.string().optional(),
  gridTemplateColumns: z.string().optional(),
  gridTemplateRows: z.string().optional(),
  gridTemplateAreas: z.string().optional(),
  gridTemplate: z.string().optional(),
  gridColumnGap: z.string().optional(),
  gridRowGap: z.string().optional(),
  gridGap: z.string().optional(),
  gap: z.string().optional(),
  justifyItems: z.string().optional(),
  alignItems: z.string().optional(),
  placeItems: z.string().optional(),
  justifyContent: z.string().optional(),
  alignContent: z.string().optional(),
  placeContent: z.string().optional(),
  gridAutoColumns: z.string().optional(),
  gridAutoRows: z.string().optional(),
  gridAutoFlow: z.string().optional(),
  gridColumn: z.string().optional(),
  gridRow: z.string().optional(),
  gridArea: z.string().optional(),
  justifySelf: z.string().optional(),
  alignSelf: z.string().optional(),
  placeSelf: z.string().optional()
});

const CSSDimensionsSchema = z.object({
  width: z.string().optional(),
  height: z.string().optional(),
  minWidth: z.string().optional(),
  minHeight: z.string().optional(),
  maxWidth: z.string().optional(),
  maxHeight: z.string().optional(),
  boxSizing: z.string().optional()
});

const CSSSpacingSchema = z.object({
  margin: z.string().optional(),
  marginTop: z.string().optional(),
  marginRight: z.string().optional(),
  marginBottom: z.string().optional(),
  marginLeft: z.string().optional(),
  padding: z.string().optional(),
  paddingTop: z.string().optional(),
  paddingRight: z.string().optional(),
  paddingBottom: z.string().optional(),
  paddingLeft: z.string().optional()
});

const CSSVisualSchema = z.object({
  opacity: z.union([z.string(), z.number()]).optional(),
  visibility: z.string().optional(),
  overflow: z.string().optional(),
  overflowX: z.string().optional(),
  overflowY: z.string().optional(),
  transform: z.string().optional(),
  transformOrigin: z.string().optional(),
  filter: z.string().optional(),
  backdropFilter: z.string().optional(),
  clipPath: z.string().optional(),
  maskPosition: z.string().optional(),
  maskRepeat: z.string().optional(),
  maskSize: z.string().optional()
});

const BgLayersResultSchema = z.object({
  id: z.string(),
  success: z.boolean(),
  html: z.string(),
  error: z.string().optional(),
  originalDivCount: z.number(),
  optimizedDivCount: z.number(),
  widgetContent: z.string().optional()
});

const FlexGridResultSchema = z.object({
  id: z.string(),
  success: z.boolean(),
  html: z.string(),
  error: z.string().optional(),
  originalDivCount: z.number(),
  optimizedDivCount: z.number(),
  templatePlaceholders: z.array(z.string()).optional(),
  depth: z.number().optional()
});

// ===== VALIDATION FUNCTIONS =====
const extractCSSProperties = (htmlString) => {
  const styleMatch = htmlString.match(/style="([^"]+)"/);
  if (!styleMatch) return {};
 
  const styleString = styleMatch[1];
  const properties = {};
 
  const cssRegex = /([a-zA-Z-]+)\s*:\s*([^;]+);?/g;
  let match;
 
  while ((match = cssRegex.exec(styleString)) !== null) {
    const prop = match[1].replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    properties[prop] = match[2].trim();
  }
 
  return properties;
};

const checkPropertyPreservation = (originalHtml, optimizedHtml, criticalProps = []) => {
  const originalProps = extractCSSProperties(originalHtml);
  const optimizedProps = extractCSSProperties(optimizedHtml);
 
  const lostProperties = [];
  const preservedProperties = [];
 
  const defaultCriticalProps = [
    'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
    'position', 'top', 'left', 'right', 'bottom', 'zIndex',
    'display', 'flexDirection', 'justifyContent', 'alignItems',
    'gridTemplateColumns', 'gridTemplateRows', 'gap',
    'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
    'margin', 'marginTop', 'marginLeft', 'marginRight', 'marginBottom',
    'padding', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom',
    'transform', 'opacity', 'overflow'
  ];
 
  const propsToCheck = [...defaultCriticalProps, ...criticalProps];
 
  propsToCheck.forEach(prop => {
    if (originalProps[prop] && !optimizedProps[prop]) {
      lostProperties.push(prop);
    } else if (originalProps[prop] && optimizedProps[prop]) {
      preservedProperties.push(prop);
    }
  });
 
  return {
    lostProperties,
    preservedProperties,
    hasLostCriticalProps: lostProperties.length > 0,
    preservationRate: preservedProperties.length / Math.max(Object.keys(originalProps).length, 1)
  };
};

const validateBgLayersResult = (result) => {
  try {
    const validated = BgLayersResultSchema.parse(result);
   
    if (validated.success && validated.html) {
      const hasBackgroundColor = validated.html.includes('background-color') ||
                                 validated.html.includes('backgroundColor');
      const hasBackgroundImage = validated.html.includes('background-image') ||
                                 validated.html.includes('backgroundImage');
      const hasPositioning = validated.html.includes('position:') ||
                            validated.html.includes('top:') ||
                            validated.html.includes('left:');
                           
      if (validated.originalDivCount > validated.optimizedDivCount &&
          !hasPositioning && validated.html.length > 100) {
        console.warn(`⚠️ Possible positioning loss in ${validated.id}`);
      }
    }
   
    return { isValid: true, data: validated, errors: null };
  } catch (error) {
    return {
      isValid: false,
      data: null,
      errors: error.errors || [{ message: error.message }]
    };
  }
};

const validateFlexGridResult = (result) => {
  try {
    const validated = FlexGridResultSchema.parse(result);
   
    if (validated.success && validated.html) {
      const hasFlexProps = validated.html.includes('display:flex') ||
                          validated.html.includes('flex-direction') ||
                          validated.html.includes('justify-content');
      const hasGridProps = validated.html.includes('display:grid') ||
                          validated.html.includes('grid-template') ||
                          validated.html.includes('grid-column');
      const hasSpacing = validated.html.includes('margin') ||
                        validated.html.includes('padding');
                       
      if (validated.originalDivCount > validated.optimizedDivCount &&
          !(hasFlexProps || hasGridProps) && validated.html.length > 100) {
        console.warn(`⚠️ Possible layout properties loss in ${validated.id}`);
      }
    }
   
    return { isValid: true, data: validated, errors: null };
  } catch (error) {
    return {
      isValid: false,
      data: null,
      errors: error.errors || [{ message: error.message }]
    };
  }
};

const processOptimizationResult = (result, type = 'bgLayers') => {
  const validator = type === 'bgLayers' ? validateBgLayersResult : validateFlexGridResult;
  const validation = validator(result);
 
  if (!validation.isValid) {
    console.error(`❌ Validation failed for ${result.id}:`, validation.errors);
    return {
      ...result,
      success: false,
      error: `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`
    };
  }
 
  return validation.data;
};

// ===== ENHANCED PROMPTS =====
const BGLAYERS_OPTIMIZATION_PROMPT = `
You are optimizing Wix bgLayers HTML. Your goal is to convert 3 divs into 1 single div.

CRITICAL RULES:
1. OUTPUT ONLY A SINGLE DIV - Never output multiple divs
2. Start with the main bgLayers div (keep its ID and main attributes)
3. Merge ALL classes from all child divs into the main div
4. Merge ALL styles from all child divs into the main div  
5. If bgMedia is EMPTY or has no {{widget-}} content, completely remove it
6. If bgMedia contains {{widget-}} content, put it directly inside the main div
7. Use CSS shorthand: position:absolute;top:0;bottom:0;left:0;right:0
8. Remove redundant CSS properties (don't repeat same values)
9. The output must render identically to the input

TRANSFORMATION RULES:
- 3 nested divs → 1 single div
- All classes merged → class="MW5IWV LWbAav Kv1aVt VgO9Yg"  
- All styles merged → combined in style attribute
- Widget content (if any) → directly inside the single div

EXAMPLE 1 - Empty bgMedia (3 divs → 1 div):
INPUT:
<div id="bgLayers_comp-lt8qhfaf" data-hook="bgLayers" data-motion-part="BG_LAYER comp-lt8qhfaf" class="MW5IZ" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px;">
  <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="bottom: 0px; height: 421px; left: 0px; position: absolute; right: 0px; top: 0px;"></div>
  <div id="bgMedia_comp-lt8qhfaf" data-motion-part="BG_MEDIA comp-lt8qhfaf" class="VgO9Yg" style="height: 421px;"></div>
</div>

OUTPUT:
<div id="bgLayers_comp-lt8qhfaf" data-hook="bgLayers" data-motion-part="BG_LAYER comp-lt8qhfaf" data-testid="colorUnderlay" class="MW5IZ LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:421px"></div>

EXAMPLE 2 - With background color (3 divs → 1 div):
INPUT:
<div id="bgLayers_comp-irqduxf8" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxf8" class="MW5IWV" style="bottom: 0; height: 881px; left: 0; position: absolute; right: 0; top: 0; overflow: hidden;">
  <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="background-color: rgb(6, 21, 81); bottom: 0; height: 881px; left: 0; position: absolute; right: 0; top: 0;"></div>
  <div id="bgMedia_comp-irqduxf8" data-motion-part="BG_MEDIA comp-irqduxf8" class="VgO9Yg" style="height: 881px;"></div>
</div>

OUTPUT:
<div id="bgLayers_comp-irqduxf8" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxf8" data-testid="colorUnderlay" class="MW5IWV LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:881px;background-color:rgb(6,21,81);overflow:hidden"></div>

EXAMPLE 3 - With widget content (3 divs → 1 div with content):
INPUT:
<div id="bgLayers_comp-irqduxf8" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxf8" class="MW5IWV" style="bottom: 0; height: 881px; left: 0; position: absolute; right: 0; top: 0; overflow: hidden;">
  <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="background-color: rgb(6, 21, 81); bottom: 0; height: 881px; left: 0; position: absolute; right: 0; top: 0;"></div>
  <div id="bgMedia_comp-irqduxf8" data-motion-part="BG_MEDIA comp-irqduxf8" class="VgO9Yg" style="height: 881px; margin-top: -100px;">{{widget-1}}</div>
</div>

OUTPUT:
<div id="bgLayers_comp-irqduxf8" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqduxf8" data-motion-part="BG_MEDIA comp-irqduxf8" data-testid="colorUnderlay" class="MW5IWV LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:881px;background-color:rgb(6,21,81);overflow:hidden;margin-top:-100px">{{widget-1}}</div>

EXAMPLE 4 - Complex styles (3 divs → 1 div):
INPUT:
<div id="bgLayers_comp-irqdux85" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqdux85" class="MW5IWV" style="position: absolute; top: 0; bottom: 0; left: 0; right: 0; height: 218px; overflow: hidden; mask-position: 0 50%; mask-repeat: no-repeat; mask-size: 100%;">
  <div data-testid="colorUnderlay" class="LWbAav Kv1aVt" style="background-color: rgb(255, 255, 255); position: absolute; top: 0; bottom: 0; left: 0; right: 0; height: 218px;"></div>
  <div id="bgMedia_comp-irqdux85" data-motion-part="BG_MEDIA comp-irqdux85" class="VgO9Yg" style="height: 218px;"></div>
</div>

OUTPUT:
<div id="bgLayers_comp-irqdux85" data-hook="bgLayers" data-motion-part="BG_LAYER comp-irqdux85" data-testid="colorUnderlay" class="MW5IWV LWbAav Kv1aVt VgO9Yg" style="position:absolute;top:0;bottom:0;left:0;right:0;height:218px;background-color:rgb(255,255,255);overflow:hidden;mask-position:0 50%;mask-repeat:no-repeat;mask-size:100%"></div>


REMEMBER:
- Input = 3 nested divs
- Output = 1 single div (or 1 div with widget content inside)
- Never output multiple sibling divs
- Merge everything into the main bgLayers div

OUTPUT ONLY THE OPTIMIZED HTML:
`;

const FLEXGRID_OPTIMIZATION_PROMPT = `
You are a Wix HTML optimization expert. Your PRIMARY GOAL is to reduce the div count to the absolute minimum while maintaining PIXEL-PERFECT IDENTICAL rendering.

ULTRA-STRICT RULES:
1. OUTPUT ONLY THE OPTIMIZED HTML - NO EXPLANATIONS OR COMMENTS
2. AGGRESSIVE DIV REDUCTION: 2 divs → 1 div, 3 divs → 1 div, 5 divs → 2 divs maximum
3. PRESERVE EVERY PIXEL: All positioning, dimensions, margins, padding must be IDENTICAL
4. Merge nested divs ONLY if the result renders exactly the same
5. Keep ALL positioning properties: top, left, right, bottom, transform, margin, padding
6. Preserve ALL layout properties: display, flex, grid, position, z-index, overflow
7. Maintain ALL sizing: width, height, min-width, min-height, max-width, max-height
8. Keep all template placeholders exactly as-is: {{template-XXXX}}, {{bg-XX}}
9. Preserve ALL data-* attributes, IDs, and functional classes in merged elements

CRITICAL POSITIONING RULES:
- NEVER remove positioning properties (top, left, right, bottom, transform)
- NEVER remove sizing properties (width, height, min/max dimensions)
- NEVER remove spacing properties (margin, padding, gap)
- NEVER remove layout properties (display, flex, grid, position, z-index)
- NEVER remove visual properties that affect layout (overflow, visibility)
- When merging, ALL properties must be combined, not discarded

DIV REDUCTION STRATEGIES (WITH POSITIONING SAFETY):
- Merge parent-child divs ONLY if all positioning/sizing properties are preserved
- Eliminate wrapper divs by moving ALL their properties to child or parent
- Combine properties without losing any layout information
- Use CSS shorthand but maintain exact values
- Flatten nesting while preserving exact positioning chain

EXAMPLE 1 - REDUCE 3 DIVS TO 2 DIVS (SAFE POSITIONING):
INPUT (3 divs):
<div id="parent" class="flex-container" style="display: flex; height: 200px; width: 400px; position: relative;">
  <div class="wrapper" style="position: relative; height: 200px; width: 400px; padding: 20px;">
    <div id="child" class="content" style="height: 100px; width: 200px; position: absolute; top: 50px; left: 100px; margin: 10px;">
      {{template-2001}}
    </div>
  </div>
</div>

OUTPUT (2 divs - ALL properties preserved):
<div id="parent" class="flex-container wrapper" style="display:flex;height:200px;width:400px;position:relative;padding:20px">
<div id="child" class="content" style="height:100px;width:200px;position:absolute;top:50px;left:100px;margin:10px">{{template-2001}}</div>
</div>

EXAMPLE 2 - REDUCE 4 DIVS TO 2 DIVS (PRESERVE ALL LAYOUT):
INPUT (4 divs):
<div id="container" class="grid-container" style="display: grid; grid-template-columns: 1fr 1fr; height: 300px; padding: 15px;">
  <div class="grid-item" style="position: relative; margin: 5px;">
    <div class="inner-wrapper" style="height: 100%; width: 100%; overflow: hidden;">
      <div id="content" class="grid-content" style="position: absolute; top: 20px; left: 20px; width: 150px; height: 80px; transform: translateZ(0);">
        {{template-2002}}
      </div>
    </div>
  </div>
</div>

OUTPUT (2 divs - EVERY property maintained):
<div id="container" class="grid-container grid-item inner-wrapper" style="display:grid;grid-template-columns:1fr 1fr;height:300px;padding:15px;position:relative;margin:5px;overflow:hidden">
<div id="content" class="grid-content" style="position:absolute;top:20px;left:20px;width:150px;height:80px;transform:translateZ(0)">{{template-2002}}</div>
</div>

EXAMPLE 3 - COMPLEX POSITIONING PRESERVATION:
INPUT (5 divs with complex positioning):
<div id="outer" class="flex-wrap" style="display: flex; flex-direction: column; height: 400px; width: 600px;">
  <div class="section" style="height: 200px; position: relative; margin: 10px; padding: 15px;">
    <div class="container" style="position: relative; height: 100%; width: 100%; border: 1px solid #ccc;">
      <div class="wrapper" style="width: 100%; height: 100%; overflow: auto; z-index: 5;">
        <div id="final" class="content" style="position: absolute; top: 25px; left: 30px; width: 250px; height: 120px; transform: rotate(2deg); opacity: 0.9;">
          {{template-2003}}
        </div>
      </div>
    </div>
  </div>
</div>

OUTPUT (2 divs - ALL properties preserved, including transforms):
<div id="outer" class="flex-wrap section container wrapper" style="display:flex;flex-direction:column;height:400px;width:600px;position:relative;margin:10px;padding:15px;border:1px solid #ccc;overflow:auto;z-index:5">
<div id="final" class="content" style="position:absolute;top:25px;left:30px;width:250px;height:120px;transform:rotate(2deg);opacity:0.9">{{template-2003}}</div>
</div>

MANDATORY PROPERTY PRESERVATION CHECKLIST:
✅ POSITIONING: top, left, right, bottom, position, z-index, transform
✅ SIZING: width, height, min-width, min-height, max-width, max-height
✅ SPACING: margin, padding, gap, border, outline
✅ LAYOUT: display, flex, grid, align, justify, order, float
✅ VISUAL: opacity, visibility, overflow, clip-path, filter
✅ TYPOGRAPHY: font-size, line-height, text-align, color (if affects layout)
✅ ANIMATIONS: transition, animation, transform-origin

FORBIDDEN OPTIMIZATIONS (THAT BREAK POSITIONING):
❌ Removing any positioning property (even if it seems redundant)
❌ Combining incompatible position contexts (absolute + static)
❌ Dropping margin/padding that affects other elements
❌ Removing transforms or transform-origin
❌ Changing display context (flex to block, grid to flex, etc.)
❌ Removing overflow properties that affect scrolling/clipping
❌ Dropping z-index that affects stacking
❌ Removing min/max constraints that affect responsive behavior

SAFE DIV MERGING CONDITIONS:
✓ Parent and child have compatible positioning contexts
✓ All properties can be combined without conflict
✓ No intermediate styling that affects layout is lost
✓ Template placeholders remain in correct positions
✓ Visual stacking order is preserved
✓ Responsive behavior remains identical

WIDGET POSITIONING PROTECTION:
- Template placeholders {{template-XXXX}} must maintain exact positioning
- Any div containing templates must preserve ALL positioning properties
- Parent positioning context must be maintained for absolute-positioned children
- Grid/flex item properties must be preserved for proper alignment
- Transform and transform-origin must be kept for animations/effects

CRITICAL SUCCESS METRICS (WITH POSITIONING SAFETY):
- Input: 2 divs → Output: 1 div (if positioning allows)
- Input: 3 divs → Output: 1-2 divs (preserve all layout properties)  
- Input: 4 divs → Output: 2 divs (maintain positioning chain)
- Input: 5+ divs → Output: 2-3 divs maximum (keep all visual properties)

RENDER GUARANTEE: The output must be PIXEL-PERFECT identical to the input. Every widget must be positioned exactly the same. Any optimization that moves a widget by even 1 pixel is forbidden.

HTML TO OPTIMIZE:
`;

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

if (!isMainThread) {
  (async () => {
    try {
      Object.keys(require.cache).forEach(key => {
        delete require.cache[key];
      });

      const { html, id, promptType } = workerData;
     
      const workerOpenAI = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });

      const prompt = promptType === 'bgLayers' ? BGLAYERS_OPTIMIZATION_PROMPT : FLEXGRID_OPTIMIZATION_PROMPT;
      const response = await workerOpenAI.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: `${prompt}\n${html}` }],
        temperature: 0.1,
        max_tokens: 12288,
      });

      const optimizedHtml = response.choices[0].message.content
        .replace(/^```html\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      parentPort.postMessage({
        success: true,
        optimizedHtml,
        id
      });
    } catch (error) {
      parentPort.postMessage({
        success: false,
        error: error.message,
        id: workerData.id
      });
    }
  })();
 
  return;
}

async function generateBareMinimumHtml(sectionIndex, widgetsHtmlInput, outputDir) {
  console.log(`\n🚀 Starting bare minimum HTML generation for section ${sectionIndex}`);
  console.log('='.repeat(60));
 
  const widgetsHtmlPath = path.join(outputDir, `widgets_extracted_${sectionIndex}.html`);
  if (!await fs.access(widgetsHtmlPath).then(() => true).catch(() => false)) {
    throw new Error(`Widgets-extracted HTML file not found at ${widgetsHtmlPath}`);
  }

  const widgetsHtml = await fs.readFile(widgetsHtmlPath, 'utf8');
  console.log(`✅ Found widgets-extracted HTML (${widgetsHtml.length} bytes)`);

  console.log('\n🎨 Processing bgLayers divs...');
  const $ = cheerio.load(widgetsHtml);
  const bgLayerDivs = [];
 
  $('div[id^="bgLayers"]').each((index, element) => {
    const $element = $(element);
    bgLayerDivs.push({
      id: $element.attr('id'),
      element: element,
      html: $.html($element)
    });
  });

  console.log(`Found ${bgLayerDivs.length} bgLayers divs`);
  const bgTemplates = {};

  const bgLayerResults = await Promise.all(bgLayerDivs.map((divData, i) => {
    console.log(`\n🔧 Processing bgLayers ${i + 1}/${bgLayerDivs.length}: ${divData.id}`);
   
    return new Promise((resolve) => {
      const worker = new Worker(__filename, {
        workerData: {
          html: divData.html,
          id: divData.id,
          promptType: 'bgLayers'
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 256
        }
      });

      const timeout = setTimeout(() => {
        worker.terminate();
        console.error(`⌛ Timeout processing ${divData.id}`);
        resolve({
          id: divData.id,
          success: false,
          error: 'Timeout',
          html: ''
        });
      }, 180000); // 3 minute timeout

      worker.on('message', (message) => {
        clearTimeout(timeout);
        resolve({
          id: divData.id,
          success: message.success,
          html: message.optimizedHtml || '',
          error: message.error
        });
      });

      worker.on('error', (error) => {
        clearTimeout(timeout);
        console.error(`❌ Worker error for ${divData.id}: ${error.message}`);
        resolve({
          id: divData.id,
          success: false,
          error: error.message,
          html: ''
        });
      });

      worker.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.error(`❌ Worker stopped with exit code ${code} for ${divData.id}`);
        }
      });
    });
  }));

  // Process bgLayer results with Zod validation
  bgLayerResults.forEach((result, i) => {
    const bgKey = `bg-${String(i + 1).padStart(2, '0')}`;
   
    const enhancedResult = {
      ...result,
      originalDivCount: 3, // Always 3 nested divs in bgLayers
      optimizedDivCount: result.html ? (result.html.match(/<div/g) || []).length : 0
    };
   
    const validatedResult = processOptimizationResult(enhancedResult, 'bgLayers');
   
    if (validatedResult.success && validatedResult.html) {
      // Check property preservation
      const preservation = checkPropertyPreservation(
        bgLayerDivs[i].html,
        validatedResult.html,
        ['backgroundColor', 'backgroundImage', 'position', 'zIndex']
      );
     
      if (preservation.hasLostCriticalProps) {
        console.warn(`⚠️ ${validatedResult.id} lost critical properties:`, preservation.lostProperties);
        if (preservation.lostProperties.includes('backgroundColor') ||
            preservation.lostProperties.includes('backgroundImage')) {
          console.warn(`🔄 Using original HTML for ${validatedResult.id} due to background property loss`);
          bgTemplates[`{{${bgKey}}}`] = bgLayerDivs[i].html;
        } else {
          bgTemplates[`{{${bgKey}}}`] = validatedResult.html;
        }
      } else {
        bgTemplates[`{{${bgKey}}}`] = validatedResult.html;
        console.log(`✅ Optimized ${validatedResult.id} (${validatedResult.html.length} bytes) - Preserved ${preservation.preservedProperties.length} properties`);
      }
     
      $(bgLayerDivs[i].element).replaceWith(`{{${bgKey}}}`);
    } else {
      bgTemplates[`{{${bgKey}}}`] = bgLayerDivs[i].html;
      $(bgLayerDivs[i].element).replaceWith(`{{${bgKey}}}`);
      console.error(`❌ Failed ${validatedResult.id}: ${validatedResult.error} - Using original HTML`);
    }
  });

  const bgJsonFile = `bg_${sectionIndex}.json`;
  await fs.writeFile(path.join(outputDir, bgJsonFile), JSON.stringify(bgTemplates, null, 2));
 
  const htmlWithBgPlaceholders = $.html();
  const bgPlaceholderHtmlFile = `bg_placeholder_${sectionIndex}.html`;
  await fs.writeFile(path.join(outputDir, bgPlaceholderHtmlFile), htmlWithBgPlaceholders);

  function hasFlexOrGridProperties(element) {
    const $element = $(element);
    const style = $element.attr('style') || '';
    const className = $element.attr('class') || '';
   
    const hasFlexInline = /display\s*:\s*(flex|inline-flex)/i.test(style) ||
                         /flex[\s-]/i.test(style);
    const hasGridInline = /display\s*:\s*(grid|inline-grid)/i.test(style) ||
                         /grid[\s-]/i.test(style);
   
    const hasFlexClass = /flex|d-flex|display-flex/i.test(className);
    const hasGridClass = /grid|d-grid|display-grid/i.test(className);
   
    return hasFlexInline || hasGridInline || hasFlexClass || hasGridClass;
  }

  function containsOnlyWidgets(element) {
    const $element = $(element);
    const childDivs = $element.find('div[id]');
   
    if (childDivs.length === 0) {
      const id = $element.attr('id');
      return id && (id.includes('widget') || id.includes('Widget'));
    }
   
    let allChildrenAreWidgets = true;
    childDivs.each((index, childElement) => {
      const childId = $(childElement).attr('id');
      if (!childId || (!childId.includes('widget') && !childId.includes('Widget'))) {
        allChildrenAreWidgets = false;
        return false;
      }
    });
   
    return allChildrenAreWidgets;
  }

  function getNestingDepth(element, $context) {
    let depth = 0;
    let current = $context(element);
    while (current.parent('div[id]').length > 0) {
      current = current.parent('div[id]').first();
      depth++;
    }
    return depth;
  }

  console.log('\n📊 Processing flex/grid divs (innermost first)...');
  let $saved = cheerio.load(htmlWithBgPlaceholders);
  const componentTemplates = {};
  let templateCounter = 2001;
 
  let processedInThisRound = true;
  let totalProcessed = 0;
 
  while (processedInThisRound) {
    processedInThisRound = false;
    const flexGridDivs = [];
   
    $saved('div[id]').each((index, element) => {
      const $element = $saved(element);
      const id = $element.attr('id');
     
      if (id && id.startsWith('bgLayers')) {
        return;
      }
     
      if ($saved.html($element).includes('{{template-')) {
        return;
      }
     
      if (id && hasFlexOrGridProperties(element)) {
        if (!containsOnlyWidgets(element)) {
          flexGridDivs.push({
            id: id,
            element: element,
            html: $saved.html($element),
            depth: getNestingDepth(element, $saved)
          });
        } else {
          console.log(`🚫 Skipping widget-only flex/grid div: ${id}`);
        }
      }
    });

    if (flexGridDivs.length === 0) {
      break;
    }

    flexGridDivs.sort((a, b) => b.depth - a.depth);
   
    console.log(`\n🔄 Round ${totalProcessed > 0 ? Math.floor(totalProcessed/10) + 1 : 1}: Found ${flexGridDivs.length} flex/grid divs`);
    flexGridDivs.forEach(div => {
      console.log(`   📐 ${div.id} (depth: ${div.depth})`);
    });

    const flexGridResults = await Promise.all(flexGridDivs.map(async (divData, i) => {
      console.log(`\n🔧 Processing flex/grid div ${i + 1}/${flexGridDivs.length}: ${divData.id} (depth: ${divData.depth})`);
     
      return new Promise((resolve) => {
        const worker = new Worker(__filename, {
          workerData: {
            html: divData.html,
            id: divData.id,
            promptType: 'flexGrid'
          },
          resourceLimits: {
            maxOldGenerationSizeMb: 512,
            maxYoungGenerationSizeMb: 512,
            codeRangeSizeMb: 16,
            stackSizeMb: 4
          }
        });

        const timeout = setTimeout(() => {
          worker.terminate();
          console.error(`⌛ Timeout processing ${divData.id}`);
          resolve({
            id: divData.id,
            success: false,
            error: 'Timeout',
            html: ''
          });
        }, 300000); // 5 minute timeout

        worker.on('message', (message) => {
          clearTimeout(timeout);
          resolve({
            id: divData.id,
            success: message.success,
            html: message.optimizedHtml || '',
            error: message.error
          });
        });

        worker.on('error', (error) => {
          clearTimeout(timeout);
          console.error(`❌ Worker error for ${divData.id}: ${error.message}`);
          resolve({
            id: divData.id,
            success: false,
            error: error.message,
            html: ''
          });
        });

        worker.on('exit', (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            console.error(`❌ Worker stopped with exit code ${code} for ${divData.id}`);
          }
        });
      });
    }));

    // Process flexGrid results with Zod validation
    flexGridResults.forEach((result, i) => {
      const templateKey = `template-${String(templateCounter).padStart(4, '0')}`;
      const originalHtml = flexGridDivs[i].html;
     
      const enhancedResult = {
        ...result,
        originalDivCount: (originalHtml.match(/<div/g) || []).length,
        optimizedDivCount: result.html ? (result.html.match(/<div/g) || []).length : 0,
        depth: flexGridDivs[i].depth
      };
     
      const validatedResult = processOptimizationResult(enhancedResult, 'flexGrid');
     
      if (validatedResult.success && validatedResult.html) {
        // Check property preservation
        const preservation = checkPropertyPreservation(
          originalHtml,
          validatedResult.html,
          ['display', 'flexDirection', 'justifyContent', 'alignItems', 'gridTemplateColumns', 'gridTemplateRows', 'gap', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'margin', 'padding']
        );

        if (preservation.hasLostCriticalProps) {
          console.warn(`⚠️ ${validatedResult.id} lost critical properties:`, preservation.lostProperties);
          const criticalLayoutProps = ['display', 'flexDirection', 'gridTemplateColumns', 'gridTemplateRows'];
          if (preservation.lostProperties.some(prop => criticalLayoutProps.includes(prop))) {
            console.error(`❌ Critical layout property lost for ${validatedResult.id}. Using original HTML.`);
            componentTemplates[`{{${templateKey}}}`] = originalHtml;
          } else {
            componentTemplates[`{{${templateKey}}}`] = validatedResult.html;
          }
        } else {
          componentTemplates[`{{${templateKey}}}`] = validatedResult.html;
        }

        $saved(flexGridDivs[i].element).replaceWith(`{{${templateKey}}}`);
        console.log(`✅ Optimized ${validatedResult.id} → {{${templateKey}}} (${validatedResult.html.length} bytes) - Preserved ${preservation.preservedProperties.length} properties`);
        processedInThisRound = true;
        totalProcessed++;
      } else {
        componentTemplates[`{{${templateKey}}}`] = originalHtml;
        $saved(flexGridDivs[i].element).replaceWith(`{{${templateKey}}}`);
        console.error(`❌ Failed ${validatedResult.id}: ${validatedResult.error} - Using original HTML`);
      }
     
      templateCounter++;
    });
   
    if (processedInThisRound) {
      $saved = cheerio.load($saved.html());
    }
  }

  console.log(`\n🎯 Completed processing ${totalProcessed} flex/grid divs in total`);

  // Save final output
  const finalBareHtml = $saved.html();
  const bareMinimumFile = `bareminimum_section_${sectionIndex}.html`;
  await fs.writeFile(path.join(outputDir, bareMinimumFile), finalBareHtml);
 
  const componentsJsonFile = `bareminimum_${sectionIndex}.json`;
  await fs.writeFile(path.join(outputDir, componentsJsonFile), JSON.stringify(componentTemplates, null, 2));

  console.log('\n🏁 Bare minimum HTML generation complete!');
  console.log('='.repeat(60));

  return {
    bareHtml: finalBareHtml,
    bareMinimumFile,
    bgJsonFile,
    componentsJsonFile,
    bgPlaceholderHtmlFile,
    bgTemplates,
    componentTemplates
  };
}

class WebsiteBuilder {
    constructor(outputDir) {
        this.outputDir = outputDir;
        this.templateFile = path.join(outputDir, 'bareminimum_section_0.html');
        this.data1File = path.join(outputDir, 'bg_0.json');
        this.data2File = path.join(outputDir, 'bareminimum_0.json');
        this.data3File = path.join(outputDir, 'widgets_0.json');
        this.currentHTML = '';
        this.data1 = {}; // Background data
        this.data2 = {}; // Bareminimum templates
        this.data3 = {}; // Widgets data
    }

    async loadData() {
        try {
            // Load data1 (background data - bg_*.json)
            const data1Content = await fs.readFile(this.data1File, 'utf8');
            this.data1 = JSON.parse(data1Content);

            // Load data2 (bareminimum templates - template-nnnn format)
            const data2Content = await fs.readFile(this.data2File, 'utf8');
            this.data2 = JSON.parse(data2Content);

            // Load data3 (widgets - {{widget-n}} format keys with HTML values)
            const data3Content = await fs.readFile(this.data3File, 'utf8');
            this.data3 = JSON.parse(data3Content);

            console.log('Data loaded - Data1 (bg) keys:', Object.keys(this.data1));
            console.log('Data loaded - Data2 (bareminimum) keys:', Object.keys(this.data2));
            console.log('Data loaded - Data3 (widgets) keys:', Object.keys(this.data3));
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
        const maxIterations = 30; // Increased for nested templates with three data sources

        while (hasReplacements && iterations < maxIterations) {
            hasReplacements = false;
            iterations++;

            // First pass: Replace {{template-nnnn}} patterns with data2 (bareminimum) content
            const templateMatches = processedContent.match(/\{\{template-\d+\}\}/g);
            if (templateMatches) {
                for (const match of templateMatches) {
                    // First try with braces (the key might include braces)
                    if (this.data2[match]) {
                        processedContent = processedContent.replace(match, this.data2[match]);
                        hasReplacements = true;
                        console.log(`Replaced ${match} with data2[${match}] (bareminimum - with braces)`);
                    } else {
                        // Try without braces
                        const templateId = match.replace(/[{}]/g, ''); // Remove braces to get "template-nnnn"
                        if (this.data2[templateId]) {
                            processedContent = processedContent.replace(match, this.data2[templateId]);
                            hasReplacements = true;
                            console.log(`Replaced ${match} with data2[${templateId}] (bareminimum - without braces)`);
                        }
                    }
                }
            }

            // Second pass: Replace {{widget-n}} patterns with data3 (widgets) content
            const widgetMatches = processedContent.match(/\{\{widget-\d+\}\}/g);
            if (widgetMatches) {
                for (const match of widgetMatches) {
                    // First try with braces (the key includes the braces)
                    if (this.data3[match]) {
                        processedContent = processedContent.replace(match, this.data3[match]);
                        hasReplacements = true;
                        console.log(`Replaced ${match} with data3 content (widgets - with braces)`);
                    } else {
                        // Try without braces
                        const widgetId = match.replace(/[{}]/g, '');
                        if (this.data3[widgetId]) {
                            processedContent = processedContent.replace(match, this.data3[widgetId]);
                            hasReplacements = true;
                            console.log(`Replaced ${match} with data3[${widgetId}] (widgets - without braces)`);
                        }
                    }
                }
            }

            // Third pass: Replace {{bg-n}} or similar background patterns with data1 content
            const bgMatches = processedContent.match(/\{\{bg-\d+\}\}/g);
            if (bgMatches) {
                for (const match of bgMatches) {
                    // First try with braces (the key includes the braces)
                    if (this.data1[match]) {
                        processedContent = processedContent.replace(match, this.data1[match]);
                        hasReplacements = true;
                        console.log(`Replaced ${match} with data1 content (background - with braces)`);
                    } else {
                        // Try without braces
                        const bgId = match.replace(/[{}]/g, '');
                        if (this.data1[bgId]) {
                            processedContent = processedContent.replace(match, this.data1[bgId]);
                            hasReplacements = true;
                            console.log(`Replaced ${match} with data1[${bgId}] (background - without braces)`);
                        }
                    }
                }
            }

            // Fourth pass: Handle any other placeholder patterns that might exist
            // This catches any remaining {{...}} patterns
            const otherMatches = processedContent.match(/\{\{[^}]+\}\}/g);
            if (otherMatches) {
                for (const match of otherMatches) {
                    let replaced = false;
                   
                    // Check all data sources with braces first
                    if (!replaced && this.data1[match]) {
                        processedContent = processedContent.replace(match, this.data1[match]);
                        hasReplacements = true;
                        replaced = true;
                        console.log(`Replaced ${match} with data1 content (background - direct match)`);
                    }
                    if (!replaced && this.data2[match]) {
                        processedContent = processedContent.replace(match, this.data2[match]);
                        hasReplacements = true;
                        replaced = true;
                        console.log(`Replaced ${match} with data2 content (bareminimum - direct match)`);
                    }
                    if (!replaced && this.data3[match]) {
                        processedContent = processedContent.replace(match, this.data3[match]);
                        hasReplacements = true;
                        replaced = true;
                        console.log(`Replaced ${match} with data3 content (widgets - direct match)`);
                    }
                   
                    // If not found with braces, try without braces
                    if (!replaced) {
                        const withoutBraces = match.replace(/[{}]/g, '');
                        if (this.data1[withoutBraces]) {
                            processedContent = processedContent.replace(match, this.data1[withoutBraces]);
                            hasReplacements = true;
                            replaced = true;
                            console.log(`Replaced ${match} with data1[${withoutBraces}] (background - without braces)`);
                        }
                        else if (this.data2[withoutBraces]) {
                            processedContent = processedContent.replace(match, this.data2[withoutBraces]);
                            hasReplacements = true;
                            replaced = true;
                            console.log(`Replaced ${match} with data2[${withoutBraces}] (bareminimum - without braces)`);
                        }
                        else if (this.data3[withoutBraces]) {
                            processedContent = processedContent.replace(match, this.data3[withoutBraces]);
                            hasReplacements = true;
                            replaced = true;
                            console.log(`Replaced ${match} with data3[${withoutBraces}] (widgets - without braces)`);
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
            data1Background: Object.keys(this.data1).length,
            data2Templates: Object.keys(this.data2).length,
            data3Widgets: Object.keys(this.data3).length,
            finalHTMLLength: this.currentHTML.length,
            hasUnreplacedPlaceholders: !this.validatePlaceholders(this.currentHTML)
        };
    }
}

const completedSections = new Map();

async function processSingleSection(section, outputDir) {
    try {
        const sectionHtml = await fs.readFile(path.join(outputDir, section.htmlFile), 'utf8');
        const computedData = JSON.parse(await fs.readFile(path.join(outputDir, section.computedFile), 'utf8'));
        const styleProcessor = new EnhancedHtmlStyleProcessor();
       
        // Process inline layout styles
        const step1Result = await styleProcessor.processHtml(sectionHtml, computedData, outputDir, section.index);
       
        // Extract widgets
        const step2Result = await extractWidgetsFromHtml(step1Result.styledHtml, section.index, outputDir);
       
        // Generate bare minimum HTML
        const step3Result = await generateBareMinimumHtml(section.index, step2Result.modifiedHtml, outputDir);
       
        // Assemble final website section
        const builder = new WebsiteBuilder(outputDir);
        builder.templateFile = path.join(outputDir, `bareminimum_section_${section.index}.html`);
        builder.data1File = path.join(outputDir, `bg_${section.index}.json`);
        builder.data2File = path.join(outputDir, `bareminimum_${section.index}.json`);
        builder.data3File = path.join(outputDir, `widgets_${section.index}.json`);
       
        const finalHtml = await builder.buildWebsite();
       
        // Return the processed section data
        return {
            index: section.index,
            html: finalHtml,
            completed: true,
            widgets: step2Result.widgets || {},
            files: {
                original: section.htmlFile,
                computed: section.computedFile,
                layoutInline: step1Result.layoutInlineFile,
                bareMinimum: step3Result.bareMinimumFile,
                widgets: step2Result.widgetsFile,
                widgetsHtml: step2Result.htmlOutputFile
            },
            stats: {
                originalSize: sectionHtml.length,
                finalSize: finalHtml.length,
                compressionRatio: ((sectionHtml.length - finalHtml.length) / sectionHtml.length * 100).toFixed(1) + '%',
                widgetsExtracted: step2Result.widgets ? Object.keys(step2Result.widgets).length : 0
            }
        };
    } catch (error) {
        console.error(`❌ Section ${section.index} processing failed:`, error.message);
        return {
            index: section.index,
            error: error.message,
            failed: true
        };
    }
}

async function processAllSections(rawHtmlContent, computedStyles, outputDir) {
    // Initialize with empty array instead of clearing
    allSections = allSections || [];
    if (completedSections && typeof completedSections.clear === 'function') {
        completedSections.clear();
    }
    browserProcess = null;
   
    const sectionFiles = await extractAndSaveSections(rawHtmlContent, computedStyles, outputDir);
    if (!Array.isArray(sectionFiles)) {
        throw new Error('Expected sectionFiles to be an array');
    }

    // Process all sections concurrently
    const processingPromises = sectionFiles.map(section =>
        processSingleSection(section, outputDir)
    );
   
    // Wait for all sections to complete
    const results = await Promise.all(processingPromises);

    // Now ensure sections are processed in order
    const orderedSections = [];
    for (let i = 0; i < sectionFiles.length; i++) {
        const result = results.find(r => r.index === i);
        if (result) {
            orderedSections.push(result);
        }
    }

    // Generate final output with sections in correct order
    await generateOrderedFinalOutput(orderedSections, outputDir);
   
    return {
        sectionFiles,
        processedSections: orderedSections,
        summary: {
            totalSections: sectionFiles.length,
            successfulSections: orderedSections.filter(s => !s.failed).length,
            failedSections: orderedSections.filter(s => s.failed).length
        }
    };
}

async function generateOrderedFinalOutput(orderedSections, outputDir) {
    // Filter out failed sections
    const successfulSections = orderedSections.filter(s => !s.failed && s.html);
   
    if (successfulSections.length === 0) {
        console.log('No successful sections to generate final output');
        return;
    }

    // Create final HTML with proper hierarchy
    const finalHtml = `<!DOCTYPE html>
<html>
<head>
    <title>Final Website</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
    ${successfulSections.map(section => section.html).join('\n')}
</body>
</html>`;
   
    // Save final output
    const finalOutputPath = path.join(outputDir, 'final_website.html');
    await fs.writeFile(finalOutputPath, finalHtml);
    console.log(`🌐 Generated final website with ${successfulSections.length} sections in correct order`);
   
    // Update browser display
    await updateBrowserDisplay(outputDir, true);
}

async function updateBrowserDisplay(outputDir, shouldOpenBrowser = false) {
    try {
        const finalHtmlPath = path.join(outputDir, 'final_website.html');
        if (!await fs.access(finalHtmlPath).then(() => true).catch(() => false)) {
            console.log('Final HTML not ready for display');
            return;
        }

        const finalHtml = await fs.readFile(finalHtmlPath, 'utf8');
        const tempFile = path.join(outputDir, 'all_sections.html');
        await fs.writeFile(tempFile, finalHtml);
       
        const fullPath = path.resolve(tempFile);
        const fileUrl = `file://${fullPath}`;
       
        if (shouldOpenBrowser || !browserProcess) {
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
                console.log('✅ Browser opened with final website');
            } catch (error) {
                console.log(`✅ Final website available at: ${fileUrl}`);
            }
        } else {
            console.log('✅ Updated browser display with final website');
        }
    } catch (error) {
        console.error('Error updating browser display:', error);
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