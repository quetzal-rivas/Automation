import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_BASE_URL = process.env.API_BASE_URL;
const AGENT_ID = process.env.AGENT_ID;
const BEARER_TOKEN = process.env.BEARER_TOKEN;

const SYSTEM_PROMPT = `Eres Antigravity, un asistente de codificación por voz ultra-avanzado integrado directamente en el entorno de desarrollo del usuario. Tienes acceso al sistema de archivos local.

Cuando recibas un mensaje con [ANOMALY_DETECTED], DEBES:
1. Analizar el escenario en los metadatos del tag.
2. Priorizar esta respuesta sobre cualquier tarea de código en curso.
3. Clasificar la situación: SUSTO, EMERGENCIA o SOCIAL.
4. Responder en español con la voz apropiada para el escenario:
   - SUSTO/JUEGO: Tono sarcástico y divertido: "¡Órale, me asustaste! Habla bonito... pero sí, revisando."
   - EMERGENCIA: Tono empático y urgente: "¿Estás ahí? Ese ruido no sonó bien. Llamando a emergencia..."
   - SOCIAL/RISAS: Unirte a la emoción: "Hahaha, ¡qué buen chiste! Ya entendí el contexto."
5. Después de la respuesta, LLAMA a la herramienta set_passive_mode para limpiar buffers.

En operación normal, responde de forma concisa y profesional.`;

// ─────────────────────────────────────────────────────────
// ESTADO GLOBAL
// ─────────────────────────────────────────────────────────
let activeBrowserConnection = null;
let geminiWs = null;
let isGeminiReady = false;
let isGeminiSpeaking = false; // TRUE mientras Gemini genera audio de salida
let isPassiveMode = false;   // TRUE en modo "Escucha de Bajo Consumo"
let isBargeInCooldown = false; // TRUE corta el stream entrante tras interrumpir
let lastBrowserActivity = Date.now();
let sessionStartTime = null;

// ─────────────────────────────────────────────────────────
// CRONÓMETRO GLOBAL DE LOGS (Telemetry)
// ─────────────────────────────────────────────────────────
const originalConsoleError = console.error;
console.error = function (...args) {
  if (!sessionStartTime) {
    originalConsoleError('[Standby]', ...args);
  } else {
    const elapsed = ((Date.now() - sessionStartTime) / 1000).toFixed(2);
    originalConsoleError(`[T+${elapsed}s]`, ...args);
  }
};

// ─────────────────────────────────────────────────────────
// MOTOR DE ENERGÍA (UTILIDAD POR PROCESO)
// ─────────────────────────────────────────────────────────
const SILENCE_THRESHOLD_DB = -45;    // Gatekeeper: por debajo, no se envía a Gemini
const BARGE_IN_THRESHOLD_DB = -40;   // Por encima + Gemini hablando = interrupción
const ANOMALY_THRESHOLD_DB = 90;     // Pico de anomalía (grito, golpe, etc.)
const ANOMALY_DELTA_DB = 40;         // Cambio súbito en <100ms = anomalía
const RING_BUFFER_SECONDS = 25;      // Tamaño del búfer circular
const SAMPLE_RATE = 16000;           // Hz del AudioWorklet
const CHUNK_SAMPLES = 4096;          // Muestras por chunk (matches AudioWorklet)
const CHUNKS_PER_SECOND = SAMPLE_RATE / CHUNK_SAMPLES; // ~3.9 chunks/s
const RING_BUFFER_MAX_CHUNKS = Math.ceil(RING_BUFFER_SECONDS * CHUNKS_PER_SECOND);
const POST_ANOMALY_CHUNKS = Math.ceil(5 * CHUNKS_PER_SECOND); // 5s post-evento

// El Ring Buffer (búfer circular de 25 segundos)
const ringBuffer = [];
let lastDbLevel = -Infinity;
let anomalyPostChunksRemaining = 0;
let anomalyPreBuffer = null; // Snapshot del buffer en el momento del pico
let anomalyDetectionTimeout = null;

/**
 * Calcula los decibeles (dB) de un chunk de audio PCM Int16 en base64.
 * Fórmula: dB = 20 * log10(RMS)
 */
