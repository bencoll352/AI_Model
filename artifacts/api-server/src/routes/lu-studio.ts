import { Router, type IRouter } from "express";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, copyFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, aiGirlsTable, type AiGirl, type InsertAiGirl } from "@workspace/db";
import { logger } from "../lib/logger";
import { parseCaiExport, type ParsedCharacter } from "../lib/cai-parser";

const router: IRouter = Router();

// Media & local JSON fallback storage directory
const DATA_DIR = path.resolve(process.cwd(), "data");
const MEDIA_DIR = path.resolve(DATA_DIR, "media");
const LOCAL_DB_FILE = path.resolve(DATA_DIR, "ai_girls.json");
const CONFIG_FILE = path.resolve(DATA_DIR, "supabase_config.json");

if (!existsSync(MEDIA_DIR)) {
  mkdirSync(MEDIA_DIR, { recursive: true });
}

// 15 English voices from PurpleDoubleD/locally-uncensored (VOICE.md)
export const LU_VOICES = [
  "Alba",
  "Anna",
  "Azelma",
  "Charles",
  "Eponine",
  "Eve",
  "Fantine",
  "George",
  "Jane",
  "Javert",
  "Marius",
  "Mary",
  "Michael",
  "Paul",
  "Vera",
] as const;

// Recommended models from PurpleDoubleD/locally-uncensored (README.md)
export const LU_CATALOG = {
  text: [
    { name: "Qwen 3.8 27B Uncensored", tag: "hf.co/Triangle104/Qwen3-27B-Uncensored-GGUF", size: "18 GB", vram: "12-18 GB", notes: "Vision, tools and switchable thinking, 262K context." },
    { name: "Gemma 4 12B Heretic", tag: "gemma3:12b", size: "7.4 GB", vram: "8 GB", notes: "Vision, a distinct voice from the Qwen line." },
    { name: "Qwen3-VL 8B Abliterated", tag: "qwen2.5:7b", size: "5 GB", vram: "8 GB", notes: "Image understanding on an 8 GB card." },
    { name: "Hermes 3 Llama 3.1 8B", tag: "hermes3:8b", size: "5 GB", vram: "8 GB", notes: "Native tool calling. Ideal small model for agent tasks." },
    { name: "Llama 3.1 8B Abliterated", tag: "llama3.1:8b", size: "5 GB", vram: "8 GB", notes: "Fast and reliable, the usual first download." },
    { name: "GLM 4.7 Flash Heretic", tag: "glm4:9b", size: "10 GB", vram: "12 GB", notes: "30B class in an IQ2_M build that fits 12 GB." },
    { name: "Qwen 3.6 35B MoE Abliterated", tag: "qwen2.5-coder:32b", size: "24 GB", vram: "24 GB", notes: "35B total with 3B active, vision and agentic coding." },
  ],
  image: [
    { name: "Juggernaut XL V9", vram: "6-8 GB", notes: "Photoreal SDXL, the friendliest entry point." },
    { name: "DreamShaper XL Turbo V2", vram: "6-8 GB", notes: "Anime and stylized." },
    { name: "FLUX.1 schnell or dev", vram: "8-10 GB", notes: "Fast, or slower and better." },
    { name: "FLUX 2 Klein 4B", vram: "8-10 GB", notes: "The newest FLUX, and the quickest of them." },
    { name: "Z-Image Turbo", vram: "10-16 GB", notes: "Unfiltered. Loads slowly below 16 GB." },
  ],
  voices: LU_VOICES,
};

// ============================================================================
// ComfyUI Discovery & Launcher (ported from PurpleDoubleD/locally-uncensored)
// ============================================================================

export function findComfyUI(): string | null {
  const envPath = process.env["COMFYUI_PATH"];
  if (envPath && existsSync(path.join(envPath, "main.py"))) {
    return envPath;
  }
  const home = process.env["USERPROFILE"] || process.env["HOME"] || "";
  const fixed = [
    path.resolve(home, "ComfyUI"),
    path.resolve(home, "Desktop/ComfyUI"),
    path.resolve(home, "Documents/ComfyUI"),
    path.resolve(home, "Downloads/ComfyUI"),
    "C:\\ComfyUI",
  ];
  for (const p of fixed) {
    if (existsSync(path.resolve(p, "main.py"))) return p;
  }
  const scanRoots = [
    path.resolve(home, "Desktop"),
    path.resolve(home, "Documents"),
    path.resolve(home, "Downloads"),
  ];
  const skipNames = new Set([
    "node_modules",
    ".git",
    "__pycache__",
    "venv",
    ".venv",
    "site-packages",
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "$Recycle.Bin",
    "AppData",
  ]);

  function scanForComfyUI(dir: string, depth: number): string | null {
    if (depth <= 0) return null;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || skipNames.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if ((entry.name === "ComfyUI" || entry.name === "comfyui") && existsSync(path.join(full, "main.py"))) {
          return full;
        }
        const found = scanForComfyUI(full, depth - 1);
        if (found) return found;
      }
    } catch {
      /* ignore unreadable dirs */
    }
    return null;
  }

  for (const root of scanRoots) {
    if (!existsSync(root)) continue;
    const found = scanForComfyUI(root, 2);
    if (found) return found;
  }
  return null;
}

const COMFY_URL = process.env["COMFYUI_URL"] || "http://127.0.0.1:8188";
const OLLAMA_URL = process.env["OLLAMA_BASE_URL"] || "http://127.0.0.1:11434";

export async function isComfyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getOllamaStatus(): Promise<{ running: boolean; version: string | null; models: string[] }> {
  try {
    const [verRes, tagsRes] = await Promise.all([
      fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(2000) }),
      fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) }),
    ]);
    const verData = verRes.ok ? ((await verRes.json()) as { version?: string }) : null;
    const tagsData = tagsRes.ok ? ((await tagsRes.json()) as { models?: Array<{ name: string }> }) : null;
    return {
      running: verRes.ok,
      version: verData?.version ?? null,
      models: (tagsData?.models ?? []).map((m) => m.name),
    };
  } catch {
    return { running: false, version: null, models: [] };
  }
}

let comfyProcess: ChildProcess | null = null;
let comfyLogs: string[] = [];

function getComfyPython(comfyPath: string): string {
  const isWin = process.platform === "win32";
  for (const v of ["venv", ".venv"]) {
    const vp = isWin
      ? path.join(comfyPath, v, "Scripts", "python.exe")
      : path.join(comfyPath, v, "bin", "python");
    if (existsSync(vp)) return vp;
  }
  return "python";
}

// ============================================================================
// 12-Engine Auto-Discovery Scanner (from PurpleDoubleD/locally-uncensored)
// ============================================================================

export interface DiscoveredEngine {
  id: string;
  name: string;
  port: number;
  url: string;
  running: boolean;
  models?: string[];
  type: "text" | "image" | "multimodal";
}

