
// PDF Image Service - Routes PDF conversion to external microservice
// Uses local pdf-to-img in development, remote service in production

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Check if we should use remote PDF service
// If PDF_SERVICE_URL is set, always use remote service (both local and production)
const USE_REMOTE_PDF_SERVICE = !!process.env.PDF_SERVICE_URL;
const PDF_SERVICE_URL = process.env.PDF_SERVICE_URL;

/**
 * Convert PDF to images - uses remote service if PDF_SERVICE_URL is set
 */
async function convertPDFToImages(pdfPath) {
  // If PDF_SERVICE_URL is set, use remote service (works in both local and production)
  if (USE_REMOTE_PDF_SERVICE) {
    console.log('🌐 Using Render microservice for PDF conversion');
    return convertPDFToImagesRemote(pdfPath);
  }
  
  // Fallback to local pdf-to-img (only if PDF_SERVICE_URL not set)
  console.log('🖥️  Using local pdf-to-img library');
  return convertPDFToImagesLocal(pdfPath);
}

/**
 * Convert PDF using remote microservice (for Vercel production)
 */
async function convertPDFToImagesRemote(pdfPath) {
  try {
    console.log('🌐 Using remote PDF service:', PDF_SERVICE_URL);
    
    // Call remote service
    const response = await fetch(`${PDF_SERVICE_URL}/convert-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl: pdfPath })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Remote PDF service error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Remote PDF conversion failed');
    }
    
    console.log(`✅ Remote service converted ${data.pages} pages`);
    
    // Convert base64 images back to buffers
    const pageImages = data.images.map(img => ({
      page: img.pageNumber,
      buffer: Buffer.from(img.base64, 'base64'),
      width: img.width,
      height: img.height
    }));
    
    return pageImages;
    
  } catch (error) {
    console.error('❌ Remote PDF service failed:', error);
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

/**
 * Convert PDF locally using pdf-to-img (for local development)
 */
async function convertPDFToImagesLocal(pdfPath) {
  let localPdfPath = pdfPath;
  let tempPdfPath = null;
  
  try {
    console.log('🖼️  Using local PDF conversion');
    
    // Handle remote URLs - download first
    if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
      console.log('📥 Downloading PDF...');
      
      tempPdfPath = path.join('/tmp', `remote-pdf-${Date.now()}.pdf`);
      
      const response = await fetch(pdfPath);
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status}`);
      }
      
      const buffer = await response.buffer();
      fs.writeFileSync(tempPdfPath, buffer);
      localPdfPath = tempPdfPath;
    }
    
    // Dynamic import for pdf-to-img
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(localPdfPath, { scale: 1.5 });
    
    const pageImages = [];
    let pageIndex = 1;
    
    for await (const page of document) {
      const metadata = await sharp(page.buffer).metadata();
      
      pageImages.push({
        page: pageIndex,
        buffer: page.buffer,
        width: metadata.width,
        height: metadata.height
      });
      
      console.log(`   ✓ Page ${pageIndex} converted (${metadata.width}x${metadata.height})`);
      pageIndex++;
    }
    
    console.log(`✅ Converted ${pageImages.length} pages locally`);
    return pageImages;
    
  } catch (error) {
    console.error('❌ Local PDF conversion error:', error);
    throw new Error(`PDF conversion failed: ${error.message}`);
  } finally {
    if (tempPdfPath && fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
    }
  }
}

/**
 * Convert PDF to images and save to temp files for vision AI
 */
async function convertPdfToImages(pdfPath) {
  try {
    const pageImages = await convertPDFToImages(pdfPath);
    
    // Save each page to a temp file
    const baseTemp = process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, '../..');
    const tempDir = path.join(baseTemp, 'temp/vision');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const imagePaths = [];
    
    for (const pageData of pageImages) {
      const imagePath = path.join(tempDir, `page-${pageData.page}-${Date.now()}.png`);
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

module.exports = {
  convertPDFToImages,
  convertPdfToImages
};
