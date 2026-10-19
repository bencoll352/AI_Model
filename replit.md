# AI_Model + Locally Uncensored Studio

Full-stack local AI workspace combining **[bencoll352/AI_Model](https://github.com/bencoll352/AI_Model)** (`finch-local-chat` & `api-server`) with **[PurpleDoubleD/locally-uncensored](https://github.com/PurpleDoubleD/locally-uncensored)** (ComfyUI local image generation, 15 English voices, uncensored model catalog, and `ai_girls` persona persistence in PostgreSQL + Supabase).

## Features Integrated

1. **Finch + Locally Uncensored Chat (`/`)**
   - Connects to local **Ollama** (`127.0.0.1:11434`) with active **AI Girl Persona** system prompt injection.
   - Includes the **Locally Uncensored** model catalog (`Qwen 3.8 27B Uncensored`, `Gemma 4 12B Heretic`, `Qwen3-VL 8B Abliterated`, `Hermes 3 Llama 3.1 8B`, `Llama 3.1 8B Abliterated`, `GLM 4.7 Flash Heretic`, `Qwen 3.6 35B MoE Abliterated`).
2. **Create & AI Girls Studio (`/create`)**
   - Generates AI character artwork via local **ComfyUI** (`127.0.0.1:8188`) with automatic local ComfyUI installation discovery (`findComfyUI`) and an instant offline cyberpunk SVG studio renderer fallback.
   - Synthesizes character voice greetings locally using the **15 English Voices** from Locally Uncensored (`Alba`, `Anna`, `Azelma`, `Charles`, `Eponine`, `Eve`, `Fantine`, `George`, `Jane`, `Javert`, `Marius`, `Mary`, `Michael`, `Paul`, `Vera`).
   - Persists generated personas (`name`, `description`, `image_url`, `voice_url`, `prompt`, `voice_text`, `voice_id`) to **Supabase** (`ai_girls` table), **PostgreSQL** (`@workspace/db` Drizzle schema), and local JSON storage (`data/ai_girls.json`).
3. **Voice Studio Beta (`/voice`)**
   - Interactive voice selector and local speech synthesis tester for all 15 Locally Uncensored voices.
4. **Python Persona Generator (`scripts/ai_girl_generator.py`)**
   - Ready-to-run Python script implementing `generate_ai_art(prompt)`, `generate_ai_voice(text)`, and `insert_ai_girl_data(name, description, image_url, voice_url)` with Supabase + local API server sync.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — Build and run the Express 5 API server on port `5000`
- `pnpm --filter @workspace/finch-local-chat run dev:local` — Run the Finch + Locally Uncensored Studio web app on `http://127.0.0.1:5173`
- `python scripts/ai_girl_generator.py` — Run the Python AI Girl generator and insert into local DB + Supabase
- `pnpm run typecheck` — Full TypeScript typecheck across all workspace packages
- `pnpm --filter @workspace/db run push` — Push the `ai_girls` Drizzle schema to PostgreSQL (`DATABASE_URL`)

## Environment Variables (Optional)

- `SUPABASE_URL` & `SUPABASE_KEY` — Syncs `ai_girls` records to your Supabase project (can also be configured live in the **Settings** tab)
- `DATABASE_URL` — PostgreSQL connection string for `@workspace/db` (automatically falls back to `data/ai_girls.json` if not set)
- `COMFYUI_PATH` / `COMFYUI_URL` — Custom path or URL for local ComfyUI (`http://127.0.0.1:8188` by default)
- `OLLAMA_BASE_URL` — Local Ollama server URL (`http://127.0.0.1:11434` by default)
