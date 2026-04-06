let socket = null;
let isWaitingForFirstAudio = false;

// Conexión constante al Relay Local para recibir llamadas y resultados
function connectToRelay() {
  socket = new WebSocket('ws://127.0.0.1:8081');

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'INCOMING_CALL' || data.type === 'TASK_COMPLETED') {
      showCallOverlay(data);
    } else if (data.type === 'AUDIO_CHUNK') {
      // Si Gemini empieza a hablar, mostramos la burbuja
      if (isWaitingForFirstAudio) {
          isWaitingForFirstAudio = false;
          showCallOverlay();
      }
      chrome.runtime.sendMessage(data);
    }
  };

  socket.onerror = () => setTimeout(connectToRelay, 5000);
  socket.onclose = () => setTimeout(connectToRelay, 5000);
}

// Mostrar UI Flotante
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

// Manejar mensajes internos
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'VOICE_START_REQUEST') {
    isWaitingForFirstAudio = true;
    await startOffscreenAudio();
    // Avisar al offscreen que inicie el micro y la conexión al relay
    chrome.runtime.sendMessage({ type: 'START_MIC' });

  } else if (message.type === 'VOICE_ANSWER') {
    chrome.runtime.sendMessage({ type: 'START_MIC' });
  } else if (message.type === 'VOICE_DECLINE') {
    if (socket) socket.send(JSON.stringify({ type: 'CALL_DECLINED' }));
    chrome.runtime.sendMessage({ type: 'STOP_AUDIO' });
  } else if (message.type === 'USER_ACTIVITY') {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
  }
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
