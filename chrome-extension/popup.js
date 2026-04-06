const btn = document.getElementById('call-btn');
const text = document.getElementById('btn-text');
const loader = document.getElementById('loader');
const badge = document.getElementById('status-badge');
const subText = document.getElementById('sub-text');

function updateUI(status) {
    console.log(`[Popup] Actualizando UI a estado: ${status}`);
    badge.style.display = 'block';
    badge.innerText = `Estado: ${status}`;
    
    if (status === 'CONNECTING') {
        btn.className = 'state-connecting';
        text.innerText = 'Llamando...';
        loader.style.display = 'block';
        subText.innerText = 'Buscando enlace seguro con Gemini 3.1';
        subText.className = 'pulse-pink';
    } else if (status === 'CONNECTED') {
        btn.className = 'state-connected';
        text.innerText = 'Colgar Llamada';
        loader.style.display = 'none';
        subText.innerText = 'En el aire con Gemini 3.1';
        subText.className = '';
    } else {
        btn.className = 'state-disconnected';
        text.innerText = 'Iniciar Llamada';
        loader.style.display = 'none';
        subText.innerText = 'Conexión con Gemini Multimodal Live establecida.';
        subText.className = '';
    }
}

// Escuchar cambios de estado desde el background
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS_UPDATED') {
        updateUI(msg.status);
    }
});

btn.addEventListener('click', async () => {
    console.log('[Popup] Usuario hizo clic en Iniciar/Colgar');
    
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, async (response) => {
        if (response.status === 'CONNECTED') {
            chrome.runtime.sendMessage({ type: 'HANG_UP' });
        } else {
            try {
                console.log('[Popup] Pidiendo permiso de micro local');
                // Intentar el permiso de micro justo al hacer clic (esto es un gesto del usuario)
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop()); // Solo queremos el permiso
                
                console.log('[Popup] Permiso de micro concedido. Iniciando sesión...');
                chrome.runtime.sendMessage({ type: 'VOICE_START_REQUEST' });
                updateUI('CONNECTING');
            } catch (e) {
                console.error('[Popup] Error de permiso de micro:', e);
                subText.innerText = '¡Necesitas habilitar el micrófono para continuar!';
                subText.style.color = '#ef4444';
            }
        }
    });
});

// Al abrir, preguntar el estado
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response) updateUI(response.status);
});
