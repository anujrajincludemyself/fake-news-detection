# TruthLens – AI Fake News Detector Extension

A Chrome extension that **automatically** detects misinformation, media bias, and clickbait while you read the news — powered by Groq (Llama 3.3 70B).

---

## How It Works

1. You open any supported news website (40+ sites pre-configured)
2. TruthLens **auto-activates** — no button to press
3. It extracts the article text from the page
4. Sends it to the backend for AI analysis (one Groq API call)
5. A floating widget appears with:
   - **Verdict**: REAL / FAKE / UNCERTAIN / SATIRE
   - **Credibility gauge** (0–100%)
   - **Bias meter** (Left ← → Right)
   - **Emotional language score**
   - **Clickbait score**
   - **Red flags** & positive signals
   - **Highlight suspicious sentences** directly in the article

---

## Features

| Feature | Description |
|---|---|
| Auto-activation | Runs silently on 40+ news sites — no clicks needed |
| One API call | Everything (verdict + bias + emotional score + suspicious sentences) in a single Groq call |
| URL caching | Same article won't be re-analyzed for 15 minutes |
| Sentence highlighting | Click to highlight the most suspicious claims in the article text |
| Bias compass | Detects left/center/right leaning with strength percentage |
| Clickbait detector | Scores the headline from 0–100 |
| Popup stats | Track how many fake vs real articles you've read |
| Fallback chain | If Groq is unavailable, falls back to Gemini → HuggingFace → Local NLP |
| Badge indicator | Toolbar icon shows ✓ / ✗ / ? for current page |

---

## Quick Setup

### Step 1 — Generate icons (one-time)

1. Open `extension/icons/generate.html` in Chrome
2. Click the three download buttons
3. Save `icon16.png`, `icon48.png`, `icon128.png` into `extension/icons/`

### Step 2 — Start the backend

```bash
cd server
npm install
npm run dev
```
The server runs on `http://localhost:5000`.

### Step 3 — Load the extension

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder

### Step 4 — Test it

Visit [The Guardian](https://www.theguardian.com) or any article on a supported site.  
The TruthLens widget will appear in the **bottom-right corner** after ~2 seconds.

---

## Configuration

### Change server URL

Edit `extension/config.js`:
```js
const TL_CONFIG = {
  SERVER_URL: 'http://localhost:5000',  // ← change this for production
  EXTENSION_API_KEY: 'tl-extension-dev-key',
  ...
};
```

### Change the API key

Must match in **both** places:

- `extension/config.js` → `EXTENSION_API_KEY`
- `server/.env` → `EXTENSION_API_KEY`

### Add more news sites

Edit the `"matches"` array in `extension/manifest.json` and reload the extension.

---

## Supported Sites (pre-configured)

The Guardian · BBC · CNN · Fox News · NYT · Washington Post · Reuters · AP News  
NBC News · ABC News · CBS News · USA Today · HuffPost · BuzzFeed News  
Daily Mail · The Atlantic · Politico · Breitbart · NDTV · Times of India  
Hindustan Times · India Today · The Hindu · Al Jazeera · Vice · Vox  
Axios · The Verge · TechCrunch · Wired · Newsweek · Time · The Independent  
The Telegraph · Mirror · RT · Sputnik News + more

---

## Project Structure

```
extension/
├── manifest.json          # Extension config (Manifest V3)
├── config.js              # Server URL + API key
├── background.js          # Service worker (badge, storage)
├── content.js             # Auto-runs on news sites, renders overlay
├── popup.html             # Toolbar popup with stats + history
├── popup.js
├── styles/
│   ├── content.css        # Floating widget styles (glassmorphism)
│   └── popup.css          # Popup styles
├── utils/
│   └── textExtractor.js   # Smart article body extraction
└── icons/
    ├── generate.html      # Run once to generate PNG icons
    ├── icon16.png         # (generated)
    ├── icon48.png         # (generated)
    └── icon128.png        # (generated)
```

---

## Server API

The extension uses a dedicated endpoint on the existing backend:

```
POST /api/extension/analyze
Headers: X-Extension-Key: <EXTENSION_API_KEY>
Body: { url, title, content, domain }
```

Response includes: `verdict`, `confidence`, `credibilityScore`, `reasoning`,  
`bias`, `biasStrength`, `emotionalLanguageScore`, `clickbaitScore`,  
`suspiciousSentences`, `redFlags`, `positiveSignals`

---

## Hackathon Highlights

- **Zero friction** — activates automatically, users just browse normally  
- **Single Groq call** — comprehensive analysis in one LLM request for speed  
- **Sentence-level proof** — highlights exact suspicious text *in the article*  
- **Multi-dimensional analysis** — not just fake/real, but bias + emotion + clickbait  
- **Beautiful UI** — dark glassmorphism, animated credibility gauge, smooth transitions  
- **Production-ready fallback chain** — works even without Groq (Gemini → HuggingFace → local)
