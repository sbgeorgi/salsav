(function () {
  const config = window.SALSAV_CMS_CONFIG || {};
  const modes = ["text", "move", "resize", "blocks", "preview"];
  const safeAttrs = ["alt", "title", "aria-label", "placeholder", "content", "src"];
  const allowedRichClasses = new Set(["cms-accent", "cms-muted", "cms-highlight", "cms-small", "cms-bold", "cms-italic"]);
  const allowedRichTags = new Set(["A", "STRONG", "B", "EM", "I", "U", "BR", "SPAN", "SUP", "SUB", "SMALL", "P", "UL", "OL", "LI", "BLOCKQUOTE"]);
  const fallbackImage = "static/salsa-logo.png";
  const syncIntervalMs = 3000;
  const textSaveDelayMs = 650;
  const collectionLabels = {
    newsArticle: "News card",
    teamMember: "Team card",
    teamSummaryRow: "Summary row",
    genericBlock: "Block",
    headingBlock: "Heading",
    textBlock: "Text",
    imageBlock: "Image",
    buttonBlock: "Button"
  };
  const fieldLabels = {
    title: "Headline",
    category: "Category",
    source: "Source",
    displayDate: "Date",
    date: "Date",
    description: "Summary",
    url: "Link",
    name: "Name",
    affiliation: "Affiliation",
    expertise: "Expertise",
    profileUrl: "Profile link",
    imageSrc: "Image",
    imageAlt: "Image description"
  };

  const editorState = {
    mode: "text",
    pageId: "",
    targets: new Map(),
    canvases: new Map(),
    hoveredTargetId: null,
    selectedTargetId: null,
    selectedCanvasId: null,
    isDragging: false,
    isResizing: false,
    dirty: false,
    content: null,
    baseContent: null,
    overlay: null,
    hoverBox: null,
    selectedBox: null,
    dropIndicator: null,
    actionLayer: null,
    formatToolbar: null,
    imageChip: null,
    imagePopover: null,
    raf: 0,
    drag: null,
    pendingDrag: null,
    resize: null,
    inline: null,
    quill: null,
    quillLoaded: false,
    activeField: null,
    saveQueue: Promise.resolve(),
    syncTimer: 0,
    syncInFlight: null,
    syncStatus: "idle",
    lastSavedAt: null,
    lastSyncErrorAt: 0,
    syncBackoffMs: 0,
    syncBackoffUntil: 0,
    changeId: 0,
    seedMerged: false,
    seedSyncQueued: false,
    pendingAudits: [],
    history: [],
    historyIndex: -1,
    suppressHistory: false
  };

  function pageId() {
    return window.SALSAV_CMS_PAGE_ID || (window.SALSAVCMSCore && window.SALSAVCMSCore.inferPageId()) || document.body?.dataset.cmsPage || "index";
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(config.sessionKey);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !session.expiresAt || Date.now() > Number(session.expiresAt)) {
        sessionStorage.removeItem(config.sessionKey);
        return null;
      }
      return session;
    } catch (error) {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function slug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 72) || "item";
  }

  function isSafeUrl(value, imageOnly) {
    const url = String(value || "").trim();
    if (!url) return true;
    if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return true;
    if (!imageOnly && url.startsWith("#")) return true;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
    try {
      const protocol = new URL(url, window.location.href).protocol;
      return imageOnly ? ["http:", "https:"].includes(protocol) : ["http:", "https:", "mailto:"].includes(protocol);
    } catch (error) {
      return false;
    }
  }

  function sanitizeRichHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");

    function clean(node) {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        if (!allowedRichTags.has(child.tagName)) {
          child.replaceWith(document.createTextNode(child.textContent || ""));
          return;
        }

        Array.from(child.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = attr.value;
          if (name.startsWith("on")) {
            child.removeAttribute(attr.name);
            return;
          }
          if (child.tagName === "A") {
            if (!["href", "target", "rel", "class"].includes(name)) {
              child.removeAttribute(attr.name);
              return;
            }
            if (name === "href" && !isSafeUrl(value, false)) child.removeAttribute(attr.name);
            if (name === "target" && value === "_blank") child.setAttribute("rel", "noopener noreferrer");
            if (name === "class") sanitizeClassAttr(child, attr);
            return;
          }
          if (name === "class") {
            sanitizeClassAttr(child, attr);
            return;
          }
          child.removeAttribute(attr.name);
        });
        clean(child);
      });
    }

    clean(template.content);
    return template.innerHTML.trim();
  }

  function sanitizeClassAttr(element, attr) {
    const kept = attr.value.split(/\s+/).filter((className) => allowedRichClasses.has(className));
    if (kept.length) element.setAttribute("class", kept.join(" "));
    else element.removeAttribute(attr.name);
  }

  function richTextHasFormatting(html, plainText, existingType) {
    if (existingType === "html") return true;
    const template = document.createElement("template");
    template.innerHTML = html || "";
    const elements = Array.from(template.content.querySelectorAll("*"));
    if (!elements.length) return false;
    if (elements.length === 1 && elements[0].tagName === "P" && !elements[0].attributes.length) {
      return elements[0].textContent.trim() !== String(plainText || "").trim();
    }
    return elements.some((element) => {
      if (element.tagName === "P" && !element.attributes.length) return false;
      if (element.tagName === "BR") return false;
      return true;
    });
  }

  function toast(message, type) {
    let tray = document.querySelector(".salsav-cms-toast-tray");
    if (!tray) {
      tray = document.createElement("div");
      tray.className = "salsav-cms-toast-tray";
      document.body.appendChild(tray);
    }
    const item = document.createElement("div");
    item.className = `salsav-cms-toast salsav-cms-toast-${type || "info"}`;
    item.textContent = message;
    tray.appendChild(item);
    setTimeout(() => item.classList.add("salsav-cms-toast-visible"), 20);
    setTimeout(() => {
      item.classList.remove("salsav-cms-toast-visible");
      setTimeout(() => item.remove(), 220);
    }, 3600);
  }

  function labelFromKey(key) {
    return String(key || "").split(".").map((part) => part.replace(/_/g, " ")).join(" / ");
  }

  function humanFieldLabel(key) {
    const clean = String(key || "").split(".").pop();
    return fieldLabels[clean] || clean.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Text";
  }

  function humanTargetName(target) {
    if (!target) return "Selection";
    if (target.type === "text") return humanFieldLabel(target.cmsKey);
    if (target.type === "list") {
      if (target.listId?.includes("team")) return "Team section";
      if (target.listId?.includes("news")) return "News section";
      return "Section";
    }
    return collectionLabels[target.blockType] || "Block";
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (error) {
        // JSON fallback below is sufficient for the CMS content shape.
      }
    }
    return JSON.parse(JSON.stringify(value || {}));
  }

  function mergePlainObject(base, overlay) {
    if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return overlay;
    const next = { ...(base && typeof base === "object" && !Array.isArray(base) ? base : {}) };
    Object.keys(overlay).forEach((key) => {
      const value = overlay[key];
      if (Array.isArray(value)) {
        next[key] = value.slice();
      } else if (value && typeof value === "object") {
        next[key] = mergePlainObject(next[key], value);
      } else {
        next[key] = value;
      }
    });
    return next;
  }

  function mergeArrayById(remoteItems, localItems) {
    const remote = Array.isArray(remoteItems) ? remoteItems : [];
    const local = Array.isArray(localItems) ? localItems : [];
    const byId = new Map(remote.filter((item) => item && item.id).map((item) => [item.id, item]));
    const merged = [];
    local.forEach((item) => {
      if (!item || !item.id) return;
      merged.push(mergePlainObject(byId.get(item.id) || {}, item));
      byId.delete(item.id);
    });
    byId.forEach((item) => merged.push(item));
    return merged;
  }

  function mergeContentForSync(remoteContent, localContent) {
    const remote = ensureContent(remoteContent || {});
    const local = ensureContent(localContent || {});
    const merged = mergePlainObject(remote, local);
    merged.pages = mergePlainObject(remote.pages || {}, local.pages || {});
    merged.collections = mergePlainObject(remote.collections || {}, local.collections || {});
    merged.collections.newsArticles = mergeArrayById(remote.collections.newsArticles, local.collections.newsArticles);
    merged.collections.teamSections = mergeArrayById(remote.collections.teamSections, local.collections.teamSections);
    merged.collections.teamMembers = mergeArrayById(remote.collections.teamMembers, local.collections.teamMembers);
    merged.collections.teamSummaryRows = mergeArrayById(remote.collections.teamSummaryRows, local.collections.teamSummaryRows);
    merged.collections.genericBlocks = mergePlainObject(remote.collections.genericBlocks || {}, local.collections.genericBlocks || {});
    merged.layout = mergePlainObject(remote.layout || {}, local.layout || {});
    merged.layout.pages = mergePlainObject(remote.layout?.pages || {}, local.layout?.pages || {});
    merged.updatedAt = new Date().toISOString();
    merged.version = Math.max(Number(remote.version || 0), Number(local.version || 0)) + 1;
    return ensureContent(merged);
  }

  function snapshotContent() {
    return deepClone(editorState.content || {});
  }

  function pushHistory(label) {
    if (editorState.suppressHistory || !editorState.content) return;
    const snapshot = snapshotContent();
    editorState.history = editorState.history.slice(0, editorState.historyIndex + 1);
    editorState.history.push({ label: label || "Edit", content: snapshot });
    if (editorState.history.length > 30) editorState.history.shift();
    editorState.historyIndex = editorState.history.length - 1;
    updateDockState();
  }

  function restoreHistory(offset) {
    const nextIndex = editorState.historyIndex + offset;
    if (nextIndex < 0 || nextIndex >= editorState.history.length) return;
    editorState.suppressHistory = true;
    editorState.historyIndex = nextIndex;
    editorState.content = ensureContent(deepClone(editorState.history[nextIndex].content));
    window.SALSAV_CMS_CONTENT = editorState.content;
    if (window.SALSAVCMS) window.SALSAVCMS.content = editorState.content;
    markDirty("Editing");
    applyCurrentContent();
    editorState.suppressHistory = false;
    updateDockState();
  }

  function setSyncStatus(status, message) {
    editorState.syncStatus = status || "idle";
    const dock = document.querySelector(".salsav-cms-toolbar");
    if (!dock) return;
    dock.dataset.syncStatus = editorState.syncStatus;
    const statusNode = dock.querySelector(".salsav-cms-sync-status");
    if (statusNode) statusNode.textContent = message || (status === "saving" ? "Saving" : status === "error" ? "Retrying" : status === "saved" ? "Saved" : "Ready");
  }

  function syncErrorMessage(error) {
    const text = String(error?.message || "");
    if (/429|rate|cors|failed to fetch/i.test(text)) return "Pantry is busy, retrying...";
    return "Network error, retrying...";
  }

  function updateDockState() {
    const dock = document.querySelector(".salsav-cms-toolbar");
    if (!dock) return;
    dock.querySelector('[data-salsav-cms-action="undo"]')?.toggleAttribute("disabled", editorState.historyIndex <= 0);
    dock.querySelector('[data-salsav-cms-action="redo"]')?.toggleAttribute("disabled", editorState.historyIndex >= editorState.history.length - 1);
    const modeToggle = dock.querySelector('[data-salsav-cms-action="toggle-preview"]');
    if (modeToggle) modeToggle.textContent = editorState.mode === "preview" ? "Edit" : "Preview";
  }

  function markDirty(message) {
    editorState.changeId += 1;
    editorState.dirty = true;
    setSyncStatus("dirty", message || "Editing");
  }

  function queueAudit(event) {
    if (!event) return;
    editorState.pendingAudits.push({
      at: new Date().toISOString(),
      source: "live-editor",
      pageId: editorState.pageId,
      ...event
    });
  }

  async function flushSync(options = {}) {
    if (!window.SALSAVPantry || editorState.syncInFlight) return editorState.syncInFlight;
    if (!options.force && editorState.syncBackoffUntil && Date.now() < editorState.syncBackoffUntil) {
      const seconds = Math.max(1, Math.ceil((editorState.syncBackoffUntil - Date.now()) / 1000));
      setSyncStatus("error", `Retrying in ${seconds}s`);
      return editorState.content;
    }
    if (!editorState.dirty && !options.force) return editorState.content;
    const localSnapshot = ensureContent(deepClone(editorState.content || {}));
    const syncChangeId = editorState.changeId;
    const audits = editorState.pendingAudits.slice();
    editorState.pendingAudits = [];
    setSyncStatus("saving", "Saving");
    editorState.syncInFlight = (async () => {
      try {
        const latest = ensureContent(await window.SALSAVPantry.getContent());
        const merged = mergeContentForSync(latest, localSnapshot);
        await window.SALSAVPantry.saveContent(merged);
        if (audits.length) {
          if (typeof window.SALSAVPantry.appendAuditEvents === "function") {
            await window.SALSAVPantry.appendAuditEvents(audits).catch(() => {});
          } else {
            await Promise.all(audits.map((event) => window.SALSAVPantry.appendAudit(event).catch(() => {})));
          }
        }
        editorState.baseContent = ensureContent(deepClone(merged));
        if (editorState.changeId === syncChangeId) {
          editorState.content = ensureContent(deepClone(merged));
          window.SALSAV_CMS_CONTENT = editorState.content;
          if (window.SALSAVCMS) window.SALSAVCMS.content = editorState.content;
          editorState.dirty = false;
        }
        editorState.lastSavedAt = new Date();
        editorState.syncBackoffMs = 0;
        editorState.syncBackoffUntil = 0;
        setSyncStatus(editorState.dirty ? "dirty" : "saved", editorState.dirty ? "Editing" : "Saved");
        if (options.force) toast("Saved.", "success");
        return editorState.content;
      } catch (error) {
        editorState.pendingAudits.unshift(...audits);
        editorState.dirty = true;
        const rateLimited = /429|rate|cors|failed to fetch/i.test(String(error?.message || ""));
        const minimumBackoff = rateLimited ? 30000 : 5000;
        editorState.syncBackoffMs = editorState.syncBackoffMs ? Math.min(editorState.syncBackoffMs * 2, 120000) : minimumBackoff;
        editorState.syncBackoffMs = Math.max(editorState.syncBackoffMs, minimumBackoff);
        editorState.syncBackoffUntil = Date.now() + editorState.syncBackoffMs;
        setSyncStatus("error", rateLimited ? "Pantry busy" : "Retrying");
        if (!editorState.lastSyncErrorAt || Date.now() - editorState.lastSyncErrorAt > 20000 || options.force) {
          toast(syncErrorMessage(error), "error");
          editorState.lastSyncErrorAt = Date.now();
        }
        throw error;
      } finally {
        editorState.syncInFlight = null;
      }
    })();
    return editorState.syncInFlight;
  }

  function startBackgroundSync() {
    if (editorState.syncTimer) return;
    editorState.syncTimer = window.setInterval(() => {
      flushSync().catch(() => {});
    }, syncIntervalMs);
  }

  function ensureContent(content) {
    const next = { version: 1, updatedAt: null, pages: {}, collections: {}, layout: { pages: {} }, ...(content || {}) };
    next.pages = next.pages || {};
    next.pages.global = next.pages.global || { path: "*", title: "Global", fields: {} };
    next.collections = next.collections || {};
    next.collections.newsArticles = Array.isArray(next.collections.newsArticles) ? next.collections.newsArticles : [];
    next.collections.teamSections = Array.isArray(next.collections.teamSections) && next.collections.teamSections.length ? next.collections.teamSections : (window.SALSAVLiveLayout?.teamSectionDefaults || []);
    next.collections.teamMembers = Array.isArray(next.collections.teamMembers) ? next.collections.teamMembers : [];
    next.collections.teamSummaryRows = Array.isArray(next.collections.teamSummaryRows) ? next.collections.teamSummaryRows : [];
    next.collections.genericBlocks = next.collections.genericBlocks && typeof next.collections.genericBlocks === "object" ? next.collections.genericBlocks : {};
    next.layout = next.layout || {};
    next.layout.pages = next.layout.pages || {};
    return next;
  }

  async function loadLatest() {
    if (!window.SALSAVPantry) throw new Error("SALSAVPantry is unavailable.");
    const latest = await window.SALSAVPantry.getContent();
    editorState.seedMerged = Boolean(latest && latest.__seedMerged);
    editorState.content = ensureContent(latest);
    editorState.baseContent = ensureContent(deepClone(editorState.content));
    window.SALSAV_CMS_CONTENT = editorState.content;
    if (window.SALSAVCMS) window.SALSAVCMS.content = editorState.content;
    return editorState.content;
  }

  function saveContentMutation(label, mutator, audit) {
    const run = async () => mutateContentLocally(mutator, audit, { label, render: true, history: true });
    editorState.saveQueue = editorState.saveQueue.then(run, run);
    return editorState.saveQueue;
  }

  async function mutateContentLocally(mutator, audit, options = {}) {
    const content = ensureContent(deepClone(editorState.content || window.SALSAV_CMS_CONTENT || {}));
    await mutator(content);
    content.version = Number(content.version || 0) + 1;
    content.updatedAt = new Date().toISOString();
    editorState.content = ensureContent(content);
    window.SALSAV_CMS_CONTENT = editorState.content;
    if (window.SALSAVCMS) window.SALSAVCMS.content = editorState.content;
    if (audit) queueAudit(audit);
    markDirty(options.label || "Editing");
    if (options.render !== false) applyCurrentContent();
    if (options.history !== false) pushHistory(options.label || "Edit");
    if (options.toast) toast(options.toast, "success");
    return editorState.content;
  }

  async function saveContentPatch(patch, audit, label) {
    return saveContentMutation(label || "", async (content) => {
      if (typeof patch === "function") await patch(content);
      else if (patch && typeof patch === "object") Object.assign(content, patch);
    }, audit);
  }

  async function saveLayoutPatch(blockId, patch, audit) {
    return saveContentMutation("Layout", async (content) => {
      content.layout = content.layout || {};
      content.layout.pages = content.layout.pages || {};
      content.layout.pages[editorState.pageId] = content.layout.pages[editorState.pageId] || { canvases: {}, blocks: {} };
      content.layout.pages[editorState.pageId].canvases = content.layout.pages[editorState.pageId].canvases || {};
      content.layout.pages[editorState.pageId].blocks = content.layout.pages[editorState.pageId].blocks || {};
      content.layout.pages[editorState.pageId].blocks[blockId] = {
        ...(content.layout.pages[editorState.pageId].blocks[blockId] || {}),
        ...patch,
        updatedAt: new Date().toISOString()
      };
    }, audit);
  }

  async function appendAudit(event) {
    queueAudit(event);
    markDirty("Editing");
    return Promise.resolve();
  }

  function applyCurrentContent() {
    const content = editorState.content;
    if (!content) return;
    if (window.SALSAVCMSCore) window.SALSAVCMSCore.applyFields(content, editorState.pageId);
    if (window.SALSAVLiveLayout) window.SALSAVLiveLayout.renderCurrentPageCollections(content);
    buildTargetRegistry();
    scheduleOverlay();
  }

  function findField(content, key) {
    const pages = content && content.pages ? content.pages : {};
    const pageFields = pages[editorState.pageId]?.fields || {};
    const globalFields = pages.global?.fields || {};
    if (Object.prototype.hasOwnProperty.call(pageFields, key)) return pageFields[key];
    if (Object.prototype.hasOwnProperty.call(globalFields, key)) return globalFields[key];
    return null;
  }

  function attrDatasetKey(attr) {
    return `cmsAttr${attr.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^./, (letter) => letter.toUpperCase())}`;
  }

  function fieldInfoFromElement(element) {
    const keyElement = element.closest("[data-cms-key]");
    if (keyElement && isUsableTargetElement(keyElement)) {
      return { element: keyElement, key: keyElement.dataset.cmsKey, attr: null };
    }
    for (const attr of safeAttrs) {
      const attrElement = element.closest(`[data-cms-attr-${attr}]`);
      if (attrElement && isUsableTargetElement(attrElement)) {
        return { element: attrElement, key: attrElement.dataset[attrDatasetKey(attr)] || attrElement.getAttribute(`data-cms-attr-${attr}`), attr };
      }
    }
    return null;
  }

  function collectionTypeForBlock(block) {
    const blockType = block?.getAttribute("data-cms-block-type") || "";
    if (blockType === "newsArticle") return "newsArticles";
    if (blockType === "teamMember") return "teamMembers";
    if (blockType === "teamSummaryRow") return "teamSummaryRows";
    return "";
  }

  function collectionFieldInfoFromElement(element) {
    const fieldElement = element?.closest("[data-cms-collection-field]");
    if (!fieldElement || !isUsableTargetElement(fieldElement)) return null;
    const block = fieldElement.closest("[data-cms-block-id]");
    const collectionType = collectionTypeForBlock(block);
    const field = fieldElement.getAttribute("data-cms-collection-field");
    const id = block?.getAttribute("data-cms-block-id");
    if (!collectionType || !field || !id) return null;
    return {
      mode: "collection",
      element: fieldElement,
      block,
      collectionType,
      blockType: block.getAttribute("data-cms-block-type"),
      id,
      field,
      label: fieldElement.getAttribute("data-cms-field-label") || humanFieldLabel(field)
    };
  }

  function ensureRuntimeImageKey(img) {
    if (!img || img.getAttribute("data-cms-image-field") || img.getAttribute("data-cms-attr-src")) return;
    const block = img.closest("[data-cms-block-id]");
    if (!block) return;
    const key = `${block.getAttribute("data-cms-block-id")}.imageSrc`;
    img.setAttribute("data-cms-attr-src", key);
  }

  function imageInfoFromElement(element) {
    const img = element?.closest("img");
    if (!img || !isUsableTargetElement(img)) return null;
    const block = img.closest("[data-cms-block-id]");
    const collectionType = collectionTypeForBlock(block);
    if (img.getAttribute("data-cms-image-field") && block && collectionType) {
      return {
        mode: "collection",
        element: img,
        block,
        collectionType,
        blockType: block.getAttribute("data-cms-block-type"),
        id: block.getAttribute("data-cms-block-id"),
        field: img.getAttribute("data-cms-image-field"),
        altField: img.getAttribute("data-cms-image-alt-field") || "imageAlt",
        label: "Image"
      };
    }
    ensureRuntimeImageKey(img);
    const attrKey = img.dataset.cmsAttrSrc || img.getAttribute("data-cms-attr-src");
    if (!attrKey) return null;
    return {
      mode: "field",
      element: img,
      key: attrKey,
      attr: "src",
      label: "Image"
    };
  }

  function hydrateRuntimeImageKeys() {
    if (!editorState.content) return;
    document.querySelectorAll("img").forEach((img) => {
      ensureRuntimeImageKey(img);
      const key = img.dataset.cmsAttrSrc || img.getAttribute("data-cms-attr-src");
      if (!key) return;
      const field = findField(editorState.content, key);
      if (field?.value && isSafeUrl(field.value, true)) img.setAttribute("src", field.value);
    });
  }

  function isCmsChrome(element) {
    return Boolean(element && element.closest(".salsav-cms-toolbar,.salsav-cms-overlay-layer,.salsav-cms-modal,.salsav-cms-toast-tray,.salsav-cms-format-toolbar,.salsav-cms-image-chip,.salsav-cms-image-popover,.salsav-cms-section-add,.salsav-cms-card-trash,.salsav-cms-card-move"));
  }

  function isSiteNavigationChrome(element) {
    return Boolean(element && element.closest("header,.navbar,.nav-menu,.navbar-menu,.navbar-brand"));
  }

  function isVisible(element) {
    if (!element || element.hidden || element.closest("[hidden]")) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2 && getComputedStyle(element).visibility !== "hidden";
  }

  function isUsableTargetElement(element) {
    return Boolean(element && !isCmsChrome(element) && !isSiteNavigationChrome(element) && isVisible(element));
  }

  function nearestList(element) {
    return element.closest("[data-cms-list],#news-grid-container,.news-grid,.team-grid,.project-table tbody,.proof-grid,.partners-grid,.carousel-track,.pillars-left,.footer-links ul");
  }

  function nearestCanvas(element) {
    return element?.closest("[data-cms-canvas],[data-cms-list],#news-grid-container,.news-grid,.team-grid,.project-table tbody,.proof-grid,.partners-grid,.carousel-track,.pillars-left,.footer-links ul,section,main,footer");
  }

  function canvasIdForElement(element) {
    const canvas = nearestCanvas(element);
    if (!canvas) return "";
    if (canvas.getAttribute("data-cms-canvas")) return canvas.getAttribute("data-cms-canvas");
    if (canvas.getAttribute("data-cms-list")) return canvas.getAttribute("data-cms-list");
    if (canvas.id === "news-grid-container") return "news.articles";
    if (canvas.classList.contains("team-grid")) {
      const grids = Array.from(document.querySelectorAll(".team-grid"));
      return grids.indexOf(canvas) === 1 ? "team.alumni" : "team.key_contributors";
    }
    if (canvas.matches(".project-table tbody")) return "team.summary";
    const key = canvas.id || Array.from(canvas.classList || []).find((name) => /hero|section|grid|content|footer|cards|proof|partner|pillar|site|education|research/i.test(name)) || canvas.tagName.toLowerCase();
    return `${editorState.pageId}.${slug(key)}`;
  }

  function ensureCanvasAttributes(canvas) {
    if (!canvas || isCmsChrome(canvas)) return "";
    const canvasId = canvasIdForElement(canvas);
    if (!canvasId) return "";
    if (!canvas.getAttribute("data-cms-canvas")) canvas.setAttribute("data-cms-canvas", canvasId);
    if (!canvas.getAttribute("data-cms-grid")) canvas.setAttribute("data-cms-grid", "12");
    return canvasId;
  }

  function blockTypeForTextElement(element) {
    const tag = element.tagName;
    if (/^H[1-6]$/.test(tag)) return "headingBlock";
    if (tag === "IMG" || element.matches("[data-cms-attr-alt]")) return "imageBlock";
    if (element.matches("a,button,.cta-button")) return "buttonBlock";
    return "textBlock";
  }

  function ensureVisualBlockForElement(element) {
    if (!element || isCmsChrome(element)) return null;
    let block = element.closest("[data-cms-block-id]");
    if (block && isUsableTargetElement(block)) {
      const canvasId = canvasIdForElement(block);
      if (canvasId && !block.getAttribute("data-cms-parent-canvas")) block.setAttribute("data-cms-parent-canvas", canvasId);
      return block;
    }
    const canvas = nearestCanvas(element);
    const canvasId = canvas ? ensureCanvasAttributes(canvas) : "";
    if (!canvasId) return element;
    const info = fieldInfoFromElement(element) || {};
    const blockId = `${editorState.pageId}_${slug(info.key || element.getAttribute("data-cms-key") || element.textContent || element.tagName)}`;
    element.setAttribute("data-cms-block-id", blockId);
    element.setAttribute("data-cms-block-type", blockTypeForTextElement(element));
    element.setAttribute("data-cms-parent-canvas", canvasId);
    return element;
  }

  function listIdForElement(list) {
    if (!list) return "";
    if (list.getAttribute("data-cms-list")) return list.getAttribute("data-cms-list");
    if (list.id === "news-grid-container") return "news.articles";
    if (list.classList.contains("news-grid")) return "news.articles";
    if (list.classList.contains("team-grid")) return list.textContent.includes("Alumni") ? "team.alumni" : "team.key_contributors";
    if (list.matches(".project-table tbody")) return "team.summary";
    if (list.classList.contains("proof-grid")) return `${editorState.pageId}.proof.cards`;
    if (list.classList.contains("partners-grid")) return `${editorState.pageId}.partners`;
    if (list.classList.contains("carousel-track")) return `${editorState.pageId}.carousel`;
    if (list.classList.contains("pillars-left")) return `${editorState.pageId}.pillars`;
    if (list.matches(".footer-links ul")) return "global.footer.links";
    return `${editorState.pageId}.blocks`;
  }

  function targetFromBlockElement(element) {
    const canvas = nearestCanvas(element);
    const canvasId = element.getAttribute("data-cms-parent-canvas") || (canvas ? ensureCanvasAttributes(canvas) : "");
    const blockId = element.getAttribute("data-cms-block-id") || `${editorState.pageId}_${slug(element.className || element.tagName)}_${Array.from(document.querySelectorAll("[data-cms-block-id],.news-card,.researcher-card,.pi-profile")).indexOf(element) + 1}`;
    const blockType = element.getAttribute("data-cms-block-type") || inferBlockType(element);
    const list = nearestList(element);
    const listType = list?.getAttribute("data-cms-list-type") || inferListType(list, blockType);
    const canGridMove = Boolean(canvasId);
    return {
      id: `block:${blockId}`,
      type: "block",
      pageId: editorState.pageId,
      element,
      canvasId,
      canvasElement: canvas,
      cmsKey: null,
      blockId,
      blockType,
      listId: listIdForElement(list),
      listType,
      listElement: list,
      canTextEdit: Boolean(element.matches("[data-cms-key],[data-cms-attr-alt],[data-cms-attr-title],[data-cms-attr-aria-label],[data-cms-attr-placeholder],[data-cms-attr-content]") || element.querySelector("[data-cms-key],[data-cms-attr-alt],[data-cms-attr-title],[data-cms-attr-aria-label],[data-cms-attr-placeholder],[data-cms-attr-content]")),
      canMove: canGridMove,
      canDrag: canGridMove || Boolean(list),
      canResize: canGridMove && isResizableBlock(element),
      canDuplicate: ["newsArticle", "teamMember", "genericBlock"].includes(blockType),
      canArchive: ["newsArticle", "teamMember", "genericBlock"].includes(blockType),
      canFreePosition: canGridMove,
      collectionType: blockType === "newsArticle" ? "newsArticles" : blockType === "teamMember" ? "teamMembers" : "genericBlocks"
    };
  }

  function inferBlockType(element) {
    if (element.classList.contains("news-card")) return "newsArticle";
    if (element.classList.contains("researcher-card") || element.classList.contains("pi-profile")) return "teamMember";
    if (element.matches(".project-table tbody tr")) return "teamSummaryRow";
    return "genericBlock";
  }

  function inferListType(list, blockType) {
    if (!list) return "";
    if (blockType === "newsArticle") return "newsArticles";
    if (blockType === "teamMember") return "teamMembers";
    return list.getAttribute("data-cms-list-type") || "genericBlocks";
  }

  function isResizableBlock(element) {
    if (!element || element.matches("a.navbar-link, li, td, th, span, small, strong, em")) return false;
    if (element.closest(".navbar,.nav-menu") && !element.matches(".hero-content,.hero-text")) return false;
    return element.matches("[data-cms-block-id],.news-card,.researcher-card,.pi-profile,.site-card,.education-card,.research-card,.proof-card,.partner-logo-link,.video-wrapper,.chart-card,.content-image,.slide,h1,h2,h3,h4,h5,h6,p,.cta-button");
  }

  function buildTargetRegistry() {
    editorState.pageId = pageId();
    editorState.targets.clear();
    const seenElements = new Set();
    hydrateRuntimeImageKeys();

    document.querySelectorAll("[data-cms-key], [data-cms-attr-alt], [data-cms-attr-title], [data-cms-attr-aria-label], [data-cms-attr-placeholder], [data-cms-attr-content]").forEach((element, index) => {
      if (!isUsableTargetElement(element)) return;
      const info = fieldInfoFromElement(element);
      if (!info || !info.key) return;
      const id = `text:${info.key}:${info.attr || "body"}:${index}`;
      editorState.targets.set(id, {
        id,
        type: "text",
        pageId: editorState.pageId,
        element: info.element,
        cmsKey: info.key,
        attr: info.attr,
        blockId: info.element.closest("[data-cms-block-id]")?.getAttribute("data-cms-block-id") || null,
        blockType: info.element.closest("[data-cms-block-id]")?.getAttribute("data-cms-block-type") || null,
        listId: null,
        listType: null,
        listElement: null,
        canTextEdit: true,
        canDrag: false,
        canResize: false,
        canDuplicate: false,
        canArchive: false,
        canFreePosition: false,
        collectionType: "field"
      });
    });

    document.querySelectorAll("[data-cms-collection-field]").forEach((element, index) => {
      if (!isUsableTargetElement(element)) return;
      const info = collectionFieldInfoFromElement(element);
      if (!info) return;
      const id = `collection:${info.collectionType}:${info.id}:${info.field}:${index}`;
      editorState.targets.set(id, {
        id,
        type: "text",
        pageId: editorState.pageId,
        element: info.element,
        cmsKey: info.field,
        attr: null,
        collectionInfo: info,
        blockId: info.id,
        blockType: info.blockType,
        listId: null,
        listType: null,
        listElement: null,
        canTextEdit: true,
        canDrag: false,
        canResize: false,
        canDuplicate: false,
        canArchive: false,
        canFreePosition: false,
        collectionType: info.collectionType
      });
    });

    document.querySelectorAll("[data-cms-block-id], .news-card, .researcher-card, .pi-profile, .project-table tbody tr, .slide, .partner-logo-link, .proof-card, .site-card, .education-card, .research-card").forEach((element) => {
      if (!isUsableTargetElement(element) || seenElements.has(element)) return;
      seenElements.add(element);
      const target = targetFromBlockElement(element);
      editorState.targets.set(target.id, target);
    });

    document.querySelectorAll("[data-cms-list], #news-grid-container, .news-grid, .team-grid, .project-table tbody, .proof-grid, .partners-grid, .carousel-track, .pillars-left, .footer-links ul").forEach((element, index) => {
      if (!isUsableTargetElement(element)) return;
      const listId = listIdForElement(element);
      editorState.targets.set(`list:${listId}:${index}`, {
        id: `list:${listId}:${index}`,
        type: "list",
        pageId: editorState.pageId,
        element,
        cmsKey: null,
        blockId: null,
        blockType: null,
        listId,
        listType: element.getAttribute("data-cms-list-type") || "genericBlocks",
        listElement: element,
        canTextEdit: false,
        canDrag: false,
        canResize: false,
        canDuplicate: false,
        canArchive: false,
        canFreePosition: false,
        collectionType: element.getAttribute("data-cms-list-type") || "genericBlocks"
      });
    });

    if (editorState.selectedTargetId && !editorState.targets.has(editorState.selectedTargetId)) editorState.selectedTargetId = null;
    if (editorState.hoveredTargetId && !editorState.targets.has(editorState.hoveredTargetId)) editorState.hoveredTargetId = null;
    scheduleOverlay();
    decorateLiveChrome();
    return editorState.targets;
  }

  function findTargetForElement(element, preferredMode) {
    if (!element || isCmsChrome(element)) return null;
    const mode = preferredMode || editorState.mode;
    if (mode === "text") {
      const collectionInfo = collectionFieldInfoFromElement(element);
      if (collectionInfo) {
        return Array.from(editorState.targets.values()).find((target) => target.collectionInfo && target.collectionInfo.element === collectionInfo.element && target.collectionInfo.id === collectionInfo.id && target.collectionInfo.field === collectionInfo.field) || null;
      }
      const info = fieldInfoFromElement(element);
      if (info) {
        return Array.from(editorState.targets.values()).find((target) => target.type === "text" && target.element === info.element && target.cmsKey === info.key) || null;
      }
    }
    if (mode === "move" || mode === "resize" || mode === "blocks") {
      const block = element.closest("[data-cms-block-id],.news-card,.researcher-card,.pi-profile,.project-table tbody tr,.slide,.partner-logo-link,.proof-card,.site-card,.education-card,.research-card");
      if (block) {
        return Array.from(editorState.targets.values()).find((target) => target.type === "block" && target.element === block) || null;
      }
      const list = element.closest("[data-cms-list],#news-grid-container,.news-grid,.team-grid,.project-table tbody,.proof-grid,.partners-grid,.carousel-track,.pillars-left,.footer-links ul");
      if (list && mode === "blocks") {
        return Array.from(editorState.targets.values()).find((target) => target.type === "list" && target.element === list) || null;
      }
    }
    const collectionInfo = collectionFieldInfoFromElement(element);
    if (collectionInfo) {
      return Array.from(editorState.targets.values()).find((target) => target.collectionInfo && target.collectionInfo.element === collectionInfo.element && target.collectionInfo.id === collectionInfo.id && target.collectionInfo.field === collectionInfo.field) || null;
    }
    const info = fieldInfoFromElement(element);
    if (info) {
      return Array.from(editorState.targets.values()).find((target) => target.type === "text" && target.element === info.element && target.cmsKey === info.key) || null;
    }
    return null;
  }

  function getTargetFromPoint(x, y) {
    const overlay = editorState.overlay;
    const previous = overlay ? overlay.style.pointerEvents : "";
    if (overlay) overlay.style.pointerEvents = "none";
    const element = document.elementFromPoint(x, y);
    if (overlay) overlay.style.pointerEvents = previous;
    return findTargetForElement(element);
  }

  function selectTarget(targetId) {
    editorState.selectedTargetId = targetId && editorState.targets.has(targetId) ? targetId : null;
    scheduleOverlay();
    return editorState.selectedTargetId ? editorState.targets.get(editorState.selectedTargetId) : null;
  }

  function ensureOverlayLayer() {
    if (editorState.overlay) return editorState.overlay;
    const overlay = document.createElement("div");
    overlay.className = "salsav-cms-overlay-layer";
    overlay.innerHTML = `
      <div class="salsav-cms-hover-box" hidden><span class="salsav-cms-overlay-label"></span></div>
      <div class="salsav-cms-selected-box" hidden><span class="salsav-cms-overlay-label"></span></div>
      <div class="salsav-cms-drop-indicator" hidden></div>
      <div class="salsav-cms-block-actions" hidden></div>`;
    document.body.appendChild(overlay);
    editorState.overlay = overlay;
    editorState.hoverBox = overlay.querySelector(".salsav-cms-hover-box");
    editorState.selectedBox = overlay.querySelector(".salsav-cms-selected-box");
    editorState.dropIndicator = overlay.querySelector(".salsav-cms-drop-indicator");
    editorState.actionLayer = overlay.querySelector(".salsav-cms-block-actions");
    return overlay;
  }

  function scheduleOverlay() {
    if (editorState.raf) return;
    editorState.raf = requestAnimationFrame(() => {
      editorState.raf = 0;
      renderOverlay();
    });
  }

  function placeBox(box, target) {
    if (!box || !target || !isVisible(target.element)) {
      if (box) box.hidden = true;
      return;
    }
    const rect = target.element.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${Math.max(0, rect.left)}px`;
    box.style.top = `${Math.max(0, rect.top)}px`;
    box.style.width = `${Math.max(0, rect.width)}px`;
    box.style.height = `${Math.max(0, rect.height)}px`;
    const label = box.querySelector(".salsav-cms-overlay-label");
    if (label) label.textContent = targetLabel(target);
  }

  function targetLabel(target) {
    return humanTargetName(target);
  }

  function renderOverlay() {
    ensureOverlayLayer();
    const preview = editorState.mode === "preview";
    editorState.overlay.hidden = preview;
    if (preview) return;
    const hovered = editorState.hoveredTargetId ? editorState.targets.get(editorState.hoveredTargetId) : null;
    const selected = editorState.selectedTargetId ? editorState.targets.get(editorState.selectedTargetId) : null;
    placeBox(editorState.hoverBox, hovered && hovered !== selected ? hovered : null);
    placeBox(editorState.selectedBox, selected);
    renderActionLayer(selected);
  }

  function renderActionLayer(target) {
    const layer = editorState.actionLayer;
    if (!layer) return;
    layer.innerHTML = "";
    if (!target || !isVisible(target.element)) {
      layer.hidden = true;
      return;
    }
    const rect = target.element.getBoundingClientRect();
    layer.hidden = false;
    layer.style.left = `${Math.min(window.innerWidth - 260, Math.max(8, rect.left))}px`;
    layer.style.top = `${Math.max(8, rect.top - 44)}px`;

    if (editorState.mode === "text") {
      if (target.canTextEdit) {
        layer.append(button("Edit text", "edit-text"));
      } else {
        layer.append(reason("Click visible copy to edit it."));
      }
      return;
    }

    if (editorState.mode === "move") {
      if (!target.canDrag) {
        layer.append(reason(target.type === "text" ? "This element can be edited as text only." : "This block cannot be moved safely."));
        return;
      }
      layer.append(dragHandle(target));
      layer.append(reason(target.listElement ? "Reorder in list" : "Free move"));
      if (target.listElement) {
        layer.append(button("Up", "move-up"));
        layer.append(button("Down", "move-down"));
      }
      return;
    }

    if (editorState.mode === "resize") {
      if (!target.canResize) {
        layer.append(reason(target.type === "text" ? "This element can be edited as text only." : "This block cannot be resized safely."));
        return;
      }
      layer.append(resizeHandle("right"));
      layer.append(resizeHandle("bottom"));
      layer.append(resizeHandle("corner"));
      layer.append(button("Reset size", "reset-size"));
      layer.append(button("Reset page layout", "reset-page-layout"));
      return;
    }

    if (editorState.mode === "blocks") {
      if (target.type === "list") {
        if (editorState.pageId === "news") layer.append(button("+ Article", "add-article"));
        else if (editorState.pageId === "team") layer.append(button("+ Team Member", "add-member"));
        else layer.append(button("+ Card", "add-generic"));
        return;
      }
      layer.append(button("Edit", "edit-block"));
      if (target.canDuplicate) layer.append(button("Duplicate", "duplicate-block"));
      if (target.canArchive) layer.append(button("Archive", "archive-block"));
      layer.append(button("Delete", "delete-block", true));
      if (target.listElement) {
        layer.append(button("Up", "move-up"));
        layer.append(button("Down", "move-down"));
      }
      if (target.blockType === "teamMember") layer.append(teamSectionSelect(target));
      layer.append(button("Reset size", "reset-size"));
    }
  }

  function button(label, action, danger) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `salsav-cms-mini-button${danger ? " salsav-cms-danger-zone" : ""}`;
    btn.dataset.overlayAction = action;
    btn.textContent = label;
    return btn;
  }

  function reason(text) {
    const span = document.createElement("span");
    span.className = "salsav-cms-overlay-reason";
    span.textContent = text;
    return span;
  }

  function dragHandle(target) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "salsav-cms-drag-handle salsav-cms-drag-handle-live";
    handle.dataset.overlayAction = "drag-handle";
    handle.textContent = "Drag";
    handle.setAttribute("aria-label", `Drag ${targetLabel(target)}`);
    return handle;
  }

  function resizeHandle(side) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `salsav-cms-resize-handle salsav-cms-resize-${side}`;
    handle.dataset.resizeSide = side;
    handle.setAttribute("aria-label", `Resize ${side}`);
    return handle;
  }

  function teamSectionSelect(target) {
    const select = document.createElement("select");
    select.className = "salsav-cms-mini-select";
    select.dataset.overlayAction = "move-section";
    const item = ensureContent(editorState.content).collections.teamMembers.find((member) => member.id === target.blockId);
    ensureContent(editorState.content).collections.teamSections.forEach((section) => {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = section.label;
      option.selected = item && item.sectionId === section.id;
      select.append(option);
    });
    return select;
  }

  function setMode(mode) {
    editorState.mode = modes.includes(mode) ? mode : "text";
    document.documentElement.classList.toggle("salsav-cms-preview", editorState.mode === "preview");
    document.documentElement.classList.toggle("salsav-cms-preview-mode", editorState.mode === "preview");
    document.documentElement.classList.toggle("salsav-cms-editing", editorState.mode === "text");
    document.documentElement.classList.toggle("salsav-cms-moving", editorState.mode === "move");
    document.documentElement.classList.toggle("salsav-cms-resizing", editorState.mode === "resize");
    document.documentElement.classList.toggle("salsav-cms-blocks", editorState.mode === "blocks");
    modes.forEach((item) => document.documentElement.classList.toggle(`salsav-cms-mode-${item}`, editorState.mode === item));
    document.querySelectorAll(".salsav-cms-mode-button").forEach((button) => {
      const active = button.dataset.mode === editorState.mode;
      button.classList.toggle("salsav-cms-button-active", active);
      button.classList.toggle("salsav-cms-mode-active", active);
    });
    editorState.hoveredTargetId = null;
    editorState.selectedTargetId = null;
    buildTargetRegistry();
    updateDockState();
  }

  function ensureToolbar() {
    if (document.querySelector(".salsav-cms-toolbar")) return;
    const toolbar = document.createElement("div");
    toolbar.className = "salsav-cms-toolbar";
    const addButton = editorState.pageId === "news"
      ? '<button type="button" class="salsav-cms-button salsav-cms-dock-add" data-salsav-cms-action="add-article">Add article</button>'
      : editorState.pageId === "team"
        ? '<button type="button" class="salsav-cms-button salsav-cms-dock-add" data-salsav-cms-action="add-member">Add member</button>'
        : "";
    toolbar.innerHTML = `
      <span class="salsav-cms-toolbar-title">SALSAV</span>
      <button type="button" class="salsav-cms-button salsav-cms-mode-button salsav-cms-button-active" data-salsav-cms-action="toggle-preview">Preview</button>
      <button type="button" class="salsav-cms-icon-button" data-salsav-cms-action="undo" aria-label="Undo" title="Undo">Undo</button>
      <button type="button" class="salsav-cms-icon-button" data-salsav-cms-action="redo" aria-label="Redo" title="Redo">Redo</button>
      ${addButton}
      <button type="button" class="salsav-cms-button salsav-cms-sync-button" data-salsav-cms-action="sync">Sync</button>
      <span class="salsav-cms-sync-status" aria-live="polite">Ready</span>
      <button type="button" class="salsav-cms-icon-button salsav-cms-secondary-action" data-salsav-cms-action="refresh" aria-label="Refresh content" title="Refresh">Refresh</button>
      <button type="button" class="salsav-cms-icon-button salsav-cms-secondary-action" data-salsav-cms-action="export" aria-label="Download backup" title="Download backup">Backup</button>
      <button type="button" class="salsav-cms-icon-button salsav-cms-secondary-action" data-salsav-cms-action="logout" aria-label="Logout" title="Logout">Logout</button>`;
    document.body.appendChild(toolbar);
    toolbar.addEventListener("click", (event) => {
      const modeButton = event.target.closest("[data-mode]");
      if (modeButton) setMode(modeButton.dataset.mode);
      const action = event.target.closest("[data-salsav-cms-action]")?.dataset.salsavCmsAction;
      if (action === "toggle-preview") setMode(editorState.mode === "preview" ? "text" : "preview");
      if (action === "undo") restoreHistory(-1);
      if (action === "redo") restoreHistory(1);
      if (action === "sync") flushSync({ force: true }).catch(() => {});
      if (action === "refresh") refreshContent();
      if (action === "export") downloadJson("salsav-site-content.json", editorState.content || {});
      if (action === "logout") {
        sessionStorage.removeItem(config.sessionKey);
        window.location.reload();
      }
      if (action === "add-article") createVisualArticle();
      if (action === "add-member") createVisualMember();
    });
    updateDockState();
  }

  function downloadJson(name, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function refreshContent() {
    try {
      await loadLatest();
      editorState.dirty = false;
      editorState.pendingAudits = [];
      editorState.history = [{ label: "Refreshed", content: snapshotContent() }];
      editorState.historyIndex = 0;
      applyCurrentContent();
      setSyncStatus("saved", "Saved");
      toast("Pantry content refreshed.", "success");
    } catch (error) {
      toast(error.message || "Refresh failed.", "error");
    }
  }

  function ensureFormatToolbar() {
    if (editorState.formatToolbar) return editorState.formatToolbar;
    const toolbar = document.createElement("div");
    toolbar.className = "salsav-cms-format-toolbar";
    toolbar.hidden = true;
    toolbar.innerHTML = `
      <button type="button" data-format="bold" aria-label="Bold"><strong>B</strong></button>
      <button type="button" data-format="italic" aria-label="Italic"><em>I</em></button>
      <button type="button" data-format="underline" aria-label="Underline"><u>U</u></button>
      <button type="button" data-format="link" aria-label="Add link">Link</button>
      <button type="button" data-format="insertUnorderedList" aria-label="Bullet list">List</button>
      <button type="button" data-format="insertOrderedList" aria-label="Numbered list">1 2</button>
      <button type="button" data-format="blockquote" aria-label="Quote">Quote</button>
      <button type="button" data-format="superscript" aria-label="Superscript">Sup</button>
      <button type="button" data-format="subscript" aria-label="Subscript">Sub</button>
      <button type="button" data-format="clear" aria-label="Clear formatting">Clear</button>
      <form class="salsav-cms-link-form" hidden>
        <input type="url" placeholder="Paste link URL" aria-label="Paste link URL">
      </form>`;
    document.body.appendChild(toolbar);
    toolbar.addEventListener("mousedown", (event) => {
      if (event.target.closest("input")) return;
      event.preventDefault();
    });
    toolbar.addEventListener("click", (event) => {
      const action = event.target.closest("[data-format]")?.dataset.format;
      if (!action) return;
      event.preventDefault();
      if (action === "link") {
        const form = toolbar.querySelector(".salsav-cms-link-form");
        form.hidden = !form.hidden;
        if (!form.hidden) form.querySelector("input").focus();
        return;
      }
      applyFormatAction(action);
    });
    toolbar.querySelector(".salsav-cms-link-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = event.currentTarget.querySelector("input");
      const url = input.value.trim();
      if (!isSafeUrl(url, false)) {
        toast("That link cannot be used.", "error");
        return;
      }
      document.execCommand("createLink", false, url);
      const selection = window.getSelection();
      const anchor = selection?.anchorNode?.parentElement?.closest("a");
      if (anchor && new URL(url, window.location.href).origin !== window.location.origin) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
      input.value = "";
      event.currentTarget.hidden = true;
      commitInlineEdit(false);
      updateFormatToolbar();
    });
    editorState.formatToolbar = toolbar;
    return toolbar;
  }

  function applyFormatAction(action) {
    if (!editorState.inline) return;
    if (action === "blockquote") {
      document.execCommand("formatBlock", false, "blockquote");
    } else if (action === "clear") {
      document.execCommand("removeFormat");
      document.execCommand("unlink");
    } else {
      document.execCommand(action);
    }
    commitInlineEdit(false);
    updateFormatToolbar();
  }

  function updateFormatToolbar() {
    const toolbar = ensureFormatToolbar();
    const active = editorState.inline;
    const selection = window.getSelection();
    if (!active || !selection || selection.rangeCount === 0 || selection.isCollapsed || !active.element.contains(selection.anchorNode)) {
      toolbar.hidden = true;
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      toolbar.hidden = true;
      return;
    }
    toolbar.hidden = false;
    toolbar.style.left = `${Math.min(window.innerWidth - toolbar.offsetWidth - 10, Math.max(10, rect.left + rect.width / 2 - toolbar.offsetWidth / 2))}px`;
    toolbar.style.top = `${Math.max(10, rect.top - toolbar.offsetHeight - 12)}px`;
  }

  function plainTextFromEditable(element) {
    return String(element.innerText || element.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function editableHtml(element) {
    return sanitizeRichHtml(element.innerHTML || "");
  }

  function editableHasFormatting(element, existingType) {
    return richTextHasFormatting(editableHtml(element), plainTextFromEditable(element), existingType);
  }

  function pageFieldTargetPageId(key) {
    return String(key || "").startsWith("global.") ? "global" : editorState.pageId;
  }

  function setPageFieldValue(content, info, value, type) {
    const targetPageId = pageFieldTargetPageId(info.key);
    content.pages[targetPageId] = content.pages[targetPageId] || { path: `${targetPageId}.html`, title: labelFromKey(targetPageId), fields: {} };
    content.pages[targetPageId].fields = content.pages[targetPageId].fields || {};
    const previous = content.pages[targetPageId].fields[info.key] || {};
    content.pages[targetPageId].fields[info.key] = {
      ...previous,
      type,
      label: previous.label || humanFieldLabel(info.key),
      value,
      selectorHint: previous.selectorHint || (info.attr ? `[data-cms-attr-${info.attr}="${info.key}"]` : `[data-cms-key="${info.key}"]`),
      updatedAt: new Date().toISOString()
    };
    if (info.attr) content.pages[targetPageId].fields[info.key].attr = info.attr;
  }

  function collectionItem(content, info) {
    const list = content.collections?.[info.collectionType];
    return Array.isArray(list) ? list.find((item) => item.id === info.id) : null;
  }

  async function commitInlineEdit(final) {
    const active = editorState.inline;
    if (!active || active.committing) return;
    window.clearTimeout(active.timer);
    active.committing = true;
    try {
      if (active.mode === "collection") {
        const isRich = editableHasFormatting(active.element, /<\/?[a-z][\s>/]/i.test(collectionItem(editorState.content, active.info)?.[active.info.field] || "") ? "html" : "text");
        const value = isRich ? editableHtml(active.element) : plainTextFromEditable(active.element);
        await mutateContentLocally((content) => {
          const item = collectionItem(content, active.info);
          if (!item) return;
          item[active.info.field] = value;
          if (active.info.field === "displayDate" && !item.date) item.date = value;
          item.updatedAt = new Date().toISOString();
        }, final ? {
          type: isRich ? "rich_text_updated" : active.info.blockType === "teamMember" ? "team_member_updated" : active.info.blockType === "newsArticle" ? "news_article_updated" : "text_updated",
          entityType: active.info.blockType || "collectionItem",
          entityId: active.info.id,
          label: active.info.label
        } : null, { label: active.info.label, render: false, history: final });
      } else {
        const existing = findField(editorState.content, active.info.key) || {};
        const isRich = editableHasFormatting(active.element, existing.type);
        const value = isRich ? editableHtml(active.element) : plainTextFromEditable(active.element);
        await mutateContentLocally((content) => {
          setPageFieldValue(content, active.info, value, isRich ? "html" : "text");
        }, final ? {
          type: isRich ? "rich_text_updated" : "text_updated",
          entityType: "field",
          entityId: active.info.key,
          label: humanFieldLabel(active.info.key)
        } : null, { label: humanFieldLabel(active.info.key), render: false, history: final });
      }
    } finally {
      active.committing = false;
    }
  }

  function queueInlineCommit() {
    const active = editorState.inline;
    if (!active) return;
    window.clearTimeout(active.timer);
    active.timer = window.setTimeout(() => commitInlineEdit(false).catch((error) => toast(error.message || "Save failed.", "error")), textSaveDelayMs);
  }

  function closeInlineEditor(options = {}) {
    const active = editorState.inline;
    if (!active) return Promise.resolve();
    const element = active.element;
    return commitInlineEdit(true).catch((error) => toast(error.message || "Save failed.", "error")).finally(() => {
      element.removeEventListener("input", queueInlineCommit);
      element.removeEventListener("blur", active.onBlur);
      element.removeEventListener("paste", active.onPaste);
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
      element.classList.remove("salsav-cms-inline-active");
      if (editorState.inline === active) editorState.inline = null;
      ensureFormatToolbar().hidden = true;
      if (!options.keepSelection) window.getSelection()?.removeAllRanges();
      buildTargetRegistry();
    });
  }

  function startInlineEditor(target) {
    if (!target || !target.canTextEdit) return false;
    const collectionInfo = target.collectionInfo || collectionFieldInfoFromElement(target.element);
    const pageInfo = collectionInfo ? null : (target.type === "text" ? { element: target.element, key: target.cmsKey, attr: target.attr } : fieldInfoFromElement(target.element));
    if (!collectionInfo && (!pageInfo || pageInfo.attr)) return false;
    if (editorState.inline?.element === target.element) return true;
    closeInlineEditor({ keepSelection: true });
    const element = collectionInfo ? collectionInfo.element : pageInfo.element;
    editorState.inline = {
      mode: collectionInfo ? "collection" : "field",
      info: collectionInfo || pageInfo,
      element,
      timer: 0,
      committing: false,
      onBlur: () => closeInlineEditor(),
      onPaste: (event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") || "";
        document.execCommand("insertText", false, text);
      }
    };
    element.setAttribute("contenteditable", "true");
    element.setAttribute("spellcheck", "true");
    element.classList.add("salsav-cms-inline-active");
    element.addEventListener("input", queueInlineCommit);
    element.addEventListener("blur", editorState.inline.onBlur);
    element.addEventListener("paste", editorState.inline.onPaste);
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    updateFormatToolbar();
    return true;
  }

  function ensureImageChip() {
    if (editorState.imageChip) return editorState.imageChip;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "salsav-cms-image-chip";
    chip.textContent = "Image";
    chip.hidden = true;
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const info = chip._imageInfo;
      if (info) openImagePopover(info);
    });
    document.body.appendChild(chip);
    editorState.imageChip = chip;
    return chip;
  }

  function ensureImagePopover() {
    if (editorState.imagePopover) return editorState.imagePopover;
    const popover = document.createElement("form");
    popover.className = "salsav-cms-image-popover";
    popover.hidden = true;
    popover.innerHTML = `<input type="url" placeholder="Paste Image URL" aria-label="Paste Image URL">`;
    popover.addEventListener("submit", (event) => event.preventDefault());
    popover.querySelector("input").addEventListener("input", (event) => {
      const value = event.target.value.trim();
      const info = popover._imageInfo;
      if (!info || !value) return;
      applyImageUrl(info, value).catch((error) => toast(error.message || "Image update failed.", "error"));
    });
    document.body.appendChild(popover);
    editorState.imagePopover = popover;
    return popover;
  }

  function placeImageChip(info) {
    const chip = ensureImageChip();
    if (!info || editorState.mode === "preview" || editorState.inline) {
      chip.hidden = true;
      return;
    }
    const rect = info.element.getBoundingClientRect();
    chip.hidden = false;
    chip._imageInfo = info;
    chip.style.left = `${Math.min(window.innerWidth - 86, Math.max(10, rect.right - 76))}px`;
    chip.style.top = `${Math.max(10, rect.top + 10)}px`;
  }

  function openImagePopover(info) {
    const popover = ensureImagePopover();
    const rect = info.element.getBoundingClientRect();
    popover._imageInfo = info;
    popover.hidden = false;
    popover.style.left = `${Math.min(window.innerWidth - 280, Math.max(10, rect.left + rect.width / 2 - 140))}px`;
    popover.style.top = `${Math.min(window.innerHeight - 74, Math.max(10, rect.top + 14))}px`;
    const input = popover.querySelector("input");
    input.value = info.element.getAttribute("src") || "";
    input.focus();
    input.select();
  }

  function closeImagePopover() {
    if (editorState.imagePopover) editorState.imagePopover.hidden = true;
  }

  async function applyImageUrl(info, url) {
    if (!isSafeUrl(url, true)) throw new Error("That image URL cannot be used.");
    info.element.setAttribute("src", url);
    await mutateContentLocally((content) => {
      if (info.mode === "collection") {
        const item = collectionItem(content, info);
        if (!item) return;
        item[info.field] = url;
        if (info.altField && !item[info.altField]) item[info.altField] = `Image for ${item.name || item.title || "SALSAV"}`;
        item.updatedAt = new Date().toISOString();
      } else {
        setPageFieldValue(content, info, url, "attr");
      }
    }, {
      type: "text_updated",
      entityType: info.blockType || "image",
      entityId: info.id || info.key,
      label: "Image"
    }, { label: "Image", render: false, history: true });
  }

  function ensureQuillLoaded() {
    if (editorState.quillLoaded && window.Quill) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-salsav-cms-quill="true"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css";
        link.dataset.salsavCmsQuill = "true";
        document.head.appendChild(link);
      }
      if (window.Quill) {
        editorState.quillLoaded = true;
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-salsav-cms-quill="true"]');
      if (existing) {
        existing.addEventListener("load", () => {
          editorState.quillLoaded = true;
          resolve();
        }, { once: true });
        existing.addEventListener("error", () => reject(new Error("Quill failed to load.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js";
      script.dataset.salsavCmsQuill = "true";
      script.onload = () => {
        editorState.quillLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error("Quill failed to load."));
      document.head.appendChild(script);
    });
  }

  function ensureRichModal() {
    let modal = document.querySelector(".salsav-cms-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "salsav-cms-modal";
    modal.innerHTML = `
      <div class="salsav-cms-modal-backdrop" data-close-rich></div>
      <section class="salsav-cms-editor-panel" aria-label="SALSAV rich text editor">
        <div class="salsav-cms-editor-head">
          <div><p class="salsav-cms-kicker">Live rich text</p><h2>Edit copy</h2></div>
          <button type="button" class="salsav-cms-icon-button" data-close-rich aria-label="Close editor">X</button>
        </div>
        <dl class="salsav-cms-field-meta">
          <div><dt>Page</dt><dd class="salsav-cms-editor-page"></dd></div>
          <div><dt>Area</dt><dd class="salsav-cms-editor-key"></dd></div>
          <div><dt>Label</dt><dd class="salsav-cms-editor-label"></dd></div>
          <div><dt>Format</dt><dd class="salsav-cms-editor-type"></dd></div>
        </dl>
        <div class="salsav-cms-rich-editor-shell">
          <div class="salsav-cms-rich-editor"></div>
          <textarea class="salsav-cms-admin-textarea salsav-cms-attr-editor" hidden></textarea>
        </div>
        <div class="salsav-cms-editor-actions">
          <button type="button" class="salsav-cms-button salsav-cms-button-primary" data-save-rich>Save</button>
          <button type="button" class="salsav-cms-button" data-refresh-rich>Refresh from Pantry</button>
          <button type="button" class="salsav-cms-button" data-close-rich>Cancel</button>
        </div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-rich]")) closeRichEditor();
      if (event.target.matches("[data-save-rich]")) saveActiveField();
      if (event.target.matches("[data-refresh-rich]")) refreshActiveField();
    });
    return modal;
  }

  async function openRichTextEditor(target) {
    if (!target || !target.canTextEdit) return;
    const info = target.type === "text" ? { element: target.element, key: target.cmsKey, attr: target.attr } : fieldInfoFromElement(target.element);
    if (!info || !info.key) return;
    editorState.activeField = info;
    const field = findField(editorState.content, info.key) || {};
    const modal = ensureRichModal();
    modal.querySelector(".salsav-cms-editor-page").textContent = editorState.pageId;
    modal.querySelector(".salsav-cms-editor-key").textContent = humanFieldLabel(info.key);
    modal.querySelector(".salsav-cms-editor-label").textContent = field.label || labelFromKey(info.key);
    modal.querySelector(".salsav-cms-editor-type").textContent = info.attr ? "Detail" : (field.type === "html" ? "Rich text" : "Text");
    const editor = modal.querySelector(".salsav-cms-rich-editor");
    const attrEditor = modal.querySelector(".salsav-cms-attr-editor");
    modal.classList.add("salsav-cms-modal-open");

    if (info.attr) {
      editor.hidden = true;
      attrEditor.hidden = false;
      attrEditor.value = field.value || info.element.getAttribute(info.attr) || "";
      attrEditor.focus();
      return;
    }

    attrEditor.hidden = true;
    editor.hidden = false;
    try {
      await ensureQuillLoaded();
      if (editorState.quill) {
        editorState.quill.off("text-change");
        editorState.quill = null;
        editor.innerHTML = "";
      }
      editorState.quill = new window.Quill(editor, {
        theme: "snow",
        modules: {
          toolbar: [
            ["bold", "italic", "underline", "link"],
            [{ list: "ordered" }, { list: "bullet" }, "blockquote"],
            [{ script: "super" }, { script: "sub" }],
            ["clean"]
          ]
        }
      });
      const value = field.value != null ? field.value : info.element.innerHTML;
      editorState.quill.clipboard.dangerouslyPasteHTML(field.type === "html" ? sanitizeRichHtml(value) : escapeHtml(value));
      setTimeout(() => editorState.quill.focus(), 80);
    } catch (error) {
      closeRichEditor();
      toast(error.message || "Rich editor failed to load.", "error");
    }
  }

  function closeRichEditor() {
    const modal = document.querySelector(".salsav-cms-modal");
    if (modal) modal.classList.remove("salsav-cms-modal-open");
    editorState.activeField = null;
  }

  async function refreshActiveField() {
    if (!editorState.activeField) return;
    try {
      await loadLatest();
      const field = findField(editorState.content, editorState.activeField.key);
      if (!field) return;
      if (editorState.activeField.attr) {
        document.querySelector(".salsav-cms-attr-editor").value = field.value || "";
      } else if (editorState.quill) {
        editorState.quill.clipboard.dangerouslyPasteHTML(field.type === "html" ? sanitizeRichHtml(field.value || "") : escapeHtml(field.value || ""));
      }
      toast("Field refreshed.", "success");
    } catch (error) {
      toast(error.message || "Refresh failed.", "error");
    }
  }

  async function saveActiveField() {
    if (!editorState.activeField) return;
    const info = editorState.activeField;
    try {
      let value = "";
      let isRich = false;
      const existing = findField(editorState.content, info.key) || {};
      if (info.attr) {
        value = document.querySelector(".salsav-cms-attr-editor").value.trim();
      } else {
        const html = sanitizeRichHtml(editorState.quill ? editorState.quill.root.innerHTML : "");
        const plain = editorState.quill ? editorState.quill.getText().trim() : "";
        isRich = richTextHasFormatting(html, plain, existing.type);
        value = isRich ? html : plain;
      }

      await saveContentPatch((content) => {
        const targetPageId = info.key.startsWith("global.") ? "global" : editorState.pageId;
        content.pages[targetPageId] = content.pages[targetPageId] || { path: `${targetPageId}.html`, title: labelFromKey(targetPageId), fields: {} };
        content.pages[targetPageId].fields = content.pages[targetPageId].fields || {};
        const previous = content.pages[targetPageId].fields[info.key] || {};
        content.pages[targetPageId].fields[info.key] = {
          type: info.attr ? "attr" : (isRich ? "html" : "text"),
          label: previous.label || labelFromKey(info.key),
          value,
          selectorHint: previous.selectorHint || (info.attr ? `[data-cms-attr-${info.attr}="${info.key}"]` : `[data-cms-key="${info.key}"]`),
          updatedAt: new Date().toISOString()
        };
        if (info.attr) content.pages[targetPageId].fields[info.key].attr = info.attr;
      }, {
        type: isRich ? "rich_text_updated" : "text_updated",
        entityType: "field",
        entityId: info.key,
        label: existing.label || info.key
      });
      closeRichEditor();
      toast("Saved.", "success");
    } catch (error) {
      toast(error.message || "Save failed.", "error");
    }
  }

  function blankArticle() {
    return { id: `news_${Date.now()}`, type: "newsArticle", visible: true, order: 10, category: "article", title: "", source: "", date: "", displayDate: "", description: "", url: "", imageSrc: fallbackImage, imageAlt: "", openInNewTab: true, updatedAt: null };
  }

  function blankMember() {
    return { id: `team_${Date.now()}`, type: "teamMember", visible: true, sectionId: "key_contributors", order: 10, name: "", title: "", description: "", affiliation: "", expertise: "", profileUrl: "#", imageSrc: fallbackImage, imageAlt: "", openInNewTab: true, includeInSummary: false, updatedAt: null };
  }

  function nextOrder(items, sectionKey, sectionValue) {
    const scoped = (items || []).filter((item) => !sectionKey || item[sectionKey] === sectionValue);
    return scoped.reduce((max, item) => Math.max(max, Number(item.order || 0)), 0) + 10;
  }

  async function createVisualArticle() {
    const item = {
      ...blankArticle(),
      id: `news_new_${Date.now()}`,
      title: "New article",
      source: "Source",
      displayDate: "Date",
      description: "Write a short summary.",
      imageAlt: "Preview image",
      order: nextOrder(ensureContent(editorState.content).collections.newsArticles)
    };
    await saveContentPatch((content) => {
      content.collections.newsArticles.push(item);
      normalizeListOrder(content.collections.newsArticles);
    }, {
      type: "news_article_created",
      entityType: "newsArticle",
      entityId: item.id,
      label: "New article"
    }, "New article");
    focusNewCollectionField(item.id, "title");
  }

  async function createVisualMember(sectionId) {
    const section = sectionId || "key_contributors";
    const item = {
      ...blankMember(),
      id: `team_new_${Date.now()}`,
      sectionId: section,
      name: "New team member",
      title: "Role or affiliation",
      description: "Write a short bio.",
      affiliation: "",
      expertise: "",
      imageAlt: "Team member photo",
      order: nextOrder(ensureContent(editorState.content).collections.teamMembers, "sectionId", section)
    };
    await saveContentPatch((content) => {
      content.collections.teamMembers.push(item);
      normalizeListOrder(content.collections.teamMembers, "sectionId");
    }, {
      type: "team_member_created",
      entityType: "teamMember",
      entityId: item.id,
      label: "New team member"
    }, "New team member");
    focusNewCollectionField(item.id, "name");
  }

  function focusNewCollectionField(id, field) {
    window.setTimeout(() => {
      buildTargetRegistry();
      const element = document.querySelector(`[data-cms-block-id="${CSS.escape(id)}"] [data-cms-collection-field="${CSS.escape(field)}"]`);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      const target = Array.from(editorState.targets.values()).find((item) => item.collectionInfo?.id === id && item.collectionInfo?.field === field);
      if (target) {
        selectTarget(target.id);
        startInlineEditor(target);
      }
    }, 80);
  }

  function decorateLiveChrome() {
    if (!readSession() || editorState.mode === "preview") return;
    document.querySelectorAll(".salsav-cms-section-add,.salsav-cms-card-trash,.salsav-cms-card-move").forEach((node) => node.remove());

    if (editorState.pageId === "team") {
      document.querySelectorAll(".team-grid").forEach((grid) => {
        const section = teamSectionFromList(grid) || "key_contributors";
        if (getComputedStyle(grid).position === "static") grid.style.position = "relative";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "salsav-cms-section-add";
        button.textContent = "+";
        button.setAttribute("aria-label", "Add team member");
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          createVisualMember(section).catch((error) => toast(error.message || "Could not add member.", "error"));
        });
        grid.append(button);
      });
    }

    if (editorState.pageId === "news") {
      const grid = document.getElementById("news-grid-container");
      if (grid) {
        if (getComputedStyle(grid).position === "static") grid.style.position = "relative";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "salsav-cms-section-add";
        button.textContent = "+";
        button.setAttribute("aria-label", "Add article");
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          createVisualArticle().catch((error) => toast(error.message || "Could not add article.", "error"));
        });
        grid.append(button);
      }
    }

    document.querySelectorAll('[data-cms-block-id]').forEach((card) => {
      if (isSiteNavigationChrome(card) || !isVisible(card)) return;
      const target = targetFromBlockElement(card);
      if (!target.canDrag) return;
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      const move = document.createElement("button");
      move.type = "button";
      move.className = "salsav-cms-card-move";
      move.textContent = "Move";
      move.setAttribute("aria-label", "Move");
      move.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectTarget(target.id);
        startDrag(target, event);
      });
      card.append(move);
    });

    document.querySelectorAll('[data-cms-block-type="teamMember"], [data-cms-block-type="newsArticle"]').forEach((card) => {
      if (isSiteNavigationChrome(card) || !isVisible(card)) return;
      if (getComputedStyle(card).position === "static") card.style.position = "relative";
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "salsav-cms-card-trash";
      trash.textContent = "Delete";
      trash.setAttribute("aria-label", "Remove");
      trash.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = targetFromBlockElement(card);
        archiveVisualCard(target).catch((error) => toast(error.message || "Could not remove.", "error"));
      });
      card.append(trash);
    });
  }

  async function archiveVisualCard(target) {
    if (!target) return;
    await saveContentPatch((content) => {
      if (target.blockType === "newsArticle") {
        const item = content.collections.newsArticles.find((article) => article.id === target.blockId);
        if (item) {
          item.visible = false;
          item.updatedAt = new Date().toISOString();
        }
      }
      if (target.blockType === "teamMember") {
        const item = content.collections.teamMembers.find((member) => member.id === target.blockId);
        if (item) {
          item.visible = false;
          item.updatedAt = new Date().toISOString();
        }
      }
    }, {
      type: "block_archived",
      entityType: target.blockType,
      entityId: target.blockId,
      label: targetLabel(target)
    }, "Removed");
  }

  function teamSectionsOptions(selected) {
    const sections = ensureContent(editorState.content).collections.teamSections;
    return sections.map((section) => `<option value="${escapeHtml(section.id)}"${section.id === selected ? " selected" : ""}>${escapeHtml(section.label)}</option>`).join("");
  }

  function ensureBlockModal() {
    let modal = document.querySelector(".salsav-cms-live-block-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "salsav-cms-modal salsav-cms-live-block-modal";
    modal.innerHTML = `
      <div class="salsav-cms-modal-backdrop" data-close-block></div>
      <section class="salsav-cms-editor-panel" aria-label="Live block editor">
        <div class="salsav-cms-editor-head">
          <div><p class="salsav-cms-kicker">Live block</p><h2 class="salsav-cms-block-title">Edit block</h2></div>
          <button type="button" class="salsav-cms-icon-button" data-close-block aria-label="Close">X</button>
        </div>
        <form class="salsav-cms-block-form"></form>
        <div class="salsav-cms-editor-actions">
          <button type="button" class="salsav-cms-button salsav-cms-button-primary" data-save-block>Save</button>
          <button type="button" class="salsav-cms-button" data-close-block>Cancel</button>
        </div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-block]")) modal.classList.remove("salsav-cms-modal-open");
      if (event.target.matches("[data-save-block]")) saveBlockModal();
    });
    return modal;
  }

  function input(name, label, value, type = "text") {
    return `<label>${label}<input class="salsav-cms-admin-input" name="${name}" type="${type}" value="${escapeHtml(value || "")}"></label>`;
  }

  function textarea(name, label, value) {
    return `<label>${label}<textarea class="salsav-cms-admin-textarea" name="${name}">${escapeHtml(value || "")}</textarea></label>`;
  }

  function openArticleEditor(id) {
    const content = ensureContent(editorState.content);
    const item = id ? content.collections.newsArticles.find((article) => article.id === id) : blankArticle();
    if (!item) return toast("Article not found.", "error");
    const modal = ensureBlockModal();
    modal.dataset.type = "newsArticle";
    modal.dataset.id = id || "";
    modal.querySelector(".salsav-cms-block-title").textContent = id ? "Edit Article" : "Add Article";
    modal.querySelector(".salsav-cms-block-form").innerHTML = `
      <div class="salsav-cms-field-grid">
        ${input("title", "Title", item.title)}
        <label>Category<select class="salsav-cms-admin-select" name="category">${["article", "paper", "video"].map((category) => `<option value="${category}"${item.category === category ? " selected" : ""}>${category}</option>`).join("")}</select></label>
        ${input("source", "Source", item.source)}
        ${input("date", "Date", item.date, "date")}
        ${input("displayDate", "Display Date", item.displayDate)}
        ${input("url", "URL", item.url)}
        ${input("imageSrc", "Image path/URL", item.imageSrc)}
        ${input("imageAlt", "Image alt", item.imageAlt)}
      </div>
      ${textarea("description", "Description", item.description)}
      <label><input type="checkbox" name="visible"${item.visible !== false ? " checked" : ""}> Visible</label>
      <label><input type="checkbox" name="openInNewTab"${item.openInNewTab !== false ? " checked" : ""}> Open in new tab</label>`;
    modal.classList.add("salsav-cms-modal-open");
  }

  function openMemberEditor(id) {
    const content = ensureContent(editorState.content);
    const item = id ? content.collections.teamMembers.find((member) => member.id === id) : blankMember();
    if (!item) return toast("Team member not found.", "error");
    const modal = ensureBlockModal();
    modal.dataset.type = "teamMember";
    modal.dataset.id = id || "";
    modal.querySelector(".salsav-cms-block-title").textContent = id ? "Edit Team Member" : "Add Team Member";
    modal.querySelector(".salsav-cms-block-form").innerHTML = `
      <div class="salsav-cms-field-grid">
        ${input("name", "Name", item.name)}
        ${input("title", "Title", item.title)}
        <label>Section<select class="salsav-cms-admin-select" name="sectionId">${teamSectionsOptions(item.sectionId)}</select></label>
        ${input("affiliation", "Affiliation", item.affiliation)}
        ${input("expertise", "Expertise", item.expertise)}
        ${input("profileUrl", "Profile URL", item.profileUrl)}
        ${input("imageSrc", "Image path/URL", item.imageSrc)}
        ${input("imageAlt", "Image alt", item.imageAlt)}
      </div>
      ${textarea("description", "Description", item.description)}
      <label><input type="checkbox" name="visible"${item.visible !== false ? " checked" : ""}> Visible</label>
      <label><input type="checkbox" name="openInNewTab"${item.openInNewTab !== false ? " checked" : ""}> Open in new tab</label>
      <label><input type="checkbox" name="includeInSummary"${item.includeInSummary ? " checked" : ""}> Include in Team Summary</label>`;
    modal.classList.add("salsav-cms-modal-open");
  }

  async function saveBlockModal() {
    const modal = ensureBlockModal();
    const type = modal.dataset.type;
    const id = modal.dataset.id;
    const form = modal.querySelector(".salsav-cms-block-form");
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (type === "newsArticle") {
        if (!data.title) throw new Error("Title is required.");
        if (!["article", "paper", "video"].includes(data.category)) throw new Error("Category must be article, paper, or video.");
        if (data.url && !isSafeUrl(data.url, false)) throw new Error("URL is not safe.");
        if (data.imageSrc && !isSafeUrl(data.imageSrc, true)) throw new Error("Image path is not safe.");
        const draftId = id || `news_${slug(data.date || data.displayDate || "undated")}_${slug(data.source)}_${slug(data.title)}`;
        await saveContentPatch((content) => {
          const list = content.collections.newsArticles;
          const index = id ? list.findIndex((article) => article.id === id) : -1;
          const existing = index >= 0 ? list[index] : blankArticle();
          const item = {
            ...existing,
            ...data,
            id: existing.id || draftId,
            type: "newsArticle",
            visible: form.querySelector('[name="visible"]').checked,
            openInNewTab: form.querySelector('[name="openInNewTab"]').checked,
            imageSrc: data.imageSrc || fallbackImage,
            imageAlt: data.imageAlt || `Preview of ${data.title}`,
            updatedAt: new Date().toISOString()
          };
          if (index >= 0) list[index] = item;
          else list.push(item);
          normalizeListOrder(list);
        }, {
          type: id ? "news_article_updated" : "news_article_created",
          entityType: "newsArticle",
          entityId: draftId,
          label: data.title
        });
      }

      if (type === "teamMember") {
        if (!data.name) throw new Error("Name is required.");
        if (data.profileUrl && !isSafeUrl(data.profileUrl, false)) throw new Error("Profile URL is not safe.");
        if (data.imageSrc && !isSafeUrl(data.imageSrc, true)) throw new Error("Image path is not safe.");
        const draftId = id || `team_${slug(data.name)}`;
        await saveContentPatch((content) => {
          const list = content.collections.teamMembers;
          const index = id ? list.findIndex((member) => member.id === id) : -1;
          const existing = index >= 0 ? list[index] : blankMember();
          const item = {
            ...existing,
            ...data,
            id: existing.id || draftId,
            type: "teamMember",
            visible: form.querySelector('[name="visible"]').checked,
            openInNewTab: form.querySelector('[name="openInNewTab"]').checked,
            includeInSummary: form.querySelector('[name="includeInSummary"]').checked,
            imageSrc: data.imageSrc || fallbackImage,
            imageAlt: data.imageAlt || `Photo of ${data.name}`,
            updatedAt: new Date().toISOString()
          };
          if (index >= 0) list[index] = item;
          else list.push(item);
          normalizeListOrder(list, "sectionId");
        }, {
          type: id ? "team_member_updated" : "team_member_created",
          entityType: "teamMember",
          entityId: draftId,
          label: data.name
        });
      }
      modal.classList.remove("salsav-cms-modal-open");
      toast("Block saved.", "success");
    } catch (error) {
      toast(error.message || "Block save failed.", "error");
    }
  }

  function normalizeListOrder(list, sectionKey) {
    const groups = new Map();
    list.forEach((item) => {
      const group = sectionKey ? item[sectionKey] || "" : "__all";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    });
    groups.forEach((items) => items.sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999)).forEach((item, index) => {
      item.order = (index + 1) * 10;
    }));
  }

  function startDrag(target, event) {
    if (!target || !target.canDrag) return;
    event.preventDefault();
    event.stopPropagation();
    editorState.isDragging = true;
    const rect = target.element.getBoundingClientRect();
    const placeholder = document.createElement(target.element.tagName === "TR" ? "tr" : "div");
    placeholder.className = "salsav-cms-drop-placeholder";
    if (placeholder.tagName === "TR") {
      const cell = document.createElement("td");
      cell.colSpan = target.element.children.length || 1;
      cell.style.height = `${Math.max(32, rect.height)}px`;
      placeholder.append(cell);
    } else {
      placeholder.style.width = `${rect.width}px`;
      placeholder.style.height = `${rect.height}px`;
    }
    target.element.classList.add("salsav-cms-sortable-row-is-dragging");
    editorState.drag = {
      target,
      startX: event.clientX,
      startY: event.clientY,
      baseX: readCssPx(target.element, "--cms-x"),
      baseY: readCssPx(target.element, "--cms-y"),
      placeholder,
      listElement: target.listElement,
      mode: target.listElement ? "reorder" : "free"
    };
    document.addEventListener("pointermove", dragMove);
    document.addEventListener("pointerup", commitDrag, { once: true });
  }

  function dragMove(event) {
    const drag = editorState.drag;
    if (!drag) return;
    if (drag.mode === "free") {
      const x = Math.round(drag.baseX + event.clientX - drag.startX);
      const y = Math.round(drag.baseY + event.clientY - drag.startY);
      drag.target.element.style.setProperty("--cms-x", `${x}px`);
      drag.target.element.style.setProperty("--cms-y", `${y}px`);
      drag.target.element.style.transform = `translate(var(--cms-x, 0px), var(--cms-y, 0px))`;
      scheduleOverlay();
      return;
    }
    const drop = findDropTarget(event.clientX, event.clientY, drag.target);
    if (!drop || !drop.list) return;
    if (!drag.placeholder.parentElement) drop.list.insertBefore(drag.placeholder, drop.before);
    else drop.list.insertBefore(drag.placeholder, drop.before);
    placeDropIndicator(drag.placeholder);
  }

  function findDropTarget(x, y, draggedTarget) {
    const previous = editorState.overlay.style.pointerEvents;
    editorState.overlay.style.pointerEvents = "none";
    const element = document.elementFromPoint(x, y);
    editorState.overlay.style.pointerEvents = previous;
    const compatibleLists = Array.from(document.querySelectorAll("[data-cms-list],#news-grid-container,.news-grid,.team-grid,.project-table tbody,.proof-grid,.partners-grid,.carousel-track,.pillars-left,.footer-links ul")).filter((list) => isCompatibleList(list, draggedTarget));
    let list = element?.closest("[data-cms-list],#news-grid-container,.news-grid,.team-grid,.project-table tbody,.proof-grid,.partners-grid,.carousel-track,.pillars-left,.footer-links ul");
    if (!list || !compatibleLists.includes(list)) {
      list = compatibleLists.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      });
    }
    if (!list) return null;
    const children = Array.from(list.querySelectorAll(":scope > [data-cms-block-id]")).filter((child) => child !== draggedTarget.element && child !== editorState.drag.placeholder);
    const before = children.find((child) => {
      const rect = child.getBoundingClientRect();
      const axisPoint = list.matches("tbody") ? y : (list.scrollWidth > list.clientWidth ? x : y);
      const midpoint = list.matches("tbody") ? rect.top + rect.height / 2 : (list.scrollWidth > list.clientWidth ? rect.left + rect.width / 2 : rect.top + rect.height / 2);
      return axisPoint < midpoint;
    }) || null;
    return { list, before };
  }

  function isCompatibleList(list, target) {
    const listType = list.getAttribute("data-cms-list-type") || inferListType(list, target.blockType);
    if (target.blockType === "teamMember") return listType === "teamMembers";
    if (target.blockType === "newsArticle") return listType === "newsArticles" || listIdForElement(list) === "news.articles";
    return listType === target.listType || (target.collectionType === "genericBlocks" && listType === "genericBlocks");
  }

  function placeDropIndicator(placeholder) {
    if (!editorState.dropIndicator || !placeholder.parentElement) return;
    const rect = placeholder.getBoundingClientRect();
    editorState.dropIndicator.hidden = false;
    editorState.dropIndicator.style.left = `${rect.left}px`;
    editorState.dropIndicator.style.top = `${rect.top}px`;
    editorState.dropIndicator.style.width = `${Math.max(24, rect.width)}px`;
    editorState.dropIndicator.style.height = `${Math.max(4, rect.height)}px`;
  }

  async function commitDrag() {
    document.removeEventListener("pointermove", dragMove);
    const drag = editorState.drag;
    editorState.isDragging = false;
    editorState.drag = null;
    if (!drag) return;
    drag.target.element.classList.remove("salsav-cms-sortable-row-is-dragging");
    editorState.dropIndicator.hidden = true;
    try {
      if (drag.mode === "free") {
        const x = readCssPx(drag.target.element, "--cms-x");
        const y = readCssPx(drag.target.element, "--cms-y");
        await saveLayoutPatch(drag.target.blockId, { x, y, positionMode: "translate" }, {
          type: "block_reordered",
          entityType: drag.target.blockType || "genericBlock",
          entityId: drag.target.blockId,
          label: targetLabel(drag.target)
        });
        toast("Position saved.", "success");
      } else if (drag.placeholder.parentElement) {
        drag.placeholder.parentElement.insertBefore(drag.target.element, drag.placeholder);
        drag.placeholder.remove();
        await persistDomOrder(drag.target.listElement || drag.target.element.closest("[data-cms-list]"), drag.target);
        toast("Order saved.", "success");
      }
    } catch (error) {
      toast(error.message || "Move failed.", "error");
      refreshContent();
    } finally {
      drag.placeholder.remove();
      buildTargetRegistry();
    }
  }

  function startResize(target, event, side) {
    if (!target || !target.canResize) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = target.element.getBoundingClientRect();
    const parent = target.element.parentElement;
    const parentStyle = parent ? getComputedStyle(parent) : null;
    const parentWidth = Math.max(180, parent?.getBoundingClientRect().width || window.innerWidth);
    const columns = Number(parent?.getAttribute("data-cms-grid") || target.canvasElement?.getAttribute("data-cms-grid") || 12);
    if (parent && parentStyle?.display.includes("grid")) {
      parent.classList.add("salsav-cms-managed-grid");
      if (!parent.getAttribute("data-cms-grid")) parent.setAttribute("data-cms-grid", String(Number.isFinite(columns) ? columns : 12));
      parent.style.setProperty("--cms-grid-columns", String(Number.isFinite(columns) ? Math.max(1, Math.min(12, columns)) : 12));
      ensureGridChildSpans(parent);
    }
    editorState.isResizing = true;
    editorState.resize = {
      target,
      side: side === "bottom-right" ? "corner" : (side || "corner"),
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      parentWidth,
      parentDisplay: parentStyle?.display || "",
      columns: Number.isFinite(columns) ? Math.max(1, Math.min(12, columns)) : 12,
      flexBasis: "",
      colSpan: null,
      minHeight: ""
    };
    document.addEventListener("pointermove", resizeMove);
    document.addEventListener("pointerup", commitResize, { once: true });
  }

  function ensureGridChildSpans(grid) {
    if (!grid) return;
    const columns = Math.max(1, Number(grid.getAttribute("data-cms-grid") || 12) || 12);
    grid.style.setProperty("--cms-grid-columns", String(Math.min(12, columns)));
    const children = Array.from(grid.querySelectorAll(":scope > [data-cms-block-id]")).filter(isVisible);
    const defaultSpan = columns >= 12 ? 4 : 1;
    children.forEach((child) => {
      if (!child.style.getPropertyValue("--cms-col-span")) child.style.setProperty("--cms-col-span", String(defaultSpan));
      if (!child.style.gridColumn) child.style.gridColumn = `span ${Math.min(columns, Number(child.style.getPropertyValue("--cms-col-span")) || defaultSpan)}`;
    });
  }

  function resizeMove(event) {
    const resize = editorState.resize;
    if (!resize) return;
    const maxWidth = Math.max(180, Math.min(resize.parentWidth, window.innerWidth - 24));
    const maxHeight = Math.max(240, Math.round(window.innerHeight * 1.4));
    const width = Math.round(Math.max(180, Math.min(maxWidth, resize.width + event.clientX - resize.startX)));
    const height = Math.round(Math.max(120, Math.min(maxHeight, resize.height + event.clientY - resize.startY)));
    if (resize.side === "right" || resize.side === "corner") {
      const basis = `${Math.max(18, Math.min(100, (width / resize.parentWidth) * 100)).toFixed(3)}%`;
      resize.flexBasis = basis;
      resize.target.element.style.setProperty("--cms-block-width", basis);
      if (resize.parentDisplay.includes("grid")) {
        const span = Math.max(1, Math.min(resize.columns, Math.round((width / resize.parentWidth) * resize.columns)));
        resize.colSpan = span;
        resize.target.element.parentElement?.classList.add("salsav-cms-managed-grid");
        ensureGridChildSpans(resize.target.element.parentElement);
        resize.target.element.style.setProperty("--cms-col-span", String(span));
        resize.target.element.style.gridColumn = `span ${span}`;
      } else {
        resize.target.element.style.setProperty("width", basis, "important");
        resize.target.element.style.flexBasis = basis;
        resize.target.element.style.maxWidth = basis;
      }
    }
    if (resize.side === "bottom" || resize.side === "corner") {
      resize.minHeight = `${height}px`;
      resize.target.element.style.setProperty("--cms-block-min-height", resize.minHeight);
      resize.target.element.style.minHeight = resize.minHeight;
    }
    scheduleOverlay();
  }

  async function commitResize() {
    document.removeEventListener("pointermove", resizeMove);
    const resize = editorState.resize;
    editorState.isResizing = false;
    editorState.resize = null;
    if (!resize) return;
    try {
      const width = resize.colSpan ? "" : (resize.flexBasis || resize.target.element.style.getPropertyValue("--cms-block-width") || "");
      const minHeight = resize.minHeight || resize.target.element.style.minHeight || "";
      const image = resize.target.element.querySelector(".news-image-wrapper, .researcher-image-container, .pi-image, .content-image");
      const imageHeight = image ? image.style.height || "" : "";
      await saveLayoutPatch(resize.target.blockId, { width, flexBasis: resize.flexBasis, colSpan: resize.colSpan, minHeight, imageHeight }, {
        type: "block_resized",
        entityType: resize.target.blockType || "genericBlock",
        entityId: resize.target.blockId,
        label: targetLabel(resize.target)
      });
      toast("Size saved.", "success");
    } catch (error) {
      toast(error.message || "Resize failed.", "error");
      refreshContent();
    }
  }

  function readCssPx(element, property) {
    const value = element.style.getPropertyValue(property) || getComputedStyle(element).getPropertyValue(property);
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function persistDomOrder(list, target) {
    if (!list || !target) return;
    const ids = Array.from(list.querySelectorAll(":scope > [data-cms-block-id]")).map((node) => node.getAttribute("data-cms-block-id"));
    const section = teamSectionFromList(list);
    await saveContentPatch((content) => {
      if (target.blockType === "newsArticle") {
        ids.forEach((id, index) => {
          const item = content.collections.newsArticles.find((article) => article.id === id);
          if (item) item.order = (index + 1) * 10;
        });
      } else if (target.blockType === "teamMember") {
        ids.forEach((id, index) => {
          const item = content.collections.teamMembers.find((member) => member.id === id);
          if (item) {
            item.order = (index + 1) * 10;
            if (section) item.sectionId = section;
          }
        });
      } else {
        const key = `${editorState.pageId}.${listIdForElement(list)}`;
        content.collections.genericBlocks[key] = ids.map((id, index) => ({
          id,
          visible: true,
          order: (index + 1) * 10,
          updatedAt: new Date().toISOString()
        }));
      }
    }, {
      type: section && target.blockType === "teamMember" && section !== target.element.dataset.cmsOriginalSection ? "block_moved_section" : "block_reordered",
      entityType: target.blockType || "genericBlock",
      entityId: target.blockId,
      label: targetLabel(target)
    });
  }

  function teamSectionFromList(list) {
    const value = listIdForElement(list);
    if (value.includes("key_contributors")) return "key_contributors";
    if (value.includes("alumni")) return "alumni";
    if (value.includes("principal")) return "principal_investigator";
    if (value.includes("summary")) return "team_summary";
    return "";
  }

  async function moveBlockByStep(target, direction) {
    if (!target?.listElement) return;
    const siblings = Array.from(target.listElement.querySelectorAll(":scope > [data-cms-block-id]")).filter((node) => !node.hidden);
    const index = siblings.indexOf(target.element);
    const other = siblings[index + direction];
    if (!other) return;
    if (direction < 0) target.listElement.insertBefore(target.element, other);
    else target.listElement.insertBefore(other, target.element);
    await persistDomOrder(target.listElement, target);
  }

  async function handleBlockAction(target, action, value) {
    if (!target) return;
    if (action === "edit-text") return startInlineEditor(target);
    if (action === "edit-block") {
      if (target.blockType === "newsArticle") return focusNewCollectionField(target.blockId, "title");
      if (target.blockType === "teamMember") return focusNewCollectionField(target.blockId, "name");
      const nested = target.element.querySelector("[data-cms-key]");
      if (nested) return startInlineEditor(findTargetForElement(nested, "text"));
      return toast("This generic block has no editable settings yet.", "info");
    }
    if (action === "add-article") return createVisualArticle();
    if (action === "add-member") return createVisualMember(target?.listElement ? teamSectionFromList(target.listElement) : undefined);
    if (action === "add-generic") return toast("Generic card creation uses the static page template in this release.", "info");
    if (action === "move-up") return moveBlockByStep(target, -1).then(() => toast("Moved up.", "success")).catch((error) => toast(error.message || "Move failed.", "error"));
    if (action === "move-down") return moveBlockByStep(target, 1).then(() => toast("Moved down.", "success")).catch((error) => toast(error.message || "Move failed.", "error"));
    if (action === "reset-size") return resetBlockSize(target);
    if (action === "reset-page-layout") return resetPageLayout();
    if (action === "move-section") return moveTeamSection(target, value);

    try {
      await saveContentPatch((content) => {
        if (target.blockType === "newsArticle") {
          const list = content.collections.newsArticles;
          const item = list.find((article) => article.id === target.blockId);
          if (!item) return;
          if (action === "duplicate-block") list.push({ ...item, id: `${item.id}_copy_${Date.now()}`, title: `${item.title} (copy)`, order: Number(item.order || 0) + 1, updatedAt: new Date().toISOString() });
          if (action === "archive-block" || action === "delete-block") {
            item.visible = false;
            item.updatedAt = new Date().toISOString();
          }
          normalizeListOrder(list);
        } else if (target.blockType === "teamMember") {
          const list = content.collections.teamMembers;
          const item = list.find((member) => member.id === target.blockId);
          if (!item) return;
          if (action === "duplicate-block") list.push({ ...item, id: `${item.id}_copy_${Date.now()}`, name: `${item.name} (copy)`, order: Number(item.order || 0) + 1, updatedAt: new Date().toISOString() });
          if (action === "archive-block" || action === "delete-block") {
            item.visible = false;
            item.updatedAt = new Date().toISOString();
          }
          normalizeListOrder(list, "sectionId");
        } else {
          const key = `${editorState.pageId}.${target.listId || "blocks"}`;
          content.collections.genericBlocks[key] = content.collections.genericBlocks[key] || [];
          let item = content.collections.genericBlocks[key].find((entry) => entry.id === target.blockId);
          if (!item) {
            item = { id: target.blockId, visible: true, order: content.collections.genericBlocks[key].length * 10 + 10, updatedAt: null };
            content.collections.genericBlocks[key].push(item);
          }
          if (action === "duplicate-block") toast("Generic duplication uses the static page template in this release.", "info");
          if (action === "archive-block" || action === "delete-block") item.visible = false;
        }
      }, {
        type: action === "duplicate-block" ? "block_duplicated" : action === "archive-block" ? "block_archived" : "block_deleted",
        entityType: target.blockType || "genericBlock",
        entityId: target.blockId,
        label: targetLabel(target)
      });
      toast("Block updated.", "success");
    } catch (error) {
      toast(error.message || "Block action failed.", "error");
    }
  }

  async function moveTeamSection(target, sectionId) {
    if (target?.blockType !== "teamMember" || !sectionId) return;
    try {
      await saveContentPatch((content) => {
        const item = content.collections.teamMembers.find((member) => member.id === target.blockId);
        if (!item) return;
        item.sectionId = sectionId;
        item.updatedAt = new Date().toISOString();
        normalizeListOrder(content.collections.teamMembers, "sectionId");
      }, {
        type: "block_moved_section",
        entityType: "teamMember",
        entityId: target.blockId,
        label: targetLabel(target)
      });
      toast("Team member moved.", "success");
    } catch (error) {
      toast(error.message || "Section move failed.", "error");
    }
  }

  async function resetBlockSize(target) {
    try {
      await saveContentPatch((content) => {
        const page = content.layout.pages[editorState.pageId];
        if (page?.blocks) delete page.blocks[target.blockId];
      }, {
        type: "layout_reset",
        entityType: target.blockType || "genericBlock",
        entityId: target.blockId,
        label: targetLabel(target)
      });
      target.element.style.removeProperty("--cms-block-width");
      target.element.style.removeProperty("--cms-block-min-height");
      target.element.style.removeProperty("--cms-image-height");
      target.element.style.removeProperty("--cms-col-span");
      target.element.style.removeProperty("--cms-row-span");
      target.element.style.removeProperty("--cms-x");
      target.element.style.removeProperty("--cms-y");
      target.element.style.width = "";
      target.element.style.minHeight = "";
      target.element.style.flexBasis = "";
      target.element.style.maxWidth = "";
      target.element.style.gridColumn = "";
      target.element.style.gridRow = "";
      target.element.style.transform = "";
      toast("Size reset.", "success");
    } catch (error) {
      toast(error.message || "Reset failed.", "error");
    }
  }

  async function resetPageLayout() {
    if (!confirm("Reset saved layout overrides for this page?")) return;
    try {
      await saveContentPatch((content) => {
        if (content.layout.pages[editorState.pageId]) content.layout.pages[editorState.pageId] = { blocks: {} };
      }, {
        type: "page_layout_reset",
        entityType: "page",
        entityId: editorState.pageId,
        label: editorState.pageId
      });
      toast("Page layout reset.", "success");
    } catch (error) {
      toast(error.message || "Reset failed.", "error");
    }
  }

  function resizeSideFromPoint(element, x, y) {
    if (!element || !isResizableBlock(element)) return "";
    const rect = element.getBoundingClientRect();
    const edge = 12;
    const nearRight = Math.abs(x - rect.right) <= edge && y >= rect.top && y <= rect.bottom;
    const nearBottom = Math.abs(y - rect.bottom) <= edge && x >= rect.left && x <= rect.right;
    if (nearRight && nearBottom) return "bottom-right";
    if (nearRight) return "right";
    if (nearBottom) return "bottom";
    return "";
  }

  function blockTargetFromEvent(event) {
    const block = event.target?.closest?.("[data-cms-block-id],.news-card,.researcher-card,.pi-profile,.project-table tbody tr,.slide,.partner-logo-link,.proof-card,.site-card,.education-card,.research-card");
    if (!block || isCmsChrome(block) || isSiteNavigationChrome(block)) return null;
    return Array.from(editorState.targets.values()).find((target) => target.type === "block" && target.element === block) || targetFromBlockElement(block);
  }

  function updateDirectManipulationCursor(event) {
    if (!readSession() || editorState.mode === "preview" || editorState.isDragging || editorState.isResizing || isCmsChrome(event.target)) return;
    const target = blockTargetFromEvent(event);
    const side = target?.canResize ? resizeSideFromPoint(target.element, event.clientX, event.clientY) : "";
    document.documentElement.classList.toggle("salsav-cms-edge-ready", Boolean(side));
    document.documentElement.dataset.cmsResizeSide = side || "";
  }

  function clearPendingDrag() {
    if (!editorState.pendingDrag) return;
    document.removeEventListener("pointermove", editorState.pendingDrag.onMove, true);
    document.removeEventListener("pointerup", editorState.pendingDrag.onUp, true);
    editorState.pendingDrag = null;
  }

  function setupDirectDrag(target, event) {
    if (!target?.canDrag || event.button !== 0 || event.target.closest("[data-cms-collection-field],[data-cms-key],img,input,textarea,select,button")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startEvent = event;
    const onMove = (moveEvent) => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (distance < 9) return;
      clearPendingDrag();
      startDrag(target, startEvent);
      dragMove(moveEvent);
    };
    const onUp = () => clearPendingDrag();
    editorState.pendingDrag = { onMove, onUp };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
  }

  function bindPageEvents() {
    document.addEventListener("mousemove", (event) => {
      if (!readSession() || editorState.isDragging || editorState.isResizing || editorState.mode === "preview" || isCmsChrome(event.target)) return;
      updateDirectManipulationCursor(event);
      placeImageChip(imageInfoFromElement(event.target));
      const target = getTargetFromPoint(event.clientX, event.clientY);
      const id = target ? target.id : null;
      if (id !== editorState.hoveredTargetId) {
        editorState.hoveredTargetId = id;
        scheduleOverlay();
      }
    }, true);

    document.addEventListener("pointerdown", (event) => {
      if (!readSession() || editorState.mode === "preview" || isCmsChrome(event.target) || editorState.inline) return;
      const target = blockTargetFromEvent(event);
      if (!target) return;
      const side = target.canResize ? resizeSideFromPoint(target.element, event.clientX, event.clientY) : "";
      if (side) {
        selectTarget(target.id);
        startResize(target, event, side);
        return;
      }
      setupDirectDrag(target, event);
    }, true);

    document.addEventListener("click", (event) => {
      if (!readSession() || editorState.mode === "preview" || isCmsChrome(event.target)) return;
      closeImagePopover();
      const target = getTargetFromPoint(event.clientX, event.clientY);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectTarget(target.id);
      if (editorState.mode === "text") startInlineEditor(target);
    }, true);

    editorState.actionLayer.addEventListener("pointerdown", (event) => {
      const selected = editorState.selectedTargetId ? editorState.targets.get(editorState.selectedTargetId) : null;
      if (!selected) return;
      const dragButton = event.target.closest('[data-overlay-action="drag-handle"]');
      const resizeButton = event.target.closest("[data-resize-side]");
      if (dragButton) startDrag(selected, event);
      if (resizeButton) startResize(selected, event, resizeButton.dataset.resizeSide);
    });

    editorState.actionLayer.addEventListener("click", (event) => {
      const selected = editorState.selectedTargetId ? editorState.targets.get(editorState.selectedTargetId) : null;
      if (!selected) return;
      const action = event.target.closest("[data-overlay-action]")?.dataset.overlayAction;
      if (!action || action === "drag-handle" || action === "move-section") return;
      event.preventDefault();
      event.stopPropagation();
      handleBlockAction(selected, action);
    });

    editorState.actionLayer.addEventListener("change", (event) => {
      const selected = editorState.selectedTargetId ? editorState.targets.get(editorState.selectedTargetId) : null;
      if (selected && event.target.dataset.overlayAction === "move-section") handleBlockAction(selected, "move-section", event.target.value);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeInlineEditor();
        closeImagePopover();
        closeRichEditor();
        document.querySelector(".salsav-cms-live-block-modal")?.classList.remove("salsav-cms-modal-open");
        editorState.selectedTargetId = null;
        scheduleOverlay();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editorState.activeField) {
        event.preventDefault();
        saveActiveField();
      }
    });

    document.addEventListener("selectionchange", updateFormatToolbar);
    window.addEventListener("scroll", scheduleOverlay, { passive: true });
    window.addEventListener("resize", () => {
      buildTargetRegistry();
      scheduleOverlay();
    });
    document.addEventListener("load", (event) => {
      if (event.target && event.target.tagName === "IMG") scheduleOverlay();
    }, true);
  }

  function init() {
    if (!readSession()) return;
    editorState.pageId = pageId();
    const initialContent = window.SALSAV_CMS_CONTENT || null;
    editorState.seedMerged = Boolean(initialContent && initialContent.__seedMerged);
    editorState.content = ensureContent(initialContent);
    editorState.baseContent = ensureContent(deepClone(editorState.content));
    editorState.history = [{ label: "Start", content: snapshotContent() }];
    editorState.historyIndex = 0;
    document.documentElement.classList.add("salsav-cms-admin");
    ensureOverlayLayer();
    ensureToolbar();
    buildTargetRegistry();
    bindPageEvents();
    startBackgroundSync();
    setSyncStatus("idle", "Ready");
    setMode("text");
    if (editorState.seedMerged) {
      queueSeedSync();
    }
  }

  function queueSeedSync() {
    if (editorState.seedSyncQueued || !readSession()) return;
    editorState.seedSyncQueued = true;
    queueAudit({
      type: "seed_imported",
      entityType: "site",
      entityId: "salsav_site_content",
      label: "Initial site content"
    });
    markDirty("Syncing initial content");
    flushSync().catch(() => {});
  }

  window.SALSAVLiveEditor = {
    editorState,
    buildTargetRegistry,
    getTargetFromPoint,
    selectTarget,
    renderOverlay,
    setMode,
    openRichTextEditor,
    startDrag,
    commitDrag,
    startResize,
    commitResize,
    openBlockActions: (target) => {
      if (target?.id) selectTarget(target.id);
      setMode("blocks");
    },
    saveContentPatch,
    saveLayoutPatch,
    appendAudit,
    openArticleEditor,
    openMemberEditor,
    sanitizeRichHtml
  };

  window.addEventListener("salsav:cms-hydrated", (event) => {
    editorState.pageId = event.detail.pageId || pageId();
    const hydratedContent = event.detail.content || editorState.content;
    editorState.seedMerged = Boolean(hydratedContent && hydratedContent.__seedMerged);
    editorState.content = ensureContent(hydratedContent);
    editorState.baseContent = ensureContent(deepClone(editorState.content));
    if (!editorState.history.length) {
      editorState.history = [{ label: "Start", content: snapshotContent() }];
      editorState.historyIndex = 0;
    }
    document.querySelector(".salsav-cms-page-chip")?.replaceChildren(document.createTextNode(editorState.pageId));
    buildTargetRegistry();
    updateDockState();
    if (editorState.seedMerged) queueSeedSync();
  });

  window.addEventListener("salsav:live-layout-applied", () => {
    buildTargetRegistry();
  });

  window.addEventListener("salsav:collections-rendered", () => {
    buildTargetRegistry();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
