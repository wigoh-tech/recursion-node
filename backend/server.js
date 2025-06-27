// const express = require('express');
// const fs = require('fs/promises');
// const path = require('path');
// const { OpenAI } = require('openai');
// const cheerio = require('cheerio');
// require('dotenv').config(); // Load environment variables from .env file

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

// function splitJsonTree(parsed) {
//   const layoutTree = {};
//   const widgetTree = {};

//   for (const key in parsed) {
//     const { layout, widget } = splitNode(parsed[key]);
//     if (layout) layoutTree[key] = layout;
//     if (widget) widgetTree[key] = widget;
//   }

//   return { layoutTree, widgetTree };
// }

// // === OpenAI Integration Functions ===
// async function getMatchedStylesFromAI(widgets, computedStyles) {
//   const prompt = `
// You are a JSON-only engine. Do not return any explanation, markdown, or comments.

// Task:
// Match computedStyles to each widget using the best possible selector (id > className > tagName > selector).

// Instructions:
// - Return a JSON **array** of objects.
// - Each object must contain "id" and full "computedStyles" — do not leave any computedStyles empty, even if the tag is repeated.
// - Do NOT include markdown syntax like \`\`\`.

// Widgets:
// ${JSON.stringify(widgets, null, 2)}

// ComputedStyles:
// ${JSON.stringify(computedStyles, null, 2)}

// Response format:
// [
//   {
//     "id": "template-1",
//     "computedStyles": {
//       "color": "red",
//       ...
//     }
//   },
//   ...
// ]
// `;

//   const completion = await openai.chat.completions.create({
//     model: 'gpt-4o-mini',
//     messages: [{ role: 'user', content: prompt }],
//     temperature: 0
//   });

//   let raw = completion.choices[0].message.content.trim();

//   const arrayStart = raw.indexOf('[');
//   const arrayEnd = raw.lastIndexOf(']');

//   if (arrayStart === -1 || arrayEnd === -1) {
//     console.error('OpenAI did not return a valid JSON array:\n', raw);
//     throw new Error('Could not parse JSON from OpenAI response');
//   }

//   let jsonStr = raw.slice(arrayStart, arrayEnd + 1).replace(/,\s*([\]}])/g, '$1');

//   try {
//     const parsed = JSON.parse(jsonStr);
//     const arr = Array.isArray(parsed) ? parsed : [parsed];
//     const map = {};
//     for (const w of arr) {
//       if (w && w.id) map[w.id] = w.computedStyles || {};
//     }
//     return map;
//   } catch (err) {
//     console.error('JSON parse error after cleanup:', err, '\nRaw JSON:', jsonStr);
//     throw new Error('Could not parse JSON from OpenAI response');
//   }
// }

// async function inlineLayoutStyles(htmlContent, layoutStyles) {
//   const prompt = `
// CRITICAL REQUIREMENTS:
// 1. PRESERVE ALL TEMPLATE PLACEHOLDERS EXACTLY AS IS - they appear as {{template-n}}
// 2. Only convert these CSS properties to inline styles:
//    - Grid: display:grid, grid-template-*, gap, grid-column, grid-row, etc.
//    - Flex: display:flex, flex-direction, justify-content, align-items, etc.
//    - Position: position, top, right, bottom, left, z-index
//    - Size: width, height, min-width, max-width, etc.
// 3. Keep all other HTML structure and attributes unchanged
// 4. Only modify elements that have matching styles in the layoutStyles

// HTML:
// ${htmlContent}

// LAYOUT STYLES (JSON):
// ${JSON.stringify(layoutStyles, null, 2)}

// Return ONLY the optimized HTML with inline styles - NO explanations.
// The {{template-n}} placeholders must remain unchanged.
// `;

//   const completion = await openai.chat.completions.create({
//     model: 'gpt-3.5-turbo',
//     messages: [
//       {
//         role: 'system',
//         content: 'You are an expert HTML/CSS optimizer. Convert styles to inline while EXACTLY preserving template placeholders.'
//       },
//       {
//         role: 'user',
//         content: prompt
//       }
//     ],
//     temperature: 0.1,
//     max_tokens: 4000
//   });

//   let optimizedHtml = completion.choices[0]?.message?.content || '';
  
//   // Clean up the response
//   optimizedHtml = optimizedHtml
//     .replace(/```html/g, '')
//     .replace(/```/g, '')
//     .trim();

//   return optimizedHtml;
// }

