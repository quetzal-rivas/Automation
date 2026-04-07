let micStream;
let micContext;
let analyser;
let bufferLength;
let dataArray;
let canvas = document.getElementById('canvas');
let ctx = canvas.getContext('2d');

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
  requestAnimationFrame(draw);
  analyser.getByteFrequencyData(dataArray);

  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Calcular dB para la UI
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  let rms = Math.sqrt(sum / dataArray.length);
  let db = 20 * Math.log10(rms / 255 || 0.0001);

  // Dibujar barras del osciloscopio
  const barWidth = (canvas.width / bufferLength) * 2.5;
  let barHeight;
  let x = 0;

  for(let i = 0; i < bufferLength; i++) {
    barHeight = dataArray[i] / 2;
    ctx.fillStyle = `rgb(${barHeight + 100}, 130, 255)`;
    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }

  // Dibujar texto de Decibeles
  ctx.font = 'bold 24px Inter, system-ui';
  ctx.fillStyle = db > -40 ? '#60a5fa' : '#334155';
  ctx.fillText(`${db.toFixed(1)} dB`, 20, 40);
}

// Escuchar para colgar
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STOP_AUDIO') {
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        window.close();
    }
});

startMic();
