// RSS 2.0 and Atom -> opportunities.
import * as cheerio from "cheerio";
import { findDeadlines, parseDate } from "../extract.ts";
import type { Opportunity } from "../types.ts";

export const MAX_FEED_ITEMS = 50;

export function looksLikeFeed(contentType: string | null, body: string): boolean {
  return /xml|rss|atom/i.test(contentType ?? "") && /<(rss|feed|rdf:RDF)\b/i.test(body.slice(0, 2000)) || /^\s*(<\?xml[^>]*>\s*)?<(rss|feed)\b/i.test(body.slice(0, 500));
}

const plain = (html: string) => cheerio.load(html).text().replace(/\s+/g, " ").trim();

export function parseFeed(xml: string, today: string): Opportunity[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: Opportunity[] = [];
  const text = (el: cheerio.Cheerio<any>, sel: string) => el.children(sel).first().text().trim();
  for (const el of $("item, entry").toArray().slice(0, MAX_FEED_ITEMS)) {
    const item = $(el);
    const title = plain(text(item, "title"));
    const atomLink = item.children("link").filter((_, l) => ($(l).attr("rel") ?? "alternate") === "alternate").first().attr("href");
    const url = atomLink || text(item, "link") || null;
    const description = plain(text(item, "description") || text(item, "summary") || text(item, "content")).slice(0, 2000);
    const external_id = text(item, "guid") || text(item, "id") || url || title;
    if (!title || !external_id) continue;
    // a feed only gives a deadline when the item says so; the pubDate is never one
    const deadline = parseDate(text(item, "deadline")) ?? findDeadlines(`${title}\n${description}`, today).future;
    out.push({ external_id, title, url, description, deadline, status: "open" });
  }
  return out;
}