// async function generateBareLayout(htmlContent) {
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

// Original HTML (${htmlContent.split('\n').length} lines):
// ${htmlContent}

// Provide optimized HTML wrapped in {{template-n}} tags (target ${Math.round(htmlContent.split('\n').length * 0.2)} lines):
// `;

//   const completion = await openai.chat.completions.create({
//     model: "gpt-3.5-turbo",
//     messages: [
//       {
//         role: "system",
//         content: `You are an HTML optimization expert. You MUST:
// 1. Preserve ALL {{template-xx}} placeholders
// 2. Wrap output in {{template-n}} tags
// 3. Achieve 70-80% line reduction
// 4. Maintain identical visual output
// 5. Use maximum CSS shorthand
// 6. Remove redundant elements`
//       },
//       {
//         role: "user",
//         content: prompt
//       }
//     ],
//     temperature: 0.1,
//     max_tokens: 4000
//   });

//   let optimizedCode = completion.choices[0]?.message?.content || '';
  
//   // Extract content from template tags
//   const templateMatch = optimizedCode.match(/\{\{template-n\}\}([\s\S]*?)\{\{\/template-n\}\}/);
//   if (templateMatch) {
//     optimizedCode = templateMatch[1].trim();
//   }

//   return optimizedCode;
// }

// // === Migration Process Functions ===
// let templateCounter = 1;

// async function processHtmlSection(htmlString, computedStyles = null, _sectionId) {
//   const $ = cheerio.load(htmlString);
//   const templates = [];

//   const WIDGET_TAGS = [
//     'h1','h2','h3','h4','h5','h6','p','span','button','a','img','svg','video','audio',
//     'input','textarea','select','label','strong','b','em','i','ul','ol','li','table',
//     'tr','td','th','form','iframe'
//   ];

//   $(WIDGET_TAGS.join(',')).each(function() {
//     const templateId = `template-${templateCounter++}`;
//     const element = $(this);
//     const tagName = this.tagName.toLowerCase();
//     const className = element.attr('class') || '';
//     const idAttr = element.attr('id') || '';

//     // Remove style attribute
//     element.removeAttr('style');

//     const widgetData = {
//       id: templateId,
//       type: getWidgetType(tagName),
//       tagName,
//       className,
//       idAttr,
//       innerHTML: element.html(),
//       outerHTML: $.html(element),
//       textContent: element.text() || '',
//       isContentWidget: true
//     };

//     templates.push(widgetData);
//     element.replaceWith(`{{${templateId}}}`);
//   });

//   let computedMap = {};
//   if (computedStyles) {
//     computedMap = await getMatchedStylesFromAI(templates, computedStyles);
//   }

//   for (let w of templates) {
//     w.computedStyles = computedMap[w.id] || {};
//   }

//   return {
//     processedHtml: $.html(),
//     templates
//   };
// }

// function getWidgetType(tag) {
//   if (['h1','h2','h3','h4','h5','h6'].includes(tag)) return 'heading';
//   if (tag === 'p') return 'paragraph';
//   if (tag === 'span') return 'text-span';
//   if (tag === 'button') return 'button';
//   if (tag === 'a') return 'link';
//   if (tag === 'img') return 'image';
//   if (tag === 'svg') return 'svg-icon';
//   if (tag === 'video') return 'video';
//   if (['input','textarea','select'].includes(tag)) return 'form-input';
//   return 'content-widget';
// }

// // === API Routes ===

// // Main migration endpoint
// app.post('/api/migrate', async (req, res) => {
//   try {
//     console.log('🚀 Starting migration process...');
    
//     // Check if OpenAI API key exists
//     if (!process.env.OPENAI_API_KEY) {
//       return res.status(500).json({ 
//         error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.' 
//       });
//     }

//     // Step 1: Load input files
//     const computedStylesPath = path.join(__dirname, 'computed-styles.json');
//     const fullHtmlPath = path.join(__dirname, 'full.html');

//     const computedStylesContent = await fs.readFile(computedStylesPath, 'utf8');
//     const fullHtmlContent = await fs.readFile(fullHtmlPath, 'utf8');

//     const computedStyles = JSON.parse(computedStylesContent);
//     const sectionKeys = Object.keys(computedStyles);

//     console.log(`📊 Found ${sectionKeys.length} sections to process`);

//     const results = [];

