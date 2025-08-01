
// BusinessLogic.js - Injectable function
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

async function optimizeBgLayersWithAI(html, id) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `${BGLAYERS_OPTIMIZATION_PROMPT}\n${html}`
      }],
      temperature: 0,
      max_tokens: 12288
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const optimizedHtml = data.choices[0].message.content.trim();
  
  return optimizedHtml
    .replace(/^```html\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}
