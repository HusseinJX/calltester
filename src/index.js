import http from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import twilio from 'twilio';
import OpenAI from 'openai';
import { writeFileSync, unlinkSync, createReadStream } from 'fs';
import { tmpdir } from 'os';
import { join as joinPath } from 'path';
import {
  handleIncomingCall,
  handleGather,
  handleHold,
  handleStream,
  handleSay,
  handleCallStatus
} from './callHandler.js';
import { getCallLogs, getCallDetails, addMessage, endCall, logCall } from './callLogger.js';
import { mediaSockets, browserSockets, notifyBrowsers } from './wsState.js';
import { getAnswerMode, setAnswerMode } from './settings.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || '';

// Twilio webhooks
app.post('/voice/incoming', handleIncomingCall);
app.post('/voice/gather', handleGather);
app.post('/voice/hold', handleHold);
app.post('/voice/stream', handleStream);
app.post('/voice/say', handleSay);
app.post('/voice/status', handleCallStatus);

// API: Get all call logs
app.get('/api/calls', (req, res) => {
  res.json(getCallLogs());
});

// API: Get current settings
app.get('/api/settings', (req, res) => {
  res.json({ answerMode: getAnswerMode() });
});

// API: Update settings
app.post('/api/settings', (req, res) => {
  const { answerMode } = req.body || {};
  if (!['manual', 'ai'].includes(answerMode)) {
    return res.status(400).json({ error: 'answerMode must be "manual" or "ai"' });
  }
  setAnswerMode(answerMode);
  res.json({ answerMode: getAnswerMode() });
});

// API: Get specific call details
app.get('/api/calls/:callSid', (req, res) => {
  const call = getCallDetails(req.params.callSid);
  if (call) res.json(call);
  else res.status(404).json({ error: 'Call not found' });
});

