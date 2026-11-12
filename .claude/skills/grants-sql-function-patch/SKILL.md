---
name: grants-sql-function-patch
description: "Use when changing a grants.* SQL function, RPC or migration in the SALSAV Supabase project, through apply_migration or a rollback-tested patch."
category: funding-discovery
status: active
author: reflect
created: 2026-11-12
---
Change a grants.* function only by a rollback-tested patch: save the live definition, test the rewrite, then apply the same text under an md5 guard.
1. Save the live definition first: select pg_get_functiondef('grants.NAME(ARGS)'::regprocedure) into supabase/grants/NNN_NAME-rollback.sql.
2. Write supabase/grants/NNN_NAME.sql as replace() patches on that text; each replace must hit its expected count, and the file raises when a count is wrong.
3. Test in a DO block: execute the patched text, call the function on fixture rows with example.org urls, and RAISE EXCEPTION with the results and md5 of the patched text. The exception rolls back the fixtures.
4. Compute md5 of the repo body in Python (trailing newline normalised) and compare it with the md5 the test reported; continue only when they match.
5. Apply with apply_migration using the same patch plus if md5(n) <> 'HASH' then raise exception, so a different definition cannot apply.
6. Verify: md5 of pg_get_functiondef equals HASH, has_function_privilege is false for anon and authenticated, and the name appears in supabase_migrations.schema_migrations. Then rename the repo file to the returned version.
Pitfalls:
- execute_sql returns only the last result, so put every output value in the RAISE message.
- Inside E'' strings write \\n and doubled quotes; a $m$ or $t$ inside the body breaks the dollar quoting.
- Check that fixture rows get the expected stored status, not only that the call succeeds.
- Never leave test rows in grants.funders.
