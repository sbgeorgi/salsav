(function () {
  const allowedAttr = new Set(["alt", "title", "aria-label", "placeholder", "content", "src"]);
  const allowedTags = new Set(["A", "STRONG", "B", "EM", "I", "U", "BR", "SPAN", "SUP", "SUB", "SMALL", "P", "UL", "OL", "LI", "BLOCKQUOTE"]);
  const allowedClasses = new Set(["cms-accent", "cms-muted", "cms-highlight", "cms-small", "cms-bold", "cms-italic"]);
  const allowedProtocols = new Set(["http:", "https:", "mailto:"]);
  let seedFallbackPromise = null;

  function inferPageId() {
    const explicit = document.body && document.body.dataset.cmsPage;
    if (explicit) return explicit;
    const name = window.location.pathname.split("/").pop() || "index.html";
    return name.replace(/\.html?$/i, "") || "index";
  }

  function isSafeUrl(value, imageOnly) {
    if (!value) return true;
    const trimmed = String(value).trim();
    if ((!imageOnly && trimmed.startsWith("#")) || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
      return true;
    }
    try {
      const protocol = new URL(trimmed, window.location.href).protocol;
      return imageOnly ? ["http:", "https:"].includes(protocol) : allowedProtocols.has(protocol);
    } catch (error) {
      return false;
    }
  }

  function sanitizeHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");

    function cleanNode(node) {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (!allowedTags.has(child.tagName)) {
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
              return;
            }
            if (name === "class") {
              const kept = value.split(/\s+/).filter((className) => allowedClasses.has(className));
              if (kept.length) child.setAttribute("class", kept.join(" "));
              else child.removeAttribute(attr.name);
              return;
            }
            child.removeAttribute(attr.name);
          });

          cleanNode(child);
        } else if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
        }
      });
    }

    cleanNode(template.content);
    return template.innerHTML;
  }

  function findField(content, pageId, key) {
    const pages = content && content.pages ? content.pages : {};
    const globalFields = pages.global && pages.global.fields ? pages.global.fields : {};
    const pageFields = pages[pageId] && pages[pageId].fields ? pages[pageId].fields : {};
    if (Object.prototype.hasOwnProperty.call(pageFields, key)) return pageFields[key];
    if (Object.prototype.hasOwnProperty.call(globalFields, key)) return globalFields[key];
    return null;
  }

  function renderElement(element, field) {
    if (!field || typeof field.value === "undefined" || field.value === null) return;
    if (field.type === "html") {
      element.innerHTML = sanitizeHtml(field.value);
      return;
    }
    element.textContent = String(field.value);
  }

  function renderAttr(element, attr, field) {
    if (!allowedAttr.has(attr) || !field || typeof field.value === "undefined" || field.value === null) return;
    if (attr === "src") {
      if (!element.matches("img, source, video")) return;
      const value = String(field.value || "").trim();
      if (!isSafeUrl(value, true)) return;
      element.setAttribute(attr, value);
      return;
    }
    if ((attr === "content" || attr === "placeholder" || attr === "title" || attr === "aria-label" || attr === "alt")) {
      element.setAttribute(attr, String(field.value));
    }
  }

  function applyFields(content, pageId) {
    document.querySelectorAll("[data-cms-key]").forEach((element) => {
      const field = findField(content, pageId, element.dataset.cmsKey);
      renderElement(element, field);
    });

    allowedAttr.forEach((attr) => {
      const dataName = `cmsAttr${attr.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^./, (letter) => letter.toUpperCase())}`;
      document.querySelectorAll(`[data-cms-attr-${attr}]`).forEach((element) => {
        const key = element.dataset[dataName];
        const field = findField(content, pageId, key);
        renderAttr(element, attr, field);
      });
    });
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

  async function loadSeedFallback() {
    if (seedFallbackPromise) return seedFallbackPromise;
    seedFallbackPromise = fetch("cms/seed-content.json", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload) return null;
        const content = normalizeContentPayload(payload);
        Object.defineProperty(content, "__seedMerged", {
          value: true,
          enumerable: false,
          configurable: true
        });
        return content;
      })
      .catch(() => null);
    return seedFallbackPromise;
  }

  function applyLayout(content) {
    if (window.SALSAVLiveLayout && typeof window.SALSAVLiveLayout.renderCurrentPageCollections === "function") {
      window.SALSAVLiveLayout.renderCurrentPageCollections(content);
    }
  }

  function applyContent(content, targetPageId) {
    const nextPageId = targetPageId || inferPageId();
    window.SALSAV_CMS_PAGE_ID = nextPageId;
    window.SALSAV_CMS_CONTENT = content;
    applyFields(content, nextPageId);
    applyLayout(content);
    window.dispatchEvent(new CustomEvent("salsav:cms-hydrated", {
      detail: { pageId: nextPageId, content }
    }));
  }

  async function refreshContent() {
    const nextPageId = inferPageId();
    if (!window.SALSAVPantry) throw new Error("SALSAVPantry is unavailable.");
    const content = await window.SALSAVPantry.getContent({ force: true });
    applyContent(content, nextPageId);
    return content;
  }

  async function hydrate() {
    const pageId = inferPageId();
    window.SALSAV_CMS_PAGE_ID = pageId;
    let content = null;

    try {
      if (!window.SALSAVPantry) throw new Error("SALSAVPantry is unavailable.");
      content = await window.SALSAVPantry.getContent();
      applyFields(content, pageId);
    } catch (error) {
      console.warn("[SALSAV CMS] Pantry hydration skipped:", error.message);
      content = await loadSeedFallback();
      if (content) applyFields(content, pageId);
    }

    window.SALSAV_CMS_CONTENT = content;
    window.SALSAVCMS = {
      pageId,
      content,
      refreshContent,
      applyContent,
      applyLayout
    };
    window.dispatchEvent(new CustomEvent("salsav:cms-hydrated", {
      detail: { pageId, content }
    }));
  }

  window.SALSAVCMSCore = {
    inferPageId,
    hydrate,
    refreshContent,
    applyContent,
    applyLayout,
    applyFields,
    sanitizeHtml,
    renderElement,
    renderAttr
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, { once: true });
  } else {
    hydrate();
  }
})();
