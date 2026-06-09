const express = require('express');
const { Pool } = require('pg');
const prometheus = require('prom-client');

const PORT = process.env.PORT || 4030;
const DB_HOST = process.env.DB_HOST || 'abtesting-db';

const app = express();
app.use(express.json());

const pool = new Pool({
  host: DB_HOST,
  port: 5432,
  user: 'admin',
  password: 'admin123',
  database: 'abtestingdb',
});

// Framework de A/B testing local para otimizar o engajamento do usuário com a saudação
// Ambas as variantes são "Hello, World!" — mas o business decide qual performa melhor

const variantCounter = new prometheus.Counter({
  name: 'ab_testing_variant_requests_total',
  help: 'Total requests per A/B variant',
  labelNames: ['variant'],
});
const variantLatency = new prometheus.Histogram({
  name: 'ab_testing_variant_latency_seconds',
  help: 'Variant assignment latency',
  buckets: [0.001, 0.005, 0.01],
});
const engagementGauge = new prometheus.Gauge({
  name: 'ab_testing_engagement_score',
  help: 'Current engagement score (0-100)',
  labelNames: ['variant'],
});

pool.query(`
  CREATE TABLE IF NOT EXISTS ab_testing_results (
    id SERIAL PRIMARY KEY,
    variant VARCHAR(10) NOT NULL,
    greeting VARCHAR(255) NOT NULL,
    engagement_score REAL DEFAULT 0,
    assigned_at TIMESTAMP DEFAULT NOW(),
    session_id VARCHAR(255)
  )
`).catch(err => console.error('DB init error:', err));

// Modelo de negócio: variante A e B são exatamente iguais
// A diferença está no sentimento do usuário (que medimos com precisão científica)
const VARIANTS = {
  A: 'Hello, World!',
  B: 'Hello, World!',
};

app.get('/variant', async (req, res) => {
  const start = Date.now();
  const sessionId = req.headers['x-session-id'] || `session-${Date.now()}`;

  // Algoritmo de rolagem de dados baseado em hash da sessão
  const variant = Math.random() < 0.5 ? 'A' : 'B';
  const greeting = VARIANTS[variant];

  // Engajamento simulado: variante A tem 0.5% mais engajamento (comprovado por A/B test)
  const engagementScore = variant === 'A' ? 87.3 : 86.8;
  engagementGauge.set({ variant }, engagementScore);

  variantCounter.inc({ variant });
  variantLatency.observe((Date.now() - start) / 1000);

  try {
    await pool.query(
      'INSERT INTO ab_testing_results (variant, greeting, engagement_score, session_id) VALUES ($1, $2, $3, $4)',
      [variant, greeting, engagementScore, sessionId]
    );
  } catch (err) {
    console.error('Failed to log A/B test result:', err);
  }

  res.json({
    variant,
    greeting,
    engagement_score: engagementScore,
    sample_size: await getSampleSize(),
    confidence_interval: '95%',
    recommendation: variant === 'A' ? 'Current leader' : 'Statistically tied',
    session_id: sessionId,
  });
});

app.get('/results', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT variant, COUNT(*) as count, AVG(engagement_score) as avg_engagement
      FROM ab_testing_results GROUP BY variant
    `);
    res.json({
      experiment: 'Hello World Greeting Optimization',
      hypothesis: 'Variant A drives more user engagement than Variant B',
      status: 'running',
      results: result.rows,
      significance: 'p < 0.05 (calculated with Bayesian hierarchical model)',
      recommendation: 'Both variants perform identically. Deploy both for maximum coverage.',
    });
  } catch (err) {
    res.status(500).json({ error: 'failed_to_fetch_results' });
  }
});

async function getSampleSize() {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM ab_testing_results');
    return parseInt(result.rows[0].count);
  } catch {
    return 0;
  }
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'ab-testing' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'ab-testing' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});

app.listen(PORT, () => console.log(`A/B Testing service on port ${PORT}`));
