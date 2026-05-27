(function () {
  const config = window.SALSAV_CMS_CONFIG || {};
  const modes = ["text", "move", "resize", "blocks", "preview"];
  const safeAttrs = ["alt", "title", "aria-label", "placeholder", "content"];
  const allowedRichClasses = new Set(["cms-accent", "cms-muted", "cms-highlight", "cms-small", "cms-bold", "cms-italic"]);
  const allowedRichTags = new Set(["A", "STRONG", "B", "EM", "I", "U", "BR", "SPAN", "SUP", "SUB", "SMALL", "P", "UL", "OL", "LI", "BLOCKQUOTE"]);
  const fallbackImage = "static/salsa-logo.png";

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
    overlay: null,
    hoverBox: null,
    selectedBox: null,
    dropIndicator: null,
    actionLayer: null,
    raf: 0,
    drag: null,
    resize: null,
    quill: null,
    quillLoaded: false,
    activeField: null,
    saveQueue: Promise.resolve()
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
    editorState.content = ensureContent(await window.SALSAVPantry.getContent());
    window.SALSAV_CMS_CONTENT = editorState.content;
    if (window.SALSAVCMS) window.SALSAVCMS.content = editorState.content;
    return editorState.content;
  }

  function saveContentMutation(label, mutator, audit) {
    const run = async () => {
      if (!window.SALSAVPantry) throw new Error("SALSAVPantry is unavailable.");
      const latest = await window.SALSAVPantry.getContent();
      const content = ensureContent(latest);
      await mutator(content);
      content.version = Number(content.version || 0) + 1;
      content.updatedAt = new Date().toISOString();
      await window.SALSAVPantry.saveContent(content);
      const verified = ensureContent(await window.SALSAVPantry.getContent());
      editorState.content = verified;
      window.SALSAV_CMS_CONTENT = verified;
      if (window.SALSAVCMS) window.SALSAVCMS.content = verified;
      applyCurrentContent();
      if (audit) await appendAudit(audit);
      if (label) toast(`${label} saved.`, "success");
      return verified;
    };
    editorState.saveQueue = editorState.saveQueue.then(run, run);
    return editorState.saveQueue;
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
    if (!window.SALSAVPantry || !event) return;
    return window.SALSAVPantry.appendAudit({
      at: new Date().toISOString(),
      source: "live-editor",
      pageId: editorState.pageId,
      ...event
    }).catch(() => {});
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

  function isCmsChrome(element) {
    return Boolean(element && element.closest(".salsav-cms-toolbar,.salsav-cms-overlay-layer,.salsav-cms-modal,.salsav-cms-toast-tray"));
  }

  function isVisible(element) {
    if (!element || element.hidden || element.closest("[hidden]")) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2 && getComputedStyle(element).visibility !== "hidden";
  }

  function isUsableTargetElement(element) {
    return Boolean(element && !isCmsChrome(element) && isVisible(element));
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
    return editorState.targets;
  }

  function findTargetForElement(element, preferredMode) {
    if (!element || isCmsChrome(element)) return null;
    const mode = preferredMode || editorState.mode;
    if (mode === "text") {
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
    if (!target) return "";
    if (target.type === "text") return target.cmsKey || "Text";
    if (target.type === "list") return target.listId || "List";
    return target.blockType === "newsArticle" ? "News article" : target.blockType === "teamMember" ? "Team member" : target.blockId || "Block";
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
        layer.append(reason("This block has no direct text key."));
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
  }

  function ensureToolbar() {
    if (document.querySelector(".salsav-cms-toolbar")) return;
    const toolbar = document.createElement("div");
    toolbar.className = "salsav-cms-toolbar";
    const addButton = editorState.pageId === "news"
      ? '<button type="button" class="salsav-cms-button" data-salsav-cms-action="add-article">+ Article</button>'
      : editorState.pageId === "team"
        ? '<button type="button" class="salsav-cms-button" data-salsav-cms-action="add-member">+ Team Member</button>'
        : "";
    toolbar.innerHTML = `
      <span class="salsav-cms-toolbar-title">SALSAV CMS</span>
      <span class="salsav-cms-page-chip">${escapeHtml(editorState.pageId)}</span>
      <div class="salsav-cms-mode-switcher">
        ${modes.map((mode) => `<button type="button" class="salsav-cms-button salsav-cms-mode-button${mode === editorState.mode ? " salsav-cms-button-active salsav-cms-mode-active" : ""}" data-mode="${mode}">${mode[0].toUpperCase()}${mode.slice(1)}</button>`).join("")}
      </div>
      ${addButton}
      <button type="button" class="salsav-cms-button" data-salsav-cms-action="refresh">Refresh</button>
      <button type="button" class="salsav-cms-button" data-salsav-cms-action="export">Export JSON</button>
      <button type="button" class="salsav-cms-button" data-salsav-cms-action="logout">Logout</button>`;
    document.body.appendChild(toolbar);
    toolbar.addEventListener("click", (event) => {
      const modeButton = event.target.closest("[data-mode]");
      if (modeButton) setMode(modeButton.dataset.mode);
      const action = event.target.closest("[data-salsav-cms-action]")?.dataset.salsavCmsAction;
      if (action === "refresh") refreshContent();
      if (action === "export") downloadJson("salsav-site-content.json", editorState.content || {});
      if (action === "logout") {
        sessionStorage.removeItem(config.sessionKey);
        window.location.reload();
      }
      if (action === "add-article") openArticleEditor();
      if (action === "add-member") openMemberEditor();
    });
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
      applyCurrentContent();
      toast("Pantry content refreshed.", "success");
    } catch (error) {
      toast(error.message || "Refresh failed.", "error");
    }
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
          <div><dt>Key</dt><dd class="salsav-cms-editor-key"></dd></div>
          <div><dt>Label</dt><dd class="salsav-cms-editor-label"></dd></div>
          <div><dt>Type</dt><dd class="salsav-cms-editor-type"></dd></div>
        </dl>
        <div class="salsav-cms-rich-editor-shell">
          <div class="salsav-cms-rich-editor"></div>
          <textarea class="salsav-cms-admin-textarea salsav-cms-attr-editor" hidden></textarea>
        </div>
        <div class="salsav-cms-editor-actions">
          <button type="button" class="salsav-cms-button salsav-cms-button-primary" data-save-rich>Save</button>
          <button type="button" class="salsav-cms-button" data-refresh-rich>Refresh from Pantry</button>
          <button type="button" class="salsav-cms-button" data-copy-key>Copy key</button>
          <button type="button" class="salsav-cms-button" data-close-rich>Cancel</button>
        </div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-rich]")) closeRichEditor();
      if (event.target.matches("[data-save-rich]")) saveActiveField();
      if (event.target.matches("[data-refresh-rich]")) refreshActiveField();
      if (event.target.matches("[data-copy-key]")) navigator.clipboard?.writeText(editorState.activeField?.key || "").catch(() => {});
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
    modal.querySelector(".salsav-cms-editor-key").textContent = info.key;
    modal.querySelector(".salsav-cms-editor-label").textContent = field.label || labelFromKey(info.key);
    modal.querySelector(".salsav-cms-editor-type").textContent = info.attr ? "attr" : (field.type || "text");
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
    editorState.isResizing = true;
    editorState.resize = {
      target,
      side: side || "corner",
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      parentWidth: Math.max(180, target.element.parentElement?.getBoundingClientRect().width || window.innerWidth)
    };
    document.addEventListener("pointermove", resizeMove);
    document.addEventListener("pointerup", commitResize, { once: true });
  }

  function resizeMove(event) {
    const resize = editorState.resize;
    if (!resize) return;
    const maxWidth = Math.max(180, Math.min(resize.parentWidth, window.innerWidth - 24));
    const maxHeight = Math.max(240, Math.round(window.innerHeight * 1.4));
    const width = Math.round(Math.max(180, Math.min(maxWidth, resize.width + event.clientX - resize.startX)));
    const height = Math.round(Math.max(120, Math.min(maxHeight, resize.height + event.clientY - resize.startY)));
    if (resize.side === "right" || resize.side === "corner") {
      resize.target.element.style.setProperty("--cms-block-width", `${width}px`);
      resize.target.element.style.width = `${width}px`;
    }
    if (resize.side === "bottom" || resize.side === "corner") {
      resize.target.element.style.setProperty("--cms-block-min-height", `${height}px`);
      resize.target.element.style.minHeight = `${height}px`;
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
      const width = resize.target.element.style.width || "";
      const minHeight = resize.target.element.style.minHeight || "";
      const image = resize.target.element.querySelector(".news-image-wrapper, .researcher-image-container, .pi-image, .content-image");
      const imageHeight = image ? image.style.height || "" : "";
      await saveLayoutPatch(resize.target.blockId, { width, minHeight, imageHeight }, {
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
    if (action === "edit-text") return openRichTextEditor(target);
    if (action === "edit-block") {
      if (target.blockType === "newsArticle") return openArticleEditor(target.blockId);
      if (target.blockType === "teamMember") return openMemberEditor(target.blockId);
      const nested = target.element.querySelector("[data-cms-key]");
      if (nested) return openRichTextEditor(findTargetForElement(nested, "text"));
      return toast("This generic block has no editable settings yet.", "info");
    }
    if (action === "add-article") return openArticleEditor();
    if (action === "add-member") return openMemberEditor();
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
          if (action === "archive-block") item.visible = false;
          if (action === "delete-block" && confirm("Permanently delete this article?")) list.splice(list.indexOf(item), 1);
          normalizeListOrder(list);
        } else if (target.blockType === "teamMember") {
          const list = content.collections.teamMembers;
          const item = list.find((member) => member.id === target.blockId);
          if (!item) return;
          if (action === "duplicate-block") list.push({ ...item, id: `${item.id}_copy_${Date.now()}`, name: `${item.name} (copy)`, order: Number(item.order || 0) + 1, updatedAt: new Date().toISOString() });
          if (action === "archive-block") item.visible = false;
          if (action === "delete-block" && confirm("Permanently delete this team member?")) list.splice(list.indexOf(item), 1);
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
      target.element.style.removeProperty("--cms-x");
      target.element.style.removeProperty("--cms-y");
      target.element.style.width = "";
      target.element.style.minHeight = "";
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

  function bindPageEvents() {
    document.addEventListener("mousemove", (event) => {
      if (!readSession() || editorState.isDragging || editorState.isResizing || editorState.mode === "preview" || isCmsChrome(event.target)) return;
      const target = getTargetFromPoint(event.clientX, event.clientY);
      const id = target ? target.id : null;
      if (id !== editorState.hoveredTargetId) {
        editorState.hoveredTargetId = id;
        scheduleOverlay();
      }
    }, true);

    document.addEventListener("click", (event) => {
      if (!readSession() || editorState.mode === "preview" || isCmsChrome(event.target)) return;
      const target = getTargetFromPoint(event.clientX, event.clientY);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectTarget(target.id);
      if (editorState.mode === "text") openRichTextEditor(target);
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
    editorState.content = ensureContent(window.SALSAV_CMS_CONTENT || null);
    document.documentElement.classList.add("salsav-cms-admin");
    ensureOverlayLayer();
    ensureToolbar();
    buildTargetRegistry();
    bindPageEvents();
    setMode("text");
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
    editorState.content = ensureContent(event.detail.content || editorState.content);
    document.querySelector(".salsav-cms-page-chip")?.replaceChildren(document.createTextNode(editorState.pageId));
    buildTargetRegistry();
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
