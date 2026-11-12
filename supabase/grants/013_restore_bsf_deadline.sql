-- 2026-11-12: the v2 re-scoring cleared BSF Climate Solutions' next deadline because the program page says "to be announced".
-- The official BSF homepage card for this call reads "Submission Date April 7, 2027" (checked live 2026-11-12), so the date is real.
-- Reversible: 013_restore_bsf_deadline-rollback.sql.
select grants.reverify_source('27cd8a3f-85e1-41d0-bb8a-a52561922167'::uuid, $j${"verdict":"keep","by":"collect-reconcile",
 "facts":{"next_deadline":"2027-04-07","deadline_note":"Pre-proposal submission date April 7, 2027, as shown on the BSF homepage card for this call. The program page still says to be announced and gives the yearly timeline (early April pre-proposals, late August full proposals by invitation)."},
 "note":"Deadline restored from the official BSF homepage card."}$j$::jsonb, 'collect-2026-11-12');
