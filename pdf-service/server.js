
// PDF Rendering Microservice
// Runs on Render.com - supports native dependencies
// Converts PDFs to images and returns as base64

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

// Enable CORS for all origins (you can restrict this to your Vercel domain)
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'pdf-rendering-service' });
});

// Convert PDF to images endpoint
app.post('/convert-pdf', async (req, res) => {
  let tempPdfPath = null;
  
  try {
    const { pdfUrl, pdfBase64 } = req.body;
    
    if (!pdfUrl && !pdfBase64) {
      return res.status(400).json({ 
        error: 'Either pdfUrl or pdfBase64 is required' 
      });
    }
    
    // Download PDF if URL provided
    if (pdfUrl) {
      console.log('📥 Downloading PDF from:', pdfUrl);
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(pdfUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status}`);
      }
      
      const buffer = await response.buffer();
      tempPdfPath = path.join('/tmp', `pdf-${Date.now()}.pdf`);
      fs.writeFileSync(tempPdfPath, buffer);
    }
    // Or use base64 PDF
    else if (pdfBase64) {
      const buffer = Buffer.from(pdfBase64, 'base64');
      tempPdfPath = path.join('/tmp', `pdf-${Date.now()}.pdf`);
      fs.writeFileSync(tempPdfPath, buffer);
    }
    
    console.log('🖼️  Converting PDF to images...');
    
    // Dynamic import for ES module
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(tempPdfPath, { scale: 1.5 });
    
    const pageImages = [];
    let pageIndex = 1;
    
    for await (const page of document) {
      // Convert buffer to base64
      const base64Image = page.buffer.toString('base64');
      
      pageImages.push({
        pageNumber: pageIndex,
        base64: base64Image,
        mimeType: 'image/png',
        width: page.width,
        height: page.height
      });
      
      console.log(`   ✓ Page ${pageIndex} converted`);
      pageIndex++;
    }
    
    console.log(`✅ Converted ${pageImages.length} pages`);
    
    res.json({
      success: true,
      pages: pageImages.length,
      images: pageImages
    });
    
  } catch (error) {
    console.error('❌ PDF conversion error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    // Clean up temp file
    if (tempPdfPath && fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
      console.log('🗑️  Cleaned up temp PDF');
    }
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 PDF Rendering Service running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Convert endpoint: POST http://localhost:${PORT}/convert-pdf`);
});
