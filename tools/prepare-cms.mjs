import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicPages = [
  "index.html",
  "education.html",
  "education-global-school.html",
  "education-interdisciplinary.html",
  "news.html",
  "research-ecophysiology.html",
  "research-scaling-out.html",
  "research-scaling-up.html",
  "sites.html",
  "team.html"
];

const editableAttrs = ["alt", "title", "aria-label", "placeholder"];
const cmsScripts = [
  "js/cms-config.js",
  "js/cms-pantry.js",
  "js/cms-core.js",
  "js/cms-live-layout.js",
  "js/cms-editor.js"
];
const legacyCmsScripts = ["js/cms-collections.js"];

const existingSeedPath = path.join(root, "cms", "seed-content.json");
const existingSeed = fs.existsSync(existingSeedPath)
  ? JSON.parse(fs.readFileSync(existingSeedPath, "utf8"))
  : {};

const seed = {
  ...existingSeed,
  version: Number(existingSeed.version || 1),
  updatedAt: null,
  pages: {
    global: {
      path: "*",
      title: "Global",
      fields: {}
    }
  },
  collections: {
    newsArticles: [],
    teamSections: [],
    teamMembers: [],
    teamSummaryRows: [],
    genericBlocks: {},
    ...(existingSeed.collections || {})
  },
  layout: {
    pages: {},
    ...(existingSeed.layout || {})
  }
};

const teamSectionDefaults = [
  {
    id: "principal_investigator",
    label: "Principal Investigator",
    description: "",
    layout: "pi",
    order: 10,
    allowMultiple: true,
    visible: true
  },
  {
    id: "key_contributors",
    label: "Key Contributors",
    description: "Meet the dedicated researchers, students, and collaborators driving the SALSA initiatives at the University of Arizona and our partner institutions.",
    layout: "grid",
    order: 20,
    allowMultiple: true,
    visible: true
  },
  {
    id: "alumni",
    label: "SALSA Alumni",
    description: "We're proud of our former team members who continue to make an impact in their fields.",
    layout: "grid",
    order: 30,
    allowMultiple: true,
    visible: true
  },
  {
    id: "team_summary",
    label: "Team Summary",
    description: "",
    layout: "table",
    order: 40,
    allowMultiple: true,
    visible: true
  }
];

function pageIdFor(file) {
  return file.replace(/\.html?$/i, "");
}

