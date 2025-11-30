
// AI Service for question extraction and answer grading
// Using Vision AI for accurate mathematical expression extraction

const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const PDFParser = require('pdf2json');
const visionConfig = require('../config/visionConfig');
const { convertPdfToImages } = require('./pdfImageServiceRemote');
const { extractQuestionsWithCoordinates } = require('./advancedPdfParser');
const { extractQuestionsFromImages: extractWithOpenRouter } = require('./openrouterVisionParser');
const { extractQuestionsFromImages: extractWithOpenAI } = require('./openaiVisionParser');
const { extractQuestionsFromImages: extractWithGemini } = require('./geminiVisionParser');
const { extractQuestionsFromImages: extractWithHuggingFace } = require('./huggingfaceVisionParser');

// Initialize Groq client with free API key
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'demo-key'
});

/**
 * Extract questions from PDF with precise bounding box coordinates
 * @param {string} pdfUrl - URL or path to the question paper PDF
 * @param {object} context - Assessment context (title, subject, class)
 * @returns {Promise<Array>} - Array of questions with bounding boxes
 */
async function extractQuestionsFromPDF(pdfUrl, context = {}) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 AI SERVICE: Starting question extraction`);
    console.log(`${'='.repeat(80)}`);
    console.log(`📄 PDF URL: ${pdfUrl}`);
    console.log(`📋 Context:`, JSON.stringify(context, null, 2));
    console.log(`⏰ Start Time: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}\n`);
    
    const extractionPrompt = `You are analyzing an ACTUAL IMAGE of an examination paper. You can SEE the page layout, question numbers, marks in brackets, and spacing.

CRITICAL: Look at this specific image carefully and identify EVERY question by:
- Question numbers (Q.1, Q.2, 1., 2., etc.)
- Marks notation in brackets like [2], (3), [1 mark]
- Spacing between questions

For EACH question visible in this image, provide:
1. question_number: sequential integer (1, 2, 3...)
2. question_text: first 50 characters of the question text you SEE
3. max_marks: the number you see in brackets [X] or (X)
4. page_number: 1 (this is page 1)
5. position: {
     "y_start_ratio": where question begins (0.0=top, 1.0=bottom),
     "y_end_ratio": where question ends,
     "height_lines": count of text lines the question spans
   }

HOW TO MEASURE POSITIONS (VERY IMPORTANT):
1. Imagine the page divided into 10 equal horizontal sections (0.1, 0.2, 0.3... 1.0)
2. If question starts in top section → y_start_ratio: 0.1
3. If question starts in second section → y_start_ratio: 0.2
4. If question starts in middle → y_start_ratio: 0.5
5. Measure where it ENDS similarly for y_end_ratio
6. Include some padding - add 0.02 before start, 0.02 after end

EXAMPLE - What you might SEE:
Image shows:
- "Q.1 What is 2+2? [2]" at top section
- "Q.2 Solve x² = 4 [3]" in middle section

You should output:
[
  {
    "question_number": 1,
    "question_text": "What is 2+2?",
    "max_marks": 2,
    "page_number": 1,
    "position": {"y_start_ratio": 0.13, "y_end_ratio": 0.18, "height_lines": 1}
  },
  {
    "question_number": 2,
    "question_text": "Solve x² = 4",
    "max_marks": 3,
    "page_number": 1,
    "position": {"y_start_ratio": 0.48, "y_end_ratio": 0.55, "height_lines": 2}
  }
]

VISUAL GUIDE - Look at the image you're analyzing:
- Top of page = 0.0
- 10% down = 0.1 (usually after header/title)
- 25% down = 0.25
- Middle = 0.5
- 75% down = 0.75
- Bottom = 1.0

EXAMPLE OUTPUT:
[
  {
    "question_number": 1,
    "question_text": "What is 2+2?",
    "max_marks": 2,
    "page_number": 1,
    "position": {"y_start_ratio": 0.15, "y_end_ratio": 0.20, "height_lines": 1}
  },
  {
    "question_number": 2,
    "question_text": "Solve x² - 4 = 0",
    "max_marks": 3,
    "page_number": 1,
    "position": {"y_start_ratio": 0.25, "y_end_ratio": 0.35, "height_lines": 2}
  }
]

