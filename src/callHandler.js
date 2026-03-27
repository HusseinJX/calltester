import twilio from 'twilio';
import { generateResponse } from './aiResponder.js';
import { logCall, addMessage, endCall } from './callLogger.js';
import { notifyBrowsers } from './wsState.js';
import { getAnswerMode } from './settings.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

// Persona the tester will play (for AI auto-answer mode)
const TESTER_PERSONA = process.env.TESTER_PERSONA || `You are a potential customer calling about a product or service.
Be natural and conversational. Ask questions, express concerns, and respond like a real person would.
Keep responses brief (1-2 sentences) since this is a phone call.
If asked for personal info, make up realistic but fake details.`;

// Initial greeting when the call connects (for AI mode)
const INITIAL_GREETING = process.env.INITIAL_GREETING || 'Hello?';

export async function handleIncomingCall(req, res) {
  const { CallSid, From, To, CallStatus } = req.body;

  console.log(`\n📞 Incoming call: ${CallSid}`);
  console.log(`   From: ${From} → To: ${To}`);

  logCall(CallSid, { from: From, to: To, status: CallStatus || 'in-progress' });

  // Notify browser so the call list updates / overlay shows in manual mode
  notifyBrowsers({ type: 'incoming', callSid: CallSid, from: From, to: To });

  const mode = getAnswerMode();
  const response = new VoiceResponse();
  const voice = process.env.VOICE || 'Polly.Matthew';

  if (mode === 'ai') {
    // ── AI auto-answer mode (restore original gather-based behavior) ─
    response.say(
      { voice, language: 'en-US' },
      INITIAL_GREETING
    );

    addMessage(CallSid, 'tester', INITIAL_GREETING);

    response.gather({
      input: 'speech',
      action: '/voice/gather',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
      enhanced: true
    });

    response.say(
      { voice },
      "I'm sorry, I didn't catch that. Could you repeat?"
    );

    response.redirect('/voice/incoming');
  } else {
    // ── Manual tester mode: greeting + hold until Accept/Decline ─
    const holdGreeting = process.env.HOLD_GREETING || 'Please hold while we connect you.';
    response.say({ voice }, holdGreeting);
    response.pause({ length: 29 });
    response.redirect({ method: 'POST' }, '/voice/hold');
  }

  res.type('text/xml');
  res.send(response.toString());
}

// ─── AI auto-answer gather handler (used only in AI mode) ────────────────────

export async function handleGather(req, res) {
  const { CallSid, SpeechResult, Confidence } = req.body;

  // No speech detected — redirect back to gather
  if (!SpeechResult) {
    const response = new VoiceResponse();
    response.gather({
      input: 'speech',
      action: '/voice/gather',
      method: 'POST',
      speechTimeout: '1',
      language: 'en-US'
    });
    res.type('text/xml');
    return res.send(response.toString());
  }

  console.log(`\n🎤 Agent said: "${SpeechResult}" (confidence: ${Confidence})`);

  // Log what the AI agent (the business side) said
  addMessage(CallSid, 'agent', SpeechResult);

  const response = new VoiceResponse();

  try {
    // Generate AI "tester" response based on conversation history
    const aiResponse = await generateResponse(CallSid, SpeechResult, TESTER_PERSONA);

    console.log(`🤖 Tester responds: "${aiResponse}"`);

    addMessage(CallSid, 'tester', aiResponse);

    // Check for conversation end signals
    if (shouldEndCall(aiResponse, SpeechResult)) {
      response.say({ voice: process.env.VOICE || 'Polly.Matthew' }, aiResponse);
      response.hangup();
      endCall(CallSid, 'completed');

      res.type('text/xml');
      return res.send(response.toString());
    }

    // Say the response and continue gathering
    response.say({ voice: process.env.VOICE || 'Polly.Matthew' }, aiResponse);

    response.gather({
      input: 'speech',
      action: '/voice/gather',
      method: 'POST',
      speechTimeout: '1',
      language: 'en-US'
    });

    response.say({ voice: process.env.VOICE || 'Polly.Matthew' }, 'Are you still there?');
    response.redirect('/voice/gather');
  } catch (error) {
    console.error('Error generating response:', error);

    response.say({ voice: process.env.VOICE || 'Polly.Matthew' }, "I'm having some trouble hearing you. Could you repeat that?");
    response.gather({
      input: 'speech',
      action: '/voice/gather',
      method: 'POST',
      speechTimeout: 'auto'
    });
  }

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

function shouldEndCall(testerResponse, agentSpeech) {
  const endPhrases = [
    'goodbye', 'bye', 'have a great day', 'take care',
    'thanks for calling', 'thank you for calling', 'end the call'
  ];

  const combined = (testerResponse + ' ' + agentSpeech).toLowerCase();
  return endPhrases.some(phrase => combined.includes(phrase));
}
