
# Deploy PDF Rendering Service to Render.com

## Overview

Your SuperrJump app now uses a **hybrid architecture**:
- **Frontend + API**: Vercel (serverless)
- **PDF Processing**: Render.com (supports native dependencies)

## Step-by-Step Deployment

### 1. Push to GitHub

```bash
git add pdf-service/ src/services/pdfImageServiceRemote.js src/services/aiService.js src/services/pdfPageService.js DEPLOY_RENDER_PDF_SERVICE.md
git commit -m "Add PDF rendering microservice for Render.com deployment"
git push origin main
```

### 2. Create Render.com Account

1. Go to https://render.com
2. Sign up (free tier available)
3. Connect your GitHub account

### 3. Deploy PDF Service

1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Configure:
   - **Name**: `superrjump-pdf-service` (or your choice)
   - **Root Directory**: `pdf-service`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (750 hours/month)

4. Click **"Create Web Service"**

Render will automatically build and deploy. You'll get a URL like:
```
https://superrjump-pdf-service.onrender.com
```

### 4. Test Your Service

Once deployed, test the health endpoint:

```bash
curl https://superrjump-pdf-service.onrender.com/health
```

Should return:
```json
{"status":"ok","service":"pdf-rendering-service"}
```

### 5. Configure Vercel

Add environment variable to your Vercel project:

**In Vercel Dashboard:**
1. Go to your project → Settings → Environment Variables
2. Add new variable:
   - **Name**: `PDF_SERVICE_URL`
   - **Value**: `https://superrjump-pdf-service.onrender.com`
   - **Environment**: Production

3. Redeploy Vercel app to pick up the new variable

### 6. Update .env for Local Development

Add to your local `.env`:

```env
# Leave empty for local development (uses local pdf-to-img)
# PDF_SERVICE_URL=

# Or point to Render service for testing:
# PDF_SERVICE_URL=https://superrjump-pdf-service.onrender.com
```

## How It Works

### Local Development
```
Your App → pdfImageServiceRemote.js → pdf-to-img (local)
```
- Uses local PDF conversion
- No external service needed
- Fast and free

### Production (Vercel)
```
Your App → pdfImageServiceRemote.js → Render.com Service → Returns Images
```
- Vercel calls Render.com API
- Render converts PDF to images
- Returns base64 images
- Vercel processes them

## Architecture Benefits

✅ **Works everywhere**: Local, Vercel, any platform
✅ **No native dependency issues**: Render handles the heavy lifting
✅ **Free tier**: 750 hours/month on Render
✅ **Auto-scaling**: Both platforms scale automatically
✅ **Zero downtime**: Services are independent

## Monitoring

### Render Dashboard
- View logs: https://dashboard.render.com
- Monitor CPU/Memory usage
- Check request counts

### Performance Notes
- First request after sleep: ~30 seconds (Render wakes up)
- Subsequent requests: <1 second
- To avoid sleep: Upgrade to paid plan ($7/month) for always-on

## Cost Estimate

| Service | Plan | Cost |
|---------|------|------|
| Vercel | Hobby | Free |
| Render | Free | Free |
| **Total** | | **$0/month** |

For production:
| Service | Plan | Cost |
|---------|------|------|
| Vercel | Pro | $20/month |
| Render | Starter | $7/month |
| **Total** | | **$27/month** |

## Troubleshooting

### Issue: 504 Timeout
**Cause**: Render service is sleeping (free tier)
**Solution**: First request wakes it up (~30s), retry after

### Issue: CORS Error
**Cause**: Render service blocking your domain
**Solution**: Update `pdf-service/server.js` CORS config

### Issue: Service Not Found
**Cause**: Wrong PDF_SERVICE_URL
**Solution**: Verify URL in Vercel environment variables

## Security Enhancements (Optional)

### Add API Key Auth

In `pdf-service/server.js`:
```javascript
const API_KEY = process.env.API_KEY;

app.use((req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

Then set `API_KEY` in both Render and Vercel environment variables.

## Support

If you encounter issues:
1. Check Render logs
2. Check Vercel logs
3. Test health endpoint
4. Verify environment variables

## Success Checklist

- [ ] PDF service deployed to Render.com
- [ ] Health endpoint responds
- [ ] PDF_SERVICE_URL added to Vercel
- [ ] Vercel app redeployed
- [ ] Test: Upload question paper PDF
- [ ] Verify: AI extraction works
- [ ] Monitor: Check Render logs for requests

Your app is now production-ready with full PDF processing support! 🎉
