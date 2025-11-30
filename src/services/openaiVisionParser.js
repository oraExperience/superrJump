
// OpenAI GPT-4 Vision-Based PDF Parser
// Uses OpenAI's GPT-4 Vision API for accurate math extraction
// Model: gpt-4o (faster and cheaper than gpt-4-vision-preview)

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { convertPdfToImages } = require('./pdfImageServiceRemote');

/**
 * Extract questions by sending PDF images to OpenAI Vision
 * @param {Array} imagePages - Array of {pageNumber, imagePath}
 * @returns {Promise<Array>} - Questions with coordinates
 */
async function extractQuestionsFromImages(imagePages) {
  try {
    console.log('🤖 Using OPENAI GPT-4 VISION to read PDF images directly...');
    
    // Check for API key
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not found in environment variables');
    }
    
    const allQuestions = [];
    
    // Process each page image with OpenAI vision
    for (const page of imagePages) {
      console.log(`\n📄 Processing page ${page.pageNumber} with OpenAI Vision...`);
      
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
    console.error('❌ OpenAI Vision extraction failed:', error.message);
    throw error;
  }
}

/**
 * Extract questions from a single image using OpenAI Vision
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
   
   Example: "The dual of statement t or (p or q) is blank. Options: (a) c and (p or q), (b) c and (p and q), (c) t and (p and q), (d) t and (p or q)"

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
    console.log('📋 OPENAI VISION PROMPT:');
    console.log('='.repeat(80));
    console.log(prompt.substring(0, 300) + '...');
    console.log('='.repeat(80) + '\n');
    
    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',  // Using gpt-4o (faster and cheaper)
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
        max_tokens: 4000,
        temperature: 0.2
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    // Log response
    console.log('\n' + '='.repeat(80));
    console.log('📝 OPENAI VISION RESPONSE:');
    console.log('='.repeat(80));
    const responseText = result.choices[0]?.message?.content || '[]';
    console.log(responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
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

/**
 * Parse PDF with vision using OpenRouter API
 * @param {Array} pdfUrls - Array of PDF URLs or local paths
 * @param {string} prompt - The extraction/grading prompt
 * @returns {Promise<string>} - AI response text
 */
