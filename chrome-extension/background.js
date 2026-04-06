let socket = null;
let callStatus = 'DISCONNECTED'; // 'DISCONNECTED', 'CONNECTING', 'CONNECTED'

// Conexión constante al Relay Local para recibir llamadas y resultados
function connectToRelay() {
  console.log('[Background] Intentando conectar al Relay en 8081...');
  socket = new WebSocket('ws://127.0.0.1:8081');

  socket.onopen = () => {
    console.log('[Background] Conexión abierta con el Relay Local ✅');
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(`[Background] Mensaje de Relay: ${data.type}`);
    
    if (data.type === 'INCOMING_CALL' || data.type === 'TASK_COMPLETED') {
      showCallOverlay(data);
    } else if (data.type === 'AUDIO_CHUNK') {
      // Si Gemini empieza a hablar, mostramos la burbuja
      if (callStatus === 'CONNECTING') {
          console.log('[Background] Primer audio recibido. Cambiando a CONNECTED y mostrando burbuja.');
          callStatus = 'CONNECTED';
          chrome.runtime.sendMessage({ type: 'STATUS_UPDATED', status: 'CONNECTED' });
          chrome.runtime.sendMessage({ type: 'STOP_RING' });
          showCallOverlay();
      }
      // Reenviar voz de Gemini al Offscreen para reproducirla
      chrome.runtime.sendMessage(data);
    }
  };

  socket.onerror = (err) => {
    console.error('[Background] Error en socket con el Relay:', err);
    setTimeout(connectToRelay, 5000);
  };
  socket.onclose = () => {
    console.log('[Background] Conexión cerrada con el Relay ❌');
    setTimeout(connectToRelay, 5000);
  }
}

// Inyectar el overlay visual en la pestaña actual
async function showCallOverlay(data) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && !tab.url.startsWith('chrome://')) {
    console.log(`[Background] Inyectando overlay en la pestaña: ${tab.id}`);
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
  } else {
    console.log('[Background] No se puede inyectar overlay en páginas del sistema o pestañas vacías.');
  }
}

// Manejar los mensajes de la UI, del Popup y del Content Script (Activity)
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    sendResponse({ status: callStatus });
  } else if (message.type === 'VOICE_START_REQUEST') {
    console.log('[Background] Iniciando sesión por petición del Popup');
    callStatus = 'CONNECTING';
    await startOffscreenAudio();
    chrome.runtime.sendMessage({ type: 'PLAY_RING' });

  } else if (message.type === 'PCM_CHUNK') {
    // REENVIAR AUDIO DEL MICRÓFONO (DESDE EL TAB) AL RELAY
    const buffer = Uint8Array.from(atob(message.data), c => c.charCodeAt(0)).buffer;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(buffer);
    }

  } else if (message.type === 'VOICE_ANSWER') {
    console.log('[Background] Usuario contestó desde la burbuja');
    chrome.runtime.sendMessage({ type: 'STOP_RING' });
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'VOICE_ANSWER' }));
    }

  } else if (message.type === 'HANG_UP') {
    console.log('[Background] Solicitud de colgar recibida');
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
  const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existingContexts.length > 0) {
    console.log('[Background] Offscreen ya existe ✅');
    return;
  }
  console.log('[Background] Creando documento Offscreen...');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Reproducción de voz de Gemini'
  });
}

connectToRelay();
