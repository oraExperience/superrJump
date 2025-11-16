
// Direct PDF Question Parser (No AI Required)
// Parses questions from standard exam paper format

const PDFParser = require('pdf2json');
const fs = require('fs');

/**
 * Extract questions directly from PDF without AI
 * Works for standard exam paper formats with question numbers
 */
async function extractQuestionsDirectly(pdfPath) {
  try {
    console.log(`📄 Parsing questions directly from: ${pdfPath}`);
    
    const pdfText = await extractTextFromPDF(pdfPath);
    const questions = parseQuestionsFromText(pdfText);
    
    console.log(`✅ Extracted ${questions.length} questions directly from PDF`);
    return questions;
    
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw error;
  }
}

/**
 * Extract text from PDF
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
          let currentPage = 0;
          
          if (pdfData.Pages) {
            pdfData.Pages.forEach((page, pageIndex) => {
              currentPage = pageIndex + 1;
              text += `\n===PAGE_${currentPage}===\n`;
              
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
      
      const isLocalFile = !pdfSource.startsWith('http://') && !pdfSource.startsWith('https://');
      
      if (isLocalFile && fs.existsSync(pdfSource)) {
        pdfParser.loadPDF(pdfSource);
      } else {
        reject(new Error(`PDF file not found: ${pdfSource}`));
      }
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Parse questions from extracted text
 * Looks for question patterns like "1.", "Q1:", "Question 1", etc.
 */
function parseQuestionsFromText(text) {
  const questions = [];
  let questionNumber = 0;
  
  // Split by page
  const pages = text.split(/===PAGE_(\d+)===/);
  
  for (let i = 1; i < pages.length; i += 2) {
    const pageNumber = parseInt(pages[i]);
    const pageText = pages[i + 1] || '';
    
    // Look for question patterns
    // Matches: "1.", "2.", "Q1.", "Q.1", "Question 1", etc.
    const questionPatterns = [
      /(?:^|\n)\s*(\d+)\s*\.\s*([^\n]+(?:\n(?!\s*\d+\s*\.)[^\n]+)*)/g,
      /(?:^|\n)\s*Q\s*\.?\s*(\d+)\s*:?\s*([^\n]+(?:\n(?!\s*Q\s*\.?\s*\d+)[^\n]+)*)/gi,
      /(?:^|\n)\s*Question\s+(\d+)\s*:?\s*([^\n]+(?:\n(?!\s*Question\s+\d+)[^\n]+)*)/gi
    ];
    
    for (const pattern of questionPatterns) {
      let match;
      while ((match = pattern.exec(pageText)) !== null) {
        const qNum = parseInt(match[1]);
        let qText = match[2].trim();
        
        // Skip if question number is not sequential
        if (qNum !== questionNumber + 1 && questionNumber > 0) {
          continue;
        }
        
        // Extract marks if present (looks for patterns like "[2 marks]", "(2)", "2M", etc.)
        let maxMarks = 2; // Default
        const marksMatch = qText.match(/[\[\(](\d+)\s*(?:marks?|M|pts?)[\]\)]/i);
        if (marksMatch) {
          maxMarks = parseInt(marksMatch[1]);
          qText = qText.replace(marksMatch[0], '').trim();
        }
        
        // Clean up question text
        qText = qText
          .replace(/\s+/g, ' ')
          .replace(/\s+([.,!?])/g, '$1')
          .trim();
        
        // Skip very short questions (likely false positives)
        if (qText.length < 10) continue;
        
        questionNumber = qNum;
        
        // Estimate bounding box based on page and position
        const estimatedY = 200 + ((qNum - 1) % 20) * 120; // Assume ~20 questions per page
        
        questions.push({
          question_number: qNum,
          question_text: qText.substring(0, 500), // Limit length
          max_marks: maxMarks,
          page_number: pageNumber,
          bbox: {
            x1: 100,
            y1: estimatedY,
            x2: 2700,
            y2: estimatedY + 100
          }
        });
      }
    }
  }
  
  // If no questions found with patterns, try to split by empty lines
  if (questions.length === 0) {
    console.log('⚠️  No question patterns found, using line-based parsing');
    const lines = text.split('\n').filter(line => line.trim().length > 20);
    
    lines.forEach((line, index) => {
      if (index < 50) { // Limit to 50 questions
        questions.push({
          question_number: index + 1,
          question_text: line.trim().substring(0, 500),
          max_marks: 2,
          page_number: Math.floor(index / 10) + 1,
          bbox: {
            x1: 100,
            y1: 200 + (index % 10) * 120,
            x2: 2700,
            y2: 320 + (index % 10) * 120
          }
        });
      }
    });
  }
  
  return questions;
}

module.exports = {
  extractQuestionsDirectly
};