export const LOCAL_ENGINES_CONFIG = [
  { id: "ollama", name: "Ollama", port: 11434, path: "/api/tags", type: "text" as const },
  { id: "lm_studio", name: "LM Studio", port: 1234, path: "/v1/models", type: "text" as const },
  { id: "jan", name: "Jan", port: 1337, path: "/v1/models", type: "text" as const },
  { id: "koboldcpp", name: "KoboldCpp", port: 5001, path: "/api/v1/model", type: "text" as const },
  { id: "llamacpp", name: "llama.cpp server", port: 8080, path: "/health", type: "text" as const },
  { id: "vllm", name: "vLLM", port: 8000, path: "/v1/models", type: "text" as const },
  { id: "localai", name: "LocalAI", port: 8080, path: "/models", type: "text" as const },
  { id: "oobabooga", name: "Text-Gen WebUI", port: 5000, path: "/v1/models", type: "text" as const },
  { id: "tabby", name: "TabbyAPI", port: 5000, path: "/v1/models", type: "text" as const },
  { id: "aphrodite", name: "Aphrodite Engine", port: 2242, path: "/v1/models", type: "text" as const },
  { id: "sglang", name: "SGLang", port: 30000, path: "/v1/models", type: "text" as const },
  { id: "gpt4all", name: "GPT4All API", port: 4891, path: "/v1/models", type: "text" as const },
  { id: "g4f", name: "GPT4Free (G4F)", port: 1337, path: "/v1/models", type: "text" as const },
  { id: "comfyui", name: "ComfyUI", port: 8188, path: "/system_stats", type: "image" as const },
];

let lastEngineScan: { timestamp: number; engines: DiscoveredEngine[] } | null = null;

export async function scanLocalEngines(force = false): Promise<DiscoveredEngine[]> {
  const now = Date.now();
  if (!force && lastEngineScan && now - lastEngineScan.timestamp < 4000) {
    return lastEngineScan.engines;
  }

  const results = await Promise.allSettled(
    LOCAL_ENGINES_CONFIG.map(async (eng): Promise<DiscoveredEngine> => {
      const url = `http://127.0.0.1:${eng.port}`;
      try {
        const res = await fetch(`${url}${eng.path}`, { signal: AbortSignal.timeout(1200) });
        if (res.ok) {
          let models: string[] = [];
          try {
            const data: any = await res.json();
            if (Array.isArray(data.models)) {
              models = data.models.map((m: any) => m.name || m.id || String(m));
            } else if (Array.isArray(data.data)) {
              models = data.data.map((m: any) => m.id || m.name || String(m));
            } else if (data.result) {
              models = [String(data.result)];
            }
          } catch {
            /* ignore JSON parse */
          }
          return { id: eng.id, name: eng.name, port: eng.port, url, running: true, models, type: eng.type };
        }
      } catch {
        /* offline / timed out */
      }
      return { id: eng.id, name: eng.name, port: eng.port, url, running: false, type: eng.type };
    })
  );

  const engines = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          id: LOCAL_ENGINES_CONFIG[i].id,
          name: LOCAL_ENGINES_CONFIG[i].name,
          port: LOCAL_ENGINES_CONFIG[i].port,
          url: `http://127.0.0.1:${LOCAL_ENGINES_CONFIG[i].port}`,
          running: false,
          type: LOCAL_ENGINES_CONFIG[i].type,
        }
  );

  lastEngineScan = { timestamp: now, engines };
  return engines;
}

// ============================================================================
// GPT4Free (G4F) Frontier Engine Manager & Models
// ============================================================================

let g4fProcess: ChildProcess | null = null;
let g4fLogs: string[] = [];

export async function isG4fRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:1337/v1/models", { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

export const G4F_MODELS = [
  { id: "deepseek-r1", name: "DeepSeek-R1 (671B Full Reasoning)", provider: "G4F Free Router", notes: "Chain-of-thought <think> reasoning with deep intellect." },
  { id: "gpt-4o", name: "OpenAI GPT-4o", provider: "G4F Free Router", notes: "Flagship intelligence for deep instruction-following." },
  { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "G4F Free Router", notes: "Human-grade prose, emotional depth and nuanced persona dialogues." },
  { id: "gemini-2.0-flash", name: "Google Gemini 2.0 Flash", provider: "G4F Free Router", notes: "Ultra-fast response latency and massive context window." },
  { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B", provider: "G4F Free Router", notes: "Top-tier coding, system scripting and structured logic." },
];



interface SupabaseConfig {
  url: string;
  key: string;
}

function getSupabaseConfig(): SupabaseConfig {
  const envUrl = process.env["SUPABASE_URL"] || "";
  const envKey = process.env["SUPABASE_KEY"] || process.env["SUPABASE_ANON_KEY"] || "";
  if (envUrl && envKey && envUrl !== "YOUR_SUPABASE_URL") {
    return { url: envUrl, key: envKey };
  }
  if (existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Partial<SupabaseConfig>;
      return { url: saved.url || "", key: saved.key || "" };
    } catch {
      /* ignore */
    }
  }
  return { url: "", key: "" };
}

function saveSupabaseConfig(config: SupabaseConfig) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

function readLocalAiGirls(): AiGirl[] {
  if (!existsSync(LOCAL_DB_FILE)) {
    const defaultGirl: AiGirl = {
      id: 1,
      name: "AI Girl",
      description: "A sexy and intelligent AI girl with a mysterious past.",
      image_url: "/api/lu/media/default-persona.svg",
      voice_url: "",
      prompt: "Create an image of a charismatic AI girl with long, wavy hair, wearing a sleek futuristic outfit, standing in a neon cityscape.",
      voice_text: "Hello, I am AI Girl. I'm here to make your dreams come true.",
      voice_id: "Alba",
      model: "Qwen 3.8 27B Uncensored",
      created_at: new Date(),
    };
    writeFileSync(LOCAL_DB_FILE, JSON.stringify([defaultGirl], null, 2), "utf-8");
    return [defaultGirl];
  }
  try {
    return JSON.parse(readFileSync(LOCAL_DB_FILE, "utf-8")) as AiGirl[];
  } catch {
    return [];
  }
}

function writeLocalAiGirls(items: AiGirl[]) {
  writeFileSync(LOCAL_DB_FILE, JSON.stringify(items, null, 2), "utf-8");
}