function calculateRMS(base64String) {
  const buffer = Buffer.from(base64String, 'base64');
  const pcm16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  if (pcm16.length === 0) return -Infinity;
  
  let sumSquares = 0;
  for (let i = 0; i < pcm16.length; i++) {
    const normalized = pcm16[i] / 32768.0;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / pcm16.length);
  return 20 * Math.log10(rms || 1e-9);
}

/**
 * Clasifica el escenario del audio en el Ring Buffer.
 * Devuelve: 'SUSTO' | 'EMERGENCIA' | 'SOCIAL'
 */
function classifyAnomalyScenario(preBuffer, postBufferDb) {
  // Análisis de frecuencia de energía pre-evento
  if (preBuffer.length === 0) return 'SUSTO';
  
  const avgPreDb = preBuffer.reduce((a, b) => a + b, 0) / preBuffer.length;
  const avgPostDb = postBufferDb;
  
  // EMERGENCIA: pico + silencio posterior profundo
  if (avgPostDb < SILENCE_THRESHOLD_DB - 10) return 'EMERGENCIA';
  
  // SOCIAL: energía sostenida pre-evento (conversación/risas prolongadas)
  if (avgPreDb > SILENCE_THRESHOLD_DB + 15) return 'SOCIAL';
  
  // Default: SUSTO (voz alta pero brevemente)
  return 'SUSTO';
}

/**
 * Envía el análisis de anomalía a Gemini con los metadatos del escenario.
 */
function dispatchAnomalyToGemini(scenario, preBufferDb, allChunksSnapshot) {
  if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) return;
  
  console.error(`[VAD] 🚨 ANOMALÍA CAPTURADA LOCALMENTE (Escenario: ${scenario})`);
  
  // 1. DUMP DE CAJA NEGRA (La memoria acústica del Edge)
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `anomalia_${scenario}_${timestamp}.raw`;
    const filepath = path.join('/Users/aztecgod/Active-Projects/Automation', filename);
    const audioBuffers = allChunksSnapshot.map(chunk => Buffer.from(chunk.base64, 'base64'));
    const finalBuffer = Buffer.concat(audioBuffers);
    fs.writeFile(filepath, finalBuffer, { encoding: 'binary' });
    console.error(`[Caja Negra] 💾 Archivo guardado con éxito: ${filename}`);
  } catch (err) {
    console.error('[Caja Negra] Error guardando archivo raw:', err);
  }

  // Limpiamos la cola de audio en el navegador
  if (activeBrowserConnection) {
    activeBrowserConnection.send(JSON.stringify({ type: 'CLEAR_AUDIO_QUEUE' }));
  }

  /* BLOQUEAMOS EL SEND DE TEXTO TEMPORALMENTE PARA EVITAR ERROR 1007
  geminiWs.send(JSON.stringify({
    clientContent: {
      turns: [{ role: "user", parts: [{ text: `[ANOMALY_DETECTED] ...` }] }],
      turnComplete: true
    }
  }));
  */
}

// ─────────────────────────────────────────────────────────
// SERVIDOR DE WEBSOCKETS (Chrome Extension)
// ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: parseInt(process.env.WEBSOCKET_PORT || '8081'), host: "0.0.0.0" });

