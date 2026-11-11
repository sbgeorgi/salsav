#!/bin/sh
# Usage: sh tests/run-all.sh   (needs the scratch Postgres on localhost:54329, or DATABASE_URL pointing at an admin connection)
cd "$(dirname "$0")/.." && npm i --silent && npm test
