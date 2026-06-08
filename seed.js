import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'wateriq.db');
const db = new Database(dbPath);

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

console.log('🌊 Seeding Water IQ database with mock readings...');

const count = process.argv[2] ? parseInt(process.argv[2]) : 100;

try {
  // Clear existing data (optional)
  // db.prepare('DELETE FROM readings').run();
  // db.prepare('DELETE FROM alerts').run();

  const stmt = db.prepare(`
    INSERT INTO readings (tds, turbidity, ph, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < count; i++) {
    const reading = generateReading();
    const pastTime = new Date(Date.now() - i * 60000); // 1 min intervals
    const timestampStr = pastTime.toISOString();
    
    stmt.run(
      reading.tds,
      reading.turbidity,
      reading.ph,
      reading.status,
      timestampStr
    );

    if ((i + 1) % 20 === 0) {
      console.log(`✓ Inserted ${i + 1}/${count} readings`);
    }
  }

  console.log(`\n✅ Successfully seeded ${count} readings!`);
  console.log(`📊 Database location: ${dbPath}`);
  
  // Show stats
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      AVG(tds) as avg_tds,
      AVG(turbidity) as avg_turbidity,
      AVG(ph) as avg_ph
    FROM readings
  `).get();

  console.log('\n📈 Database Stats:');
  console.log(`   Total readings: ${stats.total}`);
  console.log(`   Avg TDS: ${parseFloat(stats.avg_tds).toFixed(2)} ppm`);
  console.log(`   Avg Turbidity: ${parseFloat(stats.avg_turbidity).toFixed(2)} NTU`);
  console.log(`   Avg pH: ${parseFloat(stats.avg_ph).toFixed(2)}`);

  db.close();
} catch (error) {
  console.error('❌ Error seeding database:', error);
  process.exit(1);
}
