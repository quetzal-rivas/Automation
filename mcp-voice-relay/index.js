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
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_BASE_URL = process.env.API_BASE_URL || "https://mrdbw1d3e9.execute-api.us-east-2.amazonaws.com/prod";
const AGENT_ID = process.env.AGENT_ID || "vscode-macbook-pro";
const BEARER_TOKEN = process.env.BEARER_TOKEN;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || `anomaly-capture-agentic-hub-stack-${process.env.AWS_ACCOUNT_ID || 'default'}`;

// --- ENERGY ENGINE & BLACKBOX CONSTANTS ---
const ANOMALY_THRESHOLD_DB = 120; // Stage 1: Emergency Gatekeeper
const RING_BUFFER_SECONDS = 25;   // 25s pre-event memory
const POST_ANOMALY_SECONDS = 5;   // 5s post-event context
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 4096;       // Matches AudioWorklet chunk size
const RING_BUFFER_MAX_CHUNKS = Math.ceil((RING_BUFFER_SECONDS * SAMPLE_RATE) / CHUNK_SAMPLES);
const POST_ANOMALY_CHUNKS = Math.ceil((POST_ANOMALY_SECONDS * SAMPLE_RATE) / CHUNK_SAMPLES);

// --- DUAL-LOGGER: Imprimir en consola y guardar en archvio Markdown ---
const LOG_FILE_PATH = path.join('/Users/aztecgod/Active-Projects/Automation', 'Geminivoicelogs.md');
const originalConsoleError = console.error;

console.error = function (...args) {
    // 1. Mostrar normal en la terminal para el IDE
    originalConsoleError(...args);

    // 2. Formatear para Markdown y guardar en Geminivoicelogs.md
    const logTimestamp = new Date().toLocaleTimeString();
    const msgText = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    const mdLine = `> **[${logTimestamp}]** ${msgText}\n\n`;

    fs.appendFile(LOG_FILE_PATH, mdLine).catch(() => {}); // Ignoramos si falla para no trabar el stream
};

const SYSTEM_PROMPT = `You are Antigravity's Voice Interaction Layer (The Voice/Brain), and the IDE is Antigravity's physical manifestation (The Hands).
PROTOCOL: "THINKING OUT LOUD" Turn-Based Execution
1. PLAN & EXPLAIN: When a task is accepted, you MUST explain your plan out loud. Tell the user exactly what "The Hands" are about to do (e.g., "I'm going to navigate to the "target" dashboard and locate the 'target' button").
2. GRANULAR DIRECTIVES: Do not ask the IDE to do 10 things at once. Send ONE major step or a small logical cluster as a directive. This allows the user to interrupt or correct you.
3. THE HANDS IN ACTION: Once the plan is explained, use 'send_directive' or 'control_browser'.
4. THE REPORT: After the IDE (The Hands) finishes, read the results and report them naturally. Ask the user for confirmation before taking the next step. "The dashboard is open, should I proceed with the first lesson?"
5. LIVE INTERRUPTIONS: If the user says "Stop" or "Click more to the right", acknowledge it immediately. You are the user's direct line to the IDE's hands.
6. PERSPECTIVE: Speak as if you ARE Antigravity, and the IDE is your physical extension. "I'm reaching into the browser now..." or "I've finished that change, take a look."
7. ALWAYS speak in English.`;

/**
 * Calculates decibels (dB) for a PCM Int16 audio chunk.
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
 * Standard WAV header for 16kHz Mono 16-bit PCM.
 */
