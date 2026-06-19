import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as playwright from "playwright";
import * as cheerio from "cheerio";
import { z } from "zod";
import https from "https";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Random integer in [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random element from an array */
function pick<T>(arr: T[]): T { return arr[randInt(0, arr.length - 1)]; }

/** Random delay in ms (simulates human thinking) */
function randomDelay(minMs = 300, maxMs = 1500): Promise<void> {
  return new Promise(r => setTimeout(r, randInt(minMs, maxMs)));
}

/** Randomize browser fingerprint per request */
function randomHeaders(): Record<string, string> {
  const chromeVersions = ["125", "126", "127", "128", "129", "130", "131"];
  const chromeVer = pick(chromeVersions);
  const platforms = [
    { ua: '(Windows NT 10.0; Win64; x64)', platform: '"Windows"' },
    { ua: '(Macintosh; Intel Mac OS X 10_15_7)', platform: '"macOS"' },
    { ua: '(X11; Linux x86_64)', platform: '"Linux"' },
  ];
  const pf = pick(platforms);
  const langs = [
    { lang: 'en-US,en;q=0.9', moz: '?0' },
    { lang: 'en-GB,en;q=0.9', moz: '?0' },
    { lang: 'de-DE,de;q=0.9,en;q=0.8', moz: '?0' },
    { lang: 'fr-FR,fr;q=0.9,en;q=0.8', moz: '?0' },
    { lang: 'ja-JP,ja;q=0.9,en;q=0.8', moz: '?0' },
    { lang: 'ru-RU,ru;q=0.9,en;q=0.8', moz: '?0' },
    { lang: 'en-US', moz: '?1' },
  ];
  const lg = pick(langs);

  return {
    "User-Agent": `Mozilla/5.0 ${pf.ua} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36`,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": lg.lang,
    "Accept-Encoding": "identity",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": pick(["none", "same-origin", "cors"]),
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": `"Not A(Brand";v="${randInt(98, 100)}", "Google Chrome";v="${chromeVer}", "Chromium";v="${chromeVer}"`,
    "Sec-Ch-Ua-Mobile": lg.moz,
    "Sec-Ch-Ua-Platform": pf.platform,
  };
}

function httpGet(url: string, delay = true): Promise<string> {
  if (delay) void randomDelay();
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: randomHeaders() },
      (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    ).on("error", reject);
  });
}

function extractText(html: string): string {
  const $ = cheerio.load(html, { xmlMode: false });
  $("script, style, noscript, link, meta, head, nav, footer").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text || "No extractable text found.";
}

interface Link { text: string; href: string }

function extractLinks(html: string, baseUrl: string): Link[] {
  const $ = cheerio.load(html, { xmlMode: false });
  const links: Link[] = [];
  $("a[href]").each((_, el) => {
    const href = (el.attribs as Record<string, string>)?.href;
    const text = $(el).text().trim();
    if (href && !href.startsWith("#") && !href.startsWith("data:")) {
      let fullUrl = href;
      if (href.startsWith("//")) fullUrl = "https:" + href;
      else if (href.startsWith("/")) {
        fullUrl = new URL(baseUrl).origin + href;
      } else if (!href.startsWith("http")) {
        fullUrl = new URL(href, baseUrl).toString();
      }
      links.push({ text, href: fullUrl });
    }
  });
  return links;
}

// ─── Playwright browser management ──────────────────────────────────────────

let browser: playwright.Browser | null = null;

function randomPlaywrightHeaders(): { userAgent: string; acceptLanguage: string } {
  const chromeVersions = ["125", "126", "127", "128", "129", "130", "131"];
  const chromeVer = pick(chromeVersions);
  const platforms = [
    "Windows NT 10.0; Win64; x64",
    "Macintosh; Intel Mac OS X 10_15_7",
    "X11; Linux x86_64",
  ];
  const ua = `Mozilla/5.0 (${pick(platforms)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer}.0.0.0 Safari/537.36`;
  const langs = ["en-US", "en-GB", "de-DE", "fr-FR", "ja-JP", "ru-RU"];
  return { userAgent: ua, acceptLanguage: pick(langs) };
}

async function getBrowser(): Promise<playwright.Browser> {
  if (!browser) {
    browser = await playwright.chromium.launch({ headless: true });
  }
  return browser;
}

async function newPageWithRandomHeaders(browser: playwright.Browser): Promise<playwright.Page> {
  const { userAgent, acceptLanguage } = randomPlaywrightHeaders();
  const context = await browser.newContext({
    userAgent,
    extraHTTPHeaders: {
      "Accept-Language": acceptLanguage,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": pick(["none", "cors"]),
      "Upgrade-Insecure-Requests": "1",
    },
  });
  return context.newPage();
}

async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-web-search",
  version: "1.0.0",
});

