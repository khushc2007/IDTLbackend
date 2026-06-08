# Deploy Water IQ Backend to Render (5 Minutes)

## Prerequisites
- GitHub account
- Render account (free)
- This repository code

## Step-by-Step

### 1️⃣ Push to GitHub

```bash
# In the water-iq-backend directory
git init
git add .
git commit -m "Initial Water IQ backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/water-iq-backend.git
git push -u origin main
```

### 2️⃣ Create Render Account
- Go to [render.com](https://render.com)
- Sign up (free)
- Connect your GitHub account

### 3️⃣ Deploy on Render

1. In Render dashboard, click **"New +"** → **"Web Service"**
2. Select your **water-iq-backend** repository
3. Fill in:
   ```
   Name: water-iq-backend
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   Plan: Free
   ```
4. Click **"Create Web Service"**
5. Wait 2-3 minutes for deployment

### 4️⃣ Get Your Backend URL

Once deployed, you'll see:
```
Service URL: https://water-iq-backend-xxxx.onrender.com
```

**Copy this URL** — this is what you'll use in your Water IQ dashboard!

### 5️⃣ Verify It's Working

```bash
# Replace with your actual URL
curl https://water-iq-backend-xxxx.onrender.com/api/health
```

Should return:
```json
{
  "success": true,
  "message": "Water IQ Backend is running",
  "timestamp": "2025-06-08T14:30:45.123Z"
}
```

## Seed Initial Data (Optional)

Once deployed, seed the database with 100 mock readings:

```bash
curl -X POST https://water-iq-backend-xxxx.onrender.com/api/seed \
  -H "Content-Type: application/json" \
  -d '{"count": 100}'
```

Then check:
```bash
curl https://water-iq-backend-xxxx.onrender.com/api/readings
```

## Connect to Dashboard

In your Water IQ dashboard (v0 prompt), use:
```
RENDER_BACKEND_URL: https://water-iq-backend-xxxx.onrender.com
```

## Important Notes

⚠️ **Free tier limitations:**
- Service sleeps after 15 min of inactivity (auto-wakes on request)
- 0.5 GB RAM
- Database persists but watch storage

✅ **To prevent sleep:**
- Upgrade to Starter plan ($7/month)
- Or keep dashboard open (makes periodic requests)

## Troubleshooting

**"Build failed"**
- Check logs in Render dashboard
- Ensure `package.json` and `server.js` are in root directory

**"Cannot find module"**
- Clear build cache in Render settings
- Redeploy

**Database locked**
- Should not happen on free tier (single instance)
- Restart service if needed

## Next Steps

1. ✅ Backend deployed
2. ⬜ Update v0 prompt with backend URL
3. ⬜ Deploy Water IQ dashboard to Vercel
4. ⬜ Connect ESP32 to `/api/readings` endpoint

---

**Need help?** Check the main README.md for detailed docs and ESP32 integration code.
