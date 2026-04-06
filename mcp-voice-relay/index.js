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
let lastBrowserActivity = Date.now(); // Track last browser interaction

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
        lastBrowserActivity = Date.now(); // Reset on every heartbeat or activity report
        return;
      }
      
      if (msg.type === 'VOICE_START' || msg.type === 'VOICE_ANSWER') {
        startGeminiSession();
      } else if (msg.type === 'VOICE_DECLINE') {
        stopGeminiSession();
      }
    } catch (e) {
      // Audio PCM logic...
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(JSON.stringify({
          realtime_input: {
            media_chunks: [{ mime_type: 'audio/pcm;rate=16000', data: data.toString('base64') }]
          }
        }));
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

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
  geminiWs = new WebSocket(url);

  geminiWs.on('open', () => {
    console.error('[Gemini] Conexión abierta. Enviando configuracion...');
    const setupMsg = {
      setup: {
        model: "models/gemini-2.0-flash-exp",
        generation_config: { response_modalities: ["audio"] },
        tools: [{
          function_declarations: [{
            name: "send_directive",
            description: "Envia una instrucción al agente Antigravity.",
            parameters: { 
              type: "object", 
              properties: { instruction: { type: "string" } },
              required: ["instruction"]
            }
          }]
        }],
        system_instruction: { parts: [{ text: SYSTEM_PROMPT + " Cuando el usuario quiera realizar cambios, usa 'send_directive'." }] }
      }
    };
    geminiWs.send(JSON.stringify(setupMsg));
  });

  geminiWs.on('message', async (data) => {
    const response = JSON.parse(data.toString());
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
  geminiWs.on('close', () => { geminiWs = null; });
}

function stopGeminiSession() {
    if (geminiWs) {
        geminiWs.close();
        geminiWs = null;
    }
}

// --- Middleware API Client (Simplified Client for trigger_call / get_directive) ---
async function apiRequest(method, path, body = null) {
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
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  return response.json();
}

// --- Tools Implementation ---
async function handleToolCall(call) {
  console.error(`[Tool] Ejecutando: ${call.name}`, call.args);
  const root = '/Users/aztecgod/Active-Projects/Automation';
  
  if (call.name === 'send_directive') {
    const directivePath = path.join(root, 'VOICE_DIRECTIVE.md');
    const content = `# Incoming Voice Directive\n\n**Instruction:** ${call.args.instruction}\n**Timestamp:** ${new Date().toISOString()}\n`;
    await fs.writeFile(directivePath, content);
    return "Directiva enviada a Antigravity.";
  }
  return "Herramienta no implementada";
}

// --- Servidor MCP ---
const server = new Server({ name: "gemini-voice-relay", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "trigger_browser_call",
      description: "Inicia la interfaz de voz en el navegador (Gemini Live). Si el usuario no está activo, puede caer a llamada telefónica.",
      inputSchema: { type: "object", properties: { summary: { type: "string" } } }
    },
    {
      name: "trigger_call",
      description: "Trigger an outbound phone call (ElevenLabs) for this agent.",
      inputSchema: { 
        type: "object", 
        properties: { 
            summary: { type: "string" },
            context: { type: "object" }
        },
        required: ["summary"]
      }
    },
    {
      name: "get_directive",
      description: "Fetch the latest directive/state assigned to this AGENT_ID.",
      inputSchema: { type: "object", properties: { include_consumed: { type: "boolean" } } }
    },
    {
      name: "report_result",
      description: "Informa al usuario sobre el resultado de una tarea completada. Notifica a la extensión de Chrome y actualiza el estado en AWS.",
      inputSchema: { 
        type: "object", 
        properties: { 
            result: { type: "string", description: "Resumen de lo que se hizo." },
            status: { type: "string", enum: ["SUCCESS", "ERROR"], default: "SUCCESS" }
        },
        required: ["result"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "report_result": {
      console.error(`[Relay] Reporting Result: ${args.result}`);
      
      // 1. Notificar al Browser si está conectado
      if (activeBrowserConnection?.readyState === 1) {
        activeBrowserConnection.send(JSON.stringify({ 
          type: 'TASK_COMPLETED', 
          result: args.result,
          status: args.status || 'SUCCESS'
        }));
      }

      // 2. Opcional: Actualizar AWS (puedes añadir un endpoint /post-result si quieres persistencia)
      // Por ahora usamos un log para debug
      return { content: [{ type: "text", text: `Resultado reportado con éxito: ${args.result}` }] };
    }
    
    case "trigger_browser_call": {
      const minutesSinceActivity = (Date.now() - lastBrowserActivity) / 1000 / 60;
      
      // Fallback a llamada telefónica si no hay actividad en 5 minutos
      if (!activeBrowserConnection || activeBrowserConnection.readyState !== 1 || minutesSinceActivity > 5) {
        console.error(`[Relay] Inactividad (${minutesSinceActivity}m). Triggering phone call fallback...`);
        const result = await apiRequest('POST', '/trigger-call', {
          agent_id: AGENT_ID,
          summary: args.summary || "Inactivity fallback voice capture",
          context: { browser_fallback: true }
        });
        return { content: [{ type: "text", text: `Usuario inactivo en Chrome. Se inició llamada telefónica como fallback: ${JSON.stringify(result)}` }] };
      }

      activeBrowserConnection.send(JSON.stringify({ type: 'INCOMING_CALL', summary: args.summary }));
      return { content: [{ type: "text", text: "Llamada enviada al navegador." }] };
    }

    case "trigger_call": {
      const result = await apiRequest('POST', '/trigger-call', {
        agent_id: AGENT_ID,
        summary: args.summary,
        context: args.context
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "get_directive": {
        const result = await apiRequest('GET', `/get-directive?agent_id=${AGENT_ID}&include_consumed=${!!args.include_consumed}`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "wait_for_directive": {
        // Implementación básica de polling (igual que middleware-client.js original)
        const timeoutSeconds = args.timeout_seconds || 600;
        const start = Date.now();
        while (Date.now() - start < timeoutSeconds * 1000) {
            const res = await apiRequest('GET', `/get-directive?agent_id=${AGENT_ID}`);
            if (res && (res.directive || res.instruction)) {
                return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
            }
            await new Promise(r => setTimeout(r, 30000));
        }
        return { content: [{ type: "text", text: "Timeout waiting for directive." }] };
    }
  }
  throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Relay MCP Server running");
