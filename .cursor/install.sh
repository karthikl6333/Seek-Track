#!/usr/bin/env bash
# Idempotent Cloud Agent install: system deps, Node deps, and local Postgres provisioning.
set -euo pipefail

cd "$(dirname "$0")/.."

PG_VERSION=16
DB_USER=seek
DB_PASSWORD=seek
DB_NAME=seektrack

echo "==> Installing PostgreSQL if missing"
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

echo "==> Installing Node dependencies"
npm install

echo "==> Ensuring .env exists"
[ -f .env ] || cp .env.example .env

echo "==> Starting PostgreSQL to provision role/database"
sudo pg_ctlcluster "$PG_VERSION" main start || true
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

echo "==> Ensuring role '$DB_USER' and database '$DB_NAME' exist"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

echo "==> Install complete"