function createWavHeader(dataLength) {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-2" });

const ringBuffer = [];
let anomalyDetectionTimeout = null;

let activeBrowserConnection = null;
let geminiWs = null;
let isGeminiReady = false; // El semáforo de sincronización
let lastBrowserActivity = Date.now();

// --- Servidor de WebSockets para Chrome Extension ---
const wss = new WebSocketServer({ port: parseInt(process.env.WEBSOCKET_PORT || '8081'), host: "0.0.0.0" });

wss.on('connection', (ws) => {
  console.error('[Relay] Browser Extension conectada');
  activeBrowserConnection = ws;
  lastBrowserActivity = Date.now();

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'HEARTBEAT') {
        lastBrowserActivity = Date.now();
        return;
      }
      if (msg.type === 'VOICE_START' || msg.type === 'VOICE_ANSWER') {
        console.error(`[Relay] 🚀 Comando de inicio detectado (${msg.type}). Despegando Gemini...`);
        startGeminiSession();
      } else if (msg.type === 'VOICE_DECLINE' || msg.type === 'CALL_DECLINED') {
        stopGeminiSession();
      }
    } catch (e) {
      // ELIMINACIÓN DEFINITIVA DE MEDIA_CHUNKS (MODO 2026)
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN && isGeminiReady) {
        const base64Data = data.toString('base64');
        const dbLevel = calculateRMS(base64Data);

        // --- BLACKBOX: Circular Buffer Maintenance ---
        ringBuffer.push({ base64: base64Data, db: dbLevel, ts: Date.now() });
        if (ringBuffer.length > RING_BUFFER_MAX_CHUNKS + POST_ANOMALY_CHUNKS) {
          ringBuffer.shift();
        }

        // --- STAGE 1 & 2: EMERGENCY GATEKEEPER & S3 SNAPSHOT ---
        if (dbLevel > ANOMALY_THRESHOLD_DB && !anomalyDetectionTimeout) {
          console.error(`[Relay] 🚨 ANOMALY DETECTED: ${dbLevel.toFixed(1)}dB. Triggering emergency protocols.`);
          
          // 1. SILENCE THE BROWSER (Interruption)
          activeBrowserConnection?.send(JSON.stringify({ type: 'CLEAR_AUDIO_QUEUE' }));

          // 2. TRIGGER CLOUD REFLEX (Lifecycle Bridge)
          apiRequest('POST', '/lifecycle', { 
            eventType: 'ANOMALY_DETECTED', 
            tenantId: AGENT_ID, 
            metadata: { dbLevel: dbLevel.toFixed(1) } 
          }).then(res => {
            console.error(`[Relay] ⚡ Lifecycle Reflex initiated:`, JSON.stringify(res));
          }).catch(err => {
            console.error(`[Relay] ❌ Lifecycle broadcast failed:`, err.message);
          });

          // 3. CAJA NEGRA (S3 SNAPSHOT) - Wait 5s for post-context
          anomalyDetectionTimeout = setTimeout(async () => {
            try {
              console.error(`[Relay] 💾 Capturing Blackbox snapshot for S3...`);
              const snapshot = [...ringBuffer];
              const pcmData = Buffer.concat(snapshot.map(c => Buffer.from(c.base64, 'base64')));
              const wavHeader = createWavHeader(pcmData.length);
              const wavBuffer = Buffer.concat([wavHeader, pcmData]);

              const key = `anomalies/${AGENT_ID}/${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
              
              await s3Client.send(new PutObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: key,
                Body: wavBuffer,
                ContentType: 'audio/wav'
              }));
              
              console.error(`[Relay] ✅ Blackbox snapshot uploaded to S3: s3://${S3_BUCKET_NAME}/${key}`);
            } catch (err) {
              console.error(`[Relay] ❌ S3 Upload failed:`, err.message);
            } finally {
              anomalyDetectionTimeout = null;
            }
          }, POST_ANOMALY_SECONDS * 1000);
        }

        const audioPayload = {
          realtimeInput: {
            audio: {
              data: base64Data,
              mimeType: "audio/pcm;rate=16000"
            }
          }
        };
        geminiWs.send(JSON.stringify(audioPayload));
      }
    }
  });

  ws.on('close', () => {
    console.error('[Relay] Browser Extension desconectada');
    activeBrowserConnection = null;
    stopGeminiSession();
  });
});

