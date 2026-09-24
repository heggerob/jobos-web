/* JobOS kundeportal: kunden ser tilbudet og godtar/avslår via tilbud.html?t=TOKEN.
   Leser publicQuotes/{TOKEN} fra Firestore uten innlogging. Demomodus når Firebase ikke er satt opp,
   når t=demo, eller når lenken er laget i kontorets demomodus (&demo=1). */
(() => {
  "use strict";
  const F = window.JobOSFire;
  const root = document.getElementById("portal");
  const params = new URLSearchParams(location.search);
  const token = (params.get("t") || "").trim();
  const firebase = !!(F && F.enabled());
  const local = !firebase || token === "demo" || params.get("demo") === "1";
  const DEMO_KEY = "jobos-web-demo";
  const DEMO_RESPONSE_KEY = "jobos-demo-quote-response";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" });
  const kr = (c) => money.format((Number(c) || 0) / 100);
  const numFmt = (n) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(Number(n) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseDay = (s) => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s); };
  const fmtDate = (s) => { const d = parseDay(s); return d && !isNaN(d) ? d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" }) : ""; };
  const fmtDateTime = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" }) + " kl. " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const vatPct = (v) => { const n = Number(v) || 0; return n > 0 && n < 1 ? n * 100 : n; };
  const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  let quote = null;
  let source = null; // "firestore" | "office-demo" | "builtin"
  let justAnswered = false;

  function builtinDemo() {
    const valid = new Date(); valid.setDate(valid.getDate() + 14);
    const q = {
      companyName: "Fjordlys Elektro AS", companyId: "demo-fjordlys", quoteId: "quote-demo", title: "Elbillading garasjeanlegg – 12 ladepunkter",
      customerName: "Borettslaget Solsiden",
      lines: [
        { description: "Ladeboks Easee Charge Core, montert", quantity: 12, unitPriceCents: 899000, vatRate: 25 },
        { description: "Lastbalansering og energimåler", quantity: 1, unitPriceCents: 1450000, vatRate: 25 },
        { description: "Kabling og føringsveier (meter)", quantity: 180, unitPriceCents: 18900, vatRate: 25 },
        { description: "Arbeid montør (timer)", quantity: 64, unitPriceCents: 89500, vatRate: 25 }
      ],
      validUntil: dayKey(valid), notes: "Forutsetter fri tilgang til garasjen i arbeidstiden. Graving er ikke inkludert.", status: "sent"
    };
    q.totalCents = Math.round(q.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents * (1 + l.vatRate / 100), 0));
    try { const r = JSON.parse(sessionStorage.getItem(DEMO_RESPONSE_KEY) || "null"); if (r) Object.assign(q, r); } catch (e) { /* ignorer */ }
    return q;
  }
  function readOfficeDemo() {
    try { const d = JSON.parse(localStorage.getItem(DEMO_KEY) || "null"); return d && d.publicQuotes && d.publicQuotes[token] ? d.publicQuotes[token] : null; } catch (e) { return null; }
  }
  function writeOfficeDemo(fields) {
    const d = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (!d || !d.publicQuotes || !d.publicQuotes[token]) throw new Error("Fant ikke demotilbudet lenger.");
    Object.assign(d.publicQuotes[token], fields);
    localStorage.setItem(DEMO_KEY, JSON.stringify(d));
  }

  function totals(q) {
    const lines = q.lines || [];
    const net = Math.round(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPriceCents) || 0), 0));
    const computed = Math.round(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPriceCents) || 0) * (1 + vatPct(l.vatRate) / 100), 0));
    const total = Number.isFinite(Number(q.totalCents)) && q.totalCents !== null && q.totalCents !== undefined ? Number(q.totalCents) : computed;
    return { net, vat: total - net, total };
  }

  function showError(title, text) {
    root.innerHTML = `<div class="qp-card"><h1>${esc(title)}</h1><p>${esc(text)}</p><p class="small muted">Ta kontakt med firmaet som sendte deg lenken hvis du trenger hjelp.</p></div>`;
    document.title = title + " | JobOS";
  }

  const icon = (declined) => declined
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function answeredHtml(q) {
    const declined = q.status === "declined";
    const when = q.respondedAt ? fmtDateTime(q.respondedAt) : "";
    const head = justAnswered ? (declined ? "Takk for svaret" : "Takk! Tilbudet er godtatt") : (declined ? "Tilbudet er avslått" : "Tilbudet er godtatt");
    const lead = declined
      ? `${esc(q.companyName)} har fått beskjed om at tilbudet er avslått.`
      : `${esc(q.companyName)} har fått beskjed og tar kontakt for å avtale oppstart.`;
    return `<div class="qp-card qp-done ${declined ? "declined" : ""}" id="answered" tabindex="-1">
      <div class="mark">${icon(declined)}</div>
      <h2>${head}</h2>
      <p>${lead}</p>
      <p class="small muted">${declined ? "Avslått" : "Godtatt"} av <b>${esc(q.respondedName || "kunden")}</b>${when ? " " + esc(when) : ""}.${q.respondedComment ? `<br>Kommentar: «${esc(q.respondedComment)}»` : ""}</p>
      <div class="btn-row no-print" style="justify-content:center"><button type="button" class="btn btn-secondary btn-sm" data-print>Skriv ut / lagre som PDF</button></div>
    </div>`;
  }

  function respondHtml(q) {
    const valid = q.validUntil ? parseDay(q.validUntil) : null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (valid && valid < today) {
      return `<div class="qp-card qp-respond"><h2>Tilbudet har utløpt</h2><p>Tilbudet var gyldig til ${esc(fmtDate(q.validUntil))}. Kontakt ${esc(q.companyName)} for et oppdatert tilbud.</p></div>`;
    }
    return `<div class="qp-card qp-respond" aria-labelledby="respond-h">
      <h2 id="respond-h">Svar på tilbudet</h2>
      <p class="muted">Skriv inn fullt navn og bekreft. Svaret sendes direkte til ${esc(q.companyName)}.</p>
      <form class="form" id="respond-form" novalidate>
        <div class="field"><label for="resp-name">Fullt navn</label><input id="resp-name" name="name" autocomplete="name" required minlength="2" aria-describedby="resp-err"></div>
        <label class="check" for="resp-accept"><input type="checkbox" id="resp-accept" name="accept"> <span>Jeg godtar tilbudet og vilkårene</span></label>
        <p class="notice err" id="resp-err" role="alert" hidden></p>
        <div class="btn-row">
          <button type="submit" class="btn btn-primary" id="btn-accept">Godta tilbud</button>
          <button type="button" class="btn btn-secondary" id="btn-decline" aria-expanded="false" aria-controls="decline-box">Avslå</button>
        </div>
        <div class="qp-decline" id="decline-box" hidden>
          <div class="field"><label for="resp-comment">Kommentar til firmaet (valgfritt)</label><textarea id="resp-comment" name="comment" rows="3" maxlength="1000" placeholder="F.eks. hvorfor tilbudet ikke passer"></textarea></div>
          <button type="button" class="btn btn-dark" id="btn-decline-confirm">Bekreft avslag</button>
        </div>
      </form>
    </div>`;
  }

  function render() {
    const q = quote;
    const t = totals(q);
    const lines = q.lines || [];
    document.title = `${q.title} – tilbud fra ${q.companyName}`;
    document.getElementById("portal-company").textContent = q.companyName || "Tilbud";
    const answered = q.status === "accepted" || q.status === "declined";
    const vatRates = Array.from(new Set(lines.map((l) => vatPct(l.vatRate))));
    const demoNote = source !== "firestore"
      ? `<p class="qp-demo" role="note"><strong>Demo:</strong> ${source === "office-demo" ? "tilbudet er delt fra kontorets demomodus og lagres bare i denne nettleseren." : "dette er et eksempeltilbud. Svaret lagres bare i nettleseren."}${source === "builtin" && answered ? ' <button type="button" class="linkish" data-reset>Nullstill demo</button>' : ""}</p>`
      : "";
    root.innerHTML = demoNote + (answered ? answeredHtml(q) : "") + `
      <article class="qp-card" aria-labelledby="qp-title">
        <div class="qp-top"><span class="eyebrow">Tilbud</span><button type="button" class="btn btn-secondary btn-sm no-print" data-print>Skriv ut</button></div>
        <h1 id="qp-title">${esc(q.title)}</h1>
        <dl class="qp-parties">
          <div><dt>Fra</dt><dd>${esc(q.companyName)}</dd></div>
          <div><dt>Til</dt><dd>${esc(q.customerName || "–")}</dd></div>
          <div><dt>Gyldig til</dt><dd>${q.validUntil ? esc(fmtDate(q.validUntil)) : "–"}</dd></div>
        </dl>
        <table class="qp-lines">
          <caption class="sr-only">Tilbudslinjer</caption>
          <thead><tr><th scope="col">Beskrivelse</th><th scope="col" class="num">Antall</th><th scope="col" class="num">Enhetspris</th><th scope="col" class="num">Sum eks. mva</th></tr></thead>
          <tbody>${lines.map((l) => {
            const net = Math.round((Number(l.quantity) || 0) * (Number(l.unitPriceCents) || 0));
            return `<tr><td class="desc">${esc(l.description)}<span class="sub">${esc(numFmt(l.quantity))} × ${esc(kr(l.unitPriceCents))}${vatRates.length > 1 ? ` · ${esc(numFmt(vatPct(l.vatRate)))} % mva` : ""}</span></td><td class="num hide-sm">${esc(numFmt(l.quantity))}</td><td class="num hide-sm">${esc(kr(l.unitPriceCents))}</td><td class="num">${esc(kr(net))}</td></tr>`;
          }).join("")}</tbody>
        </table>
        <dl class="qp-sums">
          <div><dt>Sum eks. mva</dt><dd>${esc(kr(t.net))}</dd></div>
          <div><dt>Mva${vatRates.length === 1 ? " " + esc(numFmt(vatRates[0])) + " %" : ""}</dt><dd>${esc(kr(t.vat))}</dd></div>
          <div class="grand"><dt>Totalt inkl. mva</dt><dd>${esc(kr(t.total))}</dd></div>
        </dl>
        ${q.notes ? `<div class="qp-notes"><h2>Merknader</h2>${esc(q.notes)}</div>` : ""}
      </article>
      ${answered ? "" : respondHtml(q)}`;
    bindForm();
    if (justAnswered) { const a = document.getElementById("answered"); if (a) { a.focus(); a.scrollIntoView({ block: "start" }); } }
  }

  function bindForm() {
    const form = document.getElementById("respond-form");
    if (!form) return;
    const err = document.getElementById("resp-err");
    const nameEl = document.getElementById("resp-name");
    const showErr = (t, el) => { err.textContent = t; err.hidden = false; if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } };
    const clearErr = () => { err.hidden = true; nameEl.removeAttribute("aria-invalid"); document.getElementById("resp-accept").removeAttribute("aria-invalid"); };
    const box = document.getElementById("decline-box");
    const declineBtn = document.getElementById("btn-decline");
    declineBtn.addEventListener("click", () => {
      const open = box.hidden; box.hidden = !open; declineBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) document.getElementById("resp-comment").focus();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault(); clearErr();
      const name = nameEl.value.trim();
      if (name.length < 2) return showErr("Skriv inn fullt navn.", nameEl);
      const acc = document.getElementById("resp-accept");
      if (!acc.checked) return showErr("Kryss av for at du godtar tilbudet og vilkårene.", acc);
      respond("accepted", name, "");
    });
    document.getElementById("btn-decline-confirm").addEventListener("click", () => {
      clearErr();
      const name = nameEl.value.trim();
      if (name.length < 2) return showErr("Skriv inn fullt navn for å avslå.", nameEl);
      respond("declined", name, document.getElementById("resp-comment").value.trim());
    });
  }

  function setBusy(busy) {
    ["btn-accept", "btn-decline", "btn-decline-confirm"].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = busy; });
    const a = document.getElementById("btn-accept"); if (a) a.textContent = busy ? "Sender …" : "Godta tilbud";
  }

  function respond(status, name, comment) {
    const fields = { status, respondedName: name, respondedAt: isoNow(), respondedComment: comment || "" };
    setBusy(true);
    let p;
    if (source === "firestore") {
      p = F.patchDoc(["publicQuotes", token], fields, { auth: false, fieldPaths: ["status", "respondedName", "respondedAt", "respondedComment"] });
    } else if (source === "office-demo") {
      p = new Promise((res) => { writeOfficeDemo(fields); res(); });
    } else {
      p = new Promise((res) => { try { sessionStorage.setItem(DEMO_RESPONSE_KEY, JSON.stringify(fields)); } catch (e) { /* ignorer */ } res(); });
    }
    p.then(() => { Object.assign(quote, fields); justAnswered = true; render(); })
      .catch((e) => {
        setBusy(false);
        // Kan skje hvis tilbudet allerede er besvart eller trukket tilbake: hent på nytt og vis riktig status.
        if (source === "firestore") {
          F.getDoc(["publicQuotes", token], { auth: false }).then((q) => {
            if (q.status === "accepted" || q.status === "declined") { quote = q; render(); }
            else showSendError(e);
          }).catch(() => showSendError(e));
        } else showSendError(e);
      });
  }
  function showSendError(e) {
    const err = document.getElementById("resp-err");
    if (err) { err.textContent = "Svaret ble ikke sendt. Sjekk nettforbindelsen og prøv igjen. (" + (e && e.message ? e.message : "ukjent feil") + ")"; err.hidden = false; err.focus && err.focus(); }
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-print]")) window.print();
    if (e.target.closest("[data-reset]")) { try { sessionStorage.removeItem(DEMO_RESPONSE_KEY); } catch (x) { /* ignorer */ } quote = builtinDemo(); justAnswered = false; render(); }
  });

  function start() {
    if (local) {
      const office = token && token !== "demo" ? readOfficeDemo() : null;
      if (office) { quote = Object.assign({}, office); source = "office-demo"; }
      else if (!firebase || token === "demo" || !token) { quote = builtinDemo(); source = "builtin"; }
      else return showError("Fant ikke tilbudet", "Demolenken finnes ikke i denne nettleseren.");
      return render();
    }
    if (!token || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return showError("Ugyldig lenke", "Lenken mangler tilbudskode eller er skrevet feil. Åpne lenken du fikk fra firmaet på nytt.");
    F.getDoc(["publicQuotes", token], { auth: false })
      .then((q) => { quote = q; source = "firestore"; render(); })
      .catch((e) => {
        if (e.status === 404 || e.status === 403) showError("Fant ikke tilbudet", "Lenken kan være feil, eller tilbudet er trukket tilbake.");
        else showError("Kunne ikke hente tilbudet", "Sjekk nettforbindelsen og last siden på nytt. (" + e.message + ")");
      });
  }
  start();
})();
