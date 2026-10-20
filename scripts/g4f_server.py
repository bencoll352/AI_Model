import sys
import uvicorn
from g4f.api import create_app

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 1337
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
    print(f"Starting G4F OpenAI-Compatible API on http://{host}:{port}/v1 ...", flush=True)
    app = create_app()
    uvicorn.run(app, host=host, port=port, log_level="warning")

if __name__ == "__main__":
    main()
