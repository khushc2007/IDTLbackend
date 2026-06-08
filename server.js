import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'data', 'wateriq.db');

// Middleware
app.use(cors());
app.use(express.json());

let db = null;
let SQL = null;

// Initialize database
async function initializeDatabase() {
  SQL = await initSqlJs();
  
  let data;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }
  
  db = new SQL.Database(data);

  // Create tables if they don't exist
  db.run(`
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

  // Initialize pump state if empty
  const pumpResult = db.exec('SELECT COUNT(*) as count FROM pump_state');
  if (!pumpResult.length || pumpResult[0].values[0][0] === 0) {
    db.run('INSERT INTO pump_state (status) VALUES (?)', ['OFF']);
  }

  saveDatabase();
}

// Save database to file
function saveDatabase() {
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Helper to run queries and get results
function getQueryResults(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Function to generate realistic sensor data
function generateReading() {
  const tds = 300 + Math.random() * 400 + Math.sin(Date.now() / 10000) * 100;
  const turbidity = 2 + Math.random() * 3 + Math.cos(Date.now() / 15000) * 1;
  const ph = 7.0 + Math.random() * 1 + Math.sin(Date.now() / 12000) * 0.3;

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

// GET /api/readings - Get sensor readings
app.get('/api/readings', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const readings = getQueryResults(`
      SELECT id, timestamp, tds, turbidity, ph, status, created_at
      FROM readings
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit]);

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
    
    // For sql.js, we need to do a simpler approach
    const readings = getQueryResults(`
      SELECT tds, turbidity, ph
      FROM readings
      ORDER BY created_at DESC
      LIMIT 1000
    `);

    if (readings.length === 0) {
      return res.json({
        success: true,
        hours,
        data: {
          avg_tds: 0,
          avg_turbidity: 0,
          avg_ph: 0,
          min_tds: 0,
          max_tds: 0,
          min_turbidity: 0,
          max_turbidity: 0,
          min_ph: 0,
          max_ph: 0,
          total_readings: 0,
        },
      });
    }

    const stats = {
      avg_tds: readings.reduce((a, r) => a + r.tds, 0) / readings.length,
      avg_turbidity: readings.reduce((a, r) => a + r.turbidity, 0) / readings.length,
      avg_ph: readings.reduce((a, r) => a + r.ph, 0) / readings.length,
      min_tds: Math.min(...readings.map(r => r.tds)),
      max_tds: Math.max(...readings.map(r => r.tds)),
      min_turbidity: Math.min(...readings.map(r => r.turbidity)),
      max_turbidity: Math.max(...readings.map(r => r.turbidity)),
      min_ph: Math.min(...readings.map(r => r.ph)),
      max_ph: Math.max(...readings.map(r => r.ph)),
      total_readings: readings.length,
    };

    res.json({
      success: true,
      hours,
      data: {
        avg_tds: parseFloat(stats.avg_tds.toFixed(2)),
        avg_turbidity: parseFloat(stats.avg_turbidity.toFixed(2)),
        avg_ph: parseFloat(stats.avg_ph.toFixed(2)),
        min_tds: parseFloat(stats.min_tds.toFixed(2)),
        max_tds: parseFloat(stats.max_tds.toFixed(2)),
        min_turbidity: parseFloat(stats.min_turbidity.toFixed(2)),
        max_turbidity: parseFloat(stats.max_turbidity.toFixed(2)),
        min_ph: parseFloat(stats.min_ph.toFixed(2)),
        max_ph: parseFloat(stats.max_ph.toFixed(2)),
        total_readings: stats.total_readings,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/readings - Add a new sensor reading
app.post('/api/readings', (req, res) => {
  try {
    const { tds, turbidity, ph, status } = req.body;

    if (tds === undefined || turbidity === undefined || ph === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: tds, turbidity, ph',
      });
    }

    const stmt = db.prepare(`
      INSERT INTO readings (tds, turbidity, ph, status)
      VALUES (?, ?, ?, ?)
    `);
    stmt.bind([tds, turbidity, ph, status || 'STABLE']);
    stmt.step();
    stmt.free();
    
    saveDatabase();

    res.status(201).json({
      success: true,
      message: 'Reading saved successfully',
    });
  } catch (error) {
    console.error('Error saving reading:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/pump - Get current pump state
app.get('/api/pump', (req, res) => {
  try {
    const pumpState = getQueryResults('SELECT status, last_updated FROM pump_state LIMIT 1');
    res.json({
      success: true,
      data: pumpState[0] || { status: 'OFF' },
    });
  } catch (error) {
    console.error('Error fetching pump state:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/pump - Control pump
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
    stmt.bind([status]);
    stmt.step();
    stmt.free();
    
    saveDatabase();

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
    const alerts = getQueryResults(`
      SELECT * FROM alerts
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit]);

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

// POST /api/seed - Seed database with mock data
app.post('/api/seed', (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 50, 500);
    const stmt = db.prepare('INSERT INTO readings (tds, turbidity, ph, status, created_at) VALUES (?, ?, ?, ?, ?)');

    for (let i = 0; i < count; i++) {
      const reading = generateReading();
      const pastTime = new Date(Date.now() - i * 60000);
      const timestampStr = pastTime.toISOString();
      
      stmt.bind([reading.tds, reading.turbidity, reading.ph, reading.status, timestampStr]);
      stmt.step();
      stmt.reset();
    }
    stmt.free();

    saveDatabase();

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
    database: 'sql.js (in-memory with file persistence)',
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
async function start() {
  try {
    await initializeDatabase();
    console.log('✅ Database initialized');
    
    app.listen(PORT, () => {
      console.log(`🌊 Water IQ Backend running on port ${PORT}`);
      console.log(`📊 API docs available at http://localhost:${PORT}/`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
