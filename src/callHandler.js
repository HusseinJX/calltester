import twilio from 'twilio';
import { logCall, addMessage, endCall } from './callLogger.js';
import { notifyBrowsers } from './wsState.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export async function handleIncomingCall(req, res) {
  const { CallSid, From, To } = req.body;

  console.log(`\n📞 Incoming call: ${CallSid}`);
  console.log(`   From: ${From} → To: ${To}`);

  logCall(CallSid, { from: From, to: To, status: 'ringing' });

  // Notify browser to show incoming call UI
  notifyBrowsers({ type: 'incoming', callSid: CallSid, from: From, to: To });

  const response = new VoiceResponse();
  const voice = process.env.VOICE || 'Polly.Matthew';

  // Immediately answer the call with a brief message so the caller
  // stops hearing ringing, then put them on hold while the tester decides.
  response.say({ voice }, process.env.INITIAL_GREETING || 'Please hold while we connect you.');
  response.pause({ length: 29 });
  response.redirect({ method: 'POST' }, '/voice/hold');

  res.type('text/xml');
  res.send(response.toString());
}

// Keep the call alive in a silence loop until accepted or declined
export function handleHold(req, res) {
  const response = new VoiceResponse();
  response.pause({ length: 29 });
  response.redirect({ method: 'POST' }, '/voice/hold');
  res.type('text/xml');
  res.send(response.toString());
}

// Start a bidirectional media stream so the browser can hear the caller
export function handleStream(req, res) {
  const BASE_URL = process.env.BASE_URL || '';
  const wsUrl = BASE_URL.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/media-stream';

  const response = new VoiceResponse();
  const connect = response.connect();
  connect.stream({ url: wsUrl, track: 'inbound_track' });

  res.type('text/xml');
  res.send(response.toString());
}

// Speak user's typed text to the caller, then reconnect the stream
export function handleSay(req, res) {
  const text = req.query.text || req.body.text || '';
  const voice = process.env.VOICE || 'Polly.Matthew';

  const response = new VoiceResponse();
  if (text) {
    response.say({ voice }, text);
  }
  response.redirect({ method: 'POST' }, '/voice/stream');

  res.type('text/xml');
  res.send(response.toString());
}

export function handleCallStatus(req, res) {
  const { CallSid, CallStatus, CallDuration } = req.body;

  console.log(`\n📊 Call ${CallSid} status: ${CallStatus} (duration: ${CallDuration}s)`);

  if (['completed', 'failed', 'no-answer', 'busy', 'canceled'].includes(CallStatus)) {
    endCall(CallSid, CallStatus, CallDuration);
    notifyBrowsers({ type: 'call_status', callSid: CallSid, status: CallStatus });
  }

  res.sendStatus(200);
}
