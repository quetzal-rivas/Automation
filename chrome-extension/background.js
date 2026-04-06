let socket = null;

// Intentar conectar al Relay local vía WebSocket
function connectToRelay() {
  socket = new WebSocket('ws://127.0.0.1:8081');

  socket.onopen = () => {
    console.log('[Bridge] Conectado al Relay Local');
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'INCOMING_CALL' || data.type === 'TASK_COMPLETED') {
      showCallOverlay(data);
    } else if (data.type === 'AUDIO_CHUNK') {
      // Si estamos esperando el primer audio tras el popup, mostramos la burbuja
      if (isWaitingForFirstAudio) {
          isWaitingForFirstAudio = false;
          showCallOverlay();
      }
      // Reenviar a offscreen para reproducción
      chrome.runtime.sendMessage(data);
    }
  };

  socket.onerror = (error) => {
    console.error('[Bridge] Error de conexión:', error);
    setTimeout(connectToRelay, 5000); // Reintentar
  };

  socket.onclose = () => {
    console.log('[Bridge] Conexión cerrada');
    setTimeout(connectToRelay, 5000);
  };
}

// Inyectar el overlay visual en la pestaña actual
async function showCallOverlay(data) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    if (data) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (payload) => { window.lastGeminiMessage = payload; },
        args: [data]
      });
      // Iniciar el timbre si es una llamada entrante
      if (data.type === 'INCOMING_CALL') {
          await startOffscreenAudio();
          chrome.runtime.sendMessage({ type: 'PLAY_RING' });
      }
    }
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['overlay.js']
    });
  }
}

// Manejar los mensajes de la UI, del Popup y del Content Script (Activity)
let lastActivityTime = Date.now();
let isWaitingForFirstAudio = false;

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'VOICE_START_REQUEST') {
    console.log('[Bridge] Iniciando sesión desde el Popup');
    isWaitingForFirstAudio = true;
    await startOffscreenAudio();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'VOICE_START' }));
    }
    
  } else if (message.type === 'VOICE_ANSWER') {
    chrome.runtime.sendMessage({ type: 'STOP_RING' });
    chrome.runtime.sendMessage({ type: 'START_MIC' });
  } else if (message.type === 'VOICE_DECLINE') {
    chrome.runtime.sendMessage({ type: 'STOP_RING' });
    if (socket) socket.send(JSON.stringify({ type: 'CALL_DECLINED' }));
  } else if (message.type === 'USER_ACTIVITY') {
    lastActivityTime = Date.now();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
    }
  }
});

// Lanzar el audio en segundo plano (para acceso a micro)
async function startOffscreenAudio() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
    justification: 'Comunicación por voz con Gemini y timbre de llamada'
  });
}

// Iniciar conexión al cargar
connectToRelay();
