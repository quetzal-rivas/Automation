let socket = null;
let callStatus = 'DISCONNECTED'; // 'DISCONNECTED', 'CONNECTING', 'CONNECTED'
let isFirstTurn = true;

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
    
    if (data.type === 'END_CALL') {
      console.log('[Background] Relay solicita pausa (Stateless Mode). Suspendiendo UI...');
      callStatus = 'PROCESSING';
      chrome.runtime.sendMessage({ type: 'PAUSE_MIC' });
      chrome.runtime.sendMessage({ type: 'STATUS_UPDATED', status: 'PROCESSING' });
    } else if (data.type === 'INCOMING_CALL' || data.type === 'TASK_COMPLETED') {
      showCallOverlay(data);
    } else if (data.type === 'AUDIO_CHUNK') {
      // Si Gemini empieza a hablar, mostramos la burbuja
      if (callStatus === 'CONNECTING') {
          console.log('[Background] Primer audio recibido. Cambiando a CONNECTED.');
          callStatus = 'CONNECTED';
          chrome.runtime.sendMessage({ type: 'STATUS_UPDATED', status: 'CONNECTED' });
          chrome.runtime.sendMessage({ type: 'STOP_RING' });
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

// Lanzar la pestaña/ventana del micrófono cuando llama el IDE
async function showCallOverlay(data) {
  console.log('[Background] El IDE está llamando. Abriendo ventana de micrófono...');
  
  // Opcional: asegurarnos de que el offscreen module esté activo para el audio fallback si hace falta
  await startOffscreenAudio();
  chrome.runtime.sendMessage({ type: 'PLAY_SINGLE_RING' });
  
  // SOLUCIÓN DE TABS DUPLICADAS
  const extensionUrl = chrome.runtime.getURL('mic.html');
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find(t => t.url && t.url.startsWith(extensionUrl));
  
  if (existingTab) {
      console.log('[Background] Pestaña mic.html ya existe, enfocándola y reanudando MIC...');
      await chrome.tabs.update(existingTab.id, { active: true });
      await chrome.windows.update(existingTab.windowId, { focused: true });
      chrome.runtime.sendMessage({ type: 'RESUME_MIC' });
  } else {
      console.log('[Background] Creando nueva pestaña de mic.html...');
      chrome.tabs.create({ url: 'mic.html', active: true });
  }

  // Autocontestar la llamada de inmediato (Auto-Answer) para iniciar Gemini
  callStatus = 'CONNECTING';
  isFirstTurn = true; // Reset turn for new session
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'VOICE_START' }));
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

    // ESTO FALTABA: Avisar al Relay que despierte a Gemini
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log('[Background] Enviando VOICE_START al Relay local');
        socket.send(JSON.stringify({ type: 'VOICE_START' }));
    } else {
        console.error('[Background] El socket del Relay NO está abierto');
    }

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
  } else if (message.type === 'PLAYBACK_FINISHED') {
    if (isFirstTurn) {
        console.log('[Background] First turn finished. Enabling Mic UI...');
        isFirstTurn = false;
        chrome.runtime.sendMessage({ type: 'ENABLE_MIC_INPUT' });
    }
  } else if (message.type === 'USER_SILENT_CONTINUE') {
    console.log('[Background] User silent for 10s. Injecting auto-continue text.');
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ 
            type: 'INJECT_TEXT', 
            text: "user has skipped it turn to speak continue speaking as if the user is listening but unable to respon" 
        }));
    }
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
