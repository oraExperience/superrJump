
// Simple service to get full PDF pages as images with caching

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { convertPdfToImages } = require('./pdfImageServiceRemote');

// In-memory cache for converted PDF pages
// Structure: { 'pdfPath': { pages: [...], timestamp: Date } }
const pdfPageCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get a specific page from PDF as an image (with caching)
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
    
    // Check cache first
    const cacheKey = processPath;
    const cached = pdfPageCache.get(cacheKey);
    const now = Date.now();
    
    let imagePages;
    
    if (cached && (now - cached.timestamp < CACHE_TTL)) {
      console.log(`📦 Cache HIT: Using cached pages for ${path.basename(processPath)}`);
      imagePages = cached.pages;
    } else {
      console.log(`🔄 Cache MISS: Converting PDF pages for ${path.basename(processPath)}`);
      
      // Convert PDF to images (handles both local and remote URLs)
      imagePages = await convertPdfToImages(processPath);
      
      // Store in cache
      pdfPageCache.set(cacheKey, {
        pages: imagePages,
        timestamp: now
      });
      
      console.log(`✅ Cached ${imagePages.length} pages for ${path.basename(processPath)}`);
    }
    
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

/**
 * Clear cache for a specific PDF or all PDFs
 * @param {string} pdfPath - Optional path to clear specific PDF
 */
function clearCache(pdfPath = null) {
  if (pdfPath) {
    pdfPageCache.delete(pdfPath);
    console.log(`🗑️  Cleared cache for: ${pdfPath}`);
  } else {
    pdfPageCache.clear();
    console.log(`🗑️  Cleared all PDF page cache`);
  }
}

/**
 * Clean up expired cache entries
 */
function cleanExpiredCache() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, value] of pdfPageCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      pdfPageCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
  }
}

// Run cache cleanup every minute
setInterval(cleanExpiredCache, 60 * 1000);

module.exports = {
  getPdfPageImage,
  clearCache
};