//     // Recursive processing of sections
//     for (let i = 0; i < sectionKeys.length; i++) {
//       const sectionKey = sectionKeys[i];
//       console.log(`\n--- Processing Section ${i + 1}/${sectionKeys.length}: ${sectionKey} ---`);

//       try {
//         const sectionResult = await processSingleSection(
//           sectionKey, 
//           computedStyles[sectionKey], 
//           fullHtmlContent, 
//           i + 1
//         );
//         results.push(sectionResult);
//         console.log(`✅ Section ${sectionKey} completed successfully!`);
//       } catch (error) {
//         console.error(`❌ Error processing section ${sectionKey}:`, error.message);
//         results.push({
//           section: sectionKey,
//           error: error.message,
//           success: false
//         });
//       }
//     }

//     res.json({
//       success: true,
//       totalSections: sectionKeys.length,
//       processedSections: results.length,
//       results
//     });

//   } catch (error) {
//     console.error('Migration failed:', error);
//     res.status(500).json({
//       error: 'Migration failed',
//       message: error.message
//     });
//   }
// });

// // Process a single section through all steps
// async function processSingleSection(sectionKey, sectionStyles, fullHtml, sectionNumber) {
//   console.log(`🔄 Processing section: ${sectionKey}`);

//   // Step 2: Extract widgets and layout
//   console.log('📋 Step 2: Extracting widgets and layout...');
//   const { layoutTree, widgetTree } = splitJsonTree({ [sectionKey]: sectionStyles });
  
//   await fs.writeFile(
//     path.join(__dirname, `widgets_${sectionKey}.json`),
//     JSON.stringify(widgetTree, null, 2)
//   );
  
//   await fs.writeFile(
//     path.join(__dirname, `layout_${sectionKey}.json`),
//     JSON.stringify(layoutTree, null, 2)
//   );

//   // Step 3: Generate templates
//   console.log('🏗️ Step 3: Generating templates...');
//   const templateResult = await processHtmlSection(fullHtml, sectionStyles, sectionKey);
  
//   await fs.writeFile(
//     path.join(__dirname, `template_${sectionKey}.json`),
//     JSON.stringify(templateResult.templates, null, 2)
//   );
  
//   await fs.writeFile(
//     path.join(__dirname, `templated-output_${sectionKey}.html`),
//     templateResult.processedHtml
//   );

//   // Step 4: Inline layout styles
//   console.log('🎨 Step 4: Inlining layout styles...');
//   const inlineHtml = await inlineLayoutStyles(templateResult.processedHtml, layoutTree);
  
//   await fs.writeFile(
//     path.join(__dirname, `inline-layout-output_${sectionKey}.html`),
//     inlineHtml
//   );

//   // Step 5: Generate bare layout
//   console.log('🔧 Step 5: Generating bare layout...');
//   const bareHtml = await generateBareLayout(inlineHtml);
  
//   await fs.writeFile(
//     path.join(__dirname, `bare-layout-output_${sectionKey}.html`),
//     bareHtml
//   );

//   // Step 6: Save final output
//   console.log('💾 Step 6: Saving final output...');
//   const finalOutput = {
//     section: sectionKey,
//     sectionNumber,
//     processed: true,
//     timestamp: new Date().toISOString(),
//     files: {
//       widgets: `widgets_${sectionKey}.json`,
//       layout: `layout_${sectionKey}.json`,
//       template: `template_${sectionKey}.json`,
//       templatedHtml: `templated-output_${sectionKey}.html`,
//       inlineHtml: `inline-layout-output_${sectionKey}.html`,
//       bareHtml: `bare-layout-output_${sectionKey}.html`
//     }
//   };
  
//   await fs.writeFile(
//     path.join(__dirname, `final_${sectionKey}.json`),
//     JSON.stringify(finalOutput, null, 2)
//   );

//   return finalOutput;
// }

// // Status endpoint
// app.get('/api/status', (req, res) => {
//   res.json({
//     status: 'ready',
//     openaiConfigured: !!process.env.OPENAI_API_KEY,
//     timestamp: new Date().toISOString()
//   });
// });

// // Serve the HTML interface
// app.get('/', (req, res) => {
//   res.send(`
// <!DOCTYPE html>
// <html lang="en">
// <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>HTML Migration System</title>
//     <style>
//         body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
//         .button { background: #007bff; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer; }
//         .button:hover { background: #0056b3; }
//         .button:disabled { background: #ccc; cursor: not-allowed; }
//         .status { margin: 20px 0; padding: 15px; border-radius: 5px; }
//         .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
//         .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
//         .loading { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
//         pre { background: #f8f9fa; padding: 15px; border-radius: 5px; overflow-x: auto; }
//     </style>
// </head>
// <body>
//     <h1>🚀 HTML Migration System</h1>
//     <p>Automated multi-step processing with recursive section handling</p>
    
