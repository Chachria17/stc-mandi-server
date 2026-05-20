# STC Mandi Intelligence Agent

WhatsApp → Claude API → Supabase pipeline for structured commodity price data.

## Architecture
```
Aayush SMS (WhatsApp) → Twilio → This Server → Claude API → Supabase
```

## Local Setup

1. Copy environment file:
```bash
cp .env.example .env
```

2. Fill in your `.env` file:
```
ANTHROPIC_API_KEY=        # from console.anthropic.com
SUPABASE_URL=             # https://edhylhixvugbbotrbtqj.supabase.co
SUPABASE_SERVICE_KEY=     # service_role key from Supabase settings
TWILIO_ACCOUNT_SID=       # from Twilio console
TWILIO_AUTH_TOKEN=        # from Twilio console
PORT=3000
```

3. Install and run:
```bash
npm install
npm start
```

4. Test parsing without WhatsApp:
```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"text": "इंदौर किसानी मंडी 20/05/26 डॉलर 2600 बोरी..."}'
```

---

## Deploy to Railway

1. Go to railway.app → New Project → Deploy from GitHub repo
   (or use Railway CLI: `npm install -g @railway/cli && railway login`)

2. Push this folder to a GitHub repo first:
```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/stc-mandi-server.git
git push -u origin main
```

3. In Railway dashboard:
   - Connect your GitHub repo
   - Go to Variables tab
   - Add all 5 environment variables from .env
   - Railway auto-deploys, gives you a public URL like:
     `https://stc-mandi-server-production.up.railway.app`

4. Copy that Railway URL.

---

## Connect Twilio Webhook

1. Go to Twilio Console → Messaging → Settings → WhatsApp Sandbox Settings
2. In "When a message comes in" field, paste:
   ```
   https://YOUR-RAILWAY-URL.up.railway.app/webhook
   ```
3. Set method to HTTP POST
4. Save

Now every WhatsApp message to the sandbox number triggers your server.

---

## Testing the Full Flow

1. Send a message to the Twilio sandbox number from WhatsApp
2. Check Railway logs — you should see "Parsed as: [type] | Market: [market]"
3. Check Supabase Table Editor — rows should appear in all relevant tables

---

## Message Types Handled
- indore_kisani_mandi
- morning_update / closing_update
- arrival_estimated / arrival_final
- container_spot
- delhi_chana / delhi_pulses
- chennai
- burma_cnf
- bombay_port
- gujarat_export (FOB USD)
- sholapur
- regional_mandi (Anjad, Dhamnod, Dahod, Shirpur)
- mill_rates_sangvi / mill_rates_tirumati
- wheat_indore
- spot_prices (Gold, Silver)
- kandla_bavla
