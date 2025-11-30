
// Cloudflare R2 Storage Service
// Uses AWS S3 SDK (R2 is S3-compatible)

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// R2 Configuration from environment variables
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '165a0e9c81c4be25b249c4f62349ff1d';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'e068185d52fc14cb0887e8deb7b82239';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '2af3a721dffc539ba492d3288c40401ab7e0997c1d9f29723ac00174cd9711ff';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'superrjump';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-417313423ce644cdb2c51a0382a19531.r2.dev';
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Initialize R2 client
const r2Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
    }
});

/**
 * Upload a file to R2
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Desired file name
 * @param {string} folder - Folder path (e.g., 'question-papers', 'answer-sheets')
 * @param {string} contentType - MIME type (default: application/pdf)
 * @returns {Promise<string>} - Public URL of uploaded file
 */
async function uploadFile(fileBuffer, fileName, folder = '', contentType = 'application/pdf') {
    try {
        // Generate unique file path
        const timestamp = Date.now();
        const sanitizedFileName = fileName.replace(/[^a-z0-9.-]/gi, '_');
        const key = folder ? `${folder}/${timestamp}-${sanitizedFileName}` : `${timestamp}-${sanitizedFileName}`;
        
        console.log(`📤 Uploading to R2: ${key}`);
        
        const command = new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: fileBuffer,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000' // Cache for 1 year
        });
        
        await r2Client.send(command);
        
        // Return public URL using the correct public domain
        const publicUrl = `${R2_PUBLIC_URL}/${key}`;
        
        console.log(`✅ Uploaded to R2: ${publicUrl}`);
        return publicUrl;
        
    } catch (error) {
        console.error('❌ R2 upload error:', error);
        throw new Error(`Failed to upload to R2: ${error.message}`);
    }
}

/**
 * Delete a file from R2
 * @param {string} fileUrl - Public URL of the file
 * @returns {Promise<boolean>} - Success status
 */
async function deleteFile(fileUrl) {
    try {
        // Extract key from URL
        const key = fileUrl.split('.r2.dev/')[1];
        if (!key) {
            throw new Error('Invalid R2 URL');
        }
        
        console.log(`🗑️  Deleting from R2: ${key}`);
        
        const command = new DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key
        });
        
        await r2Client.send(command);
        console.log(`✅ Deleted from R2: ${key}`);
        return true;
        
    } catch (error) {
        console.error('❌ R2 delete error:', error);
        return false;
    }
}

/**
 * Generate a presigned URL for temporary access (if needed for private files)
 * @param {string} key - File key in R2
 * @param {number} expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns {Promise<string>} - Presigned URL
 */
async function getPresignedUrl(key, expiresIn = 3600) {
    try {
        const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key
        });
        
        const url = await getSignedUrl(r2Client, command, { expiresIn });
        return url;
        
    } catch (error) {
        console.error('❌ Error generating presigned URL:', error);
        throw error;
    }
}

module.exports = {
    uploadFile,
    deleteFile,
    getPresignedUrl
};
