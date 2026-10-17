# Finch Local Chat

A Windows-friendly browser chat client for local Ollama models. Model prompts
and replies are sent to the Ollama service running on your own PC; this app
doesn't send them to a hosted AI provider.

This is a compatible chat client, not a Windows port of FinchMoE's Swift/Metal
inference engine. FinchMoE itself requires supported Apple Silicon hardware.

## Windows setup

1. Install Node.js 20 or newer and enable Corepack so `pnpm` is available:

   ```powershell
   corepack enable
   ```

2. Install Ollama for Windows from [ollama.com/download](https://ollama.com/download)
   and launch it.
3. In PowerShell, download or clone this project, change to its workspace root,
   then install workspace dependencies:

   ```powershell
   pnpm install
   ```

4. Download a local model. For example:

   ```powershell
   ollama pull qwen2.5:3b
   ```

5. Start the local chat app from the workspace root:

   ```powershell
   pnpm --filter @workspace/finch-local-chat run dev:local
   ```

6. Open the local address printed in the terminal (normally
   `http://127.0.0.1:5173`) and select the installed model.

The local launcher binds to loopback and proxies the app's `/ollama` requests
to `http://127.0.0.1:11434`. The proxy avoids browser CORS configuration and
does not expose Ollama to your network. To use an Ollama service at a different
address, set `OLLAMA_BASE_URL` before launching:

```powershell
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
pnpm --filter @workspace/finch-local-chat run dev:local
```

## Replit preview

The Replit preview runs in a remote environment, so it cannot use Ollama
installed on your Windows PC. Run the local launcher on Windows to connect to
your local model.
