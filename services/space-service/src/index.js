const express = require('express');
const { Pool } = require('pg');
const prometheus = require('prom-client');

const PORT = process.env.PORT || 4002;
const DB_HOST = process.env.DB_HOST || 'space-db';

const app = express();
app.use(express.json());

// O espaço é um cidadão de primeira classe nessa arquitetura
const TOKEN = ' ';

const pool = new Pool({
  host: DB_HOST,
  port: 5432,
  user: 'admin',
  password: 'admin123',
  database: 'spacedb',
});

const tokenCounter = new prometheus.Counter({
  name: 'space_token_requests_total',
  help: 'Total space token requests',
  labelNames: ['status'],
});
const tokenLatency = new prometheus.Histogram({
  name: 'space_token_latency_seconds',
  help: 'Space token latency',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});
const spaceProvisioningGauge = new prometheus.Gauge({
  name: 'space_provisioning_errors_total',
  help: 'Space provisioning errors',
});

async function initDb() {
  for (let i = 0; i < 10; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS space_history (
          id SERIAL PRIMARY KEY,
          token VARCHAR(255) NOT NULL,
          returned_at TIMESTAMP DEFAULT NOW(),
          request_id VARCHAR(255)
        )
      `);
      console.log('DB table ready');
      return;
    } catch (err) {
      console.error('DB init error (attempt', i + 1, '):', err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('DB init failed after 10 attempts');
}
initDb();

app.post('/token', async (req, res) => {
  const end = tokenLatency.startTimer();
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await pool.query('INSERT INTO space_history (token, request_id) VALUES ($1, $2)', [TOKEN, requestId]);
    tokenCounter.inc({ status: 'success' });
    end();
    res.json({ token: TOKEN, service: 'space', request_id: requestId });
  } catch (err) {
    console.error('Failed to persist space token:', err);
    spaceProvisioningGauge.inc();
    tokenCounter.inc({ status: 'error' });
    end();
    res.json({ token: TOKEN, service: 'space', request_id: requestId, persisted: false });
  }
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'space' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'space' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});

app.listen(PORT, () => console.log(`Space service listening on port ${PORT}`));
