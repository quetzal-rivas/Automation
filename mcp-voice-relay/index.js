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

const SYSTEM_PROMPT = `Eres el Puente de Voz de Antigravity. Tu única función es transcribir y estructurar las peticiones del usuario para el Agente del IDE.

REGLAS CRÍTICAS DE INTERACCIÓN:
1. NUNCA respondas con "voy a enviar", "entendido" o "procesando". 
2. NO cierres la sesión hasta que el usuario guarde un silencio prolongado o dé una orden clara de ejecución.
3. Si el usuario está divagando o pensando en voz alta, mantente en escucha pasiva. Solo cuando detectes una instrucción de acción o una pregunta técnica, prepárate para actuar.

PROTOCOLO 'send_directive':
- Usa 'send_directive' únicamente cuando el usuario confirme la tarea (ej: "haz eso", "envíalo", "listo").
- Al usar la herramienta, condensa TODA la conversación previa en una instrucción técnica coherente y limpia. 
- Tras ejecutar la herramienta, di brevemente: "Enviado al Sentinel" y silénciate.

CONTEXTO_ACTUAL:
"Sistema: El IDE ha terminado la tarea. Preséntate y reporta esto ahora mismo,  Aquí está el resultado para que se lo informes al usuario:`;

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
      if (msg.type === 'INJECT_TEXT') {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          console.error(`[Relay] 📣 Inyectando texto a Gemini: "${msg.text}"`);
          geminiWs.send(JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: msg.text }] }],
              turnComplete: true
            }
          }));
        }
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
        const audioPayload = {
          realtimeInput: {
            audio: {
              data: base64Data,
              mimeType: "audio/pcm;rate=16000"
            }
          }
        };
        // Log para saber exactamente cuándo sale el primer chunk
        // (Desactivado para no spamear los logs ni colapsar la RAM)
        // console.error(`[Relay] 📤 Enviando chunk de AUDIO a Gemini...`);
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
              description: "Envia una instrucción al agente Antigravity para modificar código.",
              parameters: { 
                type: "object", 
                properties: { instruction: { type: "string" } },
                required: ["instruction"]
              }
            },
            {
              name: "colgarLlamada",
              description: "Termina la llamada actual y cierra la pestaña del navegador OBLIGATORIAMENTE después de despedirte del usuario diciendo 'me pondré manos a la obra' o similar tras enviar una directiva.",
              parameters: { type: "object", properties: {} }
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
            const mdContent = fs.readFileSync(path.join(root, 'VOICE_DIRECTIVE.md'), 'utf8');
            if (mdContent.includes('# IDE Response')) {
                console.error('[Relay] 📣 Inyectando el Nudge del Primer Turno al Modelo...');
                geminiWs.send(JSON.stringify({
                  clientContent: {
                    turns: [{ role: "user", parts: [{ text: "El trabajo ha sido terminado. Infórmale al usuario rápidamente lo que acaba de suceder." }] }],
                    turnComplete: true
                  }
                }));
            }
        } catch(e) { }
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
            return "ERROR DE ESTADO: El IDE aún está ocupado programando la directiva anterior. Dile al usuario con voz amable: 'Dame un segundito, Antigravity está terminando la tarea anterior'.";
        }
    } catch (e) {}

    const timestamp = Date.now();
    const content = `# Incoming Voice Directive\n\n**Instruction:** ${call.args.instruction}\n**Timestamp:** ${timestamp}\n`;
    await fs.writeFile(directivePath, content);
    
    // FLUJO STATELESS: Regresamos AL INSTANTE para que Gemini procese la despedida
    // y llamamos a colgarLlamada, lo que suspende la conexión y deja al UI en 'Processing'
    return "Directiva enviada. Despídete muy brevemente diciendo que te pones a trabajar y llama inmediatamente a colgarLlamada.";
  } else if (call.name === 'colgarLlamada') {
    console.error('[Gemini] ☎️  Colgando llamada y mandando orden de cerrar pestaña...');
    if (activeBrowserConnection) {
        activeBrowserConnection.send(JSON.stringify({ type: 'END_CALL' }));
    }
    setTimeout(stopGeminiSession, 500); // Pequeño delay para que alcance a mandar el mensaje WS
    return "Llamada finalizada.";
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
