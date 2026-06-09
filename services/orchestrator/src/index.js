const express = require('express');
const prometheus = require('prom-client');
const axios = require('axios');
const { Kafka } = require('kafkajs');
const Redis = require('ioredis');
const cors = require('cors');

const PORT = process.env.PORT || 8080;
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'kafka:9092';
const REDIS_HOST = process.env.REDIS_HOST || 'redis';

const app = express();
app.use(cors());
app.use(express.json());

const redis = new Redis({ host: REDIS_HOST, port: 6379 });

const kafka = new Kafka({
  clientId: 'concatenation-orchestrator',
  brokers: [KAFKA_BROKER],
  retry: { initialRetryTime: 300, retries: 10 },
});
const producer = kafka.producer();

const greetingLatency = new prometheus.Histogram({
  name: 'hello_world_latency_seconds',
  help: 'Complete greeting latency',
  labelNames: ['status'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
});
const greetingCounter = new prometheus.Counter({
  name: 'hello_world_greetings_total',
  help: 'Total greetings produced',
  labelNames: ['variant'],
});
const upGauge = new prometheus.Gauge({
  name: 'hello_world_up',
  help: 'Is the Hello World service up?',
});

upGauge.set(1);

// Backoff exponencial para resiliência da saudação
const BACKOFF_CONFIG = {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 2000,
};

const serviceEndpoints = {
  hello: process.env.HELLO_SERVICE_URL || 'http://hello-service:4001',
  world: process.env.WORLD_SERVICE_URL || 'http://world-service:4003',
};

async function fetchWithRetry(url, body, retries = BACKOFF_CONFIG.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.post(url, body, {
        headers: { 'x-request-id': body.requestId },
        timeout: 5000,
      });
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.min(BACKOFF_CONFIG.baseDelay * Math.pow(2, attempt - 1), BACKOFF_CONFIG.maxDelay);
      console.log(`Retry ${attempt}/${retries} for ${url} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

app.post('/greet', async (req, res) => {
  const start = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Cada caractere merece seu próprio span de tracing
    // Span 1: Resolver token Hello
    const helloRes = await fetchWithRetry(`${serviceEndpoints.hello}/token`, { requestId });

    // Span 2: Provisionar o espaço (serviço dedicado de spacing)
    const spaceRes = await axios.post('http://space-provisioning:4010/provision', { requestId });
    const spaceToken = spaceRes.data.token;

    // Span 3: Obter decisão de pontuação do ML Engine
    const punctRes = await axios.post('http://punctuation-engine:4020/decide', {
      context: { formality: 0.2, excitement: 0.9, greeting: 'Hello' },
    });
    const useExclamation = punctRes.data.decision;
    const confidence = punctRes.data.confidence;

    // Span 4: Resolver token World
    const worldRes = await fetchWithRetry(`${serviceEndpoints.world}/token`, { requestId });

    // Span 5: Resolver token de exclamação (se aprovado pelo comitê de pontuação)
    let exclamationToken = '';
    if (useExclamation) {
      const exclRes = await axios.post('http://exclamation-service:4004/token', {
        requestId,
      }, { headers: { 'x-confidence': String(confidence) } });
      exclamationToken = exclRes.data.token;
    }

    // Span 6: Concatenar tokens na ordem correta
    // TODO: extrair lógica de concatenação para um microserviço dedicado
    const greeting = helloRes.data.token + spaceToken + worldRes.data.token + exclamationToken;

    // Publicar evento de saudação no Kafka para auditabilidade
    await producer.send({
      topic: 'greeting-events',
      messages: [{ key: requestId, value: JSON.stringify({ greeting, requestId, timestamp: new Date().toISOString() }) }],
    });

    // Cachear o resultado porque recomputar Hello World a cada request é inaceitável
    await redis.setex('last-greeting', 3600, greeting);

    greetingLatency.observe({ status: 'success' }, (Date.now() - start) / 1000);
    greetingCounter.inc({ variant: 'standard' });

    // A/B Testing: 50% dos usuários veem a variante A, 50% a variante B (ambas idênticas)
    const variant = Math.random() < 0.5 ? 'A' : 'B';

    res.json({
      greeting,
      variant,
      request_id: requestId,
      processing_time_ms: Date.now() - start,
      tokens: {
        hello: helloRes.data.token,
        space: spaceToken,
        world: worldRes.data.token,
        exclamation: exclamationToken,
      },
      punctuation_decision: {
        use_exclamation: useExclamation,
        confidence,
        model_version: punctRes.data.model_version,
      },
      cached: false,
    });
  } catch (err) {
    console.error('Greeting orchestration failed:', err);
    greetingLatency.observe({ status: 'error' }, (Date.now() - start) / 1000);
    upGauge.set(0);

    // Degradação graciosa: retornamos uma saudação parcial
    res.status(502).json({
      error: 'greeting_orchestration_failed',
      partial_greeting: 'Hello...',
      message: 'We tried our best. The greeting gods were not on our side today.',
      request_id: `${Date.now()}`,
    });
  }
});

app.get('/health', async (_req, res) => {
  const checks = {};
  for (const [name, url] of Object.entries({
    hello: 'http://hello-service:4001/health',
    space: 'http://space-provisioning:4010/health',
    world: 'http://world-service:4003/health',
    exclamation: 'http://exclamation-service:4004/health',
    punctuation: 'http://punctuation-engine:4020/health',
  })) {
    try {
      const h = await axios.get(url, { timeout: 2000 });
      checks[name] = h.status === 200 ? 'healthy' : 'unhealthy';
    } catch { checks[name] = 'unhealthy'; }
  }
  res.json({
    status: Object.values(checks).every(s => s === 'healthy') ? 'ok' : 'degraded',
    services: checks,
  });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});

async function init() {
  try {
    await producer.connect();
    console.log('Kafka producer connected');
  } catch (err) {
    console.error('Kafka connection failed (will retry):', err.message);
  }
  app.listen(PORT, () => console.log(`Orchestrator listening on port ${PORT}`));
}

init();