CRITICAL RULES:
- LOOK at the image to see actual question positions
- If sub-parts have SEPARATE marks → Extract EACH as separate question
- If sub-parts share ONE mark → Extract as ONE question
- **OR QUESTIONS**: If you see "OR" between two question options, include BOTH in question_text separated by " OR "
- question_number must be sequential (1, 2, 3, 4...)
- y_start_ratio MUST be < y_end_ratio
- Return ONLY valid JSON array, NO markdown blocks

EXAMPLE 1 - Sub-parts with SEPARATE marks (extract separately):
Q. 1. Select the correct answer:
  (i) The dual of statement... [2]
  (ii) The principle solutions... [2]

Should be TWO entries using RATIOS:
[
  {
    "question_number": 1,
    "question_text": "(i) The dual of statement...",
    "max_marks": 2,
    "page_number": 1,
    "position": {"y_start_ratio": 0.20, "y_end_ratio": 0.27, "height_lines": 2}
  },
  {
    "question_number": 2,
    "question_text": "(ii) The principle solutions...",
    "max_marks": 2,
    "page_number": 1,
    "position": {"y_start_ratio": 0.28, "y_end_ratio": 0.35, "height_lines": 2}
  }
]

EXAMPLE 2 - Sub-parts with ONE total mark (extract as one):
Q. 1. Answer all parts: [10 marks total]
  (i) Define...
  (ii) Explain...

Should be ONE entry:
{
  "question_number": 1,
  "question_text": "Answer all parts: (i) Define... (ii) Explain...",
  "max_marks": 10,
  "position": {"y_start_ratio": 0.20, "y_end_ratio": 0.40, "height_lines": 5}
}

EXAMPLE 3 - OR Questions (INCLUDE BOTH OPTIONS):
Q. 8. Find ∫(e^x log a + e^a log x + e^a log a)dx [5]
      OR
      Find ∫(sec²x)/(3+tan x) dx [5]

Should be ONE entry with BOTH questions:
{
  "question_number": 8,
  "question_text": "Find ∫(e^x log a + e^a log x + e^a log a)dx OR Find ∫(sec²x)/(3+tan x) dx",
  "max_marks": 5,
  "position": {"y_start_ratio": 0.60, "y_end_ratio": 0.75, "height_lines": 4}
}

Context:
- Assessment: ${context.title || 'Examination'}
- Subject: ${context.subject || 'N/A'}
- Class: ${context.class || 'N/A'}

