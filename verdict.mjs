// Verdict module — the ONLY place that talks to a model.
// OpenAI-compatible chat completions. Swap model by env vars only.
//   LLM_BASE_URL, LLM_MODEL, LLM_API_KEY  (never committed)
// Baseten hackathon values:
//   LLM_BASE_URL=https://inference.baseten.co/v1
//   LLM_MODEL=meta-models/muse-spark-open-1026
//
// Muse Spark Open is a reasoning model. Baseten returns its reasoning in
// `reasoning_content` and its final answer in `content`, and reasoning
// tokens count toward max_tokens. A verdict prompt needs much more room
// than the short API test, so this module starts with 4,000 tokens and,
// if the model is cut off before producing a final answer, retries once
// with a shorter prompt and an 8,000-token budget. It never presents
// hidden reasoning as if it were the verdict.

function extractContent(data) {
  const choice = data?.choices?.[0] || {};
  const content = choice?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("")
      .trim();
  }
  if (typeof choice?.text === "string") return choice.text.trim();
  return "";
}

export async function getVerdict(niche) {
  const base = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "";
  const key = process.env.LLM_API_KEY || "";
  if (!base || !model || !key) {
    if (niche.cachedVerdict) {
      if (niche.savedModelVerdict) {
        // A genuine model verdict, generated live during validation and saved.
        // Served from cache now; labeled with its author and date, never as fresh.
        return { status: 200, verdict: niche.cachedVerdict, source: "cached", model: "Muse Spark Open \u2014 saved live verdict (2026-10-29)" };
      }
      return { status: 200, verdict: niche.cachedVerdict, source: "cached", model: "cached run — no live model configured" };
    }
    return { status: 503, error: "Model not configured. Set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY, then restart the server.", source: "none" };
  }

  const evidence = [
    `Keyword: ${niche.keyword}`,
    `Country: ${niche.country}, Language: ${niche.language}`,
    `Monthly volume: ${niche.volume}`,
    `Top-10 domains with DR under 20: ${niche.drUnder20}`,
    `Top-10 DRs: ${(niche.top10 || []).join(", ")}`,
    `Young domains breaking in: ${niche.youngDomains}`,
    `Zero-click: ${niche.zeroClick ? "yes" : "no"}, Seasonality: ${niche.seasonality || "none stated"}`,
    `Evidence: ${(niche.evidence || []).join(", ")}`,
  ].join("\n");

  const prompts = [
    `You are an SEO analyst. Judge this niche in plain language, in 3-5 sentences, using ONLY the evidence below. Say whether it is winnable and what the main risk is. Do not invent numbers.\n\n${evidence}`,
    `Answer directly in 3 concise sentences. Use ONLY this evidence. State whether the niche is winnable and its main risk. Do not invent numbers.\n\n${evidence}`,
  ];
  const budgets = [4000, 8000];
  const attempts = [];

  for (let i = 0; i < prompts.length; i++) {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompts[i] }],
        max_tokens: budgets[i],
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return { status: 502, error: `Model call failed (${r.status}): ${text.slice(0, 300)}`, source: "live-error" };
    }

    const data = await r.json();
    const verdict = extractContent(data);
    const choice = data?.choices?.[0] || {};
    const usage = data?.usage || {};
    const diagnostic = {
      attempt: i + 1,
      finishReason: choice.finish_reason || "unknown",
      completionTokens: usage.completion_tokens ?? "unknown",
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? "unknown",
      reasoningChars: typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content.length : 0,
    };
    attempts.push(diagnostic);
    console.log(`[verdict] attempt ${diagnostic.attempt}: finish_reason=${diagnostic.finishReason}, completion_tokens=${diagnostic.completionTokens}, reasoning_tokens=${diagnostic.reasoningTokens}, content_chars=${verdict.length}`);

    if (verdict) return { status: 200, verdict, source: "live", model };
  }

  const last = attempts[attempts.length - 1] || {};
  return {
    status: 502,
    error: `Model returned reasoning but no final verdict after 2 attempts (finish_reason: ${last.finishReason}; reasoning tokens: ${last.reasoningTokens}; completion tokens: ${last.completionTokens}).`,
    source: "live-error",
  };
}
