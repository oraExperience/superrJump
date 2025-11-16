
// OpenRouter Vision-Based PDF Parser
// Uses OpenRouter API - unified access to multiple vision models
// Supports: GPT-4 Vision, Claude 3 Vision, Gemini Vision, and more

const fs = require('fs');
const path = require('path');
const visionConfig = require('../config/visionConfig');

/**
 * Extract questions by sending PDF images to OpenRouter Vision
 * @param {Array} imagePages - Array of {pageNumber, imagePath}
 * @returns {Promise<Array>} - Questions with coordinates
 */
async function extractQuestionsFromImages(imagePages) {
  try {
    console.log('🌐 Using OPENROUTER VISION AI - processing each page separately...\n');
    
    // Check for API key
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not found in environment variables');
    }
    
    const allQuestions = [];
    
    // Process each page image separately
    for (const page of imagePages) {
      console.log(`📄 Processing page ${page.pageNumber} with OpenRouter Vision...`);
      
      try {
        const questions = await extractQuestionsFromImage(page.imagePath, page.pageNumber);
        
        if (questions.length > 0) {
          allQuestions.push(...questions);
          console.log(`   ✅ Found ${questions.length} questions on page ${page.pageNumber}\n`);
        }
      } catch (pageError) {
        console.error(`   ❌ Failed to process page ${page.pageNumber}:`, pageError.message);
      }
    }
    
    console.log(`✅ Total questions extracted: ${allQuestions.length}`);
    return allQuestions;
    
  } catch (error) {
    console.error('❌ OpenRouter Vision extraction failed:', error.message);
    throw error;
  }
}

/**
 * Extract questions from ALL images in a single request using OpenRouter Vision
 * This is more efficient and provides better context to the AI
 */