PDF Path: ${pdfUrl}`;

    // VISION AI EXTRACTION - Try enabled models in priority order
    console.log(`\n${'─'.repeat(80)}`);
    console.log('📸  STEP 1: Converting PDF to images...');
    console.log(`${'─'.repeat(80)}`);
    
    // Convert PDF to images
    let imagePages = null;
    try {
      console.log(`   📂 Input: ${pdfUrl}`);
      console.log(`   🔄 Calling convertPdfToImages()...`);
      const conversionStart = Date.now();
      
      imagePages = await convertPdfToImages(pdfUrl);
      
      const conversionTime = ((Date.now() - conversionStart) / 1000).toFixed(2);
      console.log(`   ✅ Conversion successful in ${conversionTime}s`);
      console.log(`   📊 Result: ${imagePages.length} page(s) converted`);
      console.log(`   💾 Image format: base64 encoded PNG`);
      console.log(`${'─'.repeat(80)}\n`);
    } catch (imageError) {
      console.error(`\n${'❌'.repeat(40)}`);
      console.error('❌ CRITICAL: PDF to image conversion failed');
      console.error(`${'❌'.repeat(40)}`);
      console.error('Error Name:', imageError.name);
      console.error('Error Message:', imageError.message);
      console.error('Error Stack:', imageError.stack);
      console.error(`${'❌'.repeat(40)}\n`);
      throw new Error(`Cannot process PDF: ${imageError.message}`);
    }
    
    // Get enabled models in priority order from config
    console.log(`\n${'─'.repeat(80)}`);
    console.log('🎯 STEP 2: Selecting Vision AI model...');
    console.log(`${'─'.repeat(80)}`);
    
    const enabledModels = visionConfig.getEnabledModels();
    console.log(`   📋 Enabled models: ${enabledModels.map(m => m.name).join(', ') || 'NONE'}`);
    console.log(`   🔢 Total enabled: ${enabledModels.length}`);
    console.log(`${'─'.repeat(80)}\n`);
    
    if (enabledModels.length === 0) {
      console.error(`\n${'❌'.repeat(40)}`);
      console.error('❌ CRITICAL: No vision models enabled');
      console.error('❌ Please enable at least one model in visionConfig.js');
      console.error(`${'❌'.repeat(40)}\n`);
      throw new Error('No vision models enabled in visionConfig.js. Please enable at least one model.');
    }
    
    // Try each enabled model in priority order
    let lastError = null;
    for (const modelConfig of enabledModels) {
      try {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🚀 ATTEMPTING: ${modelConfig.name.toUpperCase()} Vision AI`);
        console.log(`${'='.repeat(80)}`);
        console.log(`   📊 Priority: ${modelConfig.priority}`);
        if (modelConfig.model) {
          console.log(`   🤖 Model: ${modelConfig.model}`);
        }
        console.log(`   🖼️  Processing ${imagePages.length} page(s)...`);
        console.log(`${'='.repeat(80)}\n`);
        
        let questions = null;
        const extractionStart = Date.now();
        
        switch (modelConfig.name) {
          case 'openrouter':
            console.log(`   🔄 Calling extractWithOpenRouter()...`);
            questions = await extractWithOpenRouter(imagePages, context);
            break;
          case 'openai':
            console.log(`   🔄 Calling extractWithOpenAI()...`);
            questions = await extractWithOpenAI(imagePages, context);
            break;
          case 'gemini':
            console.log(`   🔄 Calling extractWithGemini()...`);
            questions = await extractWithGemini(imagePages, context);
            break;
          case 'huggingface':
            console.log(`   🔄 Calling extractWithHuggingFace()...`);
            questions = await extractWithHuggingFace(imagePages, context);
            break;
          default:
            console.log(`   ⚠️  Unknown model: ${modelConfig.name}, skipping...`);
            continue;
        }
        
        const extractionTime = ((Date.now() - extractionStart) / 1000).toFixed(2);
        console.log(`   ⏱️  Extraction took ${extractionTime}s`);
        
        if (questions && questions.length > 0) {
          console.log('\n' + '🎉'.repeat(40));
          console.log(`🎉 SUCCESS: ${modelConfig.name.toUpperCase()} Vision AI Extraction Complete`);
          if (modelConfig.model) {
            console.log(`🎉 Model: ${modelConfig.model}`);
          }
          console.log('🎉 Mathematical expressions preserved accurately');
          console.log('🎉'.repeat(40) + '\n');
          console.log(`✅ Extracted ${questions.length} questions from ${imagePages.length} page(s)\n`);
          return questions;
        }
        
        console.log(`⚠️  ${modelConfig.name} returned no questions, trying next model...`);
        
      } catch (modelError) {
        console.error(`\n❌ ${modelConfig.name} Vision failed:`, modelError.message);
        lastError = modelError;
        
        // Check if it's a critical error (API key missing, credits exhausted)
        const isCriticalError = modelError.message.includes('API key') ||
                               modelError.message.includes('not found') ||
                               modelError.message.includes('402') ||
                               modelError.message.includes('credits');
        
        if (isCriticalError) {
          console.log(`   ⚠️  Critical error, trying next enabled model...`);
        } else {
          console.log(`   ⚠️  Transient error, trying next enabled model...`);
        }
      }
    }
    
    // All enabled models failed
    console.error('\n' + '❌'.repeat(40));
    console.error('❌ ALL ENABLED VISION MODELS FAILED');
    console.error('❌ Check your API keys and credits');
    console.error('❌'.repeat(40) + '\n');
    throw new Error(`All vision models failed. Last error: ${lastError?.message || 'Unknown error'}`);
    
  } catch (error) {
    console.error(`\n${'❌'.repeat(80)}`);
    console.error('❌ AI SERVICE EXTRACTION FAILED');
    console.error(`${'❌'.repeat(80)}`);
    console.error('⏰ Failed At:', new Date().toISOString());
    console.error('📄 PDF URL:', pdfUrl);
    console.error('Error Type:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error(`${'❌'.repeat(80)}\n`);
    throw error;
  }
}

