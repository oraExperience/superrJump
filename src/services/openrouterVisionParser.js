
// OpenRouter Vision-Based PDF Parser
// Uses OpenRouter API - unified access to multiple vision models
// Supports: GPT-4 Vision, Claude 3 Vision, Gemini Vision, and more

const fs = require('fs');
const path = require('path');
const visionConfig = require('../config/visionConfig');

/**
 * Extract questions by sending PDF images to OpenRouter Vision
 * @param {Array} imagePages - Array of {pageNumber, imagePath}
 * @param {Object} context - Assessment context {title, subject, class}
 * @returns {Promise<Array>} - Questions with coordinates
 */
async function extractQuestionsFromImages(imagePages, context = {}) {
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
        const questions = await extractQuestionsFromImage(page.imagePath, page.pageNumber, context);
        
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
async function extractQuestionsFromAllImages(imagePages, context = {}) {
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
    
    const contextInfo = context.title || context.subject || context.class
      ? `\n\n📚 ASSESSMENT CONTEXT (Use this to identify relevant topics):\n- Assessment: ${context.title || 'N/A'}\n- Subject: ${context.subject || 'N/A'}\n- Class/Grade: ${context.class || 'N/A'}\n\nWhen identifying topics for each question, consider what would typically be taught in ${context.class || 'this grade'} for ${context.subject || 'this subject'}. Be specific and accurate based on the curriculum for this level.\n`
      : '';
    
    const prompt = `You are a PRECISE exam paper reader. I'm giving you ${imagePages.length} page(s) of an exam paper. Extract EVERY question from ALL pages.
${contextInfo}

🚨 CRITICAL: EACH QUESTION MUST BE SELF-CONTAINED 🚨

1. INCLUDE PARENT INSTRUCTION IN EVERY SUB-QUESTION:
   
   EXAMPLE FROM IMAGE:
   If you see: "Q3. Write TRUE or FALSE for the given statements.
                (i) If the Numerator is smaller than the denominator, it is a Proper Fraction."
   
   Extract as: "Write TRUE or FALSE: If the Numerator is smaller than the denominator, it is a Proper Fraction."
   
   NOT just: "If the Numerator is smaller than the denominator, it is a Proper Fraction."
   
2. MULTIPLE CHOICE - Include instruction:
   "Choose the correct option: [question text]. Options: (a) ..., (b) ..., (c) ..., (d) ..."
   
3. FILL IN THE BLANK - Include instruction:
   "Fill in the blank: [question with _____ or blank space]"
   
4. SHORT ANSWER - Include instruction if present:
   "Answer the following: [question text]"

5. READ MATHEMATICAL EXPRESSIONS CHARACTER BY CHARACTER:

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

🚨 OR QUESTIONS - CRITICAL HANDLING 🚨

When you see a question with "OR" offering two alternative options:
- BOTH options should be included in the SAME question entry
- Separate them with " OR " in the question_text
- Use the marks from ONE of the options (they're typically the same)
- The student will choose ONE option to answer

EXAMPLE FROM IMAGE:
If you see:
"8. Find ∫(e^x log a + e^a log x + e^a log a)dx [5]
     OR
     Find ∫(sec²x)/(3+tan x) dx [5]"

Extract as ONE question:
["8", "Find integral of (e to the power x times log a plus e to the power a times log x plus e to the power a times log a) dx OR Find integral of (sec squared x) divided by (3 plus tan x) dx", 5, 1, [["Integration", 100]]]

WHAT TO SKIP:
- Instructions ("Attempt any 5", "Select and write")
- Section headers ("SECTION – A", "Q. 1.")
- Page numbers
- "multiple choice type of questions" text

IMPORTANT: For each question, specify which page number it's from (1, 2, 3, etc.)

EXAMPLE CONVERSIONS:

1. TRUE/FALSE Questions:
   Image: "Q3. Write TRUE or FALSE. (i) Sum of all sides is called Area."
   Extract: "Write TRUE or FALSE: Sum of all sides is called Area."

2. Mathematical Expressions:
   Image: "If ∫₋π/₄⁴ x³·sin⁴x dx = k then k = _____."
   Extract: "Fill in the blank: If integral from negative pi divided by 4 to 4 of x cubed times sine to the power 4 of x dx equals k then k equals blank."

3. Multiple Choice:
   Image: "Choose correct answer. Q1. 2+2 = ? (a) 3 (b) 4 (c) 5"
   Extract: "Choose the correct option: 2+2 = ? Options: (a) 3, (b) 4, (c) 5"

4. OR Questions:
   Image: "8. Find ∫(e^x log a + e^a log x)dx [5] OR Find ∫(sec²x)/(3+tan x) dx [5]"
   Extract: "Find integral of (e to the power x times log a plus e to the power a times log x) dx OR Find integral of (sec squared x) divided by (3 plus tan x) dx"

Return as array of tuples (NOT objects) to save tokens:
[
  ["Q3(i)", "Write TRUE or FALSE: If the Numerator is smaller than the denominator, it is a Proper Fraction.", 1, 1, [["Fractions", 100]]],
  ["Q3(ii)", "Write TRUE or FALSE: Sum of all sides of a shape is called its Area.", 1, 1, [["Geometry", 100]]],
  ["Q6", "Write any three equivalent fractions for: (a) 2/5 (b) 3/7", 3, 1, [["Fractions", 80], ["Algebra", 20]]]
]

Format: [question_identifier, question_text, marks, page_number, topics]
- Topics format: [[topic_name, weight_percentage], [topic_name, weight_percentage]]

IMPORTANT:
- Use "question_identifier" for the original question numbering from the paper (e.g., "i", "ii", "Q3(i)", "1a", "Q1")
- topics: Array of [topic_name, weight] tuples - identify curriculum topics covered
- Return ONLY the array of tuples, no additional text or markdown`;

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
    
    // Convert tuple format [question_identifier, question_text, marks, page_number, y_start, y_end, topics] to our format
    const questions = questionsData.map(q => {
      // q is a tuple: [question_identifier, question_text, marks, page_number, y_start, y_end, topics]
      const [question_identifier, question_text, marks, page_number, y_start, y_end, topicTuples] = q;
      
      // Convert topic tuples [[name, weight], ...] to objects [{topic, weight}, ...]
      const topics = Array.isArray(topicTuples)
        ? topicTuples.map(([topic, weight]) => ({ topic, weight }))
        : [];
      
      return {
        question_identifier: question_identifier || 'unknown',
        question_text: question_text || '',
        marks: marks || undefined,
        page: page_number || 1,
        topics: topics,
        bbox: {
          x1: 100,
          y1: 100,
          x2: 1685,
          y2: 350
        }
      };
    });
    
    console.log(`   ✅ Found ${questions.length} questions across all pages`);
    
    return questions;
    
  } catch (error) {
    throw new Error(`Failed to extract from all images: ${error.message}`);
  }
}

