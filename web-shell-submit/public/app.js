const $ = (id) => document.getElementById(id);
let rawNiches = [], currentSource = "demo", currentHistoryId = null, compareMode = false, selectedCompare = new Set(), currentDetail = null;

function scoreOf(n) { return n.adjustedScore ?? n.score ?? 0; }
function passesMy(n) {
  return (n.volume ?? 0) >= parseInt($("volumeMin").value || "50000", 10) &&
         (n.drUnder20 ?? 0) >= parseInt($("drMin").value || "3", 10);
}
function viewList() {
  const f = $("filterSel").value, s = $("sortSel").value;
  let list = [...rawNiches];
  if (f === "both") list = list.filter((n) => n.volumePass === true && (n.drUnder20 ?? 0) >= 3);
  if (f === "volume") list = list.filter((n) => n.volumePass === true);
  if (f === "authority") list = list.filter((n) => (n.drUnder20 ?? 0) >= 3);
  if (f === "favorites") list = list.filter((n) => n.favorite);
  if (s === "score") list.sort((a, b) => scoreOf(b) - scoreOf(a));
  if (s === "volume") list.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  if (s === "dr") list.sort((a, b) => (b.drUnder20 ?? 0) - (a.drUnder20 ?? 0));
  if (s === "revenue") list.sort((a, b) => (b.revenueHigh ?? -1) - (a.revenueHigh ?? -1));
  return list;
}
function showResults(niches, title) {
  rawNiches = niches;
  const list = viewList();
  $("resultsSection").hidden = false;
  $("detailSection").hidden = true;
  $("resultsCount").textContent = `${list.length} of ${niches.length} shown. Click a niche to see its details.`;
  if (niches.length === 0) {
    $("resultsCount").textContent = "No saved run for this selection in the hosted demo — the validated demo run is Mexico · Spanish · calculators. Choose those to explore it; the local version runs live searches for any country and language.";
  }
  $("results").innerHTML = "";
  list.forEach((n) => {
    const div = document.createElement("div");
    div.className = "resultCard";
    const volPass = n.volumePass === true, authPass = (n.drUnder20 ?? 0) >= 3;
    const rev = n.revenueHigh != null ? ` · Est. $${n.revenueLow.toLocaleString()}–$${n.revenueHigh.toLocaleString()}/mo` : "";
    div.innerHTML = `<h3>${n.keyword}</h3>
      <p>Score ${scoreOf(n)} · ${n.country}</p>
      <span class="badge ${volPass ? "pass" : "fail"}">Volume ${n.volume ?? "unknown"}${volPass ? " ✓" : ""}</span>
      <span class="badge ${authPass ? "pass" : "fail"}">${n.drUnder20} weak sites${authPass ? " ✓" : ""}</span>
      ${rev ? `<span class="badge">${rev.trim()}</span>` : ""}
      ${n.favorite ? `<span class="badge pass">★ Favorite</span>` : ""}
      ${compareMode ? `<p><label><input type="checkbox" ${selectedCompare.has(n.id) ? "checked" : ""}> Compare this one</label></p>` : ""}`;
    div.onclick = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (compareMode && e.target.tagName === "LABEL") return;
      showDetail(n.id);
    };
    if (compareMode) {
      div.querySelector("input").onchange = (e) => {
        if (e.target.checked) selectedCompare.add(n.id); else selectedCompare.delete(n.id);
        if (selectedCompare.size > 2) { selectedCompare.delete(n.id); e.target.checked = false; alert("Compare is limited to 2 niches."); }
        updateCompare();
      };
    }
    $("results").appendChild(div);
  });
  updateCompare();
}
function updateCompare() {
  const box = $("compareBox");
  if (selectedCompare.size !== 2) { box.innerHTML = compareMode ? `<p>Select 2 niches to compare.</p>` : ""; return; }
  const [a, b] = rawNiches.filter((n) => selectedCompare.has(n.id));
  if (!a || !b) return;
  const row = (l, va, vb) => `<tr><td><strong>${l}</strong></td><td>${va}</td><td>${vb}</td></tr>`;
  box.innerHTML = `<div class="card"><h3>Compare</h3><table>
    ${row("Keyword", a.keyword, b.keyword)}
    ${row("Score", scoreOf(a), scoreOf(b))}
    ${row("Volume", a.volume ?? "unknown", b.volume ?? "unknown")}
    ${row("Weak sites", a.drUnder20, b.drUnder20)}
    ${row("Revenue", a.revenueHigh != null ? `$${a.revenueLow.toLocaleString()}–$${a.revenueHigh.toLocaleString()}` : "unknown", b.revenueHigh != null ? `$${b.revenueLow.toLocaleString()}–$${b.revenueHigh.toLocaleString()}` : "unknown")}
  </table></div>`;
}
$("filterSel").onchange = () => showResults(rawNiches, "");
$("sortSel").onchange = () => showResults(rawNiches, "");
$("compareToggleBtn").onclick = () => {
  compareMode = !compareMode; selectedCompare.clear();
  $("compareToggleBtn").textContent = `Compare mode: ${compareMode ? "on" : "off"}`;
  showResults(rawNiches, "");
};
$("exportBtn").onclick = () => {
  const src = currentSource === "demo" ? "demo" : currentSource === "history" ? "history" : "live";
  const q = src === "history" ? `?source=history&id=${encodeURIComponent(currentHistoryId || "")}` : `?source=${src}`;
  window.location.href = "/api/export" + q;
};
$("historyBtn").onclick = async () => {
  const list = await (await fetch("/api/history")).json();
  $("historyList").innerHTML = list.length ? list.map((h) => `<p><button class="secondary hist" data-id="${h.id}">${h.country} / ${h.category} — ${h.uniqueCount} niches — ${new Date(h.finishedAt).toLocaleString()}</button></p>`).join("") : "<p>No past searches yet.</p>";
  $("historyList").querySelectorAll(".hist").forEach((btn) => {
    btn.onclick = async () => {
      const d = await (await fetch("/api/history/" + btn.dataset.id)).json();
      currentSource = "history"; currentHistoryId = btn.dataset.id;
      $("sampleBanner").hidden = true;
      showResults(d.niches, "");
    };
  });
};
$("backBtn").onclick = () => { $("detailSection").hidden = true; $("resultsSection").hidden = false; };
document.querySelectorAll(".tabBtn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tabBtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    ["Overview", "Evidence", "Plan", "Domains"].forEach((t) => { $("tab" + t).hidden = t.toLowerCase() !== btn.dataset.tab; });
  };
});

