
// Simple service to get full PDF pages as images

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { convertPdfToImages } = require('./pdfImageService');

/**
 * Get a specific page from PDF as an image
 * @param {string} pdfPath - Path to the PDF file
 * @param {number} pageNumber - Page number (1-indexed)
 * @returns {Promise<Buffer>} - Image buffer
 */
async function getPdfPageImage(pdfPath, pageNumber) {
  try {
    // Handle both remote URLs and local paths
    let processPath = pdfPath;
    
    // If it's not a URL, convert relative path to absolute path
    if (!pdfPath.startsWith('http://') && !pdfPath.startsWith('https://')) {
      processPath = pdfPath.startsWith('/')
        ? path.join(process.cwd(), pdfPath.substring(1))
        : pdfPath;
      
      // Check if local PDF file exists
      if (!fs.existsSync(processPath)) {
        throw new Error(`PDF file not found: ${processPath}. The file may have been deleted or moved.`);
      }
    }
    
    console.log(`Getting PDF page ${pageNumber} from: ${processPath}`);
    
    // Convert PDF to images (handles both local and remote URLs)
    const imagePages = await convertPdfToImages(processPath);
    
    // Find the specific page
    const pageImage = imagePages.find(p => p.pageNumber === pageNumber);
    if (!pageImage) {
      throw new Error(`Page ${pageNumber} not found in PDF`);
    }
    
    // Read the image file
    const imageBuffer = fs.readFileSync(pageImage.imagePath);
    
    // Return as PNG
    return await sharp(imageBuffer).png().toBuffer();
    
  } catch (error) {
    console.error('Error getting PDF page:', error);
    throw error;
  }
}

module.exports = {
  getPdfPageImage
};
