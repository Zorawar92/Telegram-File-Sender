# Telegram File Sender

A private Expo mobile app for choosing any file and sending it directly to a Telegram bot.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Pick any file from the device.
- Send it to a configured Telegram bot and chat with upload progress.
- Select an Android folder and periodically upload files that have not been sent before.
- Scan the selected folder manually or let Android run background checks at a system-controlled interval.
- Check the bot token before sending.
- Keep bot token and chat ID on the device; use secure storage on native platforms and a web-only fallback for browser preview.

## User preferences

- The user wants a personal app that can send any file to a Telegram bot on their phone.

## Gotchas

- Telegram Bot API credentials are entered by the user on-device; never hardcode a bot token in source.
- `expo-document-picker` is required for arbitrary file selection.
- Folder automation needs the installable Android build; Expo Go does not provide Android background-task execution.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