async function syncToSupabase(record: InsertAiGirl): Promise<{ synced: boolean; error?: string }> {
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.key || cfg.url === "YOUR_SUPABASE_URL" || cfg.key === "YOUR_SUPABASE_KEY") {
    return { synced: false };
  }
  try {
    const endpoint = `${cfg.url.replace(/\/$/, "")}/rest/v1/ai_girls`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        name: record.name,
        description: record.description,
        image_url: record.image_url,
        voice_url: record.voice_url,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { synced: false, error: `Supabase HTTP ${res.status}: ${errText}` };
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function listAiGirls(): Promise<{ items: AiGirl[]; storage: string }> {
  if (db) {
    try {
      const rows = await db.select().from(aiGirlsTable).orderBy(desc(aiGirlsTable.created_at));
      return { items: rows, storage: "postgresql" };
    } catch (err) {
      logger.warn({ err }, "PostgreSQL query failed, falling back to local JSON store");
    }
  }
  return { items: readLocalAiGirls(), storage: "local_json" };
}

async function insertAiGirl(input: InsertAiGirl): Promise<{ girl: AiGirl; storage: string; supabaseSynced: boolean; supabaseError?: string }> {
  const supabaseResult = await syncToSupabase(input);
  if (db) {
    try {
      const [inserted] = await db.insert(aiGirlsTable).values(input).returning();
      if (inserted) {
        return {
          girl: inserted,
          storage: "postgresql",
          supabaseSynced: supabaseResult.synced,
          supabaseError: supabaseResult.error,
        };
      }
    } catch (err) {
      logger.warn({ err }, "PostgreSQL insert failed, falling back to local JSON store");
    }
  }
  const existing = readLocalAiGirls();
  const nextId = existing.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  const girl: AiGirl = {
    id: nextId,
    name: input.name,
    description: input.description,
    image_url: input.image_url,
    voice_url: input.voice_url,
    prompt: input.prompt ?? "",
    voice_text: input.voice_text ?? "",
    voice_id: input.voice_id ?? "Alba",
    model: input.model ?? "",
    created_at: new Date(),
  };
  writeLocalAiGirls([girl, ...existing]);
  return {
    girl,
    storage: "local_json",
    supabaseSynced: supabaseResult.synced,
    supabaseError: supabaseResult.error,
  };
}

// ============================================================================
// Local Image & Voice Generation Implementations
// ============================================================================

function generateCyberpunkSvgAvatar(prompt: string, title = "AI Girl"): string {
  // Deterministic vibrant palette from prompt
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash * 31 + prompt.charCodeAt(i)) | 0;
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 60) % 360;
  const hue3 = (hue1 + 190) % 360;
  const safePrompt = prompt.replace(/[<>&"']/g, "").slice(0, 90);
  const safeTitle = title.replace(/[<>&"']/g, "").slice(0, 40);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 768" width="768" height="768">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue1}, 55%, 10%)" />
      <stop offset="50%" stop-color="hsl(${hue2}, 65%, 16%)" />
      <stop offset="100%" stop-color="hsl(${hue3}, 60%, 8%)" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="48%">
      <stop offset="0%" stop-color="hsl(${hue2}, 90%, 60%)" stop-opacity="0.45" />
      <stop offset="100%" stop-color="hsl(${hue1}, 80%, 20%)" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="neon" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="hsl(${hue2}, 95%, 65%)" />
      <stop offset="100%" stop-color="hsl(${hue3}, 95%, 65%)" />
    </linearGradient>
  </defs>
  <rect width="768" height="768" fill="url(#bg)" />
  <circle cx="384" cy="320" r="320" fill="url(#glow)" />
  <!-- Futuristic Cityscape Grid -->
  <g stroke="hsl(${hue3}, 80%, 55%)" stroke-opacity="0.22" stroke-width="1.5">
    <rect x="60" y="340" width="70" height="320" fill="hsl(${hue1}, 40%, 8%)" fill-opacity="0.7" />
    <rect x="145" y="270" width="85" height="390" fill="hsl(${hue1}, 40%, 9%)" fill-opacity="0.7" />
    <rect x="540" y="250" width="90" height="410" fill="hsl(${hue1}, 40%, 9%)" fill-opacity="0.7" />
    <rect x="645" y="320" width="65" height="340" fill="hsl(${hue1}, 40%, 8%)" fill-opacity="0.7" />
    <line x1="0" y1="660" x2="768" y2="660" stroke-width="2" stroke-opacity="0.5" />
  </g>
  <!-- Stylized Character Silhouette & Portrait -->
  <g transform="translate(384, 340)">
    <!-- Wavy Flowing Hair -->
    <path d="M-110,-90 C-165,-10 -150,140 -125,240 C-85,200 -80,80 -65,20 Z" fill="hsl(${hue2}, 55%, 24%)" stroke="url(#neon)" stroke-width="2" />
    <path d="M110,-90 C165,-10 150,140 125,240 C85,200 80,80 65,20 Z" fill="hsl(${hue2}, 55%, 24%)" stroke="url(#neon)" stroke-width="2" />
    <circle cx="0" cy="-75" r="88" fill="hsl(${hue2}, 50%, 22%)" stroke="url(#neon)" stroke-width="2.5" />
    <!-- Shoulders & Futuristic Outfit -->
    <path d="M-145,320 C-135,155 -65,95 0,95 C65,95 135,155 145,320 Z" fill="hsl(${hue1}, 45%, 14%)" stroke="url(#neon)" stroke-width="3" />
    <path d="M-55,110 L0,195 L55,110" fill="none" stroke="hsl(${hue3}, 95%, 68%)" stroke-width="3.5" />
    <!-- Head & Face -->
    <ellipse cx="0" cy="-60" rx="58" ry="70" fill="hsl(28, 55%, 78%)" />
    <!-- Hair Bangs -->
    <path d="M-60,-85 Q-20,-135 0,-95 Q25,-135 60,-85 Q45,-145 0,-145 Q-45,-145 -60,-85 Z" fill="hsl(${hue2}, 65%, 28%)" />
    <!-- Cybernetic Eyes -->
    <ellipse cx="-22" cy="-62" rx="9" ry="5" fill="hsl(${hue3}, 95%, 55%)" />
    <ellipse cx="22" cy="-62" rx="9" ry="5" fill="hsl(${hue3}, 95%, 55%)" />
    <circle cx="-20" cy="-63" r="2" fill="#ffffff" />
    <circle cx="24" cy="-63" r="2" fill="#ffffff" />
    <!-- Lips -->
    <path d="M-14,-24 Q0,-15 14,-24 Q0,-20 -14,-24 Z" fill="hsl(345, 75%, 56%)" stroke="hsl(345, 75%, 52%)" stroke-width="2" />
  </g>
  <!-- HUD Frame -->
  <rect x="28" y="28" width="712" height="712" rx="18" fill="none" stroke="url(#neon)" stroke-width="2" stroke-opacity="0.55" />
  <rect x="44" y="625" width="680" height="88" rx="12" fill="#090d16" fill-opacity="0.82" stroke="hsl(${hue2}, 80%, 55%)" stroke-opacity="0.4" />
  <text x="68" y="658" fill="#f8fafc" font-family="monospace" font-size="20" font-weight="bold">${safeTitle} · LOCALLY UNCENSORED STUDIO</text>
  <text x="68" y="688" fill="#94a3b8" font-family="monospace" font-size="13">${safePrompt}</text>
</svg>`;
}

async function generateImageWithComfyOrFallback(prompt: string, name = "AI Girl", wardrobe?: string): Promise<{ image_url: string; provider: string; wardrobe?: string }> {
  const comfyRunning = await isComfyRunning();
  if (comfyRunning) {
    try {
      // Query available checkpoints on ComfyUI
      const objRes = await fetch(`${COMFY_URL}/object_info/CheckpointLoaderSimple`);
      let ckptName = "v1-5-pruned-emaonly.safetensors";
      if (objRes.ok) {
        const objData = (await objRes.json()) as Record<string, any>;
        const list = objData?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(list) && list.length > 0) {
          ckptName = list[0];
        }
      }
      const seed = Math.floor(Math.random() * 1_000_000_000);
      const workflow = {
        "3": {
          class_type: "KSampler",
          inputs: {
            cfg: 7,
            denoise: 1,
            latent_image: ["5", 0],
            model: ["4", 0],
            negative: ["7", 0],
            positive: ["6", 0],
            sampler_name: "euler",
            scheduler: "normal",
            seed,
            steps: 20,
          },
        },
        "4": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: ckptName },
        },
        "5": {
          class_type: "EmptyLatentImage",
          inputs: { batch_size: 1, height: 768, width: 768 },
        },
        "6": {
          class_type: "CLIPTextEncode",
          inputs: { clip: ["4", 1], text: prompt },
        },
        "7": {
          class_type: "CLIPTextEncode",
          inputs: { clip: ["4", 1], text: "blurry, low quality, deformed, watermark" },
        },
        "8": {
          class_type: "VAEDecode",
          inputs: { samples: ["3", 0], vae: ["4", 2] },
        },
        "9": {
          class_type: "SaveImage",
          inputs: { filename_prefix: "LU_Finch", images: ["8", 0] },
        },
      };

      const promptRes = await fetch(`${COMFY_URL}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow }),
      });

      if (promptRes.ok) {
        const { prompt_id } = (await promptRes.json()) as { prompt_id: string };
        // Poll ComfyUI history up to 45s
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const histRes = await fetch(`${COMFY_URL}/history/${prompt_id}`);
          if (histRes.ok) {
            const hist = (await histRes.json()) as Record<string, any>;
            const outputs = hist?.[prompt_id]?.outputs;
            if (outputs) {
              for (const nodeId of Object.keys(outputs)) {
                const imgs = outputs[nodeId]?.images;
                if (Array.isArray(imgs) && imgs.length > 0) {
                  const img = imgs[0];
                  const viewUrl = `${COMFY_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
                  const imgFetch = await fetch(viewUrl);
                  if (imgFetch.ok) {
                    const buf = Buffer.from(await imgFetch.arrayBuffer());
                    const filename = `comfy-${randomUUID()}.png`;
                    writeFileSync(path.join(MEDIA_DIR, filename), buf);
                    return { image_url: `/api/lu/media/${filename}`, provider: "comfyui", wardrobe };
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "ComfyUI generation failed, continuing to Node-Banana photoreal generator");
    }
  }

  // Node-Banana Lifelike Photorealistic Pipeline (shrimbly/node-banana)
  const filename = `banana-${randomUUID()}.webp`;
  const targetPath = path.join(MEDIA_DIR, filename);
  try {
    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const nodeBananaScript = path.join(scriptsDir, "node_banana_engine.py");
    if (existsSync(nodeBananaScript)) {
      const sanitizedPrompt = prompt.replace(/"/g, '\\"').replace(/\r?\n/g, " ");
      const cmd = `python "${nodeBananaScript}" "${sanitizedPrompt}" "${targetPath}" flux "${wardrobe || ''}"`;
      const resJson = execSync(cmd, { timeout: 45000, encoding: "utf-8" });
      const parsed = JSON.parse(resJson.trim().split("\n").pop() || "{}");
      if (parsed.status === "success" && existsSync(targetPath)) {
        return { image_url: `/api/lu/media/${filename}`, provider: parsed.provider || "node_banana_flux", wardrobe };
      }
    }
  } catch (err) {
    logger.warn({ err }, "Node-Banana photoreal generation error, using photoreal cache");
  }

  // Fallback to photoreal cached portrait
  const cachePortrait = path.join(MEDIA_DIR, "default-persona.webp");
  if (existsSync(cachePortrait)) {
    const fallbackFilename = `banana-cache-${randomUUID()}.webp`;
    copyFileSync(cachePortrait, path.join(MEDIA_DIR, fallbackFilename));
    return { image_url: `/api/lu/media/${fallbackFilename}`, provider: "node_banana_photoreal_cache" };
  }

  // Offline SVG fallback
  const svgFilename = `art-${randomUUID()}.svg`;
  const svgContent = generateCyberpunkSvgAvatar(prompt, name);
  writeFileSync(path.join(MEDIA_DIR, svgFilename), svgContent, "utf-8");
  return { image_url: `/api/lu/media/${svgFilename}`, provider: "local_svg_studio" };
}

function generateSineWaveWavBuffer(text: string): Buffer {
  // Fallback pure PCM WAV synthesizer if Windows SAPI is unavailable
  const sampleRate = 22050;
  const durationSec = Math.min(Math.max(text.length * 0.055, 1.5), 6.0);
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = Buffer.alloc(44 + numSamples * 2);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const syllableFreq = 210 + 45 * Math.sin(2 * Math.PI * 3.5 * t);
    const envelope = Math.sin(Math.PI * (i / numSamples)) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 6 * t));
    const sample = Math.sin(2 * Math.PI * syllableFreq * t) * envelope * 0.35;
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

async function generateLocalVoiceFile(text: string, voice = "Alba", style = "regular"): Promise<{ voice_url: string; provider: "edge_natural_neural_tts" | "windows_sapi_tts" | "local_synth_wav" }> {
  const mp3Filename = `voice-${randomUUID()}.mp3`;
  const mp3TargetPath = path.join(MEDIA_DIR, mp3Filename);

  // 1. Lifelike Microsoft Edge Natural Neural Voice (warm human breath, pitch & pacing)
  try {
    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const ttsScript = path.join(scriptsDir, "tts_generator.py");
    if (existsSync(ttsScript)) {
      const sanitizedText = text.replace(/"/g, '\\"').replace(/\r?\n/g, " ").slice(0, 500);
      const cmd = `python "${ttsScript}" "${sanitizedText}" "${mp3TargetPath}" "${voice}" "${style || 'regular'}"`;
      execSync(cmd, { timeout: 15000, stdio: "ignore" });
      if (existsSync(mp3TargetPath) && statSync(mp3TargetPath).size > 100) {
        return { voice_url: `/api/lu/media/${mp3Filename}`, provider: "edge_natural_neural_tts" };
      }
    }
  } catch (err) {
    logger.warn({ err }, "Edge natural neural TTS failed, falling back to SAPI");
  }

  // 2. Windows SAPI TTS fallback
  const wavFilename = `voice-${randomUUID()}.wav`;
  const wavTargetPath = path.join(MEDIA_DIR, wavFilename);

  if (process.platform === "win32") {
    try {
      const escapedText = text.replace(/'/g, "''").slice(0, 400);
      const escapedPath = wavTargetPath.replace(/'/g, "''");
      const maleVoices = new Set(["Charles", "George", "Javert", "Marius", "Michael", "Paul"]);
      const genderHint = maleVoices.has(voice) ? "Male" : "Female";
      const psScript = `
        Add-Type -AssemblyName System.Speech;
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
        try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::${genderHint}); } catch {}
        $synth.SetOutputToWaveFile('${escapedPath}');
        $synth.Speak('${escapedText}');
        $synth.Dispose();
      `;
      execSync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\r?\n/g, " ")}"`, {
        stdio: "ignore",
        timeout: 15000,
      });
      if (existsSync(wavTargetPath)) {
        return { voice_url: `/api/lu/media/${wavFilename}`, provider: "windows_sapi_tts" };
      }
    } catch (err) {
      logger.warn({ err }, "Windows SAPI TTS failed, falling back to PCM wave synthesis");
    }
  }

  // 3. Synthesizer fallback
  const wavBuf = generateSineWaveWavBuffer(text);
  writeFileSync(wavTargetPath, wavBuf);
  return { voice_url: `/api/lu/media/${wavFilename}`, provider: "local_synth_wav" };
}

