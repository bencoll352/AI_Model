import sys
import os
import json
import time
import urllib.request
import urllib.error

# Force unbuffered stdout so prints appear immediately
sys.stdout.reconfigure(line_buffering=True)

def print_header(title):
    print("\n" + "=" * 65)
    print(f"  {title.upper()}")
    print("=" * 65)

def test_ollama():
    print_header("1. Ollama Offline Inference Engine")
    url_tags = "http://127.0.0.1:11434/api/tags"
    try:
        with urllib.request.urlopen(url_tags, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            models = [m["name"] for m in data.get("models", [])]
            print(f"[PASS] Ollama service is ONLINE on port 11434")
            print(f"[INFO] Available local models: {models}")
            
            # Prefer llama3.2:latest for fast CPU loading, or hermes3:8b
            test_model = "llama3.2:latest" if "llama3.2:latest" in models else ("hermes3:8b" if "hermes3:8b" in models else models[0])
            print(f"[TEST] Sending live generation prompt to '{test_model}'...")
            t0 = time.time()
            chat_url = "http://127.0.0.1:11434/api/chat"
            prompt_payload = {
                "model": test_model,
                "messages": [{"role": "user", "content": "Introduce yourself in one short charming sentence."}],
                "stream": False
            }
            req = urllib.request.Request(
                chat_url,
                data=json.dumps(prompt_payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=60) as chat_resp:
                res_data = json.loads(chat_resp.read().decode())
                content = res_data.get("message", {}).get("content", "").strip()
                duration = round(time.time() - t0, 2)
                print(f"[PASS] Response received from {test_model} in {duration}s:")
                print(f"       \"{content}\"")
                return True
    except Exception as e:
        print(f"[FAIL] Ollama test error: {e}")
        return False

def test_g4f():
    print_header("2. GPT4Free (G4F) Frontier Intelligence")
    try:
        from g4f.client import Client
        client = Client()
        print("[TEST] Sending test query to G4F frontier client...")
        t0 = time.time()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Reply with exactly: 'G4F Frontier Intelligence Operational'"}],
        )
        content = response.choices[0].message.content.strip()
        duration = round(time.time() - t0, 2)
        print(f"[PASS] G4F response received in {duration}s:")
        print(f"       \"{content}\"")
        return True
    except Exception as e:
        print(f"[WARN] G4F direct query: {e}")
        return False

def test_lifelike_voice():
    print_header("3. Microsoft Edge Natural Neural Voice Synthesis")
    test_text = "Hello! I am speaking with a lifelike human neural voice, full of warmth, natural breath, and emotional nuance."
    out_file = "data/media/test_verify_neural.mp3"
    voice = "Alba"
    
    print(f"[TEST] Synthesizing speech via scripts/tts_generator.py (Voice: {voice} -> en-US-AriaNeural)...")
    t0 = time.time()
    cmd = f'python scripts/tts_generator.py "{test_text}" "{out_file}" "{voice}"'
    ret = os.system(cmd)
    duration = round(time.time() - t0, 2)
    
    if ret == 0 and os.path.exists(out_file):
        size = os.path.getsize(out_file)
        with open(out_file, "rb") as f:
            header = f.read(3)
        is_mp3 = (header[:3] == b"ID3" or (header[0] == 0xFF and (header[1] & 0xE0) == 0xE0))
        print(f"[PASS] Neural audio generated in {duration}s")
        print(f"       File: {out_file} ({size:,} bytes) | Valid MP3 format: {is_mp3}")
        return True
    else:
        print(f"[FAIL] Voice synthesis failed with exit code {ret}")
        return False

def test_sensevoice():
    print_header("4. QwenAudio SenseVoice Speech & Emotion Analysis")
    audio_sample = "data/media/test_verify_neural.mp3"
    if not os.path.exists(audio_sample):
        audio_sample = "data/media/voice_demo.mp3"
        
    print(f"[TEST] Running SenseVoice pipeline on audio '{audio_sample}'...")
    t0 = time.time()
    cmd = f'python scripts/sensevoice_listener.py "{audio_sample}"'
    import subprocess
    proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    duration = round(time.time() - t0, 2)
    
    try:
        json_line = None
        for line in proc.stdout.splitlines():
            if "__SENSEVOICE_OUTPUT__:" in line:
                json_line = line.split("__SENSEVOICE_OUTPUT__:")[1].strip()
                break
        if not json_line:
            json_line = proc.stdout.strip().splitlines()[-1]
        result = json.loads(json_line)
        print(f"[PASS] SenseVoice analysis completed in {duration}s:")
        print(f"       Engine:          {result.get('engine')}")
        print(f"       Detected Emotion:{result.get('emotion')} ({result.get('emotion_nuance')})")
        print(f"       Audio Events:    {result.get('events')}")
        print(f"       Rich Text / Tag: {result.get('raw')}")
        return True
    except Exception as e:
        print(f"[FAIL] SenseVoice parse error: {e}, stdout: {proc.stdout}")
        return False

def test_node_banana_photoreal():
    print_header("5. Node-Banana Photorealistic Generative Pipeline")
    prompt = "Lifelike photorealistic portrait of an AI woman with warm eyes, gentle smile, 85mm f1.4 lens, golden hour studio lighting"
    out_file = "data/media/test_verify_photoreal.webp"
    
    print(f"[TEST] Executing Node-Banana generative pipeline...")
    t0 = time.time()
    cmd = f'python scripts/node_banana_engine.py "{prompt}" "{out_file}" flux'
    import subprocess
    proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    duration = round(time.time() - t0, 2)
    
    if os.path.exists(out_file) and os.path.getsize(out_file) > 1000:
        size = os.path.getsize(out_file)
        with open(out_file, "rb") as f:
            head = f.read(12)
        is_valid_image = (head[:4] == b"RIFF" and head[8:12] == b"WEBP") or (head[:2] == b"\xff\xd8")
        print(f"[PASS] Lifelike image generated in {duration}s")
        print(f"       File: {out_file} ({size:,} bytes) | Valid image format: {is_valid_image}")
        try:
            res_json = json.loads(proc.stdout.strip())
            print(f"       Provider: {res_json.get('provider')}")
        except:
            pass
        return True
    else:
        print(f"[FAIL] Image generation failed. Output: {proc.stdout} {proc.stderr}")
        return False

def test_api_server():
    print_header("6. API Server & Node Banana Endpoints (Port 5000)")
    base_url = "http://127.0.0.1:5000/api/lu"
    
    tests = [
        ("GET /status", f"{base_url}/status", None),
        ("GET /workflows/node-banana", f"{base_url}/workflows/node-banana", None),
        ("GET /ai-girls", f"{base_url}/ai-girls", None),
        (
            "POST /voice/sensevoice",
            f"{base_url}/voice/sensevoice",
            json.dumps({"textHint": "Testing live SenseVoice API routing"}).encode("utf-8")
        ),
        (
            "POST /generate-voice",
            f"{base_url}/generate-voice",
            json.dumps({"text": "API voice test successful", "voice": "Eve"}).encode("utf-8")
        ),
    ]
    
    all_passed = True
    for name, url, data in tests:
        try:
            headers = {"Content-Type": "application/json"} if data else {}
            req = urllib.request.Request(url, data=data, headers=headers)
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=30) as resp:
                status = resp.status
                body = json.loads(resp.read().decode())
                elapsed = round((time.time() - t0) * 1000, 1)
                print(f"[PASS] {name:<30} -> Status {status} ({elapsed}ms)")
        except Exception as e:
            print(f"[FAIL] {name:<30} -> Error: {e}")
            all_passed = False
            
    return all_passed

