// Estilos inyectados directamente para un diseño futurista (Burbuja Flotante)
const styles = `
  #gemini-voice-bubble {
    position: fixed !important; bottom: 50px !important; right: 50px !important; z-index: 2147483647 !important;
    width: 70px; height: 70px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; animation: fadeInScale 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  }
  .bubble-main {
    position: relative; width: 60px; height: 60px; border-radius: 50%;
    background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(12px); border: 2px solid rgba(155, 114, 243, 0.4);
    display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
  }
  .pulse-ring {
    position: absolute; width: 100%; height: 100%; border-radius: 50%;
    background: radial-gradient(circle, rgba(167,139,250,0.6) 0%, transparent 70%);
    animation: bubble-pulse 2s infinite ease-out;
  }
  .bubble-inner {
    width: 25px; height: 25px; border-radius: 50%;
    background: #a78bfa; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  #gemini-voice-bubble.success .bubble-inner { background: #22c55e; box-shadow: 0 0 15px #22c55e; }
  @keyframes bubble-pulse { 0% { transform: scale(0.9); opacity: 0.8; } 100% { transform: scale(1.6); opacity: 0; } }
  @keyframes fadeInScale { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
`;

function injectStyles() {
    if (!document.getElementById('gemini-overlay-styles')) {
        const styleSheet = document.createElement("style");
        styleSheet.id = 'gemini-overlay-styles';
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);
    }
}

let micStream = null;
let micContext = null;

async function startMicCapture() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
    micContext = new AudioContext({ sampleRate: 16000 });
    const source = micContext.createMediaStreamSource(micStream);
    const processor = micContext.createScriptProcessor(4096, 1, 1);
    
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      chrome.runtime.sendMessage({ type: 'PCM_CHUNK', data: btoa(String.fromCharCode(...new Uint8Array(pcm.buffer))) });
    };

    source.connect(processor);
    processor.connect(micContext.destination);
    console.log('[Overlay] Micrófono de pestaña activado');
  } catch (err) {
    console.error('[Overlay] Error al activar micro:', err);
  }
}

function createBubbleUI() {
    if (document.getElementById('gemini-voice-bubble')) return;

    const container = document.createElement('div');
    container.id = 'gemini-voice-bubble';
    container.innerHTML = `<div class="pulse-ring"></div><div class="bubble-main"><div class="bubble-inner"></div></div>`;
    document.body.appendChild(container);

    container.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'VOICE_ANSWER' });
        startMicCapture(); // Activar micro localmente al contestar
    });
}

function showResult(resultText) {
    const bubble = document.getElementById('gemini-voice-bubble');
    if (bubble) bubble.classList.add('success');
    console.log('[Overlay] Tarea completada:', resultText);
}

injectStyles();
createBubbleUI();

if (window.lastGeminiMessage && window.lastGeminiMessage.type === 'TASK_COMPLETED') {
    showResult(window.lastGeminiMessage.result);
}
