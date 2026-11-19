# Paritosh Kumar — Interactive AI Voice Persona

Single-page Next.js 15 (App Router) + Tailwind CSS app. Visitors can ask questions by voice, text, or one-click chips, and hear the answers spoken aloud. No login, no API key input on the client.

## Deploy to Vercel

1. Push this folder to a GitHub repo (or run `npx vercel` from this folder).
2. In **Project Settings → Environment Variables**, add one key:
   - `OPENAI_API_KEY` (default, model `gpt-4o-mini`), **or**
   - `GROQ_API_KEY` (model `llama-3.3-70b-versatile`), **or**
   - `GEMINI_API_KEY` (model `gemini-2.0-flash`)
   Priority if several are set: OpenAI, then Groq, then Gemini.
3. Optional: set `LLM_MODEL` to override the model name for the active provider.
4. Redeploy. The key stays server-side in `app/api/chat/route.ts`.

## Run locally

```bash
npm install
cp .env.example .env.local   # then add your key
npm run dev
```

Open http://localhost:3000. Voice input needs HTTPS or localhost.

## How it works

- `app/api/chat/route.ts` — POST `/api/chat` with `{ message, history? }`. Validates input (500-char message cap, last 8 history turns), applies a per-IP in-memory rate limit (12 requests/minute per server instance), prepends the persona system prompt, and calls the provider's OpenAI-compatible chat endpoint.
- `app/page.tsx` — UI: status orb (idle / listening / thinking / speaking), conversation feed, sample chips, mic (Web Speech API), text input, mute / stop / replay controls. Markdown and URLs are stripped before text goes to `speechSynthesis`.

## Browser support

- Speech output: all modern browsers.
- Speech input: Chrome, Edge and Safari. Firefox lacks `SpeechRecognition`; the app shows a message and the chips and text box still work.

## Notes

- The in-memory rate limiter is per serverless instance. For strict global limits, swap in Upstash Redis / Vercel KV.
- To change the persona, edit `SYSTEM_PROMPT` in `app/api/chat/route.ts`.
