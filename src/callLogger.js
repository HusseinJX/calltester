// In-memory storage for call logs
const callLogs = new Map();

export function logCall(callSid, metadata) {
  callLogs.set(callSid, {
    callSid,
    startTime: new Date().toISOString(),
    endTime: null,
    duration: null,
    status: 'in-progress',
    ...metadata,
    messages: []
  });

  console.log(`📝 Logging new call: ${callSid}`);
}

export function addMessage(callSid, role, content) {
  const call = callLogs.get(callSid);
  if (call) {
    call.messages.push({
      role,
      content,
      timestamp: new Date().toISOString()
    });
  }
}

export function endCall(callSid, status, duration = null) {
  const call = callLogs.get(callSid);
  if (call) {
    call.endTime = new Date().toISOString();
    call.status = status;
    call.duration = duration;

    console.log(`\n═══════════════════════════════════════════════`);
    console.log(`📋 CALL TRANSCRIPT: ${callSid}`);
    console.log(`═══════════════════════════════════════════════`);
    console.log(`Duration: ${duration}s | Status: ${status}`);
    console.log(`───────────────────────────────────────────────`);

    call.messages.forEach(msg => {
      const label = msg.role === 'agent' ? '🤖 AI Agent' : '🧪 Tester';
      console.log(`${label}: ${msg.content}`);
    });

    console.log(`═══════════════════════════════════════════════\n`);
  }
}

export function getCallLogs() {
  return Array.from(callLogs.values()).map(call => ({
    callSid: call.callSid,
    from: call.from,
    to: call.to,
    startTime: call.startTime,
    endTime: call.endTime,
    duration: call.duration,
    status: call.status,
    messageCount: call.messages.length
  }));
}

export function getCallDetails(callSid) {
  return callLogs.get(callSid) || null;
}