//     <button id="migrateBtn" class="button" onclick="startMigration()">START MIGRATION</button>
    
//     <div id="status"></div>
//     <div id="results"></div>

//     <script>
//         async function startMigration() {
//             const btn = document.getElementById('migrateBtn');
//             const status = document.getElementById('status');
//             const results = document.getElementById('results');
            
//             btn.disabled = true;
//             btn.textContent = 'PROCESSING...';
            
//             status.innerHTML = '<div class="status loading">🔄 Migration in progress...</div>';
//             results.innerHTML = '';
            
//             try {
//                 const response = await fetch('/api/migrate', {
//                     method: 'POST',
//                     headers: { 'Content-Type': 'application/json' }
//                 });
                
//                 const data = await response.json();
                
//                 if (data.success) {
//                     status.innerHTML = '<div class="status success">✅ Migration completed successfully!</div>';
//                     results.innerHTML = '<h3>Results:</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
//                 } else {
//                     status.innerHTML = '<div class="status error">❌ Migration failed: ' + data.message + '</div>';
//                 }
//             } catch (error) {
//                 status.innerHTML = '<div class="status error">❌ Error: ' + error.message + '</div>';
//             } finally {
//                 btn.disabled = false;
//                 btn.textContent = 'START MIGRATION';
//             }
//         }
        
//         // Check status on load
//         fetch('/api/status').then(r => r.json()).then(data => {
//             if (!data.openaiConfigured) {
//                 document.getElementById('status').innerHTML = 
//                     '<div class="status error">⚠️ OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.</div>';
//             }
//         });
//     </script>
// </body>
// </html>
//   `);
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Migration server running on http://localhost:${PORT}`);
//   console.log(`📋 OpenAI API Key configured: ${!!process.env.OPENAI_API_KEY}`);
//   console.log(`📁 Working directory: ${__dirname}`);
// });

// module.exports = app;
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

// function splitJsonTree(parsed) {
//   const layoutTree = {};
//   const widgetTree = {};

//   for (const key in parsed) {
//     const { layout, widget } = splitNode(parsed[key]);
//     if (layout) layoutTree[key] = layout;
//     if (widget) widgetTree[key] = widget;
//   }

//   return { layoutTree, widgetTree };
// }

// // === Section Extraction Function ===
// function extractSectionFromHtml(htmlContent, sectionId) {
//   const $ = cheerio.load(htmlContent);
  
//   // Try different selector patterns to find the section
//   const selectors = [
//     `#${sectionId}`,
//     `[id="${sectionId}"]`,
//     `[data-section="${sectionId}"]`,
//     `.${sectionId}`,
//     `[class*="${sectionId}"]`
//   ];
  
//   let sectionElement = null;
//   for (const selector of selectors) {
//     sectionElement = $(selector).first();
//     if (sectionElement.length > 0) break;
//   }
  
//   if (!sectionElement || sectionElement.length === 0) {
//     console.warn(`⚠️ Section ${sectionId} not found in HTML, using fallback approach`);
//     // Fallback: try to find by text content or use entire body
//     return $.html();
//   }
  
//   return $.html(sectionElement);
// }

// // === OpenAI Integration Functions ===
// async function generateTemplateWithAI(sectionHtml, widgetData, sectionId) {
//   let templateCounter = 1;
  
//   const prompt = `
// You are an HTML processing AI. Your task is to:

// 1. Analyze the provided HTML section and widget data
// 2. Replace widget elements with {{template-n}} placeholders
// 3. Extract widget information and styles
// 4. Return a JSON response with the processed HTML and template data

// CRITICAL REQUIREMENTS:
// - Replace widget elements (h1, h2, h3, h4, h5, h6, p, span, button, a, img, svg, video, etc.) with {{template-n}} placeholders
// - Preserve the overall HTML structure and layout elements
// - Extract complete widget information including styles
// - Use sequential numbering for templates (template-1, template-2, etc.)

// Section HTML:
// ${sectionHtml}

// Widget Data Reference:
// ${JSON.stringify(widgetData, null, 2)}

