/**
 * Harry — Google Trends Tracker (Step 1)
 * Fetches live trending search topics from Google Trends RSS feed (zero API key required).
 * Works both as a standalone Node 18+ script and as a Netlify Function.
 *
 * Usage (CLI): node google-trends-tracker.js IN
 * Usage (Netlify): GET /.netlify/functions/google-trends-tracker?geo=IN
 */

async function fetchWithRetry(url, retries = 3, delayMs = 800) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Harry-TrendTracker/1.0 (+https://trends.google.com/trending)"
        }
      });
      if (res.ok) return await res.text();
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err) {
      if (attempt === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
  }
  throw new Error("Max retries exceeded fetching Google Trends RSS.");
}

function extractTag(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = block.match(regex);
  if (!match) return "";
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function parseTrendsRss(xml, limit = 15) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    items.push({
      topic: extractTag(block, "title"),
      approxTraffic: extractTag(block, "ht:approx_traffic") || "N/A",
      publishedAt: extractTag(block, "pubDate"),
      topHeadline: extractTag(block, "ht:news_item_title"),
      newsUrl: extractTag(block, "ht:news_item_url")
    });
  }
  return items;
}

async function fetchGoogleTrends(geo = "IN", limit = 15) {
  const rssUrl = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
  const xml = await fetchWithRetry(rssUrl);
  const trends = parseTrendsRss(xml, limit);
  return {
    source: "Google Trends RSS",
    geo,
    count: trends.length,
    fetchedAt: new Date().toISOString(),
    trends
  };
}

// Netlify Function handler
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };
  try {
    const geo = event.queryStringParameters?.geo || "IN";
    const limit = Number(event.queryStringParameters?.limit) || 15;
    const result = await fetchGoogleTrends(geo, limit);
    return { statusCode: 200, headers, body: JSON.stringify(result, null, 2) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

exports.fetchGoogleTrends = fetchGoogleTrends;

// Run directly via CLI: node google-trends-tracker.js IN
if (require.main === module) {
  const geo = process.argv[2] || "IN";
  fetchGoogleTrends(geo, 10)
    .then((data) => console.log(JSON.stringify(data, null, 2)))
    .catch((err) => {
      console.error("Trend fetch failed:", err.message);
      process.exit(1);
    });
}