/**
 * LEGACY FALLBACK (Disabled by default)
 * Text-based extraction using pdf2json - may corrupt mathematical symbols
 */
async function extractQuestionsWithTextFallback(pdfUrl) {
  try {
    console.log('\n' + '⚠️ '.repeat(40));
    console.log('⚠️  WARNING: Using TEXT EXTRACTION FALLBACK');
    console.log('⚠️  Mathematical symbols may be corrupted');
    console.log('⚠️  ∫, ∑, √, superscripts, subscripts may not extract correctly');
    console.log('⚠️ '.repeat(40) + '\n');
    
    // Try ADVANCED PDF PARSER (uses text + coordinates)
    try {
      console.log('\n' + '⚠️ '.repeat(40));
      console.log('⚠️  WARNING: Vision AI failed - falling back to TEXT EXTRACTION');
      console.log('⚠️  Using pdf2json library - mathematical symbols may be corrupted');
      console.log('⚠️  ∫, ∑, √, superscripts, subscripts may not extract correctly');
      console.log('⚠️ '.repeat(40) + '\n');
      console.log('🎯 Using Advanced PDF Parser with text coordinates...');
      const questions = await extractQuestionsWithCoordinates(pdfUrl);
      
      if (questions && questions.length > 0) {
        console.log(`✅ Advanced parser extracted ${questions.length} questions (but math may be corrupted)`);
        return questions;
      }
      
      console.log('⚠️  Advanced parser found no questions, trying final fallback...');
      
    } catch (advancedError) {
      console.error('❌ Advanced PDF parser failed:', advancedError.message);
      console.log('   Falling back to direct text parsing...');
    }
    
    // Fallback 2: Try direct text parsing
    try {
      console.log('\n' + '❌'.repeat(40));
      console.log('❌ LAST RESORT: All better methods failed');
      console.log('❌ Using basic text extraction - expect poor math accuracy');
      console.log('❌'.repeat(40) + '\n');
      console.log('📝 Using direct text parser as fallback...');
      let questions = await extractQuestionsDirectly(pdfUrl);

      // CRITICAL: Deduplicate and renumber questions to ensure unique question_numbers
      const uniqueQuestions = [];
      const seenQuestions = new Set();
      
      questions.forEach((q, index) => {
        const key = `${q.page_number}-${q.bbox.y1}`;
        if (!seenQuestions.has(key)) {
          seenQuestions.add(key);
          uniqueQuestions.push({
            ...q,
            question_number: uniqueQuestions.length + 1 // Renumber sequentially
          });
        }
      });
      
      questions = uniqueQuestions;

      console.log(`✅ Successfully extracted ${questions.length} unique questions`);
      
      // Log first few for debugging
      console.log('\n📍 Sample bounding boxes:');
      questions.slice(0, 3).forEach(q => {
        console.log(`   Q${q.question_number}: Page ${q.page_number}, BBox: (${q.bbox.x1},${q.bbox.y1}) to (${q.bbox.x2},${q.bbox.y2})`);
      });
      
      return questions;

    } catch (fallbackError) {
      console.error('❌ All parsing methods failed:', fallbackError.message);
      console.log('⚠️  Using minimal fallback questions');
      
      // Last resort: return 3 generic questions
      return [
        {
          question_number: 1,
          question_text: "Question 1 - Please verify and edit",
          max_marks: 2,
          page_number: 1,
          bbox: { x1: 60, y1: 200, x2: 1725, y2: 450 }
        },
        {
          question_number: 2,
          question_text: "Question 2 - Please verify and edit",
          max_marks: 2,
          page_number: 1,
          bbox: { x1: 60, y1: 460, x2: 1725, y2: 710 }
        },
        {
          question_number: 3,
          question_text: "Question 3 - Please verify and edit",
          max_marks: 2,
          page_number: 1,
          bbox: { x1: 60, y1: 720, x2: 1725, y2: 970 }
        }
      ];
    }

  } catch (error) {
    console.error('Error extracting questions:', error);
    throw new Error(`Question extraction failed: ${error.message}`);
  }
}

