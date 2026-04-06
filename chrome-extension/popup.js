document.getElementById('call-btn').addEventListener('click', async () => {
    const btn = document.getElementById('call-btn');
    const text = document.getElementById('btn-text');
    const loader = document.getElementById('loader');
    const msg = document.getElementById('status-msg');

    // Cambiar estado a cargando
    text.style.display = 'none';
    loader.style.display = 'block';
    msg.style.display = 'block';
    btn.style.background = '#334155';
    btn.style.pointerEvents = 'none';

    // Avisar al background script para que inicie Gemini
    chrome.runtime.sendMessage({ type: 'VOICE_START_REQUEST' });

    // Cerramos el popup después de 5 segundos para que la burbuja se inyecte en el tab
    setTimeout(() => {
        window.close();
    }, 5000);
});
