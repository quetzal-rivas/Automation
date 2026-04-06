let socket = null;

// Intentar conectar al Relay local vía WebSocket
function connectToRelay() {
  socket = new WebSocket('ws://127.0.0.1:8081');

  socket.onopen = () => {
    console.log('[Bridge] Conectado al Relay Local');
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'INCOMING_CALL') {
      showCallOverlay();
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
async function showCallOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['overlay.js']
    });
  }
}

// Manejar los mensajes de la UI (Contestar / Colgar)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VOICE_ANSWER') {
    startOffscreenAudio();
  } else if (message.type === 'VOICE_DECLINE') {
    if (socket) socket.send(JSON.stringify({ type: 'CALL_DECLINED' }));
  }
});

// Lanzar el audio en segundo plano (para acceso a micro)
async function startOffscreenAudio() {
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
    justification: 'Comunicación por voz con Gemini'
  });
}

// Iniciar conexión al cargar
connectToRelay();
