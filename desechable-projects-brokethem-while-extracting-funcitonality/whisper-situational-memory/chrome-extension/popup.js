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
        subText.innerText = 'Abriendo Motor de Voz...';
    } else if (status === 'CONNECTED') {
        btn.className = 'state-connected';
        text.innerText = 'Colgar Llamada';
        loader.style.display = 'none';
        subText.innerText = 'En el aire con Gemini 3.1';
    } else {
        btn.className = 'state-disconnected';
        text.innerText = 'Iniciar Llamada';
        loader.style.display = 'none';
        subText.innerText = 'Pulse para conectar con Antigravity';
    }
}

// Escuchar cambios de estado desde el background
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS_UPDATED') {
        updateUI(msg.status);
    }
});

btn.addEventListener('click', async () => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, async (response) => {
        if (response && response.status === 'CONNECTED') {
            chrome.runtime.sendMessage({ type: 'HANG_UP' });
        } else {
            console.log('[Popup] Abriendo Motor de Voz en pestaña fija...');
            // ABRIR TAB DEL MOTOR DE VOZ INMEDIATAMENTE
            chrome.tabs.create({ url: chrome.runtime.getURL('mic.html'), pinned: true });
            
            // AVISAR AL BACKGROUND
            chrome.runtime.sendMessage({ type: 'VOICE_START_REQUEST' });
            updateUI('CONNECTING');
        }
    });
});

// Al abrir, preguntar el estado
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
  if (response) updateUI(response.status);
});
