#!/bin/bash

echo "🔄 Restarting development container..."

# Stop and remove all containers (including green profile)
docker compose -f docker/compose/docker-compose.yml --profile green down

# Start in development mode with hot reload (default blue)
docker compose -f docker/compose/docker-compose.yml -f docker/compose/docker-compose.dev.yml up -d websocket-blue

echo "✅ Development container restarted!"
echo "📝 Logs:"
docker compose -f docker/compose/docker-compose.yml logs websocket-blue --tail=10 