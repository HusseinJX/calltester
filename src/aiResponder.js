import Anthropic from '@anthropic-ai/sdk';
import { getCallDetails } from './callLogger.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function generateResponse(callSid, agentMessage, persona) {
  const callData = getCallDetails(callSid);
  const conversationHistory = callData?.messages || [];

  // Build conversation context for Claude
  const messages = conversationHistory.map(msg => ({
    role: msg.role === 'tester' ? 'assistant' : 'user',
    content: msg.content
  }));

  // Add the latest agent message
  messages.push({
    role: 'user',
    content: agentMessage
  });

  try {
    const response = await anthropic.messages.create({
      model: process.env.AI_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: `${persona}

IMPORTANT RULES:
- Keep responses SHORT (1-2 sentences max) - this is a phone call
- Be conversational and natural
- Don't use emojis or special characters
- Don't say "um" or "uh" - just speak naturally
- If the agent asks a question, answer it directly
- If you want to end the call naturally, say goodbye`,
      messages: messages
    });

    return response.content[0].text;
  } catch (error) {
    console.error('AI Error:', error.message);

    // Fallback responses
    const fallbacks = [
      "Could you tell me more about that?",
      "I see, go on.",
      "That's interesting.",
      "Okay, what else can you tell me?"
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}
