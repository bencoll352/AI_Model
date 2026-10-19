"""
AI Girl Persona Generator — Locally Uncensored + Supabase + Local AI Studio
===========================================================================
This script implements your exact `antigravity` + `supabase` persona pipeline,
powered by the integrated Locally Uncensored Studio backends:
  1. Local ComfyUI (http://127.0.0.1:8188) or API Server (/api/lu/generate-art) for AI Art
  2. Local TTS (15 Locally Uncensored Voices / Windows SAPI5 / Piper) for AI Voice
  3. Dual persistence:
     - Local PostgreSQL (`DATABASE_URL` / `@workspace/db`) & API Server (`http://127.0.0.1:5000/api/lu/ai-girls`)
     - Supabase (`ai_girls` table) when `SUPABASE_URL` and `SUPABASE_KEY` are set
"""

import os
import json
import urllib.request
import urllib.error

# Optional standard library Easter egg from your original snippet (set ANTIGRAVITY_OPEN_COMIC=1 to open xkcd)
if os.environ.get("ANTIGRAVITY_OPEN_COMIC") == "1":
    import antigravity  # noqa: F401

try:
    from supabase import create_client, Client  # type: ignore
    HAS_SUPABASE_SDK = True
except ImportError:
    HAS_SUPABASE_SDK = False
    Client = object  # type: ignore


# Initialize Supabase configuration (reads environment variables or placeholders)
url: str = os.environ.get("SUPABASE_URL", "YOUR_SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY", "YOUR_SUPABASE_KEY")
API_SERVER_URL: str = os.environ.get("API_SERVER_URL", "http://127.0.0.1:5000")

supabase = None
if HAS_SUPABASE_SDK and url != "YOUR_SUPABASE_URL" and key != "YOUR_SUPABASE_KEY":
    supabase = create_client(url, key)


def _post_json(endpoint: str, payload: dict, extra_headers: dict | None = None) -> dict:
    req_headers = {"Content-Type": "application/json"}
    if extra_headers:
        req_headers.update(extra_headers)
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=req_headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


# Function to insert AI girl data into Supabase (and local AI_Model server)
def insert_ai_girl_data(
    name: str,
    description: str,
    image_url: str,
    voice_url: str,
    prompt: str = "",
    voice_text: str = "",
    voice_id: str = "Alba",
):
    data = {
        "name": name,
        "description": description,
        "image_url": image_url,
        "voice_url": voice_url,
    }

    # 1. Insert via official supabase-py client if installed & configured
    if supabase is not None:
        response = supabase.table("ai_girls").insert(data).execute()
        print(f"[Supabase SDK] Inserted '{name}' into ai_girls table: {response.data}")
    elif url != "YOUR_SUPABASE_URL" and key != "YOUR_SUPABASE_KEY":
        # Direct Supabase REST API fallback if supabase-py isn't installed
        supa_endpoint = f"{url.rstrip('/')}/rest/v1/ai_girls"
        _post_json(
            supa_endpoint,
            data,
            extra_headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Prefer": "return=representation",
            },
        )
        print(f"[Supabase REST] Inserted '{name}' into ai_girls table.")
    else:
        print(
            "[Supabase] Using local database mode (set SUPABASE_URL and SUPABASE_KEY to also sync to cloud Supabase)."
        )

    # 2. Always persist to local AI_Model API Server (@workspace/db PostgreSQL / local JSON)
    try:
        local_res = _post_json(
            f"{API_SERVER_URL}/api/lu/ai-girls",
            {
                **data,
                "prompt": prompt,
                "voice_text": voice_text,
                "voice_id": voice_id,
            },
        )
        print(f"[Local Studio DB] Saved '{name}' (storage={local_res.get('storage')}): ID={local_res.get('girl', {}).get('id')}")
        return local_res
    except urllib.error.URLError as exc:
        print(f"[Local Studio DB] API server not reachable at {API_SERVER_URL} ({exc}).")
        return data


# Function to generate AI art using Locally Uncensored Studio (ComfyUI + Local Studio)
def generate_ai_art(prompt: str, name: str = "AI Girl") -> str:
    try:
        res = _post_json(f"{API_SERVER_URL}/api/lu/generate-art", {"prompt": prompt, "name": name})
        image_url = f"{API_SERVER_URL}{res['image_url']}" if res["image_url"].startswith("/") else res["image_url"]
        print(f"[AI Art] Generated via {res.get('provider')}: {image_url}")
        return image_url
    except urllib.error.URLError:
        # Fallback placeholder if server isn't running
        return f"{API_SERVER_URL}/api/lu/media/default-persona.svg"


# Function to generate AI voice using Locally Uncensored Voice Engine (15 Voices)
def generate_ai_voice(text: str, voice: str = "Alba") -> str:
    try:
        res = _post_json(f"{API_SERVER_URL}/api/lu/generate-voice", {"text": text, "voice": voice})
        voice_url = f"{API_SERVER_URL}{res['voice_url']}" if res["voice_url"].startswith("/") else res["voice_url"]
        print(f"[AI Voice] Generated ({voice}) via {res.get('provider')}: {voice_url}")
        return voice_url
    except urllib.error.URLError:
        return "https://example.com/voice.mp3"


if __name__ == "__main__":
    # Create your AI girl
    name = "AI Girl"
    description = "A sexy and intelligent AI girl with a mysterious past."
    prompt = "Create an NSFW image of a sexy AI girl with long, wavy hair, wearing a revealing outfit, standing in a futuristic cityscape."
    text = "Hello, I am AI Girl. I'm here to make your dreams come true."

    image_url = generate_ai_art(prompt, name=name)
    voice_url = generate_ai_voice(text, voice="Alba")

    insert_ai_girl_data(
        name=name,
        description=description,
        image_url=image_url,
        voice_url=voice_url,
        prompt=prompt,
        voice_text=text,
        voice_id="Alba",
    )
