<h1>
  Tocify
  <img src="https://raw.githubusercontent.com/anig1scur/tocify/refs/heads/main/static/favicon.svg" width="36" />
</h1>

Tocify is a free, open-source web app for editing PDF bookmarks and creating printable tables of contents. It can use AI to turn scanned contents pages or pasted text into a structured outline.

To use AI features, add your provider API key in **API Settings**. PDF editing and local OCR are available without a key.

## Tocify Local

Download the matching ZIP from [GitHub Releases](https://github.com/anig1scur/tocify/releases). Extract it and open `Start Tocify.command` on macOS or `Start Tocify.cmd` on Windows. The bundled server opens the app at `http://127.0.0.1:3210`. Close the launcher window to stop it.

PDF editing and OCR run locally. The selected OCR model and fonts download when needed and can be reused offline while they remain cached in the browser. The help video streams online. For AI requests to built-in providers, the server on your computer sends the selected content and your key directly to the provider.

## Usage

<https://github.com/user-attachments/assets/48e09103-f3a8-4d13-afeb-d11b5c8ade44>

---

### 1. Basic

<img src="./screenshots/basic.png" alt="Basic" width="100%"/>

### 2. Format text

<img src="./screenshots/text.gif" alt="Format text" width="100%"/>

### 3. Edit style

<img src="./screenshots/style.png" alt="Edit style" width="100%"/>

## Local development

Run `pnpm install` and `pnpm dev`, then open `http://localhost:5173`.

Use `pnpm build:local` and `pnpm start:local` to run the local-server build from source. On a supported release platform, `pnpm package:local` bundles that build and its Node runtime into a ZIP.

Run `pnpm test:llm` and `pnpm test:lifecycle` for checks that don't use provider API quota. For live model tests, copy [.env.example](.env.example) to `.env.local`, add a test API key, and run `pnpm test:llm:live`.
