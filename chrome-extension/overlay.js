// Estilos inyectados directamente para no depender de archivos externos
const styles = `
  #gemini-voice-overlay {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000000;
    width: 320px;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(15px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 20px;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: white;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.5s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  }

  @keyframes slideIn {
    from { transform: translateX(120%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  .gemini-status {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1px;
    opacity: 0.8;
    margin-bottom: 8px;
  }

  .gemini-call-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 20px;
    background: linear-gradient(90deg, #4285F4, #9159f8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .gemini-controls {
    display: flex;
    gap: 12px;
  }

  .gemini-btn {
    flex: 1;
    padding: 12px;
    border: none;
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .gemini-btn-answer {
    background: #4CAF50;
    color: white;
  }

  .gemini-btn-decline {
    background: #f44336;
    color: white;
  }

  .gemini-btn:hover {
    transform: translateY(-2px);
    filter: brightness(1.1);
  }
`;

// Crear y añadir el estilo
const styleEl = document.createElement('style');
styleEl.textContent = styles;
document.head.appendChild(styleEl);

// Crear el elemento de UI
const container = document.createElement('div');
container.id = 'gemini-voice-overlay';
container.innerHTML = `
  <div class="gemini-status">Llamada Entrante...</div>
  <div class="gemini-call-title">Gemini Voice Bridge</div>
  <div class="gemini-controls">
    <button class="gemini-btn gemini-btn-answer" id="answer-call">Contestar</button>
    <button class="gemini-btn gemini-btn-decline" id="decline-call">Colgar</button>
  </div>
`;

document.body.appendChild(container);

// Manejo de eventos
document.getElementById('answer-call').onclick = () => {
  chrome.runtime.sendMessage({ type: 'VOICE_ANSWER' });
  container.remove();
};

document.getElementById('decline-call').onclick = () => {
  chrome.runtime.sendMessage({ type: 'VOICE_DECLINE' });
  container.remove();
};
