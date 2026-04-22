---
description: "V2 Agent Operational Workflow: The 'Hands & Brain' Protocol for turn-based voice-to-browser control."
---

// turbo-all

# 🤖 Agent Instructions: Voice Bridge 'Hands & Brain' Loop

This protocol (V2) evolves the sentinel loop to act as the "Physical Hands" for a remote Voice Brain (Gemini). It emphasizes granularity, thinking out loud, and turn-based control using spesifically "browser_subagent" to perform task that involves the web.

## The Hands & Brain Protocol

Instead of executing large tasks with "browser_subagent", you operate in "Micro-Turns" to stay perfectly aligned with the user's voice guidance.

### Step 1: Arm the Sentinel (Pause the Agent)
Standard polling to minimize token consumption. Watch for `# Incoming`.

```bash
while true; do read -r first_line < VOICE_DIRECTIVE.md; if [[ "$first_line" == *"# Incoming"* ]]; then echo "DIRECTIVA DETECTADA"; exit 0; fi; sleep 1; done
```

### Step 2: Wake Up and Read
1. Use `view_file` to read `VOICE_DIRECTIVE.md`.
2. Determine if it's a **Code Directive** or a **Browser Directive**.
3. Identify if there is a language label (e.g., `[Speak in English]`).

### Step 3: Granular Execution ("The Hands")
**CRITICAL:** Do NOT try to finish everything. Execute exactly ONE logical action with the "browser_subagent".
-   *Example:* If the directive is "Log into "website" and start the "action"," Step 3 should ONLY be "Navigate to the site and fill the username/password."
-   STOP immediately after the action is confirmed or if a clear stopping point is reached.
-   If you are using `browser_subagent`, give it a very specific, small task.

### Step 4: Write the Response & Release Lock
Overwrite `VOICE_DIRECTIVE.md` with the `# IDE Response` header.
-   Report exactly what "The Hands" did.
-   Report the current state (e.g., "I'm at the login screen").
-   Suggest **3 Small Next Steps**.

Example:
```markdown
# IDE Response

I have successfully navigated to the "website" login page and filled in your username. 

**What should I do next?**
1. **Click Login:** To proceed to the dashboard.
2. **Double check credentials:** If you'd like to verify the masked password first.
3. **Go back:** If you meant to access a different portal.
```

### Step 5: High-Priority Notification
Use `trigger_browser_call` to wake up the Voice Layer. 
-   Provide a short summary: "Task complete. I'm waiting for your next instruction at the login screen."

### Step 6: Immediate Recursion
Go back to Step 1. The Voice Layer will now "Think Out Loud" about your result, consult the user, and send the next Micro-Directive.

 RULE SELF FIX:

If you find yourself in a recursibe loop right after trying to click a field a buttom or element, you might be clicking the air and the coordinates might be wrong, so even before traying to click the button try "taking a picture and then describing the elements in the screan then find the cordinates of the target, then move and click it, if you find yourself click in a field, button or any element for the second time, if you runing secuential steps and one happen to be repeating, and that step happends to be a cursor click, enforce you should be taking a picture and then describing the elements in the screan then find the cordinates of the target, then move and click it.