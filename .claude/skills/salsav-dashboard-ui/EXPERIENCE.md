# Experience (append-only; harness.py skill log)

## 2026-11-12 created
situation: reflect create
lesson: Root cause of three triaged UI bugs: the el() helper dropped aria booleans, so active-state CSS never applied. Also records the verify-on-live workflow that caught it.
evidence: reflect R20261112T172305-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: The Unverified calls chip became a show/hide toggle; the working pattern (button, aria-pressed from state, inverted stored flag gating the data) is reusable for other dashboard layer toggles.
evidence: reflect R20261112T174015-747f15c5

## 2026-11-12 revise
situation: reflect patch
lesson: A JS-only live change cannot be confirmed by polling dashboard.css; polling the HTML for a new string showed the new build was live before the live test.
evidence: reflect R20261112T174015-747f15c5
