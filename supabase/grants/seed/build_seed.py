"""Transform discovery output (verified_*.json) into grants.register_source() calls.

Usage: python build_seed.py <seed_dir> <out_dir> [batch_size]
Writes <out_dir>/seed_funders.json (normalized records) and <out_dir>/batch_NN.sql (idempotent: register_source dedupes
by normalized url and name).  Vetting rule (the dashboard only ever shows status='vetted'):
  vetted  = verifier said keep AND ua_eligibility != 'unlikely' AND (award max unknown or >= 200k) AND raw fit >= 12
  rejected = verifier said drop, or keep-but-out-of-scope (reason recorded so discovery never re-finds it)
  candidate = in scope on paper but raw fit < 12 (hidden until a human/discovery run promotes it)
fit_score = 100*(1-exp(-raw/45)): a ranking aid, not the gate (the verifier's 'keep' is the scoping decision).
"""
import glob, json, math, re, sys, os

MIN_AWARD = 200_000
VET_MIN_RAW = 12  # raw theme/geo/category points; below this a 'keep' is too thin on SALSAV themes to surface

THEMES = {  # term -> (points, label)   all lowercase, matched against name+program+themes+notes+eligibility
    'agrivoltaic': (22, 'agrivoltaics'), 'agri-voltaic': (22, 'agrivoltaics'), 'agrophotovolta': (22, 'agrivoltaics'),
    'solar': (9, 'solar energy'), 'photovoltaic': (9, 'solar energy'), 'renewable': (6, 'renewable energy'),
    'food-energy-water': (14, 'food-energy-water nexus'), 'food, energy': (14, 'food-energy-water nexus'),
    'water-energy': (10, 'water-energy nexus'), 'dryland': (10, 'dryland systems'), 'arid': (10, 'arid/semi-arid focus'),
    'semi-arid': (4, 'semi-arid focus'), 'drought': (6, 'drought resilience'), 'water': (4, 'water'),
    'agroecolog': (9, 'agroecology'), 'regenerative': (6, 'regenerative agriculture'), 'smallholder': (8, 'smallholder livelihoods'),
    'climate adapt': (9, 'climate adaptation'), 'climate resilien': (8, 'climate resilience'), 'climate': (4, 'climate'),
    'sustainable agricultur': (8, 'sustainable agriculture'), 'agricultur': (5, 'agriculture'), 'food system': (6, 'food systems'),
    'rural': (4, 'rural communities'), 'energy access': (7, 'energy access'), 'land use': (4, 'land use'),
    'ecophysiolog': (6, 'plant ecophysiology'), 'soil': (3, 'soil'), 'crop': (3, 'crops'), 'workforce': (3, 'workforce/training'),
    'education': (2, 'education'), 'training': (2, 'training'), 'scal': (2, 'scaling'), 'living lab': (6, 'living labs'),
    'nature-based': (4, 'nature-based solutions'), 'biodiversity': (2, 'biodiversity'), 'pollinator': (4, 'pollinators'),
}
GEO_POINTS = {'US': 8, 'AZ': 12, 'NM': 8, 'CO': 6, 'NV': 6, 'CA': 6, 'SSA': 8, 'Africa': 6, 'LatAm': 8, 'Americas': 8,
              'Mexico': 6, 'Caribbean': 4, 'Kenya': 5, 'global': 3}
CAT_POINTS = {'us_federal': 8, 'state_regional': 8, 'bilateral_dev': 4, 'intl_dev_multilateral': 4, 'foundation': 4,
              'research_collab': 6, 'prize_challenge': 2, 'corporate': 4, 'aggregator': 0}
UA_POINTS = {'eligible': 14, 'eligible_with_partner': 8, 'unknown': 0, 'invitation_only': -4, 'unlikely': -30}

def fit(r):
    hay = ' '.join([r.get('funderName') or '', r.get('programName') or '', ' '.join(r.get('themes') or []),
                    r.get('notes') or '', r.get('eligibilityNote') or '', r.get('requirements') or '']).lower()
    score, reasons, seen = 0, [], set()
    for term, (pts, label) in THEMES.items():
        if term in hay and label not in seen:
            seen.add(label); score += pts; reasons.append(label)
    score = min(score, 58)
    geo = r.get('geography') or []
    gpts = max([GEO_POINTS.get(g, 0) for g in geo] + [0])
    if gpts: reasons.append('geography: ' + '/'.join(geo[:4]))
    score += gpts + CAT_POINTS.get(r['category'], 0) + UA_POINTS.get(r.get('uaEligibility'), 0)
    if r.get('openNow'): score += 5; reasons.append('open now')
    if (r.get('awardMaxUSD') or 0) >= 1_000_000: score += 5; reasons.append('large awards (>=$1M)')
    ua = r.get('uaEligibility')
    reasons.append({'eligible': 'UA directly eligible', 'eligible_with_partner': 'UA eligible with a partner',
                    'invitation_only': 'invitation-only (relationship play)', 'unknown': 'UA eligibility unconfirmed'}.get(ua, ''))
    raw = max(0, score)
    return raw, [x for x in reasons if x]

