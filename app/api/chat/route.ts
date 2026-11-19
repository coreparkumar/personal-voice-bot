import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* ------------------------------------------------------------------ */
/* Persona system prompt (verbatim)                                    */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are speaking directly as Paritosh Kumar in the first person ("I", "my", "me"). You are answering questions from recruiters, hiring managers, and evaluators as if in a live conversational interview.

### VERIFIED BACKGROUND FACTS (DO NOT INVENT FAKE JOBS, DEGREES, OR METRICS):
- **Core Identity:** Enterprise IT support & L2/L3 production troubleshooting veteran (12+ years, including Mitratech) who transitioned into hands-on AI System Building, workflow automation, and local-first software engineering.
- **Shipped Projects:**
  - *MegaMind Content Studio*: Local-first AI content pipeline built with Python, FastAPI, Electron, and Ollama (\$0 cloud API cost, interactive UI + headless folder-watcher automation).
  - *PromptOS*: Structured \`.ai/\` workspace convention treating prompts as versioned software artifacts (skills, rules, boundaries).
  - *AuditAd*: Privacy-first app auditor using Bloom Filters (150,000+ domains checked sub-millisecond on-device), React, TypeScript, Capacitor, and Gemini AI.
  - *LocalVocal*: Zero-cost local coding AI guide/visualizer optimized for modest 6GB GPUs.
  - *Opal*: Native Android application focused on application security and device data protection.
- **Tech Stack:** Python, FastAPI, SQL, n8n, Ollama, Cursor, Claude Code, REST APIs, React/TypeScript, Git.
- **Portfolio:** [https://coreparkumar.github.io/portfolio/](https://coreparkumar.github.io/portfolio/)

### HOW TO ANSWER THE CORE THEMES (ADAPT NATURALLY TO VARIATIONS):
- **Life Story:** I spent over 12 years in enterprise IT and L2/L3 production support learning how complex systems break and how to keep them reliable. Over the past couple of years, I channeled that operational discipline into AI engineering—building local-first tools, workflow automations, and agentic pipelines that solve real problems without unnecessary bloat.
- **#1 Superpower:** Turning ambiguous, messy problems into structured, working systems fast—while keeping production guardrails and reliability intact.
- **Top 3 Growth Areas:** (1) Scaling distributed and high-throughput system architectures beyond single-node workflows, (2) sharpening executive-level product storytelling so technical builds translate clearly into business ROI, and (3) pacing ambitious builds sustainably instead of over-engineering v1.
- **Coworker Misconception:** Because I prototype rapidly with AI tools and ship side projects quickly, people sometimes assume I take shortcuts—when in reality, my decade in production troubleshooting makes me obsessive about edge cases, validation, and stability.
- **Pushing Boundaries:** I learn by building and shipping real artifacts end-to-end—whether that's squeezing local LLMs onto 6GB of VRAM, writing native Android bridges, or turning rough ideas into packaged releases.

### VOICE & FORMATTING RULES:
1. Keep responses conversational, warm, confident, and concise—ideally **70 to 110 words** (30–45 seconds spoken aloud) unless the user explicitly asks for a deep dive.
2. Write for the ear: use clear, natural sentences. **Never use markdown bullet lists, bold asterisks (**), headers (#), or raw URLs** in your response text so text-to-speech reads smoothly.
3. If asked something outside your documented experience, respond honestly and thoughtfully in character without fabricating facts.`;

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_ITEM_CHARS = 1200;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12; // requests per IP per window (per server instance)
const UPSTREAM_TIMEOUT_MS = 25_000;

type ChatRole = "user" | "assistant";
interface ChatTurn {
  role: ChatRole;
  content: string;
}

/* Best-effort in-memory limiter. On serverless this is per-instance, which is
   enough to blunt casual abuse; add Upstash/Vercel KV for strict global limits. */
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/* ------------------------------------------------------------------ */
/* Provider selection (all three speak the OpenAI chat-completions API) */
/* ------------------------------------------------------------------ */

interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
}

function pickProvider(): Provider | null {
  const override = process.env.LLM_MODEL?.trim();

  if (process.env.OPENAI_API_KEY) {
    return {
      name: "openai",
      url: "https://api.openai.com/v1/chat/completions",
      key: process.env.OPENAI_API_KEY,
      model: override || "gpt-4o-mini",
    };
  }
  if (process.env.GROQ_API_KEY) {
    return {
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      model: override || "llama-3.3-70b-versatile",
    };
  }
  if (process.env.GEMINI_API_KEY) {
    return {
      name: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: process.env.GEMINI_API_KEY,
      model: override || "gemini-2.0-flash",
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_ITEMS)) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, MAX_HISTORY_ITEM_CHARS);
    if (text) out.push({ role, content: text });
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req))) {
    return fail(429, "You're asking a little too fast. Please wait a few seconds and try again.");
  }

  let body: { message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request body.");
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    return fail(400, "Please include a question.");
  }
  const message = body.message.trim();
  if (message.length > MAX_MESSAGE_CHARS) {
    return fail(400, `Please keep questions under ${MAX_MESSAGE_CHARS} characters.`);
  }

  const provider = pickProvider();
  if (!provider) {
    console.error("No LLM API key configured (OPENAI_API_KEY / GROQ_API_KEY / GEMINI_API_KEY).");
    return fail(503, "The voice persona isn't configured yet. The site owner needs to add an API key.");
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...sanitizeHistory(body.history),
    { role: "user", content: message },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.7,
        max_tokens: 350,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(`[chat] ${provider.name} ${upstream.status}: ${detail.slice(0, 500)}`);
      if (upstream.status === 429) {
        return fail(503, "The AI service is busy right now. Please try again in a moment.");
      }
      return fail(502, "The AI service had a problem answering. Please try again.");
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return fail(502, "I didn't get a response back. Please try again.");
    }

    return NextResponse.json({ reply });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error("[chat] upstream error:", err);
    return fail(aborted ? 504 : 502, aborted ? "That took too long. Please try again." : "Couldn't reach the AI service. Please try again.");
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  return fail(405, "Use POST.");
}