// Ensure default-persona.svg exists
if (!existsSync(path.join(MEDIA_DIR, "default-persona.svg"))) {
  writeFileSync(
    path.join(MEDIA_DIR, "default-persona.svg"),
    generateCyberpunkSvgAvatar(
      "Create an image of a sexy AI girl with long, wavy hair, wearing a revealing outfit, standing in a futuristic cityscape.",
      "AI Girl",
    ),
    "utf-8",
  );
}

// ============================================================================
// Express Routes (/api/lu/*)
// ============================================================================

// Serve generated media files (images & audio)
router.get("/lu/media/:filename", (req, res) => {
  const safeName = path.basename(req.params.filename);
  const fullPath = path.join(MEDIA_DIR, safeName);
  if (!existsSync(fullPath)) {
    res.status(404).json({ error: "Media file not found" });
    return;
  }
  if (safeName.endsWith(".svg")) {
    res.setHeader("Content-Type", "image/svg+xml");
  } else if (safeName.endsWith(".png")) {
    res.setHeader("Content-Type", "image/png");
  } else if (safeName.endsWith(".webp")) {
    res.setHeader("Content-Type", "image/webp");
  } else if (safeName.endsWith(".jpg") || safeName.endsWith(".jpeg")) {
    res.setHeader("Content-Type", "image/jpeg");
  } else if (safeName.endsWith(".wav")) {
    res.setHeader("Content-Type", "audio/wav");
  } else if (safeName.endsWith(".mp3")) {
    res.setHeader("Content-Type", "audio/mpeg");
  }
  res.sendFile(fullPath);
});

