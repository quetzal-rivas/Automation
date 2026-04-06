let audioContext;
let processor;
let stream;
let relaySocket;
let nextStartTime = 0;

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
      console.log('[Offscreen] Stream de audio iniciado');
      relaySocket.send(JSON.stringify({ type: 'VOICE_START' }));
    };

    // Procesador: 32-bit Float -> 16-bit Int PCM
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
        relaySocket.send(pcm.buffer);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    
  } catch (err) {
    console.error('[Offscreen] Error:', err);
  }
}

// Escuchar mensajes del background (Audio, Ring o Stop)
let ringInterval = null;

function initAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: 16000 });
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function playRingTone() {
  initAudioContext();
  if (ringInterval) return;
  const ring = () => {
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc1.frequency.setValueAtTime(440, audioContext.currentTime);
    osc2.frequency.setValueAtTime(480, audioContext.currentTime);
    osc1.connect(gain); osc2.connect(gain);
    gain.connect(audioContext.destination);
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.5);
    osc1.start(); osc2.start();
    osc1.stop(audioContext.currentTime + 1.5); osc2.stop(audioContext.currentTime + 1.5);
  };
  ring();
  ringInterval = setInterval(ring, 3000);
}

function stopRingTone() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AUDIO_CHUNK') {
    playPcmChunk(msg.data);
  } else if (msg.type === 'PLAY_RING') {
    playRingTone();
  } else if (msg.type === 'STOP_RING') {
    stopRingTone();
  } else if (msg.type === 'START_MIC') {
    startAudio();
  } else if (msg.type === 'STOP_AUDIO') {
    stopRingTone();
    stopAudio();
  }
});

function playPcmChunk(base64Data) {
  initAudioContext();
  const binary = atob(base64Data);
  const pcm16 = new Int16Array(new Uint8Array([...binary].map(c => c.charCodeAt(0))).buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x8000;
  
  const buffer = audioContext.createBuffer(1, float32.length, 16000);
  buffer.getChannelData(0).set(float32);
  
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  
  const currentTime = audioContext.currentTime;
  if (nextStartTime < currentTime) nextStartTime = currentTime;
  source.start(nextStartTime);
  nextStartTime += buffer.duration;
}

function stopAudio() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();
  audioContext = null;
  if (relaySocket) relaySocket.close();
  relaySocket = null;
}