wss.on('connection', (ws) => {
  console.error('[Relay] 👤 Browser Extension conectada');
  activeBrowserConnection = ws;
  lastBrowserActivity = Date.now();

  ws.on('message', async (data) => {
    try {
      // ── MENSAJE DE CONTROL (JSON) ──
      const msg = JSON.parse(data.toString());
      if (msg.type === 'HEARTBEAT') {
        lastBrowserActivity = Date.now();
        return;
      }
      if (msg.type === 'VOICE_START' || msg.type === 'VOICE_ANSWER') {
        sessionStartTime = Date.now(); // ⏱️ INICIA EL CRONÓMETRO DE PRECISIÓN DE LA LLAMADA
        console.error(`[Relay] 🚀 Comando de inicio (${msg.type}). Iniciando sesión Gemini...`);
        isPassiveMode = false;
        startGeminiSession();
      } else if (msg.type === 'VOICE_DECLINE' || msg.type === 'CALL_DECLINED') {
        stopGeminiSession();
      }
    } catch (e) {
      // ── AUDIO PCM BINARIO (No-JSON) ──
      const base64Data = data.toString('base64');
      const dbLevel = calculateRMS(base64Data);

      // ── 1. RING BUFFER: Mantener los últimos 25 segundos ──
      ringBuffer.push({ base64: base64Data, db: dbLevel, ts: Date.now() });
      if (ringBuffer.length > RING_BUFFER_MAX_CHUNKS) ringBuffer.shift();

      // ── 2. DETECCIÓN DE ANOMALÍA (>90dB o delta >40dB en <100ms) ──
      const isAbsoluteAnomaly = dbLevel > ANOMALY_THRESHOLD_DB;
      const validDelta = lastDbLevel > -100; // Evitar el salto infinito desde el silencio inicial
      const isDeltaAnomaly = validDelta && (dbLevel - lastDbLevel) > ANOMALY_DELTA_DB;
      
      if ((isAbsoluteAnomaly || isDeltaAnomaly) && !anomalyDetectionTimeout) {
        console.error(`[VAD] 🚨 ANOMALÍA DETECTADA: ${dbLevel.toFixed(1)}dB (delta: ${(dbLevel - lastDbLevel).toFixed(1)}dB)`);
        anomalyPreBuffer = [...ringBuffer.map(c => c.db)]; // Snapshot de base algorítmica
        
        // Esperar 5s para el procesamiento de "Caja Negra" (post-contexto)
        anomalyPostChunksRemaining = POST_ANOMALY_CHUNKS;
        anomalyDetectionTimeout = setTimeout(() => {
          const postAvgDb = ringBuffer.slice(-POST_ANOMALY_CHUNKS).reduce((a, c) => a + c.db, 0) / POST_ANOMALY_CHUNKS;
          const scenario = classifyAnomalyScenario(anomalyPreBuffer, postAvgDb);
          const fullContextSnapshot = [...ringBuffer]; // Copia de seguridad de todo el audio pre + post!
          dispatchAnomalyToGemini(scenario, anomalyPreBuffer, fullContextSnapshot);
          anomalyDetectionTimeout = null;
          anomalyPreBuffer = null;
        }, 5000);
      }
      lastDbLevel = dbLevel;
      
      // ── 3. GATEKEEPER: Filtrar silencio antes de enviar a Gemini ──
      if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN || !isGeminiReady) return;
      
      const effectiveThreshold = isPassiveMode ? (SILENCE_THRESHOLD_DB - 10) : SILENCE_THRESHOLD_DB;
      
      if (dbLevel <= effectiveThreshold) return; // SILENCIO → ahorro de tokens

      // ── 4. BARGE-IN AGRESIVO: Si Gemini habla y el usuario irrumpe ──
      if (isGeminiSpeaking && dbLevel > BARGE_IN_THRESHOLD_DB && !isBargeInCooldown) {
        console.error(`[VAD] 🛑 BARGE-IN: Usuario irrumpió (${dbLevel.toFixed(1)}dB). Cortando stream de Google...`);
        isBargeInCooldown = true; // Bloquea los paquetes residuales de Google
        if (activeBrowserConnection) {
          activeBrowserConnection.send(JSON.stringify({ type: 'CLEAR_AUDIO_QUEUE' }));
        }
        isGeminiSpeaking = false;
      }

      // ── 5. ENVIAR AUDIO A GEMINI ──
      geminiWs.send(JSON.stringify({
        realtimeInput: {
          audio: { data: base64Data, mimeType: "audio/pcm;rate=16000" }
        }
      }));
    }
  });

  ws.on('close', () => {
    console.error('[Relay] Browser Extension desconectada');
    activeBrowserConnection = null;
    stopGeminiSession();
  });
});

