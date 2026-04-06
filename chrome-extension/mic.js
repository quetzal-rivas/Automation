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
    
    // Analizador para las ondas visuales
    analyser = micContext.createAnalyser();
    analyser.fftSize = 256;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    const source = micContext.createMediaStreamSource(micStream);
    const processor = micContext.createScriptProcessor(4096, 1, 1);
    
    source.connect(analyser);
    source.connect(processor);
    processor.connect(micContext.destination);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // ENVIAR PCM AL BACKGROUND SCRIPT
      chrome.runtime.sendMessage({ 
          type: 'PCM_CHUNK', 
          data: btoa(String.fromCharCode(...new Uint8Array(pcm.buffer))) 
      });
    };

    draw();
    console.log('[Motor Mic] Captura iniciada');
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

  const barWidth = (canvas.width / bufferLength) * 2.5;
  let barHeight;
  let x = 0;

  for(let i = 0; i < bufferLength; i++) {
    barHeight = dataArray[i] / 2;
    ctx.fillStyle = `rgb(${barHeight + 100}, 130, 255)`;
    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
}

// Escuchar para colgar
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STOP_AUDIO') {
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        window.close();
    }
});

startMic();
