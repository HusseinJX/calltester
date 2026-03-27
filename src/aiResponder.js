import OpenAI from 'openai';
import { getCallDetails } from './callLogger.js';

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openai;
}

export async function generateResponse(callSid, agentMessage, persona) {
  const callData = getCallDetails(callSid);
  const conversationHistory = callData?.messages || [];

  // Build messages — exclude the last entry since it's the agent message
  // we're about to respond to (already added to history before this call)
  const history = conversationHistory.slice(0, -1);

//   const messages = [
//     {
//       role: 'system',
//       content: `${persona}

// CRITICAL: This is a phone call. Your response must be 1-5 words maximum. No exceptions.
// - Answer questions with the shortest possible reply: "Yes.", "No.", "Sure.", "Uh huh.", "How much?", "Okay."
// - Never explain or elaborate
// - No emojis, no special characters
// - If you want to end the call, just say "Bye bye."`
//     }
//   ];

  const messages = [
      {
        role: 'system',
        content: `${persona}
  
  CRITICAL: This is a phone call. Your response must be 1-5 words maximum. No exceptions.
  - Answer questions in Gen Z slang, be funny and sarcastic
  - If you want to end the call, just say "Bye bye."`
      }
    ];

  history.forEach(msg => {
    messages.push({
      role: msg.role === 'tester' ? 'assistant' : 'user',
      content: msg.content ?? ''
    });
  });

  messages.push({ role: 'user', content: agentMessage });

  console.log(`\n🧠 Sending to OpenAI (${messages.length} messages, model: ${process.env.AI_MODEL || 'gpt-4o'})`);

  const response = await getClient().chat.completions.create({
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    max_tokens: 30,
    messages
  });

  const reply = response.choices[0].message.content;
  console.log(`✅ OpenAI replied: "${reply}"`);
  return reply;
}
