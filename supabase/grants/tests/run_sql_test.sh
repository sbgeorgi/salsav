#!/bin/sh
# Usage: PGPASSWORD=pw sh run_sql_test.sh   (scratch Postgres on :54329, roles+pgcrypto pre-created)
export PGPASSWORD="${PGPASSWORD:-pw}"
"/c/Program Files/PostgreSQL/17/bin/psql.exe" -h localhost -p 54329 -U postgres -v ON_ERROR_STOP=1 -f "$(dirname "$0")/schema_test.sql"
