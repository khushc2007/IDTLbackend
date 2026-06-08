# Water IQ Backend

Real-time greywater quality monitoring backend for the Water IQ dashboard. Collects sensor readings from ESP32 and provides RESTful API endpoints for the frontend.

## Features

✅ **Sensor Data Management**
- Store TDS, Turbidity, and pH readings
- Automatic status classification (STABLE/WARNING/CRITICAL)
- Statistics and aggregation endpoints

✅ **Pump Control**
- Remote pump control via REST API
- Real-time state tracking

✅ **Alert System**
- Automatic alert generation for out-of-range values
- Alert severity classification
- Query alerts by type and timeframe

✅ **Mock Data Generation**
- Realistic sensor data simulation for testing
- Seed database with historical readings

## API Endpoints

### Readings
- `GET /api/readings` - Get sensor readings (limit: 50 default, max 500)
- `GET /api/readings/stats` - Get statistics (supports ?hours=24)
- `POST /api/readings` - Add new reading

### Pump Control
- `GET /api/pump` - Get current pump state
- `POST /api/pump` - Control pump (action: on/off)

### Alerts
- `GET /api/alerts` - Get recent alerts (limit: 20 default, max 100)

### Utilities
- `GET /api/health` - Health check
- `POST /api/seed` - Seed mock data (count: 50 default, max 500)
- `GET /` - API documentation

## Quick Start (Local)

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Start development server
npm run dev

# Seed with mock data (in another terminal)
curl -X POST http://localhost:5000/api/seed -H "Content-Type: application/json" -d '{"count": 100}'

# View readings
curl http://localhost:5000/api/readings
```

## Render Deployment

### Step 1: Prepare Your GitHub Repository

1. Create a new GitHub repository named `water-iq-backend`
2. Push this code to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial Water IQ backend"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/water-iq-backend.git
   git push -u origin main
   ```

### Step 2: Deploy on Render

1. Go to [render.com](https://render.com) and sign up/log in
2. Click "New +" → "Web Service"
3. Select "Deploy an existing repository" and connect your GitHub
4. Choose `water-iq-backend` repository
5. Configure:
   - **Name**: `water-iq-backend` (or any name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free tier is fine for testing
   - **Environment Variables**: 
     - `NODE_ENV` = `production`
     - `PORT` = `5000` (or leave blank, Render sets this)
6. Click "Create Web Service"

### Step 3: Get Your Backend URL

After deployment, Render will give you a URL like:
```
https://water-iq-backend.onrender.com
```

This is your `RENDER_BACKEND_URL` for the frontend dashboard!

### Step 4: Test the Backend

```bash
# Replace with your actual Render URL
curl https://water-iq-backend.onrender.com/api/health

# Seed initial data
curl -X POST https://water-iq-backend.onrender.com/api/seed \
  -H "Content-Type: application/json" \
  -d '{"count": 100}'

# Get readings
curl https://water-iq-backend.onrender.com/api/readings
```

## ESP32 Integration

Send sensor readings from your ESP32 using this code:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";
const char* backendURL = "https://your-water-iq-backend.onrender.com/api/readings";

void sendReading(float tds, float turbidity, float ph) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(backendURL);
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"tds\":" + String(tds) + 
                     ",\"turbidity\":" + String(turbidity) + 
                     ",\"ph\":" + String(ph) + "}";

    int httpResponseCode = http.POST(payload);
    Serial.println("Response: " + String(httpResponseCode));
    http.end();
  }
}
```

## Database Schema

SQLite database (`wateriq.db`) contains three tables:

### readings
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| timestamp | DATETIME | When reading was recorded |
| tds | REAL | Total Dissolved Solids (ppm) |
| turbidity | REAL | Turbidity (NTU) |
| ph | REAL | pH value |
| status | TEXT | STABLE/WARNING/CRITICAL |
| created_at | DATETIME | When record was created |

### pump_state
| Column | Type |
|--------|------|
| id | INTEGER |
| status | TEXT |
| last_updated | DATETIME |

### alerts
| Column | Type |
|--------|------|
| id | INTEGER |
| reading_id | INTEGER |
| alert_type | TEXT |
| message | TEXT |
| severity | TEXT |
| created_at | DATETIME |

## Dashboard Integration

In your Water IQ Next.js dashboard, configure the backend URL:

```typescript
const BACKEND_URL = process.env.NEXT_PUBLIC_WATER_IQ_BACKEND || 
                    'https://water-iq-backend.onrender.com';

// Fetch readings
const response = await fetch(`${BACKEND_URL}/api/readings?limit=20`);
const data = await response.json();
```

## Thresholds & Alert Values

Current alert thresholds:
- **TDS**: > 1200 ppm → WARNING, > 1500 ppm → CRITICAL
- **Turbidity**: > 5 NTU → WARNING, > 7 NTU → CRITICAL
- **pH**: < 6.5 or > 8.5 → WARNING, < 6 or > 9 → CRITICAL

(Customize in `server.js` `generateReading()` and alert logic)

## Monitoring

Check Render dashboard for:
- Memory usage
- CPU usage
- Logs
- Network activity

Free tier limits:
- 0.5 GB RAM
- 0.5 CPU
- Auto-sleeps after 15 minutes of inactivity

For production, upgrade to Starter plan.

## Troubleshooting

### "Cannot find module 'better-sqlite3'"
```bash
npm install --build-from-source
```

### Database locked error
- Multiple instances writing simultaneously
- Solution: Use Render's built-in PostgreSQL (upgrade plan) for production

### Readings not persisting
- Check Render logs: `View Logs` in dashboard
- Ensure `data/` directory exists and is writable

### Render app keeps sleeping
- Upgrade to Starter plan (prevents auto-sleep)
- Or access `/api/health` every 14 minutes to keep it warm

## License

MIT
