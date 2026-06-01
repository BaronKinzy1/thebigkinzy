# Market News Bot

This is a CookMyBots managed WhatsApp brain service.

CookMyBots manages the WhatsApp connection, session, phone pairing, QR fallback, and inbound message routing. This repo does not implement WhatsApp Cloud API webhooks, Baileys, phone pairing, QR generation, or WhatsApp provider token handling.

The only required inbound endpoint is:

POST /webhook/cookmybots/whatsapp

The endpoint expects normalized CookMyBots WhatsApp payloads and verifies the X-CookMyBots-Webhook-Secret header with CMB_WHATSAPP_WEBHOOK_SECRET.

## Owner knowledge

The raw OWNER_KNOWLEDGE preserved in the project is:

"Let's build a bot that gives daily news about crypto and stock market. Giving news about top three investments to make"

The bot uses this as the source of truth for its role.

## What the bot does

The bot is AI-first and responds through natural WhatsApp conversation. It can:

1) Provide concise daily cryptocurrency news.
2) Provide concise stock market news.
3) Answer follow-up questions about market events.
4) Produce a top-three educational investment watchlist.
5) Explain when fresh market/news data could not be retrieved.

It does not use slash commands, fixed menus, static product lists, pricing flows, sales flows, moderation rules, or admin behavior.

## Top-three investment idea behavior

When the bot gives top-three investment ideas, they are always non-personalized educational watchlist candidates.

Each top-three item should include:

1) Asset, ticker, or name when available.
2) Why it is notable today.
3) Relevant risk factors.
4) A clear disclaimer that it is not financial advice and users should do their own research or consult a licensed advisor.

The bot must never promise gains, guarantee returns, or present watchlist ideas as personalized recommendations.

## Data sources

The service uses public sources where available:

1) CoinGecko public market endpoint for crypto market data.
2) CoinDesk RSS for crypto news.
3) Yahoo Finance RSS for broad stock market news.
4) Stooq public CSV endpoint for SPY, QQQ, and DIA equity ETF snapshots.

If these sources fail, rate limit, time out, or return unusable data, the bot tells the user fresh market/news data could not be retrieved or verified. It should then provide only cautious general education and must not fabricate current facts.

## Caching and persistence

MongoDB is used when MONGODB_URI is configured.

Collections:

1) daily_digests: one cached digest per UTC date, keyed by date and sourceHash.
2) source_snapshots: fetched public source snapshots for each UTC date.
3) message_context: lightweight recent user and assistant turns for chat continuity.

Indexes created by the service:

1) daily_digests on date, unique.
2) source_snapshots on date, unique.
3) message_context on chatId and createdAt.

The code never creates an index on _id.

MongoDB update/upsert safety:

1) createdAt is only written in $setOnInsert.
2) updatedAt is written in $set.
3) _id and createdAt are removed from mutable object updates.

If MongoDB is not configured or temporarily unavailable, the bot still boots and uses bounded in-memory fallback caches, but persistence is not durable.

## Environment variables

CMB_WHATSAPP_WEBHOOK_SECRET
Shared secret used to verify inbound CookMyBots managed WhatsApp webhook requests. Required for production webhook traffic.

COOKMYBOTS_AI_ENDPOINT
CookMyBots AI Gateway base URL. Example: https://api.cookmybots.com/api/ai. The code appends /chat or /chaingpt/chat.

COOKMYBOTS_AI_KEY
CookMyBots AI Gateway bearer token. Required for AI responses.

MONGODB_URI
MongoDB connection URI for digest cache, source snapshots, and lightweight chat context. Optional for boot, recommended for production.

AI_TIMEOUT_MS
AI request timeout in milliseconds. Defaults to 600000.

AI_MAX_RETRIES
Retry count for transient AI Gateway failures. Defaults to 2.

CONCURRENCY
General concurrency setting. Defaults to 20, while AI processing is conservatively capped in code for memory safety.

MARKET_FETCH_TIMEOUT_MS
Timeout for public market/news source fetches. Defaults to 15000.

WEB3_CHAT_MODE
Controls ChainGPT routing for crypto-focused questions. Supported values: auto, on, off. Defaults to auto.

PORT
HTTP port. Defaults to 3000.

## Local setup

1) Install dependencies:

npm install

2) Copy environment sample:

cp .env.sample .env

3) Fill in CMB_WHATSAPP_WEBHOOK_SECRET, COOKMYBOTS_AI_ENDPOINT, COOKMYBOTS_AI_KEY, and optionally MONGODB_URI.

4) Run locally:

npm run dev

5) Test without CookMyBots transport:

curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"text":"Give me today crypto and stock market news with top three ideas"}'

## Deployment

Deploy as one Node.js service, for example on Render.

Build command:

npm run build

Start command:

npm start

Set the environment variables in the hosting dashboard. Do not add WhatsApp Cloud API token variables. Users connect their WhatsApp number inside CookMyBots.

## Logging and diagnostics

The service logs production-safe structured JSON. It logs:

1) Boot/startup and environment sanity using booleans only.
2) AI Gateway call start, success, and failure.
3) Public market/news fetch start, success, and failure.
4) DB connection, index, read, and write failures with collection and operation.
5) Message response fallback when replies are truncated.
6) Lightweight memory usage once per minute.

Secrets are never logged.

## Health check

GET /health returns platform and configuration presence booleans.

## Public WhatsApp capabilities

There are no slash commands. Users ask naturally, for example:

1) What happened in crypto and stocks today?
2) Give me the top three investment ideas to watch today.
3) Why is Bitcoin moving today?
4) What is affecting the stock market today?
5) Give me a cautious market summary.

The AI decides the final response from owner knowledge, current source context, cached digest context, and recent chat context.
