
// PDF to Image Service - Converts PDFs to images and crops questions precisely
// Uses pdf-to-img for conversion and sharp for image manipulation

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Dynamic import for ES Module
let pdfToImgModule = null;

async function getPdfToImg() {
  if (!pdfToImgModule) {
    const module = await import('pdf-to-img');
    pdfToImgModule = module.pdf;
  }
  return pdfToImgModule;
}

/**
 * Convert PDF to high-quality images (one per page)
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<Array>} - Array of page images with metadata
 */
async function convertPDFToImages(pdfPath) {
  try {
    console.log(`📄 Converting PDF to images: ${pdfPath}`);
    
    const pdfToImg = await getPdfToImg();
    const document = await pdfToImg(pdfPath, {
      scale: 3.0  // 3.0 scale = 300 DPI (100 DPI * 3.0)
    });

    const pageImages = [];
    
    for await (const page of document) {
      // Get image metadata using sharp
      const metadata = await sharp(page.buffer).metadata();
      
      pageImages.push({
        page: page.page,
        buffer: page.buffer,
        width: metadata.width,
        height: metadata.height
      });
      
      console.log(`   ✓ Page ${page.page} converted (${metadata.width}x${metadata.height})`);
    }

    console.log(`✅ Converted ${pageImages.length} pages to images`);
    return pageImages;

  } catch (error) {
    console.error('Error converting PDF to images:', error);
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

/**
 * Convert PDF to images and save to temp files for vision AI
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<Array>} - Array of {pageNumber, imagePath}
 */
async function convertPdfToImages(pdfPath) {
  try {
    const pageImages = await convertPDFToImages(pdfPath);
    
    // Save each page to a temp file
    const tempDir = path.join(__dirname, '../../temp/vision');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const imagePaths = [];
    
    for (const pageData of pageImages) {
      const imagePath = path.join(tempDir, `page-${pageData.page}.png`);
      await sharp(pageData.buffer).toFile(imagePath);
      
      imagePaths.push({
        pageNumber: pageData.page,
        imagePath: imagePath
      });
    }
    
    return imagePaths;
    
  } catch (error) {
    console.error('Error preparing images for vision AI:', error);
    throw error;
  }
}

/**
 * Extract question regions using AI-provided bounding boxes
 * @param {string} pdfPath - Path to the PDF file
 * @param {number} assessmentId - Assessment ID for organizing files
 * @param {Array} questionsWithBBoxes - Questions with bbox coordinates
 * @returns {Promise<Array>} - Questions with image_url added
 */
async function extractQuestionRegionsWithAI(pdfPath, assessmentId, questionsWithBBoxes) {
  try {
    console.log(`\n✂️  Cropping ${questionsWithBBoxes.length} questions using AI bounding boxes...`);
    
    // Step 1: Convert entire PDF to images
    const pageImages = await convertPDFToImages(pdfPath);
    console.log(`   📄 ${pageImages.length} pages available for cropping`);

    // Step 2: Crop each question using its bounding box
    const questionsWithImages = [];
    
    for (const question of questionsWithBBoxes) {
      try {
        const pageIndex = (question.page_number || 1) - 1;
        
        // Validate page exists
        if (pageIndex < 0 || pageIndex >= pageImages.length) {
          console.warn(`   ⚠️  Question ${question.question_number}: Invalid page ${question.page_number}`);
          questionsWithImages.push(question);
          continue;
        }

        const pageImage = pageImages[pageIndex];
        
        // Validate bounding box
        if (!question.bbox || !question.bbox.x1 || !question.bbox.y1 || !question.bbox.x2 || !question.bbox.y2) {
          console.warn(`   ⚠️  Question ${question.question_number}: Missing bounding box`);
          questionsWithImages.push(question);
          continue;
        }

        const bbox = question.bbox;
        
        // Ensure coordinates are within image bounds
        const width = pageImage.width;
        const height = pageImage.height;
        
        const validBBox = {
          x1: Math.max(0, Math.min(bbox.x1, width)),
          y1: Math.max(0, Math.min(bbox.y1, height)),
          x2: Math.max(0, Math.min(bbox.x2, width)),
          y2: Math.max(0, Math.min(bbox.y2, height))
        };

        // Calculate crop dimensions
        const cropWidth = validBBox.x2 - validBBox.x1;
        const cropHeight = validBBox.y2 - validBBox.y1;

        if (cropWidth <= 0 || cropHeight <= 0) {
          console.warn(`   ⚠️  Question ${question.question_number}: Invalid bbox dimensions`);
          questionsWithImages.push(question);
          continue;
        }

        // Crop the question with padding
        const padding = 20; // 20 pixels padding on all sides
        const croppedImage = await cropQuestionFromPage(
          pageImage,
          validBBox,
          padding
        );

        // Save cropped image
        const filename = `question_${question.question_number}.png`;
        const imageUrl = await saveImage(croppedImage, assessmentId, filename);

        // Add image URL to question
        questionsWithImages.push({
          ...question,
          question_image_url: imageUrl
        });

        console.log(`   ✓ Q${question.question_number}: Cropped (${cropWidth}x${cropHeight}) → ${imageUrl}`);

      } catch (error) {
        console.error(`   ❌ Failed to crop question ${question.question_number}:`, error.message);
        questionsWithImages.push(question);
      }
    }

    console.log(`\n✅ Successfully cropped ${questionsWithImages.filter(q => q.question_image_url).length}/${questionsWithBBoxes.length} questions\n`);
    
    return questionsWithImages;

  } catch (error) {
    console.error('Error extracting question regions:', error);
    throw error;
  }
}

/**
 * Crop a specific region from a page image using bounding box
 * @param {Object} pageImage - Page image with buffer and dimensions
 * @param {Object} bbox - Bounding box {x1, y1, x2, y2}
 * @param {number} padding - Padding to add around crop (pixels)
 * @returns {Promise<Buffer>} - Cropped image as buffer
 */
async function cropQuestionFromPage(pageImage, bbox, padding = 20) {
  try {
    const { x1, y1, x2, y2 } = bbox;
    
    // Calculate crop dimensions with padding
    const left = Math.max(0, x1 - padding);
    const top = Math.max(0, y1 - padding);
    const width = Math.min(pageImage.width - left, (x2 - x1) + (2 * padding));
    const height = Math.min(pageImage.height - top, (y2 - y1) + (2 * padding));

    // Perform the crop
    const croppedBuffer = await sharp(pageImage.buffer)
      .extract({
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height)
      })
      .png({ quality: 95, compressionLevel: 6 })
      .toBuffer();

    return croppedBuffer;

  } catch (error) {
    console.error('Error cropping image:', error);
    throw error;
  }
}

/**
 * Save image to disk
 * @param {Buffer} imageBuffer - Image buffer to save
 * @param {number} assessmentId - Assessment ID for organization
 * @param {string} filename - Filename for the image
 * @returns {Promise<string>} - Public URL/path to saved image
 */
async function saveImage(imageBuffer, assessmentId, filename) {
  try {
    // Create directory structure: /uploads/questions/assessment_X/
    const uploadDir = path.join(__dirname, '../../uploads/questions', `assessment_${assessmentId}`);
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    
    // Save image to disk
    await fs.promises.writeFile(filePath, imageBuffer);
    
    // Return public URL path (relative to web root)
    const publicUrl = `/uploads/questions/assessment_${assessmentId}/${filename}`;
    
    return publicUrl;

  } catch (error) {
    console.error('Error saving image:', error);
    throw error;
  }
}

/**
 * Delete all question images for an assessment
 * @param {number} assessmentId - Assessment ID
 */
async function deleteAssessmentImages(assessmentId) {
  try {
    const uploadDir = path.join(__dirname, '../../uploads/questions', `assessment_${assessmentId}`);
    
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true });
      console.log(`🗑️  Deleted images for assessment ${assessmentId}`);
    }
  } catch (error) {
    console.error('Error deleting assessment images:', error);
  }
}

module.exports = {
  convertPDFToImages,
  convertPdfToImages,
  extractQuestionRegionsWithAI,
  cropQuestionFromPage,
  saveImage,
  deleteAssessmentImages
};
