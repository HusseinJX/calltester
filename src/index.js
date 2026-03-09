import http from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import twilio from 'twilio';
import {
  handleIncomingCall,
  handleHold,
  handleStream,
  handleSay,
  handleCallStatus
} from './callHandler.js';
import { getCallLogs, getCallDetails, addMessage, endCall } from './callLogger.js';
import { mediaSockets, browserSockets, notifyBrowsers } from './wsState.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || '';

// Twilio webhooks
app.post('/voice/incoming', handleIncomingCall);
app.post('/voice/hold', handleHold);
app.post('/voice/stream', handleStream);
app.post('/voice/say', handleSay);
app.post('/voice/status', handleCallStatus);

// API: Get all call logs
app.get('/api/calls', (req, res) => {
  res.json(getCallLogs());
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
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.calls(callSid).update({ url: `${BASE_URL}/voice/stream`, method: 'POST' });
    res.json({ success: true });
  } catch (err) {
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
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.calls(callSid).update({ status: 'completed' });
    endCall(callSid, 'completed');
    res.json({ success: true });
  } catch (err) {
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
