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
    });

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Gemini API error (${res.status}): ${text}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(rawText);
  }, "Gemini Script Gen");
}

/**
 * Step 3: Exchange OAuth2 Refresh Token for a fresh Access Token
 */
async function getOAuthAccessToken() {
  const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    throw new Error("Missing YT_CLIENT_ID, YT_CLIENT_SECRET, or YT_REFRESH_TOKEN.");
  }

  return withRetry(async () => {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YT_CLIENT_ID,
        client_secret: YT_CLIENT_SECRET,
        refresh_token: YT_REFRESH_TOKEN,
        grant_type: "refresh_token"
      })
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      const err = new Error(`OAuth token refresh failed: ${JSON.stringify(data)}`);
      err.status = res.status;
      throw err;
    }
    return data.access_token;
  }, "OAuth Token Refresh");
}

/**
 * Step 4: Direct YouTube Upload via videos.insert (Resumable Upload)
 */
async function uploadVideoToYouTube({ videoUrl, metadata, privacyStatus = "private", containsSyntheticMedia = true }) {
  if (!videoUrl) {
    throw new Error("Missing videoUrl (direct link to an .mp4 file) for upload.");
  }

  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    throw new Error(`Could not fetch video from URL (${videoRes.status}).`);
  }
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const contentType = videoRes.headers.get("content-type") || "video/mp4";

  const accessToken = await getOAuthAccessToken();

  const initRes = await withRetry(async () => {
    const r = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(videoBuffer.length),
          "X-Upload-Content-Type": contentType
        },
        body: JSON.stringify({
          snippet: {
            title: (metadata.title || "AI Short #Shorts").slice(0, 100),
            description: metadata.description || "#Shorts",
            tags: Array.isArray(metadata.tags) ? metadata.tags : ["Shorts"],
            categoryId: "28"
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: false,
            containsSyntheticMedia
          }
        })
      }
    );
    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`YouTube Upload Init failed (${r.status}): ${text}`);
      err.status = r.status;
      throw err;
    }
    return r;
  }, "YouTube Upload Init");

  const uploadLocation = initRes.headers.get("location");
  if (!uploadLocation) {
    throw new Error("YouTube did not return a resumable upload location header.");
  }

  return withRetry(async () => {
    const uploadRes = await fetch(uploadLocation, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(videoBuffer.length)
      },
      body: videoBuffer
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      const err = new Error(`YouTube Binary Upload failed (${uploadRes.status}): ${text}`);
      err.status = uploadRes.status;
      throw err;
    }
    return uploadRes.json();
  }, "YouTube Binary Upload");
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const mode = body.mode || "analyze_and_generate";
    const regionCode = body.regionCode || "IN";
    const niche = body.niche || "Tech & AI Facts in Telugu";
    const language = body.language || "Telugu";

    // 1. Fetch YouTube Trends + Google Trends in parallel
    const [ytResult, googleResult] = await Promise.allSettled([
      fetchTrendingTopics(regionCode, 8),
      fetchGoogleTrends(regionCode, 10)
    ]);

    const ytTrends = ytResult.status === "fulfilled" ? ytResult.value : [];
    const googleTrends = googleResult.status === "fulfilled" ? googleResult.value.trends : [];

    if (ytTrends.length === 0 && googleTrends.length === 0) {
      throw new Error(
        `Both trend sources failed. YT: ${ytResult.reason?.message || "none"} | Google: ${googleResult.reason?.message || "none"}`
      );
    }

    // 2. Generate Unique Script from combined trends
    const generated = await generateUniqueShortScript(ytTrends, googleTrends, niche, language);

    // 3. Optional Direct Upload
    let uploadResult = null;
    if (mode === "full_upload") {
      uploadResult = await uploadVideoToYouTube({
        videoUrl: body.videoUrl,
        metadata: generated,
        privacyStatus: body.privacyStatus || "private",
        containsSyntheticMedia: body.containsSyntheticMedia !== false
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        agent: "Harry (YouTube Automation Lead)",
        mode,
        sources: {
          youtubeTrendsCount: ytTrends.length,
          googleTrendsCount: googleTrends.length
        },
        topYouTubeTrends: ytTrends.slice(0, 5),
        topGoogleTrends: googleTrends.slice(0, 5),
        generatedContent: generated,
        uploadResult,
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        agent: "Harry (YouTube Automation Lead)",
        error: err.message,
        chinnaDiagnosis: diagnoseError(err.message)
      })
    };
  }
};
