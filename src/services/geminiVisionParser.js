
// Gemini Vision-Based PDF Parser
// Uses Google's Gemini API for vision-based question extraction
// FREE TIER: 15 requests per minute, 1,500 requests per day

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

/**
 * Extract questions by sending PDF images to Gemini Vision
 * @param {Array} imagePages - Array of {pageNumber, imagePath}
 * @returns {Promise<Array>} - Questions with coordinates
 */
async function extractQuestionsFromImages(imagePages) {
  try {
    console.log('👁️ Using GEMINI VISION AI to read PDF images directly...');
    
    // Check for API key
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const allQuestions = [];
    
    // Process each page image with Gemini vision
    for (const page of imagePages) {
      console.log(`\n📄 Processing page ${page.pageNumber} with Gemini Vision...`);
      
      try {
        const questions = await extractQuestionsFromImage(genAI, page.imagePath, page.pageNumber);
        
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
    console.error('❌ Gemini Vision extraction failed:', error.message);
    throw error;
  }
}

/**
 * Extract questions from a single image using Gemini Vision
 */
async function extractQuestionsFromImage(genAI, imagePath, pageNumber) {
  try {
    // Read image file
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Get Gemini vision model - using gemini-1.5-flash (stable, fast, free tier)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `You are a PRECISE exam paper reader. Look at this image and extract EVERY SINGLE question with COMPLETE accuracy.

🚨 CRITICAL RULES - READ EVERY CHARACTER:

1. MATHEMATICAL & LOGICAL SYMBOLS - Write them EXACTLY as they appear:
   
   LOGIC SYMBOLS (be VERY precise):
   - ∨ = "or" (example: "p ∨ q" → "p or q")
   - ∧ = "and" (example: "p ∧ q" → "p and q")
   - ¬ = "not" (example: "¬p" → "not p")
   - → = "implies"
   - ↔ = "if and only if"
   
   VARIABLES: Include ALL variables exactly as shown
   - Example: "t ∨ (p ∨ q)" → "t or (p or q)"
   - DO NOT skip any part of the expression!
   
   INTEGRALS:
   - ∫₀⁴ x² dx → "integral from 0 to 4 of x squared dx"
   - ∫₋π/₄⁴ x³·sin⁴x dx → "integral from negative pi divided by 4 to 4 of x cubed times sine to the power 4 of x dx"
   - ALWAYS include the limits of integration
   
   POWERS:
   - x² → "x squared"
   - x³ → "x cubed" 
   - x⁴ → "x to the power 4"
   - sin⁴x → "sine to the power 4 of x"
   
   FRACTIONS:
   - x/y → "x divided by y"
   - -π/4 → "negative pi divided by 4"

2. MULTIPLE CHOICE - Include EVERY SINGLE OPTION:
   Format: "Question text. Options: (a) option_a, (b) option_b, (c) option_c, (d) option_d"
   
   Example: If you see:
   "(i) The dual of statement t ∨ (p ∨ q) is _____."
   With options: (a) c ∧ (p ∨ q), (b) c ∧ (p ∧ q), etc.
   
   You MUST write:
   "The dual of statement t or (p or q) is blank. Options: (a) c and (p or q), (b) c and (p and q), (c) t and (p and q), (d) t and (p or q)"

3. COMPLETENESS:
   - Include EVERY part of the question
   - Include ALL mathematical/logical expressions  
   - Include ALL variables (t, p, q, x, y, etc.)
   - Include ALL options for MCQs
   - DO NOT summarize or shorten ANYTHING

4. SKIP:
   - Instructions ("Attempt any 5", "Section A")
   - Headers ("Multiple Choice Questions")
   - Page numbers

5. Y-COORDINATE: Estimate pixel position from top (0=top, 2525=bottom of page)

Return as array of tuples (NOT objects) to save tokens:
[
  ["i", "COMPLETE question with ALL expressions and ALL options", 1, 500]
]

Format: [question_number, question_text, marks, estimated_y]

REMEMBER: Your job is to read EVERY character visible in the image. Do not skip or truncate anything!

Return ONLY the array, no markdown or extra text.`;

    // Log prompt being sent
    console.log('\n' + '='.repeat(80));
    console.log('📋 GEMINI VISION PROMPT:');
    console.log('='.repeat(80));
    console.log(prompt.substring(0, 500) + '...');
    console.log('='.repeat(80) + '\n');
    
    // Generate content with image
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image
        }
      }
    ]);
    
    const response = result.response;
    let text = response.text();
    
    // Clean up response
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Log complete response
    console.log('\n' + '='.repeat(80));
    console.log('📝 GEMINI VISION RESPONSE:');
    console.log('='.repeat(80));
    console.log(text);
    console.log('='.repeat(80) + '\n');
    
    const questions = JSON.parse(text);
    
    // Convert to our format with proper coordinates
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
      const y2 = y1 + 250; // Assume ~250px height
      
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
