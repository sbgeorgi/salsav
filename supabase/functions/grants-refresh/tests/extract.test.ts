import assert from "node:assert/strict";
import { test } from "node:test";
import { computeChange, MAX_DIFF_ITEMS, MAX_ITEM_CHARS, units } from "../diff.ts";
import { extractPage, findAmount, findDeadlines, normalizeText, parseDate, sha256Hex } from "../extract.ts";
import { page } from "./helpers.ts";

const TODAY = "2027-01-10";

const DEADLINES: [string, string | null, string | null][] = [
  // text, expected future, expected primary
  ["Deadline: March 15, 2027", "2027-03-15", "2027-03-15"],
  ["Applications are due 15 March 2027.", "2027-03-15", "2027-03-15"],
  ["Submit by 2027-03-15", "2027-03-15", "2027-03-15"],
  ["Proposals due 3/15/2027", "2027-03-15", "2027-03-15"],
  ["Closes Mar. 15, 2027", "2027-03-15", "2027-03-15"],
  ["Letter of intent due February 1, 2027; full proposal due April 1, 2027", "2027-02-01", "2027-02-01"],
  ["Posted March 1, 2027. Deadline: June 1, 2027", "2027-06-01", "2027-06-01"],
  ["Deadline: March 15, 2026", null, "2026-03-15"],
  ["Webinar on March 15, 2027", null, null],
  ["Applications open March 1, 2027 and close April 1, 2027", "2027-04-01", "2027-04-01"],
  ["March 15th, 2027 (deadline)", "2027-03-15", "2027-03-15"],
  ["2027-03-15 - deadline", "2027-03-15", "2027-03-15"],
  ["Close date: 1 April 2027", "2027-04-01", "2027-04-01"],
  ["Full proposals are due by September 30, 2027", "2027-09-30", "2027-09-30"],
  ["Submission date: Sept. 5, 2027", "2027-09-05", "2027-09-05"],
  ["Feb 30, 2027 deadline", null, null],
  ["deadline 15/03/2027", null, null],
  ["Due 3/15/27", "2027-03-15", "2027-03-15"],
  ["Deadline\nMarch 15, 2027", "2027-03-15", "2027-03-15"],
  ["Application deadline extended to April 20, 2027", "2027-04-20", "2027-04-20"],
  ["The call closed on 2026-12-01; next deadline: 2027-06-30", "2027-06-30", "2027-06-30"],
  ["Deadline: 2027-01-10", "2027-01-10", "2027-01-10"],
  ["Deadline: January 9, 2027", null, "2027-01-09"],
  ["Letters of intent: 1 March 2027", "2027-03-01", "2027-03-01"],
  ["Deadline for questions: Feb 1, 2027. Proposals due: Mar 1, 2027.", "2027-02-01", "2027-02-01"],
  ["Open March 1 - April 15, 2027", null, null],
  ["Received by 5:00 pm on June 3, 2027", "2027-06-03", "2027-06-03"],
  ["deadline 1999-01-01", null, null],
  ["DEADLINE: JUNE 3, 2027", "2027-06-03", "2027-06-03"],
  ["Meeting on April 2, 2027. Awards announced May 1, 2027.", null, null],
  ["Deadline: March 1, 2027 | Notification: June 1, 2027", "2027-03-01", "2027-03-01"],
  // B: only explicit deadline phrasing labels a date; far-future dates are placeholders
  ["Round 1 closed Oct 7, 2026. Round 2 opens Feb 3, 2027.", null, null],
  ["Entries received by mail Jan 15, 2027", null, null],
  ["Round 1 closed Oct 7, 2026; Deadline: March 15, 2027", "2027-03-15", "2027-03-15"],
  ["Proposals due: Mar 1, 2027; deadline extended to Feb 1, 2027", "2027-02-01", "2027-02-01"],
  ["Deadline: June 1, 2030", null, null],
  ["Deadline: June 1, 2029", "2029-06-01", "2029-06-01"],
];
for (const [text, future, primary] of DEADLINES) {
  test(`deadline: ${JSON.stringify(text)}`, () => {
    const d = findDeadlines(text, TODAY);
    assert.equal(d.future, future);
    assert.equal(d.primary, primary);
  });
}

const AMOUNTS: [string, number | null, string?][] = [
  ["Awards up to $1.5 million", 1_500_000],
  ["Grants of $250,000 are available", 250_000],
  ["up to $500K per project", 500_000],
  ["Funding: €2 million", 2_000_000, "EUR"],
  ["Maximum award of USD 75,000", 75_000],
  ["Awards of 100,000 USD", 100_000],
  ["Total budget $20M; awards up to $750,000", 750_000],
  ["Registration fee $50", null],
  ["Awards up to $1.2 billion", 1_200_000_000],
  ["Awards range from $50,000 to $200,000", 200_000],
  ["Up to £30,000 per year", 30_000, "GBP"],
  ["The conference had $5 million in sales", null],
  ["Each grant up to $2.5M", 2_500_000],
];
for (const [text, value, cur] of AMOUNTS) {
  test(`amount: ${JSON.stringify(text)}`, () => {
    const a = findAmount(text);
    assert.equal(a?.value ?? null, value);
    if (cur) assert.equal(a?.currency, cur);
  });
}

