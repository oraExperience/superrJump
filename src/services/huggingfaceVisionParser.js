
// Hugging Face Vision-Based PDF Parser
// Uses Hugging Face Inference API - 100% FREE
// Model: Qwen/Qwen2-VL-7B-Instruct (excellent for math)

const fs = require('fs');
const path = require('path');

/**
 * Extract questions by sending PDF images to Hugging Face Vision
 * @param {Array} imagePages - Array of {pageNumber, imagePath}
 * @returns {Promise<Array>} - Questions with coordinates
 */
async function extractQuestionsFromImages(imagePages) {
  try {
    console.log('🤗 Using HUGGING FACE VISION AI to read PDF images directly...');
    
    // Check for API key
    if (!process.env.HUGGINGFACE_API_KEY) {
      throw new Error('HUGGINGFACE_API_KEY not found in environment variables');
    }
    
    const allQuestions = [];
    
    // Process each page image with Hugging Face vision
    for (const page of imagePages) {
      console.log(`\n📄 Processing page ${page.pageNumber} with Hugging Face Vision...`);
      
      try {
        const questions = await extractQuestionsFromImage(page.imagePath, page.pageNumber);
        
        if (questions.length > 0) {
          allQuestions.push(...questions);
          console.log(`   ✅ Found ${questions.length} questions on page ${page.pageNumber}`);
        }
      } catch (pageError) {
        console.error(`   ❌ Failed to process page ${page.pageNumber}:`, pageError.message);
      }
    }
    
    console.log(`\n✅ Total questions extracted: ${allQuestions.length}`);
    return allQuestions;
    
  } catch (error) {
    console.error('❌ Hugging Face Vision extraction failed:', error.message);
    throw error;
  }
}

/**
 * Extract questions from a single image using Hugging Face Vision
 */
async function extractQuestionsFromImage(imagePath, pageNumber) {
  try {
    // Read image file as base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    const prompt = `You are a PRECISE exam paper reader. Extract EVERY question from this exam paper image.

CRITICAL RULES:

1. MATHEMATICAL SYMBOLS - Convert to plain English:
   - ∫ = "integral"
   - ∫₀⁴ = "integral from 0 to 4"
   - ∫₋π/₄⁴ = "integral from negative pi divided by 4 to 4"
   - x² = "x squared", x³ = "x cubed", x⁴ = "x to the power 4"
   - sin⁴x = "sine to the power 4 of x"
   - ∨ = "or", ∧ = "and", ¬ = "not"
   - Include ALL variables: t, p, q, x, y, etc.

2. MULTIPLE CHOICE - Include ALL options:
   Format: "Question. Options: (a) opt1, (b) opt2, (c) opt3, (d) opt4"

3. COMPLETENESS:
   - Include EVERY part of expressions
   - Include ALL integral limits
   - Include ALL MCQ options
   - DO NOT truncate or skip anything

4. SKIP:
   - Instructions ("Attempt any 5")
   - Headers ("Section A")
   - Page numbers

Return as array of tuples (NOT objects) to save tokens:
[
  ["i", "Complete question with all expressions in plain English", 1, 500]
]

Format: [question_number, question_text, marks, estimated_y]

Return ONLY the array, no markdown or extra text.`;

    // Log prompt
    console.log('\n' + '='.repeat(80));
    console.log('📋 HUGGING FACE PROMPT:');
    console.log('='.repeat(80));
    console.log(prompt.substring(0, 300) + '...');
    console.log('='.repeat(80) + '\n');
    
    // Call Hugging Face Inference API (new endpoint)
    const API_URL = 'https://router.huggingface.co/hf-inference/models/Qwen/Qwen2-VL-7B-Instruct';
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: {
          question: prompt,
          image: base64Image
        },
        parameters: {
          max_new_tokens: 2000,
          temperature: 0.2
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hugging Face API error: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    // Log response
    console.log('\n' + '='.repeat(80));
    console.log('📝 HUGGING FACE RESPONSE:');
    console.log('='.repeat(80));
    console.log(JSON.stringify(result).substring(0, 500) + '...');
    console.log('='.repeat(80) + '\n');
    
    // Parse response (Qwen2-VL returns text)
    let text = '';
    if (typeof result === 'string') {
      text = result;
    } else if (result.generated_text) {
      text = result.generated_text;
    } else if (Array.isArray(result) && result[0]?.generated_text) {
      text = result[0].generated_text;
    }
    
    // Clean up and parse JSON
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
      // Handle both tuple and object formats
      let questionNumber, questionText, marks, estimatedY;
      
      if (Array.isArray(q)) {
        // Tuple format: [question_number, question_text, marks, estimated_y]
        [questionNumber, questionText, marks, estimatedY] = q;
      } else {
        // Legacy object format
        questionNumber = q.question_number;
        questionText = q.question_text;
        marks = q.marks;
        estimatedY = q.estimated_y;
      }
      
      const y1 = estimatedY || (idx * 300 + 200);
      const y2 = y1 + 250;
      
      return {
        question_identifier: questionNumber,
        question_text: questionText,
        marks: marks || 1,
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
