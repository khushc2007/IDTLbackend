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

app.use(cors());
app.use(express.json());

let db = null;
let SQL = null;

// ─── FILTRATION BRACKET REFERENCE ────────────────────────────────────────────
//  F1  turbidity ≤ 10 NTU,  tds < 1000 ppm  →  Sediment + Carbon  →  Route to reuse
//  F2  turbidity 10–30 NTU, tds < 1000 ppm  →  Sand + Carbon      →  Route to reuse
//  F3  turbidity > 30 NTU,  tds < 1000 ppm  →  Coagulation + Sand →  Treat further
//  F4  any turbidity,        tds 1000–1500   →  Advanced treatment →  Discard recommended
//  F5  any turbidity,        tds > 1500      →  RO / Disposal      →  Hard discard
// ─────────────────────────────────────────────────────────────────────────────

const BRACKETS = {
  F1: { label: 'F1', turbidityRange: '≤ 10 NTU',   tdsRange: '< 1000 ppm',    method: 'Sediment + Carbon', outcome: 'Route to reuse',      severity: 'safe'     },
  F2: { label: 'F2', turbidityRange: '10–30 NTU',  tdsRange: '< 1000 ppm',    method: 'Sand + Carbon',     outcome: 'Route to reuse',      severity: 'safe'     },
  F3: { label: 'F3', turbidityRange: '> 30 NTU',   tdsRange: '< 1000 ppm',    method: 'Coagulation + Sand',outcome: 'Treat further',       severity: 'warning'  },
  F4: { label: 'F4', turbidityRange: '—',           tdsRange: '1000–1500 ppm', method: 'Advanced treatment',outcome: 'Discard recommended', severity: 'danger'   },
  F5: { label: 'F5', turbidityRange: '—',           tdsRange: '> 1500 ppm',    method: 'RO / Disposal',     outcome: 'Hard discard',        severity: 'critical' },
};

function classifyBracket(tds, turbidity) {
  if (tds > 1500)                         return BRACKETS.F5;
  if (tds >= 1000 && tds <= 1500)         return BRACKETS.F4;
  if (turbidity > 30)                     return BRACKETS.F3;
  if (turbidity >= 10 && turbidity <= 30) return BRACKETS.F2;
  return BRACKETS.F1;
}

function deriveStatus(bracket) {
  if (bracket.severity === 'warning')                                return 'WARNING';
  if (bracket.severity === 'danger' || bracket.severity === 'critical') return 'CRITICAL';
  return 'STABLE';
}

// ─── DATABASE ─────────────────────────────────────────────────────────────────

