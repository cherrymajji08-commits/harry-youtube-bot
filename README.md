# Harry & Chinna — YouTube Shorts Automation (Netlify)

## Included Files
- `netlify/functions/harry-orchestrator.js`: Trend analysis (`videos.list`), unique Gemini script generation, and resumable YouTube upload (`videos.insert`).
- `netlify/functions/chinna-maintenance.js`: Maintenance sub-agent with exponential backoff retries, API health checks, and error diagnosis.
- `public/index.html`: Mobile-friendly HUD to trigger Harry & Chinna from your phone browser.
- `netlify.toml` & `package.json`: Netlify configuration (Node 18+, zero external npm dependencies required).

## Netlify Environment Variables
In **Netlify Dashboard → Site configuration → Environment variables**, add:

| Variable | Where to get it |
| :--- | :--- |
| `YOUTUBE_API_KEY` | Google Cloud Console → Credentials → API Key |
| `YT_CLIENT_ID` | Google Cloud Console → Credentials → OAuth 2.0 Client ID |
| `YT_CLIENT_SECRET` | Google Cloud Console → Credentials → OAuth 2.0 Client Secret |
| `YT_REFRESH_TOKEN` | Generated via OAuth 2.0 Playground (`https://www.googleapis.com/auth/youtube.upload` scope) |
| `GEMINI_API_KEY` | Google AI Studio (`https://aistudio.google.com/app/apikey`) |
| `GEMINI_MODEL` | Optional (defaults to `gemini-2.5-flash`) |

## Official Documentation
- [YouTube Data API v3 Overview](https://developers.google.com/youtube/data)
- [Videos: list (Trending/Most Popular)](https://developers.google.com/youtube/data/reference/rest/v3/videos/list)
- [Videos: insert (Resumable Upload)](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)
- [Gemini API Keys](https://aistudio.google.com/docs/api-key)