// 1. Web Search — DuckDuckGo HTML (no JS, no API key)
server.tool(
  "web_search",
  "Search the web and return results with titles, URLs, and snippets.",
  {
    query: z.string().describe("Search query"),
    maxResults: z.number().int().positive().max(20).default(10).describe("Maximum number of results (default 10)"),
  },
  async ({ query, maxResults }) => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await httpGet(url);

      const $ = cheerio.load(html, { xmlMode: false });
      const results: Array<{ title: string; url: string; snippet: string }> = [];

      $("div.result").each((_, el) => {
        const linkEl = $(el).find("a.result__a");
        const snippetEl = $(el).find("a.result__snippet");

        const title = linkEl.text().trim();
        const href = linkEl.attr("href");
        const snippet = (snippetEl.text().trim() || linkEl.text().trim())
          .replace(/ /g, " ").trim();

        if (title && href) {
          // DuckDuckGo wraps URLs in /ll/?click=...&uddg=...
          const params = new URLSearchParams(href.split("?")[1] || "");
          const decodedUrl = decodeURIComponent(params.get("uddg") || href);
          results.push({ title, url: decodedUrl, snippet: snippet || "No snippet available." });
        }
      });

      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Search failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// 2. Web Fetch — fetch URL and return parsed content
server.tool(
  "web_fetch",
  "Fetch a URL and return its parsed HTML content as text, optionally with extracted links.",
  {
    url: z.string().url().describe("URL to fetch"),
    withLinks: z.boolean().default(false).describe("Include extracted links (default false)"),
    maxContentLength: z.number().int().positive().default(10000).describe("Maximum content length in characters (default 10000)"),
  },
  async ({ url, withLinks, maxContentLength }) => {
    try {
      const html = await httpGet(url, false);
      const text = extractText(html);
      const truncated = text.length > maxContentLength
        ? text.slice(0, maxContentLength) + "\n\n[Content truncated]"
        : text;

      let extra = "";
      if (withLinks) {
        const links = extractLinks(html, url);
        extra = "\n\n--- Extracted Links ---\n" +
          links.map((l) => `- [${l.text}](${l.href})`).join("\n");
      }

      return { content: [{ type: "text", text: truncated + extra }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Fetch failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// 3. Web Scrape — Playwright for JS-heavy / dynamic sites
server.tool(
  "web_scrape",
  "Use Playwright (browser) to load a page with JavaScript support and extract content. Best for dynamic/SPA sites.",
  {
    url: z.string().url().describe("URL to scrape"),
    waitForSelector: z.string().optional().describe("CSS selector to wait for before extracting (e.g. 'main', '.article-body')"),
    timeout: z.number().int().positive().default(30000).describe("Page load timeout in ms (default 30000)"),
    maxContentLength: z.number().int().positive().default(15000).describe("Maximum content length in characters (default 15000)"),
    takeScreenshot: z.boolean().default(false).describe("Take a screenshot after loading (default false)"),
  },
  async ({ url, waitForSelector, timeout, maxContentLength, takeScreenshot }) => {
    let page: playwright.Page | null = null;
    try {
      const browser = await getBrowser();
      page = await newPageWithRandomHeaders(browser);

      await page.goto(url, { waitUntil: "networkidle", timeout }).catch(() => {});

      if (waitForSelector) {
        try {
          await page.waitForSelector(waitForSelector, { timeout: 10000 });
        } catch {
          // Continue anyway
        }
      }

      const html = await page.evaluate(() => {
        const body = document.body;
        if (!body) return "";
        body.querySelectorAll("script, style, noscript, link, svg").forEach((el) => el.remove());
        return body.innerHTML;
      });

      const text = cheerio.load(html, { xmlMode: false })("body").text().replace(/\s+/g, " ").trim();
      const truncated = text.length > maxContentLength
        ? text.slice(0, maxContentLength) + "\n\n[Content truncated]"
        : text;

      if (takeScreenshot) {
        try {
          await page.screenshot({ type: "png" });
        } catch { /* ignore */ }
      }

      await page.close();
      return { content: [{ type: "text", text: truncated }] };
    } catch (err) {
      await page?.close().catch(() => {});
      return {
        content: [{ type: "text", text: `Scrape failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// 4. Open URL — navigate and return title + status + preview
server.tool(
  "open_url",
  "Open a URL in a headless browser and return the page title, HTTP status, and a short content preview.",
  {
    url: z.string().url().describe("URL to open"),
    waitForSelector: z.string().optional().describe("CSS selector to wait for before returning"),
    timeout: z.number().int().positive().default(30000).describe("Page load timeout in ms (default 30000)"),
  },
  async ({ url, waitForSelector, timeout }) => {
    let page: playwright.Page | null = null;
    try {
      const browser = await getBrowser();
      page = await newPageWithRandomHeaders(browser);

      const response = await page
        .goto(url, { waitUntil: "domcontentloaded", timeout })
        .catch(() => null);

      const title = await page.title();
      const status = response?.status() ?? "unknown";

      const preview = await page.evaluate(() => {
        document.querySelectorAll("script, style, noscript, link, svg").forEach((el) => el.remove());
        const text = document.body?.textContent?.replace(/\s+/g, " ").trim() || "";
        return text.slice(0, 2000);
      }).catch(() => "");

      if (waitForSelector) {
        try {
          await page.waitForSelector(waitForSelector, { timeout: 10000 });
        } catch {
          // Continue anyway
        }
      }

      await page.close();

      const result = `Title: ${title}\nStatus: ${status}\nURL: ${url}\n\nPreview:\n${preview}`;
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      await page?.close().catch(() => {});
      return {
        content: [{ type: "text", text: `Open URL failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Start server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Web Search server started");

  process.on("SIGINT", async () => {
    await closeBrowser();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await closeBrowser();
    process.exit(0);
  });
}

main().catch(console.error);
