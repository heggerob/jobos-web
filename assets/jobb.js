/* JobOS kundeside for en ordre: jobb.html?t=TOKEN.
   Leser publicJobs/{TOKEN} fra Firestore uten innlogging. Viser status, neste avtale,
   utført arbeid og FDV-dokumentasjon. Demomodus med t=demo eller uten Firebase. */
(() => {
  "use strict";
  const F = window.JobOSFire;
  const root = document.getElementById("portal");
  const params = new URLSearchParams(location.search);
  const token = (params.get("t") || "").trim();
  const firebase = !!(F && F.enabled());

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDateTime = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" }) + " kl. " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const fmtDate = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" }); };

  const STEPS = [
    { key: "planned", label: "Planlagt" },
    { key: "in_progress", label: "Pågår" },
    { key: "completed", label: "Ferdig" }
  ];

  function demo() {
    const next = new Date(); next.setDate(next.getDate() + 2); next.setHours(8, 0, 0, 0);
    return {
      companyName: "Fjordlys Elektro AS", companyPhone: "+47 900 00 000",
      title: "Oppgradering av sikringsskap", address: "Sørens gate 4, 7800 Namsos", customerName: "Grong Sparebank",
      status: "in_progress", nextVisit: next.toISOString(), technician: "Kari",
      updates: [
        { at: new Date(Date.now() - 86400000).toISOString(), text: "Befaring utført. Materiell er bestilt." },
        { at: new Date().toISOString(), text: "Nytt sikringsskap montert. Sluttkontroll gjenstår." }
      ],
      documents: [
        { title: "Arbeidsrapport og FDV", kind: "pdf" },
        { title: "Samsvarserklæring", kind: "pdf" }
      ],
      updatedAt: new Date().toISOString()
    };
  }

  function render(job) {
    const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === job.status));
    const cancelled = job.status === "cancelled";
    document.getElementById("portal-company").textContent = job.companyName || "Din jobb";
    root.innerHTML = `
      <article class="qp-card">
        <p class="eyebrow" style="margin:0">${esc(job.customerName || "")}</p>
        <h1>${esc(job.title || "Jobb")}</h1>
        <p style="margin:-8px 0 20px;color:var(--muted)">${esc(job.address || "")}</p>
        ${cancelled ? `<div class="notice err">Jobben er avlyst. Ta kontakt med ${esc(job.companyName || "firmaet")} ved spørsmål.</div>` : `
        <ol class="jp-steps" aria-label="Status">
          ${STEPS.map((s, i) => `<li class="${i < stepIndex ? "done" : i === stepIndex ? "current" : ""}" ${i === stepIndex ? 'aria-current="step"' : ""}><span>${i < stepIndex ? "✓" : i + 1}</span>${esc(s.label)}</li>`).join("")}
        </ol>`}
        ${job.nextVisit && job.status !== "completed" ? `
          <div class="jp-visit"><strong>Neste besøk</strong><span>${esc(fmtDateTime(job.nextVisit))}${job.technician ? " · " + esc(job.technician) : ""}</span></div>` : ""}
      </article>
      ${(job.updates || []).length ? `
      <article class="qp-card">
        <h2 style="margin-top:0;font-size:1.2rem">Oppdateringer</h2>
        <ul class="jp-updates">${job.updates.slice().reverse().map((u) => `<li><time>${esc(fmtDate(u.at))}</time><p>${esc(u.text)}</p></li>`).join("")}</ul>
      </article>` : ""}
      <article class="qp-card">
        <h2 style="margin-top:0;font-size:1.2rem">Dokumentasjon</h2>
        ${(job.documents || []).length ? `<ul class="jp-docs">${job.documents.map((d) => `
          <li>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">` : "<span>"}📄 ${esc(d.title)}${d.url ? "</a>" : " <small>(kommer når jobben er ferdig)</small></span>"}</li>`).join("")}</ul>`
          : `<p style="color:var(--muted)">Dokumentasjon og FDV legges ut her når jobben er ferdig.</p>`}
      </article>
      ${job.companyPhone ? `<p style="text-align:center;margin-top:20px">Spørsmål? Ring ${esc(job.companyName)} på <a href="tel:${esc(job.companyPhone.replace(/\s/g, ""))}">${esc(job.companyPhone)}</a></p>` : ""}
      <p style="text-align:center;color:var(--muted);font-size:.85rem">Sist oppdatert ${esc(fmtDate(job.updatedAt))}</p>`;
  }

  if (!token || token === "demo" || !firebase) {
    render(demo());
    if (!token || token === "demo") {
      root.insertAdjacentHTML("afterbegin", '<div class="notice info" style="margin-bottom:16px">Eksempel – slik ser kunden jobben sin.</div>');
    }
    return;
  }
  F.getDoc(["publicJobs", token], { auth: false })
    .then((job) => { if (!job) throw new Error("missing"); render(job); })
    .catch(() => {
      root.innerHTML = '<div class="notice err">Fant ikke jobben. Lenken kan være utløpt – ta kontakt med firmaet.</div>';
    });
})();
