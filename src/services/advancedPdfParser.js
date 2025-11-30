
// Advanced PDF Parser - Extracts questions with REAL coordinates + AI
// Uses AI to identify questions + PDF coordinates for accurate positioning

const PDFParser = require('pdf2json');
const fs = require('fs');
const Groq = require('groq-sdk');

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'demo-key'
});

/**
 * Extract questions from PDF with ACCURATE coordinates
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<Array>} - Questions with precise bbox coordinates
 */
async function extractQuestionsWithCoordinates(pdfPath) {
  try {
    console.log('🤖 Using AI to extract questions from PDF...');
    
    const pdfData = await parsePDFWithCoordinates(pdfPath);
    
    // Let AI do EVERYTHING - identify questions and estimate positions
    const questions = await extractQuestionsWithAI(pdfData);
    
    console.log(`✅ AI extracted ${questions.length} questions with coordinates`);
    return questions;
    
  } catch (error) {
    console.error('❌ AI extraction failed:', error.message);
    throw error;
  }
}

/**
 * Parse PDF and extract text with coordinates
 */
function parsePDFWithCoordinates(pdfPath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on('pdfParser_dataError', (errData) => {
      reject(new Error(errData.parserError));
    });
    
    pdfParser.on('pdfParser_dataReady', (pdfData) => {
      try {
        const pages = [];
        
        if (pdfData.Pages) {
          pdfData.Pages.forEach((page, pageIndex) => {
            const pageInfo = {
              pageNumber: pageIndex + 1,
              width: page.Width || 12, // PDF units
              height: page.Height || 18, // PDF units
              textElements: []
            };
            
            if (page.Texts) {
              page.Texts.forEach(textItem => {
                if (textItem.R && textItem.R.length > 0) {
                  const text = textItem.R.map(run => decodeURIComponent(run.T || '')).join('');
                  if (text.trim()) {
                    pageInfo.textElements.push({
                      text: text.trim(),
                      x: textItem.x, // PDF units (0-12 typically)
                      y: textItem.y, // PDF units (0-18 typically)
                      width: textItem.w || 0,
                      height: textItem.H || 0.5
                    });
                  }
                }
              });
            }
            
            // Sort by Y position (top to bottom), then X (left to right)
            pageInfo.textElements.sort((a, b) => {
              const yDiff = a.y - b.y;
              return Math.abs(yDiff) < 0.1 ? a.x - b.x : yDiff;
            });
            
            pages.push(pageInfo);
          });
        }
        
        resolve(pages);
      } catch (error) {
        reject(error);
      }
    });
    
    if (fs.existsSync(pdfPath)) {
      pdfParser.loadPDF(pdfPath);
    } else {
      reject(new Error(`PDF file not found: ${pdfPath}`));
    }
  });
}

/**
 * Use AI to extract questions directly from PDF text with position estimation
 */
