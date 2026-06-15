(function () {
  const config = window.SALSAV_CMS_CONFIG || {};
  const baskets = config.baskets || {};
  let seedContentPromise = null;
  const basketCooldowns = new Map();
  const cooldownStorageKey = `${config.sessionKey || "salsav_cms"}_pantry_cooldowns`;

  function readStoredCooldowns() {
    try {
      return JSON.parse(sessionStorage.getItem(cooldownStorageKey) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function writeStoredCooldown(basketName, until) {
    try {
      const stored = readStoredCooldowns();
      stored[basketName] = until;
      sessionStorage.setItem(cooldownStorageKey, JSON.stringify(stored));
    } catch (error) {
      // Session storage is best-effort only.
    }
  }

  function cooldownMsForError(errorOrStatus) {
    const text = String(errorOrStatus?.message || errorOrStatus || "");
    if (/429|too many|rate/i.test(text)) return 120000;
    if (/failed to fetch|cors|network|temporarily unavailable/i.test(text)) return 45000;
    return 15000;
  }

  function markBasketCooldown(basketName, errorOrStatus) {
    const ms = cooldownMsForError(errorOrStatus);
    const until = Date.now() + ms;
    basketCooldowns.set(basketName, until);
    writeStoredCooldown(basketName, until);
    return ms;
  }

  function assertBasketReady(basketName) {
    const until = Math.max(basketCooldowns.get(basketName) || 0, Number(readStoredCooldowns()[basketName] || 0));
    if (Date.now() < until) {
      const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
      throw new Error(`Pantry basket "${basketName}" is rate limited; retrying in ${seconds}s.`);
    }
  }

  function cloneWithoutMetadata(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(cloneWithoutMetadata);
    return Object.keys(value).reduce((next, key) => {
      if (key !== "_metadata") next[key] = cloneWithoutMetadata(value[key]);
      return next;
    }, {});
  }

  function basketUrl(basketName) {
    if (!config.pantryId || !config.pantryBaseUrl) {
      throw new Error("SALSAV CMS Pantry configuration is missing.");
    }
    return `${config.pantryBaseUrl}/${encodeURIComponent(config.pantryId)}/basket/${encodeURIComponent(basketName)}`;
  }

  async function requestBasket(basketName, options) {
    assertBasketReady(basketName);
    let response;
    try {
      response = await fetch(basketUrl(basketName), options);
    } catch (error) {
      markBasketCooldown(basketName, error);
      throw new Error(`Unable to reach Pantry basket "${basketName}" because Pantry is rate limited or blocked by CORS. ${error.message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 429) markBasketCooldown(basketName, `${response.status} ${text || response.statusText}`);
      throw new Error(`Pantry basket "${basketName}" returned ${response.status}: ${text || response.statusText}`);
    }

    if (response.status === 204) return {};
    return response.json().catch(() => ({}));
  }

  async function getBasket(basketName) {
    const payload = await requestBasket(basketName, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    return cloneWithoutMetadata(payload || {});
  }

  async function saveBasket(basketName, payload) {
    const nextPayload = {
      ...(cloneWithoutMetadata(payload || {})),
      updatedAt: new Date().toISOString()
    };
    await requestBasket(basketName, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(nextPayload)
    });
    return nextPayload;
  }

  function normalizeContentPayload(payload) {
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

  async function getSeedContent() {
    if (seedContentPromise) return seedContentPromise;
    seedContentPromise = fetch("cms/seed-content.json", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => payload ? normalizeContentPayload(cloneWithoutMetadata(payload)) : null)
      .catch(() => null);
    return seedContentPromise;
  }

  function mergePlainObject(seed, remote, state) {
    const seedObject = seed && typeof seed === "object" && !Array.isArray(seed) ? seed : {};
    const remoteObject = remote && typeof remote === "object" && !Array.isArray(remote) ? remote : {};
    const next = { ...seedObject };
    Object.keys(remoteObject).forEach((key) => {
      if (seedObject[key] && typeof seedObject[key] === "object" && !Array.isArray(seedObject[key]) && remoteObject[key] && typeof remoteObject[key] === "object" && !Array.isArray(remoteObject[key])) {
        next[key] = mergePlainObject(seedObject[key], remoteObject[key], state);
      } else {
        next[key] = remoteObject[key];
      }
    });
    Object.keys(seedObject).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(remoteObject, key)) state.seeded = true;
    });
    return next;
  }

  function mergeArrayById(seedItems, remoteItems, state) {
    const seed = Array.isArray(seedItems) ? seedItems : [];
    const remote = Array.isArray(remoteItems) ? remoteItems : [];
    const remoteById = new Map(remote.filter((item) => item && item.id).map((item) => [item.id, item]));
    const seedIds = new Set(seed.filter((item) => item && item.id).map((item) => item.id));
    const merged = seed.map((item) => {
      const remoteItem = item && item.id ? remoteById.get(item.id) : null;
      if (!remoteItem) {
        state.seeded = true;
        return item;
      }
      return mergePlainObject(item, remoteItem, state);
    });
    remote.forEach((item) => {
      if (!item || !item.id || !seedIds.has(item.id)) merged.push(item);
    });
    return merged;
  }

  function mergeGenericBlocks(seedBlocks, remoteBlocks, state) {
    const next = {};
    const keys = new Set([
      ...Object.keys(seedBlocks || {}),
      ...Object.keys(remoteBlocks || {})
    ]);
    keys.forEach((key) => {
      next[key] = mergeArrayById((seedBlocks || {})[key], (remoteBlocks || {})[key], state);
    });
    return next;
  }

  function mergeSeedContent(remotePayload, seedPayload) {
    const remote = normalizeContentPayload(remotePayload || {});
    if (!seedPayload) return remote;
    const seed = normalizeContentPayload(cloneWithoutMetadata(seedPayload));
    const state = { seeded: false };
    const merged = mergePlainObject(seed, remote, state);
    merged.pages = mergePlainObject(seed.pages, remote.pages, state);
    merged.collections = mergePlainObject(seed.collections, remote.collections, state);
    merged.collections.newsArticles = mergeArrayById(seed.collections.newsArticles, remote.collections.newsArticles, state);
    merged.collections.teamSections = mergeArrayById(seed.collections.teamSections, remote.collections.teamSections, state);
    merged.collections.teamMembers = mergeArrayById(seed.collections.teamMembers, remote.collections.teamMembers, state);
    merged.collections.teamSummaryRows = mergeArrayById(seed.collections.teamSummaryRows, remote.collections.teamSummaryRows, state);
    merged.collections.genericBlocks = mergeGenericBlocks(seed.collections.genericBlocks, remote.collections.genericBlocks, state);
    merged.layout = mergePlainObject(seed.layout, remote.layout, state);
    merged.layout.pages = mergePlainObject(seed.layout.pages, remote.layout.pages, state);
    Object.defineProperty(merged, "__seedMerged", {
      value: state.seeded,
      enumerable: false,
      configurable: true
    });
    return normalizeContentPayload(merged);
  }

  async function getContent() {
    const payload = normalizeContentPayload(await getBasket(baskets.content));
    const seed = await getSeedContent();
    return mergeSeedContent(payload, seed);
  }

  async function saveContent(payload) {
    return saveBasket(baskets.content, payload);
  }

  async function getSettings() {
    return getBasket(baskets.settings);
  }

  async function saveSettings(payload) {
    return saveBasket(baskets.settings, payload);
  }

  async function getAuth() {
    return getBasket(baskets.auth);
  }

  async function getAudit() {
    try {
      return await getBasket(baskets.audit);
    } catch (error) {
      return { version: 1, updatedAt: null, events: [] };
    }
  }

  async function saveAudit(payload) {
    const nextPayload = { version: 1, events: [], ...(payload || {}) };
    nextPayload.events = Array.isArray(nextPayload.events) ? nextPayload.events.slice(-300) : [];
    return saveBasket(baskets.audit, nextPayload);
  }

  async function appendAuditEvents(eventsToAppend) {
    const nextEvents = (Array.isArray(eventsToAppend) ? eventsToAppend : [eventsToAppend]).filter(Boolean);
    if (!nextEvents.length) return null;
    const audit = await getBasket(baskets.audit);
    const events = Array.isArray(audit.events) ? audit.events : [];
    nextEvents.forEach((event) => events.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...(event || {})
    }));
    return saveAudit({ ...audit, events: events.slice(-300) });
  }

  async function appendAudit(event) {
    return appendAuditEvents([event]);
  }

  async function getDrafts() {
    try {
      return await getBasket(baskets.drafts);
    } catch (error) {
      return { version: 1, updatedAt: null, drafts: [] };
    }
  }

  async function saveDrafts(payload) {
    return saveBasket(baskets.drafts, payload);
  }

  window.SALSAVPantry = {
    getBasket,
    saveBasket,
    getContent,
    saveContent,
    getSettings,
    saveSettings,
    getAuth,
    getAudit,
    saveAudit,
    appendAudit,
    appendAuditEvents,
    getDrafts,
    saveDrafts,
    stripMetadata: cloneWithoutMetadata
  };
})();
