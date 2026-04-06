import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// --- Configuración Gemini Live ---
// Usaremos la API Multimodal de Gemini para latencia mínima
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

// --- Almacén de Conexiones ---
let activeBrowserConnection = null;
let geminiSession = null;

// --- Servidor de WebSockets para Chrome Extension (Port 8081) ---
const wss = new WebSocketServer({ port: 8081, host: "0.0.0.0" });

wss.on('connection', (ws) => {
  console.error('[Relay] Chrome Extension conectada');
  activeBrowserConnection = ws;

  ws.on('message', async (data) => {
    // Si data es un string, es un comando (START/DECLINE)
    if (typeof data === 'string' || data instanceof Buffer && data.length < 100) {
      try {
        const cmd = JSON.parse(data.toString());
        if (cmd.type === 'VOICE_START') {
          console.error('[Relay] Iniciando sesión con Gemini Live...');
          // TODO: Iniciar handshake con Gemini aquí si es conversación real-time
        }
      } catch (e) { /* Buffer de audio raw */ }
    } else {
      // Es un Buffer de Audio PCM 16-bit
      // Aquí lo reenviaríamos a Gemini Live en tiempo real
      // console.error(`[Relay] Recibidos ${data.length} bytes de audio`);
    }
  });

  ws.on('close', () => {
    console.error('[Relay] Chrome Extension desconectada');
    activeBrowserConnection = null;
  });
});

// --- Servidor MCP ---
const server = new Server(
  {
    name: "gemini-voice-relay",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Herramientas disponibles para el Agente (YO)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "trigger_browser_call",
        description: "Hace sonar el navegador del usuario para una llamada de voz entrante.",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Resumen de por qué se llama al usuario." }
          },
          required: ["summary"]
        }
      }
    ]
  };
});

// Lógica de ejecución de herramientas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "trigger_browser_call") {
    const summary = request.params.arguments?.summary || "Ready for voice instruction";
    
    if (activeBrowserConnection && activeBrowserConnection.readyState === 1) {
      activeBrowserConnection.send(JSON.stringify({ 
        type: 'INCOMING_CALL', 
        summary 
      }));
      return {
        content: [{ type: "text", text: "Llamada enviada al navegador con éxito." }]
      };
    } else {
      return {
        isError: true,
        content: [{ type: "text", text: "Error: La extensión de Chrome no está conectada al Relay (localhost:8081)." }]
      };
    }
  }
  
  throw new Error(`Herramienta no encontrada: ${request.params.name}`);
});

// Iniciar el Transporte Stdio
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Gemini Voice Relay MCP Server running on stdio");
