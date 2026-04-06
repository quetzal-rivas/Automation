class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      const pcm = new Int16Array(channelData.length);
      
      // Convertir Float32 (-1.0 to 1.0) a Int16
      for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      
      // Enviar el buffer al hilo principal
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