async function extractQuestionsWithAI(pages) {
  try {
    // Prepare page text for AI with line numbers for reference
    let fullText = '';
    const lineCoordinates = [];
    
    pages.forEach(page => {
      const { pageNumber, textElements, height, width } = page;
      const PDF_TO_PIXEL_Y = 2525 / (height || 18);
      const lines = groupIntoLines(textElements);
      
      fullText += `\n=== PAGE ${pageNumber} ===\n`;
      
      lines.forEach((line, idx) => {
        const lineText = line.elements.map(e => e.text).join(' ').trim();
        const lineNum = lineCoordinates.length;
        fullText += `[${lineNum}] ${lineText}\n`;
        
        lineCoordinates.push({
          pageNumber,
          y_pdf: line.y,
          y_pixel: Math.round(line.y * PDF_TO_PIXEL_Y),
          height,
          width
        });
      });
    });
    
    const prompt = `You are analyzing an examination paper. Extract ONLY the actual exam questions (not instructions, headers, or section descriptions).

For each REAL QUESTION you find, provide:
1. line_number: The [X] line number where the question starts
2. question_text: COMPLETE question text in readable format
3. marks: Number of marks (look for [2], (3), etc.)

IMPORTANT FOR MATHEMATICAL EXPRESSIONS - BE COMPLETE:
- Write math in PLAIN TEXT format with COMPLETE expressions
- DO NOT truncate or skip any part of the expression
- Convert symbols: ∫ → "integral", ∑ → "sum", √ → "square root", ∧ → "and", ∨ → "or", etc.

INTEGRAL EXPRESSIONS:
- ALWAYS include limits of integration
- Example: "∫[from -π/4 to 4] x³·sin⁴x dx = k"
  Write: "If the integral from negative pi divided by 4 to 4 of (x cubed times sine to the power 4 of x) with respect to x equals k, then k equals blank"

COMPLETE EXAMPLES:
1. Original: "∫₀⁴ x² dx = k"
   Write: "If the integral from 0 to 4 of x squared with respect to x equals k, then k equals blank"

2. Original: "∫₋π/₄⁴ x³·sin⁴x dx = k"
   Write: "If the integral from negative pi divided by 4 to 4 of (x cubed times sine to the power 4 of x) with respect to x equals k, then k equals blank"

CONVERSION GUIDE:
- Powers: x² → "x squared", x³ → "x cubed", x⁴ → "x to the power 4", x^n → "x to the power n"
- Trig: sin → "sine", cos → "cosine", tan → "tangent", sin²x → "sine squared of x"
- Fractions: x/y → "x divided by y", -π/4 → "negative pi divided by 4"
- Greek: π → "pi", θ → "theta", α → "alpha"
- Logic: ∧ → "and", ∨ → "or", ¬ → "not"
- Products: xy → "x times y", x·y → "x times y"

IMPORTANT FOR MULTIPLE CHOICE QUESTIONS:
- ALWAYS include ALL options in the question_text
- Format: "Question text. Options: (a) option1, (b) option2, (c) option3, (d) option4"
- Example: "(vi) If the integral from negative pi divided by 4 to 4 of (x cubed times sine to the power 4 of x) with respect to x equals k, then k equals blank. Options: (a) 1, (b) 2, (c) 4, (d) 0"

PDF Text:
${fullText.substring(0, 8000)}

Return as array of tuples (NOT objects) to save tokens:
[
  [15, "Find the value of x when x squared plus 2x equals 8", 2],
  [23, "Evaluate the integral of five e to the power x with respect to x", 3]
]

Format: [line_number, question_text, marks]

Rules:
- SKIP instructions like "Attempt any 5", "Section A contains", "Use of calculator"
- SKIP headers like "Multiple Choice Questions", "Short Answer Type"
- ONLY include lines that are actual questions requiring answers
- Provide COMPLETE question text, not summaries
- Return ONLY the array, no markdown or extra text`;

    console.log(`   🤖 Sending ${fullText.length} characters to AI...`);
    
    // Log the ACTUAL text being sent to AI to debug extraction issues
    console.log('\n' + '='.repeat(80));
    console.log('📄 RAW TEXT FROM PDF (sent to AI):');
    console.log('='.repeat(80));
    console.log(fullText);
    console.log('='.repeat(80) + '\n');

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are an expert at identifying exam questions. CRITICAL: Write COMPLETE question text - never truncate or skip any part of mathematical expressions. Include all integral limits, all terms in expressions, and all multiple choice options. Return only JSON." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile", // 70B model - much smarter than 8B!
      temperature: 0.1,
      max_tokens: 8000,
    });

    let response = completion.choices[0]?.message?.content || '[]';
    response = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Log FULL AI response for evaluation
    console.log('\n' + '='.repeat(80));
    console.log('📝 COMPLETE AI RESPONSE:');
    console.log('='.repeat(80));
    console.log(response);
    console.log('='.repeat(80) + '\n');
    
    const aiQuestions = JSON.parse(response);
    console.log(`   ✅ AI identified ${aiQuestions.length} real questions`);
    
    // Convert tuples to objects
    const processedQuestions = aiQuestions.map(q => {
      if (Array.isArray(q)) {
        // Tuple format: [line_number, question_text, marks]
        const [line_number, question_text, marks] = q;
        return { line_number, question_text, marks };
      } else {
        // Legacy object format
        return q;
      }
    });
    
    // Log each extracted question for evaluation
    console.log('\n📋 EXTRACTED QUESTIONS:');
    processedQuestions.forEach((q, idx) => {
      console.log(`\n   Q${idx + 1} [Line ${q.line_number}] (${q.marks} marks):`);
      console.log(`   "${q.question_text}"`);
    });
    console.log('\n');
    
    // Convert AI output to our format with coordinates
    const questions = processedQuestions.map((q, idx) => {
      const coords = lineCoordinates[q.line_number] || lineCoordinates[0];
      const PDF_TO_PIXEL_Y = 2525 / (coords.height || 18);
      
      // Estimate question height (2-3 lines = ~150px)
      const estimatedHeight = 150;
      
      return {
        question_number: idx + 1,
        question_text: q.question_text || 'Question',
        max_marks: q.marks || 2,
        page_number: coords.pageNumber,
        bbox: {
          x1: 60,
          y1: Math.max(0, coords.y_pixel - 15),
          x2: 1725,
          y2: Math.min(2525, coords.y_pixel + estimatedHeight)
        }
      };
    });
    
    return questions;
    
  } catch (error) {
    console.error('   ❌ AI extraction failed:', error.message);
    throw error;
  }
}

