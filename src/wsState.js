// Shared WebSocket state between index.js and callHandler.js

export const mediaSockets = new Map(); // callSid → Twilio WS
export const browserSockets = new Set(); // Browser WS clients

export function notifyBrowsers(msg) {
  const data = JSON.stringify(msg);
  for (const ws of browserSockets) {
    if (ws.readyState === 1) ws.send(data);
  }
}
