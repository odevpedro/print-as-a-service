#!/usr/bin/env node
// Pipeline de re-treino automático semanal do PunctuationDecisionEngine
// Acionado por cron job no container: 0 3 * * 0 curl -X POST http://punctuation-engine:4020/retrain

const http = require('http');

const options = {
  hostname: 'localhost',
  port: 4020,
  path: '/retrain',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    console.log(`[Training Pipeline] Model re-trained: v${result.new_version} (accuracy: ${(result.accuracy * 100).toFixed(4)}%)`);
    console.log(`[Training Pipeline] Training samples: ${result.training_samples}`);
    console.log(`[Training Pipeline] Duration: ${result.training_time_ms}ms`);
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error(`[Training Pipeline] FAILED: ${err.message}`);
  process.exit(1);
});

req.write(JSON.stringify({ trigger: 'weekly_cron', source: 'train.js' }));
req.end();