async function extractQuestionsFromAllImages(imagePages) {
  try {
    // Read all images as base64
    const imageContents = [];
    for (const page of imagePages) {
      const imageBuffer = fs.readFileSync(page.imagePath);
      const base64Image = imageBuffer.toString('base64');
      imageContents.push({
        pageNumber: page.pageNumber,
        base64: base64Image
      });
    }
    
    const prompt = `You are a PRECISE exam paper reader. I'm giving you ${imagePages.length} page(s) of an exam paper. Extract EVERY question from ALL pages.

🚨 CRITICAL: Read mathematical expressions CHARACTER BY CHARACTER 🚨

MATHEMATICAL NOTATION GUIDE:

1. INTEGRAL SYMBOLS - Always check for ∫:
   
   EXAMPLE FROM IMAGE:
   If you see: ∫₋π/₄⁴ x³·sin⁴x dx = k
   
   READ IT AS: "If integral from negative pi divided by 4 to 4 of x cubed times sine to the power 4 of x dx equals k"
   
   BREAKDOWN:
   - ∫ = "integral"
   - Subscript (bottom limit) = "from [value]"
   - Superscript (top limit) = "to [value]"
   - -π/4 = "negative pi divided by 4"
   - 4 = "4"
   - x³ = "x cubed" (look for small 3 above x)
   - · = "times"
   - sin⁴x = "sine to the power 4 of x" (look for small 4 above sin)
   - dx = "dx"

2. POWERS & EXPONENTS - Look for small numbers above:
   - x² = "x squared" (small 2 above x)
   - x³ = "x cubed" (small 3 above x)
   - x⁴ = "x to the power 4" (small 4 above x)
   - sin²x = "sine squared of x"
   - sin⁴x = "sine to the power 4 of x"
   - e^x = "e to the power x"
   - 2^x = "2 to the power x"

3. FRACTIONS IN LIMITS:
   - π/4 = "pi divided by 4"
   - -π/4 = "negative pi divided by 4"
   - 3π/2 = "3 pi divided by 2"

4. LOGICAL SYMBOLS:
   - ∨ = "or"
   - ∧ = "and"
   - ¬ = "not"
   - → = "implies"

5. GREEK LETTERS:
   - π = "pi"
   - θ = "theta"
   - α = "alpha"
   - β = "beta"
   - γ = "gamma"

6. OTHER SYMBOLS:
   - √ = "square root of"
   - · = "times" or "dot"
   - × = "times"
   - ÷ = "divided by"
   - ≠ = "not equal to"
   - ≤ = "less than or equal to"
   - ≥ = "greater than or equal to"

MULTIPLE CHOICE - Include ALL options:
Format: "Question text. Options: (a) option_a, (b) option_b, (c) option_c, (d) option_d"

WHAT TO SKIP:
- Instructions ("Attempt any 5", "Select and write")
- Section headers ("SECTION – A", "Q. 1.")
- Page numbers
- "multiple choice type of questions" text

IMPORTANT: For each question, specify which page number it's from (1, 2, 3, etc.)

EXAMPLE CONVERSION:
Image shows: "If ∫₋π/₄⁴ x³·sin⁴x dx = k then k = _____."
You write: "If integral from negative pi divided by 4 to 4 of x cubed times sine to the power 4 of x dx equals k then k equals blank."

Return JSON array ONLY (no markdown, no explanation):
[
  {
    "question_number": "1",
    "question_text": "Complete question with ALL mathematical notation in plain English",
    "marks": 2,
    "page_number": 1
  }
]`;

    // Build content array with prompt + all images
    const contentArray = [
      {
        type: 'text',
        text: prompt
      }
    ];
    
    // Add all images
    for (const img of imageContents) {
      contentArray.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${img.base64}`
        }
      });
    }
    
    // Log prompt
    console.log('\n' + '='.repeat(80));
    console.log('📋 OPENROUTER VISION PROMPT (ALL PAGES):');
    console.log('='.repeat(80));
    console.log(prompt.substring(0, 300) + '...');
    console.log(`📸 Sending ${imageContents.length} page images`);
    console.log('='.repeat(80) + '\n');
    
    // Call OpenRouter API with all images
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://superrjump.com',
        'X-Title': 'SuperRJump Question Extractor'
      },
      body: JSON.stringify({
        model: visionConfig.models.openrouter.model,  // Model from config
        messages: [
          {
            role: 'user',
            content: contentArray
          }
        ],
        max_tokens: visionConfig.models.openrouter.maxTokens,  // Max tokens from config
        temperature: 0.2
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    // Log response
    console.log('\n' + '='.repeat(80));
    console.log('📝 OPENROUTER VISION RESPONSE (ALL PAGES):');
    console.log('='.repeat(80));
    const responseText = result.choices[0]?.message?.content || '[]';
    console.log(responseText);  // Print full response
    console.log('='.repeat(80) + '\n');
    
    // Parse response
    let questionsData;
    try {
      // Remove markdown code blocks if present
      const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      questionsData = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('Failed to parse JSON response:', parseError.message);
      throw new Error('Failed to parse AI response as JSON');
    }
    
    if (!Array.isArray(questionsData)) {
      throw new Error('AI response is not an array');
    }
    
    // Convert to standard format
    const questions = questionsData.map(q => ({
      number: q.question_number || 'unknown',
      text: q.question_text || '',
      marks: q.marks || undefined,
      page: q.page_number || 1,
      bbox: {
        x1: 100,
        y1: 100,
        x2: 1685,
        y2: 350
      }
    }));
    
    console.log(`   ✅ Found ${questions.length} questions across all pages`);
    
    return questions;
    
  } catch (error) {
    throw new Error(`Failed to extract from all images: ${error.message}`);
  }
}

/**
 * Extract questions from a single image using OpenRouter Vision (DEPRECATED - use extractQuestionsFromAllImages)
 */
async function extractQuestionsFromImage(imagePath, pageNumber) {
  try {
    // Read image file as base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const prompt = `You are a PRECISE exam paper reader. Look VERY carefully at this image and extract EVERY question with COMPLETE mathematical notation.

🚨 CRITICAL: Read mathematical expressions CHARACTER BY CHARACTER 🚨

MATHEMATICAL NOTATION GUIDE:

1. INTEGRAL SYMBOLS - Always check for ∫:
   
   EXAMPLE FROM IMAGE:
   If you see: ∫₋π/₄⁴ x³·sin⁴x dx = k
   
   READ IT AS: "If integral from negative pi divided by 4 to 4 of x cubed times sine to the power 4 of x dx equals k"
   
   BREAKDOWN:
   - ∫ = "integral"
   - Subscript (bottom limit) = "from [value]"
   - Superscript (top limit) = "to [value]"
   - -π/4 = "negative pi divided by 4"
   - 4 = "4"
   - x³ = "x cubed" (look for small 3 above x)
   - · = "times"
   - sin⁴x = "sine to the power 4 of x" (look for small 4 above sin)
   - dx = "dx"

2. POWERS & EXPONENTS - Look for small numbers above:
   - x² = "x squared" (small 2 above x)
   - x³ = "x cubed" (small 3 above x)
   - x⁴ = "x to the power 4" (small 4 above x)
   - sin²x = "sine squared of x"
   - sin⁴x = "sine to the power 4 of x"
   - e^x = "e to the power x"
   - 2^x = "2 to the power x"

3. FRACTIONS IN LIMITS:
   - π/4 = "pi divided by 4"
   - -π/4 = "negative pi divided by 4"
   - 3π/2 = "3 pi divided by 2"

4. LOGICAL SYMBOLS:
   - ∨ = "or"
   - ∧ = "and"
   - ¬ = "not"
   - → = "implies"

5. GREEK LETTERS:
   - π = "pi"
   - θ = "theta"
   - α = "alpha"
   - β = "beta"
   - γ = "gamma"

6. OTHER SYMBOLS:
   - √ = "square root of"
   - · = "times" or "dot"
   - × = "times"
   - ÷ = "divided by"
   - ≠ = "not equal to"
   - ≤ = "less than or equal to"
   - ≥ = "greater than or equal to"

MULTIPLE CHOICE - Include ALL options:
Format: "Question text. Options: (a) option_a, (b) option_b, (c) option_c, (d) option_d"

WHAT TO SKIP:
- Instructions ("Attempt any 5", "Select and write")
- Section headers ("SECTION – A", "Q. 1.")
- Page numbers
- "multiple choice type of questions" text

EXAMPLE CONVERSION:
Image shows: "If ∫₋π/₄⁴ x³·sin⁴x dx = k then k = _____."
You write: "If integral from negative pi divided by 4 to 4 of x cubed times sine to the power 4 of x dx equals k then k equals blank."

Return JSON array ONLY (no markdown, no explanation):
[
  {
    "question_number": "i",
    "question_text": "Complete question with ALL mathematical notation in plain English",
    "marks": 2,
    "estimated_y": 500
  }
]`;

    // Log prompt
    console.log('\n' + '='.repeat(80));
    console.log('📋 OPENROUTER VISION PROMPT:');
    console.log('='.repeat(80));
    console.log(prompt.substring(0, 300) + '...');
    console.log('='.repeat(80) + '\n');
    
    // Call OpenRouter API
    // Using google/gemini-pro-1.5 (best free vision model on OpenRouter)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://superrjump.com',
        'X-Title': 'SuperRJump Question Extractor'
      },
      body: JSON.stringify({
        model: visionConfig.models.openrouter.model,  // Model from config
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: visionConfig.models.openrouter.maxTokens,  // Max tokens from config
        temperature: 0.2
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    // Log full response
    console.log('\n' + '='.repeat(80));
    console.log('📝 OPENROUTER VISION RESPONSE:');
    console.log('='.repeat(80));
    const responseText = result.choices[0]?.message?.content || '[]';
    console.log(responseText);  // Print full response
    console.log('='.repeat(80) + '\n');
    
    // Parse response
    let text = responseText;
    
    // Clean up markdown if present
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Try to extract JSON array
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('   ⚠️ No JSON array found in response');
      return [];
    }
    
    const questions = JSON.parse(jsonMatch[0]);
    
    // Convert to our format
    return questions.map((q, idx) => {
      const y1 = q.estimated_y || (idx * 300 + 200);
      const y2 = y1 + 250;
      
      return {
        questionNumber: q.question_number,
        questionText: q.question_text,
        marks: q.marks || 1,
        page: pageNumber,
        bbox: {
          x1: 100,
          y1: Math.max(0, y1),
          x2: 1685,
          y2: Math.min(2525, y2)
        }
      };
    });
    
  } catch (error) {
    console.error(`   ❌ Failed to process image:`, error.message);
    return [];
  }
}

module.exports = {
  extractQuestionsFromImages
};
