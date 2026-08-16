# BTC Predictor Pro

Build me a production-ready web app called “BTC 15m Prediction Dashboard.”

Purpose:
I want a private dashboard for tracking BTC 15-minute candle predictions. The app should pull real BTC 15-minute candlestick data, display the live chart, let me run an AI analysis/prediction, store each prediction, and automatically calculate win rate and performance stats every 15 minutes.

Tech requirements:

Use React + TypeScript.

Use Supabase for database, authentication, realtime updates, and Edge Functions.

Create backend Supabase Edge Functions for all external API calls.

Never expose API keys in frontend code.

Store the OpenAI key as a Supabase secret named OPENAI_API_KEY.

Use server-side functions to call OpenAI Responses API.

Use OKX public market data for BTC 15-minute candles.

Use the OKX endpoint server-side, not from the browser:
https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=15m&limit=200

If that domain has issues, make the OKX base URL configurable with an environment variable called OKX_REST_BASE_URL.

Core pages:

Dashboard page
Create a dark-mode trading dashboard with:

Header showing BTC price, 24h change, current 15m candle countdown, last updated time, and model version.

Main 15-minute candlestick chart for BTC-USDT.

Chart should show OHLC candles, volume, EMA 9, EMA 21, EMA 50.

Show the latest AI prediction card:

Prediction: YES or NO

Confidence %

Candle start time

Target candle close time

Reason summary

Setup type

Status: Pending, Win, Loss, Push, Manual Review

Add a large “RUN NEXT CANDLE” button.

Add a “Refresh Candles” button.

Add an “Auto Run Every 15m” toggle.

Add a disclaimer: “Prediction tracking only. Not financial advice.”

Stats page
Create a stats dashboard showing:

Overall win rate

Total runs

Wins

Losses

Pushes

Pending predictions

Last 10 win rate

Last 25 win rate

Last 50 win rate

YES call win rate

NO call win rate

Average confidence

Average confidence on wins

Average confidence on losses

Win rate by setup type

Win rate by confidence bucket:

50–59%

60–69%

70–79%

80%+

Win rate by market condition:

Trending up

Trending down

Chop/range

Reversal

Breakout

Failed breakout

Show a history table with every prediction and outcome.

Prediction history page
Create a searchable/filterable table with:

Timestamp

Candle time

Prediction YES/NO

Confidence

BTC price at prediction

Actual next candle result

Win/Loss/Push

Setup type

Model version

Notes

AI reasoning summary

Manual override button for outcome

Filters:

Date range

YES/NO

Win/Loss/Pending

Confidence range

Setup type

Model version

Model settings page
Create a model settings page where I can edit:

Model name/version

Indicator weights

Confidence threshold

Prompt instructions used for the AI call

Whether to auto-run every 15 minutes

Whether to require manual approval before saving a prediction

Default model:
Use model name “BTC 15m Model 1.9.”

Known Model 1.9 weighting emphasis:

Failed breakout/rejection zones: high importance

Wick rejection/defense: high importance

Trend direction

EMA positioning

Candle body strength

Volume expansion

Support/resistance proximity

Higher-low/lower-high structure

Breakout or breakdown follow-through

Reclaim/failure behavior

Chop/range risk

Allow all weights to be editable in the UI.

Database tables:

Create table: candles
Fields:

id uuid primary key

symbol text default 'BTC-USDT'

timeframe text default '15m'

candle_ts timestamptz unique

open numeric

high numeric

low numeric

close numeric

volume numeric

volume_quote numeric nullable

confirm boolean

raw jsonb

created_at timestamptz default now()

Create table: predictions
Fields:

id uuid primary key

symbol text default 'BTC-USDT'

timeframe text default '15m'

model_version text

candle_ts timestamptz

prediction text check prediction in ('YES','NO')

confidence numeric

btc_price_at_prediction numeric

setup_type text

market_condition text

reasoning_summary text

full_ai_response jsonb

indicators jsonb

status text default 'pending' check status in ('pending','win','loss','push','manual_review')

actual_next_candle_open numeric nullable

actual_next_candle_high numeric nullable

actual_next_candle_low numeric nullable

actual_next_candle_close numeric nullable

resolved_at timestamptz nullable

notes text nullable

created_at timestamptz default now()

Create table: model_settings
Fields:

id uuid primary key

model_version text unique

is_active boolean default false

confidence_threshold numeric default 55

auto_run_enabled boolean default false

