let socket = null;
let callStatus = 'DISCONNECTED'; // 'DISCONNECTED', 'CONNECTING', 'CONNECTED'

function connectToRelay() {
  socket = new WebSocket('ws://127.0.0.1:8081');
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'INCOMING_CALL' || data.type === 'TASK_COMPLETED') {
      showCallOverlay(data);
    } else if (data.type === 'AUDIO_CHUNK') {
      if (callStatus === 'CONNECTING') {
          callStatus = 'CONNECTED';
          chrome.runtime.sendMessage({ type: 'STATUS_UPDATED', status: 'CONNECTED' });
          chrome.runtime.sendMessage({ type: 'STOP_RING' });
          showCallOverlay();
      }
      chrome.runtime.sendMessage(data);
    }
  };
  socket.onclose = () => setTimeout(connectToRelay, 5000);
}

async function showCallOverlay(data) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && !tab.url.startsWith('chrome://')) {
    if (data) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (payload) => { window.lastGeminiMessage = payload; },
        args: [data]
      });
    }
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
  }
}

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({ status: callStatus });
  } else if (message.type === 'VOICE_START_REQUEST') {
    callStatus = 'CONNECTING';
    await startOffscreenAudio();
    chrome.runtime.sendMessage({ type: 'START_MIC' });
    chrome.runtime.sendMessage({ type: 'PLAY_RING' }); // Iniciar trino

  } else if (message.type === 'VOICE_DECLINE' || message.type === 'HANG_UP') {
    callStatus = 'DISCONNECTED';
    if (socket) socket.send(JSON.stringify({ type: 'CALL_DECLINED' }));
    chrome.runtime.sendMessage({ type: 'STOP_AUDIO' });
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATED', status: 'DISCONNECTED' });
  } else if (message.type === 'USER_ACTIVITY') {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
  }
  return true;
});

async function startOffscreenAudio() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
    justification: 'Gestión de audio para Gemini Live'
  });
}

connectToRelay();
