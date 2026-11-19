"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Constants & types                                                   */
/* ------------------------------------------------------------------ */

const PORTFOLIO_URL = "https://coreparkumar.github.io/portfolio/";
const MAX_INPUT_CHARS = 500;

const SAMPLE_QUESTIONS = [
  "What should we know about your life story in a few sentences?",
  "What’s your #1 superpower?",
  "What are the top 3 areas you’d like to grow in?",
  "What misconception do your coworkers have about you?",
  "How do you push your boundaries and limits?",
];

type Status = "idle" | "listening" | "thinking" | "speaking";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

/* Minimal Web Speech API typings (not in lib.dom for all TS versions) */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [index: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [index: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SRInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRConstructor = new () => SRInstance;

function getSpeechRecognition(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ------------------------------------------------------------------ */
/* Speech helpers                                                      */
/* ------------------------------------------------------------------ */

/** Remove markdown / URLs so text-to-speech reads naturally. */
function stripForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*#`~|]+/g, "")
    .replace(/(^|\s)_+|_+(\s|$)/g, " ")
    .replace(/\bL(\d)\s*\/\s*L(\d)\b/g, "L$1 and L$2")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into sentence-sized chunks; long utterances get cut off by Chrome. */
function chunkText(text: string, maxLen = 200): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current && (current + s).length > maxLen) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const english = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (!english.length) return null;
  const prefs = [
    /google uk english male/i,
    /microsoft (guy|ryan|davis|prabhat).*online/i,
    /daniel/i,
    /google us english/i,
    /natural/i,
    /alex/i,
    /samantha/i,
  ];
  for (const re of prefs) {
    const hit = english.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return english.find((v) => v.default) ?? english[0];
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

type IconProps = { className?: string };

const MicIcon = ({ className = "h-5 w-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
  </svg>
);
const StopSquareIcon = ({ className = "h-5 w-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const SendIcon = ({ className = "h-5 w-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);
const VolumeIcon = ({ className = "h-5 w-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);
const VolumeOffIcon = ({ className = "h-5 w-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="m22 9-6 6M16 9l6 6" />
  </svg>
);
const ReplayIcon = ({ className = "h-4 w-4" }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
const ExternalIcon = ({ className = "h-3.5 w-3.5" }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Visual components                                                   */
/* ------------------------------------------------------------------ */

function Waveform({ active, className = "" }: { active: boolean; className?: string }) {
  const delays = [0, 0.15, 0.3, 0.1, 0.25, 0.05, 0.2];
  return (
    <div className={`flex h-6 items-center gap-[3px] ${className}`} aria-hidden="true">
      {delays.map((d, i) => (
        <span
          key={i}
          className={`block h-full w-[3px] origin-center rounded-full bg-current ${active ? "animate-wave" : ""}`}
          style={{
            animationDelay: `${d}s`,
            transform: active ? undefined : "scaleY(0.25)",
          }}
        />
      ))}
    </div>
  );
}

const STATUS_COPY: Record<Status, { label: string; hint: string }> = {
  idle: { label: "Ready", hint: "Pick a question, tap the mic, or type below" },
  listening: { label: "Listening…", hint: "Speak now — I'll answer when you pause" },
  thinking: { label: "Thinking…", hint: "Putting my answer together" },
  speaking: { label: "Speaking…", hint: "Tap stop any time" },
};

const ORB_STYLE: Record<Status, { gradient: string; glow: string; text: string }> = {
  idle: {
    gradient: "from-indigo-400 via-violet-500 to-fuchsia-500",
    glow: "0 0 60px 8px rgba(129,140,248,0.35)",
    text: "text-indigo-300",
  },
  listening: {
    gradient: "from-emerald-300 via-emerald-500 to-teal-600",
    glow: "0 0 70px 14px rgba(16,185,129,0.45)",
    text: "text-emerald-300",
  },
  thinking: {
    gradient: "from-amber-300 via-orange-400 to-rose-500",
    glow: "0 0 60px 10px rgba(251,146,60,0.4)",
    text: "text-amber-300",
  },
  speaking: {
    gradient: "from-sky-300 via-indigo-500 to-violet-600",
    glow: "0 0 80px 16px rgba(99,102,241,0.5)",
    text: "text-sky-300",
  },
};

function Orb({ status, compact }: { status: Status; compact: boolean }) {
  const s = ORB_STYLE[status];
  const size = compact ? "h-20 w-20 sm:h-32 sm:w-32" : "h-28 w-28 sm:h-40 sm:w-40";
  const ripples = status === "listening" || status === "speaking";

  return (
    <div className={`relative transition-all duration-500 ${size}`}>
      {ripples && (
        <>
          <span className={`absolute inset-0 rounded-full border border-current ${s.text} animate-ripple`} />
          <span
            className={`absolute inset-0 rounded-full border border-current ${s.text} animate-ripple`}
            style={{ animationDelay: "0.9s" }}
          />
        </>
      )}
      {status === "thinking" && (
        <span
          className="absolute -inset-2 animate-spinSlow rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(251,146,60,0.9) 90deg, transparent 180deg)",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          }}
        />
      )}
      <div
        className={`absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br ${s.gradient} transition-[box-shadow,background] duration-500 ${
          status === "idle" ? "animate-breathe" : ""
        }`}
        style={{ boxShadow: s.glow }}
      >
        <div className="absolute inset-[3px] rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.35),transparent_55%)]" />
        <div className="relative text-white/95">
          {status === "listening" && <MicIcon className="h-8 w-8 sm:h-10 sm:w-10" />}
          {status === "speaking" && <Waveform active className="h-8 gap-1 sm:h-10" />}
          {status === "thinking" && (
            <div className="flex gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 animate-breathe rounded-full bg-white"
                  style={{ animationDelay: `${i * 0.25}s`, animationDuration: "1s" }}
                />
              ))}
            </div>
          )}
          {status === "idle" && <span className="select-none text-xl font-semibold tracking-tight sm:text-3xl">PK</span>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sttSupported, setSttSupported] = useState<boolean | null>(null);
  const [ttsSupported, setTtsSupported] = useState<boolean | null>(null);

  const messagesRef = useRef<Msg[]>([]);
  const loadingRef = useRef(false);
  const mutedRef = useRef(false);
  const recRef = useRef<SRInstance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speechTokenRef = useRef(0);
  const idRef = useRef(0);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const nextId = () => `m${++idRef.current}`;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* Feature detection + voice loading */
  useEffect(() => {
    setSttSupported(getSpeechRecognition() !== null);
    const hasTts = typeof window !== "undefined" && "speechSynthesis" in window;
    setTtsSupported(hasTts);
    if (!hasTts) return;

    const synth = window.speechSynthesis;
    const loadVoices = () => {
      voiceRef.current = pickVoice(synth);
    };
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);

    return () => {
      synth.removeEventListener?.("voiceschanged", loadVoices);
      speechTokenRef.current++;
      synth.cancel();
      recRef.current?.abort();
    };
  }, []);

  /* Keep newest message in view */
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  /* ---------------- Text-to-speech ---------------- */

  const stopSpeaking = useCallback(() => {
    speechTokenRef.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId(null);
  }, []);

  const speak = useCallback((text: string, id: string, force = false) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;

    synth.cancel();
    const token = ++speechTokenRef.current;

    if (mutedRef.current && !force) {
      setSpeakingId(null);
      return;
    }

    const chunks = chunkText(stripForSpeech(text));
    if (!chunks.length) {
      setSpeakingId(null);
      return;
    }

    const voice = voiceRef.current ?? pickVoice(synth);
    voiceRef.current = voice;
    setSpeakingId(id);

    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-US";
      }
      u.rate = 1;
      u.pitch = 1;
      const isLast = i === chunks.length - 1;
      u.onend = () => {
        if (isLast && token === speechTokenRef.current) setSpeakingId(null);
      };
      u.onerror = (ev) => {
        if (token !== speechTokenRef.current) return;
        setSpeakingId(null);
        if (ev.error === "not-allowed") {
          setNotice("Your browser blocked audio playback. Tap Replay on the answer to hear it.");
        }
      };
      synth.speak(u);
    });
  }, []);

  /** Unlock audio on iOS/Safari by speaking silence inside a user gesture. */
  const primeSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (mutedRef.current) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) stopSpeaking();
  };

  /* ---------------- Chat ---------------- */

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_INPUT_CHARS);
      if (!text || loadingRef.current) return;

      primeSpeech();
      stopSpeaking();
      setNotice(null);

      const history = messagesRef.current
        .filter((m) => !m.error)
        .slice(-8)
        .map(({ role, content }) => ({ role, content }));

      setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
      loadingRef.current = true;
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history }),
        });
        const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
        if (!res.ok || !data.reply) {
          throw new Error(data.error || "Something went wrong. Please try again.");
        }
        const botMsg: Msg = { id: nextId(), role: "assistant", content: data.reply };
        setMessages((prev) => [...prev, botMsg]);
        speak(data.reply, botMsg.id);
      } catch (e) {
        const message =
          e instanceof TypeError
            ? "I couldn't reach the server. Check your connection and try again."
            : e instanceof Error
              ? e.message
              : "Something went wrong. Please try again.";
        setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content: message, error: true }]);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [primeSpeech, speak, stopSpeaking],
  );

  /* ---------------- Speech-to-text ---------------- */

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setNotice("Voice input isn't supported in this browser. Try Chrome, Edge or Safari — or use the sample questions or type below.");
      return;
    }
    if (loadingRef.current) return;

    stopSpeaking();
    primeSpeech();
    setNotice(null);

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = "";
    let errorCode: string | null = null;

    rec.onstart = () => {
      setListening(true);
      setInterim("");
    };

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim((finalText + interimText).trim());
    };

    rec.onerror = (e) => {
      errorCode = e.error;
      switch (e.error) {
        case "not-allowed":
        case "service-not-allowed":
          setNotice("Microphone access is blocked. Allow the mic in your browser's site settings, or use the sample questions or type instead.");
          break;
        case "no-speech":
          setNotice("I didn't hear anything. Tap the mic and try again.");
          break;
        case "audio-capture":
          setNotice("No microphone was found on this device. You can still use the sample questions or type.");
          break;
        case "network":
          setNotice("Voice recognition needs an internet connection. Try again, or type your question.");
          break;
        case "aborted":
          break;
        default:
          setNotice("Voice input hit a problem. Please try again or type your question.");
      }
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
      recRef.current = null;
      const text = finalText.trim();
      if (text) {
        void ask(text);
      } else if (!errorCode) {
        setNotice("I didn't catch that. Tap the mic and try again.");
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      setNotice("Couldn't start the microphone. Please try again.");
    }
  }, [ask, primeSpeech, stopSpeaking]);

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
    } else {
      startListening();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input;
    if (!text.trim() || loading) return;
    setInput("");
    void ask(text);
  };

  /* ---------------- Derived state ---------------- */

  const status: Status = listening ? "listening" : loading ? "thinking" : speakingId ? "speaking" : "idle";
  const copy = STATUS_COPY[status];
  const isSpeaking = speakingId !== null;
  const hasMessages = messages.length > 0;

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col px-4">
      {/* ---------- Header ---------- */}
      <header className="shrink-0 pb-2 pt-5 text-center sm:pt-8">
        <h1 className="text-lg font-semibold tracking-tight text-white sm:text-2xl">
          Paritosh Kumar <span className="text-zinc-500">—</span> Interactive AI Voice Persona
        </h1>
        <p className="mt-1 text-sm text-zinc-400 sm:text-base">
          Ask me anything about my journey, engineering philosophy, and AI builds
        </p>
        <a
          href={PORTFOLIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
        >
          View portfolio <ExternalIcon />
        </a>
      </header>

      {/* ---------- Center stage ---------- */}
      <section className="flex shrink-0 flex-col items-center py-3 sm:py-5" aria-live="polite">
        <Orb status={status} compact={hasMessages} />
        <div className="mt-3 text-center sm:mt-4">
          <p className={`text-sm font-medium ${ORB_STYLE[status].text}`}>{copy.label}</p>
          <p className="mt-0.5 min-h-[1.25rem] max-w-md px-4 text-xs text-zinc-500">
            {status === "listening" && interim ? (
              <span className="italic text-zinc-300">“{interim}”</span>
            ) : (
              copy.hint
            )}
          </p>
        </div>
      </section>

      {/* ---------- Conversation feed ---------- */}
      <main className="feed min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pr-1" aria-label="Conversation">
        {!hasMessages && (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-sm text-center text-sm text-zinc-500">
              Hi, I’m Paritosh. Tap one of the questions below, hold a conversation with the mic, or type your own.
            </p>
          </div>
        )}

        <ul className="space-y-4">
          {messages.map((m) => {
            const isUser = m.role === "user";
            const playingThis = speakingId === m.id;
            return (
              <li key={m.id} className={`flex animate-fadeUp ${isUser ? "justify-end" : "justify-start"}`}>
                {!isUser && (
                  <div
                    className={`mr-2.5 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                      m.error ? "bg-red-500/20 text-red-300" : "bg-gradient-to-br from-indigo-400 to-violet-600 text-white"
                    }`}
                    aria-hidden="true"
                  >
                    {m.error ? "!" : "PK"}
                  </div>
                )}
                <div className={`max-w-[85%] ${isUser ? "" : "min-w-0"}`}>
                  <div
                    className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                      isUser
                        ? "rounded-br-md bg-indigo-500/90 text-white"
                        : m.error
                          ? "rounded-bl-md border border-red-500/30 bg-red-500/10 text-red-200"
                          : "rounded-bl-md border border-white/10 bg-white/[0.04] text-zinc-100"
                    }`}
                  >
                    {m.content}
                  </div>
                  {!isUser && !m.error && ttsSupported && (
                    <div className="mt-1.5 flex items-center gap-2 pl-1">
                      <button
                        type="button"
                        onClick={() => (playingThis ? stopSpeaking() : speak(m.content, m.id, true))}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-white/25 hover:text-white"
                        aria-label={playingThis ? "Stop audio" : "Replay audio"}
                      >
                        {playingThis ? (
                          <>
                            <Waveform active className="h-3 text-sky-300" /> Stop
                          </>
                        ) : (
                          <>
                            <ReplayIcon /> Replay
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}

          {loading && (
            <li className="flex animate-fadeUp justify-start" aria-label="Paritosh is thinking">
              <div className="mr-2.5 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-[10px] font-semibold text-white">
                PK
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-4 py-3.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-breathe rounded-full bg-zinc-400"
                    style={{ animationDelay: `${i * 0.2}s`, animationDuration: "1s" }}
                  />
                ))}
              </div>
            </li>
          )}
        </ul>
        <div ref={feedEndRef} />
      </main>

      {/* ---------- Docked controls ---------- */}
      <footer className="shrink-0 border-t border-white/10 bg-[#08090b]/80 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {notice && (
          <div
            role="alert"
            className="mb-2.5 flex items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-amber-300/80 hover:text-amber-100"
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        )}

        {/* Sample question chips */}
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={loading || listening}
              onClick={() => void ask(q)}
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-left text-xs text-zinc-300 transition hover:border-indigo-400/50 hover:bg-indigo-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:text-[13px]"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input row */}
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMic}
            disabled={loading}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Start voice input"}
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
              listening
                ? "bg-emerald-500 shadow-[0_0_24px_4px_rgba(16,185,129,0.5)]"
                : "bg-indigo-500 hover:bg-indigo-400"
            }`}
          >
            {listening && <span className="absolute inset-0 animate-ripple rounded-full border-2 border-emerald-300" />}
            {listening ? <StopSquareIcon className="h-4 w-4" /> : <MicIcon />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_INPUT_CHARS}
            placeholder={listening ? "Listening…" : "Type a question or follow-up…"}
            disabled={listening}
            enterKeyHint="send"
            autoComplete="off"
            className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 text-[15px] text-white placeholder-zinc-500 outline-none transition focus:border-indigo-400/60 focus:bg-white/[0.06] disabled:opacity-50"
            aria-label="Type your question"
          />

          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Send question"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
          >
            <SendIcon />
          </button>
        </form>

        {/* Audio controls */}
        <div className="mt-2.5 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              disabled={ttsSupported === false}
              aria-pressed={muted}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                muted
                  ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                  : "border-white/10 text-zinc-300 hover:border-white/25 hover:text-white"
              }`}
            >
              {muted ? <VolumeOffIcon className="h-4 w-4" /> : <VolumeIcon className="h-4 w-4" />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={stopSpeaking}
              disabled={!isSpeaking}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-zinc-300 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <StopSquareIcon className="h-3.5 w-3.5" /> Stop speaking
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Waveform active={isSpeaking} className={`h-4 ${isSpeaking ? "text-sky-300" : "text-zinc-600"}`} />
            <span className="hidden sm:inline">
              {ttsSupported === false
                ? "Audio replies unavailable in this browser"
                : sttSupported === false
                  ? "Voice input not supported here"
                  : muted
                    ? "Voice replies muted"
                    : "Voice replies on"}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
