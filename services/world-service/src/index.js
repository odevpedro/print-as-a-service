const express = require('express');
const { Pool } = require('pg');
const prometheus = require('prom-client');

const PORT = process.env.PORT || 4003;
const DB_HOST = process.env.DB_HOST || 'world-db';

const app = express();
app.use(express.json());

const TOKEN = 'World';
let circuitOpen = false;
let failureCount = 0;
const CIRCUIT_THRESHOLD = 5;

const pool = new Pool({
  host: DB_HOST,
  port: 5432,
  user: 'admin',
  password: 'admin123',
  database: 'worlddb',
});

const tokenCounter = new prometheus.Counter({
  name: 'world_token_requests_total',
  help: 'Total World token requests',
  labelNames: ['status'],
});
const tokenLatency = new prometheus.Histogram({
  name: 'world_token_latency_seconds',
  help: 'World token latency',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});
const circuitBreakerGauge = new prometheus.Gauge({
  name: 'world_circuit_breaker_state',
  help: 'World circuit breaker state (0=closed, 1=open)',
});

async function initDb() {
  for (let i = 0; i < 10; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS world_history (
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

  // Circuit breaker ativado — o mundo não pode saber que somos incapazes de dizer 'World'
  if (circuitOpen) {
    tokenCounter.inc({ status: 'circuit_open' });
    end();
    return res.status(503).json({ error: 'circuit_breaker_open', service: 'world' });
  }

  try {
    await pool.query('INSERT INTO world_history (token, request_id) VALUES ($1, $2)', [TOKEN, requestId]);
    failureCount = 0;
    circuitOpen = false;
    circuitBreakerGauge.set(0);
    tokenCounter.inc({ status: 'success' });
    end();
    res.json({ token: TOKEN, service: 'world', request_id: requestId });
  } catch (err) {
    failureCount++;
    if (failureCount >= CIRCUIT_THRESHOLD) {
      circuitOpen = true;
      circuitBreakerGauge.set(1);
      console.error('World circuit breaker OPEN — the planet is unreachable');
      // TODO: notificar SRE via webhook que o mundo está fora do ar
    }
    tokenCounter.inc({ status: 'error' });
    end();
    res.status(502).json({ token: TOKEN, service: 'world', persisted: false });
  }
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'world', circuit_breaker: circuitOpen ? 'open' : 'closed' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'world' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});

app.listen(PORT, () => console.log(`World service listening on port ${PORT}`));
