import { Router, type IRouter } from "express";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, aiGirlsTable, type AiGirl, type InsertAiGirl } from "@workspace/db";
import { logger } from "../lib/logger";

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
// Supabase & Local DB Persistence Layer
// ============================================================================

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

async function generateImageWithComfyOrFallback(prompt: string, name = "AI Girl"): Promise<{ image_url: string; provider: "comfyui" | "local_svg_studio" }> {
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
                    return { image_url: `/api/lu/media/${filename}`, provider: "comfyui" };
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "ComfyUI generation failed, falling back to local SVG studio renderer");
    }
  }

  // Fallback: save a local SVG artwork so the workflow always succeeds offline
  const filename = `art-${randomUUID()}.svg`;
  const svgContent = generateCyberpunkSvgAvatar(prompt, name);
  writeFileSync(path.join(MEDIA_DIR, filename), svgContent, "utf-8");
  return { image_url: `/api/lu/media/${filename}`, provider: "local_svg_studio" };
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

async function generateLocalVoiceFile(text: string, voice = "Alba"): Promise<{ voice_url: string; provider: "windows_sapi_tts" | "local_synth_wav" }> {
  const filename = `voice-${randomUUID()}.wav`;
  const targetPath = path.join(MEDIA_DIR, filename);

  if (process.platform === "win32") {
    try {
      const escapedText = text.replace(/'/g, "''");
      const escapedPath = targetPath.replace(/'/g, "''");
      // Map female/male voices based on LU voice name
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
      if (existsSync(targetPath)) {
        return { voice_url: `/api/lu/media/${filename}`, provider: "windows_sapi_tts" };
      }
    } catch (err) {
      logger.warn({ err }, "Windows SAPI TTS failed, falling back to PCM wave synthesis");
    }
  }

  const wavBuf = generateSineWaveWavBuffer(text);
  writeFileSync(targetPath, wavBuf);
  return { voice_url: `/api/lu/media/${filename}`, provider: "local_synth_wav" };
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
  } else if (safeName.endsWith(".wav")) {
    res.setHeader("Content-Type", "audio/wav");
  } else if (safeName.endsWith(".mp3")) {
    res.setHeader("Content-Type", "audio/mpeg");
  }
  res.sendFile(fullPath);
});

// Status of all local engines (Ollama, ComfyUI, TTS, Supabase, Postgres)
router.get("/lu/status", async (_req, res) => {
  const comfyPath = findComfyUI();
  const [comfyRunning, ollama] = await Promise.all([isComfyRunning(), getOllamaStatus()]);
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
      engine: process.platform === "win32" ? "Windows SAPI5 Local Neural/Desktop TTS" : "Local PCM Synthesizer",
      voices: LU_VOICES,
    },
    database: {
      postgresConfigured: Boolean(process.env["DATABASE_URL"]),
      supabaseConfigured: Boolean(supa.url && supa.key && supa.url !== "YOUR_SUPABASE_URL"),
      supabaseUrl: supa.url ? `${supa.url.slice(0, 28)}...` : "",
    },
    catalog: LU_CATALOG,
  });
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

// Generate AI Voice (Local TTS)
router.post("/lu/generate-voice", async (req, res) => {
  const { text, voice } = req.body as { text?: string; voice?: string };
  if (!text || !text.trim()) {
    res.status(400).json({ error: "Text is required" });
    return;
  }
  const result = await generateLocalVoiceFile(text.trim(), voice || "Alba");
  res.json(result);
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

export default router;