async function parseWithVision(pdfUrls, prompt) {
  try {
    console.log('🤖 Using OpenRouter API for vision parsing...');
    console.log('='.repeat(80));
    console.log('📝 PROMPT BEING SENT TO AI:');
    console.log('='.repeat(80));
    console.log(prompt);
    console.log('='.repeat(80));
    console.log(`📊 Prompt length: ${prompt.length} characters`);
    console.log('='.repeat(80));
    
    // Check for API key
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY or OPENAI_API_KEY not found in environment variables');
    }
    
    // Determine which API to use
    const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
    const apiUrl = useOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    
    const model = useOpenRouter
      ? 'anthropic/claude-3.5-sonnet' // OpenRouter model
      : 'gpt-4o'; // OpenAI model
    
    console.log(`📡 Using ${useOpenRouter ? 'OpenRouter' : 'OpenAI'} with model: ${model}`);
    
    // For local PDFs, we need to convert to base64
    const pdfUrl = pdfUrls[0];
    let imageContent;
    
    if (pdfUrl.startsWith('http')) {
      // Remote URL - check if it's a PDF
      if (pdfUrl.toLowerCase().endsWith('.pdf')) {
        console.log(`🌐 Remote PDF detected: ${pdfUrl}`);
        console.log(`🔄 Downloading and converting PDF to images...`);
        
        // Download PDF to temp location
        const os = require('os');
        
        const tempDir = os.tmpdir();
        const tempPdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
        
        try {
          const response = await fetch(pdfUrl);
          if (!response.ok) {
            throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
          }
          
          const buffer = await response.buffer();
          fs.writeFileSync(tempPdfPath, buffer);
          console.log(`✅ Downloaded PDF to: ${tempPdfPath}`);
          
          // Convert to images
          const imagePages = await convertPdfToImages(tempPdfPath);
          
          if (imagePages.length === 0) {
            throw new Error('Failed to convert remote PDF to images');
          }
          
          console.log(`✅ Converted ${imagePages.length} page(s) to images`);
          
          // Convert all pages to base64
          const imageContents = imagePages.map((page) => {
            console.log(`   📄 Including page ${page.pageNumber}: ${page.imagePath}`);
            const imageBuffer = fs.readFileSync(page.imagePath);
            const base64Image = imageBuffer.toString('base64');
            return {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Image}` }
            };
          });
          
          imageContent = imageContents;
          
          // Clean up temp PDF
          fs.unlinkSync(tempPdfPath);
          console.log(`🗑️  Cleaned up temp PDF`);
          
        } catch (downloadError) {
          console.error('❌ Failed to process remote PDF:', downloadError);
          throw downloadError;
        }
      } else {
        // Remote image URL - use directly
        imageContent = {
          type: 'image_url',
          image_url: { url: pdfUrl }
        };
      }
    } else {
      // Local file - resolve to absolute path
      const fs = require('fs');
      const path = require('path');
      
      let absolutePath;
      if (pdfUrl.startsWith('/uploads/') || pdfUrl.startsWith('uploads/')) {
        absolutePath = path.join(process.cwd(), pdfUrl.startsWith('/') ? pdfUrl.substring(1) : pdfUrl);
      } else if (path.isAbsolute(pdfUrl)) {
        absolutePath = pdfUrl;
      } else {
        absolutePath = path.join(process.cwd(), pdfUrl);
      }
      
      console.log(`📂 Reading file from: ${absolutePath}`);
      
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${absolutePath}. Please check if the file was uploaded correctly.`);
      }
      
      // Check if it's a PDF - if so, convert to image first (Claude can't process PDFs directly)
      if (absolutePath.toLowerCase().endsWith('.pdf')) {
        console.log(`🔄 Converting PDF to images (Claude can't process PDFs directly)...`);
        const imagePages = await convertPdfToImages(absolutePath);
        
        if (imagePages.length === 0) {
          throw new Error('Failed to convert PDF to images');
        }
        
        console.log(`✅ Converted ${imagePages.length} page(s) to images`);
        
        // Convert all pages to base64 and create an array of image content
        const imageContents = imagePages.map((page, index) => {
          console.log(`   📄 Including page ${page.pageNumber}: ${page.imagePath}`);
          const imageBuffer = fs.readFileSync(page.imagePath);
          const base64Image = imageBuffer.toString('base64');
          return {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${base64Image}` }
          };
        });
        
        // Store as array to be added to content later
        imageContent = imageContents;
      } else {
        // Regular image file - use directly
        const fileBuffer = fs.readFileSync(absolutePath);
        const base64File = fileBuffer.toString('base64');
        const mimeType = absolutePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        imageContent = {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64File}` }
        };
      }
    }
    
    // Call API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(useOpenRouter && {
          'HTTP-Referer': 'https://superrjump.com',
          'X-Title': 'SuperrJump Grading System'
        })
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              // Spread imageContent if it's an array (multiple pages), otherwise add it directly
              ...(Array.isArray(imageContent) ? imageContent : [imageContent])
            ]
          }
        ],
        max_tokens: 750,
        temperature: 0.2
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    const responseText = result.choices[0]?.message?.content || '';
    
    // Log comprehensive response details
    console.log('='.repeat(80));
    console.log('🤖 AI RESPONSE RECEIVED');
    console.log('='.repeat(80));
    console.log(`📊 Response length: ${responseText.length} characters`);
    console.log(`🎯 Finish reason: ${result.choices[0]?.finish_reason || 'unknown'}`);
    console.log(`📈 Tokens used: prompt=${result.usage?.prompt_tokens || 'N/A'}, completion=${result.usage?.completion_tokens || 'N/A'}, total=${result.usage?.total_tokens || 'N/A'}`);
    
    // Always print the full response for debugging
    console.log('='.repeat(80));
    console.log('📝 FULL AI RESPONSE:');
    console.log('='.repeat(80));
    console.log(responseText);
    console.log('='.repeat(80));
    
    // Warn if response was truncated
    if (result.choices[0]?.finish_reason === 'length') {
      console.log('⚠️  WARNING: Response was truncated due to max_tokens limit!');
      console.log('⚠️  Consider increasing max_tokens for complete responses.');
      console.log('='.repeat(80));
    }
    
    return responseText;
    
  } catch (error) {
    console.error('❌ Vision parsing failed:', error.message);
    throw error;
  }
}

module.exports = {
  extractQuestionsFromImages,
  parseWithVision
};
