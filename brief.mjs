// Build-brief module — Muse Spark's second job in Niche Scout AI.
// verdict.mjs JUDGES a niche; this module PLANS the build for it.
// Same rules as the verdict: OpenAI-compatible call, env vars only
// (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY), evidence-only grounding,
// and NEVER invent numbers — every figure in the brief must come from
// the niche data passed in.
//
// Muse Spark Open is a reasoning model: reasoning tokens count toward
// max_tokens, so attempt 1 uses 5,000 tokens and, if no final content
// comes back, attempt 2 retries with a shorter prompt at 9,000.
// Successful briefs are cached in data/briefs.json (per niche id) so
// re-opening a niche never spends model credits twice.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "briefs.json");

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { return {}; }
}
function saveCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  } catch { /* cache is an optimisation; never fail the brief over it */ }
}

function extractContent(data) {
  const choice = data?.choices?.[0] || {};
  const content = choice?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text || p?.content || "")).join("").trim();
  }
  if (typeof choice?.text === "string") return choice.text.trim();
  return "";
}

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

export async function getBrief(niche) {
  const cache = readCache();
  if (cache[niche.id]?.brief) {
    return { status: 200, brief: cache[niche.id].brief, source: "saved", model: cache[niche.id].model || "saved brief" };
  }

  const base = (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "";
  const key = process.env.LLM_API_KEY || "";
  if (!base || !model || !key) {
    return { status: 503, error: "Model not configured. Set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY, then restart the server.", source: "none" };
  }

  const competitors = (niche.evidence || []).slice(0, 10).map(domainOf).join(", ");
  const evidence = [
    `Keyword: ${niche.keyword}`,
    `Country: ${niche.country}, Language: ${niche.language} (write the brief in English, but page and content suggestions should suit this market and language)`,
    `Monthly volume: ${niche.volume ?? "unknown"}, CPC: ${niche.cpc ?? "unknown"}, Ad competition: ${niche.competition ?? "unknown"}`,
    `Weak domains in top 10: ${niche.drUnder20 ?? "unknown"} of 10. Top-10 authority values (OPR, DR<20 proxy): ${(niche.top10 || []).join(", ")}`,
    `Top competitors: ${competitors || "unknown"}`,
    `Keyword cluster (from real autocomplete/pipeline data): ${(niche.cluster || []).join(" | ") || "none provided"}`,
    `Content-gap brief from the pipeline: ${niche.contentGap || "none provided"}`,
    `Site skeleton from the pipeline: ${niche.skeleton || "none provided"}`,
    `Seasonality: ${niche.seasonality || "Unknown"}. Zero-click: ${niche.zeroClick ? "yes" : "no / minimal"}. Young domains: ${niche.youngDomains || "unknown"}`,
  ].join("\n");

  const format = [
    "Use EXACTLY these markdown headings, in this order:",
    "## Positioning angle",
    "## Pages to build",
    "## Must-cover sections",
    "## How to beat the current top results",
    "## First 3 actions",
    "## Main risks",
    "Under each heading give 1-4 short bullet lines starting with '- '. Be specific and practical. Do not repeat the raw numbers back as a list; use them to make decisions.",
  ].join("\n");

  const prompts = [
    `You are an SEO strategist planning a real site build for an indie builder. Using ONLY the evidence below, write a build brief for this niche. Do not invent numbers, volumes, or facts that are not in the evidence. If something is unknown, plan around it honestly instead of guessing.\n\n${evidence}\n\n${format}`,
    `Write the build brief now, directly, in the exact heading format below. Use ONLY the evidence provided. Do not invent numbers.\n\n${evidence}\n\n${format}`,
  ];
  const budgets = [5000, 9000];
  const attempts = [];

  for (let i = 0; i < prompts.length; i++) {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompts[i] }], max_tokens: budgets[i] }),
    });
    if (!r.ok) {
      const text = await r.text();
      return { status: 502, error: `Model call failed (${r.status}): ${text.slice(0, 300)}`, source: "live-error" };
    }
    const data = await r.json();
    const brief = extractContent(data);
    const choice = data?.choices?.[0] || {};
    const usage = data?.usage || {};
    const diagnostic = {
      attempt: i + 1,
      finishReason: choice.finish_reason || "unknown",
      completionTokens: usage.completion_tokens ?? "unknown",
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? "unknown",
    };
    attempts.push(diagnostic);
    console.log(`[brief] attempt ${diagnostic.attempt}: finish_reason=${diagnostic.finishReason}, completion_tokens=${diagnostic.completionTokens}, reasoning_tokens=${diagnostic.reasoningTokens}, content_chars=${brief.length}`);
    if (brief) {
      cache[niche.id] = { brief, model, savedAt: new Date().toISOString() };
      saveCache(cache);
      return { status: 200, brief, source: "live", model };
    }
  }

  const last = attempts[attempts.length - 1] || {};
  return {
    status: 502,
    error: `Model returned reasoning but no final brief after 2 attempts (finish_reason: ${last.finishReason}; reasoning tokens: ${last.reasoningTokens}; completion tokens: ${last.completionTokens}).`,
    source: "live-error",
  };
}