// Return ONLY a valid JSON object in this format:
// {
//   "processedHtml": "HTML with {{template-n}} placeholders",
//   "templates": [
//     {
//       "id": "template-1",
//       "type": "heading",
//       "tagName": "h1",
//       "className": "class-name",
//       "idAttr": "element-id",
//       "innerHTML": "inner content",
//       "textContent": "text only",
//       "styles": {},
//       "isContentWidget": true
//     }
//   ]
// }
// `;

//   const completion = await openai.chat.completions.create({
//     model: 'gpt-4o-mini',
//     messages: [
//       {
//         role: 'system',
//         content: 'You are an HTML processing expert. Return only valid JSON responses without markdown formatting.'
//       },
//       {
//         role: 'user',
//         content: prompt
//       }
//     ],
//     temperature: 0.1
//   });

//   const response = completion.choices[0].message.content.trim();
  
//   try {
//     // Clean response of markdown if present
//     const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
//     return JSON.parse(cleanResponse);
//   } catch (error) {
//     console.error('Failed to parse AI response:', error);
//     console.error('Raw response:', response);
//     throw new Error('Invalid JSON response from AI');
//   }
// }

// async function inlineLayoutStyles(htmlContent, layoutStyles) {
//   const prompt = `
// CRITICAL REQUIREMENTS:
// 1. PRESERVE ALL {{template-n}} placeholders EXACTLY AS IS
// 2. Apply inline styles from the provided layoutStyles JSON to matching elements
// 3. Only apply layout-related CSS properties (grid, flex, position, dimensions)
// 4. Keep all other HTML structure unchanged
// 5. Match elements by id, class, or tag name

// HTML Content:
// ${htmlContent}

// Layout Styles to Apply:
// ${JSON.stringify(layoutStyles, null, 2)}

// Return ONLY the HTML with inline styles applied - NO explanations or markdown.
// The {{template-n}} placeholders must remain unchanged.
// `;

//   const completion = await openai.chat.completions.create({
//     model: 'gpt-3.5-turbo',
//     messages: [
//       {
//         role: 'system',
//         content: 'You are an HTML/CSS expert. Apply inline styles while preserving template placeholders exactly.'
//       },
//       {
//         role: 'user',
//         content: prompt
//       }
//     ],
//     temperature: 0.1,
//     max_tokens: 4000
//   });

//   let optimizedHtml = completion.choices[0]?.message?.content || '';
  
//   // Clean up the response
//   optimizedHtml = optimizedHtml
//     .replace(/```html/g, '')
//     .replace(/```/g, '')
//     .trim();

//   return optimizedHtml;
// }

// async function generateBareLayout(htmlContent) {
//   const prompt = `
// CRITICAL REQUIREMENTS:
// 1. PRESERVE ALL {{template-n}} placeholders EXACTLY
// 2. Generate minimal, clean HTML structure
// 3. Remove unnecessary wrapper elements
// 4. Use efficient CSS (flexbox/grid where appropriate)
// 5. Maintain visual layout integrity
// 6. Use maximum CSS shorthand properties
// 7. Achieve significant code reduction while preserving functionality

// Input HTML:
// ${htmlContent}

// Return ONLY the optimized minimal HTML - NO explanations or markdown.
// Preserve all {{template-n}} placeholders exactly as they are.
// `;

//   const completion = await openai.chat.completions.create({
//     model: "gpt-3.5-turbo",
//     messages: [
//       {
//         role: "system",
//         content: "You are an HTML optimization expert. Create minimal, efficient HTML while preserving all template placeholders and visual layout."
//       },
//       {
//         role: "user",
//         content: prompt
//       }
//     ],
//     temperature: 0.1,
//     max_tokens: 4000
//   });

//   let optimizedCode = completion.choices[0]?.message?.content || '';
  
//   // Clean up response
//   optimizedCode = optimizedCode
//     .replace(/```html/g, '')
//     .replace(/```/g, '')
//     .trim();

//   return optimizedCode;
// }

// // === Main Migration Process ===
// async function processSingleSection(sectionId, sectionStyles, rawHtmlContent, sectionNumber) {
//   console.log(`\n🔄 Processing Section ${sectionNumber}: ${sectionId}`);
  
//   // Step 1: Extract widgets and layout from computed styles
//   console.log('📋 Step 1: Extracting widgets and layout from computed styles...');
//   const { layoutTree, widgetTree } = splitJsonTree({ [sectionId]: sectionStyles });
  