/**
 * Identify questions from PDF text elements with coordinates
 */
function identifyQuestions(pages) {
  const questions = [];
  let globalQuestionNumber = 0;
  
  pages.forEach(page => {
    const { pageNumber, textElements, height, width } = page;
    
    // Calculate conversion factor for THIS specific page
    const PDF_TO_PIXEL_Y = 2525 / (height || 18);
    
    console.log(`   📐 Page ${pageNumber}: PDF size=${width}x${height}, Conversion: ${PDF_TO_PIXEL_Y.toFixed(2)} pixels/unit`);
    
    // Group text elements into lines
    const lines = groupIntoLines(textElements);
    
    console.log(`   📄 Page ${pageNumber}: ${lines.length} lines detected`);
    
    let questionsFoundOnPage = 0;
    
    // Find question patterns in lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineText = line.elements.map(e => e.text).join(' ').trim();
      
      // FILTER OUT: Instructions, headers, footers, metadata
      if (isInstructionOrHeader(lineText)) {
        if (lineText.match(/\d+[\.\:\)\]]/)) {
          console.log(`   ⊗ Filtered (instruction): "${lineText.substring(0, 60)}..."`);
        }
        continue;
      }
      
      // Match question patterns - MORE FLEXIBLE
      // Matches: "1.", "1)", "Q.1", "Q1:", "Question 1", "(1)", "1 .", etc.
      const questionMatch = lineText.match(/^(?:\()?(?:Q\.?\s*)?(\d+)[\.\:\)\]\s]+(.*)$/i) ||
                           lineText.match(/^Question\s+(\d+)[\.\:\s]+(.*)$/i);
      
      if (questionMatch) {
        const qNum = parseInt(questionMatch[1]);
        let questionText = questionMatch[2].trim();
        
        // ADDITIONAL CHECK: Filter out if the question text itself contains instructions
        if (isInstructionContent(questionText)) {
          console.log(`   ⊗ Filtered (instruction content): "${lineText.substring(0, 60)}..."`);
          continue;
        }
        
        // RELAXED: Allow some non-sequential numbering (sometimes questions restart numbering per section)
        // But skip obvious false positives (number too high or going backwards)
        if (globalQuestionNumber > 0) {
          if (qNum < globalQuestionNumber - 5) continue; // Going backwards too much
          if (qNum > globalQuestionNumber + 10) continue; // Jumping too far ahead
        }
        
        // Use sequential numbering for now (will renumber later if needed)
        globalQuestionNumber++;
        
        // Find marks notation in current line or next few lines
        let maxMarks = 2; // default
        let questionEndLineIndex = i;
        
        for (let j = i; j < Math.min(i + 8, lines.length); j++) {
          const checkText = lines[j].elements.map(e => e.text).join(' ');
          
          // Look for marks notation
          const marksMatch = checkText.match(/[\[\(](\d+)\s*(?:marks?|M|pts?)[\]\)]/i);
          if (marksMatch) {
            maxMarks = parseInt(marksMatch[1]);
            questionEndLineIndex = j;
            
            // Add remaining text to question
            if (j > i) {
              for (let k = i + 1; k <= j; k++) {
                questionText += ' ' + lines[k].elements.map(e => e.text).join(' ');
              }
            }
            break;
          }
          
          // Check if we hit the next question
          if (j > i) {
            const nextLineText = lines[j].elements.map(e => e.text).join(' ').trim();
            if (/^(?:\()?(?:Q\.?\s*)?\d+[\.\:\)\]\s]/.test(nextLineText)) {
              questionEndLineIndex = j - 1;
              break;
            }
          }
        }
        
        // Calculate bounding box from PDF coordinates
        const questionStartY = line.elements[0].y;
        const questionEndY = lines[questionEndLineIndex].elements[lines[questionEndLineIndex].elements.length - 1].y + 0.5;
        
        // Convert PDF units to pixels with padding
        const PADDING_Y = 15; // pixels
        const y1_raw = Math.round(questionStartY * PDF_TO_PIXEL_Y);
        const y2_raw = Math.round(questionEndY * PDF_TO_PIXEL_Y);
        
        const bbox = {
          x1: 60, // Left margin in pixels
          y1: Math.max(0, y1_raw - PADDING_Y),
          x2: 1725, // Right margin in pixels
          y2: Math.min(2525, y2_raw + PADDING_Y)
        };
        
        // Validate bbox has positive dimensions
        if (bbox.y2 <= bbox.y1) {
          console.log(`   ⚠️  Q${globalQuestionNumber}: Invalid Y coords (y1=${bbox.y1}, y2=${bbox.y2}), skipping`);
          continue;
        }
        
        // Clean question text
        questionText = questionText
          .replace(/[\[\(]\d+\s*(?:marks?|M|pts?)[\]\)]/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        questions.push({
          question_number: globalQuestionNumber,
          question_text: questionText.substring(0, 500),
          max_marks: maxMarks,
          page_number: pageNumber,
          bbox: bbox
        });
        
        console.log(`   ✓ Q${globalQuestionNumber}: Marks=${maxMarks}, PDF(${questionStartY.toFixed(2)}->${questionEndY.toFixed(2)}) → Pixels(${bbox.y1}-${bbox.y2}) Height=${bbox.y2-bbox.y1}px`);
        console.log(`      Text: "${questionText.substring(0, 100)}${questionText.length > 100 ? '...' : ''}"`);
        questionsFoundOnPage++;
        
        // Skip lines we've already processed
        i = questionEndLineIndex;
      } else {
        // Debug: Log potential questions that weren't matched
        if (lineText.match(/^\s*[\(\[]?\s*\d+\s*[\.\)\]]/)) {
          console.log(`   ⊘ Skipped line ${i}: "${lineText.substring(0, 60)}..." (pattern not matched or validation failed)`);
        }
      }
    }
    
    console.log(`   ✅ Page ${pageNumber}: Found ${questionsFoundOnPage} questions\n`);
  });
  
  return questions;
}

