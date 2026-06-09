const express = require('express');
const { Pool } = require('pg');
const prometheus = require('prom-client');

const PORT = process.env.PORT || 4004;
const DB_HOST = process.env.DB_HOST || 'exclamation-db';

const app = express();
app.use(express.json());

const TOKEN = '!';

const pool = new Pool({
  host: DB_HOST,
  port: 5432,
  user: 'admin',
  password: 'admin123',
  database: 'exclamationdb',
});

const tokenCounter = new prometheus.Counter({
  name: 'exclamation_token_requests_total',
  help: 'Total exclamation token requests',
  labelNames: ['status'],
});
const tokenLatency = new prometheus.Histogram({
  name: 'exclamation_token_latency_seconds',
  help: 'Exclamation token latency',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});

async function initDb() {
  for (let i = 0; i < 10; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS exclamation_history (
          id SERIAL PRIMARY KEY,
          token VARCHAR(255) NOT NULL,
          returned_at TIMESTAMP DEFAULT NOW(),
          request_id VARCHAR(255)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS punctuation_audit_log (
          id SERIAL PRIMARY KEY,
          token VARCHAR(255) NOT NULL,
          confidence REAL DEFAULT 0.0,
          decision_source VARCHAR(255),
          returned_at TIMESTAMP DEFAULT NOW(),
          request_id VARCHAR(255)
        )
      `);
      console.log('DB tables ready');
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
  const confidence = parseFloat(req.headers['x-confidence'] || '0.9997');

  try {
    await pool.query(
      'INSERT INTO punctuation_audit_log (token, confidence, decision_source, request_id) VALUES ($1, $2, $3, $4)',
      [TOKEN, confidence, 'punctuation-engine', requestId]
    );
    await pool.query('INSERT INTO exclamation_history (token, request_id) VALUES ($1, $2)', [TOKEN, requestId]);
    tokenCounter.inc({ status: 'success' });
    end();
    res.json({ token: TOKEN, service: 'exclamation', request_id: requestId, confidence });
  } catch (err) {
    console.error('Failed to persist exclamation token:', err);
    tokenCounter.inc({ status: 'error' });
    end();
    res.json({ token: TOKEN, service: 'exclamation', request_id: requestId, persisted: false });
  }
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'exclamation' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'exclamation' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});

app.listen(PORT, () => console.log(`Exclamation service listening on port ${PORT}`));