test("parseDate handles the supported formats", () => {
  assert.equal(parseDate("03/15/2027"), "2027-03-15");
  assert.equal(parseDate("2027-03-15T12:00:00Z"), "2027-03-15");
  assert.equal(parseDate("Mar. 5, 2027"), "2027-03-05");
  assert.equal(parseDate(""), null);
  assert.equal(parseDate("soon"), null);
});

test("normalizeText drops volatile lines and tokens", () => {
  const t = normalizeText("Hello   world\n\nLast updated: May 4, 2026\n© 2026 Foo Inc\nsessionid=abc123 keep\nid d41d8cd98f00b204e9800998ecf8427e x");
  assert.equal(t, "Hello world\nkeep\nid x");
});

const doc = (extra: string, footer = "© 2026 Foo") =>
  `<html><body><header>Site header</header><nav><a href="/x">Menu</a></nav><div class="cookie-banner">We use cookies</div>
   <main><h1>Grant</h1><p>Apply for funding in the main text. ${extra}</p>
   <p>Padding paragraph to make main long enough. ${"Lorem ipsum dolor sit amet. ".repeat(12)}</p>
   <a href="/files/guide.pdf">Guidelines PDF</a><a href="/files/guide.pdf#page=2">dup</a><a href="mailto:x@y.org">mail</a>
   <a href="/apply">How to apply</a><a href="/about">About us</a><a href="http://other.org/f.DOCX">Template</a><a href="/data.xlsx">Budget</a><a href="/all.zip">All</a></main>
   <footer>${footer}</footer><script>var secret='tracking'</script><style>.a{}</style></body></html>`;

test("extractPage keeps main content, drops chrome, captures typed links once", () => {
  const { text, links } = extractPage(doc("Alpha."), "https://f.org/grants/");
  assert.match(text, /Apply for funding in the main text\. Alpha\./);
  for (const bad of ["Site header", "Menu", "cookies", "tracking", "Foo"]) assert.ok(!text.includes(bad), bad);
  assert.deepEqual(links.map((l) => [l.url, l.type]), [
    ["https://f.org/files/guide.pdf", "pdf"], ["https://f.org/apply", "page"], ["http://other.org/f.DOCX", "doc"],
    ["https://f.org/data.xlsx", "xls"], ["https://f.org/all.zip", "zip"],
  ]);
  assert.equal(links[0].label, "Guidelines PDF");
});

test("extractPage: a thin <main> beside the real content falls back to the body; chrome and cmplz banners stay out, nav links stay captured", () => {
  const html = `<html><body><header>Site header</header><nav><a href="/rfp/2026">Open RFP</a></nav>
   <div id="cmplz-cookiebanner-container"><div>Manage Consent We use cookies to store data</div></div>
   <div class="alerts"><h2>Important notice</h2><p>${"Proposals are due in the fall and must follow the guide. ".repeat(8)}</p></div>
   <main><h1>Program</h1><p>${"Short intro text for the program page. ".repeat(7)}</p></main>
   <footer>Footer address</footer></body></html>`;
  const { text, links } = extractPage(html, "https://f.org/");
  assert.match(text, /Important notice/);
  assert.match(text, /Proposals are due in the fall/);
  assert.match(text, /Short intro text/);
  for (const bad of ["Site header", "Footer address", "Manage Consent", "Open RFP"]) assert.ok(!text.includes(bad), bad);
  assert.deepEqual(links.map((l) => l.url), ["https://f.org/rfp/2026"]);
});

test("extractPage: a main holding most of the page text is still preferred over side text", () => {
  const html = `<html><body><div>Side promo</div><main><p>${"Real program content lives here. ".repeat(20)}</p></main></body></html>`;
  assert.ok(!extractPage(html, "https://f.org/").text.includes("Side promo"));
});

