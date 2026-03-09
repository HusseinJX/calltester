import twilio from 'twilio';
import { generateResponse } from './aiResponder.js';
import { logCall, addMessage, endCall } from './callLogger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

// Persona the tester will play (customize this)
const TESTER_PERSONA = process.env.TESTER_PERSONA || `You are a potential customer calling about a product or service.
Be natural and conversational. Ask questions, express concerns, and respond like a real person would.
Keep responses brief (1-2 sentences) since this is a phone call.
If asked for personal info, make up realistic but fake details.`;

// Initial greeting when the call connects
const INITIAL_GREETING = process.env.INITIAL_GREETING || "Hello?";

export async function handleIncomingCall(req, res) {
  const { CallSid, From, To, CallStatus } = req.body;

  console.log(`\n📞 Incoming call: ${CallSid}`);
  console.log(`   From: ${From} → To: ${To}`);

  // Log the new call
  logCall(CallSid, { from: From, to: To, status: CallStatus });

  const response = new VoiceResponse();

  // Say initial greeting
  response.say({
    voice: process.env.VOICE || 'Polly.Matthew',
    language: 'en-US'
  }, INITIAL_GREETING);

  addMessage(CallSid, 'tester', INITIAL_GREETING);

  // Gather speech input from the AI agent
  const gather = response.gather({
    input: 'speech',
    action: '/voice/gather',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'en-US',
    enhanced: true
  });

  // If no input, prompt again
  response.say({
    voice: process.env.VOICE || 'Polly.Matthew'
  }, "I'm sorry, I didn't catch that. Could you repeat?");

  response.redirect('/voice/incoming');

  res.type('text/xml');
  res.send(response.toString());
}

export async function handleGather(req, res) {
  const { CallSid, SpeechResult, Confidence } = req.body;

  // No speech detected — redirect back to gather
  if (!SpeechResult) {
    const response = new VoiceResponse();
    response.gather({
      input: 'speech',
      action: '/voice/gather',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
      enhanced: true
    });
    res.type('text/xml');
    return res.send(response.toString());
  }

  console.log(`\n🎤 Agent said: "${SpeechResult}" (confidence: ${Confidence})`);

  // Log what the AI agent said
  addMessage(CallSid, 'agent', SpeechResult);

  const response = new VoiceResponse();

  try {
    // Generate AI response based on conversation
    const aiResponse = await generateResponse(CallSid, SpeechResult, TESTER_PERSONA);

    console.log(`🤖 Tester responds: "${aiResponse}"`);

    // Log tester response
    addMessage(CallSid, 'tester', aiResponse);

    // Check for conversation end signals
    if (shouldEndCall(aiResponse, SpeechResult)) {
      response.say({
        voice: process.env.VOICE || 'Polly.Matthew'
      }, aiResponse);
      response.hangup();

      endCall(CallSid, 'completed');

      res.type('text/xml');
      return res.send(response.toString());
    }

    // Say the response
    response.say({
      voice: process.env.VOICE || 'Polly.Matthew'
    }, aiResponse);

    // Continue gathering speech
    const gather = response.gather({
      input: 'speech',
      action: '/voice/gather',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
      enhanced: true
    });

    // Fallback if no speech detected
    response.say({
      voice: process.env.VOICE || 'Polly.Matthew'
    }, "Are you still there?");
    response.redirect('/voice/gather');

  } catch (error) {
    console.error('Error generating response:', error);

    response.say({
      voice: process.env.VOICE || 'Polly.Matthew'
    }, "I'm having some trouble hearing you. Could you repeat that?");

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

export function handleCallStatus(req, res) {
  const { CallSid, CallStatus, CallDuration } = req.body;

  console.log(`\n📊 Call ${CallSid} status: ${CallStatus} (duration: ${CallDuration}s)`);

  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'no-answer') {
    endCall(CallSid, CallStatus, CallDuration);
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
