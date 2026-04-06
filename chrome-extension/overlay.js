// Estilos inyectados directamente para un diseño futurista (Burbuja Flotante)
const styles = `
  #gemini-voice-bubble {
    position: fixed;
    bottom: 40px;
    right: 40px;
    z-index: 1000000;
    width: 65px;
    height: 65px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    animation: fadeInScale 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  }

  @keyframes fadeInScale {
    0% { transform: scale(0.5); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  .gemini-pulse-container {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: linear-gradient(135deg, #4285F4, #9b72f3, #e879f9);
    box-shadow: 0 0 25px rgba(155, 114, 243, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
  }

  .gemini-wave {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: rgba(155, 114, 243, 0.3);
    animation: geminiPulse 2s infinite ease-out;
    pointer-events: none;
  }

  .gemini-wave:nth-child(2) { animation-delay: 0.6s; }
  .gemini-wave:nth-child(3) { animation-delay: 1.2s; }

  @keyframes geminiPulse {
    0% { transform: scale(1); opacity: 0.8; }
    100% { transform: scale(2.2); opacity: 0; }
  }

  .gemini-mic-icon {
    font-size: 24px;
    color: white;
    z-index: 2;
  }

  /* Tooltip Flotante */
  .gemini-bubble-label {
    position: absolute;
    right: 80px;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 8px 16px;
    border-radius: 30px;
    color: white;
    font-family: system-ui, -apple-system;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    transform: translateX(10px);
    transition: all 0.3s;
    pointer-events: none;
  }

  #gemini-voice-bubble:hover .gemini-bubble-label {
    opacity: 1;
    transform: translateX(0);
  }

  /* Botón de cerrar */
  .gemini-close-bubble {
    position: absolute;
    top: -5px;
    right: -5px;
    background: rgba(0,0,0,0.5);
    color: white;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.2s;
    border: none;
    cursor: pointer;
    z-index: 10;
  }

  #gemini-voice-bubble:hover .gemini-close-bubble {
    opacity: 1;
  }
`;

// Evitar duplicados
if (document.getElementById('gemini-voice-bubble')) {
    document.getElementById('gemini-voice-bubble').remove();
}

// Inyectar Estilos
const styleEl = document.createElement('style');
styleEl.textContent = styles;
document.head.appendChild(styleEl);

// Crear UI de la burbuja
const bubble = document.createElement('div');
bubble.id = 'gemini-voice-bubble';
bubble.innerHTML = `
  <div class="gemini-bubble-label">Escuchando...</div>
  <button class="gemini-close-bubble" id="close-gemini-bubble">✕</button>
  <div class="gemini-pulse-container">
    <div class="gemini-wave"></div>
    <div class="gemini-wave"></div>
    <div class="gemini-wave"></div>
    <svg class="gemini-mic-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>
  </div>
`;

document.body.appendChild(bubble);

// Manejo de eventos
document.getElementById('close-gemini-bubble').onclick = (e) => {
  e.stopPropagation();
  bubble.remove();
  chrome.runtime.sendMessage({ type: 'VOICE_DECLINE' });
};

bubble.onclick = () => {
    // Al hacer click en la burbuja, podemos resetearla o confirmar que estamos hablando
    console.log('[Overlay] Micrófono activo');
    chrome.runtime.sendMessage({ type: 'VOICE_ANSWER' });
};
