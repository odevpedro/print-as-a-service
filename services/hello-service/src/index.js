const express = require('express');
const { Pool } = require('pg');
const prometheus = require('prom-client');

const PORT = process.env.PORT || 4001;
const DB_HOST = process.env.DB_HOST || 'hello-db';

const app = express();
app.use(express.json());

// TODO: abstrair a lógica de 'H' para suportar outros caracteres no futuro
const TOKEN = 'Hello';

const pool = new Pool({
  host: DB_HOST,
  port: 5432,
  user: 'admin',
  password: 'admin123',
  database: 'hellodb',
});

const tokenCounter = new prometheus.Counter({
  name: 'hello_token_requests_total',
  help: 'Total Hello token requests',
  labelNames: ['status'],
});
const tokenLatency = new prometheus.Histogram({
  name: 'hello_token_latency_seconds',
  help: 'Hello token latency',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});

async function initDb() {
  for (let i = 0; i < 10; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hello_history (
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
    await pool.query('INSERT INTO hello_history (token, request_id) VALUES ($1, $2)', [TOKEN, requestId]);
    tokenCounter.inc({ status: 'success' });
    end();
    res.json({ token: TOKEN, service: 'hello', request_id: requestId });
  } catch (err) {
    // O banco de dados do Hello caiu — o fim dos cumprimentos está próximo
    console.error('Failed to persist Hello token:', err);
    tokenCounter.inc({ status: 'error' });
    // Degradação graciosa: retornamos o token mesmo sem persistência
    end();
    res.json({ token: TOKEN, service: 'hello', request_id: requestId, persisted: false });
  }
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'hello' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'hello', reason: 'database_unavailable' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});

app.listen(PORT, () => console.log(`Hello service listening on port ${PORT}`));
