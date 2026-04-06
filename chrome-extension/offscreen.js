let audioContext;
let processor;
let stream;
let relaySocket;
let nextStartTime = 0;
let ringInterval = null;

function initAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: 16000 });
  }
}

async function startAudio() {
  try {
    initAudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();

    stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { channelCount: 1, sampleRate: 16000 } 
    });
    
    // Conectar al Relay
    relaySocket = new WebSocket('ws://127.0.0.1:8081');
    relaySocket.onopen = () => {
      console.log('[Offscreen] Conectado al Relay Local');
      relaySocket.send(JSON.stringify({ type: 'VOICE_START' }));
    };

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

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(processor);
    processor.connect(audioContext.destination);
    
  } catch (err) {
    console.error('[Offscreen] Error en micro:', err);
  }
}

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
  
  if (nextStartTime < audioContext.currentTime) nextStartTime = audioContext.currentTime;
  source.start(nextStartTime);
  nextStartTime += buffer.duration;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AUDIO_CHUNK') {
    playPcmChunk(msg.data);
  } else if (msg.type === 'START_MIC') {
    startAudio();
  } else if (msg.type === 'STOP_AUDIO') {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    audioContext = null;
    if (relaySocket) relaySocket.close();
  }
});