//   // Save step 1 outputs
//   await fs.writeFile(
//     path.join(__dirname, `output/step1_widgets_${sectionId}.json`),
//     JSON.stringify(widgetTree, null, 2)
//   );
  
//   await fs.writeFile(
//     path.join(__dirname, `output/step1_layout_${sectionId}.json`),
//     JSON.stringify(layoutTree, null, 2)
//   );

//   // Step 2: Extract section HTML and generate templates
//   console.log('🏗️ Step 2: Extracting section HTML and generating templates...');
//   const sectionHtml = extractSectionFromHtml(rawHtmlContent, sectionId);
  
//   const templateResult = await generateTemplateWithAI(sectionHtml, widgetTree, sectionId);
  
//   // Save step 2 outputs
//   await fs.writeFile(
//     path.join(__dirname, `output/step2_section_html_${sectionId}.html`),
//     sectionHtml
//   );
  
//   await fs.writeFile(
//     path.join(__dirname, `output/step2_templates_${sectionId}.json`),
//     JSON.stringify(templateResult, null, 2)
//   );

//   // Step 3: Apply inline layout styles
//   console.log('🎨 Step 3: Applying inline layout styles...');
//   const inlineHtml = await inlineLayoutStyles(templateResult.processedHtml, layoutTree);
  
//   await fs.writeFile(
//     path.join(__dirname, `output/step3_inline_layout_${sectionId}.html`),
//     inlineHtml
//   );

//   // Step 4: Generate bare minimum HTML
//   console.log('🔧 Step 4: Generating bare minimum HTML...');
//   const bareHtml = await generateBareLayout(inlineHtml);
  
//   await fs.writeFile(
//     path.join(__dirname, `output/step4_bare_layout_${sectionId}.html`),
//     bareHtml
//   );

//   // Save final summary
//   const finalResult = {
//     section: sectionId,
//     sectionNumber,
//     processed: true,
//     timestamp: new Date().toISOString(),
//     steps: {
//       step1: {
//         widgets: `step1_widgets_${sectionId}.json`,
//         layout: `step1_layout_${sectionId}.json`
//       },
//       step2: {
//         sectionHtml: `step2_section_html_${sectionId}.html`,
//         templates: `step2_templates_${sectionId}.json`
//       },
//       step3: {
//         inlineLayout: `step3_inline_layout_${sectionId}.html`
//       },
//       step4: {
//         bareLayout: `step4_bare_layout_${sectionId}.html`
//       }
//     },
//     summary: {
//       widgetCount: templateResult.templates ? templateResult.templates.length : 0,
//       originalHtmlSize: sectionHtml.length,
//       finalHtmlSize: bareHtml.length,
//       compressionRatio: ((sectionHtml.length - bareHtml.length) / sectionHtml.length * 100).toFixed(1) + '%'
//     }
//   };
  
//   await fs.writeFile(
//     path.join(__dirname, `output/final_summary_${sectionId}.json`),
//     JSON.stringify(finalResult, null, 2)
//   );

//   console.log(`✅ Section ${sectionId} processing completed!`);
//   console.log(`   - Widgets extracted: ${finalResult.summary.widgetCount}`);
//   console.log(`   - Size reduction: ${finalResult.summary.compressionRatio}`);
  
//   return finalResult;
// }

// // === API Routes ===
// app.post('/api/migrate', async (req, res) => {
//   try {
//     console.log('🚀 Starting recursive section-by-section migration...');
    
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

//     const sectionIds = Object.keys(computedStyles);
//     console.log(`📊 Found ${sectionIds.length} sections to process:`, sectionIds);

//     const results = [];
//     const errors = [];

//     // Process each section recursively
//     for (let i = 0; i < sectionIds.length; i++) {
//       const sectionId = sectionIds[i];
//       const sectionStyles = computedStyles[sectionId];
      
//       try {
//         console.log(`\n--- Processing Section ${i + 1}/${sectionIds.length}: ${sectionId} ---`);
        
//         const sectionResult = await processSingleSection(
//           sectionId, 
//           sectionStyles, 
//           rawHtmlContent, 
//           i + 1
//         );
        
//         results.push(sectionResult);
        
//       } catch (error) {
//         console.error(`❌ Error processing section ${sectionId}:`, error.message);
//         errors.push({
//           section: sectionId,
//           error: error.message,
//           timestamp: new Date().toISOString()
//         });
//       }
//     }

