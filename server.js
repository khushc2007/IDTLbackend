import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Get directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'data', 'wateriq.db');
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    tds REAL,
    turbidity REAL,
    ph REAL,
    status TEXT DEFAULT 'STABLE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pump_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'OFF',
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reading_id INTEGER,
    alert_type TEXT,
    message TEXT,
    severity TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reading_id) REFERENCES readings(id)
  );
`);

// Seed initial pump state if empty
const pumpCount = db.prepare('SELECT COUNT(*) as count FROM pump_state').get();
if (pumpCount.count === 0) {
  db.prepare('INSERT INTO pump_state (status) VALUES (?)').run('OFF');
}

// Function to generate realistic sensor data
function generateReading() {
  // TDS: typically 0-2000 ppm, baseline around 400-600
  const tds = 300 + Math.random() * 400 + Math.sin(Date.now() / 10000) * 100;
  
  // Turbidity: 0-10 NTU typically, baseline 2-4
  const turbidity = 2 + Math.random() * 3 + Math.cos(Date.now() / 15000) * 1;
  
  // pH: 6.5-8.5 range, baseline 7.0-7.5
  const ph = 7.0 + Math.random() * 1 + Math.sin(Date.now() / 12000) * 0.3;

  // Determine status based on values
  let status = 'STABLE';
  if (tds > 1200 || turbidity > 5 || ph < 6.5 || ph > 8.5) {
    status = 'WARNING';
  }
  if (tds > 1500 || turbidity > 7 || ph < 6 || ph > 9) {
    status = 'CRITICAL';
  }

  return {
    tds: parseFloat(tds.toFixed(2)),
    turbidity: parseFloat(turbidity.toFixed(2)),
    ph: parseFloat(ph.toFixed(2)),
    status,
  };
}

// Routes

// GET /api/readings - Get sensor readings (with optional limit)
app.get('/api/readings', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const readings = db.prepare(`
      SELECT id, timestamp, tds, turbidity, ph, status, created_at
      FROM readings
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);

    res.json({
      success: true,
      count: readings.length,
      data: readings,
    });
  } catch (error) {
    console.error('Error fetching readings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/readings/stats - Get statistics
app.get('/api/readings/stats', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const stats = db.prepare(`
      SELECT 
        AVG(tds) as avg_tds,
        AVG(turbidity) as avg_turbidity,
        AVG(ph) as avg_ph,
        MIN(tds) as min_tds,
        MAX(tds) as max_tds,
        MIN(turbidity) as min_turbidity,
        MAX(turbidity) as max_turbidity,
        MIN(ph) as min_ph,
        MAX(ph) as max_ph,
        COUNT(*) as total_readings
      FROM readings
      WHERE created_at > datetime('now', ? || ' hours')
    `).get(-hours);

    res.json({
      success: true,
      hours,
      data: {
        avg_tds: parseFloat(stats.avg_tds?.toFixed(2)) || 0,
        avg_turbidity: parseFloat(stats.avg_turbidity?.toFixed(2)) || 0,
        avg_ph: parseFloat(stats.avg_ph?.toFixed(2)) || 0,
        min_tds: stats.min_tds || 0,
        max_tds: stats.max_tds || 0,
        min_turbidity: stats.min_turbidity || 0,
        max_turbidity: stats.max_turbidity || 0,
        min_ph: stats.min_ph || 0,
        max_ph: stats.max_ph || 0,
        total_readings: stats.total_readings || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/readings - Add a new sensor reading (from ESP32 or mock)
app.post('/api/readings', (req, res) => {
  try {
    const { tds, turbidity, ph, status } = req.body;

    // Validate required fields
    if (tds === undefined || turbidity === undefined || ph === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: tds, turbidity, ph',
      });
    }

    // Insert reading
    const stmt = db.prepare(`
      INSERT INTO readings (tds, turbidity, ph, status)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(tds, turbidity, ph, status || 'STABLE');

    // Check for alerts
    const reading_id = result.lastInsertRowid;
    if (tds > 1200 || turbidity > 5 || ph < 6.5 || ph > 8.5) {
      const alertStmt = db.prepare(`
        INSERT INTO alerts (reading_id, alert_type, message, severity)
        VALUES (?, ?, ?, ?)
      `);
      
      if (tds > 1200) {
        alertStmt.run(reading_id, 'HIGH_TDS', `TDS level high: ${tds} ppm`, 'WARNING');
      }
      if (turbidity > 5) {
        alertStmt.run(reading_id, 'HIGH_TURBIDITY', `Turbidity high: ${turbidity} NTU`, 'WARNING');
      }
      if (ph < 6.5 || ph > 8.5) {
        alertStmt.run(reading_id, 'PH_OUT_OF_RANGE', `pH out of range: ${ph}`, 'WARNING');
      }
    }

    res.status(201).json({
      success: true,
      message: 'Reading saved successfully',
      id: reading_id,
    });
  } catch (error) {
    console.error('Error saving reading:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/pump - Get current pump state
app.get('/api/pump', (req, res) => {
  try {
    const pumpState = db.prepare('SELECT status, last_updated FROM pump_state LIMIT 1').get();
    res.json({
      success: true,
      data: pumpState,
    });
  } catch (error) {
    console.error('Error fetching pump state:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/pump - Control pump (ON/OFF)
app.post('/api/pump', (req, res) => {
  try {
    const { action } = req.body;

    if (!action || !['on', 'off'].includes(action.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Use "on" or "off"',
      });
    }

    const status = action.toUpperCase();
    const stmt = db.prepare('UPDATE pump_state SET status = ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1');
    stmt.run(status);

    res.json({
      success: true,
      message: `Pump turned ${status}`,
      status,
    });
  } catch (error) {
    console.error('Error controlling pump:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/alerts - Get recent alerts
app.get('/api/alerts', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const alerts = db.prepare(`
      SELECT * FROM alerts
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);

    res.json({
      success: true,
      count: alerts.length,
      data: alerts,
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/seed - Seed database with mock data (for testing)
app.post('/api/seed', (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 50, 500);
    const stmt = db.prepare('INSERT INTO readings (tds, turbidity, ph, status) VALUES (?, ?, ?, ?)');

    for (let i = 0; i < count; i++) {
      const reading = generateReading();
      // Stagger timestamps
      const pastTime = new Date(Date.now() - i * 60000); // 1 min intervals
      const timestampStr = pastTime.toISOString();
      
      db.prepare(`
        INSERT INTO readings (tds, turbidity, ph, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(reading.tds, reading.turbidity, reading.ph, reading.status, timestampStr);
    }

    res.json({
      success: true,
      message: `Seeded ${count} mock readings`,
      count,
    });
  } catch (error) {
    console.error('Error seeding data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/health - Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Water IQ Backend is running',
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Water IQ Backend',
    version: '1.0.0',
    endpoints: {
      readings: 'GET /api/readings',
      readingsStats: 'GET /api/readings/stats',
      addReading: 'POST /api/readings',
      pumpStatus: 'GET /api/pump',
      pumpControl: 'POST /api/pump',
      alerts: 'GET /api/alerts',
      seedData: 'POST /api/seed',
      health: 'GET /api/health',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🌊 Water IQ Backend running on port ${PORT}`);
  console.log(`📊 API docs available at http://localhost:${PORT}/`);
});
