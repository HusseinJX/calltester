import express from 'express';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleIncomingCall, handleGather, handleCallStatus } from './callHandler.js';
import { getCallLogs, getCallDetails } from './callLogger.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;

// Twilio webhook: Incoming call
app.post('/voice/incoming', handleIncomingCall);

// Twilio webhook: Gather (speech input received)
app.post('/voice/gather', handleGather);

// Twilio webhook: Call status updates
app.post('/voice/status', handleCallStatus);

// API: Get all call logs
app.get('/api/calls', (req, res) => {
  res.json(getCallLogs());
});

// API: Get specific call details
app.get('/api/calls/:callSid', (req, res) => {
  const call = getCallDetails(req.params.callSid);
  if (call) {
    res.json(call);
  } else {
    res.status(404).json({ error: 'Call not found' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║               AI Call Agent Tester                        ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                              ║
║                                                           ║
║  Webhooks (configure in Twilio):                          ║
║  • Voice URL: https://YOUR_URL/voice/incoming             ║
║  • Status URL: https://YOUR_URL/voice/status              ║
║                                                           ║
║  API Endpoints:                                           ║
║  • GET /api/calls - List all test calls                   ║
║  • GET /api/calls/:sid - Get call transcript              ║
║  • GET /health - Health check                             ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
