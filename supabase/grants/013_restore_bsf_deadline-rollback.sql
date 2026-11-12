-- Undo 013_restore_bsf_deadline.sql: clear the date again and put back the note the row had on 2026-11-12.
select grants.reverify_source('27cd8a3f-85e1-41d0-bb8a-a52561922167'::uuid, $j${"verdict":"keep","by":"rollback",
 "facts":{"next_deadline":null,"deadline_note":"Official page lists both rounds as to be announced and a yearly timeline (early April pre-proposals, late August full proposals by invitation); the 2027-04-07 date seen on an aggregator is not on the official page."}}$j$::jsonb, 'collect-2026-11-12-rollback');
