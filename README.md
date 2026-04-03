# Calltester

Twilio voice + OpenAI tester app (Express).

## Run locally

1. **Install:** `npm install`

2. **Configure:** copy `.env.example` to `.env` and set at least:
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
   - `OPENAI_API_KEY`  
   Optional: `PORT` (default `3000`), `AI_MODEL`, `VOICE`, `TESTER_PERSONA`, `INITIAL_GREETING`.

3. **Start:** `npm start`  
   Dev with auto-reload: `npm run dev`

4. **Expose for Twilio webhooks** (e.g. incoming voice URL): `npm run tunnel` (serves port 3000 via localtunnel; point Twilio at the HTTPS URL it prints).

or 

ngrok http 3000