import sys
import asyncio
import edge_tts

VOICE_MAP = {
    "Alba": "en-US-AriaNeural",
    "Anna": "en-US-JennyNeural",
    "Azelma": "en-US-AnaNeural",
    "Charles": "en-US-GuyNeural",
    "Eponine": "en-GB-SoniaNeural",
    "Eve": "en-US-EmmaNeural",
    "Fantine": "en-US-AvaNeural",
    "George": "en-GB-RyanNeural",
    "Jane": "en-US-MichelleNeural",
    "Javert": "en-US-ChristopherNeural",
    "Marius": "en-US-BrianNeural",
    "Mary": "en-US-SteffanNeural",
    "Michael": "en-US-EricNeural",
    "Paul": "en-US-AndrewNeural",
    "Vera": "en-US-SaraNeural",
}

async def main():
    if len(sys.argv) < 3:
        print("Usage: python tts_generator.py <text> <output_path> [voice_name]")
        return
    text = sys.argv[1]
    out_path = sys.argv[2]
    voice_name = sys.argv[3] if len(sys.argv) > 3 else "Alba"
    neural_voice = VOICE_MAP.get(voice_name, "en-US-AriaNeural")
    communicate = edge_tts.Communicate(text, neural_voice, rate="+0%", pitch="+0Hz")
    await communicate.save(out_path)
    print(f"SUCCESS:{neural_voice}:{out_path}")

if __name__ == "__main__":
    asyncio.run(main())