test("content hash ignores volatile bits but not real changes", async () => {
  const a = await sha256Hex(extractPage(doc("Alpha.", "© 2026 Foo"), "https://f.org/").text);
  const b = await sha256Hex(extractPage(doc("Alpha.", "© 2027 Foo Inc. All rights reserved"), "https://f.org/").text);
  const c = await sha256Hex(extractPage(doc("Alpha changed."), "https://f.org/").text);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test("link capture caps at 60 and dedupes", () => {
  const html = page(Array.from({ length: 150 }, (_, i) => `<a href="/f${i % 100}.pdf">f${i}</a>`).join(""));
  assert.equal(extractPage(html, "https://f.org/").links.length, 60);
});

test("huge pages are parsed within the 600KB cap and stay cheap", () => {
  const big = page("<p>" + "word ".repeat(600_000) + "</p><p>TAIL-MARKER</p>");
  const t0 = process.cpuUsage();
  const { text } = extractPage(big, "https://f.org/");
  const cpuMs = (process.cpuUsage(t0).user + process.cpuUsage(t0).system) / 1000;
  assert.ok(text.length <= 600_000);
  assert.ok(!text.includes("TAIL-MARKER"));
  assert.ok(cpuMs < 1500, `cpu ${cpuMs}ms`);
  console.log(`# parse 600KB page: ${Math.round(cpuMs)}ms CPU`);
});

// ---------- diff ----------
const L = (...u: string[]) => u.map((url) => ({ url, label: url, type: "pdf" as const }));

test("units splits sentences and lines", () => {
  assert.deepEqual(units("One sentence. Another one!\nThird line"), ["One sentence.", "Another one!", "Third line"]);
});

test("first fetch is 'initial' and carries found deadline/amount", () => {
  const c = computeChange(null, { text: "Deadline: March 15, 2027\nAwards up to $1 million", links: [] }, TODAY, true);
  assert.equal(c.kind, "initial");
  assert.deepEqual(c.diff.deadline, { from: null, to: "2027-03-15" });
  assert.equal(c.diff.amount?.to, 1_000_000);
});

test("deadline change wins and summary matches the spec example", () => {
  const prev = { text: "Deadline: February 1, 2027\nShared line.", links: L("https://a/1.pdf") };
  const cur = { text: "Deadline: March 15, 2027\nShared line.\nA new sentence.", links: L("https://a/1.pdf", "https://a/2.pdf", "https://a/3.pdf") };
  const c = computeChange(prev, cur, TODAY, true);
  assert.equal(c.kind, "deadline");
  assert.equal(c.summary, "New deadline 2027-03-15 (was 2027-02-01); 2 new documents");
  assert.deepEqual(c.diff.deadline, { from: "2027-02-01", to: "2027-03-15" });
  assert.equal(c.diff.docs_added?.length, 2);
  assert.deepEqual(c.diff.added, ["Deadline: March 15, 2027", "A new sentence."]);
  assert.deepEqual(c.diff.removed, ["Deadline: February 1, 2027"]);
});

test("precedence: amount > docs > content", () => {
  const base = { text: "Awards up to $100,000. Stable.", links: [] };
  const amount = computeChange(base, { text: "Awards up to $200,000. Stable.", links: L("https://a/x.pdf") }, TODAY, true);
  assert.equal(amount.kind, "amount");
  assert.deepEqual(amount.diff.amount, { from: 100_000, to: 200_000, currency: "USD" });
  const docs = computeChange(base, { ...base, links: L("https://a/x.pdf") }, TODAY, true);
  assert.equal(docs.kind, "docs");
  assert.equal(docs.summary, "1 new document");
  const content = computeChange(base, { text: "Awards up to $100,000. Stable. More text here.", links: [] }, TODAY, true);
  assert.equal(content.kind, "content");
  assert.match(content.summary, /^Page content changed \(\+1\/-0 lines\)$/);
});

test("deadline removed is reported; feeds (withDates=false) never produce deadline/amount kinds", () => {
  const removed = computeChange({ text: "Deadline: March 15, 2027", links: [] }, { text: "Closed for now", links: [] }, TODAY, true);
  assert.equal(removed.kind, "deadline");
  assert.match(removed.summary, /Deadline removed \(was 2027-03-15\)/);
  const feed = computeChange({ text: "a | Deadline: March 15, 2027", links: [] }, { text: "b | up to $5 million", links: [] }, TODAY, false);
  assert.equal(feed.kind, "content");
});

test("diff lists are capped at 40 items and 300 chars", () => {
  const many = Array.from({ length: 100 }, (_, i) => `Line number ${i} ${"x".repeat(400)}`).join("\n");
  const c = computeChange({ text: "old", links: [] }, { text: many, links: [] }, TODAY, true);
  assert.equal(c.diff.added?.length, MAX_DIFF_ITEMS);
  assert.ok(c.diff.added!.every((x) => x.length <= MAX_ITEM_CHARS));
});

test("identical sets of lines in a different order are not additions", () => {
  const c = computeChange({ text: "A line.\nB line.", links: [] }, { text: "B line.\nA line.\nC line.", links: [] }, TODAY, true);
  assert.deepEqual(c.diff.added, ["C line."]);
  assert.deepEqual(c.diff.removed, []);
});

// F: countdowns and relative times do not change the content hash
test("volatile countdown / relative-time text does not change the normalized text", () => {
  const page = (extra: string) => `<html><body><main><h1>Call</h1><p>Deadline: March 15, 2027 ${extra}</p><p>${extra ? "Posted 3 days ago" : "Posted 9 days ago"}</p><p>Awards up to $100,000 for solar projects over a long period of time.</p><p>Closes in ${extra ? "40" : "41"} days</p><p>© ${extra ? "2026" : "2027"} Funder</p></main></body></html>`;
  const a = extractPage(page("(45 days left)"), "https://f.org/").text;
  const b = extractPage(page(""), "https://f.org/").text;
  assert.equal(a, b);
  assert.match(a, /Deadline: March 15, 2027/);
  assert.equal(findDeadlines(a, TODAY).future, "2027-03-15");
  assert.equal(normalizeText(["Days left: 12", "12 hours remaining", "Updated 5 minutes ago", "Real content stays"].join(String.fromCharCode(10))), "Real content stays");
});

// ---- round 2: bounded CPU on a 600,000-character page (each case took 3 to 40 seconds before) ----
import { assertShallow, MAX_NESTING, PageWorkError } from "../extract.ts";
import { RegexBudgetError } from "../safe_regex.ts";

const fast = <T>(f: () => T, ms = 1500): T => {
  const t = performance.now();
  const r = f();
  const took = performance.now() - t;
  assert.ok(took < ms, `took ${Math.round(took)} ms`);
  return r;
};

test("normalizeText: a long run of whitespace after 'days left' is linear, and a countdown with a colon is still removed", () => {
  assert.equal(normalizeText("days left : 12 end"), "end");
  assert.equal(normalizeText("hours remaining:12 end"), "end");
  for (const sp of [" ", "\u00a0", "\t"]) assert.equal(fast(() => normalizeText("day left" + sp.repeat(590_000) + "x")), "day left x");
  assert.equal(fast(() => normalizeText("day left" + " ".repeat(300_000) + ":" + " ".repeat(300_000) + "x")), "day left : x");
});

test("findAmount: a long thousands chain without a currency word is linear; a chain with one still reads whole", () => {
  assert.equal(fast(() => findAmount("Grants up to 1" + ",111".repeat(150_000) + " x")), null);
  assert.deepEqual(findAmount("Awards of up to 1,234,567 USD each"), { value: 1234567, currency: "USD" });
});

test("extractPage: many sibling blocks, <br>, <nav> and <script> elements are linear", () => {
  for (const s of ["<p>x</p>", "<br>", "<nav>x</nav>", "<script>1</script>", "<li>x"]) {
    const out = fast(() => extractPage("<html><body>" + s.repeat(Math.ceil(590_000 / s.length)) + "</body></html>", "https://e.org/"), 2500);
    assert.ok(out.text.length === 0 || out.text.startsWith("x"), s);
  }
});

test("extractPage keeps its line structure without mutating the tree", () => {
  const h = "<body><p>a</p><nav>no</nav><p>b<br>c</p><script>1</script><table><tr><td>d</td><td>e</td></tr></table><footer>no</footer><div>f</div></body>";
  assert.equal(JSON.stringify(extractPage(h, "https://e.org/").raw), JSON.stringify("\na\n\nb\nc\n\n\nd e \n\n\nf\n"));
  assert.equal(extractPage(h, "https://e.org/").text, "a\nb\nc\nd e\nf");
});

test("nesting: a page nested deeper than MAX_NESTING is refused at once, real shapes are not", () => {
  for (const s of ["<div>x", "<b>x", "<ul><li>x", "<table><td>x", "<span>"]) {
    const h = s.repeat(Math.ceil(590_000 / s.length));
    const err = fast(() => assert.throws(() => extractPage(h, "https://e.org/"), PageWorkError), 500);
    assert.ok(err === undefined);
  }
  assert.ok(new PageWorkError("x") instanceof RegexBudgetError); // every "never throws" caller lets it through
  const ok = (h: string) => assert.doesNotThrow(() => assertShallow(h));
  ok("<div>".repeat(MAX_NESTING) + "</div>".repeat(MAX_NESTING));
  ok("<p>x".repeat(50_000)); // an unclosed <p> or <li> does not nest
  ok("<li>x<tr><td>y".repeat(20_000));
  ok("<svg>" + '<path d="M0 0"/>'.repeat(5000) + "</svg>");
  ok("<script>" + "<div>".repeat(5000) + "</script><!-- " + "<div>".repeat(5000) + " --><div title='" + "<div>".repeat(3000) + "'>x</div>");
  ok("</div>".repeat(100_000) + "<div>".repeat(500)); // stray end tags
  assert.throws(() => assertShallow("<div>".repeat(MAX_NESTING + 1)), PageWorkError);
});