//     // Generate final migration report
//     const migrationReport = {
//       success: true,
//       totalSections: sectionIds.length,
//       processedSections: results.length,
//       failedSections: errors.length,
//       timestamp: new Date().toISOString(),
//       results,
//       errors: errors.length > 0 ? errors : undefined,
//       summary: {
//         totalWidgets: results.reduce((sum, r) => sum + (r.summary?.widgetCount || 0), 0),
//         averageCompression: results.length > 0 
//           ? (results.reduce((sum, r) => sum + parseFloat(r.summary?.compressionRatio || '0'), 0) / results.length).toFixed(1) + '%'
//           : '0%'
//       }
//     };

//     await fs.writeFile(
//       path.join(__dirname, 'output/migration_report.json'),
//       JSON.stringify(migrationReport, null, 2)
//     );

//     console.log('\n🎉 Migration completed!');
//     console.log(`✅ Successfully processed: ${results.length} sections`);
//     console.log(`❌ Failed: ${errors.length} sections`);
//     console.log(`📊 Total widgets extracted: ${migrationReport.summary.totalWidgets}`);
//     console.log(`📉 Average compression: ${migrationReport.summary.averageCompression}`);

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
    
//     res.json({ files, count: files.length });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// // Serve the HTML interface
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
  
  const prompt = `
You are processing HTML section content to replace widget elements with template placeholders.

CRITICAL REQUIREMENTS:
1. Identify all widget elements (h1, h2, h3, h4, h5, h6, p, span, button, a, img, svg, video, etc.)
2. Replace each widget with {{template-N}} placeholders (starting from the next available template number)
3. Extract complete widget information including all styles and attributes
4. Return ONLY valid JSON with processedHtml and templates array

Section HTML:
${sectionHtml}

Widget Styles Data:
${JSON.stringify(widgetsData, null, 2)}

Current global template count: ${globalTemplates.length}

Return JSON format:
{
  "processedHtml": "HTML with {{template-N}} placeholders",
  "templates": [
    {
      "id": "template-N",
      "type": "widget_type",
      "tagName": "tag",
      "className": "classes",
      "idAttr": "element_id",
      "innerHTML": "content",
      "textContent": "text_only",
      "styles": {},
      "attributes": {}
    }
  ]
}
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an HTML processing expert. Return only valid JSON responses.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1
  });

  const response = completion.choices[0].message.content.trim();
  const cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  try {
    const result = JSON.parse(cleanResponse);
    
    // Save template section HTML
    const templateSectionFile = `template_section_${sectionIndex}.html`;
    await fs.writeFile(
      path.join(outputDir, templateSectionFile),
      result.processedHtml
    );
    
    // Save local placeholders
    const placeholdersFile = `template_section_${sectionIndex}_placeholders.json`;
    await fs.writeFile(
      path.join(outputDir, placeholdersFile),
      JSON.stringify(result.templates, null, 2)
    );
    
    // Update global templates
    globalTemplates.push(...result.templates);
    
    console.log(`   ✅ Created ${result.templates.length} placeholders, saved to ${templateSectionFile}`);
    
    return {
      processedHtml: result.processedHtml,
      templates: result.templates,
      templateSectionFile,
      placeholdersFile
    };
    
  } catch (error) {
    console.error('Failed to parse widget processing response:', error);
    throw error;
  }
}

// Step 2 of recursive process: Apply inline layout styles
// async function applyInlineLayoutStyles(sectionIndex, templateHtml, layoutsData, outputDir) {
//   console.log(`   🎨 Step 2: Applying inline layout styles for section ${sectionIndex}...`);
  
//   const prompt = `
// CRITICAL REQUIREMENTS:
// 1. PRESERVE ALL {{template-n}} PLACEHOLDERS EXACTLY AS IS - DO NOT MODIFY OR REMOVE THEM
// 2. Only convert layout-related CSS properties to inline styles:
//    - Grid: display:grid, grid-template-*, gap, grid-column, grid-row, etc.
//    - Flex: display:flex, flex-direction, justify-content, align-items, etc.
//    - Position: position, top, right, bottom, left, z-index
//    - Size: width, height, min-width, max-width, etc.
// 3. Keep all HTML structure, attributes and {{template-n}} placeholders unchanged
// 4. Only modify elements that have matching styles in the computedStyles
// 5. Do not add any additional elements or remove existing ones
// 6. Maintain all original class names and IDs

// HTML to process (WITH PROTECTED TEMPLATES):
// ${templateHtml}

// Layout Styles Data:
// ${JSON.stringify(layoutsData, null, 2)}

