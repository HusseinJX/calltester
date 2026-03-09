import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '../logs');

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR);

// In-memory cache
const callLogs = new Map();

// Load all existing logs from disk on startup
for (const file of readdirSync(LOGS_DIR)) {
  if (!file.endsWith('.json')) continue;
  try {
    const data = JSON.parse(readFileSync(join(LOGS_DIR, file), 'utf8'));
    callLogs.set(data.callSid, data);
  } catch {}
}
console.log(`📂 Loaded ${callLogs.size} call log(s) from disk`);

function save(call) {
  writeFileSync(join(LOGS_DIR, `${call.callSid}.json`), JSON.stringify(call, null, 2));
}

export function logCall(callSid, metadata) {
  const call = {
    callSid,
    startTime: new Date().toISOString(),
    endTime: null,
    duration: null,
    status: 'in-progress',
    ...metadata,
    messages: []
  };
  callLogs.set(callSid, call);
  save(call);
  console.log(`📝 Logging new call: ${callSid}`);
}

export function addMessage(callSid, role, content) {
  const call = callLogs.get(callSid);
  if (!call) return;
  call.messages.push({ role, content, timestamp: new Date().toISOString() });
  save(call);
}

export function endCall(callSid, status, duration = null) {
  const call = callLogs.get(callSid);
  if (!call) return;
  call.endTime = new Date().toISOString();
  call.status = status;
  call.duration = duration;
  save(call);

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`📋 CALL TRANSCRIPT: ${callSid}`);
  console.log(`═══════════════════════════════════════════════`);
  console.log(`Duration: ${duration}s | Status: ${status}`);
  console.log(`───────────────────────────────────────────────`);
  call.messages.forEach(msg => {
    console.log(`${msg.role === 'agent' ? '🤖 AI Agent' : '🧪 Tester'}: ${msg.content}`);
  });
  console.log(`═══════════════════════════════════════════════\n`);
}

export function getCallLogs() {
  return Array.from(callLogs.values())
    .map(call => ({
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
