
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
    
    // Process each page image separately (REVERTED: batching increased costs!)
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
    
    const prompt = `Extract ALL questions from ${imagePages.length} exam page(s).${contextInfo}

RULES:
1. Self-contained: Include parent instruction in sub-questions
   Ex: "Q3. Write TRUE/FALSE. (i) Sum of sides is Area"
   → "Write TRUE or FALSE: Sum of sides is Area"

2. MCQ questions: ALWAYS include ALL options in question_text
   Ex: "The integrating factor is ___. (a) x (b) 1/x (c) x² (d) 1/x²"
   → "The integrating factor of linear differential equation x(dy/dx) + 2y = x²log x is ___. Options: (a) x (b) 1/x (c) x² (d) 1/x²"

3. Math symbols and matrices: Write exactly as shown
   ∫ = "integral", ∑ = "sum", √ = "square root"
   x² = "x squared", sin⁴x = "sine to power 4 of x"
   
   Matrices: Use bracket notation [row1; row2; ...]
   Ex: "Check whether the matrix [cosθ sinθ; -sinθ cosθ] is invertible"
   Ex: "Find determinant of matrix [1 2 3; 4 5 6; 7 8 9]"

4. OR questions: Combine both options
   "Q8. Find ∫e^x dx [5] OR Find ∫sec²x dx [5]"
   → "Find integral e^x dx OR Find integral sec²x dx"

5. Visual/Diagram questions: Include answer with brief reason
   Ex: "Read the abacus [diagram shown]"
   → "Read the abacus and write the number. Answer: 7295 (Th=7, H=2, T=9, O=5)"
   
   Ex: "Count shapes [diagram shown]"
   → "Count the shapes. Answer: 8 triangles (4 small + 4 large)"

6. Skip: Instructions, headers, page numbers

Symbol guide: ∫="integral", x²="x squared", π="pi", √="root", ∨="or", →="implies"

Return as array of tuples (NOT objects) to save tokens:
[
  ["F1", "Read the abacus and write the number. Answer: 7295 (Th=7, H=2, T=9, O=5)", 2, 1, [["Number System", 100]]],
  ["Q.3(i)", "Write TRUE or FALSE: If the Numerator is smaller than the denominator, it is a Proper Fraction.", 1, 1, [["Fractions", 100]]],
  ["Q.4", "Check whether the matrix [cosθ sinθ; -sinθ cosθ] is invertible or not.", 3, 1, [["Matrices", 100]]],
  ["Q.6", "Write any three equivalent fractions for: (a) 2/5 (b) 3/7", 3, 1, [["Fractions", 80], ["Algebra", 20]]]
]

Format: [question_identifier, question_text, marks, page_number, topics]
- Topics format: [[topic_name, weight_percentage], [topic_name, weight_percentage]]

CRITICAL FOR question_identifier:
- question_identifier = ONLY the question NUMBER/LABEL from the paper (e.g., "Q.4", "i", "ii", "Q3(i)", "1a", "Q.1")
- DO NOT include the question text in the identifier
- Examples: "Q.4", "Q.10", "i", "ii", "a", "b", "Q1(a)", "Q3.ii"

IMPORTANT:
- topics: Array of [topic_name, weight] tuples - identify curriculum topics covered
- For visual/diagram questions, ALWAYS add "Answer: [value] (brief reason)" to question_text
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
    
    // Call OpenRouter API with batched images (caching disabled - breaks JSON parsing)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://superrjump.com',
        'X-Title': 'SuperRJump Question Extractor'
      },
      body: JSON.stringify({
        model: visionConfig.models.openrouter.model,
        messages: [
          {
            role: 'user',
            content: contentArray
          }
        ],
        max_tokens: visionConfig.models.openrouter.maxTokens,
        temperature: 0.2
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    // Log FULL response for debugging
    console.log('\n' + '='.repeat(80));
    console.log('📊 OPENROUTER API RESPONSE - FULL DETAILS');
    console.log('='.repeat(80));
    console.log('🤖 Model Used:', visionConfig.models.openrouter.model);
    console.log('📝 Response ID:', result.id);
    console.log('🏢 Provider:', result.provider);
    console.log('⏱️  Created:', new Date(result.created * 1000).toISOString());
    
    // Usage & Cost Information
    if (result.usage) {
      console.log('\n💰 TOKEN USAGE & COST:');
      console.log('   📥 Prompt Tokens:', result.usage.prompt_tokens || 0);
      console.log('   📤 Completion Tokens:', result.usage.completion_tokens || 0);
      console.log('   📊 Total Tokens:', result.usage.total_tokens || 0);
      
      if (result.usage.prompt_cost !== undefined) {
        console.log('   💵 Prompt Cost: $' + (result.usage.prompt_cost || 0).toFixed(6));
      }
      if (result.usage.completion_cost !== undefined) {
        console.log('   💵 Completion Cost: $' + (result.usage.completion_cost || 0).toFixed(6));
      }
      if (result.usage.total_cost !== undefined) {
        console.log('   💰 Total Cost: $' + (result.usage.total_cost || 0).toFixed(6));
      }
    }
    
    // Model-specific metadata
    if (result.model) {
      console.log('\n🎯 MODEL INFO:');
      console.log('   Model:', result.model);
    }
    
    // System fingerprint
    if (result.system_fingerprint) {
      console.log('   System Fingerprint:', result.system_fingerprint);
    }
    
    console.log('\n📋 FULL RAW RESPONSE:');
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(80) + '\n');
    
    // Log message content
    console.log('\n' + '='.repeat(80));
    console.log('📝 EXTRACTED MESSAGE CONTENT:');
    console.log('='.repeat(80));
    const responseText = result.choices[0]?.message?.content || '[]';
    console.log(responseText);  // Print full response
    console.log('\n📏 CONTENT METRICS:');
    console.log('   Type:', typeof responseText);
    console.log('   Length:', responseText.length, 'characters');
    console.log('   Lines:', responseText.split('\n').length);
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
    
    const prompt = `Extract ALL questions from this exam page.${contextInfo}

