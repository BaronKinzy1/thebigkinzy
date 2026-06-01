const log = {
  info:  (...a) => console.log(...a),
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

import { cfg } from "../lib/config.js";

import { safeErr } from "../lib/errors.js";
import { stableHash, todayKey } from "./digestCache.js";

function htmlDecode(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(text) {
  return htmlDecode(String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchText(url, sourceName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(cfg.MARKET_FETCH_TIMEOUT_MS || 15000));

  try {
    log.info("market_fetch_start", { source: sourceName, urlHost: new URL(url).host });
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CookMyBotsMarketNewsBot/1.0",
        Accept: "application/json,text/xml,text/plain,*/*",
      },
    });

    if (!response.ok) throw new Error("HTTP " + response.status);
    const text = await response.text();
    log.info("market_fetch_success", { source: sourceName, bytes: text.length });
    return { ok: true, text };
  } catch (err) {
    log.warn("market_fetch_failure", { source: sourceName, err: safeErr(err) });
    return { ok: false, error: safeErr(err), text: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, sourceName) {
  const result = await fetchText(url, sourceName);
  if (!result.ok) return { ok: false, error: result.error, data: null };

  try {
    return { ok: true, data: JSON.parse(result.text) };
  } catch (err) {
    log.warn("market_parse_failure", { source: sourceName, err: safeErr(err) });
    return { ok: false, error: safeErr(err), data: null };
  }
}

function parseRss(xml, source, limit = 6) {
  const items = [];
  const matches = String(xml || "").match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const item of matches.slice(0, limit)) {
    const pick = (tag) => {
      const match = item.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"));
      return stripTags(match?.[1] || "");
    };

    const title = pick("title");
    if (!title) continue;

    items.push({
      source,
      title,
      link: pick("link"),
      publishedAt: pick("pubDate"),
      summary: pick("description").slice(0, 260),
    });
  }

  return items;
}

function parseStooqCsv(csv) {
  const rows = String(csv || "").trim().split(/\r?\n/);
  const header = rows.shift();
  if (!header) return [];

  return rows.map((row) => {
    const [symbol, date, time, open, high, low, close, volume] = row.split(",");
    return {
      symbol,
      date,
      time,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
  }).filter((row) => row.symbol && Number.isFinite(row.close));
}

async function fetchCryptoMarkets() {
  const url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h";
  const result = await fetchJson(url, "coingecko_markets");
  if (!result.ok || !Array.isArray(result.data)) return { ok: false, error: result.error, data: [] };

  return {
    ok: true,
    data: result.data.map((coin) => ({
      id: coin.id,
      symbol: String(coin.symbol || "").toUpperCase(),
      name: coin.name,
      priceUsd: coin.current_price,
      marketCapUsd: coin.market_cap,
      change24hPct: coin.price_change_percentage_24h,
      volume24hUsd: coin.total_volume,
    })),
  };
}

async function fetchStockSnapshot() {
  const url = "https://stooq.com/q/l/?s=spy.us,qqq.us,dia.us&f=sd2t2ohlcv&h&e=csv";
  const result = await fetchText(url, "stooq_equity_etfs");
  if (!result.ok) return { ok: false, error: result.error, data: [] };
  return { ok: true, data: parseStooqCsv(result.text) };
}

async function fetchNews() {
  const feeds = [
    {
      source: "CoinDesk RSS",
      url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
      group: "crypto",
    },
    {
      source: "Yahoo Finance RSS",
      url: "https://finance.yahoo.com/news/rssindex",
      group: "stocks",
    },
  ];

  const results = [];
  for (const feed of feeds) {
    const result = await fetchText(feed.url, feed.source);
    if (!result.ok) {
      results.push({ ok: false, source: feed.source, group: feed.group, error: result.error, items: [] });
      continue;
    }

    results.push({
      ok: true,
      source: feed.source,
      group: feed.group,
      items: parseRss(result.text, feed.source, 6),
    });
  }

  return results;
}

export async function collectMarketContext() {
  log.info("market_context_collect_start", { platform: "whatsapp" });

  const [crypto, stocks, news] = await Promise.all([
    fetchCryptoMarkets(),
    fetchStockSnapshot(),
    fetchNews(),
  ]);

  const snapshot = {
    date: todayKey(),
    fetchedAt: new Date().toISOString(),
    availability: {
      cryptoMarkets: Boolean(crypto.ok),
      stockMarket: Boolean(stocks.ok),
      newsFeeds: news.some((item) => item.ok),
    },
    sources: {
      cryptoMarkets: crypto,
      stockMarket: stocks,
      newsFeeds: news,
    },
  };

  snapshot.sourceHash = stableHash(snapshot.sources);

  log.info("market_context_collect_success", {
    cryptoMarkets: snapshot.availability.cryptoMarkets,
    stockMarket: snapshot.availability.stockMarket,
    newsFeeds: snapshot.availability.newsFeeds,
    sourceHash: snapshot.sourceHash.slice(0, 12),
  });

  return snapshot;
}

export function compactMarketContext(snapshot, cachedDigest = null) {
  return JSON.stringify({
    date: snapshot?.date || todayKey(),
    fetchedAt: snapshot?.fetchedAt || null,
    availability: snapshot?.availability || {},
    sourceHash: snapshot?.sourceHash || "",
    cachedDigest: cachedDigest ? {
      date: cachedDigest.date,
      sourceHash: cachedDigest.sourceHash,
      digest: cachedDigest.digest,
    } : null,
    publicSources: snapshot?.sources || {},
    instruction: "Use these public source snapshots only for current facts. If unavailable or insufficient, say fresh data could not be retrieved or verified instead of fabricating.",
  });
}
