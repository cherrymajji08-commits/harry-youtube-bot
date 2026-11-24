// Harry (Lead YouTube Automation Agent)
// 1. Analyzes BOTH YouTube Trending videos and Google Trends (regionCode=IN)
// 2. Generates a unique, non-copied Shorts script & metadata via Gemini API
// 3. Uploads an MP4 video directly to YouTube via videos.insert (Resumable Upload)
// Uses Chinna (chinna-maintenance.js) for retries and error diagnosis.

const { withRetry, diagnoseError } = require("./chinna-maintenance");
const { fetchGoogleTrends } = require("./google-trends-tracker");

/**
 * Step 1A: Fetch trending videos from YouTube Data API v3
 */
async function fetchTrendingTopics(regionCode = "IN", maxResults = 8) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("Missing YOUTUBE_API_KEY environment variable.");

  return withRetry(async () => {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=${encodeURIComponent(regionCode)}&maxResults=${maxResults}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`YouTube Trends API error (${res.status}): ${text}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return (data.items || []).map((item) => ({
      id: item.id,
      title: item.snippet?.title || "",
      channelTitle: item.snippet?.channelTitle || "",
      tags: (item.snippet?.tags || []).slice(0, 5),
      views: item.statistics?.viewCount || "0"
    }));
  }, "YouTube Trends");
}

/**
 * Step 2: Generate a unique Shorts script & SEO metadata using Gemini API
 * Combines YouTube Trends + Google Trends for stronger topic selection.
 */
async function generateUniqueShortScript(
  ytTrends = [],
  googleTrends = [],
  niche = "Tech & AI Facts in Telugu",
  language = "Telugu"
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY environment variable.");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const ytSummary = ytTrends.length
    ? ytTrends.map((t, i) => `${i + 1}. ${t.title} (${t.views} views)`).join("\n")
    : "Unavailable";

  const googleSummary = googleTrends.length
    ? googleTrends.map((g, i) => `${i + 1}. ${g.topic} (${g.approxTraffic} searches)`).join("\n")
    : "Unavailable";

  const prompt = `You are Harry, an expert YouTube Shorts content strategist.
Current YouTube trending videos:
${ytSummary}

Current Google Search trending topics:
${googleSummary}

Target Niche: ${niche}
Language: ${language}

Combine insights from BOTH trend sources to create ONE completely ORIGINAL, high-retention 45-second YouTube Shorts concept tailored to the target niche (do NOT copy any existing video).
Return valid JSON ONLY with these exact keys:
{
  "title": "Catchy title under 70 chars including #Shorts",
  "description": "2-3 engaging lines with relevant hashtags",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "hook": "First 3 seconds attention-grabbing opening line",
  "script": "Full 45-second narration script",
  "visualCues": ["Scene 1 visual", "Scene 2 visual", "Scene 3 visual"],
  "inspiredBy": "Which Google/YouTube trend inspired this angle"
}`;

  return withRetry(async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.8
        }
      })
    })