// Return ONLY the modified HTML with inline styles added - NO explanations, NO code blocks. 
// All {{template-n}} placeholders must remain unchanged and in their original positions.
// `;

//   const completion = await openai.chat.completions.create({
//     model: 'gpt-3.5-turbo',
//     messages: [
//       {
//         role: 'system',
//         content: 'You are an expert HTML/CSS optimizer. Convert styles to inline while EXACTLY preserving template placeholders.'
//       },
//       {
//         role: 'user',
//         content: prompt
//       }
//     ],
//     temperature: 0.1,
//     max_tokens: 4000
//   });

//   let styledHtml = completion.choices[0]?.message?.content || '';
//   styledHtml = styledHtml.replace(/```html/g, '').replace(/```/g, '').trim();
  
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
1. NEVER modify or remove ANY tokens that start with __PROTECTED_PLACEHOLDER_
2. Only convert layout-related CSS properties to inline styles:
   - Grid: display:grid, grid-template-*, gap, grid-column, grid-row, etc.
   - Flex: display:flex, flex-direction, justify-content, align-items, etc.
   - Position: position, top, right, bottom, left, z-index
   - Size: width, height, min-width, max-width, etc.
3. Keep all HTML structure, attributes and __PROTECTED_PLACEHOLDER_ tokens unchanged
4. Only modify elements that have matching styles in the computedStyles
5. Do not add any additional elements or remove existing ones
6. Maintain all original class names and IDs
7. ALL __PROTECTED_PLACEHOLDER_ tokens MUST remain in the output

HTML to process (WITH PROTECTED TOKENS):
${protectedHtml}

Layout Styles Data:
${JSON.stringify(layoutsData, null, 2)}

Return ONLY the modified HTML with inline styles added - NO explanations, NO code blocks, NO markdown formatting.
ALL __PROTECTED_PLACEHOLDER_ tokens must remain unchanged and in their original positions.
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: 'You are an expert HTML/CSS optimizer. Convert styles to inline while EXACTLY preserving all __PROTECTED_PLACEHOLDER_ tokens. Never modify or remove protected tokens.'
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
    
    // Fallback: Use original HTML with manual inline style application
    console.log(`   🔄 Falling back to manual style application...`);
    styledHtml = await applyInlineStylesManually(templateHtml, layoutsData);
  }
  
  const layoutInlineFile = `layout_inlineStyles_${sectionIndex}.html`;
  await fs.writeFile(
    path.join(outputDir, layoutInlineFile),
    styledHtml
  );
  
  console.log(`   ✅ Applied inline styles, saved to ${layoutInlineFile}`);
  
  return {
    styledHtml,
    layoutInlineFile
  };
}

// Step 3 of recursive process: Generate bare minimum HTML
async function generateBareMinimumHtml(sectionIndex, styledHtml, outputDir) {
  console.log(`   🔧 Step 3: Generating bare minimum HTML for section ${sectionIndex}...`);
  
  const prompt = `
CRITICAL REQUIREMENTS:
1. MUST wrap final output in {{template-n}} tags
2. MUST preserve ALL {{template-xx}} placeholders
3. MUST achieve 70-80% line reduction
4. MUST maintain pixel-perfect visual match
4. MUST use line-styles only (no classes, no <style> tags)
5. MUST use maximum CSS shorthand
6. MUST remove all unnecessary elements and wrappers
7. MUST use modern CSS techniques (Flexbox/Grid)

OPTIMIZATION TECHNIQUES TO USE:
- Remove ALL unnecessary wrapper divs
- Use CSS Grid/Flexbox efficiently
- Maximum CSS shorthand (inset, margin/padding shorthand)
- Combine redundant styles
- Eliminate empty/irrelevant elements

FAILURE CONDITIONS:
❌ Missing {{template-n}} wrapper
❌ Missing any {{template-xx}} placeholder  
❌ Less than 70% reduction
❌ Visual differences

Input HTML:
${styledHtml}

Return only the clean, minimal HTML structure.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `You are an HTML optimization expert. You MUST:
1. Preserve ALL {{template-xx}} placeholders
2. Wrap output in {{template-n}} tags
3. Achieve 70-80% line reduction
4. Maintain identical visual output
5. Use maximum CSS shorthand
6. Remove redundant elements`
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
  bareHtml = bareHtml.replace(/```html/g, '').replace(/```/g, '').trim();
  
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

// Status endpoint
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

