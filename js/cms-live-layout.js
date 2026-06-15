(function () {
  const fallbackImage = "static/salsa-logo.png";
  const newsCategories = new Set(["article", "paper", "video"]);
  const teamSectionDefaults = [
    { id: "principal_investigator", label: "Principal Investigator", description: "", layout: "pi", order: 10, allowMultiple: true, visible: true },
    { id: "key_contributors", label: "Key Contributors", description: "Meet the dedicated researchers, students, and collaborators driving the SALSA initiatives at the University of Arizona and our partner institutions.", layout: "grid", order: 20, allowMultiple: true, visible: true },
    { id: "alumni", label: "SALSA Alumni", description: "We're proud of our former team members who continue to make an impact in their fields.", layout: "grid", order: 30, allowMultiple: true, visible: true },
    { id: "team_summary", label: "Team Summary", description: "", layout: "table", order: 40, allowMultiple: true, visible: true }
  ];

  function extractCurrentPageId() {
    return window.SALSAV_CMS_PAGE_ID || (window.SALSAVCMSCore && window.SALSAVCMSCore.inferPageId()) || "";
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

  function richText(value) {
    const text = String(value == null ? "" : value);
    if (!/<\/?[a-z][\s>/]/i.test(text)) return escapeHtml(text);
    if (window.SALSAVCMSCore && typeof window.SALSAVCMSCore.sanitizeHtml === "function") {
      return window.SALSAVCMSCore.sanitizeHtml(text);
    }
    return escapeHtml(text);
  }

  function safeUrl(value, fallback) {
    const url = String(value || "").trim();
    if (!url) return fallback || "#";
    if (url.startsWith("#") || url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return url;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return url;
    } catch (error) {
      return fallback || "#";
    }
    return fallback || "#";
  }

  function normalizeOrder(items) {
    return (items || []).slice().sort((a, b) => {
      if (Number.isFinite(Number(a.order)) || Number.isFinite(Number(b.order))) return Number(a.order || 9999) - Number(b.order || 9999);
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
  }

  function normalizeCollections(content) {
    const next = content || {};
    next.collections = next.collections || {};
    next.collections.newsArticles = Array.isArray(next.collections.newsArticles) ? next.collections.newsArticles : [];
    next.collections.teamSections = Array.isArray(next.collections.teamSections) && next.collections.teamSections.length ? next.collections.teamSections : teamSectionDefaults.slice();
    next.collections.teamMembers = Array.isArray(next.collections.teamMembers) ? next.collections.teamMembers : [];
    next.collections.teamSummaryRows = Array.isArray(next.collections.teamSummaryRows) ? next.collections.teamSummaryRows : [];
    next.collections.genericBlocks = next.collections.genericBlocks && typeof next.collections.genericBlocks === "object" ? next.collections.genericBlocks : {};
    next.layout = next.layout || {};
    next.layout.pages = next.layout.pages || {};
    return next;
  }

  function activeNewsFilter() {
    const active = document.querySelector(".filter-btn.active");
    return active ? active.getAttribute("data-filter") || "all" : "all";
  }

  function applyNewsFilter(filter) {
    const selected = filter || activeNewsFilter();
    document.querySelectorAll(".filter-btn").forEach((button) => {
      button.classList.toggle("active", (button.getAttribute("data-filter") || "all") === selected);
    });
    document.querySelectorAll("#news-grid-container .news-card").forEach((card) => {
      card.style.display = selected === "all" || card.getAttribute("data-category") === selected ? "flex" : "none";
    });
  }

  function bindNewsFilters() {
    document.querySelectorAll(".filter-btn").forEach((button) => {
      if (button.dataset.salsavLiveFilterBound) return;
      button.dataset.salsavLiveFilterBound = "true";
      button.addEventListener("click", () => applyNewsFilter(button.getAttribute("data-filter") || "all"));
    });
  }

  function renderNewsArticles(content) {
    const normalized = normalizeCollections(content);
    const grid = document.getElementById("news-grid-container");
    if (!grid) return false;
    const articles = normalizeOrder(normalized.collections.newsArticles.filter((item) => item && item.visible !== false && newsCategories.has(item.category)));
    if (!articles.length) {
      bindNewsFilters();
      return false;
    }
    const selectedFilter = activeNewsFilter();
    grid.setAttribute("data-cms-list", "news.articles");
    grid.setAttribute("data-cms-list-type", "newsArticles");
    grid.setAttribute("data-cms-canvas", "news.articles");
    grid.setAttribute("data-cms-grid", "12");
    grid.innerHTML = articles.map((article) => {
      const href = safeUrl(article.url, "#");
      const target = article.openInNewTab === false ? "" : ' target="_blank" rel="noopener noreferrer"';
      const image = safeUrl(article.imageSrc, fallbackImage);
      return `
        <a href="${escapeHtml(href)}"${target} class="news-card" data-category="${escapeHtml(article.category)}" data-cms-block-id="${escapeHtml(article.id)}" data-cms-block-type="newsArticle" data-cms-parent-canvas="news.articles" data-cms-link-field="url">
          <div class="news-image-wrapper">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(article.imageAlt || `Preview of ${article.title || "SALSAV news"}`)}" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImage}';" data-cms-image-field="imageSrc" data-cms-image-alt-field="imageAlt">
          </div>
          <div class="news-card-content">
            <span class="tag" data-cms-collection-field="category" data-cms-field-label="Category">${escapeHtml(article.category)}</span>
            <h3 data-cms-collection-field="title" data-cms-field-label="Headline">${richText(article.title)}</h3>
            <div class="news-card-meta">
              <span data-cms-collection-field="source" data-cms-field-label="Source">${escapeHtml(article.source)}</span>
              <span data-cms-collection-field="displayDate" data-cms-field-label="Date">${escapeHtml(article.displayDate || article.date)}</span>
            </div>
            <p data-cms-collection-field="description" data-cms-field-label="Summary">${richText(article.description)}</p>
          </div>
        </a>`;
    }).join("");
    bindNewsFilters();
    applyNewsFilter(selectedFilter);
    applyLayout(normalized);
    window.dispatchEvent(new CustomEvent("salsav:collections-rendered", { detail: { collection: "newsArticles" } }));
    return true;
  }

  function memberCard(member, isPi) {
    const href = safeUrl(member.profileUrl, "#");
    const target = member.openInNewTab === false ? "" : ' target="_blank" rel="noopener noreferrer"';
    const image = safeUrl(member.imageSrc, fallbackImage);
    if (isPi) {
      return `
        <a href="${escapeHtml(href)}"${target} class="pi-profile" data-cms-block-id="${escapeHtml(member.id)}" data-cms-block-type="teamMember" data-cms-parent-canvas="team.principal_investigator" data-cms-link-field="profileUrl">
          <div class="pi-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(member.imageAlt || `Photo of ${member.name}`)}" onerror="this.onerror=null;this.src='${fallbackImage}';" data-cms-image-field="imageSrc" data-cms-image-alt-field="imageAlt"></div>
          <div class="pi-details">
            <h3 data-cms-collection-field="name" data-cms-field-label="Name">${richText(member.name)}</h3>
            <p class="pi-title" data-cms-collection-field="title" data-cms-field-label="Role">${richText(member.title)}</p>
            <p data-cms-collection-field="description" data-cms-field-label="Bio">${richText(member.description)}</p>
          </div>
        </a>`;
    }
    return `
      <a href="${escapeHtml(href)}"${target} class="researcher-card" data-cms-block-id="${escapeHtml(member.id)}" data-cms-block-type="teamMember" data-cms-parent-canvas="team.${escapeHtml(member.sectionId || "key_contributors")}" data-cms-link-field="profileUrl">
        <div class="researcher-image-container"><img src="${escapeHtml(image)}" alt="${escapeHtml(member.imageAlt || `Photo of ${member.name}`)}" onerror="this.onerror=null;this.src='${fallbackImage}';" data-cms-image-field="imageSrc" data-cms-image-alt-field="imageAlt"></div>
        <h4 data-cms-collection-field="name" data-cms-field-label="Name">${richText(member.name)}</h4>
        <p class="researcher-title" data-cms-collection-field="title" data-cms-field-label="Role">${richText(member.title)}</p>
        <p class="researcher-description" data-cms-collection-field="description" data-cms-field-label="Bio">${richText(member.description)}</p>
      </a>`;
  }

  function renderTeamMembers(content) {
    const normalized = normalizeCollections(content);
    const members = normalizeOrder(normalized.collections.teamMembers.filter((member) => member && member.visible !== false));
    if (!members.length) return false;
    const piProfiles = Array.from(document.querySelectorAll(".pi-profile"));
    const piProfile = piProfiles[0];
    const grids = document.querySelectorAll(".team-grid");
    const tableBody = document.querySelector(".project-table tbody");
    const piMembers = normalizeOrder(members.filter((member) => member.sectionId === "principal_investigator"));
    const keyMembers = normalizeOrder(members.filter((member) => member.sectionId === "key_contributors"));
    const alumniMembers = normalizeOrder(members.filter((member) => member.sectionId === "alumni"));

    if (piProfile && piMembers.length) {
      piProfiles.slice(1).forEach((profile) => profile.remove());
      const wrapper = document.createElement("div");
      wrapper.innerHTML = piMembers.map((member) => memberCard(member, true)).join("");
      piProfile.replaceWith(...Array.from(wrapper.children));
    }
    if (grids[0]) {
      grids[0].setAttribute("data-cms-list", "team.key_contributors");
      grids[0].setAttribute("data-cms-list-type", "teamMembers");
      grids[0].setAttribute("data-cms-canvas", "team.key_contributors");
      grids[0].setAttribute("data-cms-grid", "12");
      grids[0].innerHTML = keyMembers.map((member) => memberCard(member, false)).join("");
    }
    if (grids[1]) {
      grids[1].setAttribute("data-cms-list", "team.alumni");
      grids[1].setAttribute("data-cms-list-type", "teamMembers");
      grids[1].setAttribute("data-cms-canvas", "team.alumni");
      grids[1].setAttribute("data-cms-grid", "12");
      grids[1].innerHTML = alumniMembers.map((member) => memberCard(member, false)).join("");
    }
    if (tableBody) {
      const manualRows = normalizeOrder(normalized.collections.teamSummaryRows.filter((row) => row && row.visible !== false));
      const memberRows = normalizeOrder(members.filter((member) => member.includeInSummary));
      const rows = [
        ...memberRows.map((member) => ({ id: member.id, name: member.name, affiliation: member.affiliation, expertise: member.expertise || member.title, order: member.order })),
        ...manualRows
      ];
      tableBody.innerHTML = normalizeOrder(rows).map((row) => `
        <tr data-cms-block-id="${escapeHtml(row.id)}" data-cms-block-type="teamSummaryRow" data-cms-parent-canvas="team.summary">
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.affiliation)}</td>
          <td>${escapeHtml(row.expertise)}</td>
        </tr>`).join("");
    }
    applyLayout(normalized);
    window.dispatchEvent(new CustomEvent("salsav:collections-rendered", { detail: { collection: "teamMembers" } }));
    return true;
  }

  function applyGenericBlocks(content) {
    const normalized = normalizeCollections(content);
    const pageId = extractCurrentPageId();
    document.querySelectorAll("[data-cms-list]").forEach((list) => {
      const listId = list.getAttribute("data-cms-list");
      const model = normalized.collections.genericBlocks[`${pageId}.${listId}`] || normalized.collections.genericBlocks[listId];
      if (!Array.isArray(model) || !model.length) return;
      const children = Array.from(list.querySelectorAll(":scope > [data-cms-block-id]"));
      const byId = new Map(children.map((child) => [child.getAttribute("data-cms-block-id"), child]));
      normalizeOrder(model).forEach((item) => {
        const child = byId.get(item.id);
        if (!child) return;
        child.hidden = item.visible === false;
        list.appendChild(child);
      });
    });
  }

  function applyLayout(content) {
    const normalized = normalizeCollections(content);
    const pageId = extractCurrentPageId();
    const pageLayout = normalized.layout.pages[pageId] || {};
    const blocks = pageLayout.blocks || {};
    const canvases = pageLayout.canvases || {};
    let hasLayout = false;
    document.querySelectorAll("[data-cms-canvas]").forEach((canvas) => {
      const canvasId = canvas.getAttribute("data-cms-canvas");
      const override = canvases[canvasId] || {};
      const columns = Number(override.gridColumns || canvas.getAttribute("data-cms-grid") || 12);
      const rowHeight = Number(override.rowHeight || 24);
      canvas.style.setProperty("--cms-grid-columns", String(Number.isFinite(columns) ? Math.max(1, Math.min(12, columns)) : 12));
      canvas.style.setProperty("--cms-row-height", `${Number.isFinite(rowHeight) ? Math.max(8, rowHeight) : 24}px`);
      canvas.style.setProperty("--cms-canvas-gap", override.gap || "");
    });
    document.querySelectorAll("[data-cms-block-id]").forEach((block) => {
      const override = blocks[block.getAttribute("data-cms-block-id")];
      if (!override) return;
      hasLayout = true;
      if (override.canvasId && !block.getAttribute("data-cms-parent-canvas")) block.setAttribute("data-cms-parent-canvas", override.canvasId);
      if (override.gridColumn !== null && override.gridColumn !== "" && Number.isFinite(Number(override.gridColumn))) block.style.setProperty("--cms-grid-column", String(Math.max(1, Number(override.gridColumn))));
      if (override.gridRow !== null && override.gridRow !== "" && Number.isFinite(Number(override.gridRow))) block.style.setProperty("--cms-grid-row", String(Math.max(1, Number(override.gridRow))));
      if (override.colSpan !== null && override.colSpan !== "" && Number.isFinite(Number(override.colSpan))) block.style.setProperty("--cms-col-span", String(Math.max(1, Number(override.colSpan))));
      if (override.rowSpan !== null && override.rowSpan !== "" && Number.isFinite(Number(override.rowSpan))) block.style.setProperty("--cms-row-span", String(Math.max(1, Number(override.rowSpan))));
      if (Number.isFinite(Number(override.x))) block.style.setProperty("--cms-x", `${Number(override.x)}px`);
      if (Number.isFinite(Number(override.y))) block.style.setProperty("--cms-y", `${Number(override.y)}px`);
      if (override.flexBasis) {
        block.style.flexBasis = override.flexBasis;
        block.style.maxWidth = override.flexBasis;
      }
      if (override.colSpan !== null && override.colSpan !== "" && Number.isFinite(Number(override.colSpan))) {
        const parent = block.parentElement;
        const columns = Math.max(1, Math.min(12, Number(parent?.getAttribute("data-cms-grid") || 12) || 12));
        if (parent && getComputedStyle(parent).display.includes("grid")) {
          parent.classList.add("salsav-cms-managed-grid");
          parent.style.setProperty("--cms-grid-columns", String(columns));
        }
        block.style.gridColumn = `span ${Math.max(1, Math.min(columns, Number(override.colSpan)))}`;
      }
      if (override.rowSpan !== null && override.rowSpan !== "" && Number.isFinite(Number(override.rowSpan))) {
        block.style.gridRow = `span ${Math.max(1, Number(override.rowSpan))}`;
      }
      if (override.width && !(override.colSpan !== null && override.colSpan !== "" && Number.isFinite(Number(override.colSpan)))) {
        block.style.setProperty("--cms-block-width", override.width);
        block.style.width = override.width;
      }
      if (override.minHeight) {
        block.style.setProperty("--cms-block-min-height", override.minHeight);
        block.style.minHeight = override.minHeight;
      }
      if (override.imageHeight) {
        block.style.setProperty("--cms-image-height", override.imageHeight);
        block.querySelector(".news-image-wrapper, .researcher-image-container, .pi-image, .content-image")?.style.setProperty("height", override.imageHeight);
      }
      block.style.transform = "translate(var(--cms-x, 0px), var(--cms-y, 0px))";
    });
    document.documentElement.classList.toggle("salsav-cms-has-layout", hasLayout);
  }

  function renderCurrentPageCollections(content) {
    if (!content) return false;
    const pageId = extractCurrentPageId();
    let rendered = false;
    if (pageId === "news") rendered = renderNewsArticles(content);
    if (pageId === "team") rendered = renderTeamMembers(content);
    applyGenericBlocks(content);
    applyLayout(content);
    window.dispatchEvent(new CustomEvent("salsav:live-layout-applied", { detail: { pageId, content } }));
    return rendered;
  }

  window.SALSAVLiveLayout = {
    renderCurrentPageCollections,
    renderNewsArticles,
    renderTeamMembers,
    normalizeCollections,
    extractCurrentPageId,
    safeUrl,
    escapeHtml,
    applyNewsFilter,
    bindNewsFilters,
    applyGenericBlocks,
    applyLayout,
    teamSectionDefaults,
    fallbackImage
  };

  window.SALSAVCollections = window.SALSAVLiveLayout;

  window.addEventListener("salsav:cms-hydrated", (event) => {
    renderCurrentPageCollections(event.detail.content);
  });

  if (window.SALSAV_CMS_CONTENT) renderCurrentPageCollections(window.SALSAV_CMS_CONTENT);
})();
