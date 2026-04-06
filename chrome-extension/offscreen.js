let audioContext;
let processor;
let stream;
let relaySocket;

// Conectar al micro y al Relay
async function startAudio() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: true
      } 
    });
    
    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    
    // Conectar vía WebSocket al Relay (port 8081)
    relaySocket = new WebSocket('ws://127.0.0.1:8081');
    
    relaySocket.onopen = () => {
      console.log('[Offscreen] Stream de audio iniciado hacia el Relay');
      
      // Enviamos el aviso de "Llamada Contestada"
      relaySocket.send(JSON.stringify({ type: 'VOICE_START' }));
    };

    // Procesador para convertir 32-bit Float -> 16-bit Int PCM
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);
      
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      
      if (relaySocket.readyState === WebSocket.OPEN) {
        relaySocket.send(pcmData.buffer);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    
  } catch (err) {
    console.error('[Offscreen] Error al capturar audio:', err);
  }
}

// Escuchar si el Relay nos pide colgar
window.onmessage = (e) => {
  if (e.data === 'STOP_AUDIO') {
    stopAudio();
  }
};

function stopAudio() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  if (audioContext) audioContext.close();
  if (relaySocket) relaySocket.close();
  window.close(); // Cerramos el documento offscreen
}

// Auto-iniciar al cargar
startAudio();