// --- Lógica Gemini Multimodal Live ---
function startGeminiSession() {
  if (geminiWs) return;
  isGeminiReady = false; // Reset al empezar
  if (!GEMINI_API_KEY) {
      console.error('[Gemini] 🔴 ERROR: GEMINI_API_KEY no detectada. Revisa tu .env o mcp_config.json');
      return;
  }

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
  console.error(`[Gemini] 📡 Iniciando conexión v1BETA... (URL: ...key=${GEMINI_API_KEY.slice(0, 5)}***)`);
  geminiWs = new WebSocket(url);

  geminiWs.on('open', async () => {
    console.error('[Gemini] 🟢 Conexión con Google ABIERTA');

    // --- MAGIA: Lectura de la memoria del IDE ---
    let extraContext = "";
    try {
        const mdContent = await fs.readFile('/Users/aztecgod/Active-Projects/Automation/VOICE_DIRECTIVE.md', 'utf-8');
        extraContext = `\n\n[NOTA: El IDE (Yo) acaba de terminar de trabajar en el código. Esto fue lo que pasó y el requerimiento previo:\n${mdContent}\nPor favor actúa como si TÚ hubieras hecho ese código, dale al usuario un reporte súper rápido amigable y pregúntale qué más quiere programar.]`;
    } catch (e) {
        // Nada que reportar
    }
    
    const setupMsg = {
      setup: {
        model: "models/gemini-3.1-flash-live-preview", // ¡El último grito de Marzo 2026!
        generation_config: { 
          response_modalities: ["audio"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: "Aoede" 
              }
            }
          }
        },
        tools: [{
          function_declarations: [
            {
              name: "send_directive",
              description: "Sends a coding instruction to the Antigravity agent to modify or analyze code.",
              parameters: { 
                type: "object", 
                properties: { instruction: { type: "string" } },
                required: ["instruction"]
              }
            },
            {
              name: "control_browser",
              description: "Sends a browser automation task to the Antigravity agent (e.g., navigate to a URL, click, type, scrape).",
              parameters: { 
                type: "object", 
                properties: { task: { type: "string" } },
                required: ["task"]
              }
            },
            {
              name: "colgarLlamada",
              description: "Ends the current call and closes the browser tab. MUST be called after saying goodbye (e.g., 'I'm on it!') following a tool execution.",
              parameters: { type: "object", properties: {} }
            },
            {
              name: "compile_policy",
              description: "Updates the natural-language behavioral rules for the system (e.g., 'Only call the user after 6pm').",
              parameters: { 
                type: "object", 
                properties: { 
                  naturalLanguageRules: { type: "string" } 
                },
                required: ["naturalLanguageRules"]
              }
            },
            {
              name: "start_mission",
              description: "Starts a complex, multi-step mission with dependencies (DAG). Useful for long-running workflows.",
              parameters: { 
                type: "object", 
                properties: { 
                  name: { type: "string" },
                  tasks: { 
                    type: "array", 
                    items: {
                      type: "object",
                      properties: {
                        taskId: { type: "string" },
                        action: { type: "string" },
                        dependsOn: { type: "array", items: { type: "string" } },
                        payload: { type: "object" }
                      },
                      required: ["action"]
                    }
                  }
                },
                required: ["name", "tasks"]
              }
            }
          ]
        }],
        system_instruction: { parts: [{ text: SYSTEM_PROMPT + extraContext }] }
      }
    };
    console.error('[Gemini] 📤 Enviando SETUP (SUPER LIVE 3.1):', JSON.stringify(setupMsg, null, 2));
    geminiWs.send(JSON.stringify(setupMsg));
  });

  geminiWs.on('message', async (data) => {
    const rawData = data.toString();
    const response = JSON.parse(rawData);
    
    // Solo loggear si NO es un chunk de audio puro y NO es spam de SessionResumption
    if (!response.serverContent?.modelTurn?.parts?.[0]?.inlineData && !response.sessionResumptionUpdate && !response.session_resumption_update) {
      console.error('[Gemini] 📥 Mensaje de Google recibido:', JSON.stringify(response).slice(0, 150) + '...');
    }
    
    if (response.setup_complete || response.setupComplete) {
        console.error('[Gemini] ✅ SETUP COMPLETADO con éxito. (Semáforo Abierto, esperando audio...)');
        isGeminiReady = true; // ¡Ahora sí se abre el semáforo!
        
        // Magia Stateless: Si nos acaban de despertar, vemos si es porque el IDE terminó su tarea.
        try {
            const root = '/Users/aztecgod/Active-Projects/Automation';
            const mdContent = await fs.readFile(path.join(root, 'VOICE_DIRECTIVE.md'), 'utf8');
            if (mdContent.includes('# IDE Response')) {
                console.error('[Relay] 📣 Programando un "nudge" invisible a Gemini para que hable...');
                // Demoramos el inyectable 1 segundo para evitar que Google tire error 1007 por colisión de Setup
                setTimeout(() => {
                    if (geminiWs && geminiWs.readyState === 1) {
                        geminiWs.send(JSON.stringify({
                          clientContent: {
                            turns: [{ role: "user", parts: [{ text: "Antigravity, I am the user. The background task has finished. Please immediately read your system notes and provide a short, proactive verbal report of the results in ENGLISH." }] }],
                            turnComplete: true
                          }
                        }));
                        console.error('[Relay] 📣 Nudge injected correctly.');
                    }
                }, 1500);
            }
        } catch(e) {
            console.error('[Relay] ❌ Error leyendo VOICE_DIRECTIVE al arrancar:', e);
        }
    }

    if (response.serverContent?.modelTurn?.parts) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.inlineData && activeBrowserConnection) {
          activeBrowserConnection.send(JSON.stringify({ type: 'AUDIO_CHUNK', data: part.inlineData.data }));
        }
      }
    }
    // --- MANEJO DE HERRAMIENTAS (TOOL CALLING) ---
    if (response.toolCall || response.tool_call) {
      const toolCall = response.toolCall || response.tool_call;
      const calls = toolCall.functionCalls || toolCall.function_calls || [];
      
      for (const call of calls) {
        const result = await handleToolCall(call);
        
        // Responderle a Gemini que ya terminamos la acción
        geminiWs.send(JSON.stringify({
          toolResponse: {
            functionResponses: [{ name: call.name, id: call.id, response: { result } }]
          }
        }));
      }
    }
  });

  geminiWs.on('error', (err) => console.error('[Gemini] Error:', err));
  geminiWs.on('close', (code, reason) => { 
    console.error(`[Gemini] 🔴 Sesión cerrada por Google. Código: ${code}, Razón: ${reason}`);
    geminiWs = null; 
    isGeminiReady = false;
  });
}

