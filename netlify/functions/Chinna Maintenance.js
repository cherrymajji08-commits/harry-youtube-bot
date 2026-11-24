// Chinna (Maintenance & Bug-Clearing Sub-agent under Harry)
// Handles retries, API health checks, token validation, and error diagnosis.

const REQUIRED_ENV_VARS = [
  "YOUTUBE_API_KEY",
  "GEMINI_API_KEY",
  "YT_CLIENT_ID",
  "YT_CLIENT_SECRET",
  "YT_REFRESH_TOKEN"
];

/**
 * Exponential backoff retry wrapper used by Harry for transient 429 / 5xx errors.
 */
async function withRetry(fn, label = "API Call", maxRetries = 3, baseDelayMs = 800) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.status || 0;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (!isRetryable || attempt === maxRetries) {
        break;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error(`[Chinna Retry Failed - ${label}]: ${lastError.message}`);
}

/**
 * Classifies common YouTube / Gemini API errors into actionable fixes.
 */
function diagnoseError(errorMessage = "") {
  const msg = String(errorMessage).toLowerCase();
  if (msg.includes("quotaexceeded")) {
    return {
      code: "QUOTA_EXCEEDED",
      severity: "HIGH",
      fix: "YouTube Data API daily quota (10,000 units) reached. Wait until midnight Pacific Time or reduce upload/search frequency."
    };
  }
  if (msg.includes("invalid_grant") || msg.includes("401") || msg.includes("unauthorized")) {
    return {
      code: "OAUTH_EXPIRED",
      severity: "HIGH",
      fix: "YT_REFRESH_TOKEN expired or revoked. Re-generate a Refresh Token in OAuth Playground / Google Cloud Console and update Netlify env vars."
    };
  }
  if (msg.includes("429") || msg.includes("rate limit")) {
    return {
      code: "RATE_LIMIT",
      severity: "MEDIUM",
      fix: "Too many requests to Gemini or YouTube API. Chinna will auto-retry with backoff; wait 1-2 minutes."
    };
  }
  if (msg.includes("api key not valid") || msg.includes("403")) {
    return {
      code: "INVALID_KEY_OR_PERMISSION",
      severity: "HIGH",
      fix: "Check YOUTUBE_API_KEY / GEMINI_API_KEY in Netlify Environment Variables and ensure YouTube Data API v3 is enabled."
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    severity: "MEDIUM",
    fix: "Inspect Netlify Function logs for full stack trace and verify video URL accessibility."
  };
}

exports.withRetry = withRetry;
exports.diagnoseError = diagnoseError;

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
    const action = body.action || "health_check";

    if (action === "diagnose") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          agent: "Chinna (Maintenance Sub-agent)",
          diagnosis: diagnoseError(body.error || "")
        })
      };
    }

    // Default: Full Health Check
    const envStatus = {};
    let missingCount = 0;
    for (const key of REQUIRED_ENV_VARS) {
      const present = Boolean(process.env[key] && process.env[key].trim().length > 0);
      envStatus[key] = present ? "OK" : "MISSING";
      if (!present) missingCount++;
    }

    const checks = {
      envVars: envStatus,
      youtubeDataApi: "SKIPPED",
      oauthToken: "SKIPPED",
      geminiApi: "SKIPPED"
    };

    // 1. Test YouTube Data API key
    if (process.env.YOUTUBE_API_KEY) {
      try {
        const ytRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=id&chart=mostPopular&regionCode=IN&maxResults=1&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`
        );
        checks.youtubeDataApi = ytRes.ok ? "OK" : `ERROR (${ytRes.status})`;
      } catch (e) {
        checks.youtubeDataApi = `FAIL: ${e.message}`;
      }
    }

    // 2. Test OAuth Refresh Token
    if (process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN) {
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.YT_CLIENT_ID,
            client_secret: process.env.YT_CLIENT_SECRET,
            refresh_token: process.env.YT_REFRESH_TOKEN,
            grant_type: "refresh_token"
          })
        });
        checks.oauthToken = tokenRes.ok ? "OK" : `ERROR (${tokenRes.status})`;
      } catch (e) {
        checks.oauthToken = `FAIL: ${e.message}`;
      }
    }

    // 3. Test Gemini API
    if (process.env.GEMINI_API_KEY) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        const gemRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`
        );
        checks.geminiApi = gemRes.ok ? "OK" : `ERROR (${gemRes.status})`;
      } catch (e) {
        checks.geminiApi = `FAIL: ${e.message}`;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        agent: "Chinna (Maintenance Sub-agent)",
        status: missingCount === 0 ? "HEALTHY" : "NEEDS_SETUP",
        missingEnvVars: missingCount,
        checks,
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        agent: "Chinna (Maintenance Sub-agent)",
        error: err.message,
        diagnosis: diagnoseError(err.message)
      })
    };
  }
};