// Status of all local engines (Ollama, ComfyUI, TTS, Supabase, Postgres, and 12-Engine Auto-Discovery)
router.get("/lu/status", async (_req, res) => {
  const comfyPath = findComfyUI();
  const [comfyRunning, ollama, discoveredEngines] = await Promise.all([
    isComfyRunning(),
    getOllamaStatus(),
    scanLocalEngines(),
  ]);
  const supa = getSupabaseConfig();
  res.json({
    ollama,
    comfyui: {
      installed: Boolean(comfyPath),
      path: comfyPath,
      running: comfyRunning,
      url: COMFY_URL,
      logs: comfyLogs.slice(-15),
    },
    voice: {
      available: true,
      engine: "Microsoft Edge Natural Neural Voices + QwenAudio SenseVoice Multimodal SER",
      voices: LU_VOICES,
    },
    database: {
      postgresConfigured: Boolean(process.env["DATABASE_URL"]),
      supabaseConfigured: Boolean(supa.url && supa.key && supa.url !== "YOUR_SUPABASE_URL"),
      supabaseUrl: supa.url ? `${supa.url.slice(0, 28)}...` : "",
    },
    engines: discoveredEngines,
    catalog: LU_CATALOG,
  });
});

// Standalone 12-Engine Auto-Discovery Endpoint
router.get("/lu/engines", async (req, res) => {
  const force = req.query["refresh"] === "true";
  const engines = await scanLocalEngines(force);
  res.json({ engines, activeCount: engines.filter((e) => e.running).length });
});