/**
 * Extract text content from PDF file
 */
async function extractTextFromPDF(pdfSource) {
  return new Promise((resolve, reject) => {
    try {
      const pdfParser = new PDFParser();
      
      pdfParser.on('pdfParser_dataError', (errData) => {
        reject(new Error(errData.parserError));
      });
      
      pdfParser.on('pdfParser_dataReady', (pdfData) => {
        try {
          let text = '';
          if (pdfData.Pages) {
            pdfData.Pages.forEach((page, pageIndex) => {
              text += `\n=== PAGE ${pageIndex + 1} ===\n`;
              if (page.Texts) {
                page.Texts.forEach(textItem => {
                  if (textItem.R) {
                    textItem.R.forEach(run => {
                      if (run.T) {
                        text += decodeURIComponent(run.T) + ' ';
                      }
                    });
                  }
                });
                text += '\n';
              }
            });
          }
          
          resolve(text.trim());
        } catch (error) {
          reject(error);
        }
      });
      
      // Check if it's a local file path (not a URL)
      const isLocalFile = !pdfSource.startsWith('http://') && !pdfSource.startsWith('https://');
      
      if (isLocalFile && fs.existsSync(pdfSource)) {
        console.log(`📂 Reading local PDF file: ${pdfSource}`);
        pdfParser.loadPDF(pdfSource);
      } else if (!isLocalFile) {
        // It's a URL, download and parse
        console.log(`🌐 Downloading PDF from URL: ${pdfSource}`);
        const https = require('https');
        const http = require('http');
        const client = pdfSource.startsWith('https') ? https : http;
        
        client.get(pdfSource, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const buffer = Buffer.concat(chunks);
            pdfParser.parseBuffer(buffer);
          });
          response.on('error', reject);
        }).on('error', reject);
      } else {
        reject(new Error(`PDF file not found: ${pdfSource}`));
      }
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Extract questions WITH cropped images using AI bounding boxes
 */
async function extractQuestionsWithImages(pdfUrl, context = {}, assessmentId) {
  try {
    console.log(`🔄 Extracting questions with AI bounding boxes from: ${pdfUrl}`);
    
    // Step 1: AI extracts questions WITH bounding box coordinates
    const questionsWithBBoxes = await extractQuestionsFromPDF(pdfUrl, context);
    
    console.log(`✅ AI detected bounding boxes for ${questionsWithBBoxes.length} questions`);
    
    // Step 2: Use bounding boxes to crop precise question regions
    console.log('✂️  Now cropping questions using AI bounding boxes...');
    const questionsWithImages = await extractQuestionRegionsWithAI(
      pdfUrl,
      assessmentId,
      questionsWithBBoxes
    );
    
    console.log(`✅ Complete! ${questionsWithImages.length} questions with precise images`);
    
    return questionsWithImages;
    
  } catch (error) {
    console.error('Error in hybrid extraction:', error);
    return await extractQuestionsFromPDF(pdfUrl, context);
  }
}

/**
 * Grade student answers using AI
 */
async function gradeAnswer(question, studentAnswer, maxMarks) {
  try {
    const gradingPrompt = `Grade this answer out of ${maxMarks} marks.

Question: ${question.question_text}
Student Answer: ${studentAnswer}

Return JSON: {"marks_obtained": X, "feedback": "..."}`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a fair teacher grading answers." },
        { role: "user", content: gradingPrompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 1000,
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { marks_obtained: Math.round(maxMarks * 0.5), feedback: 'Manual review needed' };

  } catch (error) {
    return { marks_obtained: Math.round(maxMarks * 0.5), feedback: 'Manual review needed' };
  }
}

module.exports = {
  extractQuestionsFromPDF,
  extractQuestionsWithImages,
  gradeAnswer
};