function titleForPage(pageId) {
  if (pageId === "index") return "Home";
  return pageId.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttr(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function attrValue(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decodeEntities(match[2]) : "";
}

function htmlAttr(tagHtml, name) {
  const match = String(tagHtml || "").match(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decodeEntities(match[2]) : "";
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "item";
}

function normalizeDate(displayDate) {
  const parsed = Date.parse(displayDate);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  const year = String(displayDate || "").match(/\b(20\d{2}|19\d{2})\b/);
  return year ? `${year[1]}-01-01` : "";
}

function mergeById(extracted, existing) {
  const existingMap = new Map((existing || []).map((item) => [item.id, item]));
  const seen = new Set();
  const merged = extracted.map((item) => {
    seen.add(item.id);
    const previous = existingMap.get(item.id) || {};
    return {
      ...previous,
      ...item,
      visible: Object.prototype.hasOwnProperty.call(previous, "visible") ? previous.visible : item.visible,
      order: Object.prototype.hasOwnProperty.call(previous, "order") ? previous.order : item.order,
      updatedAt: previous.updatedAt || item.updatedAt || null
    };
  });
  for (const item of existing || []) {
    if (!seen.has(item.id)) merged.push(item);
  }
  return merged;
}

function normalizeCollectionOrder(items, sectionKey) {
  const groups = new Map();
  for (const item of items) {
    const group = sectionKey ? item[sectionKey] || "" : "__all";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  for (const groupItems of groups.values()) {
    groupItems
      .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999))
      .forEach((item, index) => {
        item.order = (index + 1) * 10;
      });
  }
  return items;
}

function hasMeaningfulText(inner) {
  return stripTags(inner).length > 1;
}

function isIconOnly(inner) {
  const text = stripTags(inner);
  return !text || /^[^\w]+$/.test(text);
}

function hasCmsAttr(attrs, attrName) {
  return new RegExp(`\\s${escapeRegExp(attrName)}\\s*=`, "i").test(attrs);
}

function setAttr(attrs, name, value) {
  if (hasCmsAttr(attrs, name)) return attrs;
  return `${attrs} ${name}="${escapeAttr(value)}"`;
}

function removeCmsAssets(html) {
  html = html.replace(/<link\b[^>]*href=["']css\/cms-editor\.css["'][^>]*>\s*/gi, "");
  for (const src of [...cmsScripts, ...legacyCmsScripts]) {
    html = html.replace(new RegExp(`<script\\b[^>]*src=["']${escapeRegExp(src)}["'][^>]*>\\s*<\\/script>\\s*`, "gi"), "");
  }
  return html;
}

function ensureCmsAssets(html) {
  html = removeCmsAssets(html);
  const stylesheet = '    <link rel="stylesheet" href="css/cms-editor.css">\n';
  html = html.replace(/<\/head>/i, `${stylesheet}</head>`);
  const scripts = cmsScripts.map((src) => `    <script defer src="${src}"></script>`).join("\n");
  html = html.replace(/<\/body>/i, `${scripts}\n</body>`);
  return html;
}

function stripCmsAnnotations(html) {
  return html
    .replace(/\sdata-cms-key\s*=\s*(["']).*?\1/gi, "")
    .replace(/\sdata-cms-attr-(alt|title|aria-label|placeholder|content)\s*=\s*(["']).*?\2/gi, "")
    .replace(/\sdata-cms-list\s*=\s*(["']).*?\1/gi, "")
    .replace(/\sdata-cms-list-type\s*=\s*(["']).*?\1/gi, "")
    .replace(/\sdata-cms-block-id\s*=\s*(["']).*?\1/gi, "")
    .replace(/\sdata-cms-block-type\s*=\s*(["']).*?\1/gi, "");
}

function ensureBodyPage(html, pageId) {
  return html.replace(/<body\b([^>]*)>/i, (match, attrs) => {
    if (/\sdata-cms-page\s*=/i.test(attrs)) {
      return match.replace(/\sdata-cms-page\s*=\s*["'][^"']*["']/i, ` data-cms-page="${pageId}"`);
    }
    return `<body${attrs} data-cms-page="${pageId}">`;
  });
}

function isInsideFooter(before) {
  return before.toLowerCase().lastIndexOf("<footer") > before.toLowerCase().lastIndexOf("</footer");
}

function isInsideNav(before) {
  return before.toLowerCase().lastIndexOf("<nav") > before.toLowerCase().lastIndexOf("</nav");
}

function isInsideParagraph(before) {
  return before.toLowerCase().lastIndexOf("<p") > before.toLowerCase().lastIndexOf("</p");
}

function protectBlocks(html) {
  const blocks = [];
  const protectedHtml = html.replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, (match) => {
    const token = `___SALSAV_CMS_BLOCK_${blocks.length}___`;
    blocks.push(match);
    return token;
  });
  return { protectedHtml, blocks };
}

function restoreBlocks(html, blocks) {
  return html.replace(/___SALSAV_CMS_BLOCK_(\d+)___/g, (_, index) => blocks[Number(index)]);
}

function detectBucket(before, tag, attrs) {
  const context = before.slice(-5000).toLowerCase();
  const attrText = attrs.toLowerCase();
  if (/hero-headline|hero-subheadline|hero|hero-subpage/.test(attrText + context)) return "hero";
  if (/challenge/.test(attrText + context)) return "challenge";
  if (/what-if|what_if/.test(attrText + context)) return "what_if";
  if (/proof/.test(attrText + context)) return "proof";
  if (/pillar/.test(attrText + context)) return "pillars";
  if (/carousel|slide/.test(attrText + context)) return "carousel";
  if (/school|education/.test(attrText + context)) return "education";
  if (/site|learning-lab|learning_lab|labs/.test(attrText + context)) return "sites";
  if (/team|member|profile/.test(attrText + context)) return "team";
  if (/news|article|publication/.test(attrText + context)) return "news";
  if (/footer/.test(attrText + context)) return "footer";
  if (/research|ecophysiology|scaling/.test(attrText + context)) return "research";
  if (tag === "title" || /meta/.test(tag)) return "meta";
  return "content";
}

function purposeFor(tag, attrs) {
  const attrText = attrs.toLowerCase();
  if (/cta|button/.test(attrText) || tag === "button") return "cta";
  if (/subtitle/.test(attrText)) return "subheadline";
  if (/tag/.test(attrText)) return "tag";
  if (/quote/.test(attrText) || tag === "blockquote") return "quote";
  if (/stat-number/.test(attrText)) return "stat";
  if (/stat-label/.test(attrText)) return "label";
  if (/description|desc|bio/.test(attrText)) return "description";
  if (/title|name/.test(attrText)) return "title";
  if (/^h[1-6]$/.test(tag)) return tag === "h1" ? "headline" : "heading";
  if (tag === "li") return "item";
  if (tag === "a") return "link";
  if (tag === "label") return "label";
  if (tag === "span") return "label";
  return "text";
}

function navKey(text, href) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (normalized === "research") return "global.nav.research";
  const byHref = {
    "index.html": "global.nav.home",
    "research-ecophysiology.html": "global.nav.research.ecophysiology",
    "research-scaling-up.html": "global.nav.research.scaling_up",
    "research-scaling-out.html": "global.nav.research.scaling_out",
    "education.html": normalized === "education" ? "global.nav.education" : "global.nav.education.school_gardens",
    "education-global-school.html": "global.nav.education.global_school",
    "education-interdisciplinary.html": "global.nav.education.interdisciplinary",
    "sites.html": "global.nav.learning_labs",
    "news.html": "global.nav.news",
    "team.html": "global.nav.team",
    "#footer": "global.nav.contact",
    "#": "global.nav.research"
  };
  return byHref[href] || `global.nav.${normalized || "link"}`;
}

function footerKey(text, tag) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (/salsa agrivoltaics/i.test(text) && tag === "h3") return "global.footer.brand.title";
  if (/pioneering food-energy-water/i.test(text)) return "global.footer.brand.description";
  if (/quick links/i.test(text)) return "global.footer.quick_links.heading";
  if (/contact us/i.test(text)) return "global.footer.contact.heading";
  if (/university of arizona/i.test(text)) return "global.footer.contact.organization";
  if (/gregbg@arizona\.edu/i.test(text)) return "global.footer.contact.email";
  if (/rights reserved/i.test(text)) return "global.footer.copyright";
  return `global.footer.${normalized || tag}`;
}

function annotateKnownGlobals(html, pageId) {
  html = html.replace(/(<a\b[^>]*class\s*=\s*["'][^"']*\bnavbar-brand\b[^"']*["'][^>]*>[\s\S]*?<span\b)([^>]*)(>)([\s\S]*?)(<\/span>[\s\S]*?<\/a>)/gi, (match, prefix, attrs, close, inner, suffix) => {
    const key = "nav.brand";
    addField(pageId, key, {
      type: /<[^>]+>/.test(inner) ? "html" : "text",
      label: fieldLabel(key),
      value: /<[^>]+>/.test(inner) ? inner.trim() : stripTags(inner),
      selectorHint: `[data-cms-key="${key}"]`,
      updatedAt: null
    });
    return `${prefix}${setAttr(attrs, "data-cms-key", key)}${close}${inner}${suffix}`;
  });

  html = html.replace(/<a\b([^>]*class\s*=\s*["'][^"']*\bnavbar-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) => {
    if (!hasMeaningfulText(inner)) return match;
    const hrefMatch = attrs.match(/\shref\s*=\s*["']([^"']+)["']/i);
    const key = navKey(stripTags(inner), hrefMatch ? hrefMatch[1] : "");
    addField(pageId, key, {
      type: /<[^>]+>/.test(inner) ? "html" : "text",
      label: fieldLabel(key),
      value: /<[^>]+>/.test(inner) ? inner.trim() : stripTags(inner),
      selectorHint: `[data-cms-key="${key}"]`,
      updatedAt: null
    });
    return `<a${setAttr(attrs, "data-cms-key", key)}>${inner}</a>`;
  });

  return html;
}

function annotateSimpleAnchors(html, pageId) {
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner, offset) => {
    if (hasCmsAttr(attrs, "data-cms-key")) return match;
    if (!hasMeaningfulText(inner) || isIconOnly(inner)) return match;
    if (/<(div|section|article|figure|img|h[1-6]|p|blockquote|ul|ol|li)\b/i.test(inner)) return match;
    const before = html.slice(0, offset);
    if (isInsideParagraph(before)) return match;
    const hrefMatch = attrs.match(/\shref\s*=\s*["']([^"']+)["']/i);
    let key;
    if (isInsideNav(before) || /navbar-link/i.test(attrs)) {
      key = navKey(stripTags(inner), hrefMatch ? hrefMatch[1] : "");
    } else if (isInsideFooter(before) || /footer/.test(attrs)) {
      key = footerKey(stripTags(inner), "a");
    } else {
      const bucket = detectBucket(before, "a", attrs);
      annotateSimpleAnchors.counters[`${pageId}:${bucket}.link`] = (annotateSimpleAnchors.counters[`${pageId}:${bucket}.link`] || 0) + 1;
      key = `${bucket}.link_${annotateSimpleAnchors.counters[`${pageId}:${bucket}.link`]}`;
    }
    const type = /<[^>]+>/.test(inner) ? "html" : "text";
    addField(pageId, key, {
      type,
      label: fieldLabel(key),
      value: type === "html" ? inner.trim() : stripTags(inner),
      selectorHint: `[data-cms-key="${key}"]`,
      updatedAt: null
    });
    return `<a${setAttr(attrs, "data-cms-key", key)}>${inner}</a>`;
  });
}
annotateSimpleAnchors.counters = {};

function addField(pageId, key, field) {
  const targetPage = key.startsWith("global.") ? seed.pages.global : seed.pages[pageId];
  if (!targetPage.fields[key]) targetPage.fields[key] = field;
}

function fieldLabel(key) {
  return key.split(".").map((part) => part.replace(/_/g, " ")).join(" / ");
}

function makeKeyFactory(pageId) {
  const counters = new Map();
  const carouselDuplicates = new Map();
  return function makeKey(before, tag, attrs, inner) {
    const text = stripTags(inner);
    const hrefMatch = attrs.match(/\shref\s*=\s*["']([^"']+)["']/i);
    if (/navbar-link/i.test(attrs) && tag === "a") return navKey(text, hrefMatch ? hrefMatch[1] : "");
    if (isInsideFooter(before) || /footer/.test(attrs)) return footerKey(text, tag);

    const bucket = detectBucket(before, tag, attrs);
    const purpose = purposeFor(tag, attrs);
    if (bucket === "carousel") {
      const signature = `${tag}:${text.toLowerCase()}`;
      if (carouselDuplicates.has(signature)) return carouselDuplicates.get(signature);
      const count = (counters.get(`${bucket}.${purpose}`) || 0) + 1;
      counters.set(`${bucket}.${purpose}`, count);
      const key = `${bucket}.${purpose}_${count}`;
      carouselDuplicates.set(signature, key);
      return key;
    }
    const count = (counters.get(`${bucket}.${purpose}`) || 0) + 1;
    counters.set(`${bucket}.${purpose}`, count);
    if (bucket === "hero" && purpose === "headline" && count === 1) return "hero.headline";
    if (bucket === "hero" && purpose === "subheadline" && count === 1) return "hero.subheadline";
    return `${bucket}.${purpose}_${count}`;
  };
}

function annotateTitle(html, pageId) {
  return html.replace(/<title\b([^>]*)>([\s\S]*?)<\/title>/i, (match, attrs, inner) => {
    const key = "meta.title";
    addField(pageId, key, {
      type: "text",
      label: "Page title",
      value: stripTags(inner),
      selectorHint: `title[data-cms-key="${key}"]`,
      updatedAt: null
    });
    return `<title${setAttr(attrs, "data-cms-key", key)}>${inner}</title>`;
  });
}

function annotateMetaDescription(html, pageId) {
  return html.replace(/<meta\b([^>]*\bname\s*=\s*["']description["'][^>]*)>/i, (match, attrs) => {
    const contentMatch = attrs.match(/\bcontent\s*=\s*(["'])(.*?)\1/i);
    if (!contentMatch) return match;
    const key = "meta.description";
    addField(pageId, key, {
      type: "attr",
      attr: "content",
      label: "Meta description",
      value: decodeEntities(contentMatch[2]),
      selectorHint: `meta[data-cms-attr-content="${key}"]`,
      updatedAt: null
    });
    return `<meta${setAttr(attrs, "data-cms-attr-content", key)}>`;
  });
}

function annotateAttrs(html, pageId) {
  return html.replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (match, tag, attrs, offset) => {
    let nextAttrs = attrs;
    const before = html.slice(0, offset);
    if (/^(script|style|svg|path|use|source)$/i.test(tag)) return match;
    for (const attr of editableAttrs) {
      if (!new RegExp(`\\s${escapeRegExp(attr)}\\s*=`, "i").test(nextAttrs)) continue;
      if (hasCmsAttr(nextAttrs, `data-cms-attr-${attr}`)) continue;
      const valueMatch = nextAttrs.match(new RegExp(`\\s${escapeRegExp(attr)}\\s*=\\s*(["'])(.*?)\\1`, "i"));
      if (!valueMatch || !decodeEntities(valueMatch[2]).trim()) continue;
      let key;
      if (/navbar-brand/i.test(nextAttrs) && attr === "alt") key = "global.logo.alt";
      else if (/mobile-toggle/i.test(nextAttrs) && attr === "aria-label") key = "global.nav.toggle_aria";
      else {
        const bucket = detectBucket(before, tag, nextAttrs);
        const normalizedAttr = attr.replace(/-/g, "_");
        const countKey = `${pageId}:${bucket}.${tag}.${normalizedAttr}`;
        annotateAttrs.counters[countKey] = (annotateAttrs.counters[countKey] || 0) + 1;
        key = `${bucket}.${tag}_${annotateAttrs.counters[countKey]}.${normalizedAttr}`;
      }
      addField(pageId, key, {
        type: "attr",
        attr,
        label: fieldLabel(key),
        value: decodeEntities(valueMatch[2]),
        selectorHint: `[data-cms-attr-${attr}="${key}"]`,
        updatedAt: null
      });
      nextAttrs = setAttr(nextAttrs, `data-cms-attr-${attr}`, key);
    }
    return `<${tag}${nextAttrs}>`;
  });
}
annotateAttrs.counters = {};

function annotateVisibleText(html, pageId) {
  const makeKey = makeKeyFactory(pageId);
  const tagPattern = /<(h[1-6]|p|blockquote|button|label|li|span)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  return html.replace(tagPattern, (match, tag, attrs, inner, offset) => {
    if (hasCmsAttr(attrs, "data-cms-key")) return match;
    if (!hasMeaningfulText(inner) || isIconOnly(inner)) return match;
    if (/sr-only|visually-hidden|screen-reader/i.test(attrs)) return match;
    if (tag.toLowerCase() === "li" && /navbar-menu|dropdown-content|footer-links/i.test(match)) return match;
    if (tag.toLowerCase() === "li" && /<a\b/i.test(inner)) return match;
    if (tag.toLowerCase() === "span" && !/(navbar-brand|subtitle|tag|label|title|name|stat|badge)/i.test(attrs + html.slice(Math.max(0, offset - 300), offset))) return match;

    const before = html.slice(0, offset);
    const key = makeKey(before, tag.toLowerCase(), attrs, inner);
    const type = /<[^>]+>/.test(inner) ? "html" : "text";
    addField(pageId, key, {
      type,
      label: fieldLabel(key),
      value: type === "html" ? inner.trim() : stripTags(inner),
      selectorHint: `[data-cms-key="${key}"]`,
      updatedAt: null
    });
    return `<${tag}${setAttr(attrs, "data-cms-key", key)}>${inner}</${tag}>`;
  });
}

function extractExistingFields(html, pageId) {
  html.replace(/<([a-z][a-z0-9-]*)\b([^>]*\sdata-cms-key\s*=\s*(["'])(.*?)\3[^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, quote, key, inner) => {
    addField(pageId, key, {
      type: /<[^>]+>/.test(inner) ? "html" : "text",
      label: fieldLabel(key),
      value: /<[^>]+>/.test(inner) ? inner.trim() : stripTags(inner),
      selectorHint: `[data-cms-key="${key}"]`,
      updatedAt: null
    });
    return match;
  });

  for (const attr of [...editableAttrs, "content"]) {
    const pattern = new RegExp(`<([a-z][a-z0-9-]*)\\b([^>]*\\sdata-cms-attr-${escapeRegExp(attr)}\\s*=\\s*(["'])(.*?)\\3[^>]*)>`, "gi");
    html.replace(pattern, (match, tag, attrs, quote, key) => {
      const valueMatch = attrs.match(new RegExp(`\\s${escapeRegExp(attr)}\\s*=\\s*(["'])(.*?)\\1`, "i"));
      if (!valueMatch) return match;
      addField(pageId, key, {
        type: "attr",
        attr,
        label: fieldLabel(key),
        value: decodeEntities(valueMatch[2]),
        selectorHint: `[data-cms-attr-${attr}="${key}"]`,
        updatedAt: null
      });
      return match;
    });
  }
}

function blockIdFromText(prefix, text, fallbackIndex) {
  return `${prefix}_${slug(text || `block_${fallbackIndex}`)}`;
}

function annotateLiveBlocks(html, pageId) {
  let teamGridIndex = 0;
  let genericIndex = 0;
  html = html.replace(/<div\b([^>]*\bid\s*=\s*["']news-grid-container["'][^>]*)>/i, (match, attrs) => {
    return `<div${setAttr(setAttr(attrs, "data-cms-list", "news.articles"), "data-cms-list-type", "newsArticles")}>`;
  });
  html = html.replace(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\bnews-card\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, body) => {
    const title = stripTags((body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "");
    const meta = (body.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bnews-card-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "";
    const spans = [...meta.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((span) => stripTags(span[1]));
    const id = `news_${slug(normalizeDate(spans[1]) || spans[1])}_${slug(spans[0])}_${slug(title)}`;
    return `<a${setAttr(setAttr(attrs, "data-cms-block-id", id), "data-cms-block-type", "newsArticle")}>${body}</a>`;
  });

  html = html.replace(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\bpi-profile\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i, (match, attrs, body) => {
    const name = stripTags((body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "");
    return `<a${setAttr(setAttr(attrs, "data-cms-block-id", `team_${slug(name)}`), "data-cms-block-type", "teamMember")}>${body}</a>`;
  });
  html = html.replace(/<div\b([^>]*\bclass\s*=\s*["'][^"']*\bteam-grid\b[^"']*["'][^>]*)>/gi, (match, attrs) => {
    teamGridIndex += 1;
    const listId = teamGridIndex === 1 ? "team.key_contributors" : "team.alumni";
    return `<div${setAttr(setAttr(attrs, "data-cms-list", listId), "data-cms-list-type", "teamMembers")}>`;
  });
  html = html.replace(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\bresearcher-card\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, body) => {
    const name = stripTags((body.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i) || [])[1] || "");
    return `<a${setAttr(setAttr(attrs, "data-cms-block-id", `team_${slug(name)}`), "data-cms-block-type", "teamMember")}>${body}</a>`;
  });
  html = html.replace(/(<table\b[^>]*\bclass\s*=\s*["'][^"']*\bproject-table\b[^"']*["'][^>]*>[\s\S]*?<tbody)([^>]*)(>)/i, (match, prefix, attrs, close) => {
    return `${prefix}${setAttr(setAttr(attrs, "data-cms-list", "team.summary"), "data-cms-list-type", "teamSummaryRows")}${close}`;
  });
  html = html.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi, (match, attrs, body) => {
    if (!/<td\b/i.test(body)) return match;
    const firstCell = stripTags((body.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i) || [])[1] || "");
    if (!firstCell) return match;
    return `<tr${setAttr(setAttr(attrs, "data-cms-block-id", `summary_${slug(firstCell)}`), "data-cms-block-type", "teamSummaryRow")}>${body}</tr>`;
  });

  html = html.replace(/<(div|ul|ol|tbody)\b([^>]*\bclass\s*=\s*["'][^"']*(?:proof-grid|partners-grid|carousel-track|schools-grid|pillar|grid|cards)[^"']*["'][^>]*)>/gi, (match, tag, attrs) => {
    if (hasCmsAttr(attrs, "data-cms-list")) return match;
    genericIndex += 1;
    return `<${tag}${setAttr(setAttr(attrs, "data-cms-list", `generic_${genericIndex}`), "data-cms-list-type", "genericBlocks")}>`;
  });
  let genericBlockIndex = 0;
  html = html.replace(/<(div|a|article|li|figure)\b([^>]*\bclass\s*=\s*["'][^"']*(?:card|item|slide|logo|partner|school)[^"']*["'][^>]*)>/gi, (match, tag, attrs) => {
    if (hasCmsAttr(attrs, "data-cms-block-id")) return match;
    if (/(news-card-content|news-card-meta|news-image-wrapper|researcher-image-container|pi-image|pi-details|footer-content|navbar-container)/i.test(attrs)) return match;
    genericBlockIndex += 1;
    return `<${tag}${setAttr(setAttr(attrs, "data-cms-block-id", `${pageId}_block_${genericBlockIndex}`), "data-cms-block-type", "genericBlock")}>`;
  });
  return html;
}

function extractNewsCollections() {
  const html = fs.readFileSync(path.join(root, "news.html"), "utf8");
  const gridMatch = html.match(/<div\b[^>]*id\s*=\s*["']news-grid-container["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/main>/i);
  const gridHtml = gridMatch ? gridMatch[1] : html;
  const cards = [];
  const cardPattern = /<a\b([^>]*\bclass\s*=\s*["'][^"']*\bnews-card\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  let index = 0;
  while ((match = cardPattern.exec(gridHtml))) {
    const attrs = match[1];
    const body = match[2];
    const category = attrValue(attrs, "data-category") || "article";
    const title = stripTags((body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "");
    if (!title) continue;
    const metaMatch = body.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bnews-card-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const metaSpans = metaMatch ? [...metaMatch[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((span) => stripTags(span[1])) : [];
    const imgTag = (body.match(/<img\b[^>]*>/i) || [""])[0];
    const displayDate = metaSpans[1] || "";
    const source = metaSpans[0] || "";
    index += 1;
    cards.push({
      id: `news_${slug(normalizeDate(displayDate) || displayDate)}_${slug(source)}_${slug(title)}`,
      type: "newsArticle",
      visible: true,
      order: index * 10,
      category: ["article", "paper", "video"].includes(category) ? category : "article",
      title,
      source,
      date: normalizeDate(displayDate),
      displayDate,
      description: stripTags((body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ""),
      url: attrValue(attrs, "href"),
      imageSrc: htmlAttr(imgTag, "src"),
      imageAlt: htmlAttr(imgTag, "alt") || `Preview of ${title}`,
      openInNewTab: attrValue(attrs, "target") === "_blank",
      updatedAt: null
    });
  }
  seed.collections.newsArticles = normalizeCollectionOrder(mergeById(cards, existingSeed.collections && existingSeed.collections.newsArticles), null);
}

function extractCardMember(cardHtml, sectionId, index) {
  const openTag = (cardHtml.match(/<a\b[^>]*>/i) || [""])[0];
  const imgTag = (cardHtml.match(/<img\b[^>]*>/i) || [""])[0];
  const name = stripTags((cardHtml.match(/<(h3|h4)\b[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || "");
  if (!name) return null;
  const title = stripTags((cardHtml.match(/<p\b[^>]*class\s*=\s*["'][^"']*(?:pi-title|researcher-title)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "");
  let description = stripTags((cardHtml.match(/<p\b[^>]*class\s*=\s*["'][^"']*(?:researcher-description)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "");
  if (!description && sectionId === "principal_investigator") {
    const piDetails = (cardHtml.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bpi-details\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "";
    const paragraphs = [...piDetails.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)];
    const bodyParagraph = paragraphs.find((paragraph) => !/pi-title/i.test(paragraph[1]));
    description = bodyParagraph ? stripTags(bodyParagraph[2]) : "";
  }
  return {
    id: `team_${slug(name)}`,
    type: "teamMember",
    visible: true,
    sectionId,
    order: index * 10,
    name,
    title,
    description,
    affiliation: "",
    expertise: "",
    profileUrl: htmlAttr(openTag, "href"),
    imageSrc: htmlAttr(imgTag, "src"),
    imageAlt: htmlAttr(imgTag, "alt") || `Photo of ${name}`,
    openInNewTab: htmlAttr(openTag, "target") === "_blank",
    includeInSummary: false,
    updatedAt: null
  };
}

function extractTeamCollections() {
  const html = fs.readFileSync(path.join(root, "team.html"), "utf8");
  const members = [];
  const piMatch = html.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bpi-profile\b[^"']*["'][^>]*>[\s\S]*?<\/a>/i);
  if (piMatch) {
    const member = extractCardMember(piMatch[0], "principal_investigator", 1);
    if (member) members.push(member);
  }

  const gridMatches = [...html.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bteam-grid\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div class="section-header"|<div class="table-container"|<\/div>\s*<\/main>)/gi)];
  gridMatches.slice(0, 2).forEach((gridMatch, gridIndex) => {
    const sectionId = gridIndex === 0 ? "key_contributors" : "alumni";
    const cardPattern = /<a\b[^>]*class\s*=\s*["'][^"']*\bresearcher-card\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
    let cardMatch;
    let index = 0;
    while ((cardMatch = cardPattern.exec(gridMatch[1]))) {
      index += 1;
      const member = extractCardMember(cardMatch[0], sectionId, index);
      if (member) members.push(member);
    }
  });

  const summaryRows = [];
  const tableBody = (html.match(/<table\b[^>]*class\s*=\s*["'][^"']*\bproject-table\b[^"']*["'][^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i) || [])[1] || "";
  const memberByName = new Map(members.map((member) => [slug(member.name), member]));
  let rowIndex = 0;
  tableBody.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (rowMatch, rowHtml) => {
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => stripTags(cell[1]));
    if (cells.length < 3) return rowMatch;
    rowIndex += 1;
    const [name, affiliation, expertise] = cells;
    const member = memberByName.get(slug(name));
    if (member) {
      member.affiliation = affiliation;
      member.expertise = expertise;
      member.includeInSummary = true;
      if (!member.order) member.order = rowIndex * 10;
    } else {
      summaryRows.push({
        id: `summary_manual_${slug(name)}`,
        visible: true,
        order: rowIndex * 10,
        name,
        affiliation,
        expertise,
        sourceMemberId: null,
        manual: true
      });
    }
    return rowMatch;
  });

  seed.collections.teamSections = mergeById(teamSectionDefaults, existingSeed.collections && existingSeed.collections.teamSections)
    .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999));
  seed.collections.teamMembers = normalizeCollectionOrder(mergeById(members, existingSeed.collections && existingSeed.collections.teamMembers), "sectionId");
  seed.collections.teamSummaryRows = normalizeCollectionOrder(mergeById(summaryRows, existingSeed.collections && existingSeed.collections.teamSummaryRows), null);
}

function extractCollections() {
  extractNewsCollections();
  extractTeamCollections();
  extractGenericBlocks();
}

function extractGenericBlocks() {
  seed.collections.genericBlocks = seed.collections.genericBlocks || {};
  for (const page of publicPages) {
    const pageId = pageIdFor(page);
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const listPattern = /<([a-z][a-z0-9-]*)\b([^>]*\sdata-cms-list\s*=\s*(["'])(.*?)\3[^>]*)>([\s\S]*?)<\/\1>/gi;
    let listMatch;
    while ((listMatch = listPattern.exec(html))) {
      const attrs = listMatch[2];
      const listId = attrValue(attrs, "data-cms-list");
      const listType = attrValue(attrs, "data-cms-list-type");
      if (!listId || listType !== "genericBlocks") continue;
      const key = `${pageId}.${listId}`;
      const existing = existingSeed.collections && existingSeed.collections.genericBlocks && existingSeed.collections.genericBlocks[key];
      const blocks = [];
      const blockPattern = /<([a-z][a-z0-9-]*)\b([^>]*\sdata-cms-block-id\s*=\s*(["'])(.*?)\3[^>]*)>/gi;
      let blockMatch;
      let index = 0;
      while ((blockMatch = blockPattern.exec(listMatch[5]))) {
        const id = blockMatch[4];
        if (!id) continue;
        index += 1;
        blocks.push({ id, visible: true, order: index * 10, sourceCmsKeys: [], updatedAt: null });
      }
      if (blocks.length) seed.collections.genericBlocks[key] = normalizeCollectionOrder(mergeById(blocks, existing), null);
    }
  }
}

function migratePage(file) {
  const pageId = pageIdFor(file);
  seed.pages[pageId] = {
    path: file,
    title: titleForPage(pageId),
    fields: {}
  };

  const filePath = path.join(root, file);
  let html = fs.readFileSync(filePath, "utf8");
  html = stripCmsAnnotations(html);
  html = ensureBodyPage(html, pageId);
  html = ensureCmsAssets(html);

  const protectedResult = protectBlocks(html);
  let working = protectedResult.protectedHtml;
  working = annotateTitle(working, pageId);
  working = annotateMetaDescription(working, pageId);
  working = annotateAttrs(working, pageId);
  working = annotateKnownGlobals(working, pageId);
  working = annotateSimpleAnchors(working, pageId);
  working = annotateVisibleText(working, pageId);
  working = annotateLiveBlocks(working, pageId);
  html = restoreBlocks(working, protectedResult.blocks);

  fs.writeFileSync(filePath, html);
  extractExistingFields(html, pageId);
}

for (const page of publicPages) migratePage(page);
extractCollections();

const cmsDir = path.join(root, "cms");
fs.mkdirSync(cmsDir, { recursive: true });
fs.writeFileSync(path.join(cmsDir, "seed-content.json"), `${JSON.stringify(seed, null, 2)}\n`);

console.log(`Prepared CMS annotations for ${publicPages.length} pages.`);
console.log(`Wrote ${path.relative(root, path.join(cmsDir, "seed-content.json"))}.`);