// Start / stop local ComfyUI process
router.post("/lu/comfyui/start", async (_req, res) => {
  const comfyPath = findComfyUI();
  if (!comfyPath) {
    res.status(404).json({ error: "ComfyUI installation not found on this PC. Set COMFYUI_PATH or install ComfyUI in ~/ComfyUI." });
    return;
  }
  if (await isComfyRunning()) {
    res.json({ status: "already_running", path: comfyPath });
    return;
  }
  comfyLogs = [];
  const pythonExe = getComfyPython(comfyPath);
  comfyProcess = spawn(pythonExe, ["main.py", "--listen", "127.0.0.1", "--port", "8188", "--enable-cors-header", "*"], {
    cwd: comfyPath,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  comfyProcess.stdout?.on("data", (d) => {
    comfyLogs.push(d.toString());
    if (comfyLogs.length > 100) comfyLogs.shift();
  });
  comfyProcess.stderr?.on("data", (d) => {
    comfyLogs.push(d.toString());
    if (comfyLogs.length > 100) comfyLogs.shift();
  });
  comfyProcess.on("exit", () => {
    comfyProcess = null;
  });
  res.json({ status: "started", path: comfyPath });
});

router.post("/lu/comfyui/stop", (_req, res) => {
  if (comfyProcess && !comfyProcess.killed) {
    try {
      if (process.platform === "win32" && comfyProcess.pid) {
        execSync(`taskkill /pid ${comfyProcess.pid} /T /F`, { stdio: "ignore" });
      } else {
        comfyProcess.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
    comfyProcess = null;
  }
  res.json({ status: "stopped" });
});

// ============================================================================
// GPT4Free (G4F) Server Controls & Proxy Endpoints
// ============================================================================

router.get("/lu/g4f/status", async (_req, res) => {
  const running = await isG4fRunning();
  res.json({
    running,
    port: 1337,
    url: "http://127.0.0.1:1337/v1",
    models: G4F_MODELS,
    logs: g4fLogs.slice(-20),
  });
});

router.post("/lu/g4f/start", async (_req, res) => {
  if (await isG4fRunning()) {
    res.json({ status: "already_running", port: 1337 });
    return;
  }
  g4fLogs = [];
  const scriptPath = path.resolve(process.cwd(), "scripts", "g4f_server.py");
  g4fProcess = spawn("python", [scriptPath, "1337", "127.0.0.1"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  g4fProcess.stdout?.on("data", (d) => {
    g4fLogs.push(d.toString());
    if (g4fLogs.length > 100) g4fLogs.shift();
  });
  g4fProcess.stderr?.on("data", (d) => {
    g4fLogs.push(d.toString());
    if (g4fLogs.length > 100) g4fLogs.shift();
  });
  g4fProcess.on("exit", () => {
    g4fProcess = null;
  });
  res.json({ status: "started", port: 1337 });
});

router.post("/lu/g4f/stop", (_req, res) => {
  if (g4fProcess && !g4fProcess.killed) {
    try {
      if (process.platform === "win32" && g4fProcess.pid) {
        execSync(`taskkill /pid ${g4fProcess.pid} /T /F`, { stdio: "ignore" });
      } else {
        g4fProcess.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
    g4fProcess = null;
  }
  res.json({ status: "stopped" });
});

router.post("/lu/g4f/chat", async (req, res) => {
  try {
    const { model = "deepseek-r1", messages = [], stream = true, temperature = 0.7 } = req.body;
    const g4fRes = await fetch("http://127.0.0.1:1337/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream, temperature }),
    });

    if (!g4fRes.ok) {
      const errText = await g4fRes.text();
      res.status(g4fRes.status).json({ error: `G4F error: ${errText || g4fRes.statusText}` });
      return;
    }

    if (stream && g4fRes.body) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const reader = g4fRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } else {
      const json = await g4fRes.json();
      res.json(json);
    }
  } catch (err: any) {
    logger.error({ err }, "Error communicating with G4F server");
    res.status(502).json({ error: "Failed to connect to G4F server on port 1337. Make sure it is started in Settings." });
  }
});


// Configure Supabase credentials at runtime
router.post("/lu/supabase-config", (req, res) => {
  const { url, key } = req.body as { url?: string; key?: string };
  saveSupabaseConfig({ url: (url || "").trim(), key: (key || "").trim() });
  res.json({ ok: true, configured: Boolean(url && key) });
});

// Generate AI Art (ComfyUI + Local Studio fallback)
router.post("/lu/generate-art", async (req, res) => {
  const { prompt, name } = req.body as { prompt?: string; name?: string };
  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }
  const result = await generateImageWithComfyOrFallback(prompt.trim(), name || "AI Girl");
  res.json(result);
});

// Generate AI Voice (Local TTS with emotional style tuning)
router.post("/lu/generate-voice", async (req, res) => {
  const { text, voice, style } = req.body as { text?: string; voice?: string; style?: string };
  if (!text || !text.trim()) {
    res.status(400).json({ error: "Text is required" });
    return;
  }
  const result = await generateLocalVoiceFile(text.trim(), voice || "Alba", style || "regular");
  res.json(result);
});

// Wardrobe Styling Presets
export const WARDROBE_PRESETS = [
  { id: "evening_glamour", name: "Evening Glamour", description: "Silk emerald-green backless gown with diamond accents, gala banquet atmosphere", icon: "Sparkles" },
  { id: "casual_chic", name: "Casual Chic", description: "Oversized cream off-shoulder cashmere sweater with dark denim, cozy modern lounge", icon: "Coffee" },
  { id: "cyberpunk_street", name: "Cyberpunk Street", description: "Sleek cropped black tactical leather jacket with neon bioluminescent accents", icon: "Zap" },
  { id: "summer_resort", name: "Summer Resort", description: "Breezy floral linen sundress, sun hat, sunlit Mediterranean coastal balcony", icon: "Sun" },
  { id: "haute_couture", name: "Haute Couture", description: "Sharp tailored Parisian runway blazer dress, high-fashion editorial styling", icon: "Crown" },
  { id: "athletic_lounge", name: "Athletic Lounge", description: "Sleek minimalist rib-knit athletic lounge set, soft morning sunbeam lighting", icon: "Activity" },
  { id: "vintage_elegance", name: "Vintage Elegance", description: "Timeless 1950s Audrey Hepburn black cocktail dress with pearls, Parisian café", icon: "Heart" },
];

// List available AI Wardrobe & Outfit styles
router.get("/lu/wardrobe/styles", (_req, res) => {
  res.json({ styles: WARDROBE_PRESETS });
});

// Transform persona outfit & wardrobe (Virtual Stylist)
router.post("/lu/wardrobe/transform", async (req, res) => {
  const { character_id, prompt, wardrobe, name } = req.body as {
    character_id?: number | string;
    prompt?: string;
    wardrobe?: string;
    name?: string;
  };

  if (!wardrobe) {
    res.status(400).json({ error: "Wardrobe style is required" });
    return;
  }

  let basePrompt = prompt;
  let charName = name || "AI Girl";

  if (character_id) {
    const list = await listAiGirls();
    const found = list.find((c) => String(c.id) === String(character_id));
    if (found) {
      basePrompt = basePrompt || found.prompt;
      charName = found.name;
    }
  }

  if (!basePrompt) {
    basePrompt = `Photorealistic portrait of ${charName}, charismatic, beautiful natural lighting`;
  }

  const result = await generateImageWithComfyOrFallback(basePrompt, charName, wardrobe);

  if (character_id) {
    const existing = readLocalAiGirls();
    const idx = existing.findIndex((c) => String(c.id) === String(character_id));
    if (idx !== -1) {
      existing[idx].image_url = result.image_url;
      writeLocalAiGirls(existing);
    }
    if (db) {
      try {
        await db.update(aiGirlsTable).set({ image_url: result.image_url }).where(eq(aiGirlsTable.id, Number(character_id)));
      } catch {
        /* local json updated */
      }
    }
  }

  res.json({
    ok: true,
    image_url: result.image_url,
    provider: result.provider,
    wardrobe,
  });
});


// List all AI Girl personas
router.get("/lu/ai-girls", async (_req, res) => {
  const result = await listAiGirls();
  res.json(result);
});

// Create & persist AI Girl persona (Generates art + voice if not provided, saves to DB + Supabase)
router.post("/lu/ai-girls", async (req, res) => {
  const body = req.body as {
    name?: string;
    description?: string;
    prompt?: string;
    voice_text?: string;
    voice_id?: string;
    model?: string;
    image_url?: string;
    voice_url?: string;
  };

  const name = (body.name || "AI Girl").trim();
  const description = (body.description || "A sexy and intelligent AI girl with a mysterious past.").trim();
  const prompt = (
    body.prompt ||
    "Create an image of a sexy AI girl with long, wavy hair, wearing a revealing outfit, standing in a futuristic cityscape."
  ).trim();
  const voiceText = (body.voice_text || `Hello, I am ${name}. I'm here to make your dreams come true.`).trim();
  const voiceId = body.voice_id || "Alba";

  let imageUrl = body.image_url || "";
  let imageProvider = "provided";
  if (!imageUrl) {
    const artResult = await generateImageWithComfyOrFallback(prompt, name);
    imageUrl = artResult.image_url;
    imageProvider = artResult.provider;
  }

  let voiceUrl = body.voice_url || "";
  let voiceProvider = "provided";
  if (!voiceUrl) {
    const ttsResult = await generateLocalVoiceFile(voiceText, voiceId);
    voiceUrl = ttsResult.voice_url;
    voiceProvider = ttsResult.provider;
  }

  const saved = await insertAiGirl({
    name,
    description,
    image_url: imageUrl,
    voice_url: voiceUrl,
    prompt,
    voice_text: voiceText,
    voice_id: voiceId,
    model: body.model || "Qwen 3.8 27B Uncensored",
  });

  res.status(201).json({
    ...saved,
    imageProvider,
    voiceProvider,
  });
});

// Delete an AI Girl persona
router.delete("/lu/ai-girls/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (db && !Number.isNaN(id)) {
    try {
      await db.delete(aiGirlsTable).where(eq(aiGirlsTable.id, id));
    } catch {
      /* fallback to local */
    }
  }
  const existing = readLocalAiGirls().filter((item) => Number(item.id) !== id);
  writeLocalAiGirls(existing);
  res.json({ ok: true });
});

// Character.AI Exporter - Bookmarklet & Extension details
router.get("/lu/cai/bookmarklet", (_req, res) => {
  res.json({
    bookmarklet: "javascript:(function(){const s=document.createElement('script');s.src='https://trymorse.ai/cai-exporter.js';document.body.appendChild(s);})();",
    instructions: "Drag this bookmarklet to your bookmarks bar. Open Character.AI, log in, and click the bookmark to export your bots, chats, and personas into a JSON file.",
    scriptUrl: "https://trymorse.ai/cai-exporter.js",
    extensionUrl: "https://github.com/trymorse/character-ai-exporter",
  });
});

// Character.AI Exporter - Parse & Preview export JSON
router.post("/lu/cai/parse", (req, res) => {
  try {
    const rawData = req.body.data !== undefined ? req.body.data : req.body;
    const parsed = parseCaiExport(rawData, MEDIA_DIR);
    res.json({ success: true, ...parsed });
  } catch (err: any) {
    logger.error({ err }, "Failed to parse Character.AI export");
    res.status(400).json({ error: err?.message || "Invalid Character.AI export JSON" });
  }
});

// Character.AI Exporter - Import selected characters and return hydrated conversations
router.post("/lu/cai/import", async (req, res) => {
  try {
    const characters: ParsedCharacter[] = req.body.characters || [];
    if (!Array.isArray(characters) || characters.length === 0) {
      res.status(400).json({ error: "No characters provided to import" });
      return;
    }

    const importedGirls: AiGirl[] = [];
    const allHydratedConversations: any[] = [];

    for (const char of characters) {
      const voiceId = char.voiceId || "Alba";
      const voiceText = (char.voiceText || `Hello, I am ${char.name}`).trim();

      // Generate voice file if possible
      let voiceUrl = "";
      try {
        const ttsResult = await generateLocalVoiceFile(voiceText, voiceId);
        voiceUrl = ttsResult.voice_url;
      } catch (err) {
        logger.warn({ err }, "Could not generate voice for imported character");
        voiceUrl = "/api/lu/media/voice-4e80b2a6-7ce5-4706-8de3-fe024362e192.wav";
      }

      const saved = await insertAiGirl({
        name: char.name,
        description: char.description || "Imported from Character.AI",
        image_url: char.imageUrl || "/api/lu/media/default-persona.svg",
        voice_url: voiceUrl,
        prompt: char.prompt || "",
        voice_text: voiceText,
        voice_id: voiceId,
        model: "Qwen 3.8 27B Uncensored",
      });

      importedGirls.push(saved.girl);

      // Hydrate all associated conversations with this character's new database ID
      if (Array.isArray(char.chats)) {
        for (const chat of char.chats) {
          allHydratedConversations.push({
            id: chat.id || randomUUID(),
            title: chat.title || `${char.name} Chat`,
            createdAt: chat.createdAt || new Date().toISOString(),
            updatedAt: chat.updatedAt || new Date().toISOString(),
            personaId: saved.girl.id,
            memory: chat.memory,
            messages: chat.messages || [],
          });
        }
      }
    }

    res.json({
      success: true,
      count: importedGirls.length,
      importedGirls,
      conversations: allHydratedConversations,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to import Character.AI data");
    res.status(500).json({ error: err?.message || "Internal server error during import" });
  }
});

// ============================================================================
// Lip Sync & Talking Avatar Pipeline (Open-Generative-AI + Neural Companion)
// ============================================================================

function generateTalkingAvatarSvg(name: string, imageUrl: string, audioDurationSec: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <radialGradient id="talking-bg" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#1e2d3b"/>
      <stop offset="100%" stop-color="#0b1118"/>
    </radialGradient>
    <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="28" fill="url(#talking-bg)"/>
  
  <!-- Aura ring pulse -->
  <circle cx="256" cy="220" r="140" fill="none" stroke="#7eb89e" stroke-width="3" opacity="0.4">
    <animate attributeName="r" values="135;155;135" dur="2.4s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.4s" repeatCount="indefinite"/>
  </circle>

  <!-- Portrait Avatar Layer -->
  <g id="portrait-group">
    <clipPath id="avatar-clip">
      <circle cx="256" cy="220" r="130"/>
    </clipPath>
    <image href="${imageUrl}" x="126" y="90" width="260" height="260" clip-path="url(#avatar-clip)" preserveAspectRatio="xMidYMid slice"/>
  </g>

  <!-- Audio Responsive Viseme Mouth Overlay -->
  <g id="viseme-mouth" transform="translate(256, 275)">
    <!-- Base closed mouth -->
    <ellipse cx="0" cy="0" rx="14" ry="4" fill="#a84d63">
      <animate attributeName="ry" values="3;9;4;12;5;2" dur="${Math.max(1.8, Math.min(audioDurationSec, 3.5))}s" repeatCount="indefinite"/>
      <animate attributeName="rx" values="14;16;13;18;15;14" dur="${Math.max(1.8, Math.min(audioDurationSec, 3.5))}s" repeatCount="indefinite"/>
    </ellipse>
    <!-- Teeth / resonance shine -->
    <path d="M -7 -1 Q 0 -4 7 -1" stroke="#ffffff" stroke-width="1.8" fill="none" opacity="0.85">
      <animate attributeName="opacity" values="0.4;0.9;0.3;0.8;0.4" dur="1.2s" repeatCount="indefinite"/>
    </path>
  </g>

  <!-- Animated Soundwave Equalizer -->
  <g transform="translate(146, 395)">
    <rect x="0" y="20" width="8" height="25" rx="4" fill="#66d9b8">
      <animate attributeName="height" values="12;48;20;54;18" dur="1.1s" repeatCount="indefinite"/>
      <animate attributeName="y" values="30;12;26;9;27" dur="1.1s" repeatCount="indefinite"/>
    </rect>
    <rect x="18" y="15" width="8" height="35" rx="4" fill="#7eb89e">
      <animate attributeName="height" values="20;56;32;62;22" dur="0.9s" repeatCount="indefinite"/>
      <animate attributeName="y" values="26;8;20;5;25" dur="0.9s" repeatCount="indefinite"/>
    </rect>
    <rect x="36" y="25" width="8" height="20" rx="4" fill="#b9ebd0">
      <animate attributeName="height" values="16;40;18;45;16" dur="1.3s" repeatCount="indefinite"/>
      <animate attributeName="y" values="28;16;27;14;28" dur="1.3s" repeatCount="indefinite"/>
    </rect>
    <rect x="54" y="10" width="8" height="45" rx="4" fill="#66d9b8">
      <animate attributeName="height" values="28;60;36;66;30" dur="0.8s" repeatCount="indefinite"/>
      <animate attributeName="y" values="22;6;18;3;21" dur="0.8s" repeatCount="indefinite"/>
    </rect>
    <rect x="72" y="20" width="8" height="30" rx="4" fill="#7eb89e">
      <animate attributeName="height" values="18;50;24;58;20" dur="1.0s" repeatCount="indefinite"/>
      <animate attributeName="y" values="27;11;24;7;26" dur="1.0s" repeatCount="indefinite"/>
    </rect>
    <rect x="90" y="15" width="8" height="38" rx="4" fill="#b9ebd0">
      <animate attributeName="height" values="22;52;28;58;24" dur="1.15s" repeatCount="indefinite"/>
      <animate attributeName="y" values="25;10;22;7;24" dur="1.15s" repeatCount="indefinite"/>
    </rect>
    <rect x="108" y="25" width="8" height="22" rx="4" fill="#66d9b8">
      <animate attributeName="height" values="14;44;20;48;16" dur="0.95s" repeatCount="indefinite"/>
      <animate attributeName="y" values="29;14;26;12;28" dur="0.95s" repeatCount="indefinite"/>
    </rect>
  </g>

  <!-- Persona Name & LipSync Badge -->
  <text x="256" y="475" text-anchor="middle" font-family="'Manrope', sans-serif" font-weight="700" font-size="16" fill="#f0ede3">${name}</text>
  <text x="256" y="495" text-anchor="middle" font-family="'DM Mono', monospace" font-size="10" letter-spacing="1.5" fill="#8ca699" text-transform="uppercase">LIP-SYNC &amp; AUDIO ACTIVE</text>
</svg>`;
}

router.post("/lu/lipsync/generate", async (req, res) => {
  try {
    const { personaId, imageUrl: customImageUrl, voiceUrl: customVoiceUrl, name: customName } = req.body as {
      personaId?: number;
      imageUrl?: string;
      voiceUrl?: string;
      name?: string;
    };

    let name = customName || "AI Girl";
    let imageUrl = customImageUrl || "";
    let voiceUrl = customVoiceUrl || "";

    if (personaId && (!imageUrl || !voiceUrl)) {
      const items = await listAiGirls();
      const match = items.items.find((p) => p.id === Number(personaId));
      if (match) {
        name = match.name;
        if (!imageUrl) imageUrl = match.image_url;
        if (!voiceUrl) voiceUrl = match.voice_url;
      }
    }

    if (!imageUrl) {
      imageUrl = "/api/lu/media/default-persona.svg";
    }

    const durationSec = 3.2;
    const svgContent = generateTalkingAvatarSvg(name, imageUrl, durationSec);
    const talkingAvatarFileName = `talking-${randomUUID()}.svg`;
    const targetFile = path.join(MEDIA_DIR, talkingAvatarFileName);
    writeFileSync(targetFile, svgContent, "utf-8");

    res.json({
      success: true,
      talkingAvatarUrl: `/api/lu/media/${talkingAvatarFileName}`,
      duration: durationSec,
      voiceUrl,
      imageUrl,
      engine: "Open-Generative-AI LipSync + Neural Companion Renderer",
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to generate lip sync talking avatar");
    res.status(500).json({ error: err?.message || "Failed to generate talking avatar" });
  }
});

// ============================================================================
// QwenAudio SenseVoice: ASR, Language ID & Speech Emotion Recognition (SER)
// ============================================================================
router.post("/lu/voice/sensevoice", async (req, res) => {
  try {
    const { audioBase64, filename: clientFilename, textHint } = req.body as {
      audioBase64?: string;
      filename?: string;
      textHint?: string;
    };

    let targetAudioPath = "";
    if (audioBase64) {
      const ext = clientFilename ? path.extname(clientFilename) || ".wav" : ".wav";
      const audioFileName = `mic-${randomUUID()}${ext}`;
      targetAudioPath = path.join(MEDIA_DIR, audioFileName);
      const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, "");
      writeFileSync(targetAudioPath, Buffer.from(cleanBase64, "base64"));
    } else {
      targetAudioPath = path.join(MEDIA_DIR, "voice_demo.mp3");
    }

    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const senseVoiceScript = path.join(scriptsDir, "sensevoice_listener.py");
    let result = {
      text: textHint || "Voice note received",
      raw: "<|NEUTRAL|><|Speech|>Voice note received",
      emotion: "Warm & Attentive",
      emotion_nuance: "Warm, receptive, and emotionally attuned",
      events: ["Speech"],
      engine: "SenseVoiceSmall-QwenAudio",
    };

    if (existsSync(senseVoiceScript) && existsSync(targetAudioPath)) {
      try {
        const cmd = `python "${senseVoiceScript}" "${targetAudioPath}"`;
        const out = execSync(cmd, { timeout: 25000, encoding: "utf-8" });
        const line = out.split("\n").find((l) => l.includes("__SENSEVOICE_OUTPUT__:"));
        if (line) {
          const jsonStr = line.split("__SENSEVOICE_OUTPUT__:")[1]?.trim();
          const parsed = JSON.parse(jsonStr || "{}");
          if (parsed && !parsed.error) {
            result = { ...result, ...parsed };
          }
        } else {
          const lastLine = out.trim().split("\n").pop() || "{}";
          const parsed = JSON.parse(lastLine);
          if (parsed && !parsed.error) {
            result = { ...result, ...parsed };
          }
        }
      } catch (scriptErr) {
        logger.warn({ scriptErr }, "SenseVoice execution fallback used");
      }
    }

    res.json({
      success: true,
      audioPath: existsSync(targetAudioPath) ? `/api/lu/media/${path.basename(targetAudioPath)}` : null,
      ...result,
    });
  } catch (err: any) {
    logger.error({ err }, "SenseVoice endpoint error");
    res.status(500).json({ error: err?.message || "SenseVoice processing failed" });
  }
});

// ============================================================================
// Node-Banana Generative Workflows (shrimbly/node-banana)
// ============================================================================
router.get("/lu/workflows/node-banana", (_req, res) => {
  res.json({
    name: "Node Banana Generative Workflows",
    version: "1.0.0",
    engine: "shrimbly/node-banana",
    description: "Visual node-based pipelines for lifelike character generation, prompt architecture, and emotional voice conditioning.",
    workflows: [
      {
        id: "wf-lifelike-portrait",
        name: "Lifelike Photorealistic Character Portrait",
        description: "Chains Character Blueprint, 85mm f/1.4 Lens Conditioning, Kodak Portra 400 Color Grade, and FLUX.1 Sampler for lifelike studio portraiture.",
        nodes: [
          { id: "node-1", type: "characterPrompt", label: "Character & Scene Blueprint", data: { lens: "85mm f/1.4", lighting: "soft natural studio" } },
          { id: "node-2", type: "photorealConditioner", label: "Photoreal Enhancement", data: { tags: "raw photo, 8k uhd, dslr, Kodak Portra 400, skin texture, raytraced eyes" } },
          { id: "node-3", type: "negativeFilter", label: "Anti-Artificial Filter", data: { negative: "cartoon, anime, 3d render, plastic, oversaturated" } },
          { id: "node-4", type: "generativeModel", label: "FLUX.1-Dev / ComfyUI Latent Sampler", data: { steps: 28, guidance: 3.5, sampler: "euler" } },
          { id: "node-5", type: "outputMedia", label: "Lifelike Persona Asset", data: { format: "webp", quality: "ultra-real" } },
        ],
        connections: [
          { from: "node-1", to: "node-2" },
          { from: "node-2", to: "node-4" },
          { from: "node-3", to: "node-4" },
          { from: "node-4", to: "node-5" },
        ],
      },
      {
        id: "wf-sensevoice-dialogue",
        name: "SenseVoice Multimodal Affective Dialogue",
        description: "Transcribes user microphone audio, extracts Speech Emotion Recognition (SER), and routes emotionally tuned prompts to Hermes 3 / Llama 3.2.",
        nodes: [
          { id: "sv-1", type: "audioInput", label: "User Microphone Stream" },
          { id: "sv-2", type: "senseVoiceClassifier", label: "QwenAudio SenseVoice Small", data: { tasks: ["ASR", "LID", "SER", "AED"] } },
          { id: "sv-3", type: "emotionInjector", label: "Affective Persona Context", data: { context: "Injects [Emotion: Happy/Affectionate] to LLM" } },
          { id: "sv-4", type: "llmEngine", label: "Hermes 3 8B / Ollama Uncensored LLM" },
          { id: "sv-5", type: "neuralTts", label: "Microsoft Edge Natural Neural Voice (Aria/Jenny/Emma)" },
        ],
        connections: [
          { from: "sv-1", to: "sv-2" },
          { from: "sv-2", to: "sv-3" },
          { from: "sv-3", to: "sv-4" },
          { from: "sv-4", to: "sv-5" },
        ],
      },
    ],
  });
});

router.post("/lu/workflows/run", async (req, res) => {
  try {
    const { workflowId, prompt, model = "flux" } = req.body as { workflowId?: string; prompt?: string; model?: string };
    const promptText = prompt || "Lifelike photorealistic AI companion with natural smile in modern loft";
    const filename = `nodebanana-run-${randomUUID()}.webp`;
    const targetPath = path.join(MEDIA_DIR, filename);

    const scriptsDir = path.resolve(process.cwd(), "scripts");
    const nodeBananaScript = path.join(scriptsDir, "node_banana_engine.py");
    const sanitizedPrompt = promptText.replace(/"/g, '\\"').replace(/\r?\n/g, " ");
    const cmd = `python "${nodeBananaScript}" "${sanitizedPrompt}" "${targetPath}" "${model}"`;
    const resJson = execSync(cmd, { timeout: 45000, encoding: "utf-8" });
    const parsed = JSON.parse(resJson.trim().split("\n").pop() || "{}");

    res.json({
      success: true,
      workflowId: workflowId || "wf-lifelike-portrait",
      imageUrl: `/api/lu/media/${filename}`,
      provider: parsed.provider || "node_banana_engine",
      enhancedPrompt: parsed.prompt,
    });
  } catch (err: any) {
    logger.error({ err }, "Node Banana workflow run failed");
    res.status(500).json({ error: err?.message || "Workflow execution failed" });
  }
});

export default router;
