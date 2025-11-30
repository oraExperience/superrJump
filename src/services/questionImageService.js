
const { convertPdfToImages } = require('./pdfImageServiceRemote');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

/**
 * Get cropped image for a question based on its coordinates
 * @param {string} pdfPath - Path to the PDF file
 * @param {number} pageNumber - Page number (1-indexed)
 * @param {number} yStart - Y coordinate where question starts
 * @param {number} yEnd - Y coordinate where question ends
 * @returns {Promise<Buffer>} - Cropped image buffer
 */
async function getQuestionImage(pdfPath, pageNumber, yStart, yEnd) {
  try {
    // Convert relative path to absolute path
    const absolutePdfPath = pdfPath.startsWith('/')
      ? path.join(process.cwd(), pdfPath.substring(1))  // Remove leading slash and join with cwd
      : pdfPath;
    
    console.log(`Getting question image from: ${absolutePdfPath}`);
    
    // Convert PDF page to image
    const imagePages = await convertPdfToImages(absolutePdfPath);
    
    // Find the specific page
    const pageImage = imagePages.find(p => p.pageNumber === pageNumber);
    if (!pageImage) {
      throw new Error(`Page ${pageNumber} not found in PDF`);
    }
    
    // Read the image
    const imageBuffer = fs.readFileSync(pageImage.imagePath);
    
    // Get image metadata to calculate crop dimensions
    const metadata = await sharp(imageBuffer).metadata();
    
    // Crop the image using y coordinates
    // Add some padding (20 pixels) for better visibility
    const padding = 20;
    const cropY = Math.max(0, yStart - padding);
    const cropHeight = Math.min(metadata.height - cropY, (yEnd - yStart) + (padding * 2));
    
    const croppedImage = await sharp(imageBuffer)
      .extract({
        left: 0,
        top: cropY,
        width: metadata.width,
        height: cropHeight
      })
      .png()
      .toBuffer();
    
    return croppedImage;
    
  } catch (error) {
    console.error('Error generating question image:', error);
    throw error;
  }
}

module.exports = {
  getQuestionImage
};
