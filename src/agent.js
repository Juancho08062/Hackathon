// Seamline assistant: answers questions about the loaded plans with Claude, using tools that read the same data the
// page shows (app.js supplies them). The page has no server, so the Anthropic TypeScript SDK loads in the browser on
// first use and calls the API with the key the viewer types in; the key never leaves their browser except to the API.
(function (root) {
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";
  const MODEL = "claude-opus-5";
  const MAX_ROUNDS = 10;
  let sdk = null, client = null, clientKey = null;

  async function getClient(apiKey) {
    if (!sdk) sdk = await import(SDK_URL);
    if (!client || clientKey !== apiKey) {
      // The key is the viewer's own and stays in their browser, so browser use is intended here.
      client = new sdk.default({ apiKey, dangerouslyAllowBrowser: true });
      clientKey = apiKey;
    }
    return client;
  }

  // One user turn: call Claude, run the tools it asks for, send their results back, until it answers in text.
  // messages is the running conversation (append-only); execute(name, input) returns a JSON-able result.
  async function ask({ apiKey, system, tools, messages, execute, onTool }) {
    const c = await getClient(apiKey);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await c.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if Claude Opus 5 declines, the API re-runs the request on a fallback model
        cache_control: { type: "ephemeral" },
        system,
        tools,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "refusal") return { text: "I can't help with that one. Try asking about the projects, overlaps or plan changes on the page." };
      if (response.stop_reason === "pause_turn") continue;
      const calls = response.content.filter(b => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !calls.length) {
        const text = response.content.filter(b => b.type === "text").map(b => b.text).join("\n\n").trim();
        return { text: text || "(no answer)", truncated: response.stop_reason === "max_tokens" };
      }
      // All results go back in one user message, errors included, so Claude can recover.
      const results = await Promise.all(calls.map(async call => {
        if (onTool) onTool(call.name, call.input);
        try {
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(await execute(call.name, call.input || {})) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: call.id, content: String(err && err.message || err), is_error: true };
        }
      }));
      messages.push({ role: "user", content: results });
    }
    return { text: "That took more steps than expected. Try a narrower question." };
  }

  // Readable message for API errors, using the SDK's typed errors.
  function explain(err) {
    const A = sdk && sdk.default;
    if (A && err instanceof A.AuthenticationError) return "The API key was rejected. Check it in the key field above.";
    if (A && err instanceof A.PermissionDeniedError) return "This API key isn't allowed to use that model.";
    if (A && err instanceof A.RateLimitError) return "Rate limited by the API. Wait a moment and ask again.";
    if (A && err instanceof A.APIConnectionError) return "Couldn't reach the Anthropic API. Check the internet connection.";
    if (A && err instanceof A.APIError) return `The API returned an error (${err.status}): ${err.message}`;
    if (err instanceof TypeError && /import|fetch|module/i.test(err.message)) return "Couldn't load the Anthropic SDK. The assistant needs an internet connection.";
    return String(err && err.message || err);
  }

  root.SeamAgent = { ask, explain, MODEL };
})(this);