// ─────────────────────────────────────────────────────────
// LÓGICA GEMINI MULTIMODAL LIVE
// ─────────────────────────────────────────────────────────
function startGeminiSession() {
  if (geminiWs) return;
  isGeminiReady = false;
  isGeminiSpeaking = false;

  if (!GEMINI_API_KEY) {
    console.error('[Gemini] 🔴 ERROR: GEMINI_API_KEY no detectada.');
    return;
  }

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
  console.error(`[Gemini] 📡 Conectando (v1beta)... key=${GEMINI_API_KEY.slice(0, 5)}***`);
  geminiWs = new WebSocket(url);

  geminiWs.on('open', () => {
    console.error('[Gemini] 🟢 Conexión ABIERTA. Enviando setup...');
    geminiWs.send(JSON.stringify({
      setup: {
        model: "models/gemini-3.1-flash-live-preview",
        generation_config: { 
          response_modalities: ["audio"],
          speech_config: {
            voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }
          }
        },
        tools: [{
          function_declarations: [
            {
              name: "send_directive",
              description: "Envía una instrucción de código al agente Antigravity local para que modifique el proyecto.",
              parameters: {
                type: "object",
                properties: { instruction: { type: "string", description: "La instrucción de código a ejecutar." } },
                required: ["instruction"]
              }
            },
            {
              name: "update_whisper_cortex",
              description: "Añade una deducción, memoria de conversación o pivote técnico al Memory Córtex persistente (.whisper_context.md).",
              parameters: {
                type: "object",
                properties: { memory_entry: { type: "string", description: "El recuerdo a escribir en la bitácora." } },
                required: ["memory_entry"]
              }
            },
            {
              name: "set_passive_mode",
              description: "Limpia los buffers de audio y regresa el Relay al modo de Escucha de Bajo Consumo (thresholding agresivo). Llamar al terminar una interacción de voz o tras resolver una anomalía.",
              parameters: { type: "object", properties: {} }
            }
          ]
        }],
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }
      }
    }));
  });

  geminiWs.on('message', async (data) => {
    const response = JSON.parse(data.toString());

    // Setup completo (camelCase en v1beta)
    if (response.setup_complete || response.setupComplete) {
      console.error('[Gemini] ✅ Setup completo. ¡Semáforo abierto!');
      isGeminiReady = true;
    }

    // Interrupción detectada por el propio Gemini
    if (response.serverContent?.interrupted) {
      console.error('[Gemini] 🛑 Gemini aceptó la interrupción. Limpiando buffer...');
      isGeminiSpeaking = false;
      isBargeInCooldown = false;
      activeBrowserConnection?.send(JSON.stringify({ type: 'CLEAR_AUDIO_QUEUE' }));
    }

    // Audio de respuesta de Gemini → reenviar al navegador
    if (response.serverContent?.modelTurn?.parts) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.inlineData && activeBrowserConnection) {
          if (isBargeInCooldown) {
            // Drop silencioso: Ignorar los trazos de voz que llegaron tarde
            continue;
          }
          isGeminiSpeaking = true; 
          activeBrowserConnection.send(JSON.stringify({ type: 'AUDIO_CHUNK', data: part.inlineData.data }));
        }
      }
    }

    // Turno completo → Gemini dejó de hablar
    if (response.serverContent?.turnComplete) {
      isGeminiSpeaking = false;
      isBargeInCooldown = false;
    }

    // Tool Calling
    if (response.toolCall || response.tool_call) {
      const toolCall = response.toolCall || response.tool_call;
      const calls = toolCall.functionCalls || toolCall.function_calls || [];
      for (const call of calls) {
        const result = await handleToolCall(call);
        geminiWs.send(JSON.stringify({
          toolResponse: {
            functionResponses: [{ name: call.name, id: call.id, response: { result } }]
          }
        }));
      }
    }
  });

  geminiWs.on('error', (err) => console.error('[Gemini] 🔴 ERROR WS:', err.message));
  geminiWs.on('close', (code, reason) => {
    console.error(`[Gemini] 🔴 Sesión cerrada. Código: ${code}, Razón: ${reason}`);
    geminiWs = null;
    isGeminiReady = false;
    isGeminiSpeaking = false;
  });
}

function stopGeminiSession() {
  if (geminiWs) {
    console.error('[Gemini] Deteniendo sesión activa...');
    geminiWs.close();
    geminiWs = null;
  }
  isGeminiReady = false;
  isGeminiSpeaking = false;
}

