
# PDF Rendering Microservice

A lightweight Node.js service for converting PDFs to images. Designed to run on Render.com where native dependencies are supported.

## Why This Service?

Vercel serverless functions don't support native binaries required for PDF-to-image conversion (like `canvas`, `cairo`, `pango`). This microservice runs on Render.com which supports these dependencies.

## Setup on Render.com

### 1. Create New Web Service

1. Go to [Render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Set root directory to: `pdf-service`

### 2. Configure Build Settings

- **Environment**: Node
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: Free (sufficient for low traffic)

### 3. Deploy

Render will automatically deploy. You'll get a URL like:
```
https://your-service-name.onrender.com
```

## Environment Variables

Add to your main Vercel app:

```env
PDF_SERVICE_URL=https://your-service-name.onrender.com
```

## API Endpoints

### Health Check
```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "service": "pdf-rendering-service"
}
```

### Convert PDF to Images
```bash
POST /convert-pdf
Content-Type: application/json

{
  "pdfUrl": "https://example.com/document.pdf"
}

# OR

{
  "pdfBase64": "JVBERi0xLjQK..."
}
```

Response:
```json
{
  "success": true,
  "pages": 3,
  "images": [
    {
      "pageNumber": 1,
      "base64": "iVBORw0KGgoAAAANS...",
      "mimeType": "image/png",
      "width": 1240,
      "height": 1754
    }
  ]
}
```

## Local Testing

```bash
cd pdf-service
npm install
npm start
```

Test with curl:
```bash
curl -X POST http://localhost:3001/convert-pdf \
  -H "Content-Type: application/json" \
  -d '{"pdfUrl":"https://example.com/sample.pdf"}'
```

## Cost

- Render.com free tier: 750 hours/month
- Perfect for low-moderate traffic
- Auto-sleeps after inactivity (wakes up in ~30s on first request)

## Security Notes

- Add CORS restrictions in production (whitelist your Vercel domain)
- Consider adding API key authentication for production use
- Limit file size to prevent abuse (currently 50MB limit)
