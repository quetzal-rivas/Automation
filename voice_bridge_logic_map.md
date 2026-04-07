# Step-by-Step Logic Map: Chrome Voice Bridge & Utilidad por Proceso

## 1. The Core WebSocket Bridge
*   **The Core Concept**: We needed to transition from an asynchronous, costly Twilio/ElevenLabs telephony setup to a free, zero-latency local voice assistant using a Chrome Extension and a Node.js MCP Relay.
*   **The Evolution**: We encountered protocol mismatches (Error 1007/1008) when moving to Gemini's Multimodal Live API (`v1beta`). We realized we had to strictly follow March 2026 requirements: use the `models/gemini-3.1-flash-live-preview` model, adopt CamelCase for JSON keys (e.g., `clientContent`), and wrap audio in a flattened `realtimeInput.audio` object instead of deprecated `media_chunks`. We also established a "Ready Gate" (`isGeminiReady`) to prevent sending audio before the `setupComplete` handshake.
*   **The Conclusion**: Resolving these protocol rules successfully opened an unbroken, real-time bidirectional audio stream between the browser's `AudioWorklet` processor and Google's servers, laying the foundation for an interactive AI.

## 2. 'Barge-in' and Human Interruption
*   **The Core Concept**: Early tests showed the AI lacked "Interruptibility" (Barge-in). If the user interrupted Gemini mid-sentence, the browser would continue playing previously buffered audio, making interactions feel robotic and lagging.
*   **The Evolution**: We needed local control over Chrome's audio buffers. In `index.js`, we implemented a listener for Gemini's `interrupted: true` flag in the server response. In the Chrome Extension (`offscreen.js`), we created a `CLEAR_AUDIO_QUEUE` handler that instantly destroys the active `AudioContext` and resets playback. We further enhanced this with our VAD thresholding: if the user speaks above -40dB *while* Gemini is speaking, we cut the queue immediately.
*   **The Conclusion**: This created a sub-second, "human-grade" interruption mechanism. The AI shuts up instantly and processes the new instruction, significantly boosting the natural flow of conversation.

## 3. 'Utilidad por Proceso' y el Gatekeeper (VAD)
*   **The Core Concept**: The "open mic" approach was sending white noise, fan sounds, and silence to Gemini 100% of the time, burning tokens unnecessarily and making the AI try to "hallucinate" meaning from static.
*   **The Evolution**: We engineered a local Voice Activity Detection (VAD) algorithm directly into the Node.js Relay. By calculating the Root Mean Square (RMS) energy of every incoming PCM chunk, we established a mathematical decibel (`dB`) value. We introduced a Gatekeeper threshold: unless the audio spikes above `-45dB` (true voice input), the frame is silently dropped locally and *never* sent to Google's WebSocket.
*   **The Conclusion**: This transformed the architecture from a "dumb pipe" to a "smart gate", slashing API token costs to nearly zero during periods of silence and providing Gemini with clean, high-signal input.

## 4. Anomaly Detection and the 25-Second Ring Buffer
*   **The Core Concept**: We wanted to give the AI "Short-Term Memory" and situational awareness so it could distinguish between a sudden shriek of laughter, a dropped object, or a true emergency cry, without sending passive recordings 24/7.
*   **The Evolution**: We implemented a rolling Ring Buffer in `index.js` that constantly holds the last 25 seconds of processed (but unsent) audio metadata. We defined an `ANOMALY_THRESHOLD_DB` (>90dB) and an `ANOMALY_DELTA_DB` (>40dB sudden jump). If triggered, the Relay takes a snapshot of the buffer (`preBuffer`) and waits 5 seconds (`postBuffer`). It mathematically analyzes the energy profile across these segments to categorize the event into three scenarios: `SUSTO` (false alarm), `EMERGENCIA` (impact + silence), or `SOCIAL` (sustained loud laughter). It then pushes this as a high-priority `[ANOMALY_DETECTED]` text tag to Gemini's context window.
*   **The Conclusion**: The system behaves like a state-of-the-art Edge computing device. It grants Gemini retroactive acoustic context, allowing for highly nuanced personality shifts and emergency handling without continuously streaming data to the cloud.

## 5. System Calibration and False Positives
*   **The Core Concept**: During testing, the mathematical jump from initializing the buffer ($-180\text{dB}$ or $-Infinity$) to ambient room noise ($-44\text{dB}$) triggered an immediate false `InfinitydB` Anomaly Delta, crashing the initial handshake. Furthermore, the UI needed visual debugging for audio thresholds.
*   **The Evolution**: We hardened the math: we constrained the Delta calculation to only trigger if the previous dB reading was valid (`> -100dB`). We also injected an RMS-to-Decibel feedback loop directly into the Chrome Extension's visualizer (`mic.js`), painting live dB readings on the canvas so users can calibrate the Gatekeeper locally. We also heavily attenuated the incoming call ringtone to `0.02` gain to prevent psychoacoustic discomfort and baseline interference.
*   **The Conclusion**: The Relay is now stable on boot, properly distinguishes between startup physics and actual shouts, and gives the developer clear UI telemetry over the Gatekeeper state.

