let audioContext;
let nextStartTime = 0;
let ringInterval = null;
let isSpeaking = false;
let checkInterval = null;

function initAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: 24000 });
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

function playPcmChunk(base64Data) {
  initAudioContext();
  const binary = atob(base64Data);
  const pcm16 = new Int16Array(new Uint8Array([...binary].map(c => c.charCodeAt(0))).buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x8000;
  
  const buffer = audioContext.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  
  if (nextStartTime < audioContext.currentTime) nextStartTime = audioContext.currentTime;
  source.start(nextStartTime);
  nextStartTime += buffer.duration;
  
  isSpeaking = true;
  monitorPlayback();
}

function monitorPlayback() {
  if (checkInterval) return;
  checkInterval = setInterval(() => {
    if (isSpeaking && audioContext && audioContext.currentTime >= nextStartTime) {
      console.log('[Offscreen] Playback finished');
      isSpeaking = false;
      chrome.runtime.sendMessage({ type: 'PLAYBACK_FINISHED' });
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    }
  }, 200);
}

function playSingleRing() {
  initAudioContext();
  const osc1 = audioContext.createOscillator();
  const osc2 = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc1.frequency.setValueAtTime(550, audioContext.currentTime);
  osc2.frequency.setValueAtTime(650, audioContext.currentTime);
  osc1.connect(gain); osc2.connect(gain);
  gain.connect(audioContext.destination);
  gain.gain.setValueAtTime(0.2, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
  osc1.start(); osc2.start();
  osc1.stop(audioContext.currentTime + 0.8); osc2.stop(audioContext.currentTime + 0.8);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AUDIO_CHUNK') {
    playPcmChunk(msg.data);
  } else if (msg.type === 'PLAY_RING') {
    playRingTone();
  } else if (msg.type === 'PLAY_SINGLE_RING') {
    playSingleRing();
  } else if (msg.type === 'STOP_RING') {
    stopRingTone();
  } else if (msg.type === 'STOP_AUDIO') {
    stopRingTone();
    if (audioContext) audioContext.close();
    audioContext = null;
    isSpeaking = false;
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }
});