/**
 * Extract questions from a single image using OpenRouter Vision (DEPRECATED - use extractQuestionsFromAllImages)
 */
async function extractQuestionsFromImage(imagePath, pageNumber, context = {}) {
  try {
    // Read image file as base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const contextInfo = context.title || context.subject || context.class
      ? `\n\n📚 ASSESSMENT CONTEXT (Use this to identify relevant topics):\n- Assessment: ${context.title || 'N/A'}\n- Subject: ${context.subject || 'N/A'}\n- Class/Grade: ${context.class || 'N/A'}\n\nWhen identifying topics, consider what would typically be taught in ${context.class || 'this grade'} ${context.subject || 'subject'}.\n`
      : '';
    
    const prompt = `You are a PRECISE exam paper reader. Look VERY carefully at this image and extract EVERY question with COMPLETE mathematical notation.
${contextInfo}

🚨 CRITICAL: EACH QUESTION MUST BE SELF-CONTAINED 🚨

1. INCLUDE PARENT INSTRUCTION IN EVERY SUB-QUESTION:
   
   EXAMPLE FROM IMAGE:
   If you see: "Q3. Write TRUE or FALSE for the given statements.
                (i) If the Numerator is smaller than the denominator, it is a Proper Fraction."
   
   Extract as: "Write TRUE or FALSE: If the Numerator is smaller than the denominator, it is a Proper Fraction."
   
   NOT just: "If the Numerator is smaller than the denominator, it is a Proper Fraction."
   
2. MULTIPLE CHOICE - Include instruction:
   "Choose the correct option: [question text]. Options: (a) ..., (b) ..., (c) ..., (d) ..."
   
3. FILL IN THE BLANK - Include instruction:
   "Fill in the blank: [question with _____ or blank space]"
   
4. SHORT ANSWER - Include instruction if present:
   "Answer the following: [question text]"

5. OR QUESTIONS - CRITICAL HANDLING:
   When you see "OR" between two question options:
   - Include BOTH options in the same question entry
   - Separate with " OR " in question_text
   - Use marks from one option (usually same)
   
   EXAMPLE:
   "Find ∫(e^x log a)dx [5] OR Find ∫(sec²x)/(3+tan x) dx [5]"
   Extract as: "Find integral of (e to the power x times log a) dx OR Find integral of (sec squared x) divided by (3 plus tan x) dx"

6. READ MATHEMATICAL EXPRESSIONS CHARACTER BY CHARACTER:

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

EXAMPLE CONVERSIONS:

1. TRUE/FALSE Questions:
   Image: "Q3. Write TRUE or FALSE. (i) Sum of all sides is called Area."
   Extract: "Write TRUE or FALSE: Sum of all sides is called Area."

2. Mathematical Expressions:
   Image: "If ∫₋π/₄⁴ x³·sin⁴x dx = k then k = _____."
   Extract: "Fill in the blank: If integral from negative pi divided by 4 to 4 of x cubed times sine to the power 4 of x dx equals k then k equals blank."

3. Multiple Choice:
   Image: "Choose correct answer. Q1. 2+2 = ? (a) 3 (b) 4 (c) 5"
   Extract: "Choose the correct option: 2+2 = ? Options: (a) 3, (b) 4, (c) 5"

Return as array of tuples (NOT objects) to save tokens:
[
  ["Q3(i)", "Write TRUE or FALSE: If the Numerator is smaller than the denominator, it is a Proper Fraction.", 1, [["Fractions", 80], ["Number Theory", 20]]],
  ["Q3(ii)", "Write TRUE or FALSE: Sum of all sides is called Area.", 1, [["Geometry", 100]]]
]

Format: [question_identifier, question_text, marks, topics]
- question_identifier: Original numbering from paper (e.g., "i", "ii", "Q3(i)", "1a", "Q1")
- topics: Nested tuples [[topic_name, weight_percentage], ...] - Must sum to 100

IMPORTANT: Return ONLY the array of tuples, no additional text or markdown`;

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
    
    // Convert tuple format [question_identifier, question_text, marks, topics] to our format
    return questions.map((q, idx) => {
      // q is a tuple: [question_identifier, question_text, marks, topics]
      const [question_identifier, question_text, marks, topicTuples] = q;
      
      // Convert topic tuples [[name, weight], ...] to objects [{topic, weight}, ...]
      const topics = Array.isArray(topicTuples)
        ? topicTuples.map(([topic, weight]) => ({ topic, weight }))
        : [];
      
      return {
        question_identifier: question_identifier || 'unknown',
        question_text: question_text || '',
        marks: marks || 1,
        page: pageNumber,
        topics: topics,
        bbox: {
          x1: 100,
          y1: 100,
          x2: 1685,
          y2: 350
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
