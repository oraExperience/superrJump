
// Vision-Based PDF Parser - Send PDF images directly to vision AI
// No text extraction - let AI read the image directly like a human would

const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'demo-key'
});

/**
 * Extract questions by sending PDF images directly to vision AI
 * @param {Array} imagePages - Array of {pageNumber, imagePath}
 * @returns {Promise<Array>} - Questions with coordinates
 */
async function extractQuestionsFromImages(imagePages) {
  try {
    console.log('👁️ Using VISION AI to read PDF images directly...');
    
    const allQuestions = [];
    
    // Process each page image with vision AI
    for (const page of imagePages) {
      console.log(`\n📄 Processing page ${page.pageNumber}...`);
      
      // Read image as base64
      const imageBuffer = fs.readFileSync(page.imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = 'image/png';
      
      // Ask vision AI to extract questions
      const questions = await extractQuestionsFromImage(base64Image, mimeType, page.pageNumber);
      
      if (questions.length > 0) {
        allQuestions.push(...questions);
        console.log(`   ✅ Found ${questions.length} questions on page ${page.pageNumber}`);
      }
    }
    
    console.log(`\n✅ Total questions extracted: ${allQuestions.length}`);
    return allQuestions;
    
  } catch (error) {
    console.error('❌ Vision extraction failed:', error.message);
    throw error;
  }
}

/**
 * Extract questions from a single image using vision AI
 */
async function extractQuestionsFromImage(base64Image, mimeType, pageNumber) {
  try {
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
   
   Example for image showing:
   "(i) The dual of statement t ∨ (p ∨ q) is _____."
   With options: (a) c ∧ (p ∨ q), (b) c ∧ (p ∧ q), etc.
   
   You MUST write:
   "The dual of statement t or (p or q) is blank. Options: (a) c and (p or q), (b) c and (p and q), (c) t and (p and q), (d) t and (p or q)"

3. COMPLETENESS:
   - Include EVERY part of the question
   - Include ALL mathematical/logical expressions
   - Include ALL variables (t, p, q, x, etc.)
   - Include ALL options for MCQs
   - DO NOT summarize or shorten ANYTHING

4. SKIP:
   - Instructions ("Attempt any 5", "Section A")
   - Headers ("Multiple Choice Questions")
   - Page numbers

5. Y-COORDINATE: Estimate pixel position (0=top, 2525=bottom)

Return JSON array:
[
  {
    "question_number": "i",
    "question_text": "COMPLETE question with ALL expressions and ALL options",
    "marks": 1,
    "estimated_y": 500
  }
]

REMEMBER: Your job is to read EVERY character visible in the image. Do not skip or truncate anything!

Return ONLY the JSON array.`;

    // Log the exact prompt being sent
    console.log('\n' + '='.repeat(80));
    console.log('📋 VISION AI PROMPT (sent to model):');
    console.log('='.repeat(80));
    console.log(prompt);
    console.log('='.repeat(80) + '\n');
    
    // Try llama-3.2-11b-vision-preview first
    let completion;
    let modelUsed;
    try {
      console.log('   🤖 Trying llama-3.2-11b-vision-preview...');
      completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a precise exam paper reader. Read EVERY character in the image. Never truncate or skip any part of expressions. Your responses must be COMPLETE and ACCURATE."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        model: "llama-3.2-11b-vision-preview",
        temperature: 0.2,
        max_tokens: 8000,
      });
      modelUsed = "llama-3.2-11b-vision-preview";
    } catch (visionError) {
      console.log(`   ❌ 11b model failed: ${visionError.message}`);
      console.log('   🤖 Trying llama-3.2-90b-vision-preview (larger model)...');
      
      // Fallback to 90b vision model
      completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are a precise exam paper reader. Read EVERY character in the image. Never truncate or skip any part of expressions. Your responses must be COMPLETE and ACCURATE."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        model: "llama-3.2-90b-vision-preview",
        temperature: 0.2,
        max_tokens: 8000,
      });
      modelUsed = "llama-3.2-90b-vision-preview";
    }

    let response = completion.choices[0]?.message?.content || '[]';
    response = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Log complete AI response
    console.log('\n' + '='.repeat(80));
    console.log(`📝 VISION AI RESPONSE (from ${modelUsed}):`);
    console.log('='.repeat(80));
    console.log(response);
    console.log('='.repeat(80) + '\n');
    
    const questions = JSON.parse(response);
    
    // Convert to our format with proper coordinates
    return questions.map((q, idx) => {
      const y1 = q.estimated_y || (idx * 300 + 200);
      const y2 = y1 + 250; // Assume ~250px height
      
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
