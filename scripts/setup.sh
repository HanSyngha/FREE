#!/bin/bash
# FREE - Initial Setup Script
set -e

echo "=== FREE Setup ==="

# Install dependencies
echo "[1/4] Installing API dependencies..."
cd "$(dirname "$0")/../api"
npm install

echo "[2/4] Installing Frontend dependencies..."
cd ../frontend
npm install

echo "[3/4] Installing Worker dependencies..."
cd ../worker
npm install

echo "[4/4] Generating Prisma client..."
cd ../api
npx prisma generate

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start development:"
echo "  API:      cd api && npm run dev"
echo "  Frontend: cd frontend && npm run dev"
echo "  Worker:   cd worker && npm run dev"
echo ""
echo "To start with Docker:"
echo "  docker compose -f docker/docker-compose.yml up -d --build"
echo ""