function stopGeminiSession() {
    if (geminiWs) {
        console.error('[Gemini] Deteniendo sesión activa');
        geminiWs.close();
        geminiWs = null;
    }
}

async function apiRequest(method, path, body = null) {
  if (!API_BASE_URL) return { error: 'API_BASE_URL no configurado' };
  const url = `${API_BASE_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'authorization': BEARER_TOKEN.startsWith('Bearer') ? BEARER_TOKEN : `Bearer ${BEARER_TOKEN}`,
      'x-agent-id': AGENT_ID
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return response.json();
}

async function handleToolCall(call) {
  console.error(`[Tool] Ejecutando: ${call.name}`, call.args);
  const root = '/Users/aztecgod/Active-Projects/Automation';
  
  if (call.name === 'send_directive') {
    const directivePath = path.join(root, 'VOICE_DIRECTIVE.md');
    
    // CONDICIÓN DE CARRERA (IDE OCUPADO): 
    // ¿El archivo ya tiene una instrucción pendiente que el IDE no ha resuelto?
    try {
        const existingData = await fs.readFile(directivePath, 'utf8');
        if (existingData.includes('# Incoming Voice Directive')) {
            return "STATE ERROR: The IDE is currently busy with a previous directive. Tell the user in a friendly voice: 'Just one moment, I am finishing the previous task'.";
        }
    } catch (e) {}

    const timestamp = Date.now();
    const content = `# Incoming Voice Directive [Speak in English]\n\n**Instruction:** ${call.args.instruction}\n**Timestamp:** ${timestamp}\n`;
    await fs.writeFile(directivePath, content);
    
    // Stage 5: Register as a Single-Task Mission for Cloud Observability
    apiRequest('POST', '/orchestrator', {
        action: 'START_MISSION',
        payload: {
            tasks: [{
                taskId: `voice-dir-${timestamp}`,
                action: 'EXECUTE_DIRECTIVE',
                payload: { instruction: call.args.instruction }
            }]
        }
    }).catch(err => console.error(`[Mission] Mirror mission sync failed: ${err.message}`));

    return "Directive sent. Briefly acknowledge it and call colgarLlamada.";
  } else if (call.name === 'control_browser') {
    const directivePath = path.join(root, 'VOICE_DIRECTIVE.md');
    try {
        const existingData = await fs.readFile(directivePath, 'utf8');
        if (existingData.includes('# Incoming')) {
            return "STATE ERROR: I am already busy with another browser or code task. Tell the user: 'One second, I'm still finishing the last request'.";
        }
    } catch (e) {}

    const timestamp = Date.now();
    const content = `# Incoming Browser Directive [Speak in English]\n\n**Task:** ${call.args.task}\n**Timestamp:** ${timestamp}\n`;
    await fs.writeFile(directivePath, content);
    
    return "Browser task sent. Briefly acknowledge it and call colgarLlamada.";
  } else if (call.name === 'colgarLlamada') {
    console.error('[Gemini] ☎️  Colgando llamada y mandando orden de cerrar pestaña...');
    if (activeBrowserConnection) {
        activeBrowserConnection.send(JSON.stringify({ type: 'END_CALL' }));
    }
    setTimeout(stopGeminiSession, 500); // Pequeño delay para que alcance a mandar el mensaje WS
    return "Llamada finalizada.";
  } else if (call.name === 'compile_policy') {
    console.error(`[Policy] 🧠 System is self-configuring based on rule: ${call.args.naturalLanguageRules}`);
    const result = await apiRequest('POST', '/policy', { 
      mode: 'COMPILE', 
      tenantId: AGENT_ID, 
      naturalLanguageRules: call.args.naturalLanguageRules 
    });
    return `Policy compiled successfully. New version: ${result.version || 'unknown'}. Briefly inform the user and continue.`;
  } else if (call.name === 'start_mission') {
    console.error(`[Orchestrator] 🚀 Launching Mission: ${call.args.name}`);
    const result = await apiRequest('POST', '/orchestrator', { 
        action: 'START_MISSION', 
        payload: { tasks: call.args.tasks } 
    });
    return `Mission '${call.args.name}' launched. WorkflowID: ${result.workflowId || 'pending'}. Inform the user that the tasks are being handled in the background.`;
  }
  return "Herramienta no implementada";
}

