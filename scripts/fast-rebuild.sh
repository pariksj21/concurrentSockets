#!/bin/bash

echo "🔨 Fast rebuild and restart..."

# Build only the websocket-blue service
docker compose -f docker/compose/docker-compose.yml build websocket-blue

# Restart the container (stop all including green profile)
docker compose -f docker/compose/docker-compose.yml --profile green down
docker compose -f docker/compose/docker-compose.yml up -d websocket-blue

echo "✅ Container rebuilt and restarted!"
echo "📝 Recent logs:"
docker compose -f docker/compose/docker-compose.yml logs websocket-blue --tail=10 