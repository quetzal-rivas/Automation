---
description: "Agent Operational Workflow for entering and executing the Seamless Voice Bridge Sentinel Loop."
---

// turbo-all

# 🤖 Agent Instructions: Voice Bridge Sentinel Loop

If the user asks you to "activate Sentinel Mode" or "start the agentic loop", you MUST follow these exact steps to create an infinite, token-efficient background loop.

## The Sentinel Loop Protocol

This protocol ensures you stay active indefinitely without blowing up the context window. 

### Step 1: Arm the Sentinel (Pause the Agent)
Do NOT use `sleep` directly in your thought process. Instead, use your `run_command` tool to execute this precise bash script. Set `SafeToAutoRun: true` and `WaitMsBeforeAsync: 500`.

```bash
while true; do read -r first_line < VOICE_DIRECTIVE.md; if [[ "$first_line" == *"# Incoming"* ]]; then echo "DIRECTIVA DETECTADA"; exit 0; fi; sleep 1; done
```

Immediately after starting it, use `command_status` with `WaitDurationSeconds: 300` to wait on the background process. **This pauses your token consumption.**

### Step 2: Wake Up and Read
When the bash script exits with `0` (outputting "DIRECTIVA DETECTADA"), it means the user spoke to Gemini.
1. Use `view_file` to read `VOICE_DIRECTIVE.md`.
2. Find the clear instruction and requested task.

### Step 3: Execute Task
Carry out the user's exact command internally. Edit code, view files, or look up information. Be thorough and efficient.

### Step 4: Write the Response & Release Lock
Once you complete the task, you MUST overwrite the entire `VOICE_DIRECTIVE.md` file using `write_to_file`.
* **CRITICAL:** The file MUST begin with `# IDE Response` (this removes the '# Incoming' lock).
* Write a brief summary of what you did underneath the header and provide 3 short natural posible course of actions and a small description of why you sugested them.

Example:
```markdown
# IDE Response

Ya revisé el archivo CANVAS.md y actualicé las constantes de entorno. 
La contraseña extraída es "Hello World" y se ha vinculado al secreto `API_KEY`.

**Siguientes pasos sugeridos:**
1. **Ejecutar tests unitarios:** Para asegurar que la nueva API_KEY no rompa la autenticación actual.
2. **Actualizar documentación:** Para que el resto del equipo sepa que la constante en CANVAS.md ha cambiado.
3. **Borrar caché del servidor:** Sugerido para que los cambios en las variables de entorno se apliquen de inmediato.
```

### Step 5: Notify the Extension
Even though Gemini might be polling, you must actively notify the UI that the work is finished.
Use the MCP tool `report_result` or `trigger_browser_call` (whichever is requested/available) so the voice agent knows to speak your response to the user.

### Step 6: Recurse (Restart the Loop)
This is an infinite loop. As soon as Step 5 is done, **YOU MUST IMMEDIATELY GO BACK TO STEP 1** within the same or next output block. Call the background bash script again and wait. Never drop out of the loop unless explicitly commanded by the user.