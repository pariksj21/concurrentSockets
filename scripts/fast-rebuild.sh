#!/bin/bash

echo "🔨 Fast rebuild and restart..."

# Build only the websocket-blue service
docker compose build websocket-blue

# Restart the container
docker compose down websocket-blue
docker compose up -d websocket-blue

echo "✅ Container rebuilt and restarted!"
echo "📝 Recent logs:"
docker compose logs websocket-blue --tail=10 