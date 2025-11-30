
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

/**
 * Proxy endpoint to serve PDFs from R2 with proper CORS headers
 * GET /api/proxy/pdf?url=<encoded_r2_url>
 */
router.get('/pdf', async (req, res) => {
    try {
        const pdfUrl = req.query.url;
        
        if (!pdfUrl) {
            return res.status(400).json({ error: 'PDF URL is required' });
        }
        
        // Validate it's an R2 URL
        if (!pdfUrl.includes('r2.dev')) {
            return res.status(400).json({ error: 'Invalid PDF URL' });
        }
        
        console.log('📥 Proxying PDF from R2:', pdfUrl);
        
        // Fetch PDF from R2
        const response = await fetch(pdfUrl);
        
        if (!response.ok) {
            throw new Error(`R2 fetch failed: ${response.status}`);
        }
        
        // Get the PDF buffer
        const pdfBuffer = await response.buffer();
        
        // Set proper headers
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': pdfBuffer.length,
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        
        // Send the PDF
        res.send(pdfBuffer);
        
        console.log('✅ PDF proxied successfully:', pdfBuffer.length, 'bytes');
        
    } catch (error) {
        console.error('❌ Error proxying PDF:', error);
        res.status(500).json({ error: 'Failed to fetch PDF: ' + error.message });
    }
});

module.exports = router;
