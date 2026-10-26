# Hackathon Starter

Next.js + Tailwind + one working Claude call. Type in the box, hit Run, Claude answers.

## Setup (do this before 6:30)

1. Unzip this into a folder like `~/Projects/hackathon-starter` and open it in VS Code.
2. In the VS Code terminal:
   ```
   npm install
   cp .env.example .env.local
   ```
3. Put your API key in `.env.local`. If you don't have one yet, leave it. You'll paste in the hackathon credits tonight.
4. Run it:
   ```
   npm run dev
   ```
   Open http://localhost:3000. Without a key you'll see a "No API key" error, which means everything else works.

## Get it live (also before 6:30)

1. Make a new empty repo on GitHub called `hackathon-starter`.
2. In the terminal:
   ```
   git init
   git add -A
   git commit -m "starter"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/hackathon-starter.git
   git push -u origin main
   ```
3. On vercel.com, click Add New > Project, import the repo, and deploy.
4. In the Vercel project go to Settings > Environment Variables and add `ANTHROPIC_API_KEY`. Redeploy once you have the key.

After that, every `git push` redeploys automatically.

## What to change tonight

- `src/app/api/ai/route.ts`: change `SYSTEM_PROMPT` to tell Claude what your app does. This is the main thing.
- `src/app/page.tsx`: change the title, the one-liner, and the layout.

Tip: open Claude Code in this folder and tell it your idea. It'll edit both files for you.
