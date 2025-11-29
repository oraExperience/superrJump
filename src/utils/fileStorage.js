
const fs = require('fs').promises;
const path = require('path');

/**
 * Save uploaded file to local uploads directory
 * Similar to how question papers are stored
 */
async function saveAnswerSheet(fileBuffer, assessmentId, fileName) {
    try {
        // Create uploads directory if it doesn't exist
        const uploadsDir = path.join(__dirname, '../../uploads/answer-sheets');
        await fs.mkdir(uploadsDir, { recursive: true });

        // Generate unique filename
        const timestamp = Date.now();
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const finalFileName = `assessment_${assessmentId}_${timestamp}_${sanitizedName}`;
        const filePath = path.join(uploadsDir, finalFileName);

        // Save file
        await fs.writeFile(filePath, fileBuffer);

        // Return relative path for storage in database
        return `/uploads/answer-sheets/${finalFileName}`;

    } catch (error) {
        console.error('Error saving answer sheet:', error);
        throw new Error('Failed to save answer sheet locally');
    }
}

/**
 * Delete answer sheet file
 */
async function deleteAnswerSheet(filePath) {
    try {
        const fullPath = path.join(__dirname, '../..', filePath);
        await fs.unlink(fullPath);
    } catch (error) {
        console.error('Error deleting answer sheet:', error);
        // Don't throw - file might already be deleted
    }
}

module.exports = {
    saveAnswerSheet,
    deleteAnswerSheet
};
