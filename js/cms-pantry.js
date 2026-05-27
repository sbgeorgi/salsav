(function () {
  const config = window.SALSAV_CMS_CONFIG || {};
  const baskets = config.baskets || {};

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
    let response;
    try {
      response = await fetch(basketUrl(basketName), options);
    } catch (error) {
      throw new Error(`Unable to reach Pantry basket "${basketName}": ${error.message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
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

  async function getContent() {
    const payload = await getBasket(baskets.content);
    payload.pages = payload.pages || {};
    payload.collections = payload.collections || {};
    payload.collections.newsArticles = Array.isArray(payload.collections.newsArticles) ? payload.collections.newsArticles : [];
    payload.collections.teamSections = Array.isArray(payload.collections.teamSections) ? payload.collections.teamSections : [];
    payload.collections.teamMembers = Array.isArray(payload.collections.teamMembers) ? payload.collections.teamMembers : [];
    payload.collections.teamSummaryRows = Array.isArray(payload.collections.teamSummaryRows) ? payload.collections.teamSummaryRows : [];
    payload.collections.genericBlocks = payload.collections.genericBlocks && typeof payload.collections.genericBlocks === "object" ? payload.collections.genericBlocks : {};
    payload.layout = payload.layout || {};
    payload.layout.pages = payload.layout.pages || {};
    return payload;
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

  async function appendAudit(event) {
    const audit = await getAudit();
    const events = Array.isArray(audit.events) ? audit.events : [];
    events.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...(event || {})
    });
    return saveAudit({ ...audit, events: events.slice(-300) });
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
    getDrafts,
    saveDrafts,
    stripMetadata: cloneWithoutMetadata
  };
})();