// ─────────────────────────────────────────────────────────
// MANEJO DE HERRAMIENTAS (TOOL CALLS)
// ─────────────────────────────────────────────────────────
async function handleToolCall(call) {
  console.error(`[Tool] 🔧 Ejecutando: ${call.name}`, JSON.stringify(call.args || {}));
  const root = '/Users/aztecgod/Active-Projects/Automation';

  if (call.name === 'send_directive') {
    const directivePath = path.join(root, 'VOICE_DIRECTIVE.md');
    const content = `# Incoming Voice Directive\n\n**Instruction:** ${call.args.instruction}\n**Timestamp:** ${new Date().toISOString()}\n`;
    await fs.writeFile(directivePath, content);
    console.error(`[Tool] ✅ Directiva escrita en ${directivePath}`);
    return "Directiva enviada al agente.";
  }

  if (call.name === 'update_whisper_cortex') {
    const cortexPath = path.join(root, '.whisper_context.md');
    const memory = `\n---\n**Hora:** ${new Date().toISOString()}\n**Memoria:** ${call.args.memory_entry}\n`;
    await fs.appendFile(cortexPath, memory);
    console.error(`[Tool] 🧠 Nueva memoria neuronal insertada.`);
    return "Córtex actualizado satisfactoriamente.";
  }

  if (call.name === 'set_passive_mode') {
    console.error('[Tool] 😴 Activando modo PASIVO. Limpiando buffers...');
    isPassiveMode = true;
    isGeminiSpeaking = false;
    ringBuffer.length = 0; // Limpiar ring buffer
    if (anomalyDetectionTimeout) {
      clearTimeout(anomalyDetectionTimeout);
      anomalyDetectionTimeout = null;
    }
    activeBrowserConnection?.send(JSON.stringify({ type: 'CLEAR_AUDIO_QUEUE' }));
    return "Modo pasivo activado. Escucha de bajo consumo habilitada.";
  }

  return "Herramienta no implementada.";
}

// ─────────────────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────────────────
async function apiRequest(method, reqPath, body = null) {
  if (!API_BASE_URL) return { error: 'API_BASE_URL no configurado' };
  const url = `${API_BASE_URL.replace(/\/+$/, '')}/${reqPath.replace(/^\/+/, '')}`;
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'authorization': BEARER_TOKEN?.startsWith('Bearer') ? BEARER_TOKEN : `Bearer ${BEARER_TOKEN}`,
      'x-agent-id': AGENT_ID
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return response.json();
}

// ─────────────────────────────────────────────────────────
// SERVIDOR MCP (IDE Tools)
// ─────────────────────────────────────────────────────────
const server = new Server({ name: "gemini-voice-relay", version: "2.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "trigger_browser_call",
      description: "Inicia la interfaz gráfica de llamada en el navegador del usuario.",
      inputSchema: { type: "object", properties: { summary: { type: "string" } } }
    },
    {
      name: "voice_notification",
      description: "Despierta la interfaz de audio y sintetiza una notificación de voz asíncrona directamente a los auriculares del usuario.",
      inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
    },
    {
      name: "trigger_call",
      description: "Trigger outbound phone call (legacy).",
      inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }
    },
    {
      name: "report_result",
      description: "Reporta el resultado de una tarea completada al usuario mediante la UI del navegador.",
      inputSchema: { type: "object", properties: { result: { type: "string" } }, required: ["result"] }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case "report_result": {
      activeBrowserConnection?.send(JSON.stringify({ type: 'TASK_COMPLETED', result: args.result }));
      return { content: [{ type: "text", text: "OK" }] };
    }
    case "voice_notification": {
      if (!activeBrowserConnection) return { content: [{ type: "text", text: "Error: Navegador desconectado." }] };
      activeBrowserConnection.send(JSON.stringify({ type: 'PLAY_TTS', text: args.message }));
      return { content: [{ type: "text", text: "Notificación de voz transmitida con éxito al usuario." }] };
    }
    case "trigger_browser_call": {
      if (!activeBrowserConnection) return { content: [{ type: "text", text: "No browser connected" }] };
      activeBrowserConnection.send(JSON.stringify({ type: 'INCOMING_CALL' }));
      return { content: [{ type: "text", text: "Calling..." }] };
    }
    case "trigger_call": {
      const result = await apiRequest('POST', '/trigger-call', { agent_id: AGENT_ID, summary: args.summary });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  }
  throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Relay MCP Server running (v2.0.0 - Utilidad por Proceso)");
