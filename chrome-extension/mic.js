let micStream;
let micContext;
let analyser;
let bufferLength;
let dataArray;
let canvas = document.getElementById('canvas');
let ctx = canvas.getContext('2d');
let isPaused = false;
let drawAnimationId;

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
      const pcmBuffer = event.data;
      chrome.runtime.sendMessage({ 
          type: 'PCM_CHUNK', 
          data: btoa(String.fromCharCode(...new Uint8Array(pcmBuffer))) 
      });
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

  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const barWidth = (canvas.width / bufferLength) * 2.5;
  let barHeight;
  let x = 0;

  for(let i = 0; i < bufferLength; i++) {
    barHeight = dataArray[i] / 2;
    // Si estamos en modo PROCESSING, dibujamos una onda fantasmal plana o grisácea 
    if (isPaused) {
        barHeight = (Math.sin(Date.now() / 500 + i) * 10) + 15; // Animación 'breathe' falsa
        ctx.fillStyle = `rgb(80, 80, 90)`;
    } else {
        ctx.fillStyle = `rgb(${barHeight + 100}, 130, 255)`;
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
        document.querySelector('.label').innerText = "Gemini Live activo";
        document.querySelector('.mic-icon').style.animation = "breathe 3s infinite";
        document.querySelector('.mic-icon').style.borderColor = "#a855f7";
        await startMic();
    }
});

startMic();
