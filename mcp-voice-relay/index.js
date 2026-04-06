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

const SYSTEM_PROMPT = "Eres un asistente de codificación por voz. Tienes acceso al sistema de archivos local para ayudar al usuario con su código en tiempo real. Responde de forma concisa y profesional.";

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
      // SOLO ENVIAR AUDIO SI GEMINI YA DIJO "SETUP COMPLETE"
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN && isGeminiReady) {
        const base64Data = data.toString('base64');
        const audioPayload = {
          realtime_input: {
            media_chunks: [
              {
                data: base64Data,
                mime_type: "audio/pcm;rate=16000"
              }
            ]
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

  geminiWs.on('open', () => {
    console.error('[Gemini] 🟢 Conexión con Google ABIERTA');
    
    const setupMsg = {
      setup: {
        model: "models/gemini-3.1-flash-live-preview", // ¡El último grito de Marzo 2026!
        generation_config: { response_modalities: ["audio"] },
        tools: [{
          function_declarations: [{
            name: "send_directive",
            description: "Envia una instrucción al agente Antigravity para modificar código.",
            parameters: { 
              type: "object", 
              properties: { instruction: { type: "string" } },
              required: ["instruction"]
            }
          }]
        }],
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }
      }
    };
    console.error('[Gemini] 📤 Enviando SETUP (SUPER LIVE 3.1):', JSON.stringify(setupMsg, null, 2));
    geminiWs.send(JSON.stringify(setupMsg));
  });

  geminiWs.on('message', async (data) => {
    const rawData = data.toString();
    const response = JSON.parse(rawData);
    console.error('[Gemini] 📥 Mensaje de Google recibido:', JSON.stringify(response).slice(0, 150) + '...');
    
    if (response.setup_complete) {
        console.error('[Gemini] ✅ SETUP COMPLETADO con éxito');
        isGeminiReady = true; // ¡ABRIMOS EL SEMÁFORO!
        geminiWs.send(JSON.stringify({
          client_content: {
            turns: [{ role: "user", parts: [{ text: "Hola. Preséntate de forma corta." }] }],
            turn_complete: true
          }
        }));
    }

    if (response.server_content?.model_turn?.parts) {
      for (const part of response.server_content.model_turn.parts) {
        if (part.inline_data && activeBrowserConnection) {
          activeBrowserConnection.send(JSON.stringify({ type: 'AUDIO_CHUNK', data: part.inline_data.data }));
        }
      }
    }
    if (response.tool_call) {
      for (const call of response.tool_call.function_calls) {
        const result = await handleToolCall(call);
        geminiWs.send(JSON.stringify({
          tool_response: {
            function_responses: [{ name: call.name, id: call.id, response: { result } }]
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
    const content = `# Incoming Voice Directive\n\n**Instruction:** ${call.args.instruction}\n**Timestamp:** ${new Date().toISOString()}\n`;
    await fs.writeFile(directivePath, content);
    return "Directiva enviada.";
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
      if (activeBrowserConnection?.readyState === 1) {
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
