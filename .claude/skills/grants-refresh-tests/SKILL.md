---
name: grants-refresh-tests
description: "Use when changing or testing the grants-refresh edge function: its collection adapters, adapter_config validation, or running its test suites before a deploy."
category: tooling
status: active
author: reflect
created: 2026-11-12
---
Directive: before changing grants-refresh collection code, run its pure suites; the handler suites need a local Postgres and are not a pass signal.
Run from supabase/functions/grants-refresh: timeout 500 node --experimental-strip-types --test --test-concurrency=1 --test-timeout=240000 tests/collect.test.ts tests/extract.test.ts
Expect all 138 to pass (measured 2026-11-12).
tests/handler.test.ts, tests/adapters-handler.test.ts and tests/engine.test.ts (dry_run, only_ids) fail with ECONNREFUSED without a local Postgres; report them as environmental, never as passing.
adapters/index.ts configError refuses control characters in any adapter_config string, since a JSON "\b" is a backspace; its test sits beside the date_order test in tests/collect.test.ts.
Config regexes in JSON files must write a word boundary as "\\b"; check with configError before set_collection.
Production runs on Deno (deno.json maps npm:postgres and npm:cheerio); the Node suites use package.json deps.
The source is about 149 KB across *.ts and adapters/*.ts. Deploy only the files deploy_gate.mjs lists, and rerun the gate after every edit, since the hook denies any file whose hash differs from .deploy-ok.json. Send all listed files in ONE deploy_edge_function call: partial payloads are denied by the stamp hook (a 2026-11-12 worker sent 1 of 19 files, then 8 of 19, and both were denied; the full 19-file call passed first try). Retyped deploys turn unicode and hex escapes into literal characters, so use literal characters or char codes, never escapes (the gate refuses them). The MCP deploy_edge_function tool takes the files inline and must be given import_map_path "deno.json" explicitly: without it the tool reuses the previous version's absolute import-map path and fails with "import map path does not exist" (the deploy hook did not block it). The local Supabase CLI is linked to another account, so do not deploy with it.
Html list items keep a route hash (#/x, #!x, #word/NNN) in url and external_id; the normaliser once dropped it, so every RFP on one portal shared one external_id. Yearless listing dates ("December 1") need self.assume_next_year: true in the adapter config, else no item is read.
A production deploy stays with the user; prepare the tested source and the exact deploy steps.