require_manual_approval boolean default false

indicator_weights jsonb

prompt_template text

created_at timestamptz default now()

updated_at timestamptz default now()

Create table: api_runs
Fields:

id uuid primary key

run_type text

request_payload jsonb

response_payload jsonb

success boolean

error_message text nullable

created_at timestamptz default now()

Create a database view or RPC called prediction_stats that calculates:

total predictions

wins

losses

pushes

pending

overall win rate

last 10 win rate

last 25 win rate

last 50 win rate

YES win rate

NO win rate

average confidence

average confidence on wins

average confidence on losses

Edge Functions:

fetch-okx-candles

Fetch latest BTC-USDT 15m candles from OKX.

Normalize OKX candle response into:
timestamp, open, high, low, close, volume, quote volume, confirm.

Upsert into candles table.

Return the latest 200 candles.

run-ai-prediction

Fetch the most recent 100 BTC 15m candles from candles table.

Calculate indicators:

EMA 9

EMA 21

EMA 50

recent candle direction

wick size

body size

volume trend

support/resistance zones

failed breakout/rejection behavior

reclaim/failure behavior

range/chop risk

Call OpenAI Responses API server-side using OPENAI_API_KEY.

Ask the model to return strict JSON only.

Required AI output JSON:
{
"prediction": "YES" or "NO",
"confidence": number,
"setup_type": string,
"market_condition": string,
"reasoning_summary": string,
"indicators": {
"trend": string,
"ema_position": string,
"wick_rejection": string,
"failed_breakout": string,
"volume": string,
"support_resistance": string,
"risk_notes": string
}
}

Save the prediction in predictions table.

Return the saved prediction.

Use this AI system instruction:
“You are a BTC 15-minute candle prediction assistant. You analyze only the next 15-minute candle. Return YES if the next candle is more likely to close bullish versus its open. Return NO if the next candle is more likely to close bearish versus its open. Consider wick rejection, failed breakouts, reclaim/failure behavior, support/resistance, EMA structure, candle body strength, volume, and chop risk. Do not give financial advice. Do not recommend trades. Return strict JSON only.”

Use this user prompt structure:
“Analyze the latest BTC-USDT 15-minute candle data and predict the next candle only. Use Model 1.9 weighting. Recent candles: {{candles_json}}. Current model settings: {{model_settings_json}}. Return strict JSON only.”

resolve-predictions

Find pending predictions where the next candle has completed.

Compare prediction against actual next candle:

YES wins if next candle close > next candle open.

NO wins if next candle close < next candle open.

Push if close equals open or candle data is unclear.

Update predictions table with status, actual next candle OHLC, and resolved_at.

scheduled-15m-run

Every 15 minutes:

Call fetch-okx-candles.

Call resolve-predictions.

If auto_run_enabled is true in active model_settings, call run-ai-prediction.

Make this easy to trigger manually from the UI as well.

UI details:

Dark trading terminal feel.

Use cards, charts, tables, badges, and clean spacing.

Use green for YES/wins and red for NO/losses.

Use yellow/orange for pending/manual review.

Make mobile responsive but prioritize desktop dashboard layout.

Add loading states and error handling.

Add toast notifications for successful runs and failed API calls.

Add realtime Supabase subscriptions so stats and prediction history update without refreshing.

Security:

Require login before accessing the dashboard.

Only authenticated users can read/write predictions, candles, settings, and api_runs.

Use Row Level Security policies.

Do not expose OPENAI_API_KEY or any secret in the client bundle.

All OpenAI and OKX calls must happen inside Supabase Edge Functions.

Manual workflow:

When I click “RUN NEXT CANDLE,” the app should:

Fetch latest candles.

Resolve old pending predictions.

Call AI prediction.

Save prediction.

Refresh stats and chart.

Automatic workflow:

Every 15 minutes, the app should:

Fetch latest candles.

Resolve pending predictions.

If auto-run is enabled, create a new prediction for the next 15-minute candle.

Update dashboard stats.

Seed data:

Create one active model_settings row for “BTC 15m Model 1.9.”

Include editable indicator weights.

Set auto_run_enabled to false by default.

Set confidence_threshold to 55 by default.

Important:
This is not a trading execution app. Do not add buy/sell order functionality. This is only for analysis, prediction tracking, and performance statistics.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://btcpredictionlol.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/23a724c5-6c5b-4434-85e6-dc54b111c7e2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
