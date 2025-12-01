
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
  console.log('\n' + '='.repeat(80));
  console.log('📄 PDF TO IMAGE CONVERSION STARTED');
  console.log('='.repeat(80));
  console.log('📂 Input PDF:', pdfPath);
  console.log('🔧 PDF_SERVICE_URL:', process.env.PDF_SERVICE_URL || 'NOT SET');
  console.log('🎯 Using Remote Service:', USE_REMOTE_PDF_SERVICE);
  console.log('='.repeat(80) + '\n');
  
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
    console.log('\n' + '─'.repeat(80));
    console.log('🌐 REMOTE PDF SERVICE CALL');
    console.log('─'.repeat(80));
    console.log('📡 Service URL:', PDF_SERVICE_URL);
    console.log('📂 PDF Path/URL:', pdfPath);
    console.log('📂 Input Type:', typeof pdfPath);
    console.log('📂 Starts with http:', pdfPath?.startsWith?.('http'));
    console.log('📂 Starts with /:', pdfPath?.startsWith?.('/'));
    console.log('⏰ Request Time:', new Date().toISOString());
    console.log('─'.repeat(80) + '\n');
    
    const requestBody = { pdfUrl: pdfPath };
    console.log('📤 Request Body:', JSON.stringify(requestBody, null, 2));
    console.log('📤 Full Request URL:', `${PDF_SERVICE_URL}/convert-pdf`);
    console.log('📤 Sending request at:', new Date().toISOString());
    
    // Call remote service
    const response = await fetch(`${PDF_SERVICE_URL}/convert-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    console.log('📥 Response received at:', new Date().toISOString());
    
    console.log('📥 Response Status:', response.status, response.statusText);
    
    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Service Error Response:', error);
      throw new Error(`Remote PDF service error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    console.log('\n' + '─'.repeat(80));
    console.log('📊 REMOTE SERVICE RESPONSE');
    console.log('─'.repeat(80));
    console.log('✓ Success:', data.success);
    console.log('📄 Pages Converted:', data.pages);
    console.log('🖼️  Images Received:', data.images?.length || 0);
    console.log('─'.repeat(80) + '\n');
    
    if (!data.success) {
      throw new Error(data.error || 'Remote PDF conversion failed');
    }
    
    // Detailed validation of each image
    console.log('🔍 Validating received images...');
    data.images.forEach((img, index) => {
      const base64Length = img.base64?.length || 0;
      const bufferSize = Math.round(base64Length * 0.75); // Approximate buffer size
      console.log(`  Page ${img.pageNumber}:`, {
        base64Length,
        estimatedBufferSize: `${(bufferSize / 1024).toFixed(1)} KB`,
        dimensions: `${img.width}x${img.height}`,
        base64Prefix: img.base64?.substring(0, 20) + '...'
      });
    });
    
    // Convert base64 images back to buffers
    console.log('\n🔄 Converting base64 to buffers...');
    const pageImages = data.images.map(img => {
      const buffer = Buffer.from(img.base64, 'base64');
      console.log(`  ✓ Page ${img.pageNumber}: Buffer created (${buffer.length} bytes)`);
      return {
        page: img.pageNumber,
        buffer: buffer,
        width: img.width,
        height: img.height
      };
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ PDF CONVERSION COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));
    console.log('📦 Total Pages:', pageImages.length);
    console.log('💾 Total Size:', `${(pageImages.reduce((sum, p) => sum + p.buffer.length, 0) / 1024).toFixed(1)} KB`);
    console.log('='.repeat(80) + '\n');
    
    return pageImages;
    
  } catch (error) {
    console.error('\n' + '❌'.repeat(40));
    console.error('❌ REMOTE PDF SERVICE FAILED');
    console.error('❌'.repeat(40));
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('❌'.repeat(40) + '\n');
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
      
      // Debug buffer
      console.log(`   🔍 Buffer info for page ${pageData.page}:`, {
        isBuffer: Buffer.isBuffer(pageData.buffer),
        length: pageData.buffer?.length,
        firstBytes: pageData.buffer?.slice(0, 10).toString('hex')
      });
      
      // Explicitly specify PNG format when saving
      await sharp(pageData.buffer)
        .png()
        .toFile(imagePath);
      
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