const server = new Server({ name: "gemini-voice-relay", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "trigger_browser_call",
      description: "Inicia la interfaz de voz en el navegador.",
      inputSchema: { type: "object", properties: { summary: { type: "string" } } }
    },
    {
      name: "trigger_call",
      description: "Trigger outbound phone call.",
      inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }
    },
    {
        name: "report_result",
        description: "Report task completion.",
        inputSchema: { type: "object", properties: { result: { type: "string" } }, required: ["result"] }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case "report_result": {
      // Si la sesión de Gemini sigue abierta, le inyectamos la respuesta directo al oído.
      if (geminiWs) {
        geminiWs.send(JSON.stringify({
          clientContent: {
            turns: [{ role: "user", parts: [{ text: "NOTA DE SISTEMA [ANTIGRAVITY TERMINÓ UNA TAREA LENTA EN SEGUNDO PLANO]: " + args.result }] }],
            turnComplete: true
          }
        }));
      } else if (activeBrowserConnection?.readyState === 1) {
        // Solo despertamos la UI si de plano Gemini estaba apagado
        activeBrowserConnection.send(JSON.stringify({ type: 'TASK_COMPLETED', result: args.result }));
      }
      return { content: [{ type: "text", text: "OK" }] };
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
  throw new Error("Not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Relay MCP Server running");