def test_frontend():
    print_header("7. Finch Web UI (Port 5173)")
    url = "http://127.0.0.1:5173"
    try:
        t0 = time.time()
        with urllib.request.urlopen(url, timeout=5) as resp:
            status = resp.status
            html = resp.read().decode()
            has_title = "<title>" in html
            elapsed = round((time.time() - t0) * 1000, 1)
            print(f"[PASS] Finch Web UI is ONLINE on port 5173 -> Status {status} ({elapsed}ms)")
            print(f"       HTML bundle size: {len(html)} bytes | HTML valid: {has_title}")
            return True
    except Exception as e:
        print(f"[FAIL] Finch Web UI error: {e}")
        return False

def main():
    print("\n" + "#" * 65)
    print("   AI_MODEL COMPREHENSIVE END-TO-END VERIFICATION SUITE")
    print("   Testing Real Models, Real Voice, Real Vision, Real APIs")
    print("#" * 65)
    
    results = {
        "Ollama Local Inference": test_ollama(),
        "G4F Frontier Intelligence": test_g4f(),
        "Microsoft Edge Neural Voice": test_lifelike_voice(),
        "QwenAudio SenseVoice Analysis": test_sensevoice(),
        "Node-Banana Photoreal Pipeline": test_node_banana_photoreal(),
        "API Server & Workflows": test_api_server(),
        "Finch Web UI (Vite)": test_frontend(),
    }
    
    print_header("FINAL VERIFICATION SUMMARY")
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    for test_name, status in results.items():
        state = "[OK] PASS" if status else "[!] WARN/FAIL"
        print(f"  {test_name:<35} : {state}")
        
    print(f"\nOverall Result: {passed}/{total} Passed")
    print("=" * 65 + "\n")

if __name__ == "__main__":
    main()