async function initializeDatabase() {
  SQL = await initSqlJs();

  let data;
  if (fs.existsSync(dbPath)) {
    data = fs.readFileSync(dbPath);
  }

  db = new SQL.Database(data);

  db.run(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      tds REAL,
      turbidity REAL,
      ph REAL,
      status TEXT DEFAULT 'STABLE',
      bracket TEXT DEFAULT 'F1',
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

  // Add bracket column if upgrading from old schema
  try {
    db.run('ALTER TABLE readings ADD COLUMN bracket TEXT DEFAULT "F1"');
  } catch (_) { /* column already exists */ }

  const pumpResult = db.exec('SELECT COUNT(*) as count FROM pump_state');
  if (!pumpResult.length || pumpResult[0].values[0][0] === 0) {
    db.run('INSERT INTO pump_state (status) VALUES (?)', ['OFF']);
  }

  saveDatabase();
}

function saveDatabase() {
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function getQueryResults(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

// ─── SIMULATION ───────────────────────────────────────────────────────────────

function generateReading() {
  const t = Date.now();
  const tds       = parseFloat((400  + Math.random() * 1300 + Math.sin(t / 10000) * 200).toFixed(2));
  const turbidity = parseFloat((2    + Math.random() * 45   + Math.cos(t / 15000) * 5  ).toFixed(2));
  const ph        = parseFloat((6.8  + Math.random() * 1.5  + Math.sin(t / 12000) * 0.4).toFixed(2));
  const bracket   = classifyBracket(tds, turbidity);
  return { tds, turbidity, ph, status: deriveStatus(bracket), bracket: bracket.label };
}

function insertReading({ tds, turbidity, ph, status, bracket }) {
  const stmt = db.prepare(
    'INSERT INTO readings (tds, turbidity, ph, status, bracket) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.bind([tds, turbidity, ph, status, bracket]);
  stmt.step();
  stmt.free();
  saveDatabase();
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/live — latest reading with full bracket detail (poll every 1s)
app.get('/api/live', (req, res) => {
  try {
    const rows = getQueryResults(
      'SELECT * FROM readings ORDER BY created_at DESC LIMIT 1'
    );
    if (!rows.length) return res.json({ success: true, data: null });

    const row = rows[0];
    const bracketKey = row.bracket || 'F1';
    res.json({
      success: true,
      data: {
        ...row,
        bracketDetail: BRACKETS[bracketKey] ?? BRACKETS.F1,
        allBrackets: BRACKETS,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/readings
app.get('/api/readings', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const readings = getQueryResults(
      'SELECT id, timestamp, tds, turbidity, ph, status, bracket, created_at FROM readings ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    res.json({ success: true, count: readings.length, data: readings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/readings/stats
app.get('/api/readings/stats', (req, res) => {
  try {
    const readings = getQueryResults(
      'SELECT tds, turbidity, ph FROM readings ORDER BY created_at DESC LIMIT 1000'
    );

    if (!readings.length) {
      return res.json({
        success: true,
        data: {
          avg_tds: 0, avg_turbidity: 0, avg_ph: 0,
          min_tds: 0, max_tds: 0,
          min_turbidity: 0, max_turbidity: 0,
          min_ph: 0, max_ph: 0,
          total_readings: 0,
        },
      });
    }

    const avg = (arr, key) => arr.reduce((a, r) => a + r[key], 0) / arr.length;
    const toF = n => parseFloat(n.toFixed(2));

    res.json({
      success: true,
      data: {
        avg_tds:        toF(avg(readings, 'tds')),
        avg_turbidity:  toF(avg(readings, 'turbidity')),
        avg_ph:         toF(avg(readings, 'ph')),
        min_tds:        toF(Math.min(...readings.map(r => r.tds))),
        max_tds:        toF(Math.max(...readings.map(r => r.tds))),
        min_turbidity:  toF(Math.min(...readings.map(r => r.turbidity))),
        max_turbidity:  toF(Math.max(...readings.map(r => r.turbidity))),
        min_ph:         toF(Math.min(...readings.map(r => r.ph))),
        max_ph:         toF(Math.max(...readings.map(r => r.ph))),
        total_readings: readings.length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/readings — ESP32 posts here
app.post('/api/readings', (req, res) => {
  try {
    const { tds, turbidity, ph } = req.body;

    if (tds === undefined || turbidity === undefined || ph === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields: tds, turbidity, ph' });
    }

    const bracket = classifyBracket(parseFloat(tds), parseFloat(turbidity));
    const status  = deriveStatus(bracket);

    insertReading({ tds, turbidity, ph, status, bracket: bracket.label });

    res.status(201).json({
      success: true,
      message: 'Reading saved',
      bracket: bracket.label,
      method:  bracket.method,
      outcome: bracket.outcome,
      status,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/pump
app.get('/api/pump', (req, res) => {
  try {
    const pumpState = getQueryResults('SELECT status, last_updated FROM pump_state LIMIT 1');
    res.json({ success: true, data: pumpState[0] || { status: 'OFF' } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/pump
app.post('/api/pump', (req, res) => {
  try {
    const { action } = req.body;
    if (!action || !['on', 'off'].includes(action.toLowerCase())) {
      return res.status(400).json({ success: false, error: 'Invalid action. Use "on" or "off"' });
    }
    const status = action.toUpperCase();
    const stmt = db.prepare('UPDATE pump_state SET status = ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1');
    stmt.bind([status]);
    stmt.step();
    stmt.free();
    saveDatabase();
    res.json({ success: true, message: `Pump turned ${status}`, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/alerts
app.get('/api/alerts', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const alerts = getQueryResults('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?', [limit]);
    res.json({ success: true, count: alerts.length, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/seed
app.post('/api/seed', (req, res) => {
  try {
    const count = Math.min(parseInt(req.body?.count) || 50, 500);
    const stmt = db.prepare(
      'INSERT INTO readings (tds, turbidity, ph, status, bracket, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < count; i++) {
      const r = generateReading();
      const ts = new Date(Date.now() - i * 1000).toISOString();
      stmt.bind([r.tds, r.turbidity, r.ph, r.status, r.bracket, ts]);
      stmt.step();
      stmt.reset();
    }
    stmt.free();
    saveDatabase();
    res.json({ success: true, message: `Seeded ${count} readings`, count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/health
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Water IQ Backend is running', timestamp: new Date().toISOString() });
});

// GET /
app.get('/', (_req, res) => {
  res.json({
    service: 'Water IQ Backend',
    version: '2.0.0',
    endpoints: {
      live:          'GET  /api/live',
      readings:      'GET  /api/readings',
      readingsStats: 'GET  /api/readings/stats',
      addReading:    'POST /api/readings',
      pumpStatus:    'GET  /api/pump',
      pumpControl:   'POST /api/pump',
      alerts:        'GET  /api/alerts',
      seedData:      'POST /api/seed',
      health:        'GET  /api/health',
    },
  });
});

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── START ────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await initializeDatabase();
    console.log('✅ Database initialized');

    app.listen(PORT, () => {
      console.log(`🌊 Water IQ Backend running on port ${PORT}`);
    });

    // Auto-simulate a reading every 1s when ESP32 is not connected
    setInterval(() => {
      try {
        insertReading(generateReading());
      } catch (_) { /* silent */ }
    }, 1000);

  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