RULES:
1. Self-contained: Include parent instruction in sub-questions
   Ex: "Q3. Write TRUE/FALSE. (i) Sum of sides is Area"
   → "Write TRUE or FALSE: Sum of sides is Area"

2. Math symbols: Write exactly as shown
   ∫ = "integral", ∑ = "sum", √ = "square root"
   x² = "x squared", sin⁴x = "sine to power 4 of x"

3. OR questions: Combine both options
   "Q8. Find ∫e^x dx [5] OR Find ∫sec²x dx [5]"
   → "Find integral e^x dx OR Find integral sec²x dx"

4. Visual/Diagram questions: Include answer with brief reason
   Ex: "Read the abacus [diagram shown]"
   → "Read the abacus and write the number. Answer: 7295 (Th=7, H=2, T=9, O=5)"

5. Skip: Instructions, headers, page numbers

Symbol guide: ∫="integral", x²="x squared", π="pi", √="root", ∨="or", →="implies"

Return as array of tuples (NOT objects) to save tokens:
[
  ["F1", "Read the abacus and write the number. Answer: 7295 (Th=7, H=2, T=9, O=5)", 2, [["Number System", 100]]],
  ["Q3(i)", "Write TRUE or FALSE: If the Numerator is smaller than the denominator, it is a Proper Fraction.", 1, [["Fractions", 100]]],
  ["Q6", "Write any three equivalent fractions for: (a) 2/5 (b) 3/7", 3, [["Fractions", 80], ["Algebra", 20]]]
]

Format: [question_identifier, question_text, marks, topics]
- Topics format: [[topic_name, weight_percentage], [topic_name, weight_percentage]]

IMPORTANT:
- Use "question_identifier" for the original question numbering from the paper (e.g., "i", "ii", "Q3(i)", "1a", "Q1")
- topics: Array of [topic_name, weight] tuples - identify curriculum topics covered
- For visual/diagram questions, ALWAYS add "Answer: [value] (brief reason)" to question_text
- Return ONLY the array of tuples, no additional text or markdown`;

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
    
    // Log FULL response with all metadata
    console.log('\n' + '='.repeat(80));
    console.log('📊 OPENROUTER API RESPONSE - PAGE ' + pageNumber);
    console.log('='.repeat(80));
    console.log('🤖 Model Used:', visionConfig.models.openrouter.model);
    console.log('📝 Response ID:', result.id);
    console.log('🏢 Provider:', result.provider);
    console.log('⏱️  Created:', new Date(result.created * 1000).toISOString());
    
    // Usage & Cost Information
    if (result.usage) {
      console.log('\n💰 TOKEN USAGE & COST (Page ' + pageNumber + '):');
      console.log('   📥 Prompt Tokens:', result.usage.prompt_tokens || 0);
      console.log('   📤 Completion Tokens:', result.usage.completion_tokens || 0);
      console.log('   📊 Total Tokens:', result.usage.total_tokens || 0);
      
      if (result.usage.prompt_cost !== undefined) {
        console.log('   💵 Prompt Cost: $' + (result.usage.prompt_cost || 0).toFixed(6));
      }
      if (result.usage.completion_cost !== undefined) {
        console.log('   💵 Completion Cost: $' + (result.usage.completion_cost || 0).toFixed(6));
      }
      if (result.usage.total_cost !== undefined) {
        console.log('   💰 Total Cost: $' + (result.usage.total_cost || 0).toFixed(6));
      }
    }
    
    // Model info
    if (result.model) {
      console.log('\n🎯 ACTUAL MODEL USED:');
      console.log('   ', result.model);
    }
    
    console.log('\n📋 FULL RAW RESPONSE:');
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(80) + '\n');
    
    // Log message content
    console.log('\n' + '='.repeat(80));
    console.log('📝 EXTRACTED MESSAGE CONTENT (Page ' + pageNumber + '):');
    console.log('='.repeat(80));
    const responseText = result.choices[0]?.message?.content || '[]';
    console.log(responseText);  // Print full response
    console.log('\n📏 CONTENT METRICS:');
    console.log('   Type:', typeof responseText);
    console.log('   Length:', responseText.length, 'characters');
    console.log('   Is Empty Array:', responseText.trim() === '[]');
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
