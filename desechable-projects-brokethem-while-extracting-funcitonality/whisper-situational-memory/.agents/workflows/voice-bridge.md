---
description: "How to operate the Gemini Voice Bridge and process voice directives."
---

// turbo-all

1.  **Ensura el Relay está corriendo**:
    Abre una terminal y ejecuta:
    ```bash
    cd mcp-voice-relay
    node index.js
    ```
2.  **Activa el Puente en Chrome**:
    - Abre Chrome.
    - Asegúrate de que la extensión "Gemini Voice Bridge" esté cargada (en `chrome://extensions/`).
    - Haz clic en el icono del **Cerebro** en tu barra de herramientas. Escucharás a Gemini saludarte.
3.  **Envía una Directiva**:
    Habla con Gemini y dile lo que quieres hacer (ej: *"Refactoriza el archivo background.js"*).
4.  **Procesa en la IDE**:
    El relay escribirá la directiva en `VOICE_DIRECTIVE.md`. El agente Antigravity detectará el cambio y realizará la tarea.
5.  **Revisa el Resultado**:
    Una vez Antigravity termine, llamará a `report_result` y verás aparecer una bUrbUja verde con el resumen en tu navegador.
