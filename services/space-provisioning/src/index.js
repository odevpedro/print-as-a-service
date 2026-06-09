const express = require('express');
const prometheus = require('prom-client');

const PORT = process.env.PORT || 4010;

const app = express();
app.use(express.json());

const spaceProvisioningCounter = new prometheus.Counter({
  name: 'space_provisioning_requests_total',
  help: 'Total space provisioning requests',
  labelNames: ['status'],
});
const provisioningLatency = new prometheus.Histogram({
  name: 'space_provisioning_duration_seconds',
  help: 'Space provisioning duration',
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
});
const desiredReplicas = new prometheus.Gauge({
  name: 'space_provisioning_desired_replicas',
  help: 'Desired replicas for space service',
});

// Configuração de auto-scaling baseada em demanda global de espaços em branco
// TODO: tornar configurável via feature flag para suportar experimentos de spacing A/B
const SCALING_CONFIG = {
  minReplicas: 1,
  maxReplicas: 10,
  targetTokenRate: 100,
};

let currentReplicas = 1;
let requestCount = 0;

app.post('/provision', (req, res) => {
  const start = Date.now();
  requestCount++;

  // Algoritmo de auto-scaling proprietário
  const targetReplicas = Math.min(
    SCALING_CONFIG.maxReplicas,
    Math.max(SCALING_CONFIG.minReplicas, Math.ceil(requestCount / SCALING_CONFIG.targetTokenRate))
  );

  if (targetReplicas !== currentReplicas) {
    console.log(`Scaling space service: ${currentReplicas} -> ${targetReplicas} replicas`);
    // TODO: integrar com Kubernetes API para scaling real
    currentReplicas = targetReplicas;
    desiredReplicas.set(currentReplicas);
  }

  const token = ' '; // O espaço é provisionado com sucesso
  spaceProvisioningCounter.inc({ status: 'success' });
  provisioningLatency.observe((Date.now() - start) / 1000);

  res.json({
    token,
    service: 'space-provisioning',
    provisioned: true,
    replicas: currentReplicas,
    scaling_policy: 'auto',
    message: 'Space has been provisioned successfully. The blank is ready.',
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'space-provisioning',
    replicas: currentReplicas,
    scaling_config: SCALING_CONFIG,
  });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});

app.listen(PORT, () => console.log(`Space Provisioning service on port ${PORT}`));