def requirements(txt):
    t = txt or ''
    low = t.lower()
    out = {'notes': t[:1200]} if t else {}
    out['loi'] = bool(re.search(r'letter of intent|\bloi\b|concept note|pre-?proposal|expression of interest|eoi', low))
    m = re.search(r'[^.]*\b(cost[- ]?shar\w*|matching funds?|match(?:ing)? (?:requirement|of))\b[^.]*\.?', t, re.I)
    if m: out['cost_share'] = m.group(0).strip()[:220]
    m = re.search(r'[^.]*\bindirect\b[^.]*\.?', t, re.I)
    if m: out['indirect_cap'] = m.group(0).strip()[:220]
    regs = [n for n, p in [('SAM.gov', r'sam\.gov|system for award'), ('UEI', r'\buei\b|unique entity'), ('Grants.gov', r'grants\.gov'),
                           ('Research.gov', r'research\.gov'), ('ORCID', r'orcid'), ('eRA Commons', r'era commons')] if re.search(p, low)]
    if regs: out['registrations'] = regs
    m = re.search(r'(\d+)[- ]page', low)
    if m: out['page_limit'] = m.group(0)
    return out

def partners(r):
    hay = ((r.get('eligibilityNote') or '') + ' ' + (r.get('notes') or '')).lower()
    geo = set(r.get('geography') or [])
    out = []
    if r.get('uaEligibility') == 'eligible_with_partner' and geo & {'LatAm', 'Americas', 'Mexico', 'Caribbean'}:
        out.append('AVS')
    return out

def norm(r):
    ua = {'ineligible': 'unlikely'}.get(r.get('uaEligibility'), r.get('uaEligibility') or 'unknown')
    cycle = {'invitation_only': 'invite_only', 'closed': 'closed_unknown'}.get(r.get('cycle'), r.get('cycle') or 'closed_unknown')
    page = r.get('pageType') or 'html_static'
    fetch = {'html_js': 'js_required'}.get(r.get('fetchability'), r.get('fetchability') or 'unknown')
    if fetch not in ('easy', 'bot_protected', 'login_required', 'js_required', 'blocked', 'unknown'): fetch = 'unknown'
    feed = r.get('feedUrl')
    if feed and ('#' in feed or 'docs' in feed): feed = None
    raw, reasons = fit(r)
    score = round(100 * (1 - math.exp(-raw / 45)))
    amax, amin = r.get('awardMaxUSD'), r.get('awardMinUSD')
    rec = {
        'name': r['funderName'].strip(), 'program': (r.get('programName') or '').strip() or None, 'category': r['category'],
        'url': r['url'].strip(), 'apply_url': r.get('applyUrl'), 'feed_url': feed,
        'geography': r.get('geography') or [], 'themes': r.get('themes') or [],
        'award_min_usd': amin, 'award_max_usd': amax, 'amount_confidence': r.get('amountConfidence') or 'unknown',
        'award_note': ('Award size not published; verify with the funder' if amax is None else None),
        'ua_eligibility': ua, 'cycle': cycle, 'next_deadline': r.get('nextDeadline'), 'open_now': r.get('openNow'),
        'requirements': requirements(r.get('requirements')), 'requirements_text': r.get('requirements'),
        'eligibility_note': r.get('eligibilityNote'), 'notes': r.get('notes'), 'partner_needed': partners(r),
        'fit_score': score, 'fit_reasons': reasons,
        'page_type': page if page in ('html_static', 'html_js', 'api', 'rss', 'pdf', 'other') else 'other',
        'fetchability': fetch, 'adapter': 'none' if page == 'api' else 'html',
        'confidence': r.get('confidence'), 'discovered_via': 'seed-2026-11-11', 'vetted_by': 'seed-verifier',
    }
    if r.get('verdict') == 'drop':
        rec.update(status='rejected', reject_reason=(r.get('dropReason') or 'dropped by verifier')[:400])
    elif ua == 'unlikely':
        rec.update(status='rejected', reject_reason='UA eligibility unlikely: ' + (r.get('eligibilityNote') or '')[:300])
    elif amax is not None and amax < MIN_AWARD:
        rec.update(status='rejected', reject_reason=f'Max award ${amax:,} is below the $200k floor')
    elif raw < VET_MIN_RAW:
        rec.update(status='candidate', vet_note=f'raw fit {raw} < {VET_MIN_RAW}: kept hidden until scoped')
    else:
        note = (r.get('notes') or '')[:240]
        rec.update(status='vetted', vet_note=f'Seed-verified 2026-11-11 (page fetched: {bool(r.get("sourceFetched"))}); fit {score}. {note}'.strip())
    return rec

def main(seed_dir, out_dir, batch=14):
    recs, seen = [], set()
    for f in sorted(glob.glob(os.path.join(seed_dir, 'verified_*.json'))):
        for r in json.load(open(f, encoding='utf8')):
            k = re.sub(r'[^a-z0-9]', '', r['url'].lower().replace('https://', '').replace('http://', '').replace('www.', ''))
            if k in seen: continue
            seen.add(k); recs.append(norm(r))
    os.makedirs(out_dir, exist_ok=True)
    json.dump(recs, open(os.path.join(out_dir, 'seed_funders.json'), 'w', encoding='utf8'), indent=1, ensure_ascii=False)
    for i in range(0, len(recs), batch):
        parts = []
        for r in recs[i:i + batch]:
            parts.append("select grants.register_source($j$%s$j$::jsonb, 'seed', 'seed-2026-11-11');" % json.dumps(r, ensure_ascii=False))
        open(os.path.join(out_dir, f'batch_{i // batch:02d}.sql'), 'w', encoding='utf8').write('\n'.join(parts) + '\n')
    from collections import Counter
    print(len(recs), Counter(r['status'] for r in recs))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 14)
