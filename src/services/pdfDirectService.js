
// Serverless-friendly PDF service
// Sends PDFs directly to AI APIs without image conversion

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

/**
 * Read PDF file and convert to base64 for AI processing
 * Works in serverless environments without canvas dependencies
 */
async function getPdfAsBase64(pdfPath) {
  try {
    let localPath = pdfPath;
    let tempFile = null;

    // If it's a remote URL, download it first
    if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
      console.log('📥 Downloading remote PDF from:', pdfPath);
      
      const response = await fetch(pdfPath);
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.buffer();
      
      // Save to temp file
      tempFile = path.join('/tmp', `remote-pdf-${Date.now()}.pdf`);
      fs.writeFileSync(tempFile, buffer);
      localPath = tempFile;
      
      console.log('✅ PDF downloaded to:', tempFile);
    }

    // Read PDF file as buffer
    const pdfBuffer = fs.readFileSync(localPath);
    const base64Pdf = pdfBuffer.toString('base64');

    // Clean up temp file if created
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
      console.log('🗑️  Cleaned up temp PDF:', tempFile);
    }

    return {
      base64: base64Pdf,
      mimeType: 'application/pdf',
      size: pdfBuffer.length
    };

  } catch (error) {
    console.error('❌ Error processing PDF:', error);
    throw error;
  }
}

/**
 * Get page count from PDF using pdf-lib
 */
async function getPdfPageCount(pdfPath) {
  try {
    const { PDFDocument } = require('pdf-lib');
    
    let localPath = pdfPath;
    let tempFile = null;

    // Download if remote
    if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
      const response = await fetch(pdfPath);
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status}`);
      }
      
      const buffer = await response.buffer();
      tempFile = path.join('/tmp', `pdf-count-${Date.now()}.pdf`);
      fs.writeFileSync(tempFile, buffer);
      localPath = tempFile;
    }

    // Read PDF and get page count
    const pdfBuffer = fs.readFileSync(localPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();

    // Clean up
    if (tempFile && fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    return pageCount;

  } catch (error) {
    console.error('Error getting PDF page count:', error);
    return 1; // Default to 1 page if error
  }
}

module.exports = {
  getPdfAsBase64,
  getPdfPageCount
};
