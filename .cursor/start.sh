#!/usr/bin/env bash
# Per-boot startup: bring up PostgreSQL and confirm readiness before the app starts.
set -euo pipefail

PG_VERSION=16
DB_USER=seek
DB_PASSWORD=seek
DB_NAME=seektrack

echo "==> Starting PostgreSQL cluster ${PG_VERSION}/main"
sudo pg_ctlcluster "$PG_VERSION" main start || true

echo "==> Waiting for PostgreSQL to accept connections"
for _ in $(seq 1 60); do
  if sudo -u postgres pg_isready -q; then
    ready=1
    break
  fi
  sleep 1
done

if [ "${ready:-0}" != "1" ]; then
  echo "PostgreSQL did not become ready" >&2
  exit 1
fi

# Reconcile role/database in case they are absent (idempotent).
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

echo "==> PostgreSQL ready"