/**
 * Group text elements into lines based on Y coordinate similarity
 */
function groupIntoLines(textElements) {
  const lines = [];
  let currentLine = null;
  
  textElements.forEach(element => {
    if (!currentLine || Math.abs(element.y - currentLine.y) > 0.15) {
      // New line (Y difference > 0.15 PDF units ~= 21 pixels)
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = {
        y: element.y,
        elements: [element]
      };
    } else {
      // Same line
      currentLine.elements.push(element);
    }
  });
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
}

/**
 * Check if question text contains instruction keywords
 * This catches numbered instructions like "1. Attempt any EIGHT..."
 */
function isInstructionContent(text) {
  const lowerText = text.toLowerCase().trim();
  
  // Instruction keywords that indicate it's not a real question
  const instructionKeywords = [
    /attempt\s+(?:any|all|the)/i,
    /answer\s+(?:any|all|the\s+following)/i,
    /choose\s+(?:any|all|the\s+correct)/i,
    /select\s+(?:any|all|the\s+correct)/i,
    /solve\s+(?:any|all)/i,
    /do\s+(?:any|all)/i,
    /write\s+(?:any|all)/i,
    /following\s+questions?\s*:/i,
    /questions?\s+are\s+compulsory/i,
    /from\s+the\s+(?:following|options\s+given)/i,
    /each\s+question\s+carries/i,
    /marks?\s+will\s+be\s+(?:awarded|given)/i,
  ];
  
  for (const pattern of instructionKeywords) {
    if (pattern.test(lowerText)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a line is an instruction, header, or metadata (not a question)
 */
function isInstructionOrHeader(text) {
  const lowerText = text.toLowerCase().trim();
  
  // Skip empty or very short lines
  if (lowerText.length < 3) return true;
  
  // Common instruction patterns
  const instructionPatterns = [
    // Headers and titles
    /^(?:examination|exam|test|assessment|paper)/i,
    /^(?:class|grade|standard|section)\s*[:=\-\s]*\d+/i,
    /^(?:subject|course)[:=\-\s]/i,
    /^(?:date|time|duration)[:=\-\s]/i,
    /^(?:total|maximum|max)[\s\.](?:marks?|points?|time)[:=\-\s]/i,
    
    // Instructions
    /^(?:instructions?|directions?|note|important)[:=\-\s]/i,
    /^(?:read|answer|attempt|choose|select|write)/i,
    /^(?:all questions? are|this paper)/i,
    /^(?:section|part)\s+[a-z]\s*[:=\-]/i,
    
    // Metadata
    /^page\s+\d+\s+of\s+\d+/i,
    /^\d+\s*\/\s*\d+$/,  // Page numbers like "1/5"
    /^roll\s+no/i,
    /^name[:=\-\s]/i,
    /^signature[:=\-\s]/i,
    
    // Question paper structure indicators (not questions)
    /^(?:multiple choice|true.?false|fill.?in|match.?the)/i,
    /^(?:very short|short|long) answer/i,
    
    // Time and marks allocation
    /^\d+\s+(?:hours?|mins?|minutes?)/i,
    /^marks?[:=\-\s]*\d+/i,
  ];
  
  // Check against patterns
  for (const pattern of instructionPatterns) {
    if (pattern.test(lowerText)) {
      return true;
    }
  }
  
  // Skip if line is ALL CAPS and longer than 15 chars (likely a heading)
  if (text.length > 15 && text === text.toUpperCase() && /[A-Z]{10,}/.test(text)) {
    return true;
  }
  
  // Skip if line has no alphabetic characters (just numbers/symbols)
  if (!/[a-zA-Z]/.test(text)) {
    return true;
  }
  
  // Skip if line is too short to be a question (less than 10 chars after question number)
  if (lowerText.replace(/^(?:q\.?\s*)?\d+[\.\:\)\]\s]+/, '').trim().length < 10) {
    return true;
  }
  
  return false;
}

module.exports = {
  extractQuestionsWithCoordinates
};
