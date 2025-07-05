#!/bin/bash

echo "🔄 Restarting development container..."

# Stop and remove the container
docker compose down websocket-blue

# Start in development mode with hot reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d websocket-blue

echo "✅ Development container restarted!"
echo "📝 Logs:"
docker compose logs websocket-blue --tail=10 