// Live smoke test, step 1: create DB `grants_smoke`, seed <=12 real vetted sources (distinct hosts) from the verified_r1_*.json seed files.
// Usage: node --experimental-strip-types tests/smoke-seed.ts <seed-dir>   (prints the DB url and the chosen sources)
import { readdirSync, readFileSync } from "node:fs";
import { createDb, TOKEN } from "./helpers.ts";

const dir = process.argv[2];
const rows: any[] = readdirSync(dir).filter((f) => /^verified_r1_\d+\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))).filter((r) => r.verdict === "keep");
const plan: [string, number][] = [["us_federal", 3], ["intl_dev_multilateral", 3], ["bilateral_dev", 1], ["foundation", 4], ["research_collab", 1]];
// federal funders on grants.gov/nsf/usda and development banks first, so the smoke set covers those families
const PREFER = /grants\.gov|nsf\.gov|usda\.gov|worldbank|adb\.org|afdb|iadb|ifad\.org|ebrd|eib\.org/;
const hosts = new Set<string>();
const chosen: any[] = [];
for (const [cat, n] of plan) {
  let taken = 0;
  for (const r of [...rows].sort((x, y) => Number(PREFER.test(new URL(y.url).host)) - Number(PREFER.test(new URL(x.url).host)))) {
    const host = new URL(r.url).host;
    if (r.category !== cat || hosts.has(host) || taken >= n || chosen.length >= 12) continue;
    hosts.add(host);
    chosen.push(r);
    taken++;
  }
}
const db = await createDb("smoke");
const CYCLES = ["fixed_deadline", "annual_recurring", "rolling", "open_ended", "invite_only", "closed_unknown"];
const UA = ["eligible", "eligible_with_partner", "invitation_only", "unknown"];
for (const r of chosen) {
  await db.sql`insert into grants.funders(name, program, category, url, apply_url, geography, themes, cycle, ua_eligibility, status, vetted_at, vet_note, fit_score, fit_reasons)
    values (${r.funderName}, ${r.programName ?? null}, ${r.category}, ${r.url}, ${r.applyUrl ?? null}, ${db.sql.array(r.geography ?? [])}, ${db.sql.array(r.themes ?? [])},
            ${CYCLES.includes(r.cycle) ? r.cycle : "closed_unknown"}, ${UA.includes(r.uaEligibility) ? r.uaEligibility : "unknown"}, 'vetted', now(), 'smoke test', 60, ${db.sql.array(["smoke"])})`;
}
await db.sql.end();
console.log(JSON.stringify({ db: db.name, url: db.url, token: TOKEN, sources: chosen.map((r) => [r.category, r.url]) }, null, 1));
