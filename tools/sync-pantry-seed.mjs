import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = {
  pantryId: "136e2b22-0c32-409e-89dd-fef216c8b94d",
  pantryBaseUrl: "https://getpantry.cloud/apiv1/pantry",
  baskets: {
    content: "salsav_site_content",
    audit: "salsav_admin_audit"
  }
};

function basketUrl(basketName) {
  return `${config.pantryBaseUrl}/${encodeURIComponent(config.pantryId)}/basket/${encodeURIComponent(basketName)}`;
}

function stripMetadata(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripMetadata);
  return Object.keys(value).reduce((next, key) => {
    if (key !== "_metadata") next[key] = stripMetadata(value[key]);
    return next;
  }, {});
}

function normalizeContent(payload) {
  const next = payload || {};
  next.pages = next.pages || {};
  next.collections = next.collections || {};
  next.collections.newsArticles = Array.isArray(next.collections.newsArticles) ? next.collections.newsArticles : [];
  next.collections.teamSections = Array.isArray(next.collections.teamSections) ? next.collections.teamSections : [];
  next.collections.teamMembers = Array.isArray(next.collections.teamMembers) ? next.collections.teamMembers : [];
  next.collections.teamSummaryRows = Array.isArray(next.collections.teamSummaryRows) ? next.collections.teamSummaryRows : [];
  next.collections.genericBlocks = next.collections.genericBlocks && typeof next.collections.genericBlocks === "object" ? next.collections.genericBlocks : {};
  next.layout = next.layout || {};
  next.layout.pages = next.layout.pages || {};
  return next;
}

function mergePlainObject(seed, remote, stats) {
  const seedObject = seed && typeof seed === "object" && !Array.isArray(seed) ? seed : {};
  const remoteObject = remote && typeof remote === "object" && !Array.isArray(remote) ? remote : {};
  const next = { ...seedObject };
  Object.keys(remoteObject).forEach((key) => {
    if (seedObject[key] && typeof seedObject[key] === "object" && !Array.isArray(seedObject[key]) && remoteObject[key] && typeof remoteObject[key] === "object" && !Array.isArray(remoteObject[key])) {
      next[key] = mergePlainObject(seedObject[key], remoteObject[key], stats);
    } else {
      next[key] = remoteObject[key];
    }
  });
  Object.keys(seedObject).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(remoteObject, key)) stats.seededFields += 1;
  });
  return next;
}

function mergeArrayById(seedItems, remoteItems, stats) {
  const seed = Array.isArray(seedItems) ? seedItems : [];
  const remote = Array.isArray(remoteItems) ? remoteItems : [];
  const remoteById = new Map(remote.filter((item) => item && item.id).map((item) => [item.id, item]));
  const seedIds = new Set(seed.filter((item) => item && item.id).map((item) => item.id));
  const merged = seed.map((item) => {
    const remoteItem = item && item.id ? remoteById.get(item.id) : null;
    if (!remoteItem) {
      stats.seededItems += 1;
      return item;
    }
    return mergePlainObject(item, remoteItem, stats);
  });
  remote.forEach((item) => {
    if (!item || !item.id || !seedIds.has(item.id)) merged.push(item);
  });
  return merged;
}

function mergeGenericBlocks(seedBlocks, remoteBlocks, stats) {
  const next = {};
  const keys = new Set([
    ...Object.keys(seedBlocks || {}),
    ...Object.keys(remoteBlocks || {})
  ]);
  keys.forEach((key) => {
    next[key] = mergeArrayById((seedBlocks || {})[key], (remoteBlocks || {})[key], stats);
  });
  return next;
}

function mergeSeedContent(seedPayload, remotePayload) {
  const seed = normalizeContent(stripMetadata(seedPayload));
  const remote = normalizeContent(stripMetadata(remotePayload));
  const stats = { seededFields: 0, seededItems: 0 };
  const merged = mergePlainObject(seed, remote, stats);
  merged.pages = mergePlainObject(seed.pages, remote.pages, stats);
  merged.collections = mergePlainObject(seed.collections, remote.collections, stats);
  merged.collections.newsArticles = mergeArrayById(seed.collections.newsArticles, remote.collections.newsArticles, stats);
  merged.collections.teamSections = mergeArrayById(seed.collections.teamSections, remote.collections.teamSections, stats);
  merged.collections.teamMembers = mergeArrayById(seed.collections.teamMembers, remote.collections.teamMembers, stats);
  merged.collections.teamSummaryRows = mergeArrayById(seed.collections.teamSummaryRows, remote.collections.teamSummaryRows, stats);
  merged.collections.genericBlocks = mergeGenericBlocks(seed.collections.genericBlocks, remote.collections.genericBlocks, stats);
  merged.layout = mergePlainObject(seed.layout, remote.layout, stats);
  merged.layout.pages = mergePlainObject(seed.layout.pages, remote.layout.pages, stats);
  merged.version = Math.max(Number(seed.version || 0), Number(remote.version || 0)) + 1;
  merged.updatedAt = new Date().toISOString();
  return { merged: normalizeContent(merged), stats };
}

async function readBasket(basketName, fallback) {
  const response = await fetch(basketUrl(basketName), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) return fallback;
  return response.json().catch(() => fallback);
}

async function saveBasket(basketName, payload) {
  const response = await fetch(basketUrl(basketName), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ...stripMetadata(payload), updatedAt: new Date().toISOString() })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${basketName} save failed: ${response.status} ${text || response.statusText}`);
  }
}

async function appendAudit(event) {
  const audit = await readBasket(config.baskets.audit, { version: 1, events: [] });
  const events = Array.isArray(audit.events) ? audit.events : [];
  events.push({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    source: "seed-sync",
    ...event
  });
  await saveBasket(config.baskets.audit, { ...audit, events: events.slice(-300) });
}

const seed = JSON.parse(fs.readFileSync(path.join(root, "cms", "seed-content.json"), "utf8"));
const remote = await readBasket(config.baskets.content, {});
const { merged, stats } = mergeSeedContent(seed, remote);
await saveBasket(config.baskets.content, merged);
await appendAudit({
  type: "seed_imported",
  entityType: "site",
  entityId: config.baskets.content,
  label: `Merged fallback seed (${stats.seededItems} items, ${stats.seededFields} fields)`
});

console.log(JSON.stringify({
  ok: true,
  seededItems: stats.seededItems,
  seededFields: stats.seededFields,
  newsArticles: merged.collections.newsArticles.length,
  teamMembers: merged.collections.teamMembers.length,
  teamSummaryRows: merged.collections.teamSummaryRows.length,
  genericBlockLists: Object.keys(merged.collections.genericBlocks).length,
  version: merged.version,
  updatedAt: merged.updatedAt
}, null, 2));
