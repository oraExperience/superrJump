
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/**
 * Google Drive Service for uploading assessment PDFs
 * Uses service account for authentication (FREE)
 */

class GoogleDriveService {
  constructor() {
    this.drive = null;
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '1w0UnK4vkEIaaIqqEWHidJUtw8fLlEJvR';
    this.credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
  }

  /**
   * Initialize Google Drive client with service account
   */
  async initialize() {
    try {
      // Check if credentials file exists
      if (!fs.existsSync(this.credentialsPath)) {
        console.warn('⚠️ Google credentials not found. Drive upload will be disabled.');
        return false;
      }

      // Load service account credentials
      const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));

      // Create OAuth2 client
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file']
      });

      // Initialize Drive API
      this.drive = google.drive({ version: 'v3', auth });

      console.log('✅ Google Drive service initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Google Drive:', error.message);
      return false;
    }
  }

  /**
   * Upload PDF file to Google Drive
   * @param {string} filePath - Local path to PDF file
   * @param {object} metadata - Assessment metadata
   * @returns {Promise<string>} - Google Drive shareable link
   */
  async uploadPDF(filePath, metadata = {}) {
    try {
      // Initialize if not already done
      if (!this.drive) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Google Drive not configured');
        }
      }

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const sanitizedTitle = (metadata.title || 'Assessment')
        .replace(/[^a-z0-9]/gi, '_')
        .substring(0, 50);
      const filename = `Assessment_${metadata.id || 'new'}_${sanitizedTitle}_${timestamp}.pdf`;

      console.log(`📤 Uploading to Google Drive: ${filename}`);

      // Upload file to Drive
      const fileMetadata = {
        name: filename,
        parents: [this.folderId]
      };

      const media = {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath)
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink, webContentLink',
        supportsAllDrives: true  // Support both regular folders and Shared Drives
      });

      const fileId = response.data.id;

      // Make file publicly readable
      await this.drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        },
        supportsAllDrives: true  // Support both regular folders and Shared Drives
      });

      // Get shareable link
      const file = await this.drive.files.get({
        fileId: fileId,
        fields: 'webViewLink, webContentLink'
      });

      const driveLink = file.data.webViewLink;

      console.log(`✅ Uploaded successfully: ${driveLink}`);

      // Clean up local file
      try {
        fs.unlinkSync(filePath);
        console.log('🗑️ Cleaned up temporary file');
      } catch (err) {
        console.warn('Warning: Could not delete temp file:', err.message);
      }

      return driveLink;

    } catch (error) {
      console.error('❌ Error uploading to Google Drive:', error);
      throw new Error(`Failed to upload PDF: ${error.message}`);
    }
  }

  /**
   * Delete file from Google Drive
   * @param {string} fileId - Google Drive file ID
   */
  async deleteFile(fileId) {
    try {
      if (!this.drive) {
        await this.initialize();
      }

      await this.drive.files.delete({
        fileId: fileId,
        supportsAllDrives: true  // Support both regular folders and Shared Drives
      });

      console.log(`🗑️ Deleted file from Drive: ${fileId}`);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  /**
   * Extract file ID from Google Drive link
   * @param {string} driveLink - Google Drive URL
   * @returns {string|null} - File ID or null
   */
  extractFileId(driveLink) {
    try {
      const match = driveLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get direct download link from Drive link
   * @param {string} driveLink - Google Drive view link
   * @returns {string} - Direct download link for AI processing
   */
  getDirectDownloadLink(driveLink) {
    const fileId = this.extractFileId(driveLink);
    if (!fileId) {
      return driveLink; // Return original if can't extract
    }
    // Return direct download link that AI can use
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }
}

// Export singleton instance
module.exports = new GoogleDriveService();
