
const r2Storage = require('../services/r2Storage');

/**
 * Save uploaded answer sheet to Cloudflare R2
 * @param {Buffer} fileBuffer - File buffer
 * @param {number} assessmentId - Assessment ID
 * @param {string} fileName - Original file name
 * @returns {Promise<string>} - Public R2 URL
 */
async function saveAnswerSheet(fileBuffer, assessmentId, fileName) {
    try {
        console.log(`📤 Uploading answer sheet to R2: ${fileName}`);
        
        // Upload to R2 in answer-sheets folder
        const publicUrl = await r2Storage.uploadFile(
            fileBuffer,
            fileName,
            'answer-sheets',
            'application/pdf'
        );
        
        console.log(`✅ Answer sheet uploaded to R2: ${publicUrl}`);
        return publicUrl;
        
    } catch (error) {
        console.error('❌ Error saving answer sheet to R2:', error);
        throw new Error(`Failed to save answer sheet: ${error.message}`);
    }
}

/**
 * Delete answer sheet from Cloudflare R2
 * @param {string} fileUrl - R2 public URL
 */
async function deleteAnswerSheet(fileUrl) {
    try {
        if (!fileUrl) return;
        
        console.log(`🗑️  Deleting answer sheet from R2: ${fileUrl}`);
        await r2Storage.deleteFile(fileUrl);
        console.log(`✅ Answer sheet deleted from R2`);
        
    } catch (error) {
        console.error('❌ Error deleting answer sheet from R2:', error);
        // Don't throw - file might already be deleted
    }
}

module.exports = {
    saveAnswerSheet,
    deleteAnswerSheet
};
