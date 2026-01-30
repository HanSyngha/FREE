#!/bin/bash
# FREE - Development Start Script
# Starts all services for local development

echo "=== FREE Development Mode ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js is required. Aborting."; exit 1; }

# Start DB and Redis via Docker (if available)
if command -v docker >/dev/null 2>&1; then
    echo "[Docker] Starting PostgreSQL and Redis..."
    docker compose -f "$(dirname "$0")/../docker/docker-compose.yml" up -d free-db free-redis
    echo "[Docker] Waiting for services..."
    sleep 3
fi

# Push schema
echo "[DB] Pushing Prisma schema..."
cd "$(dirname "$0")/../api"
npx prisma db push --accept-data-loss 2>/dev/null || true

# Start services in background
echo "[API] Starting API server on port 15002..."
npm run dev &
API_PID=$!

echo "[Frontend] Starting frontend on port 15001..."
cd ../frontend
npm run dev &
FE_PID=$!

echo "[Worker] Starting worker..."
cd ../worker
npm run dev &
WORKER_PID=$!

echo ""
echo "=== All services started ==="
echo "  Frontend: http://localhost:15001"
echo "  API:      http://localhost:15002"
echo "  DB:       localhost:15003"
echo "  Redis:    localhost:15004"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $API_PID $FE_PID $WORKER_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
