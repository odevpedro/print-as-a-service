#!/bin/sh
# Inicialização dos tópicos Kafka para o pipeline de saudação enterprise

echo "Waiting for Kafka to be ready..."
kafka-topics --bootstrap-server kafka:9092 --list 2>/dev/null || {
  echo "Kafka not ready yet, retrying in 5s..."
  sleep 5 && exec $0
}

echo "Creating greeting topics..."

kafka-topics --bootstrap-server kafka:9092 \
  --create --if-not-exists \
  --topic greeting-events \
  --partitions 3 \
  --replication-factor 1 \
  --config cleanup.policy=delete \
  --config retention.ms=604800000

kafka-topics --bootstrap-server kafka:9092 \
  --create --if-not-exists \
  --topic token-requests \
  --partitions 3 \
  --replication-factor 1

kafka-topics --bootstrap-server kafka:9092 \
  --create --if-not-exists \
  --topic punctuation-decisions \
  --partitions 1 \
  --replication-factor 1

echo "Topics created successfully:"
kafka-topics --bootstrap-server kafka:9092 --list
