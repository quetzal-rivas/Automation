const btn = document.getElementById('call-btn');
const text = document.getElementById('btn-text');
const loader = document.getElementById('loader');
const badge = document.getElementById('status-badge');
const subText = document.getElementById('sub-text');

function updateUI(status) {
    badge.style.display = 'block';
    badge.innerText = `Estado: ${status}`;
    
    if (status === 'CONNECTING') {
        btn.className = 'state-connecting';
        text.innerText = 'Buscando enlace...';
        loader.style.display = 'block';
        subText.innerText = 'Escucha el timbre... estableciendo canal.';
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

// Al abrir el popup, pedimos el estado actual
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) updateUI(response.status);
});

// Escuchar cambios de estado desde el background
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS_UPDATED') {
        updateUI(msg.status);
    }
});

btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
        if (response.status === 'CONNECTED') {
            chrome.runtime.sendMessage({ type: 'HANG_UP' });
        } else if (response.status === 'DISCONNECTED') {
            chrome.runtime.sendMessage({ type: 'VOICE_START_REQUEST' });
            updateUI('CONNECTING');
        }
    });
});

document.getElementById('perm-hint').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    subText.innerText = '¡Micrófono configurado correctamente!';
    subText.style.color = '#22c55e';
    document.getElementById('perm-hint').style.display = 'none';
  } catch (e) {
    subText.innerText = 'Error al pedir permiso de micrófono.';
    subText.style.color = '#ef4444';
  }
});
