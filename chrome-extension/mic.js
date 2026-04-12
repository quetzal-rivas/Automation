let micStream;
let micContext;
let analyser;
let bufferLength;
let dataArray;
let canvas = document.getElementById('canvas');
let ctx = canvas.getContext('2d');
let isPaused = false;
let drawAnimationId;
let micEnabled = false;
let lastActiveTime = Date.now();
const SILENCE_THRESHOLD = 15; // Más sensible para que capte mejor tu voz
const SILENCE_TIMEOUT = 10000; // 10 seconds

async function startMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
    micContext = new AudioContext({ sampleRate: 16000 });
    
    // CARGAR EL WORKLET MODERNO (Abril 2026 Ready)
    await micContext.audioWorklet.addModule('pcm-processor.js');
    console.log('[Motor Mic] AudioWorklet Cargado ✅');

    analyser = micContext.createAnalyser();
    analyser.fftSize = 256;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    const source = micContext.createMediaStreamSource(micStream);
    const processorNode = new AudioWorkletNode(micContext, 'pcm-processor');

    // Recibir PCM desde el hilo del Worklet
    processorNode.port.onmessage = (event) => {
      if (isPaused || !micEnabled) return;

      // Calcular volumen promedio desde el analyser (0-255)
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const volume = sum / bufferLength;

      // Gate: Solo enviar si superamos el umbral
      if (volume > SILENCE_THRESHOLD) {
          lastActiveTime = Date.now();
          const pcmBuffer = event.data;
          chrome.runtime.sendMessage({ 
              type: 'PCM_CHUNK', 
              data: btoa(String.fromCharCode(...new Uint8Array(pcmBuffer))) 
          });
      } else {
          // Detección de silencio prolongado
          if (Date.now() - lastActiveTime > SILENCE_TIMEOUT) {
              console.log('[Motor Mic] Silencio detectado (10s). Enviando auto-continuación...');
              lastActiveTime = Date.now(); // Reset para no spamear
              chrome.runtime.sendMessage({ type: 'USER_SILENT_CONTINUE' });
          }
      }
    };

    source.connect(analyser); // Para el visualizador
    source.connect(processorNode); // Para enviar a Gemini
    processorNode.connect(micContext.destination);

    draw();
    console.log('[Motor Mic] Captura Worklet Iniciada ⚡');
  } catch (err) {
    console.error('[Motor Mic] Error:', err);
    document.getElementById('state-text').innerText = 'ERROR EN MICRO: ' + err;
  }
}

function draw() {
  drawAnimationId = requestAnimationFrame(draw);
  if (!analyser) return;
  analyser.getByteFrequencyData(dataArray);

  // Calcular volumen promedio para el feedback visual del Gate
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
  const averageVolume = sum / bufferLength;
  const isBelowGate = averageVolume < SILENCE_THRESHOLD;

  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const barWidth = (canvas.width / bufferLength) * 2.5;
  let barHeight;
  let x = 0;

  for(let i = 0; i < bufferLength; i++) {
    barHeight = dataArray[i] / 2;
    // Lógica de color según estado
    if (isPaused) {
        barHeight = (Math.sin(Date.now() / 500 + i) * 10) + 15; // Animación 'breathe' falsa
        ctx.fillStyle = `rgb(80, 80, 90)`;
    } else if (!micEnabled) {
        barHeight = dataArray[i] / 4; // Mic desactivado, barras pequeñas
        ctx.fillStyle = `rgb(60, 70, 100)`;
    } else if (isBelowGate) {
        ctx.fillStyle = `rgb(71, 85, 105)`; // Gris (Slate-600) cuando no detecta sonido suficiente
    } else {
        ctx.fillStyle = `rgb(${barHeight + 100}, 130, 255)`; // Neón azul cuando detecta voz
    }
    
    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
}

// Escuchar para eventos de control de Mic y UI Stateless
chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === 'STOP_AUDIO') {
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        window.close();
    } else if (msg.type === 'PAUSE_MIC') {
        console.log('[Motor Mic] Pausando Hardware...');
        isPaused = true;
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        document.querySelector('.label').innerText = "Antigravity Procesando...";
        document.querySelector('.mic-icon').style.animation = "none";
        document.querySelector('.mic-icon').style.borderColor = "#475569";
        document.querySelector('.mic-icon').style.boxShadow = "none";
    } else if (msg.type === 'RESUME_MIC') {
        console.log('[Motor Mic] Reanudando Hardware!');
        isPaused = false;
        micEnabled = false; // Reset gate
        document.querySelector('.label').innerText = "Gemini Live activo";
        document.querySelector('.mic-icon').style.animation = "breathe 3s infinite";
        document.querySelector('.mic-icon').style.borderColor = "#a855f7";
        await startMic();
    } else if (msg.type === 'ENABLE_MIC_INPUT') {
        console.log('[Motor Mic] Turno de Gemini terminado. Micrófono ABIERTO 🎙️');
        micEnabled = true;
        lastActiveTime = Date.now(); // Empezar cuenta de 10s ahora
    }
});

startMic();