// API: Accept a ringing call — redirects it to the media stream
app.post('/api/calls/:callSid/accept', async (req, res) => {
  const { callSid } = req.params;
  if (!BASE_URL) return res.status(500).json({ error: 'BASE_URL not set in .env' });
  try {
    console.log(`🔔 Accepting call from tester UI: ${callSid}`);
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.calls(callSid).update({ url: `${BASE_URL}/voice/stream`, method: 'POST' });
    console.log(`✅ Twilio call ${callSid} redirected to /voice/stream`);
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ Failed to accept call ${callSid}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// API: Send typed text as speech to the caller
app.post('/api/calls/:callSid/say', async (req, res) => {
  const { callSid } = req.params;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  if (!BASE_URL) return res.status(500).json({ error: 'BASE_URL not set in .env' });
  try {
    addMessage(callSid, 'tester', text.trim());
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.calls(callSid).update({
      url: `${BASE_URL}/voice/say?text=${encodeURIComponent(text.trim())}`,
      method: 'POST'
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Hang up a call
app.post('/api/calls/:callSid/hangup', async (req, res) => {
  const { callSid } = req.params;
  try {
    console.log(`🔚 Hanging up call from tester UI: ${callSid}`);
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    // For in-progress calls Twilio expects "completed".
    // For ringing/queued calls Twilio expects "canceled".
    // Try "completed" first, then fall back to "canceled" if needed.
    try {
      await client.calls(callSid).update({ status: 'completed' });
      console.log(`✅ Twilio call ${callSid} marked completed`);
    } catch (err1) {
      console.warn(`⚠️ Failed to complete call ${callSid}, trying cancel:`, err1.message);
      await client.calls(callSid).update({ status: 'canceled' });
      console.log(`✅ Twilio call ${callSid} marked canceled`);
    }
    endCall(callSid, 'completed');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Initiate an outbound call in tester mode
app.post('/api/calls/outbound', async (req, res) => {
  const { to } = req.body;
  if (!to?.trim()) return res.status(400).json({ error: 'to (phone number) required' });
  if (!BASE_URL) return res.status(500).json({ error: 'BASE_URL not set in .env' });
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) return res.status(500).json({ error: 'TWILIO_PHONE_NUMBER not set in .env' });
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const call = await client.calls.create({
      to: to.trim(),
      from,
      url: `${BASE_URL}/voice/stream`,
      statusCallback: `${BASE_URL}/voice/status`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });
    logCall(call.sid, { from, to: to.trim(), status: 'ringing', direction: 'outbound' });
    notifyBrowsers({ type: 'outbound_initiated', callSid: call.sid, to: to.trim(), from });
    res.json({ callSid: call.sid });
  } catch (err) {
    console.error('Failed to create outbound call:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// HTTP server + WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (req.url === '/ws') {
      // Browser client connection
      browserSockets.add(ws);
      ws.on('close', () => browserSockets.delete(ws));
      ws.on('error', () => browserSockets.delete(ws));
      console.log(`🌐 Browser connected (${browserSockets.size} total)`);
    } else if (req.url === '/media-stream') {
      // Twilio Media Stream connection
      handleTwilioMediaStream(ws);
    } else {
      socket.destroy();
    }
  });
});

function handleTwilioMediaStream(ws) {
  let callSid = null;
  let mulawChunks = [];
  let mulawBytes = 0;
  let transcribing = false;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.event === 'start') {
        callSid = msg.start.callSid;
        mediaSockets.set(callSid, ws);
        console.log(`🎵 Media stream started: ${callSid}`);
      } else if (msg.event === 'media' && callSid) {
        // Forward raw mulaw audio to all browser clients
        notifyBrowsers({ type: 'audio', callSid, payload: msg.media.payload });

        // Also accumulate audio for transcription so we can show
        // what the caller is saying in the chat transcript.
        // IMPORTANT: Only do this in AI auto-answer mode; in
        // manual tester mode we avoid this extra work to keep
        // audio playback smooth and low-latency.
        if (openai && getAnswerMode() === 'ai') {
          const chunk = Buffer.from(msg.media.payload, 'base64');
          mulawChunks.push(chunk);
          mulawBytes += chunk.length;

          // Roughly ~5 seconds at 8kHz μ-law
          const TARGET_BYTES = 5 * 8000;
          if (!transcribing && mulawBytes >= TARGET_BYTES) {
            transcribing = true;
            const toTranscribe = Buffer.concat(mulawChunks);
            mulawChunks = [];
            mulawBytes = 0;
            transcribeCallerAudio(callSid, toTranscribe)
              .catch((err) => console.warn('STT error:', err.message))
              .finally(() => { transcribing = false; });
          }
        }
      } else if (msg.event === 'stop') {
        console.log(`🎵 Media stream stopped: ${callSid}`);
        if (callSid) mediaSockets.delete(callSid);
      }
    } catch (e) { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    if (callSid) mediaSockets.delete(callSid);
  });
}

function mulawToPcm16(mulawBuffer) {
  const pcm = Buffer.alloc(mulawBuffer.length * 2);
  for (let i = 0; i < mulawBuffer.length; i++) {
    const u = (~mulawBuffer[i]) & 0xFF;
    const sign = u & 0x80;
    const exp  = (u >> 4) & 0x07;
    const mant = u & 0x0F;
    const mag  = ((mant << 1) + 33) << (exp + 2);
    let sample = mag;
    if (sign) sample = -sample;
    // Clamp and write as 16-bit PCM
    const intSample = Math.max(-32768, Math.min(32767, sample));
    pcm.writeInt16LE(intSample, i * 2);
  }
  return pcm;
}

function pcm16ToWav(pcmBuffer, sampleRate = 8000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  let offset = 0;
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // PCM chunk size
  buffer.writeUInt16LE(1, offset); offset += 2; // Audio format (1 = PCM)
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  pcmBuffer.copy(buffer, offset);
  return buffer;
}

async function transcribeCallerAudio(callSid, mulawBuffer) {
  if (!openai) return;
  try {
    const pcm = mulawToPcm16(mulawBuffer);
    const wav = pcm16ToWav(pcm, 8000);
    const tmpPath = joinPath(tmpdir(), `call-${callSid}-${Date.now()}.wav`);
    writeFileSync(tmpPath, wav);

    const response = await openai.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: 'gpt-4o-transcribe',
    });

    unlinkSync(tmpPath);

    const text = (response.text || '').trim();
    if (!text) return;

    // For manual tester mode we could still add transcriptions here
    // in the future, but for now we skip logging to keep the audio
    // path as lean and low-latency as possible.
  } catch (err) {
    console.warn('Failed to transcribe audio:', err.message);
  }
}

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║               Call Answering App                          ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                              ║
║                                                           ║
║  Webhooks (configure in Twilio):                          ║
║  • Voice URL:   ${(BASE_URL || 'https://YOUR_URL')}/voice/incoming  ║
║  • Status URL:  ${(BASE_URL || 'https://YOUR_URL')}/voice/status    ║
║                                                           ║
║  BASE_URL: ${BASE_URL || '(not set — add to .env!)'}
╚═══════════════════════════════════════════════════════════╝
  `);
});
