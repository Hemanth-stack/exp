#!/bin/sh
# Check if user project exists and has package.json
if [ -f "/app/user-project/package.json" ]; then
  echo "User project detected, starting from /app/user-project"
  cd /app/user-project
  # Check if node_modules exists, if not install
  if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install --legacy-peer-deps
  fi
  exec npm run dev
else
  echo "No user project found, starting template"
  cd /app
  exec npm run dev
fi