async function showDetail(id) {
  const n = await (await fetch("/api/niches/" + encodeURIComponent(id))).json();
  currentDetail = n;
  $("resultsSection").hidden = true;
  $("detailSection").hidden = false;
  $("detail").innerHTML = `<h2>${n.keyword}</h2><p>${n.country} · ${n.language} · Score ${scoreOf(n)}</p>
    <p><button id="favBtn" class="secondary">${n.favorite ? "★ Favorite" : "☆ Add to favorites"}</button></p>`;
  $("favBtn").onclick = async () => {
    await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id, fav: !n.favorite }) });
    n.favorite = !n.favorite;
    const raw = rawNiches.find((x) => x.id === n.id); if (raw) raw.favorite = n.favorite;
    showDetail(id);
  };
  // Overview tab: plain sentences, verdict auto-loaded
  const volPass = n.volumePass === true, authPass = (n.drUnder20 ?? 0) >= 3;
  $("tabOverview").innerHTML = `
    <div class="panel panel-heuristic">
      <p class="panelLabel">Niche Scout assessment &middot; rules-based</p>
      <p><strong>Volume:</strong> ${n.volume ?? "unknown"} searches/month — ${volPass ? "passes the 50,000 filter ✓" : "does not pass the 50,000 filter"}</p>
      <p><strong>Competition:</strong> ${n.drUnder20} of the top 10 sites are weak — ${authPass ? "passes the 3+ weak sites rule ✓" : "does not pass the 3+ weak sites rule"}</p>
      <p><strong>Revenue estimate:</strong> ${n.revenueHigh != null ? `$${n.revenueLow.toLocaleString()}–$${n.revenueHigh.toLocaleString()}/month` : "unknown (needs volume + CPC)"} <span class="hint">Estimate only: 2–10% of searches, 68% of CPC.</span></p>
      <p><strong>Seasonality:</strong> ${n.seasonality || "Unknown"} · <strong>Zero-click risk:</strong> ${n.zeroClickRisk || "unknown"}</p>
      <div id="heuristicBox">Loading assessment…</div>
    </div>
    <div id="musePanel"></div>
    <h3>Your decision</h3>
    <p><select id="outcomeSel"><option value="">— set outcome —</option><option>won</option><option>lost</option><option>testing</option><option>dropped</option></select>
    <button id="outcomeBtn" class="primary">Save</button> ${n.outcome ? `Current: ${n.outcome}` : ""}</p>`;
  $("outcomeBtn").onclick = async () => {
    const status = $("outcomeSel").value; if (!status) return;
    await fetch("/api/outcomes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id, status }) });
    showDetail(id);
  };
  const vr = await fetch("/api/verdict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id }) });
  const vd = await vr.json();
  if (n.savedModelVerdict) {
    // This niche carries a genuine saved Muse Spark verdict: it gets its own
    // panel, visually separate from the rules-based assessment above.
    $("heuristicBox").innerHTML = `<p class="hint">The rules-based evidence is above. This niche also has a saved Muse Spark verdict — see the panel below.</p>`;
    $("musePanel").innerHTML = vd.verdict
      ? `<div class="panel panel-muse"><p class="panelLabel">\u2726 Muse Spark \u00b7 saved result \u00b7 Oct 29</p><p>${vd.verdict}</p><p class="hint">Source: ${vd.source}${vd.model ? " \u00b7 " + vd.model : ""}</p></div>`
      : `<div class="panel panel-muse"><p class="panelLabel">\u2726 Muse Spark \u00b7 saved result \u00b7 Oct 29</p><p>${vd.error || "Verdict unavailable."}</p></div>`;
  } else {
    // No Muse verdict was saved for this niche: its summary is the
    // rules-based assessment itself, rendered inside the heuristic panel.
    $("heuristicBox").innerHTML = vd.verdict
      ? `<p><strong>Assessment summary</strong></p><p>${vd.verdict}</p><p class="hint">Source: ${vd.source}${vd.model ? " · " + vd.model : ""}</p>`
      : `<p>${vd.error}</p>`;
    $("musePanel").innerHTML = `<p class="hint">No Muse Spark verdict was saved for this niche — the assessment above is rules-based only.</p>`;
  }
  // Evidence tab: domains only, not long URLs
  const domains = (n.domains && n.domains.length ? n.domains : (n.evidence || []).map((u) => { try { return { domain: new URL(u).hostname.replace(/^www\./, ""), opr: null }; } catch { return null; } }).filter(Boolean));
  $("tabEvidence").innerHTML = `<h3>Top 10 sites</h3><table><tr><th>Site</th><th>Authority (OPR)</th></tr>${domains.map((d) => `<tr><td>${d.domain}</td><td>${d.opr ?? "—"}</td></tr>`).join("")}</table>
    <p class="hint">OPR ≤ 2 counts as weak (DR&lt;20 proxy). Click a site in the full list below if you want to open it.</p>
    <ul>${(n.evidence || []).map((e) => `<li><a href="${e}" target="_blank" rel="noreferrer">${e.replace(/^https?:\/\//, "").split("/")[0]}</a></li>`).join("")}</ul>`;
  // Plan tab: pipeline plan + Muse build brief (second Muse job)
  $("tabPlan").innerHTML = `<h3>Keyword cluster</h3><ul>${(n.cluster || []).map((c) => `<li>${c}</li>`).join("") || "<li>No cluster yet.</li>"}</ul>
    <h3>Content gap</h3><p>${n.contentGap}</p>
    <h3>Site structure</h3><p>${n.skeleton}</p>
    <h3>Muse build brief</h3>
    <div class="verdict" id="briefBox"><p>Muse Spark turns the cluster, content gap and competitor evidence above into a build plan: positioning, pages, must-cover sections, and how to beat the current top results.</p>
    <p><button id="briefBtn" class="primary">Generate build brief</button></p>
    <p class="hint">Generated once per niche, then saved — reopening this niche does not call the model again.</p></div>`;
  $("briefBtn").onclick = async () => {
    const box = $("briefBox");
    box.innerHTML = "<p>Generating brief with Muse Spark Open… (reasoning model, can take 20–60 seconds)</p>";
    try {
      const br = await fetch("/api/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: n.id }) });
      const bd = await br.json();
      if (!bd.brief) { box.innerHTML = `<p>${bd.error || "Brief failed."}</p>`; return; }
      const esc = bd.brief.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = esc.split("\n").map((line) => {
        const s = line.trim();
        if (s.startsWith("## ")) return `<h4>${s.slice(3)}</h4>`;
        if (!s) return "";
        return `<p>${s}</p>`;
      }).join("");
      box.innerHTML = `<div class="brief-text">${html}</div><p class="hint">Source: ${bd.source}${bd.model ? " · " + bd.model : ""}</p>`;
    } catch (e) { box.innerHTML = `<p>Brief request failed: ${e.message}</p>`; }
  };
  // Domains tab
  const emd = n.exactMatchDomain || "";
  $("tabDomains").innerHTML = `<h3>Can you register the domain?</h3>
    <p>Exact match: <strong>${emd}</strong> <button id="emdBtn" class="secondary">Check</button> <span id="emdResult"></span></p>
    <h3>How old are the top sites?</h3>
    <p><button id="ageBtn" class="secondary">Check top-site ages</button></p><div id="ageResult"></div>
    <p class="hint">Age check is free (RDAP + DNS, cached 30 days). For .mx sites, RDAP is not supported, so age will say "unknown" — that does not mean the site is new or the domain is free.</p>`;
  $("emdBtn").onclick = async () => {
    $("emdResult").textContent = "Checking…";
    const d = await (await fetch("/api/domain-check?domain=" + encodeURIComponent(emd))).json();
    $("emdResult").textContent = `${d.results[0].status}: ${d.results[0].note}`;
  };
  $("ageBtn").onclick = async () => {
    $("ageResult").textContent = "Checking… (about 10–20 seconds first time)";
    const ds = domains.slice(0, 10).map((d) => d.domain);
    const d = await (await fetch("/api/domain-check?domains=" + encodeURIComponent(ds.join(",")))).json();
    $("ageResult").innerHTML = `<p><strong>Young sites (&lt;1 year): ${d.youngCount}/10 — ${d.youngPass ? "passes the 2+ rule ✓" : "does not pass the 2+ rule"}</strong></p><table>${d.results.map((r) => `<tr><td>${r.domain}</td><td>${r.status}</td><td>${r.ageDays != null ? r.ageDays.toLocaleString() + " days" : "—"}</td><td>${r.young ? "YOUNG" : ""}</td></tr>`).join("")}</table>`;
  };
  // Reset to Overview tab
  document.querySelectorAll(".tabBtn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "overview"));
  ["Overview", "Evidence", "Plan", "Domains"].forEach((t) => { $("tab" + t).hidden = t.toLowerCase() !== "overview"; });
  window.scrollTo({ top: 0 });
}

// Demo: instant, old data
$("demoBtn").onclick = async () => {
  const data = await (await fetch("/api/niches?" + new URLSearchParams({ country: $("country").value, language: $("language").value, interest: $("interest").value }))).json();
  $("sampleBanner").hidden = !data.sample;
  currentSource = "demo"; currentHistoryId = null;
  showResults(data.niches, "");
};
// Hosted demo: the main button filters the VALIDATED agent run.
// (Live search exists only in the local version — it needs the agent,
// its API keys and a KWscanner login, which are never hosted.)
$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = await (await fetch("/api/niches?" + new URLSearchParams({ country: $("country").value, language: $("language").value, interest: $("interest").value }))).json();
  $("sampleBanner").hidden = !data.sample;
  currentSource = "demo"; currentHistoryId = null;
  showResults(data.niches, "Validated run shown. Live search runs in the local version — see the demo video.");
});
