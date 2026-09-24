/* JobOS Kontor – enkel kontorside i nettleseren (vanilla JS, ingen byggesteg).
   To moduser med samme datalag:
   - Firebase: innlogging via Identity Toolkit, data via Firestore REST (assets/firestore.js).
   - Demo: realistiske eksempeldata i localStorage («jobos-web-demo»). */
(() => {
  "use strict";
  const F = window.JobOSFire;
  const DEMO_KEY = "jobos-web-demo";
  const DEMO_VERSION = 2; // økes når demodata får nye samlinger, så gamle demodata i localStorage erstattes
  const KM_RATE_CENTS = 350; // 3,50 kr per km
  const COLS = ["jobs", "customers", "appointments", "timeEntries", "quotes", "deviations", "checklists", "trips", "equipment", "members", "formSubmissions", "materials", "purchaseOrders"];
  const VERSIONED = { jobs: 1, appointments: 1, timeEntries: 1, quotes: 1, purchaseOrders: 1 };
  const STAMPED = { jobs: 1, appointments: 1, quotes: 1, deviations: 1, equipment: 1 };
  // Samme id-prefikser som iOS-appen (wsID).
  const ID_PREFIX = { jobs: "job", customers: "customer", appointments: "appointment", timeEntries: "time", quotes: "quote", deviations: "deviation", checklists: "checklist", trips: "trip", equipment: "equipment", formSubmissions: "form", materials: "material", purchaseOrders: "purchase" };

  /* ================= Hjelpefunksjoner ================= */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const moneyFmt = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" });
  const kr = (cents) => moneyFmt.format((Number(cents) || 0) / 100);
  const num = (n, d) => new Intl.NumberFormat("nb-NO", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }).format(Number(n) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  const toIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const isoNow = () => toIso(new Date());
  const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const monthKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayStart = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
  function parseDate(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  const fmtDate = (s) => { const d = parseDate(s); return d ? d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" }) : "–"; };
  const fmtDayShort = (d) => d.toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = (s) => { const d = parseDate(s); return d ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : ""; };
  const fmtDateTime = (s) => { const d = parseDate(s); return d ? fmtDayShort(d) + " kl. " + fmtTime(s) : "–"; };
  const hours = (min) => num((Number(min) || 0) / 60, 1) + " t";
  const daysUntil = (s) => { const d = parseDate(s); return d ? Math.round((d - todayStart()) / 86400000) : null; };
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dn = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dn);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16); });
  }
  const newId = (prefix) => prefix + "-" + uuid();
  const opt = (v) => (v === "" || v == null ? undefined : v);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sget = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const sset = (k, v) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* ignorer */ } };
  function nameFromEmail(email) {
    if (!email) return "";
    return email.split("@")[0].split(/[._-]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }
  const initials = (name) => (name || "?").split(" ").filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "?";
  const byText = (f) => (a, b) => String(f(a) || "").localeCompare(String(f(b) || ""), "nb");
  const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const norm = (s) => String(s || "").toLowerCase();
  const vatPct = (v) => { const n = Number(v) || 0; return n > 0 && n < 1 ? n * 100 : n; }; // tåler både 25 og 0,25
  const qtyFmt = (n) => num(n, Number.isInteger(Number(n)) ? 0 : 2);
  const decFmt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 3 });
  // Tolker kronebeløp skrevet på norsk eller engelsk vis: «1 234,50», «1234.5», «kr 89,-». Gir øre eller null.
  function parseKr(s) {
    let t = String(s == null ? "" : s).replace(/[\s ]/g, "").replace(/^kr\.?/i, "").replace(/(kr|nok)$/i, "").replace(/,-$/, "");
    if (!t) return null;
    const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) t = lc > ld ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (lc >= 0) t = t.replace(/,/g, ".");
    if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
    return Math.round(parseFloat(t) * 100);
  }
  const krInput = (cents) => (cents == null || cents === "" ? "" : (Number(cents) / 100).toFixed(2).replace(".", ","));
  function lineNet(l) { return (Number(l.quantity) || 0) * (Number(l.unitPriceCents) || 0); }
  // Som JobOSPurchaseOrder.totalCents i iOS: hver linje avrundes til hele øre.
  const poTotal = (po) => (po.lines || []).reduce((s, l) => s + Math.round((Number(l.unitPriceCents) || 0) * (Number(l.quantity) || 0)), 0);
  function quoteTotals(q) {
    const lines = q.lines || [];
    const net = Math.round(sum(lines, lineNet));
    const gross = Math.round(sum(lines, (l) => lineNet(l) * (1 + vatPct(l.vatRate) / 100)));
    const total = lines.length ? gross : (Number(q.totalCents) || 0);
    return { net, vat: total - net, total };
  }
  // Samme dokument-id som iOS-appen: "<companyId>_<e-post>" prosentkodet med bare bokstaver/tall uendret.
  function invitationDocId(companyId, email) {
    const enc = new TextEncoder();
    return Array.from(companyId + "_" + email).map((ch) => (/[\p{L}\p{M}\p{N}]/u.test(ch) ? ch
      : Array.from(enc.encode(ch)).map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0")).join(""))).join("");
  }

  /* ================= Etiketter ================= */
  const JOB_STATUS = { planned: ["Planlagt", "info"], in_progress: ["Pågår", "brand"], waiting: ["Venter", "warn"], completed: ["Fullført", "ok"], cancelled: ["Kansellert", "muted"] };
  const APPT_STATUS = { planned: ["Planlagt", "info"], completed: ["Utført", "ok"], cancelled: ["Avlyst", "muted"] };
  const TIME_STATUS = { draft: ["Kladd", "muted"], submitted: ["Innsendt", "warn"], approved: ["Godkjent", "ok"] };
  const QUOTE_STATUS = { draft: ["Utkast", "muted"], sent: ["Sendt", "info"], accepted: ["Godtatt", "ok"], declined: ["Avslått", "err"] };
  const DEV_SEVERITY = { low: ["Lav", ""], medium: ["Middels", "warn"], high: ["Høy", "err"], critical: ["Kritisk", "err"] };
  const DEV_STATUS = { open: ["Åpen", "warn"], in_progress: ["Under arbeid", "brand"], resolved: ["Lukket", "ok"], rejected: ["Avvist", "muted"] };
  const TRIP_STATUS = { active: ["Pågår", "brand"], completed: ["Til godkjenning", "warn"], approved: ["Godkjent", "ok"] };
  const EQ_STATUS = { available: ["Ledig", "ok"], in_use: ["I bruk", "brand"], service: ["På service", "warn"], lost: ["Savnet", "err"] };
  const FORM_STATUS = { draft: ["Kladd", "warn"], completed: ["Fullført", "ok"] };
  const PO_STATUS = { draft: ["Kladd", "muted"], sent: ["Sendt", "info"], ordered: ["Bestilt", "brand"], received: ["Mottatt", "ok"], cancelled: ["Avbrutt", "err"] };
  const ROLE = { owner: "Eier", admin: "Administrator", office: "Kontor", field: "Montør" };
  const OPEN_JOB = { planned: 1, in_progress: 1, waiting: 1 };
  const pill = (map, key) => { const v = map[key] || [key || "–", ""]; return `<span class="pill ${v[1]}">${esc(v[0])}</span>`; };
  const options = (map, sel) => Object.keys(map).map((k) => ({ value: k, label: Array.isArray(map[k]) ? map[k][0] : map[k], selected: k === sel }));

  /* ================= Demo-data ================= */
  function buildDemo() {
    const today = todayStart();
    const now = new Date();
    const at = (off, h, m) => { const x = addDays(today, off); x.setHours(h || 0, m || 0, 0, 0); return x; };
    const iso = (off, h, m) => toIso(at(off, h, m));
    const day = (off) => dayKey(addDays(today, off));
    const monday = startOfWeek(today);
    const wk = (dow, h, m) => { const x = addDays(monday, dow); x.setHours(h, m || 0, 0, 0); return x; };
    const domain = "fjordlys-elektro.no";
    const members = [
      { uid: "u-kari", email: "kari.nordmann@" + domain, role: "owner", status: "active" },
      { uid: "u-sofie", email: "sofie.berg@" + domain, role: "office", status: "active" },
      { uid: "u-ola", email: "ola.hansen@" + domain, role: "field", status: "active" },
      { uid: "u-emir", email: "emir.hadzic@" + domain, role: "field", status: "active" },
      { uid: "u-jonas", email: "jonas.lie@" + domain, role: "field", status: "active" }
    ].map((m) => Object.assign({ id: m.uid }, m));
    const email = (uid) => members.find((m) => m.uid === uid).email;

    const C = (name, mail, phone, address, notes) => ({ id: newId("customer"), name, email: mail, phone, address, notes });
    const customers = [
      C("Borettslaget Solsiden", "styret@solsiden-brl.no", "55 12 34 56", "Solsidevegen 14, 5035 Bergen", "Kontakt: styreleder Trond Moe, 900 11 222"),
      C("Ingrid Solberg", "ingrid.solberg@gmail.com", "912 34 567", "Kirkeveien 8, 5072 Bergen"),
      C("Bakeriet på Torget AS", "post@bakerietpatorget.no", "55 90 11 22", "Torget 3, 5014 Bergen", "Levering bakdør før kl. 06"),
      C("Magnus Eide", "magnus.eide@online.no", "481 22 390", "Fjellsiden 41, 5018 Bergen"),
      C("Nordvik Eiendom AS", "faktura@nordvik-eiendom.no", "55 30 40 50", "Strandkaien 2, 5013 Bergen", "Faktura merkes med prosjektnummer"),
      C("Hanne og Per Kolstad", "hanne.kolstad@hotmail.com", "997 11 223", "Hellevegen 120, 5153 Bønes")
    ];
    const cu = (i) => customers[i];
    const J = (title, ci, status, uid, notes, upd) => ({ id: newId("job"), customerId: cu(ci).id, title, customerName: cu(ci).name, address: cu(ci).address, notes, status, assignedToUserId: uid || undefined, version: 1, updatedAt: iso(upd || 0, 9) });
    const jobs = [
      J("Bytte sikringsskap", 1, "in_progress", "u-ola", "Gammelt skap med skrusikringer. Nytt skap med jordfeilbrytere (RCBO) og overspenningsvern.", -1),
      J("Elbillader i garasjeanlegg (12 punkter)", 0, "planned", "u-emir", "Lastbalansering. Styret må godkjenne plassering av sentral.", -2),
      J("Feilsøking jordfeil kjølerom", 2, "waiting", "u-ola", "Venter på ny kompressorstyring fra leverandør.", -3),
      J("Nytt kjøkken – kurser og downlights", 3, "planned", "u-jonas", "8 downlights, egen kurs til induksjon og oppvaskmaskin.", -4),
      J("Periodisk kontroll fellesareal", 4, "in_progress", "u-emir", "Kontroll etter FEL § 10. Rapport til eier.", -1),
      J("Utelys og stikkontakt terrasse", 5, "completed", "u-jonas", "IP44-stikk og tre vegglamper.", -6),
      J("Varmekabler bad 2. etg", 1, "planned", null, "Avventer tilbud – se Tilbud.", -2),
      J("Oppgradering ladeboks", 5, "cancelled", null, "Kunden valgte å vente.", -20),
      J("Ny kurs til varmepumpe", 4, "completed", "u-ola", "Strandkaien 2, 3. etg.", -9),
      J("Brannalarm – utskifting av detektorer", 0, "waiting", null, "Må avtale tilgang til alle leiligheter.", -5)
    ];
    const jb = (i) => jobs[i];

    const A = (ji, uid, start, end, note) => ({
      id: newId("appointment"), jobId: jb(ji).id, jobTitle: jb(ji).title, customerName: jb(ji).customerName, address: jb(ji).address,
      assignedToUserId: uid || undefined, assignedToEmail: uid ? email(uid) : undefined, startsAt: toIso(start), endsAt: toIso(end),
      status: end < now ? "completed" : "planned", note, version: 1, updatedAt: iso(-7, 10)
    });
    const appointments = [
      A(0, "u-ola", wk(0, 7, 30), wk(0, 15, 0), "Strøm av 08–12, varslet kunden"),
      A(0, "u-ola", wk(1, 7, 30), wk(1, 11, 30)),
      A(2, "u-ola", wk(2, 12, 0), wk(2, 15, 0), "Ta med isolasjonstester"),
      A(0, "u-ola", wk(3, 8, 0), wk(3, 14, 0), "Sluttkontroll og samsvarserklæring"),
      A(4, "u-emir", wk(0, 8, 0), wk(0, 15, 30)),
      A(4, "u-emir", wk(1, 8, 0), wk(1, 12, 0)),
      A(1, "u-emir", wk(3, 7, 30), wk(3, 15, 30), "Befaring med styret kl. 08"),
      A(1, "u-emir", wk(4, 7, 30), wk(4, 12, 0)),
      A(3, "u-jonas", wk(2, 8, 0), wk(2, 14, 0)),
      A(3, "u-jonas", wk(4, 8, 0), wk(4, 15, 0)),
      A(6, null, wk(7, 9, 0), wk(7, 13, 0), "Trenger montør"),
      A(1, "u-emir", wk(7, 7, 30), wk(7, 15, 30))
    ];

    const T = (ji, uid, off, minutes, status) => ({ id: newId("time"), jobId: jb(ji).id, jobTitle: jb(ji).title, userId: uid, workDate: day(off), minutes, status, version: 1 });
    const timeEntries = [
      T(0, "u-ola", -1, 450, "submitted"), T(0, "u-ola", -2, 240, "submitted"), T(2, "u-ola", -3, 180, "submitted"),
      T(4, "u-emir", -1, 480, "submitted"), T(4, "u-emir", -2, 240, "submitted"), T(1, "u-emir", -3, 90, "draft"),
      T(3, "u-jonas", -2, 360, "submitted"), T(5, "u-jonas", -8, 420, "approved"), T(5, "u-jonas", -9, 300, "approved"),
      T(8, "u-ola", -9, 450, "approved"), T(8, "u-ola", -10, 390, "approved"), T(4, "u-emir", -8, 450, "approved"),
      T(2, "u-ola", -12, 120, "approved"), T(3, "u-jonas", 0, 150, "draft")
    ];

    const L = (description, quantity, unitKr, vat) => ({ id: newId("line"), description, quantity, unitPriceCents: Math.round(unitKr * 100), vatRate: vat == null ? 25 : vat, position: 0 });
    const Q = (title, ci, ji, status, lines, notes, validOff, created, extra) => {
      lines.forEach((l, i) => { l.position = i; });
      const q = Object.assign({ id: newId("quote"), customerId: cu(ci).id, customerName: cu(ci).name, jobId: ji == null ? undefined : jb(ji).id, jobTitle: ji == null ? undefined : jb(ji).title, title, status, notes, validUntil: day(validOff), lines, version: 1, createdAt: iso(created, 10), updatedAt: iso(created + 1, 11) }, extra || {});
      q.totalCents = quoteTotals(q).total;
      return q;
    };
    const quotes = [
      Q("Elbillading garasjeanlegg – 12 ladepunkter", 0, 1, "sent", [
        L("Ladeboks Easee Charge Core, montert", 12, 8990), L("Lastbalansering og energimåler", 1, 14500),
        L("Kabling og føringsveier (meter)", 180, 189), L("Arbeid montør (timer)", 64, 895)
      ], "Forutsetter fri tilgang til garasjen i arbeidstiden. Graving er ikke inkludert.", 5, -12),
      Q("Varmekabler bad 2. etg", 1, 6, "draft", [
        L("Varmekabel 10 W/m², 6 m²", 1, 3890), L("Termostat med gulvføler", 1, 1590), L("Arbeid montør (timer)", 6, 895), L("Samsvarserklæring og dokumentasjon", 1, 750)
      ], "Flislegging utføres av andre.", 21, -2),
      Q("Utelys og stikkontakt terrasse", 5, 5, "accepted", [
        L("Vegglampe LED IP54", 3, 1290), L("Stikkontakt IP44 med jordfeil", 1, 890), L("Arbeid montør (timer)", 7, 895)
      ], null, -10, -25, { respondedName: "Hanne Kolstad" }),
      Q("Nytt sikringsskap – alternativ med smarthus", 3, null, "declined", [
        L("Sikringsskap 36 moduler med RCBO", 1, 18900), L("Smartmåler og styring", 1, 6400), L("Arbeid montør (timer)", 12, 895)
      ], null, -3, -30, { respondedName: "Magnus Eide" })
    ];

    const D = (ji, title, description, severity, status, uid, off) => ({ id: newId("deviation"), jobId: jb(ji).id, jobTitle: jb(ji).title, customerName: jb(ji).customerName, address: jb(ji).address, title, description, severity, status, createdByUserId: uid, createdAt: iso(off, 11), updatedAt: iso(off, 11) });
    const deviations = [
      D(1, "Manglende fallsikring på stige i garasje", "Stigen i rampen mangler stigefot og feste. Arbeid i høyden stanset til sikring er på plass.", "critical", "open", "u-emir", -1),
      D(2, "Kondens i koblingsboks kjølerom", "Vann i koblingsboks over døra. Mulig årsak til jordfeil. Boks må byttes til IP65.", "high", "open", "u-ola", -3),
      D(4, "Manglende merking av kurser i fellesareal", "12 kurser uten merking i underfordeling U2.", "medium", "in_progress", "u-emir", -2),
      D(0, "Skadet gulvlist ved inntak", "Gulvlist knekt ved demontering av gammelt skap. Kunden er informert.", "low", "open", "u-ola", -1),
      D(5, "Løs kabelgjennomføring", "Gjennomføring i yttervegg tettet og kontrollert.", "low", "resolved", "u-jonas", -7)
    ];

    const CL = (ji, title, templateKey, status, labels, done, signerName, signedOff) => ({
      id: newId("checklist"), jobId: jb(ji).id, title, templateKey, status, signerName, signedAt: signedOff == null ? undefined : iso(signedOff, 15),
      items: labels.map((label, i) => ({ id: newId("item"), label, position: i, isCompleted: i < done, completedAt: i < done ? iso(-1, 12) : undefined }))
    });
    const checklists = [
      CL(0, "Sluttkontroll NEK 400", "nek400-sluttkontroll", "in_progress", ["Visuell kontroll", "Kontinuitet i jordledere", "Isolasjonsmåling", "Test av jordfeilbrytere", "Merking av kurser", "Samsvarserklæring til kunde"], 3),
      CL(5, "Sluttkontroll utelys", "nek400-sluttkontroll", "signed", ["Visuell kontroll", "Isolasjonsmåling", "Test av jordfeilbryter", "Samsvarserklæring til kunde"], 4, "Hanne Kolstad", -6),
      CL(4, "SJA – arbeid i høyden", "sja", "completed", ["Risiko gjennomgått med alle", "Stige/lift kontrollert", "Avsperring satt opp"], 3)
    ];

    const base = "Kokstadvegen 23, 5257 Kokstad";
    const TR = (uid, off, h, to, km, purpose, ji, status, extra) => Object.assign({
      id: newId("trip"), userId: uid, userEmail: email(uid), startedAt: iso(off, h), endedAt: status === "active" ? undefined : iso(off, h, 40),
      fromAddress: base, toAddress: to, distanceKm: km, purpose, jobId: ji == null ? undefined : jb(ji).id, jobTitle: ji == null ? undefined : jb(ji).title,
      vehicle: uid === "u-ola" ? "EL 12345 – VW ID. Buzz" : uid === "u-emir" ? "EL 23456 – Ford E-Transit" : "EL 34567 – Toyota Proace",
      tollCents: 0, ferryCents: 0, parkingCents: 0, isPrivate: false, status
    }, extra || {});
    const trips = [
      TR("u-ola", 0, 7, jb(0).address, 14.2, "Kjøring til oppdrag", 0, "active"),
      TR("u-ola", -1, 7, jb(0).address, 14.2, "Kjøring til oppdrag", 0, "completed", { tollCents: 2800 }),
      TR("u-emir", -1, 7, jb(4).address, 11.6, "Kontroll fellesareal", 4, "completed", { tollCents: 2800, parkingCents: 12000 }),
      TR("u-ola", -3, 11, jb(2).address, 10.9, "Feilsøking", 2, "completed", { parkingCents: 4500 }),
      TR("u-jonas", -2, 7, jb(3).address, 12.3, "Befaring kjøkken", 3, "completed"),
      TR("u-emir", -3, 12, "Elektroskandia, Kanalveien 57, 5068 Bergen", 8.4, "Henting av materiell", null, "completed"),
      TR("u-jonas", -4, 16, "Os sentrum", 24.0, "Privat", null, "completed", { isPrivate: true }),
      TR("u-jonas", -8, 7, jb(5).address, 9.8, "Montering utelys", 5, "approved"),
      TR("u-ola", -9, 7, jb(8).address, 11.6, "Ny kurs varmepumpe", 8, "approved", { tollCents: 2800 }),
      TR("u-emir", -15, 7, "Stord – Leirvik", 78.5, "Service for eksisterende kunde", null, "approved", { tollCents: 5600, ferryCents: 18900 }),
      TR("u-ola", -32, 7, jb(2).address, 10.9, "Feilsøking", 2, "approved"),
      TR("u-emir", -35, 8, jb(4).address, 11.6, "Befaring", 4, "approved", { tollCents: 2800 })
    ];

    const E = (name, category, serialNumber, status, uid, ji, location, svcOff, notes) => ({
      id: newId("equipment"), name, category, serialNumber, status, assignedToUserId: uid || undefined, assignedToEmail: uid ? email(uid) : undefined,
      jobId: ji == null ? undefined : jb(ji).id, jobTitle: ji == null ? undefined : jb(ji).title, location, nextServiceDate: svcOff == null ? undefined : day(svcOff), notes, updatedAt: iso(-2, 8)
    });
    const equipment = [
      E("Isolasjonstester Fluke 1664 FC", "Måleinstrument", "FL-1664-44821", "in_use", "u-ola", 0, jb(0).address, 9, "Årlig kalibrering"),
      E("Termokamera FLIR E8", "Måleinstrument", "FLIR-E8-10293", "service", null, null, "Kalibreringslab, Oslo", -3, "Sendt til kalibrering"),
      E("Kabeltrekkeapparat Katimex", "Verktøy", "KX-5520", "in_use", "u-emir", 1, jb(1).address, 45),
      E("Borhammer Hilti TE 30", "Maskin", "HI-8812", "available", null, null, "Lager", 120),
      E("Stige 3-delt 7,5 m", "Stige", undefined, "available", null, null, "Bil EL 12345", 20, "Kontroller stigefot før bruk"),
      E("Installasjonstester Metrel MI 3152", "Måleinstrument", "MT-3152-7781", "in_use", "u-jonas", 3, jb(3).address, 160),
      E("Lysmåler Testo 545", "Måleinstrument", "TS-545-001", "lost", null, null, "Sist sett: Strandkaien 2")
    ];

    // Skjema: felt kopiert fra de innebygde malene i iOS-appen (JobOSFormLibrary).
    const FF = (id, label, kind, extra) => Object.assign({ id, label, kind, isRequired: false }, extra || {});
    const req = { isRequired: true };
    const samsvarFields = () => [
      FF("h1", "Installasjonen", "heading"),
      FF("type", "Type arbeid", "choice", { options: ["Nyanlegg", "Utvidelse", "Endring", "Reparasjon"], isRequired: true }),
      FF("norm", "Normgrunnlag", "choice", { options: ["NEK 400:2022", "NEK 400:2018", "Annet"], isRequired: true }),
      FF("beskrivelse", "Beskrivelse av arbeidet", "longText", req),
      FF("h2", "Målinger", "heading"),
      FF("isolasjon", "Isolasjonsresistans", "number", { unit: "MΩ", isRequired: true }),
      FF("kontinuitet", "Kontinuitet jordleder", "number", { unit: "Ω", isRequired: true }),
      FF("jfb", "Jordfeilbryter testet og utløser", "yesNo", req),
      FF("kurs", "Kursfortegnelse oppdatert", "yesNo", req),
      FF("risiko", "Risikovurdering er utført", "yesNo", req),
      FF("bilder", "Bilde av tavle og kursfortegnelse", "photo"),
      FF("merknad", "Merknader", "longText"),
      FF("signatur", "Signatur ansvarlig installatør", "signature", req)
    ];
    const docs = (n) => Array.from({ length: n }, () => newId("document"));
    const FS = (ji, templateId, title, fields, answers, status, by, doneOff, updOff) => ({
      id: newId("form"), jobId: jb(ji).id, templateId, title, fields, answers, status,
      completedBy: by || undefined, completedAt: doneOff == null ? undefined : iso(doneOff, 15, 20), updatedAt: iso(updOff, 15, 20)
    });
    const formSubmissions = [
      FS(5, "builtin-samsvar", "Samsvarserklæring og sluttkontroll", samsvarFields(), [
        { fieldId: "type", text: "Utvidelse" }, { fieldId: "norm", text: "NEK 400:2022" },
        { fieldId: "beskrivelse", text: "Ny kurs 16 A (RCBO B16 30 mA) fra hovedtavle til terrasse. Montert tre vegglamper LED IP54 og én dobbel stikkontakt IP44. Kabel PFSP 3G2,5 i rør langs yttervegg." },
        { fieldId: "isolasjon", number: 299 }, { fieldId: "kontinuitet", number: 0.18 },
        { fieldId: "jfb", bool: true }, { fieldId: "kurs", bool: true }, { fieldId: "risiko", bool: true },
        { fieldId: "bilder", documentIds: docs(3) },
        { fieldId: "merknad", text: "Kunden er informert om at utekursen må testes med testknapp to ganger i året." },
        { fieldId: "signatur", documentIds: docs(1) }
      ], "completed", "Jonas Lie", -6, -6),
      FS(0, "builtin-samsvar", "Samsvarserklæring og sluttkontroll", samsvarFields(), [
        { fieldId: "type", text: "Endring" }, { fieldId: "norm", text: "NEK 400:2022" },
        { fieldId: "beskrivelse", text: "Utskifting av sikringsskap med skrusikringer til nytt skap med RCBO på alle kurser og overspenningsvern type 2." },
        { fieldId: "isolasjon", number: 185 }, { fieldId: "jfb", bool: true }, { fieldId: "bilder", documentIds: docs(2) }
      ], "draft", null, null, -1),
      FS(6, "builtin-befaring", "Befaring", [
        FF("kontakt", "Kontaktperson på stedet", "text"),
        FF("onske", "Hva ønsker kunden?", "longText", req),
        FF("tilkomst", "Tilkomst og parkering", "text"),
        FF("risiko", "Risiko eller hindringer på stedet", "longText"),
        FF("bilder", "Bilder fra befaringen", "photo"),
        FF("tid", "Estimert tid", "number", { unit: "timer" }),
        FF("neste", "Neste steg", "choice", { options: ["Send tilbud", "Planlegg jobben", "Ingen videre oppfølging"], isRequired: true })
      ], [
        { fieldId: "kontakt", text: "Ingrid Solberg, 912 34 567" },
        { fieldId: "onske", text: "Varmekabler i hele badet (ca. 6 m²) med termostat ved døren. Ønsker ferdig før flislegger starter om tre uker." },
        { fieldId: "tilkomst", text: "Gateparkering foran huset. Nøkkel i nøkkelboks, kode fås på SMS." },
        { fieldId: "bilder", documentIds: docs(4) }
      ], "draft", null, null, -2)
    ];

    const M = (sku, name, unit, category, supplierName, costKr, stock, reorderPoint, reorderTarget, ean) => ({
      id: newId("material"), sku, ean, name, category, unit, stockQuantity: stock, supplierName, costPriceCents: Math.round(costKr * 100),
      reorderPoint: reorderPoint || 0, reorderTarget: reorderTarget || 0
    });
    const materials = [
      M("1000126", "Installasjonskabel PFSP 3G1,5 mm²", "m", "Kabel", "Elektroskandia", 8.9, 240, 100, 400, "7045320012612"),
      M("1000127", "Installasjonskabel PFSP 3G2,5 mm²", "m", "Kabel", "Elektroskandia", 13.9, 85, 100, 300, "7045320012629"),
      M("1003360", "Kabel PFXP 5G10 mm²", "m", "Kabel", "Solar", 89, 30, 0, 0),
      M("1604210", "Jordfeilautomat RCBO 1P+N B16 30 mA", "stk", "Vern", "Elektroskandia", 389, 14, 10, 30, "4015081678931"),
      M("1604590", "Overspenningsvern type 2, 3P+N", "stk", "Vern", "Solar", 1290, 2, 2, 4),
      M("1405136", "Sikringsskap 36 moduler, utenpåliggende", "stk", "Tavle", "Onninen", 1890, 1, 0, 0),
      M("1450201", "Stikkontakt 2-veis jordet, hvit", "stk", "Brytere og stikk", "Elektroskandia", 69, 48, 20, 60),
      M("4610372", "Downlight LED 7 W 2700 K IP44, dimbar", "stk", "Belysning", "Onninen", 249, 12, 16, 40),
      M("1234780", "Koblingsboks IP65 100×100 mm", "stk", "Installasjonsmateriell", "Solar", 49, 20, 10, 30),
      M("1073210", "Varmekabel 10 W/m² for bad, 60 W", "stk", "Varme", "Elektroskandia", 2140, 0, 0, 0),
      M("5401010", "Easee Charge Core ladeboks", "stk", "Elbillading", "Solar", 6490, 4, 0, 0, "7071234500018"),
      M("1831002", "Kabelstrips 200 mm svart (100 pk)", "pk", "Forbruk", "Onninen", 59, 9, 5, 20)
    ];
    const mat = (sku) => materials.find((m) => m.sku === sku);
    const PL = (sku, quantity) => { const m = mat(sku); return { id: newId("purchase-line"), materialName: m.name, sku: m.sku, quantity, unit: m.unit, unitPriceCents: m.costPriceCents }; };
    const purchaseOrders = [
      { id: newId("purchase"), orderNumber: "IO-1041", supplierName: "Elektroskandia", status: "ordered", jobId: jb(0).id, jobTitle: jb(0).title, deliveryAddress: base,
        note: "Hentes på lager Kanalveien. Merk med ordrenummer.", createdAt: iso(-2, 13), sentAt: iso(-2, 13, 30), version: 2,
        lines: [PL("1604210", 12), PL("1000127", 100), PL("1450201", 10), { id: newId("purchase-line"), materialName: "Frakt", quantity: 1, unit: "stk", unitPriceCents: 19000 }] },
      { id: newId("purchase"), orderNumber: "IO-1042", supplierName: "Solar", status: "draft", jobId: jb(1).id, jobTitle: jb(1).title, deliveryAddress: jb(1).address,
        note: "Levering til garasjeanlegget. Ring styreleder Trond Moe (900 11 222) ved ankomst.", createdAt: iso(-1, 10), version: 1,
        lines: [PL("5401010", 12), PL("1003360", 180), PL("1604590", 1), PL("1234780", 12)] }
    ];

    return {
      v: DEMO_VERSION,
      company: { id: "demo-fjordlys", name: "Fjordlys Elektro AS", trades: ["elektro"] },
      user: { uid: "u-kari", email: "kari.nordmann@" + domain },
      jobs, customers, appointments, timeEntries, quotes, deviations, checklists, trips, equipment, members,
      formSubmissions, materials, purchaseOrders,
      invitations: [{ id: invitationDocId("demo-fjordlys", "maria.fjell@" + domain), email: "maria.fjell@" + domain, companyId: "demo-fjordlys", companyName: "Fjordlys Elektro AS", trades: ["elektro"], role: "field", status: "pending", invitedBy: "u-kari", createdAt: iso(-2, 14) }],
      publicQuotes: {}
    };
  }

  /* ================= Datalag ================= */
  function DemoStore() {
    let data = null;
    const persist = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch (e) { /* full eller blokkert lagring */ } };
    try { const raw = localStorage.getItem(DEMO_KEY); if (raw) { const d = JSON.parse(raw); if (d && d.v === DEMO_VERSION) data = d; } } catch (e) { data = null; }
    if (!data) { data = buildDemo(); persist(); }
    const idOf = (col, o) => (col === "members" ? o.uid || o.id : o.id);
    return {
      mode: "demo",
      company: () => data.company,
      user: () => data.user,
      list: (col) => Promise.resolve(clone(data[col] || [])),
      save(col, obj) {
        const arr = data[col] = data[col] || [];
        const i = arr.findIndex((x) => idOf(col, x) === idOf(col, obj));
        const copy = clone(obj);
        if (i >= 0) arr[i] = copy; else arr.push(copy);
        persist();
        return Promise.resolve(clone(copy));
      },
      remove(col, id) { data[col] = (data[col] || []).filter((x) => idOf(col, x) !== id); persist(); return Promise.resolve(); },
      getPublicQuote: (token) => Promise.resolve(data.publicQuotes && data.publicQuotes[token] ? clone(data.publicQuotes[token]) : null),
      savePublicQuote(token, doc) { data.publicQuotes = data.publicQuotes || {}; data.publicQuotes[token] = clone(doc); persist(); return Promise.resolve(); },
      listInvitations: () => Promise.resolve(clone(data.invitations || [])),
      invite(inv) { const o = Object.assign({ id: invitationDocId(inv.companyId, inv.email) }, inv); data.invitations = (data.invitations || []).filter((x) => x.id !== o.id).concat([o]); persist(); return Promise.resolve(clone(o)); },
      removeInvitation(id) { data.invitations = (data.invitations || []).filter((x) => x.id !== id); persist(); return Promise.resolve(); },
      reset() { data = buildDemo(); persist(); }
    };
  }

  function FirebaseStore(company) {
    const cid = company.id;
    const strip = (col, obj) => {
      const o = {};
      Object.keys(obj).forEach((k) => { if (k.charAt(0) !== "_" && obj[k] !== undefined) o[k] = obj[k]; });
      if (col === "members") delete o.id;
      return o;
    };
    return {
      mode: "firebase",
      list: (col) => F.listDocs(["companies", cid, col]).then((docs) => (col === "members" ? docs.map((m) => Object.assign({ uid: m.id }, m)) : docs)),
      save: (col, obj) => F.patchDoc(["companies", cid, col, col === "members" ? (obj.uid || obj.id) : obj.id], strip(col, obj)).then(() => obj),
      remove: (col, id) => F.deleteDoc(["companies", cid, col, id]),
      getPublicQuote: (token) => F.getDoc(["publicQuotes", token]),
      savePublicQuote: (token, doc) => F.patchDoc(["publicQuotes", token], doc),
      // Ventende invitasjoner speiles under firmaet (companies/{cid}/invites), som medlemmer kan liste.
      listInvitations: () => F.listDocs(["companies", cid, "invites"]).catch(() => []),
      invite(inv) {
        const id = invitationDocId(cid, inv.email);
        return F.patchDoc(["invitations", id], inv)
          .then(() => F.patchDoc(["companies", cid, "invites", id], inv))
          .then(() => Object.assign({ id }, inv));
      },
      removeInvitation: (id) => F.deleteDoc(["invitations", id]).then(() => F.deleteDoc(["companies", cid, "invites", id]).catch(() => {}))
    };
  }

  /* ================= Tilstand ================= */
  const S = {
    store: null, mode: null, user: null, company: null, companies: [], me: null,
    data: {}, loaded: false, tab: "oversikt",
    f: { jobQ: "", jobStatus: "open", timeStatus: "", timeMonth: "", timeUser: "", tripMonth: monthKey(new Date()), tripUser: "", tripStatus: "", eqQ: "", eqStatus: "", custQ: "", quoteStatus: "", devStatus: "active", formStatus: "", matQ: "", matCat: "", poStatus: "" },
    week: startOfWeek(new Date()),
    drawerFn: null, form: null, syncedQuotes: false
  };
  const view = () => $("#view");
  const members = () => (S.data.members || []);
  const activeMembers = () => members().filter((m) => m.status !== "removed").sort(byText((m) => nameFromEmail(m.email)));
  const memberOf = (uid) => members().find((m) => (m.uid || m.id) === uid);
  function person(uid, email) {
    const m = uid ? memberOf(uid) : null;
    const e = (m && m.email) || email;
    if (e) return nameFromEmail(e);
    return uid ? "Ukjent bruker" : "Ikke tildelt";
  }
  const memberOptions = (sel, emptyLabel) => [{ value: "", label: emptyLabel || "Ikke tildelt" }].concat(activeMembers().map((m) => ({ value: m.uid || m.id, label: nameFromEmail(m.email) + " (" + (ROLE[m.role] || m.role) + ")", selected: (m.uid || m.id) === sel })));
  const jobOf = (id) => (S.data.jobs || []).find((j) => j.id === id);
  const canManage = () => S.mode === "demo" || (S.me && (S.me.role === "owner" || S.me.role === "admin"));

  /* ================= UI-byggesteiner ================= */
  function toast(msg, kind) {
    const t = $("#toast");
    t.textContent = msg; t.className = "toast " + (kind || "ok"); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 4000);
  }
  const fail = (err) => { console.warn(err); toast(err && err.message ? err.message : "Noe gikk galt.", "err"); if (err && err.authExpired) setTimeout(() => location.reload(), 1500); };
  const pageHead = (title, sub, actions) => `<div class="page-head"><div><h1 id="page-title" tabindex="-1">${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
  const empty = (text) => `<div class="empty">${esc(text)}</div>`;
  const btn = (label, action, attrs, cls) => `<button type="button" class="btn ${cls || "btn-secondary"} btn-sm" data-action="${action}" ${attrs || ""}>${label}</button>`;
  const td = (label, html, cls) => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}><div class="cell">${html}</div></td>`;
  function table(headers, rows, caption) {
    if (!rows.length) return "";
    return `<div class="table-wrap"><table class="data">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ""}<thead><tr>${headers.map((h) => `<th scope="col"${h.cls ? ` class="${h.cls}"` : ""}>${esc(h.label || h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }
  function selectHtml(id, label, opts, attrs) {
    return `<div class="filter"><label for="${id}">${esc(label)}</label><select id="${id}" ${attrs || ""}>${opts.map((o) => `<option value="${esc(o.value)}"${o.selected ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div>`;
  }
  const filterSelect = (key, label, opts) => selectHtml("flt-" + key, label, opts.map((o) => Object.assign({}, o, { selected: String(o.value) === String(S.f[key]) })), `data-filter="${key}"`);
  const filterInput = (key, label, type, ph) => `<div class="filter"><label for="flt-${key}">${esc(label)}</label><input id="flt-${key}" type="${type || "search"}" data-filter="${key}" value="${esc(S.f[key])}"${ph ? ` placeholder="${esc(ph)}"` : ""}></div>`;
  const openLink = (action, id, label) => `<button type="button" class="linkbtn" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
  // Filterbrikker: knapper med aria-pressed som setter S.f[key].
  const chips = (key, label, opts) => `<div class="filter"><span class="filter-label" id="chips-${key}">${esc(label)}</span><div class="chips" role="group" aria-labelledby="chips-${key}">${opts.map((o) =>
    `<button type="button" class="chip" data-action="set-filter" data-key="${key}" data-value="${esc(o.value)}" aria-pressed="${String(o.value) === String(S.f[key]) ? "true" : "false"}">${esc(o.label)}${o.count != null ? ` <span class="chip-count">${o.count}</span>` : ""}</button>`).join("")}</div></div>`;

  /* ---------- Utskrift ---------- */
  // Legger et eget utskriftsark i <body>; print-stilarket skjuler alt annet mens body har klassen «printing».
  function printSheet(html, docTitle) {
    let sheet = $("#print-sheet");
    if (!sheet) { sheet = document.createElement("div"); sheet.id = "print-sheet"; sheet.className = "print-sheet"; document.body.appendChild(sheet); }
    sheet.innerHTML = html;
    const oldTitle = document.title;
    let finished = false;
    const done = () => { if (finished) return; finished = true; document.body.classList.remove("printing"); document.title = oldTitle; window.removeEventListener("afterprint", done); };
    document.body.classList.add("printing");
    if (docTitle) document.title = docTitle; // blir filnavnet ved «Lagre som PDF»
    window.addEventListener("afterprint", done);
    try { window.print(); } catch (e) { done(); toast("Utskrift er ikke tilgjengelig i denne nettleseren.", "err"); }
    // Noen nettlesere sender ikke afterprint (eller print() blokkerer ikke); rydd opp når siden får fokus igjen.
    setTimeout(() => { if (finished) return; ["focus", "pointerdown", "keydown"].forEach((ev) => window.addEventListener(ev, done, { once: true })); }, 500);
  }

  /* ---------- Panel (drawer) ---------- */
  function openDrawer(fn) {
    S.drawerFn = fn;
    const d = $("#drawer");
    if (!renderDrawer()) return;
    if (!d.open) { S.drawerReturn = document.activeElement; d.showModal(); $("#drawer-body").scrollTop = 0; }
  }
  function renderDrawer() {
    if (!S.drawerFn) return false;
    const r = S.drawerFn();
    if (!r) { closeDrawer(); return false; }
    withFocus(() => { $("#drawer-title").textContent = r.title; $("#drawer-body").innerHTML = r.html; });
    return true;
  }
  function closeDrawer() { const d = $("#drawer"); S.drawerFn = null; if (d.open) d.close(); }

  /* ---------- Skjema (modal) ---------- */
  function fieldHtml(f) {
    if (f.type === "custom") return f.html;
    const id = "f-" + f.name;
    const req = f.required ? ' required aria-required="true"' : "";
    const hintId = f.hint ? ` aria-describedby="${id}-hint"` : "";
    const hint = f.hint ? `<p class="hint" id="${id}-hint">${esc(f.hint)}</p>` : "";
    const cls = "field" + (f.full ? " full" : "");
    const v = f.value == null ? "" : f.value;
    if (f.type === "checkbox") return `<div class="${cls}"><label class="check"><input type="checkbox" id="${id}" name="${f.name}"${f.value ? " checked" : ""}${hintId}> ${esc(f.label)}</label>${hint}</div>`;
    const label = `<label for="${id}">${esc(f.label)}${f.required ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>`;
    let input;
    if (f.type === "select") {
      input = `<select id="${id}" name="${f.name}"${req}${hintId}>${(f.options || []).map((o) => `<option value="${esc(o.value)}"${o.selected || String(o.value) === String(v) ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
    } else if (f.type === "textarea") {
      input = `<textarea id="${id}" name="${f.name}" rows="3"${req}${hintId}>${esc(v)}</textarea>`;
    } else {
      const list = f.datalist ? ` list="${id}-list"` : "";
      const extra = ["min", "max", "step", "autocomplete", "placeholder", "inputmode"].map((a) => (f[a] != null ? ` ${a}="${esc(f[a])}"` : "")).join("");
      input = `<input id="${id}" name="${f.name}" type="${f.type || "text"}" value="${esc(v)}"${list}${extra}${req}${hintId}>` +
        (f.datalist ? `<datalist id="${id}-list">${f.datalist.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>` : "");
    }
    return `<div class="${cls}">${label}${input}${hint}</div>`;
  }
  function openForm(o) {
    S.form = o;
    $("#modal-title").textContent = o.title;
    $("#modal-body").innerHTML = `<div class="form-grid">${o.fields.map(fieldHtml).join("")}</div>`;
    $("#modal-actions").innerHTML = (o.danger ? `<button type="button" class="btn btn-danger btn-sm" data-modal-danger>${esc(o.danger.label)}</button>` : "") +
      `<span class="spacer"></span><button type="button" class="btn btn-secondary btn-sm" data-close>Avbryt</button><button type="submit" class="btn btn-primary btn-sm">${esc(o.submitLabel || "Lagre")}</button>`;
    const err = $("#modal-error"); err.hidden = true; err.textContent = "";
    const m = $("#modal");
    if (!m.open) { S.modalReturn = document.activeElement; m.showModal(); }
    if (o.onMount) o.onMount($("#modal-body"));
    const first = $("#modal-body input:not([type=hidden]), #modal-body select, #modal-body textarea");
    if (first) first.focus();
  }
  function formError(msg, fieldName) {
    const err = $("#modal-error"); err.textContent = msg; err.hidden = false;
    $$("#modal-body [aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    if (fieldName) { const el = $("#f-" + fieldName); if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } }
  }
  function submitForm() {
    const o = S.form; if (!o) return;
    const form = $("#modal-form");
    const values = {};
    for (const f of o.fields) {
      if (!f.name || f.type === "custom") continue;
      const el = form.elements[f.name]; if (!el) continue;
      values[f.name] = f.type === "checkbox" ? el.checked : String(el.value).trim();
      if (f.required && !values[f.name]) { formError("Fyll inn «" + f.label + "».", f.name); return; }
    }
    const submit = $("#modal-actions button[type=submit]");
    submit.disabled = true;
    Promise.resolve().then(() => o.onSubmit(values, $("#modal-body")))
      .then(() => { S.form = null; $("#modal").close(); })
      .catch((e) => { formError(e.message || "Kunne ikke lagre.", e.field); if (e.authExpired) setTimeout(() => location.reload(), 1500); })
      .then(() => { submit.disabled = false; });
  }
  const fieldErr = (msg, field) => { const e = new Error(msg); e.field = field; return e; };

  /* ---------- Fokus bevares ved ny tegning ---------- */
  function withFocus(fn) {
    const a = document.activeElement;
    const id = a && a.id;
    const sel = a && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
    fn();
    if (id) {
      const el = document.getElementById(id);
      if (el && el !== document.activeElement) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* type=month osv. */ } }
    }
  }

  /* ---------- Lagring ---------- */
  function persist(col, obj) {
    const o = Object.assign({}, obj);
    Object.keys(o).forEach((k) => { if (o[k] === undefined) delete o[k]; });
    if (!o.id && col !== "members") o.id = newId(ID_PREFIX[col] || col);
    if (VERSIONED[col]) o.version = (parseInt(o.version, 10) || 0) + 1;
    if (STAMPED[col]) o.updatedAt = isoNow();
    return S.store.save(col, o).then(() => {
      const arr = S.data[col] = S.data[col] || [];
      const key = (x) => (col === "members" ? x.uid || x.id : x.id);
      const i = arr.findIndex((x) => key(x) === key(o));
      if (i >= 0) arr[i] = o; else arr.push(o);
      rerender();
      return o;
    });
  }
  function removeDoc(col, id) {
    return S.store.remove(col, id).then(() => {
      S.data[col] = (S.data[col] || []).filter((x) => x.id !== id);
      rerender();
    });
  }
  function rerender() { if (!S.loaded) return; withFocus(renderView); renderDrawer(); }

  /* ================= Oppstart / innlogging ================= */
  function gate(html) {
    document.body.classList.add("gated");
    $("#app-nav").hidden = true;
    view().innerHTML = `<div class="gate">${html}</div>`;
  }
  function renderLogin(message) {
    $("#user-menu-wrap").hidden = true;
    $("#company-slot").innerHTML = "";
    gate(`<div class="card gate-card">
      <h1>Logg inn på Kontor</h1>
      <p class="muted">Bruk samme e-post og passord som i JobOS-appen.</p>
      <p class="notice ${message ? "err" : "info"}" id="login-msg" role="status" aria-live="polite"${message ? "" : " hidden"}>${esc(message || "")}</p>
      <form class="form" id="login-form" novalidate>
        <div class="field"><label for="login-email">E-post</label><input id="login-email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="login-password">Passord</label><input id="login-password" type="password" autocomplete="current-password" required minlength="6"></div>
        <button class="btn btn-primary" type="submit" id="login-submit">Logg inn</button>
      </form>
      <div class="or"><span>eller</span></div>
      <button type="button" class="btn btn-secondary btn-block" data-action="start-demo">Prøv demo</button>
      <p class="small muted" style="margin-top:16px">Ny bedrift? <a href="logg-inn.html#opprett">Opprett bedrift</a> · Glemt passord? <a href="kontakt.html#brukerstotte">Kontakt brukerstøtte</a></p>
    </div>`);
    $("#login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const msg = $("#login-msg"); const sub = $("#login-submit");
      const email = $("#login-email").value.trim(); const pw = $("#login-password").value;
      const show = (t, k) => { msg.textContent = t; msg.className = "notice " + k; msg.hidden = false; };
      if (!email || !pw) { show("Fyll inn e-post og passord.", "err"); return; }
      sub.disabled = true; show("Logger inn …", "info");
      F.signIn(email, pw).then((s) => startFirebase(s)).catch((err) => { show(err.message, "err"); sub.disabled = false; });
    });
    $("#login-email").focus();
  }
  function companyFromPath(p) { const parts = String(p || "").split("/"); const i = parts.lastIndexOf("members"); return i > 0 ? parts[i - 1] : null; }
  function startFirebase(s) {
    S.user = { uid: s.uid, email: s.email };
    gate(`<p class="loading">Finner firmaene dine …</p>`);
    F.runQuery([], {
      from: [{ collectionId: "members", allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: s.uid } } }
    }).then((rows) => {
      const ms = rows.filter((r) => r.status !== "removed").map((r) => ({ id: companyFromPath(r._path), role: r.role })).filter((m) => m.id);
      return Promise.all(ms.map((m) => F.getDoc(["companies", m.id])
        .then((c) => ({ id: m.id, name: c.name || m.id, trades: c.trades || [], role: m.role }))
        .catch(() => ({ id: m.id, name: m.id, trades: [], role: m.role }))));
    }).then((companies) => {
      S.companies = companies.sort(byText((c) => c.name));
      if (!companies.length) return renderNoCompany();
      const saved = companies.find((c) => c.id === sget("jobos_companyId"));
      if (saved) return openCompany(saved);
      if (companies.length === 1) return openCompany(companies[0]);
      renderCompanyPicker();
    }).catch((err) => {
      if (err.authExpired || err.status === 401) { F.session.clear(); return renderLogin(err.message); }
      renderFatal(err);
    });
  }
  function renderNoCompany() {
    renderChrome();
    gate(`<div class="card gate-card"><h1>Ingen firma funnet</h1><p>Brukeren ${esc(S.user.email)} er ikke medlem av noe firma ennå. Opprett firmaet i JobOS-appen, eller be en administrator invitere deg.</p>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-action="reload">Prøv igjen</button><button type="button" class="btn btn-secondary" data-action="start-demo">Prøv demo</button><button type="button" class="btn btn-secondary" data-action="logout">Logg ut</button></div></div>`);
  }
  function renderCompanyPicker() {
    renderChrome();
    gate(`<div class="card gate-card"><h1>Velg firma</h1><p class="muted">Du er medlem av flere firma.</p>
      <ul class="picker">${S.companies.map((c) => `<li><button type="button" data-action="pick-company" data-id="${esc(c.id)}"><strong>${esc(c.name)}</strong><span>${esc(ROLE[c.role] || c.role || "")}${c.trades && c.trades.length ? " · " + esc(c.trades.join(", ")) : ""}</span></button></li>`).join("")}</ul></div>`);
  }
  function renderFatal(err) {
    gate(`<div class="card gate-card"><h1>Kunne ikke laste kontorsiden</h1><p class="notice err">${esc(err.message || String(err))}</p>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-action="reload">Prøv igjen</button><button type="button" class="btn btn-secondary" data-action="start-demo">Prøv demo</button>${S.mode !== "demo" ? '<button type="button" class="btn btn-secondary" data-action="logout">Logg ut</button>' : ""}</div></div>`);
  }
  function openCompany(c) {
    S.company = c; S.mode = "firebase"; S.store = FirebaseStore(c);
    sset("jobos_companyId", c.id);
    loadAll();
  }
  function startDemo() {
    S.mode = "demo"; S.store = DemoStore();
    S.company = S.store.company(); S.user = S.store.user();
    if (F && F.enabled()) sset("jobos_demo", "1");
    loadAll();
  }
  function loadAll() {
    renderChrome();
    gate(`<p class="loading">Henter data for ${esc(S.company.name)} …</p>`);
    const errors = [];
    return Promise.all(COLS.map((c) => S.store.list(c).catch((e) => { errors.push(c + ": " + e.message); if (e.authExpired) throw e; return []; })))
      .then((res) => Promise.all([res, S.store.listInvitations()]))
      .then(([res, invites]) => {
        COLS.forEach((c, i) => { S.data[c] = res[i] || []; });
        S.data.invitations = (invites || []).filter((i) => i.status === "pending");
        S.me = memberOf(S.user.uid) || (S.mode === "demo" ? { role: "owner" } : null);
        if (S.mode === "firebase" && S.company.role && !S.me) S.me = { role: S.company.role };
        S.loaded = true; S.syncedQuotes = false;
        document.body.classList.remove("gated");
        $("#app-nav").hidden = false;
        renderChrome();
        if (errors.length === COLS.length) throw new Error(errors[0]);
        if (errors.length) toast("Noe data kunne ikke hentes: " + errors[0], "err");
        route(false);
      })
      .catch((err) => { S.loaded = false; if (err.authExpired) { F.session.clear(); return renderLogin(err.message); } renderFatal(err); });
  }
  function renderChrome() {
    const demo = S.mode === "demo";
    $("#demo-banner").hidden = !demo;
    document.body.classList.toggle("is-demo", demo);
    const c = S.company;
    $("#company-slot").innerHTML = c ? `<span class="company-name" title="${esc(c.name)}">${esc(c.name)}</span>${S.companies.length > 1 ? '<button type="button" class="linkish small" data-action="switch-company">Bytt</button>' : ""}` : "";
    const wrap = $("#user-menu-wrap");
    if (!S.user) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const name = nameFromEmail(S.user.email) || "Bruker";
    $("#user-name").textContent = name;
    $("#user-avatar").textContent = initials(name);
    $("#user-email").textContent = S.user.email + (demo ? " (demo)" : "");
    $("#menu-switch").hidden = S.companies.length < 2;
    $("#menu-reset").hidden = !demo;
    $("#menu-logout").textContent = demo ? "Avslutt demo" : "Logg ut";
  }

  /* ================= Ruter ================= */
  const TABS = {
    oversikt: ["Oversikt", renderOverview], ordre: ["Ordre", renderJobs], planlegging: ["Planlegging", renderPlanning],
    timer: ["Timer", renderTime], kjorebok: ["Kjørebok", renderTrips], utstyr: ["Utstyr", renderEquipment],
    katalog: ["Katalog", renderCatalog], innkjop: ["Innkjøp", renderPurchaseOrders],
    kunder: ["Kunder", renderCustomers], tilbud: ["Tilbud", renderQuotes], hms: ["HMS/KS", renderHms], skjema: ["Skjema", renderForms], ansatte: ["Ansatte", renderMembers]
  };
  function route(userNav) {
    if (!S.loaded) return;
    const parts = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
    const tab = TABS[parts[0]] ? parts[0] : "oversikt";
    S.tab = tab;
    if (userNav && $("#drawer").open) closeDrawer();
    $$("#app-nav a").forEach((a) => {
      if (a.dataset.tab !== tab) { a.removeAttribute("aria-current"); return; }
      a.setAttribute("aria-current", "page");
      const nav = $("#app-nav");
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2);
    });
    document.title = TABS[tab][0] + " | JobOS Kontor";
    renderView();
    if (userNav) { const h = $("#page-title"); if (h) h.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    const id = parts[1];
    if (id) {
      if (tab === "ordre" && jobOf(id)) openJob(id);
      else if (tab === "tilbud") openQuote(id);
      else if (tab === "kunder") openCustomer(id);
      else if (tab === "hms") openDeviation(id);
      else if (tab === "skjema") openFormSubmission(id);
      else if (tab === "innkjop") openPurchaseOrder(id);
    }
  }
  function renderView() { if (S.loaded) view().innerHTML = TABS[S.tab][1](); }

  /* ================= Oversikt ================= */
  function serviceSoon(e) { const d = daysUntil(e.nextServiceDate); return e.status !== "lost" && d !== null && d <= 30; }
  function renderOverview() {
    const D = S.data, now = new Date(), mk = monthKey(now);
    const openJobs = D.jobs.filter((j) => OPEN_JOB[j.status]);
    const submitted = D.timeEntries.filter((t) => t.status === "submitted");
    const monthTrips = D.trips.filter((t) => !t.isPrivate && t.startedAt && monthKey(parseDate(t.startedAt)) === mk);
    const openDev = D.deviations.filter((d) => d.status === "open" || d.status === "in_progress");
    const svc = D.equipment.filter(serviceSoon);
    const kpi = (href, label, value, sub, tone) => `<a class="kpi ${tone || ""}" href="${href}"><span class="kpi-label">${esc(label)}</span><strong>${value}</strong><span class="kpi-sub">${sub}</span></a>`;
    const next = D.appointments.filter((a) => a.status === "planned" && parseDate(a.endsAt) >= now).sort(byText((a) => a.startsAt)).slice(0, 6);
    const follow = [];
    if (submitted.length) follow.push(["warn", "Timer", `${submitted.length} timeføringer (${hours(sum(submitted, (t) => t.minutes))}) venter på godkjenning`, "#timer"]);
    const doneTrips = D.trips.filter((t) => t.status === "completed");
    if (doneTrips.length) follow.push(["warn", "Kjørebok", `${doneTrips.length} kjøreturer venter på godkjenning`, "#kjorebok"]);
    openDev.filter((d) => d.severity === "critical" || d.severity === "high").forEach((d) => follow.push(["err", "Avvik", `${d.title} (${DEV_SEVERITY[d.severity][0].toLowerCase()})`, "#hms/" + d.id]));
    D.jobs.filter((j) => j.status === "waiting").forEach((j) => follow.push(["warn", "Venter", `${j.title} – ${j.customerName}`, "#ordre/" + j.id]));
    D.jobs.filter((j) => (j.status === "planned" || j.status === "in_progress") && !j.assignedToUserId).forEach((j) => follow.push(["info", "Ikke tildelt", `${j.title} – ${j.customerName}`, "#ordre/" + j.id]));
    D.quotes.filter((q) => q.status === "sent" && q.validUntil && daysUntil(q.validUntil) <= 7).forEach((q) => { const d = daysUntil(q.validUntil); follow.push(["info", "Tilbud", `«${q.title}» ${d < 0 ? "har utløpt" : d === 0 ? "utløper i dag" : "utløper om " + d + " dager"}`, "#tilbud/" + q.id]); });
    svc.filter((e) => daysUntil(e.nextServiceDate) < 0).forEach((e) => follow.push(["err", "Utstyr", `Service forfalt: ${e.name}`, "#utstyr"]));
    D.purchaseOrders.filter((p) => p.status === "sent" || p.status === "ordered").forEach((p) => follow.push(["info", "Innkjøp", `${p.orderNumber || "Innkjøpsordre"} fra ${p.supplierName} venter på varemottak`, "#innkjop/" + p.id]));
    const draftForms = D.formSubmissions.filter((f) => f.status !== "completed");
    if (draftForms.length) follow.push(["warn", "Skjema", `${draftForms.length} skjema er ikke fullført`, "#skjema"]);
    const hello = (() => { const h = now.getHours(); return h < 10 ? "God morgen" : h < 17 ? "God dag" : "God kveld"; })();
    return pageHead(`${hello}, ${nameFromEmail(S.user.email).split(" ")[0] || ""}`.replace(/, $/, ""), esc(now.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })) + " · " + esc(S.company.name)) +
      `<div class="kpis">
        ${kpi("#ordre", "Åpne ordre", openJobs.length, `${openJobs.filter((j) => j.status === "in_progress").length} pågår · ${openJobs.filter((j) => j.status === "waiting").length} venter`)}
        ${kpi("#timer", "Timer til godkjenning", num(sum(submitted, (t) => t.minutes) / 60, 1), `${submitted.length} føringer`, submitted.length ? "warn" : "")}
        ${kpi("#kjorebok", "Km denne måneden", num(sum(monthTrips, (t) => t.distanceKm), 1), kr(Math.round(sum(monthTrips, (t) => t.distanceKm) * KM_RATE_CENTS)) + " i godtgjørelse")}
        ${kpi("#hms", "Åpne avvik", openDev.length, `${openDev.filter((d) => d.severity === "critical" || d.severity === "high").length} høy/kritisk`, openDev.some((d) => d.severity === "critical") ? "err" : "")}
        ${kpi("#utstyr", "Utstyr med service snart", svc.length, "innen 30 dager", svc.some((e) => daysUntil(e.nextServiceDate) < 0) ? "err" : "")}
      </div>
      <div class="two-col">
        <section class="panel" aria-labelledby="h-next"><div class="panel-head"><h2 id="h-next">Neste avtaler</h2><a href="#planlegging" class="small">Se ukeplan</a></div>
          ${next.length ? `<ul class="list">${next.map((a) => `<li><button type="button" class="list-item" data-action="open-job" data-id="${esc(a.jobId)}"><span class="when"><b>${esc(fmtDayShort(parseDate(a.startsAt)))}</b>${esc(fmtTime(a.startsAt))}–${esc(fmtTime(a.endsAt))}</span><span class="what"><b>${esc(a.jobTitle || (jobOf(a.jobId) || {}).title || "Avtale")}</b><span>${esc([a.customerName, person(a.assignedToUserId, a.assignedToEmail)].filter(Boolean).join(" · "))}</span></span></button></li>`).join("")}</ul>` : empty("Ingen planlagte avtaler.")}
        </section>
        <section class="panel" aria-labelledby="h-follow"><div class="panel-head"><h2 id="h-follow">Trenger oppfølging</h2></div>
          ${follow.length ? `<ul class="list">${follow.slice(0, 10).map((f) => `<li><a class="list-item" href="${esc(f[3])}"><span class="pill ${f[0]}">${esc(f[1])}</span><span class="what"><b>${esc(f[2])}</b></span></a></li>`).join("")}</ul>` : empty("Alt er under kontroll.")}
        </section>
      </div>`;
  }

  /* ================= Ordre ================= */
  function filteredJobs() {
    const q = norm(S.f.jobQ), st = S.f.jobStatus;
    return S.data.jobs.filter((j) => (st === "open" ? OPEN_JOB[j.status] : !st || j.status === st))
      .filter((j) => !q || [j.title, j.customerName, j.address, j.notes, person(j.assignedToUserId)].some((x) => norm(x).includes(q)))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }
  function renderJobs() {
    const list = filteredJobs();
    const rows = list.map((j) => `<tr data-open="open-job" data-id="${esc(j.id)}">
      ${td("Ordre", openLink("open-job", j.id, j.title), "strong")}${td("Kunde", esc(j.customerName))}${td("Adresse", esc(j.address))}
      ${td("Ansvarlig", esc(person(j.assignedToUserId)))}${td("Status", pill(JOB_STATUS, j.status))}${td("Oppdatert", esc(fmtDate(j.updatedAt)))}</tr>`);
    return pageHead("Ordre", `${S.data.jobs.filter((j) => OPEN_JOB[j.status]).length} åpne av ${S.data.jobs.length}`, btn("Ny ordre", "new-job", "", "btn-primary")) +
      `<div class="filters">${filterInput("jobQ", "Søk", "search", "Tittel, kunde, adresse …")}${filterSelect("jobStatus", "Status", [{ value: "open", label: "Åpne" }, { value: "", label: "Alle" }].concat(options(JOB_STATUS)))}</div>
      <p class="result-count" aria-live="polite">${list.length} ordre</p>
      ${table(["Ordre", "Kunde", "Adresse", "Ansvarlig", "Status", "Oppdatert"], rows, "Ordreliste") || empty("Ingen ordre passer filteret.")}`;
  }
  function jobForm(job, preset) {
    const j = job || Object.assign({ status: "planned" }, preset || {});
    const custNames = S.data.customers.map((c) => c.name).sort((a, b) => a.localeCompare(b, "nb"));
    openForm({
      title: job ? "Rediger ordre" : "Ny ordre",
      submitLabel: job ? "Lagre endringer" : "Opprett ordre",
      fields: [
        { name: "title", label: "Tittel", required: true, value: j.title, full: true, placeholder: "F.eks. Bytte sikringsskap" },
        { name: "customerName", label: "Kunde", required: true, value: j.customerName, datalist: custNames, autocomplete: "off", hint: "Velg en eksisterende kunde eller skriv et nytt navn." },
        { name: "address", label: "Adresse", required: true, value: j.address, autocomplete: "off" },
        { name: "status", label: "Status", type: "select", options: options(JOB_STATUS, j.status) },
        { name: "assignedToUserId", label: "Ansvarlig", type: "select", options: memberOptions(j.assignedToUserId) },
        { name: "notes", label: "Notater", type: "textarea", value: j.notes, full: true }
      ],
      onMount(body) {
        const cn = $("#f-customerName", body), ad = $("#f-address", body);
        cn.addEventListener("change", () => { const c = S.data.customers.find((x) => norm(x.name) === norm(cn.value)); if (c && c.address && !ad.value) ad.value = c.address; });
      },
      onSubmit(v) {
        const c = S.data.customers.find((x) => norm(x.name) === norm(v.customerName));
        const o = Object.assign({}, job || {}, {
          id: job ? job.id : newId("job"), title: v.title, customerName: c ? c.name : v.customerName, customerId: c ? c.id : (job && norm(job.customerName) === norm(v.customerName) ? job.customerId : undefined),
          address: v.address, notes: opt(v.notes), status: v.status, assignedToUserId: opt(v.assignedToUserId)
        });
        return persist("jobs", o).then((saved) => { toast(job ? "Ordren er lagret." : "Ordren er opprettet."); if (!job) setTimeout(() => openJob(saved.id), 0); });
      }
    });
  }
  function openJob(id) {
    openDrawer(() => {
      const j = jobOf(id); if (!j) return null;
      const D = S.data;
      const appts = D.appointments.filter((a) => a.jobId === id).sort(byText((a) => a.startsAt));
      const times = D.timeEntries.filter((t) => t.jobId === id).sort(byText((t) => t.workDate)).reverse();
      const trips = D.trips.filter((t) => t.jobId === id).sort(byText((t) => t.startedAt)).reverse();
      const devs = D.deviations.filter((d) => d.jobId === id);
      const cls = D.checklists.filter((c) => c.jobId === id);
      const quotes = D.quotes.filter((q) => q.jobId === id);
      const forms = D.formSubmissions.filter((f) => f.jobId === id);
      const sec =(title, count, body) => `<section class="dsec"><h3>${esc(title)} <span class="count">${count}</span></h3>${body}</section>`;
      return {
        title: j.title,
        html: `<dl class="meta">
            <div><dt>Status</dt><dd>${pill(JOB_STATUS, j.status)}</dd></div>
            <div><dt>Kunde</dt><dd>${j.customerId && D.customers.some((c) => c.id === j.customerId) ? openLink("open-customer", j.customerId, j.customerName) : esc(j.customerName)}</dd></div>
            <div><dt>Adresse</dt><dd><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(j.address || "")}" target="_blank" rel="noopener">${esc(j.address)}</a></dd></div>
            <div><dt>Ansvarlig</dt><dd>${esc(person(j.assignedToUserId))}</dd></div>
            <div><dt>Oppdatert</dt><dd>${esc(fmtDate(j.updatedAt))}${j.version ? ` · versjon ${esc(j.version)}` : ""}</dd></div>
          </dl>
          ${j.notes ? `<p class="notes">${esc(j.notes)}</p>` : ""}
          <div class="drawer-actions">
            ${selectHtml("job-status-" + j.id, "Endre status", options(JOB_STATUS, j.status), `data-change="job-status" data-id="${esc(j.id)}"`)}
            <div class="btn-row">${btn("Rediger", "edit-job", `data-id="${esc(j.id)}"`)}${btn("Ny avtale", "new-appt", `data-job="${esc(j.id)}"`)}${btn("Slett", "delete-job", `data-id="${esc(j.id)}"`, "btn-danger-ghost")}</div>
          </div>
          ${sec("Avtaler", appts.length, appts.length ? `<ul class="mini">${appts.map((a) => `<li><button type="button" class="linkbtn" data-action="edit-appt" data-id="${esc(a.id)}">${esc(fmtDateTime(a.startsAt))}–${esc(fmtTime(a.endsAt))}</button> <span>${esc(person(a.assignedToUserId, a.assignedToEmail))}</span> ${pill(APPT_STATUS, a.status)}</li>`).join("")}</ul>` : '<p class="muted small">Ingen avtaler.</p>')}
          ${sec("Timer", hours(sum(times, (t) => t.minutes)), times.length ? `<ul class="mini">${times.map((t) => `<li><span>${esc(fmtDate(t.workDate))}</span> <span>${esc(person(t.userId))}</span> <b>${esc(hours(t.minutes))}</b> ${pill(TIME_STATUS, t.status)}</li>`).join("")}</ul>` : '<p class="muted small">Ingen timeføringer.</p>')}
          ${sec("Kjøreturer", num(sum(trips, (t) => t.distanceKm), 1) + " km", trips.length ? `<ul class="mini">${trips.map((t) => `<li><span>${esc(fmtDate(t.startedAt))}</span> <span>${esc(person(t.userId, t.userEmail))}</span> <b>${esc(num(t.distanceKm, 1))} km</b> ${pill(TRIP_STATUS, t.status)}</li>`).join("")}</ul>` : '<p class="muted small">Ingen kjøreturer.</p>')}
          ${sec("Avvik", devs.length, devs.length ? `<ul class="mini">${devs.map((d) => `<li>${openLink("open-deviation", d.id, d.title)} ${pill(DEV_SEVERITY, d.severity)} ${pill(DEV_STATUS, d.status)}</li>`).join("")}</ul>` : '<p class="muted small">Ingen avvik.</p>')}
          ${sec("Sjekklister", cls.length, cls.length ? cls.map(checklistHtml).join("") : '<p class="muted small">Ingen sjekklister.</p>')}
          ${forms.length ? sec("Skjema", forms.length, `<ul class="mini">${forms.map((f) => `<li>${openLink("open-form", f.id, f.title)} <span>${formProgress(f)} %</span> ${pill(FORM_STATUS, f.status)}</li>`).join("")}</ul>`) : ""}
          ${quotes.length ? sec("Tilbud", quotes.length, `<ul class="mini">${quotes.map((q) => `<li>${openLink("open-quote", q.id, q.title)} <b>${esc(kr(quoteTotals(q).total))}</b> ${pill(QUOTE_STATUS, q.status)}</li>`).join("")}</ul>`) : ""}`
      };
    });
  }
  function checklistHtml(c) {
    const items = (c.items || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    const done = items.filter((i) => i.isCompleted).length;
    const pct = items.length ? Math.round(done / items.length * 100) : 0;
    return `<details class="checklist-box"><summary><span><b>${esc(c.title)}</b> <span class="muted small">${done}/${items.length}${c.signerName ? " · signert av " + esc(c.signerName) + (c.signedAt ? " " + esc(fmtDate(c.signedAt)) : "") : ""}</span></span><span class="bar" role="img" aria-label="${pct} % fullført"><i style="width:${pct}%"></i></span></summary>
      <ul>${items.map((i) => `<li class="${i.isCompleted ? "done" : ""}"><span aria-hidden="true">${i.isCompleted ? "✓" : "○"}</span> ${esc(i.label)}<span class="sr-only">${i.isCompleted ? " (utført)" : " (ikke utført)"}</span></li>`).join("")}</ul></details>`;
  }

  /* ================= Planlegging ================= */
  function apptConflict(a) {
    if (!a.assignedToUserId || a.status === "cancelled") return null;
    const s = parseDate(a.startsAt), e = parseDate(a.endsAt);
    return S.data.appointments.find((b) => b.id !== a.id && b.assignedToUserId === a.assignedToUserId && b.status !== "cancelled" && parseDate(b.startsAt) < e && s < parseDate(b.endsAt)) || null;
  }
  function renderPlanning() {
    const ws = S.week, days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i)), we = addDays(ws, 7);
    const todayK = dayKey(new Date());
    const inWeek = S.data.appointments.filter((a) => { const d = parseDate(a.startsAt); return d && d >= ws && d < we; }).sort(byText((a) => a.startsAt));
    const people = activeMembers().slice().sort((a, b) => (a.role === "field" ? 0 : 1) - (b.role === "field" ? 0 : 1) || nameFromEmail(a.email).localeCompare(nameFromEmail(b.email), "nb"));
    const rows = people.map((m) => ({ uid: m.uid || m.id, name: nameFromEmail(m.email), role: ROLE[m.role] || m.role }));
    if (inWeek.some((a) => !a.assignedToUserId || !memberOf(a.assignedToUserId))) rows.push({ uid: "", name: "Ikke tildelt", role: "" });
    const apptBtn = (a) => `<button type="button" class="appt ${a.status}" data-action="edit-appt" data-id="${esc(a.id)}"><b>${esc(fmtTime(a.startsAt))}–${esc(fmtTime(a.endsAt))}</b><span>${esc(a.jobTitle || (jobOf(a.jobId) || {}).title || "Avtale")}</span>${a.customerName ? `<small>${esc(a.customerName)}</small>` : ""}</button>`;
    const label = `Uke ${isoWeek(ws)} · ${ws.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}–${addDays(ws, 6).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" })}`;
    const grid = `<div class="table-wrap week-wrap"><table class="week"><caption class="sr-only">Ukeplan ${esc(label)}</caption><thead><tr><th scope="col">Ansatt</th>${days.map((d) => `<th scope="col" class="${dayKey(d) === todayK ? "today" : ""}">${esc(fmtDayShort(d))}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr><th scope="row"><b>${esc(r.name)}</b>${r.role ? `<small>${esc(r.role)}</small>` : ""}</th>${days.map((d) => {
        const k = dayKey(d);
        const list = inWeek.filter((a) => dayKey(parseDate(a.startsAt)) === k && (r.uid ? a.assignedToUserId === r.uid : (!a.assignedToUserId || !memberOf(a.assignedToUserId))));
        return `<td class="${k === todayK ? "today" : ""}">${list.map(apptBtn).join("")}<button type="button" class="add-slot" data-action="new-appt" data-user="${esc(r.uid)}" data-date="${k}" aria-label="Ny avtale for ${esc(r.name)}, ${esc(fmtDayShort(d))}">+</button></td>`;
      }).join("")}</tr>`).join("")}
      </tbody></table></div>`;
    const agenda = `<div class="agenda">${days.map((d) => {
      const k = dayKey(d); const list = inWeek.filter((a) => dayKey(parseDate(a.startsAt)) === k);
      return `<section class="agenda-day${k === todayK ? " today" : ""}"><h2>${esc(d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" }))}</h2>
        ${list.length ? list.map((a) => `<button type="button" class="appt ${a.status}" data-action="edit-appt" data-id="${esc(a.id)}"><b>${esc(fmtTime(a.startsAt))}–${esc(fmtTime(a.endsAt))} · ${esc(person(a.assignedToUserId, a.assignedToEmail))}</b><span>${esc(a.jobTitle || "Avtale")}</span>${a.customerName ? `<small>${esc(a.customerName)}</small>` : ""}</button>`).join("") : '<p class="muted small">Ingen avtaler.</p>'}
        <button type="button" class="btn btn-secondary btn-sm" data-action="new-appt" data-date="${k}">Ny avtale</button></section>`;
    }).join("")}</div>`;
    return pageHead("Planlegging", `${inWeek.length} avtaler denne uken`, btn("Ny avtale", "new-appt", "", "btn-primary")) +
      `<div class="week-nav" role="group" aria-label="Velg uke">${btn("‹ Forrige", "week-prev", 'aria-label="Forrige uke"')}${btn("I dag", "week-today")}${btn("Neste ›", "week-next", 'aria-label="Neste uke"')}<h2 class="week-label" aria-live="polite">${esc(label)}</h2></div>` + grid + agenda;
  }
  function apptForm(appt, preset) {
    preset = preset || {};
    const a = appt || {};
    const start = appt ? parseDate(a.startsAt) : null, end = appt ? parseDate(a.endsAt) : null;
    const jobs = S.data.jobs.filter((j) => OPEN_JOB[j.status] || j.id === a.jobId || j.id === preset.jobId).sort(byText((j) => j.title));
    if (!jobs.length) { toast("Opprett en åpen ordre først.", "err"); return; }
    openForm({
      title: appt ? "Rediger avtale" : "Ny avtale",
      submitLabel: appt ? "Lagre avtale" : "Opprett avtale",
      fields: [
        { name: "jobId", label: "Ordre", type: "select", required: true, full: true, options: [{ value: "", label: "Velg ordre …" }].concat(jobs.map((j) => ({ value: j.id, label: j.title + " – " + j.customerName, selected: j.id === (a.jobId || preset.jobId) }))) },
        { name: "date", label: "Dato", type: "date", required: true, value: start ? dayKey(start) : (preset.date || dayKey(new Date())) },
        { name: "assignedToUserId", label: "Ansatt", type: "select", options: memberOptions(appt ? a.assignedToUserId : (preset.userId || (jobOf(preset.jobId) || {}).assignedToUserId)) },
        { name: "start", label: "Fra", type: "time", required: true, value: start ? fmtTime(a.startsAt) : "08:00", step: 300 },
        { name: "end", label: "Til", type: "time", required: true, value: end ? fmtTime(a.endsAt) : "15:30", step: 300 },
        appt ? { name: "status", label: "Status", type: "select", options: options(APPT_STATUS, a.status) } : null,
        { name: "note", label: "Notat", type: "textarea", value: a.note, full: true }
      ].filter(Boolean),
      danger: appt ? { label: "Slett avtale", run: () => { if (!confirm("Slette denne avtalen?")) return; removeDoc("appointments", appt.id).then(() => { $("#modal").close(); toast("Avtalen er slettet."); }, fail); } } : null,
      onSubmit(v) {
        const job = jobOf(v.jobId); if (!job) throw fieldErr("Velg en ordre.", "jobId");
        const [y, mo, d] = v.date.split("-").map(Number);
        const mk = (t) => { const [h, mi] = t.split(":").map(Number); return new Date(y, mo - 1, d, h, mi, 0, 0); };
        const s = mk(v.start), e = mk(v.end);
        if (isNaN(s) || isNaN(e)) throw fieldErr("Ugyldig dato eller klokkeslett.", "date");
        if (e <= s) throw fieldErr("Sluttid må være etter starttid.", "end");
        const m = memberOf(v.assignedToUserId);
        const o = Object.assign({}, appt || {}, {
          id: appt ? appt.id : newId("appointment"), jobId: job.id, jobTitle: job.title, customerName: job.customerName, address: job.address,
          assignedToUserId: opt(v.assignedToUserId), assignedToEmail: m ? m.email : undefined, startsAt: toIso(s), endsAt: toIso(e),
          status: v.status || (appt ? a.status : "planned"), note: opt(v.note)
        });
        const c = apptConflict(o);
        if (c) throw fieldErr(`Dobbeltbooking: ${person(o.assignedToUserId)} er allerede satt opp ${fmtDayShort(parseDate(c.startsAt))} kl. ${fmtTime(c.startsAt)}–${fmtTime(c.endsAt)} (${c.jobTitle || "annen avtale"}). Velg et annet tidspunkt eller en annen ansatt.`, "start");
        return persist("appointments", o).then(() => { toast(appt ? "Avtalen er lagret." : "Avtalen er opprettet."); S.week = startOfWeek(s); rerender(); });
      }
    });
  }

  /* ================= Timer ================= */
  function monthOptions(dates) {
    const set = {}; dates.filter(Boolean).forEach((d) => { set[monthKey(d)] = 1; });
    set[monthKey(new Date())] = 1;
    return Object.keys(set).sort().reverse().map((k) => { const [y, m] = k.split("-"); return { value: k, label: new Date(+y, +m - 1, 1).toLocaleDateString("nb-NO", { month: "long", year: "numeric" }) }; });
  }
  function timeBase() {
    return S.data.timeEntries.filter((t) => (!S.f.timeMonth || String(t.workDate).slice(0, 7) === S.f.timeMonth) && (!S.f.timeUser || t.userId === S.f.timeUser));
  }
  function renderTime() {
    const base = timeBase();
    const list = base.filter((t) => !S.f.timeStatus || t.status === S.f.timeStatus).sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)));
    const sub = list.filter((t) => t.status === "submitted");
    const approved = base.filter((t) => t.status === "approved");
    const rows = list.map((t) => `<tr>${td("Dato", esc(fmtDate(t.workDate)))}${td("Ansatt", esc(person(t.userId)))}${td("Ordre", t.jobId && jobOf(t.jobId) ? openLink("open-job", t.jobId, t.jobTitle || jobOf(t.jobId).title) : esc(t.jobTitle || "–"))}${td("Timer", esc(hours(t.minutes)), "num")}${td("Status", pill(TIME_STATUS, t.status))}
      ${td("Handling", t.status === "submitted" ? `<div class="btn-row tight">${btn("Godkjenn", "approve-time", `data-id="${esc(t.id)}"`, "btn-primary")}${btn("Send tilbake", "reject-time", `data-id="${esc(t.id)}"`)}</div>` : t.status === "approved" ? btn("Angre", "unapprove-time", `data-id="${esc(t.id)}"`) : '<span class="muted small">Kladd hos montør</span>', "actions")}</tr>`);
    const userOpts = [{ value: "", label: "Alle ansatte" }].concat(activeMembers().map((m) => ({ value: m.uid || m.id, label: nameFromEmail(m.email) })));
    return pageHead("Timer", "Godkjenn timeføringer og eksporter lønnsgrunnlag.", (sub.length ? btn(`Godkjenn alle innsendte (${sub.length})`, "approve-all-time", "", "btn-primary") : "") + btn(`Eksporter godkjente (CSV)`, "export-time", approved.length ? "" : "disabled")) +
      `<div class="filters">${filterSelect("timeStatus", "Status", [{ value: "", label: "Alle" }].concat(options(TIME_STATUS)))}${filterSelect("timeMonth", "Måned", [{ value: "", label: "Alle måneder" }].concat(monthOptions(S.data.timeEntries.map((t) => parseDate(t.workDate)))))}${filterSelect("timeUser", "Ansatt", userOpts)}</div>
      <div class="totals"><div><span>Viser</span><b>${hours(sum(list, (t) => t.minutes))}</b></div><div><span>Innsendt</span><b>${hours(sum(base.filter((t) => t.status === "submitted"), (t) => t.minutes))}</b></div><div><span>Godkjent</span><b>${hours(sum(approved, (t) => t.minutes))}</b></div></div>
      ${table(["Dato", "Ansatt", "Ordre", { label: "Timer", cls: "num" }, "Status", "Handling"], rows, "Timeføringer") || empty("Ingen timeføringer passer filteret.")}`;
  }

  /* ================= CSV ================= */
  function csv(filename, header, rows) {
    const cell = (v) => { const s = v == null ? "" : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = "﻿" + [header].concat(rows).map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Eksporterte " + rows.length + " rader til " + filename + ".");
  }
  const csvNum = (n, d) => (Number(n) || 0).toFixed(d).replace(".", ",");

  /* ================= Kjørebok ================= */
  function tripList() {
    return S.data.trips.filter((t) => (!S.f.tripMonth || (t.startedAt && monthKey(parseDate(t.startedAt)) === S.f.tripMonth)) && (!S.f.tripUser || t.userId === S.f.tripUser) && (!S.f.tripStatus || t.status === S.f.tripStatus))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }
  function renderTrips() {
    const list = tripList();
    const work = list.filter((t) => !t.isPrivate);
    const km = sum(work, (t) => t.distanceKm);
    const toll = sum(work, (t) => t.tollCents), ferry = sum(work, (t) => t.ferryCents), park = sum(work, (t) => t.parkingCents);
    const done = list.filter((t) => t.status === "completed");
    const rows = list.map((t) => `<tr>${td("Dato", esc(fmtDate(t.startedAt)) + `<small class="block muted">${esc(fmtTime(t.startedAt))}${t.endedAt ? "–" + esc(fmtTime(t.endedAt)) : ""}</small>`)}${td("Ansatt", esc(person(t.userId, t.userEmail)) + (t.vehicle ? `<small class="block muted">${esc(t.vehicle)}</small>` : ""))}
      ${td("Strekning", `${esc(t.fromAddress)} → ${esc(t.toAddress)}`)}${td("Formål", esc(t.purpose) + (t.jobId && jobOf(t.jobId) ? `<small class="block">${openLink("open-job", t.jobId, t.jobTitle || jobOf(t.jobId).title)}</small>` : "") + (t.isPrivate ? ' <span class="pill muted">Privat</span>' : ""))}
      ${td("Km", esc(num(t.distanceKm, 1)), "num")}${td("Utlegg", esc(kr((t.tollCents || 0) + (t.ferryCents || 0) + (t.parkingCents || 0))), "num")}${td("Status", pill(TRIP_STATUS, t.status))}
      ${td("Handling", t.status === "completed" ? btn("Godkjenn", "approve-trip", `data-id="${esc(t.id)}"`, "btn-primary") : t.status === "approved" ? btn("Angre", "unapprove-trip", `data-id="${esc(t.id)}"`) : '<span class="muted small">Pågår</span>', "actions")}</tr>`);
    const userOpts = [{ value: "", label: "Alle ansatte" }].concat(activeMembers().map((m) => ({ value: m.uid || m.id, label: nameFromEmail(m.email) })));
    return pageHead("Kjørebok", "Godkjenn kjøreturer og eksporter grunnlag for kilometergodtgjørelse (3,50 kr/km).", (done.length ? btn(`Godkjenn alle fullførte (${done.length})`, "approve-all-trips", "", "btn-primary") : "") + btn("Eksporter CSV", "export-trips", list.length ? "" : "disabled")) +
      `<div class="filters">${filterSelect("tripMonth", "Måned", [{ value: "", label: "Alle måneder" }].concat(monthOptions(S.data.trips.map((t) => parseDate(t.startedAt)))))}${filterSelect("tripUser", "Ansatt", userOpts)}${filterSelect("tripStatus", "Status", [{ value: "", label: "Alle" }].concat(options(TRIP_STATUS)))}</div>
      <div class="totals"><div><span>Km i jobb</span><b>${num(km, 1)}</b></div><div><span>Godtgjørelse</span><b>${kr(Math.round(km * KM_RATE_CENTS))}</b></div><div><span>Bom</span><b>${kr(toll)}</b></div><div><span>Ferje</span><b>${kr(ferry)}</b></div><div><span>Parkering</span><b>${kr(park)}</b></div></div>
      ${list.some((t) => t.isPrivate) ? '<p class="small muted">Private turer vises, men er holdt utenfor summene.</p>' : ""}
      ${table(["Dato", "Ansatt", "Strekning", "Formål", { label: "Km", cls: "num" }, { label: "Utlegg", cls: "num" }, "Status", "Handling"], rows, "Kjøreturer") || empty("Ingen kjøreturer i valgt periode.")}`;
  }

  /* ================= Utstyr ================= */
  function serviceBadge(e) {
    if (!e.nextServiceDate) return '<span class="muted">–</span>';
    const d = daysUntil(e.nextServiceDate);
    const label = fmtDate(e.nextServiceDate);
    if (d < 0) return `${esc(label)} <span class="pill err">Forfalt</span>`;
    if (d <= 30) return `${esc(label)} <span class="pill warn">Om ${d} ${d === 1 ? "dag" : "dager"}</span>`;
    return esc(label);
  }
  function renderEquipment() {
    const q = norm(S.f.eqQ);
    const list = S.data.equipment.filter((e) => (!S.f.eqStatus || (S.f.eqStatus === "service_soon" ? serviceSoon(e) : e.status === S.f.eqStatus)) && (!q || [e.name, e.category, e.serialNumber, e.location, e.jobTitle, person(e.assignedToUserId, e.assignedToEmail)].some((x) => norm(x).includes(q)))).sort(byText((e) => e.name));
    const rows = list.map((e) => `<tr data-open="edit-equipment" data-id="${esc(e.id)}">${td("Navn", openLink("edit-equipment", e.id, e.name) + (e.serialNumber ? `<small class="block muted">SN ${esc(e.serialNumber)}</small>` : ""), "strong")}${td("Kategori", esc(e.category || "–"))}${td("Status", pill(EQ_STATUS, e.status))}
      ${td("Hos", e.assignedToUserId || e.assignedToEmail ? esc(person(e.assignedToUserId, e.assignedToEmail)) : '<span class="muted">–</span>')}${td("Ordre / sted", (e.jobTitle ? esc(e.jobTitle) : "") + (e.location ? `<small class="block muted">${esc(e.location)}</small>` : "") || "–")}${td("Neste service", serviceBadge(e))}</tr>`);
    return pageHead("Utstyr", `${S.data.equipment.length} enheter · ${S.data.equipment.filter(serviceSoon).length} med service innen 30 dager`, btn("Nytt utstyr", "new-equipment", "", "btn-primary")) +
      `<div class="filters">${filterInput("eqQ", "Søk", "search", "Navn, serienummer, sted …")}${filterSelect("eqStatus", "Status", [{ value: "", label: "Alle" }].concat(options(EQ_STATUS), [{ value: "service_soon", label: "Service snart" }]))}</div>
      ${table(["Navn", "Kategori", "Status", "Hos", "Ordre / sted", "Neste service"], rows, "Utstyr") || empty("Ingen utstyr passer filteret.")}`;
  }
  function equipmentForm(eq) {
    const e = eq || { status: "available" };
    const cats = Array.from(new Set(S.data.equipment.map((x) => x.category).filter(Boolean).concat(["Måleinstrument", "Maskin", "Verktøy", "Stige", "Kjøretøy"]))).sort();
    openForm({
      title: eq ? "Rediger utstyr" : "Nytt utstyr",
      fields: [
        { name: "name", label: "Navn", required: true, value: e.name, full: true },
        { name: "category", label: "Kategori", value: e.category, datalist: cats, autocomplete: "off" },
        { name: "serialNumber", label: "Serienummer", value: e.serialNumber, autocomplete: "off" },
        { name: "status", label: "Status", type: "select", options: options(EQ_STATUS, e.status) },
        { name: "assignedToUserId", label: "Hvem har det", type: "select", options: memberOptions(e.assignedToUserId, "Ingen") },
        { name: "jobId", label: "Ordre", type: "select", options: [{ value: "", label: "Ingen ordre" }].concat(S.data.jobs.filter((j) => OPEN_JOB[j.status] || j.id === e.jobId).map((j) => ({ value: j.id, label: j.title, selected: j.id === e.jobId }))) },
        { name: "location", label: "Sted", value: e.location, autocomplete: "off", placeholder: "Lager, bil, adresse …" },
        { name: "nextServiceDate", label: "Neste service/kalibrering", type: "date", value: e.nextServiceDate ? String(e.nextServiceDate).slice(0, 10) : "" },
        { name: "notes", label: "Notater", type: "textarea", value: e.notes, full: true }
      ],
      danger: eq ? { label: "Slett", run: () => { if (!confirm("Slette «" + eq.name + "»?")) return; removeDoc("equipment", eq.id).then(() => { $("#modal").close(); toast("Utstyret er slettet."); }, fail); } } : null,
      onSubmit(v) {
        const m = memberOf(v.assignedToUserId), j = jobOf(v.jobId);
        const o = Object.assign({}, eq || {}, {
          id: eq ? eq.id : newId("equipment"), name: v.name, category: opt(v.category), serialNumber: opt(v.serialNumber), status: v.status,
          assignedToUserId: opt(v.assignedToUserId), assignedToEmail: m ? m.email : undefined, jobId: j ? j.id : undefined, jobTitle: j ? j.title : undefined,
          location: opt(v.location), nextServiceDate: opt(v.nextServiceDate), notes: opt(v.notes)
        });
        if (v.status === "in_use" && !o.assignedToUserId && !o.jobId) throw fieldErr("Velg hvem som har utstyret, eller en ordre, når status er «I bruk».", "assignedToUserId");
        return persist("equipment", o).then(() => toast(eq ? "Utstyret er lagret." : "Utstyret er lagt til."));
      }
    });
  }

  /* ================= Kunder ================= */
  function renderCustomers() {
    const q = norm(S.f.custQ);
    const list = S.data.customers.filter((c) => !q || [c.name, c.email, c.phone, c.address].some((x) => norm(x).includes(q))).sort(byText((c) => c.name));
    const jobsFor = (c) => S.data.jobs.filter((j) => j.customerId === c.id || (!j.customerId && norm(j.customerName) === norm(c.name)));
    const rows = list.map((c) => { const js = jobsFor(c); return `<tr data-open="open-customer" data-id="${esc(c.id)}">${td("Navn", openLink("open-customer", c.id, c.name), "strong")}${td("Telefon", c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ""))}">${esc(c.phone)}</a>` : "–")}${td("E-post", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "–")}${td("Adresse", esc(c.address || "–"))}${td("Ordre", `${js.filter((j) => OPEN_JOB[j.status]).length} åpne / ${js.length}`, "num")}</tr>`; });
    return pageHead("Kunder", `${S.data.customers.length} kunder`, btn("Ny kunde", "new-customer", "", "btn-primary")) +
      `<div class="filters">${filterInput("custQ", "Søk", "search", "Navn, telefon, e-post …")}</div>
      ${table(["Navn", "Telefon", "E-post", "Adresse", { label: "Ordre", cls: "num" }], rows, "Kunder") || empty("Ingen kunder passer søket.")}`;
  }
  function customerForm(cust) {
    const c = cust || {};
    openForm({
      title: cust ? "Rediger kunde" : "Ny kunde",
      fields: [
        { name: "name", label: "Navn", required: true, value: c.name, full: true, autocomplete: "off" },
        { name: "phone", label: "Telefon", type: "tel", value: c.phone, autocomplete: "off" },
        { name: "email", label: "E-post", type: "email", value: c.email, autocomplete: "off" },
        { name: "address", label: "Adresse", value: c.address, full: true, autocomplete: "off" },
        { name: "notes", label: "Notater", type: "textarea", value: c.notes, full: true }
      ],
      danger: cust ? { label: "Slett kunde", run: () => { if (!confirm("Slette kunden «" + cust.name + "»? Ordre og tilbud beholdes.")) return; removeDoc("customers", cust.id).then(() => { $("#modal").close(); closeDrawer(); toast("Kunden er slettet."); }, fail); } } : null,
      onSubmit(v) {
        if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) throw fieldErr("Ugyldig e-postadresse.", "email");
        const o = Object.assign({}, cust || {}, { id: cust ? cust.id : newId("customer"), name: v.name, phone: opt(v.phone), email: opt(v.email), address: opt(v.address), notes: opt(v.notes) });
        return persist("customers", o).then(() => toast(cust ? "Kunden er lagret." : "Kunden er lagt til."));
      }
    });
  }
  function openCustomer(id) {
    openDrawer(() => {
      const c = S.data.customers.find((x) => x.id === id); if (!c) return null;
      const js = S.data.jobs.filter((j) => j.customerId === c.id || (!j.customerId && norm(j.customerName) === norm(c.name)));
      const qs = S.data.quotes.filter((q) => q.customerId === c.id || (!q.customerId && norm(q.customerName) === norm(c.name)));
      return {
        title: c.name,
        html: `<dl class="meta">
          <div><dt>Telefon</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ""))}">${esc(c.phone)}</a>` : "–"}</dd></div>
          <div><dt>E-post</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "–"}</dd></div>
          <div><dt>Adresse</dt><dd>${esc(c.address || "–")}</dd></div></dl>
          ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}
          <div class="btn-row">${btn("Rediger", "edit-customer", `data-id="${esc(c.id)}"`)}${btn("Ny ordre", "new-job", `data-customer="${esc(c.id)}"`)}${btn("Nytt tilbud", "new-quote", `data-customer="${esc(c.id)}"`)}</div>
          <section class="dsec"><h3>Ordre <span class="count">${js.length}</span></h3>${js.length ? `<ul class="mini">${js.map((j) => `<li>${openLink("open-job", j.id, j.title)} ${pill(JOB_STATUS, j.status)}</li>`).join("")}</ul>` : '<p class="muted small">Ingen ordre.</p>'}</section>
          <section class="dsec"><h3>Tilbud <span class="count">${qs.length}</span></h3>${qs.length ? `<ul class="mini">${qs.map((q) => `<li>${openLink("open-quote", q.id, q.title)} <b>${esc(kr(quoteTotals(q).total))}</b> ${pill(QUOTE_STATUS, q.status)}</li>`).join("")}</ul>` : '<p class="muted small">Ingen tilbud.</p>'}</section>`
      };
    });
  }

  /* ================= Tilbud ================= */
  const shareUrl = (token) => new URL("tilbud.html?t=" + encodeURIComponent(token) + (S.mode === "demo" ? "&demo=1" : ""), location.href).href;
  function renderQuotes() {
    if (!S.syncedQuotes) { S.syncedQuotes = true; syncQuotes(false); }
    const list = S.data.quotes.filter((q) => !S.f.quoteStatus || q.status === S.f.quoteStatus).sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    const rows = list.map((q) => `<tr data-open="open-quote" data-id="${esc(q.id)}">${td("Tilbud", openLink("open-quote", q.id, q.title), "strong")}${td("Kunde", esc(q.customerName || "–"))}${td("Status", pill(QUOTE_STATUS, q.status) + (q.respondedName ? `<small class="block muted">${esc(q.respondedName)}</small>` : ""))}
      ${td("Sum inkl. mva", esc(kr(quoteTotals(q).total)), "num")}${td("Gyldig til", q.validUntil ? esc(fmtDate(q.validUntil)) + (q.status === "sent" && daysUntil(q.validUntil) < 0 ? ' <span class="pill err">Utløpt</span>' : "") : "–")}${td("Kundeportal", q.publicToken ? '<span class="pill info">Delt</span>' : '<span class="muted">–</span>')}</tr>`);
    const sent = S.data.quotes.filter((q) => q.status === "sent");
    return pageHead("Tilbud", `${sent.length} sendt · ${kr(sum(sent, (q) => quoteTotals(q).total))} til behandling hos kunder`, btn("Hent kundesvar", "sync-quotes") + btn("Nytt tilbud", "new-quote", "", "btn-primary")) +
      `<div class="filters">${filterSelect("quoteStatus", "Status", [{ value: "", label: "Alle" }].concat(options(QUOTE_STATUS)))}</div>
      ${table(["Tilbud", "Kunde", "Status", { label: "Sum inkl. mva", cls: "num" }, "Gyldig til", "Kundeportal"], rows, "Tilbud") || empty("Ingen tilbud passer filteret.")}`;
  }
  function syncQuotes(manual) {
    const targets = S.data.quotes.filter((q) => q.status === "sent" && q.publicToken && q.publicToken !== "demo");
    if (!targets.length) { if (manual) toast("Ingen delte tilbud venter på svar."); return Promise.resolve(); }
    let changed = 0;
    return Promise.all(targets.map((q) => S.store.getPublicQuote(q.publicToken).then((pq) => {
      if (pq && (pq.status === "accepted" || pq.status === "declined")) {
        changed++;
        return persist("quotes", Object.assign({}, q, { status: pq.status, respondedName: pq.respondedName || undefined }));
      }
    }).catch(() => null))).then(() => {
      if (changed) toast(changed === 1 ? "Ett tilbud har fått svar fra kunden." : changed + " tilbud har fått svar fra kunden.");
      else if (manual) toast("Ingen nye svar fra kunder.");
    });
  }
  function openQuote(id) {
    openDrawer(() => {
      const q = S.data.quotes.find((x) => x.id === id); if (!q) return null;
      const t = quoteTotals(q);
      const lines = (q.lines || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
      const canShare = q.status === "draft" || q.status === "sent";
      const share = q.publicToken
        ? `<div class="share-box"><label for="share-link">Lenke til kunden</label><div class="copy-row"><input id="share-link" type="text" readonly value="${esc(shareUrl(q.publicToken))}"><button type="button" class="btn btn-primary btn-sm" data-action="copy-link" data-target="share-link">Kopier lenke</button></div>
            <p class="small muted">Kunden åpner lenken, ser tilbudet og kan godta eller avslå uten å logge inn.${q.respondedName ? ` Svar fra: <b>${esc(q.respondedName)}</b>.` : ""}</p>
            <div class="btn-row"><a class="btn btn-secondary btn-sm" href="${esc(shareUrl(q.publicToken))}" target="_blank" rel="noopener">Åpne kundeportalen</a>${q.status === "sent" ? btn("Oppdater kundens kopi", "share-quote", `data-id="${esc(q.id)}"`) + btn("Hent svar", "sync-quotes") : ""}</div></div>`
        : canShare ? `<div class="share-box"><p class="small"><b>Del med kunde:</b> lager en privat lenke der kunden kan se tilbudet og godta det med navn – uten innlogging. Tilbudet får status «Sendt».</p>${btn("Del med kunde", "share-quote", `data-id="${esc(q.id)}"`, "btn-primary")}</div>` : "";
      return {
        title: q.title,
        html: `<dl class="meta">
          <div><dt>Status</dt><dd>${pill(QUOTE_STATUS, q.status)}</dd></div>
          <div><dt>Kunde</dt><dd>${esc(q.customerName || "–")}</dd></div>
          ${q.jobId && jobOf(q.jobId) ? `<div><dt>Ordre</dt><dd>${openLink("open-job", q.jobId, q.jobTitle || jobOf(q.jobId).title)}</dd></div>` : ""}
          <div><dt>Gyldig til</dt><dd>${esc(q.validUntil ? fmtDate(q.validUntil) : "–")}</dd></div>
          <div><dt>Opprettet</dt><dd>${esc(fmtDate(q.createdAt))}</dd></div></dl>
          <div class="table-wrap"><table class="data lines"><caption class="sr-only">Tilbudslinjer</caption><thead><tr><th scope="col">Beskrivelse</th><th scope="col" class="num">Antall</th><th scope="col" class="num">Enhetspris</th><th scope="col" class="num">Mva</th><th scope="col" class="num">Sum eks. mva</th></tr></thead>
          <tbody>${lines.map((l) => `<tr>${td("Beskrivelse", esc(l.description))}${td("Antall", esc(num(l.quantity, Number.isInteger(Number(l.quantity)) ? 0 : 2)), "num")}${td("Enhetspris", esc(kr(l.unitPriceCents)), "num")}${td("Mva", esc(num(vatPct(l.vatRate))) + " %", "num")}${td("Sum eks. mva", esc(kr(Math.round(lineNet(l)))), "num")}</tr>`).join("") || `<tr><td colspan="5" class="muted">Ingen linjer.</td></tr>`}</tbody></table></div>
          <dl class="sums"><div><dt>Sum eks. mva</dt><dd>${esc(kr(t.net))}</dd></div><div><dt>Mva</dt><dd>${esc(kr(t.vat))}</dd></div><div class="grand"><dt>Totalt inkl. mva</dt><dd>${esc(kr(t.total))}</dd></div></dl>
          ${q.notes ? `<p class="notes">${esc(q.notes)}</p>` : ""}
          ${share}
          <div class="drawer-actions">${selectHtml("quote-status-" + q.id, "Endre status", options(QUOTE_STATUS, q.status), `data-change="quote-status" data-id="${esc(q.id)}"`)}
            <div class="btn-row">${btn("Rediger", "edit-quote", `data-id="${esc(q.id)}"`)}${btn("Slett", "delete-quote", `data-id="${esc(q.id)}"`, "btn-danger-ghost")}</div></div>`
      };
    });
  }
  function shareQuote(id) {
    const q = S.data.quotes.find((x) => x.id === id); if (!q) return;
    if (!(q.lines || []).length) { toast("Legg til minst én linje før du deler tilbudet.", "err"); return; }
    const token = q.publicToken || (F ? F.randomToken(32) : uuid().replace(/-/g, ""));
    const t = quoteTotals(q);
    const doc = {
      companyName: S.company.name, companyId: S.company.id, quoteId: q.id, title: q.title, customerName: q.customerName || "",
      lines: (q.lines || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)).map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, unitPriceCents: Math.round(Number(l.unitPriceCents) || 0), vatRate: vatPct(l.vatRate) })),
      totalCents: t.total, validUntil: q.validUntil || dayKey(addDays(new Date(), 30)), status: "sent", createdAt: isoNow()
    };
    if (q.notes) doc.notes = q.notes;
    S.store.savePublicQuote(token, doc)
      .then(() => persist("quotes", Object.assign({}, q, { publicToken: token, status: "sent", totalCents: t.total })))
      .then(() => { toast(q.publicToken ? "Kundens kopi er oppdatert." : "Tilbudet er delt. Kopier lenken og send den til kunden."); const l = $("#share-link"); if (l) { l.focus(); l.select(); } })
      .catch(fail);
  }
  let lineSeq = 0;
  function lineRowHtml(l) {
    const i = ++lineSeq;
    const v = vatPct(l.vatRate == null ? 25 : l.vatRate);
    return `<tr class="line-row">
      <td data-label="Beskrivelse"><label class="sr-only" for="ln-d-${i}">Beskrivelse</label><input id="ln-d-${i}" class="ln-d" value="${esc(l.description || "")}" autocomplete="off"></td>
      <td data-label="Antall"><label class="sr-only" for="ln-q-${i}">Antall</label><input id="ln-q-${i}" class="ln-q" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(l.quantity == null ? 1 : l.quantity)}"></td>
      <td data-label="Enhetspris (kr)"><label class="sr-only" for="ln-p-${i}">Enhetspris i kroner</label><input id="ln-p-${i}" class="ln-p" type="number" step="0.01" min="0" inputmode="decimal" value="${l.unitPriceCents == null ? "" : esc((l.unitPriceCents / 100).toFixed(2))}"></td>
      <td data-label="Mva"><label class="sr-only" for="ln-v-${i}">Mva-sats</label><select id="ln-v-${i}" class="ln-v">${[25, 15, 12, 0].map((r) => `<option value="${r}"${r === v ? " selected" : ""}>${r} %</option>`).join("")}</select></td>
      <td class="line-del"><button type="button" class="icon-btn" data-line-del aria-label="Fjern linjen">×</button><input type="hidden" class="ln-id" value="${esc(l.id || "")}"></td></tr>`;
  }
  function readLines(body) {
    return $$(".line-row", body).map((r, i) => ({
      id: $(".ln-id", r).value || newId("line"), description: $(".ln-d", r).value.trim(), quantity: parseFloat($(".ln-q", r).value) || 0,
      unitPriceCents: Math.round((parseFloat(String($(".ln-p", r).value).replace(",", ".")) || 0) * 100), vatRate: parseFloat($(".ln-v", r).value) || 0, position: i
    }));
  }
  function quoteForm(quote, preset) {
    preset = preset || {};
    const pc = preset.customerId ? S.data.customers.find((c) => c.id === preset.customerId) : null;
    const q = quote || { status: "draft", customerName: pc ? pc.name : "", validUntil: dayKey(addDays(new Date(), 30)), lines: [{ description: "", quantity: 1, vatRate: 25 }] };
    const custNames = S.data.customers.map((c) => c.name).sort((a, b) => a.localeCompare(b, "nb"));
    openForm({
      title: quote ? "Rediger tilbud" : "Nytt tilbud",
      submitLabel: quote ? "Lagre tilbud" : "Opprett tilbud",
      fields: [
        { name: "title", label: "Tittel", required: true, value: q.title, full: true },
        { name: "customerName", label: "Kunde", required: true, value: q.customerName, datalist: custNames, autocomplete: "off" },
        { name: "jobId", label: "Ordre (valgfritt)", type: "select", options: [{ value: "", label: "Ingen ordre" }].concat(S.data.jobs.filter((j) => j.status !== "cancelled").map((j) => ({ value: j.id, label: j.title + " – " + j.customerName, selected: j.id === q.jobId }))) },
        { name: "validUntil", label: "Gyldig til", type: "date", value: q.validUntil ? String(q.validUntil).slice(0, 10) : "" },
        { name: "status", label: "Status", type: "select", options: options(QUOTE_STATUS, q.status) },
        { type: "custom", html: `<fieldset class="field full lines-editor"><legend>Linjer</legend><div class="table-wrap"><table class="data lines-edit"><thead><tr><th scope="col">Beskrivelse</th><th scope="col">Antall</th><th scope="col">Enhetspris (kr)</th><th scope="col">Mva</th><th scope="col"><span class="sr-only">Fjern</span></th></tr></thead><tbody id="lines-body">${(q.lines || []).map((l) => lineRowHtml(l)).join("")}</tbody></table></div>
          <div class="lines-foot"><button type="button" class="btn btn-secondary btn-sm" data-line-add>Legg til linje</button><p class="lines-total" id="lines-total" aria-live="polite"></p></div></fieldset>` },
        { name: "notes", label: "Merknader til kunden", type: "textarea", value: q.notes, full: true }
      ],
      danger: quote ? { label: "Slett tilbud", run: () => deleteQuote(quote.id) } : null,
      onMount(body) {
        const tb = $("#lines-body", body);
        const upd = () => { const t = quoteTotals({ lines: readLines(body) }); $("#lines-total", body).textContent = `Sum eks. mva ${kr(t.net)} · mva ${kr(t.vat)} · totalt ${kr(t.total)}`; };
        body.addEventListener("input", upd); body.addEventListener("change", upd);
        body.addEventListener("click", (e) => {
          if (e.target.closest("[data-line-add]")) { tb.insertAdjacentHTML("beforeend", lineRowHtml({ quantity: 1, vatRate: 25 })); $$(".ln-d", body).pop().focus(); upd(); }
          const del = e.target.closest("[data-line-del]");
          if (del) { del.closest("tr").remove(); upd(); const b = $("[data-line-add]", body); if (b) b.focus(); }
        });
        upd();
      },
      onSubmit(v, body) {
        const lines = readLines(body).filter((l) => l.description || l.unitPriceCents);
        if (!lines.length) throw new Error("Legg til minst én linje med beskrivelse og pris.");
        const bad = lines.find((l) => !l.description);
        if (bad) throw new Error("Alle linjer må ha en beskrivelse.");
        const c = S.data.customers.find((x) => norm(x.name) === norm(v.customerName));
        const j = jobOf(v.jobId);
        const o = Object.assign({}, quote || {}, {
          id: quote ? quote.id : newId("quote"), title: v.title, customerName: c ? c.name : v.customerName, customerId: c ? c.id : undefined,
          jobId: j ? j.id : undefined, jobTitle: j ? j.title : undefined, validUntil: opt(v.validUntil), status: v.status, notes: opt(v.notes), lines,
          createdAt: quote ? quote.createdAt || isoNow() : isoNow()
        });
        o.totalCents = quoteTotals(o).total;
        return persist("quotes", o).then((saved) => { toast(quote ? "Tilbudet er lagret." : "Tilbudet er opprettet."); if (!quote) setTimeout(() => openQuote(saved.id), 0); });
      }
    });
  }
  function deleteQuote(id) {
    const q = S.data.quotes.find((x) => x.id === id); if (!q) return;
    if (!confirm("Slette tilbudet «" + q.title + "»?")) return;
    removeDoc("quotes", id).then(() => { if ($("#modal").open) $("#modal").close(); closeDrawer(); toast("Tilbudet er slettet."); }, fail);
  }

  /* ================= HMS/KS ================= */
  function renderHms() {
    const st = S.f.devStatus;
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const list = S.data.deviations.filter((d) => (st === "active" ? d.status === "open" || d.status === "in_progress" : !st || d.status === st))
      .sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const rows = list.map((d) => `<tr data-open="open-deviation" data-id="${esc(d.id)}">${td("Avvik", openLink("open-deviation", d.id, d.title), "strong")}${td("Ordre", esc(d.jobTitle || (jobOf(d.jobId) || {}).title || "–"))}${td("Alvorlighet", pill(DEV_SEVERITY, d.severity))}${td("Meldt", esc(fmtDate(d.createdAt)) + `<small class="block muted">${esc(person(d.createdByUserId))}</small>`)}
      ${td("Status", selectHtml("dev-st-" + d.id, "Status for " + d.title, options(DEV_STATUS, d.status), `data-change="dev-status" data-id="${esc(d.id)}" class="compact"`).replace('class="filter"', 'class="filter inline"'))}</tr>`);
    const cls = S.data.checklists.slice().sort(byText((c) => c.status));
    const clRows = cls.map((c) => { const items = c.items || []; const done = items.filter((i) => i.isCompleted).length; const pct = items.length ? Math.round(done / items.length * 100) : 0;
      return `<tr data-open="open-job" data-id="${esc(c.jobId)}">${td("Sjekkliste", openLink("open-job", c.jobId, c.title), "strong")}${td("Ordre", esc((jobOf(c.jobId) || {}).title || "–"))}${td("Fremdrift", `${done}/${items.length} <span class="bar inline" role="img" aria-label="${pct} % fullført"><i style="width:${pct}%"></i></span>`)}${td("Signert", c.signerName ? esc(c.signerName) + (c.signedAt ? `<small class="block muted">${esc(fmtDate(c.signedAt))}</small>` : "") : '<span class="muted">–</span>')}</tr>`; });
    const openCount = S.data.deviations.filter((d) => d.status === "open" || d.status === "in_progress").length;
    return pageHead("HMS/KS", `${openCount} åpne avvik · ${S.data.checklists.length} sjekklister`, btn("Nytt avvik", "new-deviation", "", "btn-primary")) +
      `<div class="filters">${filterSelect("devStatus", "Vis", [{ value: "active", label: "Åpne og under arbeid" }, { value: "", label: "Alle" }].concat(options(DEV_STATUS)))}</div>
      ${table(["Avvik", "Ordre", "Alvorlighet", "Meldt", "Status"], rows, "Avvik") || empty("Ingen avvik her. Bra jobba!")}
      <h2 class="section-title">Sjekklister og SJA</h2>
      ${table(["Sjekkliste", "Ordre", "Fremdrift", "Signert"], clRows, "Sjekklister") || empty("Ingen sjekklister ennå.")}`;
  }
  function setDevStatus(d, status) {
    const o = Object.assign({}, d, { status });
    if (status === "resolved" || status === "rejected") { o.resolvedAt = isoNow(); o.resolvedByUserId = S.user.uid; } else { delete o.resolvedAt; delete o.resolvedByUserId; }
    return persist("deviations", o).then(() => toast(`Avviket er satt til «${DEV_STATUS[status][0].toLowerCase()}».`));
  }
  function openDeviation(id) {
    openDrawer(() => {
      const d = S.data.deviations.find((x) => x.id === id); if (!d) return null;
      return {
        title: d.title,
        html: `<dl class="meta"><div><dt>Alvorlighet</dt><dd>${pill(DEV_SEVERITY, d.severity)}</dd></div><div><dt>Status</dt><dd>${pill(DEV_STATUS, d.status)}</dd></div>
          <div><dt>Ordre</dt><dd>${jobOf(d.jobId) ? openLink("open-job", d.jobId, d.jobTitle || jobOf(d.jobId).title) : esc(d.jobTitle || "–")}</dd></div>
          <div><dt>Meldt av</dt><dd>${esc(person(d.createdByUserId))} · ${esc(fmtDate(d.createdAt))}</dd></div>
          ${d.resolvedAt ? `<div><dt>Lukket</dt><dd>${esc(fmtDate(d.resolvedAt))} av ${esc(person(d.resolvedByUserId))}</dd></div>` : ""}</dl>
          <p class="notes">${esc(d.description || "Ingen beskrivelse.")}</p>
          <div class="btn-row">${Object.keys(DEV_STATUS).filter((k) => k !== d.status).map((k) => btn(k === "resolved" ? "Lukk avvik" : k === "in_progress" ? "Start arbeid" : k === "open" ? "Gjenåpne" : "Avvis", "dev-set", `data-id="${esc(d.id)}" data-status="${k}"`, k === "resolved" ? "btn-primary" : "")).join("")}</div>`
      };
    });
  }
  function deviationForm() {
    const jobs = S.data.jobs.filter((j) => j.status !== "cancelled").sort(byText((j) => j.title));
    openForm({
      title: "Nytt avvik",
      submitLabel: "Registrer avvik",
      fields: [
        { name: "title", label: "Tittel", required: true, full: true },
        { name: "jobId", label: "Ordre", type: "select", required: true, options: [{ value: "", label: "Velg ordre …" }].concat(jobs.map((j) => ({ value: j.id, label: j.title }))) },
        { name: "severity", label: "Alvorlighet", type: "select", options: options(DEV_SEVERITY, "medium") },
        { name: "description", label: "Beskrivelse", type: "textarea", required: true, full: true, hint: "Hva skjedde, hvor, og hva er gjort for å sikre?" }
      ],
      onSubmit(v) {
        const j = jobOf(v.jobId); if (!j) throw fieldErr("Velg en ordre.", "jobId");
        const now = isoNow();
        return persist("deviations", { id: newId("deviation"), jobId: j.id, jobTitle: j.title, customerName: j.customerName, address: j.address, title: v.title, description: v.description, severity: v.severity, status: "open", createdByUserId: S.user.uid, createdAt: now })
          .then(() => toast("Avviket er registrert."));
      }
    });
  }

  /* ================= Skjema ================= */
  // Utfylte skjema fra appen (companies/{id}/formSubmissions). Kun lesing på web – bilder og signaturer ligger i appen.
  const answerOf = (f, fieldId) => (f.answers || []).find((a) => a.fieldId === fieldId) || { fieldId };
  // Samme regel som JobOSFormAnswer.isEmpty i iOS.
  const answerEmpty = (a) => !String(a.text || "").trim() && a.number == null && a.bool == null && !a.date && !(a.documentIds || []).length;
  const formDone = (f) => f.status === "completed";
  function formProgress(f) {
    const answerable = (f.fields || []).filter((x) => x.kind !== "heading");
    if (!answerable.length) return 100;
    return Math.round(answerable.filter((x) => !answerEmpty(answerOf(f, x.id))).length / answerable.length * 100);
  }
  function formAnswerHtml(field, a) {
    if (answerEmpty(a)) return '<span class="muted">Ikke besvart</span>';
    const n = (a.documentIds || []).length;
    switch (field.kind) {
      case "yesNo": return a.bool == null ? esc(a.text) : a.bool ? '<span class="yn yes">Ja</span>' : '<span class="yn no">Nei</span>';
      case "number": return a.number == null ? esc(a.text) : esc(decFmt.format(Number(a.number)) + (field.unit ? " " + field.unit : ""));
      case "date": return esc(a.date ? fmtDate(a.date) : a.text);
      case "photo": case "signature":
        if (!n) return esc(a.text || "");
        return esc((field.kind === "signature" ? "Signert – " : "") + n + " " + (n === 1 ? "bilde" : "bilder") + " i appen");
      default: return `<span class="fv-text">${esc(a.text != null && a.text !== "" ? a.text : a.number != null ? decFmt.format(Number(a.number)) : a.date ? fmtDate(a.date) : "")}</span>`;
    }
  }
  // Feltene gruppert under overskriftene sine.
  function formBodyHtml(f) {
    const groups = []; let cur = { title: null, fields: [] };
    (f.fields || []).forEach((x) => {
      if (x.kind === "heading") { if (cur.title || cur.fields.length) groups.push(cur); cur = { title: x.label, fields: [] }; } else cur.fields.push(x);
    });
    if (cur.title || cur.fields.length) groups.push(cur);
    const draft = !formDone(f);
    return groups.map((g) => `<section class="fv-group">${g.title ? `<h3>${esc(g.title)}</h3>` : ""}${g.fields.length ? `<dl class="fv">${g.fields.map((x) => {
      const a = answerOf(f, x.id), missing = draft && x.isRequired && answerEmpty(a);
      return `<div class="fv-row${missing ? " missing" : ""}"><dt>${esc(x.label)}${x.isRequired ? '<span class="req" aria-hidden="true"> *</span><span class="sr-only"> (påkrevd)</span>' : ""}</dt><dd>${formAnswerHtml(x, a)}${missing ? ' <span class="pill warn">Mangler</span>' : ""}</dd></div>`;
    }).join("")}</dl>` : ""}</section>`).join("") || '<p class="muted">Skjemaet har ingen felt.</p>';
  }
  function renderForms() {
    const all = S.data.formSubmissions, st = S.f.formStatus;
    const list = all.filter((f) => !st || (st === "completed" ? formDone(f) : !formDone(f)))
      .sort((a, b) => String(b.updatedAt || b.completedAt || "").localeCompare(String(a.updatedAt || a.completedAt || "")));
    const rows = list.map((f) => {
      const pct = formProgress(f), j = jobOf(f.jobId);
      return `<tr data-open="open-form" data-id="${esc(f.id)}">${td("Skjema", openLink("open-form", f.id, f.title || "Skjema"), "strong")}
        ${td("Ordre", j ? openLink("open-job", j.id, j.title) + (j.customerName ? `<small class="block muted">${esc(j.customerName)}</small>` : "") : '<span class="muted">–</span>')}
        ${td("Status", pill(FORM_STATUS, formDone(f) ? "completed" : "draft"))}
        ${td("Fremdrift", `${pct} % <span class="bar inline" role="img" aria-label="${pct} % besvart"><i style="width:${pct}%"></i></span>`)}
        ${td("Fullført", formDone(f) ? esc(f.completedBy || "–") + (f.completedAt ? `<small class="block muted">${esc(fmtDate(f.completedAt))}</small>` : "") : '<span class="muted">–</span>')}</tr>`;
    });
    const drafts = all.filter((f) => !formDone(f)).length;
    return pageHead("Skjema", `${all.length - drafts} fullført · ${drafts} ${drafts === 1 ? "kladd" : "kladder"} · skjema fylles ut i JobOS-appen`) +
      `<div class="filters">${chips("formStatus", "Vis", [{ value: "", label: "Alle", count: all.length }, { value: "draft", label: "Kladd", count: drafts }, { value: "completed", label: "Fullført", count: all.length - drafts }])}</div>
      ${table(["Skjema", "Ordre", "Status", "Fremdrift", "Fullført"], rows, "Skjema") || empty(all.length ? "Ingen skjema passer filteret." : "Ingen skjema ennå. Skjema fylles ut på ordren i JobOS-appen.")}`;
  }
  function openFormSubmission(id) {
    openDrawer(() => {
      const f = find("formSubmissions", id); if (!f) return null;
      const j = jobOf(f.jobId), pct = formProgress(f);
      const hasFiles = (f.fields || []).some((x) => (x.kind === "photo" || x.kind === "signature") && (answerOf(f, x.id).documentIds || []).length);
      return {
        title: f.title || "Skjema",
        html: `<dl class="meta">
            <div><dt>Status</dt><dd>${pill(FORM_STATUS, formDone(f) ? "completed" : "draft")}</dd></div>
            <div><dt>Fremdrift</dt><dd>${pct} % besvart <span class="bar inline" role="img" aria-hidden="true"><i style="width:${pct}%"></i></span></dd></div>
            <div><dt>Ordre</dt><dd>${j ? openLink("open-job", j.id, j.title) : "–"}</dd></div>
            <div><dt>Kunde</dt><dd>${esc(j ? j.customerName || "–" : "–")}</dd></div>
            ${formDone(f) ? `<div><dt>Fullført</dt><dd>${esc(fmtDate(f.completedAt))}${f.completedBy ? " av " + esc(f.completedBy) : ""}</dd></div>` : ""}
            <div><dt>Sist endret</dt><dd>${esc(fmtDateTime(f.updatedAt))}</dd></div>
          </dl>
          <div class="btn-row">${btn("Skriv ut", "print-form", `data-id="${esc(f.id)}"`)}</div>
          ${hasFiles ? '<p class="small muted">Bilder og signaturer er lagret i JobOS-appen og vises ikke på web.</p>' : ""}
          <div class="fv-wrap">${formBodyHtml(f)}</div>`
      };
    });
  }
  function printForm(id) {
    const f = find("formSubmissions", id); if (!f) return;
    const j = jobOf(f.jobId);
    const status = formDone(f) ? "Fullført" + (f.completedAt ? " " + fmtDate(f.completedAt) : "") + (f.completedBy ? " av " + f.completedBy : "") : "Kladd – " + formProgress(f) + " % besvart";
    printSheet(`<article class="ps">
      <header class="ps-head"><div><p class="ps-company">${esc(S.company.name)}</p><h1>${esc(f.title || "Skjema")}</h1></div></header>
      <dl class="ps-parties">
        <div><dt>Ordre</dt><dd>${esc(j ? j.title : "–")}</dd></div>
        <div><dt>Kunde / adresse</dt><dd>${esc(j ? j.customerName || "–" : "–")}${j && j.address ? "<br>" + esc(j.address) : ""}</dd></div>
        <div><dt>Status</dt><dd>${esc(status)}</dd></div>
      </dl>
      <div class="ps-form">${formBodyHtml(f)}</div>
      <p class="ps-foot">Bilder og signatur er lagret i JobOS-appen. Skrevet ut ${esc(fmtDate(isoNow()))} fra JobOS Kontor.</p>
    </article>`, (f.title || "Skjema") + (j ? " – " + j.title : ""));
  }

  /* ================= Katalog ================= */
  const skuKey = (s) => norm(String(s == null ? "" : s).trim());
  const materialBySku = (sku) => (skuKey(sku) ? S.data.materials.find((m) => skuKey(m.sku) === skuKey(sku)) : null);
  const lowStock = (m) => (Number(m.reorderPoint) || 0) > 0 && (Number(m.stockQuantity) || 0) <= Number(m.reorderPoint);
  const matCategories = () => Array.from(new Set(S.data.materials.map((m) => m.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "nb"));
  function renderCatalog() {
    const cats = matCategories();
    if (S.f.matCat && S.f.matCat !== "__none" && !cats.includes(S.f.matCat)) S.f.matCat = "";
    const q = norm(S.f.matQ), cat = S.f.matCat;
    const inCat = (m) => !cat || (cat === "__none" ? !m.category : m.category === cat);
    const list = S.data.materials.filter((m) => inCat(m) && (!q || [m.name, m.sku, m.ean, m.supplierName].some((x) => norm(x).includes(q)))).sort(byText((m) => m.name));
    const rows = list.map((m) => `<tr data-open="edit-material" data-id="${esc(m.id)}">
      ${td("Navn", openLink("edit-material", m.id, m.name || m.sku) + `<small class="block muted">Enhet: ${esc(m.unit || "stk")}</small>`, "strong")}
      ${td("Varenr", esc(m.sku || "–") + (m.ean ? `<small class="block muted">EAN ${esc(m.ean)}</small>` : ""))}
      ${td("Kategori", esc(m.category || "–"))}${td("Leverandør", esc(m.supplierName || "–"))}
      ${td("Innpris", `<label class="money-input"><span class="sr-only">Innpris for ${esc(m.name)} i kroner per ${esc(m.unit || "stk")}</span><input id="mat-cost-${esc(m.id)}" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(krInput(m.costPriceCents))}" data-change="mat-cost" data-id="${esc(m.id)}"><span aria-hidden="true">kr</span></label>`, "num")}
      ${td("Lager", `${esc(qtyFmt(m.stockQuantity))} ${esc(m.unit || "")}` + (lowStock(m) ? ' <span class="pill warn">Lavt</span>' : ""), "num")}</tr>`);
    const catOpts = [{ value: "", label: "Alle", count: S.data.materials.length }].concat(cats.map((c) => ({ value: c, label: c, count: S.data.materials.filter((m) => m.category === c).length })));
    const noCat = S.data.materials.filter((m) => !m.category).length;
    if (noCat && cats.length) catOpts.push({ value: "__none", label: "Uten kategori", count: noCat });
    const low = S.data.materials.filter(lowStock).length;
    return pageHead("Katalog", `${S.data.materials.length} varer${low ? ` · ${low} under bestillingspunkt` : ""}`,
      btn("Importer CSV", "import-csv") + btn("Ny vare", "new-material", "", "btn-primary") + '<input type="file" id="csv-file" accept=".csv,.txt,text/csv" hidden>') +
      `<div class="filters">${filterInput("matQ", "Søk", "search", "Navn, varenr, EAN, leverandør …")}${cats.length ? chips("matCat", "Kategori", catOpts) : ""}</div>
      <p class="result-count" aria-live="polite">${list.length} ${list.length === 1 ? "vare" : "varer"} · innpris lagres når du forlater feltet eller trykker Enter</p>
      ${table(["Navn", "Varenr", "Kategori", "Leverandør", { label: "Innpris (kr)", cls: "num" }, { label: "Lager", cls: "num" }], rows, "Varekatalog") || empty(S.data.materials.length ? "Ingen varer passer søket." : "Katalogen er tom. Legg til varer eller importer en CSV-fil fra grossisten.")}
      <p class="small muted csv-hint">CSV-import: semikolon- eller kommaseparert fil med overskriftsrad. Kolonnene gjenkjennes på navn – varenummer/varenr/sku, navn, enhet, innpris/pris, leverandør, ean og kategori. Varer med samme varenummer oppdateres, nye legges til.</p>`;
  }
  function materialForm(mat) {
    const m = mat || { unit: "stk" };
    const sups = Array.from(new Set(S.data.materials.map((x) => x.supplierName).filter(Boolean).concat(["Elektroskandia", "Solar", "Onninen", "Ahlsell"]))).sort((a, b) => a.localeCompare(b, "nb"));
    openForm({
      title: mat ? "Rediger vare" : "Ny vare",
      submitLabel: mat ? "Lagre vare" : "Legg til vare",
      fields: [
        { name: "sku", label: "Varenummer", required: true, value: m.sku, autocomplete: "off", hint: "El-nummer eller leverandørens varenummer." },
        { name: "ean", label: "EAN", value: m.ean, autocomplete: "off", inputmode: "numeric" },
        { name: "name", label: "Navn", required: true, value: m.name, full: true, autocomplete: "off" },
        { name: "unit", label: "Enhet", required: true, value: m.unit, datalist: ["stk", "m", "pk", "rull", "sett", "boks", "kg", "l"], autocomplete: "off" },
        { name: "category", label: "Kategori", value: m.category, datalist: matCategories(), autocomplete: "off" },
        { name: "supplierName", label: "Leverandør", value: m.supplierName, datalist: sups, autocomplete: "off" },
        { name: "cost", label: "Innpris (kr)", value: krInput(m.costPriceCents), inputmode: "decimal", autocomplete: "off", placeholder: "0,00", hint: "Eks. mva, per enhet." }
      ],
      danger: mat ? { label: "Slett vare", run: () => { if (!confirm("Slette «" + (mat.name || mat.sku) + "» fra katalogen?")) return; removeDoc("materials", mat.id).then(() => { $("#modal").close(); toast("Varen er slettet."); }, fail); } } : null,
      onSubmit(v) {
        const dup = S.data.materials.find((x) => skuKey(x.sku) === skuKey(v.sku) && (!mat || x.id !== mat.id));
        if (dup) throw fieldErr(`Varenummer ${v.sku} finnes allerede («${dup.name}»).`, "sku");
        const cents = parseKr(v.cost);
        if (Number.isNaN(cents) || cents < 0) throw fieldErr("Ugyldig innpris. Skriv f.eks. 129,90.", "cost");
        const o = Object.assign({ stockQuantity: 0, reorderPoint: 0, reorderTarget: 0 }, mat || {}, {
          id: mat ? mat.id : newId("material"), sku: v.sku, ean: opt(v.ean), name: v.name, unit: v.unit,
          category: opt(v.category), supplierName: opt(v.supplierName), costPriceCents: cents == null ? undefined : cents
        });
        return persist("materials", o).then(() => toast(mat ? "Varen er lagret." : "Varen er lagt til i katalogen."));
      }
    });
  }
  function setMaterialCost(el) {
    const m = find("materials", el.dataset.id); if (!m) return;
    const cents = parseKr(el.value);
    if (Number.isNaN(cents) || cents < 0) { el.setAttribute("aria-invalid", "true"); toast("Ugyldig innpris. Skriv f.eks. 129,90.", "err"); return; }
    el.removeAttribute("aria-invalid");
    const cur = m.costPriceCents == null ? null : Number(m.costPriceCents);
    if (cents === cur) { el.value = krInput(cur); return; }
    const o = Object.assign({}, m);
    if (cents == null) delete o.costPriceCents; else o.costPriceCents = cents;
    persist("materials", o).then(() => toast(`Innpris for «${m.name}» ${cents == null ? "er fjernet" : "er " + kr(cents)}.`), fail);
  }
  // Lagrer mange dokumenter med begrenset samtidighet og én ny tegning til slutt.
  function saveMany(col, objs) {
    const queue = objs.map((o) => { const c = Object.assign({}, o); Object.keys(c).forEach((k) => { if (c[k] === undefined) delete c[k]; }); return c; });
    const saved = [];
    let next = 0;
    const worker = () => { if (next >= queue.length) return Promise.resolve(); const o = queue[next++]; return S.store.save(col, o).then(() => { saved.push(o); return worker(); }); };
    const merge = () => {
      const arr = S.data[col] = S.data[col] || [];
      saved.forEach((o) => { const i = arr.findIndex((x) => x.id === o.id); if (i >= 0) arr[i] = o; else arr.push(o); });
      rerender();
    };
    return Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
      .then(() => { merge(); return saved.length; }, (err) => { merge(); if (queue.length > 1) err.message = `${saved.length} av ${queue.length} lagret. ${err.message || ""}`; throw err; });
  }

  /* ---------- CSV-import av varer ---------- */
  const CSV_COLS = {
    sku: ["varenummer", "varenr", "sku", "artikkelnummer", "artikkelnr", "artnr", "elnummer", "elnr", "nobbnr"],
    name: ["navn", "varenavn", "produktnavn", "beskrivelse", "varebeskrivelse", "tekst", "name", "description"],
    unit: ["enhet", "salgsenhet", "unit"],
    cost: ["innpris", "pris", "nettopris", "nettpris", "kostpris", "costprice", "price", "cost"],
    supplier: ["leverandør", "leverandor", "leverandørnavn", "grossist", "supplier"],
    ean: ["ean", "eannummer", "gtin", "strekkode"],
    category: ["kategori", "varegruppe", "gruppe", "category"]
  };
  const csvHeadKey = (h) => norm(String(h).replace(/\(.*?\)/g, "")).replace(/[^a-z0-9æøå]/g, "").replace(/(eksklmva|ekskmva|eksmva|exmva|nok|kr)$/, "");
  function parseCsv(text) {
    text = String(text).replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
    const delim = [";", "\t", ","].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
  }
  function mapCsvRows(rows) {
    const idx = {};
    (rows[0] || []).forEach((h, i) => { const k = csvHeadKey(h); Object.keys(CSV_COLS).forEach((f) => { if (idx[f] == null && CSV_COLS[f].includes(k)) idx[f] = i; }); });
    const hasHeader = Object.keys(idx).length > 0;
    if (hasHeader && (idx.sku == null || idx.name == null)) throw new Error(`Fant ikke kolonnen for ${idx.sku == null ? "varenummer (varenummer/varenr/sku)" : "navn"} i overskriftsraden.`);
    // Uten gjenkjent overskrift: fast rekkefølge varenummer; navn; enhet; innpris; leverandør; ean; kategori.
    const col = hasHeader ? idx : { sku: 0, name: 1, unit: 2, cost: 3, supplier: 4, ean: 5, category: 6 };
    return (hasHeader ? rows.slice(1) : rows).map((r) => {
      const g = (f) => (col[f] == null ? "" : String(r[col[f]] == null ? "" : r[col[f]]).trim());
      return { sku: g("sku"), name: g("name"), unit: g("unit"), cost: g("cost"), supplier: g("supplier"), ean: g("ean"), category: g("category") };
    });
  }
  function readTextFile(file) {
    return file.arrayBuffer().then((buf) => {
      const utf = new TextDecoder("utf-8").decode(buf);
      if (!utf.includes("�")) return utf;
      try { return new TextDecoder("windows-1252").decode(buf); } catch (e) { return utf; } // Excel på Windows lagrer ofte CSV som ANSI
    });
  }
  function importMaterialsCsv(file) {
    if (!file) return;
    readTextFile(file).then((text) => {
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("Filen er tom.");
      const items = mapCsvRows(rows);
      const existing = new Map(S.data.materials.map((m) => [skuKey(m.sku), m]));
      const out = new Map();
      let skipped = 0, badPrice = 0;
      items.forEach((it) => {
        const key = skuKey(it.sku);
        const base = key && (out.get(key) || existing.get(key));
        if (!key || (!base && !it.name)) { skipped++; return; }
        const o = Object.assign({}, base || { id: newId("material"), sku: it.sku, unit: "stk", stockQuantity: 0, reorderPoint: 0, reorderTarget: 0 });
        if (it.name) o.name = it.name;
        if (it.unit) o.unit = it.unit;
        if (it.category) o.category = it.category;
        if (it.supplier) o.supplierName = it.supplier;
        if (it.ean) o.ean = it.ean;
        if (it.cost) { const c = parseKr(it.cost); if (c == null || Number.isNaN(c) || c < 0) badPrice++; else o.costPriceCents = c; }
        out.set(key, o);
      });
      if (!out.size) throw new Error("Fant ingen varer i filen" + (skipped ? ` (${skipped} rader manglet varenummer eller navn)` : "") + ".");
      const created = Array.from(out.keys()).filter((k) => !existing.has(k)).length, updated = out.size - created;
      if (!confirm(`Importere ${out.size} varer fra «${file.name}»?\n\n${created} nye · ${updated} oppdateres (samme varenummer)${skipped ? ` · ${skipped} rader hoppes over` : ""}`)) return;
      toast("Importerer " + out.size + " varer …");
      return saveMany("materials", Array.from(out.values())).then((n) => toast(`Importerte ${n} varer: ${created} nye, ${updated} oppdatert` +
        (skipped ? `, ${skipped} rader hoppet over` : "") + (badPrice ? `, ${badPrice} med ugyldig pris (pris ikke endret)` : "") + "."));
    }).catch(fail);
  }

  /* ================= Innkjøp ================= */
  const poNo = (p) => p.orderNumber || "IO-" + String(p.id || "").replace(/^purchase-/, "").slice(0, 6).toUpperCase();
  const poPrice = (l) => (l.unitPriceCents == null ? "–" : kr(l.unitPriceCents));
  const poLineSum = (l) => (l.unitPriceCents == null ? "–" : kr(Math.round((Number(l.unitPriceCents) || 0) * (Number(l.quantity) || 0))));
  function renderPurchaseOrders() {
    const all = S.data.purchaseOrders;
    const list = all.filter((p) => !S.f.poStatus || p.status === S.f.poStatus).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const rows = list.map((p) => `<tr data-open="open-po" data-id="${esc(p.id)}">${td("Ordrenr", openLink("open-po", p.id, poNo(p)) + (p.jobTitle ? `<small class="block muted">${esc(p.jobTitle)}</small>` : ""), "strong")}
      ${td("Leverandør", esc(p.supplierName || "–"))}${td("Linjer", esc((p.lines || []).length), "num")}${td("Sum eks. mva", esc(kr(poTotal(p))), "num")}
      ${td("Status", pill(PO_STATUS, p.status))}${td("Dato", esc(fmtDate(p.sentAt || p.createdAt)))}</tr>`);
    const waiting = all.filter((p) => p.status === "sent" || p.status === "ordered");
    return pageHead("Innkjøp", `${waiting.length} venter på varemottak · ${kr(sum(waiting, poTotal))} eks. mva · innkjøpsordre lages i JobOS-appen`) +
      `<div class="filters">${filterSelect("poStatus", "Status", [{ value: "", label: "Alle" }].concat(options(PO_STATUS)))}</div>
      ${table(["Ordrenr", "Leverandør", { label: "Linjer", cls: "num" }, { label: "Sum eks. mva", cls: "num" }, "Status", "Dato"], rows, "Innkjøpsordre") || empty(all.length ? "Ingen innkjøpsordre passer filteret." : "Ingen innkjøpsordre ennå.")}`;
  }
  function openPurchaseOrder(id) {
    openDrawer(() => {
      const p = find("purchaseOrders", id); if (!p) return null;
      const lines = p.lines || [];
      const matched = lines.filter((l) => materialBySku(l.sku)).length;
      const canReceive = p.status !== "received" && p.status !== "cancelled";
      const j = p.jobId && jobOf(p.jobId);
      return {
        title: "Innkjøpsordre " + poNo(p),
        html: `<dl class="meta">
            <div><dt>Status</dt><dd>${pill(PO_STATUS, p.status)}</dd></div>
            <div><dt>Leverandør</dt><dd>${esc(p.supplierName || "–")}</dd></div>
            <div><dt>Ordre</dt><dd>${j ? openLink("open-job", j.id, p.jobTitle || j.title) : esc(p.jobTitle || "–")}</dd></div>
            <div><dt>Leveringsadresse</dt><dd>${esc(p.deliveryAddress || "–")}</dd></div>
            <div><dt>Opprettet</dt><dd>${esc(fmtDate(p.createdAt))}</dd></div>
            ${p.sentAt ? `<div><dt>Sendt</dt><dd>${esc(fmtDate(p.sentAt))}</dd></div>` : ""}
            ${p.receivedAt ? `<div><dt>Mottatt</dt><dd>${esc(fmtDate(p.receivedAt))}</dd></div>` : ""}
          </dl>
          ${p.note ? `<p class="notes">${esc(p.note)}</p>` : ""}
          <div class="drawer-actions"><div class="btn-row">${canReceive ? btn("Marker som mottatt", "receive-po", `data-id="${esc(p.id)}"`, "btn-primary") : ""}${btn("Skriv ut / PDF", "print-po", `data-id="${esc(p.id)}"`)}</div>
            ${canReceive && lines.length ? `<p class="small muted po-hint">${matched} av ${lines.length} linjer finnes i katalogen og legges på lager ved mottak.</p>` : ""}</div>
          <div class="table-wrap"><table class="data lines"><caption class="sr-only">Ordrelinjer</caption><thead><tr><th scope="col">Varenr</th><th scope="col">Vare</th><th scope="col" class="num">Antall</th><th scope="col" class="num">Enhetspris</th><th scope="col" class="num">Sum</th></tr></thead>
          <tbody>${lines.map((l) => `<tr>${td("Varenr", esc(l.sku || "–") + (l.sku && !materialBySku(l.sku) ? ' <span class="pill muted">Ikke i katalog</span>' : ""))}${td("Vare", esc(l.materialName || "–"))}${td("Antall", esc(qtyFmt(l.quantity)) + (l.unit ? " " + esc(l.unit) : ""), "num")}${td("Enhetspris", esc(poPrice(l)), "num")}${td("Sum", esc(poLineSum(l)), "num")}</tr>`).join("") || '<tr><td colspan="5" class="muted">Ingen linjer.</td></tr>'}</tbody></table></div>
          <dl class="sums"><div class="grand"><dt>Sum eks. mva</dt><dd>${esc(kr(poTotal(p)))}</dd></div></dl>`
      };
    });
  }
  function receivePurchaseOrder(id) {
    const p = find("purchaseOrders", id); if (!p || p.status === "received" || p.status === "cancelled") return;
    const lines = p.lines || [];
    const add = new Map(); // materialId -> antall
    lines.forEach((l) => { const m = materialBySku(l.sku), q = Number(l.quantity) || 0; if (m && q) add.set(m.id, (add.get(m.id) || 0) + q); });
    const unmatched = lines.filter((l) => !materialBySku(l.sku)).length;
    const nVarer = (n) => n + " " + (n === 1 ? "vare" : "varer");
    if (!confirm(`Marker ${poNo(p)} fra ${p.supplierName} som mottatt?\n\n` + (add.size ? `Lagerbeholdningen økes for ${nVarer(add.size)}.` : "Ingen linjer finnes i katalogen, så lageret endres ikke.") + (unmatched ? ` ${unmatched} ${unmatched === 1 ? "linje" : "linjer"} uten treff i katalogen.` : ""))) return;
    // Som iOS-appen: ordren lagres først (hindrer dobbelt mottak), deretter varene.
    persist("purchaseOrders", Object.assign({}, p, { status: "received", receivedAt: isoNow() }))
      .then(() => saveMany("materials", Array.from(add.entries()).map(([mid, q]) => {
        const m = find("materials", mid);
        return Object.assign({}, m, { stockQuantity: Math.round(((Number(m.stockQuantity) || 0) + q) * 1000) / 1000 });
      })))
      .then(() => toast(`${poNo(p)} er mottatt.` + (add.size ? ` Lager oppdatert for ${nVarer(add.size)}.` : "") + (unmatched ? ` ${unmatched} ${unmatched === 1 ? "linje" : "linjer"} uten treff i katalogen.` : "")), fail);
  }
  function printPurchaseOrder(id) {
    const p = find("purchaseOrders", id); if (!p) return;
    const lines = p.lines || [];
    const j = p.jobId && jobOf(p.jobId);
    const who = S.user ? nameFromEmail(S.user.email) : "";
    printSheet(`<article class="ps ps-po">
      <header class="ps-head">
        <div><p class="ps-company">${esc(S.company.name)}</p>${who ? `<p class="ps-sub">Bestilt av ${esc(who)}${S.user.email ? " · " + esc(S.user.email) : ""}</p>` : ""}</div>
        <div class="ps-doc"><h1>Innkjøpsordre</h1><dl>
          <div><dt>Ordrenr.</dt><dd>${esc(poNo(p))}</dd></div>
          <div><dt>Dato</dt><dd>${esc(fmtDate(p.sentAt || p.createdAt || isoNow()))}</dd></div>
          <div><dt>Status</dt><dd>${esc((PO_STATUS[p.status] || [p.status || "–"])[0])}</dd></div></dl></div>
      </header>
      <dl class="ps-parties">
        <div><dt>Leverandør</dt><dd>${esc(p.supplierName || "–")}</dd></div>
        <div><dt>Leveringsadresse</dt><dd>${esc(p.deliveryAddress || "–")}</dd></div>
        <div><dt>Prosjekt / ordre</dt><dd>${esc(p.jobTitle || (j ? j.title : "") || "–")}${j && j.customerName ? "<br>" + esc(j.customerName) : ""}</dd></div>
      </dl>
      <table class="ps-lines"><thead><tr><th>Varenr.</th><th>Beskrivelse</th><th class="num">Antall</th><th>Enhet</th><th class="num">Enhetspris</th><th class="num">Sum</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${esc(l.sku || "")}</td><td>${esc(l.materialName || "")}</td><td class="num">${esc(qtyFmt(l.quantity))}</td><td>${esc(l.unit || "")}</td><td class="num">${esc(poPrice(l))}</td><td class="num">${esc(poLineSum(l))}</td></tr>`).join("") || '<tr><td colspan="6">Ingen linjer.</td></tr>'}</tbody>
        <tfoot><tr><th colspan="5" scope="row">Sum eks. mva</th><td class="num">${esc(kr(poTotal(p)))}</td></tr></tfoot></table>
      ${p.note ? `<div class="ps-note"><h2>Merknad</h2><p>${esc(p.note)}</p></div>` : ""}
      <p class="ps-foot">Alle priser er oppgitt eks. mva. Oppgi ordrenummer ${esc(poNo(p))} på pakkseddel og faktura. Skrevet ut ${esc(fmtDate(isoNow()))} fra JobOS Kontor.</p>
    </article>`, `Innkjøpsordre ${poNo(p)} – ${p.supplierName || ""}`);
  }

  /* ================= Ansatte ================= */
  function renderMembers() {
    const ms = members().slice().sort((a, b) => (a.status === "removed") - (b.status === "removed") || nameFromEmail(a.email).localeCompare(nameFromEmail(b.email), "nb"));
    const manage = canManage();
    const rows = ms.map((m) => {
      const uid = m.uid || m.id, self = uid === S.user.uid, locked = m.role === "owner" || self || !manage || m.status === "removed";
      const roleCell = locked ? esc(ROLE[m.role] || m.role) : selectHtml("role-" + uid, "Rolle for " + (m.email || uid), ["admin", "office", "field"].map((r) => ({ value: r, label: ROLE[r], selected: r === m.role })), `data-change="member-role" data-id="${esc(uid)}"`).replace('class="filter"', 'class="filter inline"');
      return `<tr>${td("Navn", `<b>${esc(nameFromEmail(m.email) || uid)}</b>${self ? ' <span class="pill brand">Deg</span>' : ""}`)}${td("E-post", m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : "–")}${td("Rolle", roleCell)}${td("Status", m.status === "removed" ? '<span class="pill muted">Fjernet</span>' : '<span class="pill ok">Aktiv</span>')}
        ${td("Handling", locked ? '<span class="muted small">–</span>' : btn("Fjern", "remove-member", `data-id="${esc(uid)}"`, "btn-danger-ghost"), "actions")}</tr>`;
    });
    const inv = S.data.invitations || [];
    const invRows = inv.map((i) => `<tr>${td("E-post", esc(i.email))}${td("Rolle", esc(ROLE[i.role] || i.role))}${td("Invitert", esc(fmtDate(i.createdAt)) + (i.invitedBy ? `<small class="block muted">av ${esc(person(i.invitedBy))}</small>` : ""))}${td("Handling", manage ? btn("Trekk tilbake", "revoke-invite", `data-id="${esc(i.id)}"`, "btn-danger-ghost") : "–", "actions")}</tr>`);
    return pageHead("Ansatte", `${ms.filter((m) => m.status !== "removed").length} aktive brukere`) +
      table(["Navn", "E-post", "Rolle", "Status", "Handling"], rows, "Ansatte") +
      `<div class="two-col">
        <section class="panel" aria-labelledby="h-invite"><h2 id="h-invite">Inviter ansatt</h2>
          ${manage ? `<p class="small muted">Den ansatte logger inn i JobOS-appen med denne e-postadressen og blir automatisk med i ${esc(S.company.name)}.</p>
          <form id="invite-form" class="form" novalidate>
            <div class="field"><label for="inv-email">E-post</label><input id="inv-email" type="email" autocomplete="off" required></div>
            <div class="field"><label for="inv-role">Rolle</label><select id="inv-role"><option value="field">Montør – egne ordre, timer og kjørebok</option><option value="office">Kontor – planlegging, godkjenning, tilbud</option><option value="admin">Administrator – alt, inkludert brukere</option></select></div>
            <p class="notice err" id="inv-msg" role="alert" hidden></p>
            <button type="submit" class="btn btn-primary btn-sm">Send invitasjon</button></form>` : '<p class="notice info">Bare eier og administrator kan invitere nye brukere.</p>'}
        </section>
        <section class="panel" aria-labelledby="h-pending"><h2 id="h-pending">Ventende invitasjoner</h2>
          ${table(["E-post", "Rolle", "Invitert", "Handling"], invRows, "Ventende invitasjoner") || empty("Ingen ventende invitasjoner.")}
        </section></div>`;
  }
  function invite(form) {
    const email = $("#inv-email").value.trim().toLowerCase();
    const role = $("#inv-role").value;
    const msg = $("#inv-msg");
    const err = (t) => { msg.textContent = t; msg.hidden = false; $("#inv-email").setAttribute("aria-invalid", "true"); $("#inv-email").focus(); };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Skriv inn en gyldig e-postadresse.");
    if (members().some((m) => norm(m.email) === email && m.status !== "removed")) return err("Denne personen er allerede med i firmaet.");
    if ((S.data.invitations || []).some((i) => norm(i.email) === email)) return err("Det finnes allerede en ventende invitasjon til denne adressen.");
    const btnEl = form.querySelector("button[type=submit]"); btnEl.disabled = true;
    S.store.invite({ email, companyId: S.company.id, companyName: S.company.name, trades: S.company.trades || [], role, status: "pending", invitedBy: S.user.uid, createdAt: isoNow() })
      .then((o) => { S.data.invitations = (S.data.invitations || []).concat([o]); rerender(); toast("Invitasjon sendt til " + email + "."); const f = $("#inv-email"); if (f) f.focus(); })
      .catch((e) => { btnEl.disabled = false; err(e.message); });
  }

  /* ================= Handlinger ================= */
  const find = (col, id) => (S.data[col] || []).find((x) => x.id === id);
  const ACTIONS = {
    "start-demo": () => { closeDrawer(); startDemo(); },
    "reload": () => { toggleMenu(false); if (S.mode === "firebase" && S.company) loadAll(); else if (S.mode === "demo") loadAll(); else location.reload(); },
    "logout": () => {
      toggleMenu(false);
      sset("jobos_demo", null);
      if (S.mode === "demo") { if (F && F.enabled()) { location.href = "app.html"; } else { location.href = "index.html"; } return; }
      F.session.clear(); location.href = "app.html";
    },
    "reset-demo": () => { toggleMenu(false); if (S.mode !== "demo" || !confirm("Tilbakestille alle demodata? Endringene dine forsvinner.")) return; S.store.reset(); closeDrawer(); loadAll().then(() => toast("Demodata er tilbakestilt.")); },
    "switch-company": () => { toggleMenu(false); closeDrawer(); S.loaded = false; sset("jobos_companyId", null); renderCompanyPicker(); },
    "pick-company": (el) => { const c = S.companies.find((x) => x.id === el.dataset.id); if (c) openCompany(c); },
    "new-job": (el) => { const c = el.dataset.customer ? find("customers", el.dataset.customer) : null; jobForm(null, c ? { customerName: c.name, address: c.address } : null); },
    "open-job": (el) => openJob(el.dataset.id),
    "edit-job": (el) => jobForm(find("jobs", el.dataset.id)),
    "delete-job": (el) => { const j = find("jobs", el.dataset.id); if (j && confirm("Slette ordren «" + j.title + "»? Timer, avtaler og avvik beholdes.")) removeDoc("jobs", j.id).then(() => { closeDrawer(); toast("Ordren er slettet."); }, fail); },
    "new-appt": (el) => apptForm(null, { jobId: el.dataset.job, userId: el.dataset.user, date: el.dataset.date }),
    "edit-appt": (el) => apptForm(find("appointments", el.dataset.id)),
    "week-prev": () => { S.week = addDays(S.week, -7); rerender(); },
    "week-next": () => { S.week = addDays(S.week, 7); rerender(); },
    "week-today": () => { S.week = startOfWeek(new Date()); rerender(); },
    "approve-time": (el) => { const t = find("timeEntries", el.dataset.id); if (t) persist("timeEntries", Object.assign({}, t, { status: "approved" })).then(() => toast("Timeføringen er godkjent."), fail); },
    "reject-time": (el) => { const t = find("timeEntries", el.dataset.id); if (t) persist("timeEntries", Object.assign({}, t, { status: "draft" })).then(() => toast("Sendt tilbake til montøren som kladd."), fail); },
    "unapprove-time": (el) => { const t = find("timeEntries", el.dataset.id); if (t) persist("timeEntries", Object.assign({}, t, { status: "submitted" })).then(() => toast("Godkjenningen er angret."), fail); },
    "approve-all-time": () => {
      const list = timeBase().filter((t) => t.status === "submitted");
      if (!list.length || !confirm(`Godkjenne ${list.length} timeføringer (${hours(sum(list, (t) => t.minutes))})?`)) return;
      Promise.all(list.map((t) => persist("timeEntries", Object.assign({}, t, { status: "approved" })))).then(() => toast(list.length + " timeføringer er godkjent."), fail);
    },
    "export-time": () => {
      const list = timeBase().filter((t) => t.status === "approved").sort(byText((t) => t.workDate));
      if (!list.length) { toast("Ingen godkjente timer å eksportere.", "err"); return; }
      csv(`timer-godkjent-${S.f.timeMonth || "alle"}.csv`, ["Dato", "Ansatt", "E-post", "Ordre", "Timer", "Minutter", "Status"],
        list.map((t) => { const m = memberOf(t.userId); return [t.workDate, person(t.userId), m ? m.email : "", t.jobTitle || (jobOf(t.jobId) || {}).title || "", csvNum(t.minutes / 60, 2), t.minutes, TIME_STATUS[t.status][0]]; }));
    },
    "approve-trip": (el) => { const t = find("trips", el.dataset.id); if (t) persist("trips", Object.assign({}, t, { status: "approved" })).then(() => toast("Kjøreturen er godkjent."), fail); },
    "unapprove-trip": (el) => { const t = find("trips", el.dataset.id); if (t) persist("trips", Object.assign({}, t, { status: "completed" })).then(() => toast("Godkjenningen er angret."), fail); },
    "approve-all-trips": () => {
      const list = tripList().filter((t) => t.status === "completed");
      if (!list.length || !confirm(`Godkjenne ${list.length} kjøreturer?`)) return;
      Promise.all(list.map((t) => persist("trips", Object.assign({}, t, { status: "approved" })))).then(() => toast(list.length + " kjøreturer er godkjent."), fail);
    },
    "export-trips": () => {
      const list = tripList().filter((t) => t.status !== "active").sort(byText((t) => t.startedAt));
      if (!list.length) { toast("Ingen avsluttede turer å eksportere.", "err"); return; }
      csv(`kjorebok-${S.f.tripMonth || "alle"}.csv`, ["Dato", "Start", "Slutt", "Ansatt", "E-post", "Kjøretøy", "Fra", "Til", "Formål", "Ordre", "Km", "Godtgjørelse (kr)", "Bom (kr)", "Ferje (kr)", "Parkering (kr)", "Privat", "Status"],
        list.map((t) => [dayKey(parseDate(t.startedAt)), fmtTime(t.startedAt), t.endedAt ? fmtTime(t.endedAt) : "", person(t.userId, t.userEmail), t.userEmail || (memberOf(t.userId) || {}).email || "", t.vehicle || "", t.fromAddress, t.toAddress, t.purpose, t.jobTitle || "",
          csvNum(t.distanceKm, 1), t.isPrivate ? "0,00" : csvNum(t.distanceKm * KM_RATE_CENTS / 100, 2), csvNum((t.tollCents || 0) / 100, 2), csvNum((t.ferryCents || 0) / 100, 2), csvNum((t.parkingCents || 0) / 100, 2), t.isPrivate ? "Ja" : "Nei", TRIP_STATUS[t.status][0]]));
    },
    "new-equipment": () => equipmentForm(null),
    "edit-equipment": (el) => equipmentForm(find("equipment", el.dataset.id)),
    "new-customer": () => customerForm(null),
    "open-customer": (el) => openCustomer(el.dataset.id),
    "edit-customer": (el) => customerForm(find("customers", el.dataset.id)),
    "new-quote": (el) => quoteForm(null, { customerId: el.dataset.customer }),
    "open-quote": (el) => openQuote(el.dataset.id),
    "edit-quote": (el) => quoteForm(find("quotes", el.dataset.id)),
    "delete-quote": (el) => deleteQuote(el.dataset.id),
    "share-quote": (el) => shareQuote(el.dataset.id),
    "sync-quotes": () => syncQuotes(true),
    "copy-link": (el) => {
      const input = document.getElementById(el.dataset.target); if (!input) return;
      const done = () => { toast("Lenken er kopiert."); el.textContent = "Kopiert ✓"; setTimeout(() => { el.textContent = "Kopier lenke"; }, 2000); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); document.execCommand("copy"); done(); });
      else { input.focus(); input.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Marker lenken og kopier den manuelt.", "err"); } }
    },
    "set-filter": (el) => {
      const key = el.dataset.key, value = el.dataset.value || "";
      S.f[key] = value; withFocus(renderView);
      const b = $(`[data-action="set-filter"][data-key="${key}"][data-value="${window.CSS && CSS.escape ? CSS.escape(value) : value}"]`);
      if (b) b.focus();
    },
    "open-form": (el) => openFormSubmission(el.dataset.id),
    "print-form": (el) => printForm(el.dataset.id),
    "new-material": () => materialForm(null),
    "edit-material": (el) => materialForm(find("materials", el.dataset.id)),
    "import-csv": () => { const f = $("#csv-file"); if (f) { f.value = ""; f.click(); } },
    "open-po": (el) => openPurchaseOrder(el.dataset.id),
    "receive-po": (el) => receivePurchaseOrder(el.dataset.id),
    "print-po": (el) => printPurchaseOrder(el.dataset.id),
    "new-deviation": () => deviationForm(),
    "open-deviation": (el) => openDeviation(el.dataset.id),
    "dev-set": (el) => { const d = find("deviations", el.dataset.id); if (d) setDevStatus(d, el.dataset.status).catch(fail); },
    "remove-member": (el) => {
      const m = memberOf(el.dataset.id); if (!m || !confirm(`Fjerne ${m.email} fra ${S.company.name}? Brukeren mister tilgang til firmaets data.`)) return;
      persist("members", Object.assign({}, m, { status: "removed" })).then(() => toast("Brukeren er fjernet."), fail);
    },
    "revoke-invite": (el) => {
      const i = (S.data.invitations || []).find((x) => x.id === el.dataset.id); if (!i || !confirm("Trekke tilbake invitasjonen til " + i.email + "?")) return;
      S.store.removeInvitation(i.id).then(() => { S.data.invitations = S.data.invitations.filter((x) => x.id !== i.id); rerender(); toast("Invitasjonen er trukket tilbake."); }, fail);
    }
  };
  const CHANGES = {
    "job-status": (el) => { const j = find("jobs", el.dataset.id); if (j && j.status !== el.value) persist("jobs", Object.assign({}, j, { status: el.value })).then(() => toast("Status endret til «" + JOB_STATUS[el.value][0] + "»."), fail); },
    "quote-status": (el) => { const q = find("quotes", el.dataset.id); if (q && q.status !== el.value) persist("quotes", Object.assign({}, q, { status: el.value })).then(() => toast("Status endret til «" + QUOTE_STATUS[el.value][0] + "»."), fail); },
    "dev-status": (el) => { const d = find("deviations", el.dataset.id); if (d && d.status !== el.value) setDevStatus(d, el.value).catch(fail); },
    "mat-cost": (el) => setMaterialCost(el),
    "member-role": (el) => { const m = memberOf(el.dataset.id); if (m && m.role !== el.value) persist("members", Object.assign({}, m, { role: el.value })).then(() => toast("Rollen er endret til «" + ROLE[el.value] + "»."), fail); }
  };

  /* ================= Brukermeny og globale lyttere ================= */
  function toggleMenu(open) {
    const b = $("#user-btn"), m = $("#user-menu");
    const next = open == null ? m.hidden : open;
    m.hidden = !next; b.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) { const first = $("button:not([hidden]), a", m); if (first) first.focus(); }
  }
  function bind() {
    document.addEventListener("click", (e) => {
      const ub = e.target.closest("#user-btn");
      if (ub) { toggleMenu(); return; }
      if (!e.target.closest("#user-menu")) { if (!$("#user-menu").hidden) toggleMenu(false); }
      const closeBtn = e.target.closest("[data-close]");
      if (closeBtn) { const dlg = closeBtn.closest("dialog"); if (dlg) { if (dlg.id === "drawer") closeDrawer(); else dlg.close(); } return; }
      const danger = e.target.closest("[data-modal-danger]");
      if (danger && S.form && S.form.danger) { S.form.danger.run(); return; }
      const a = e.target.closest("[data-action]");
      if (a && ACTIONS[a.dataset.action]) { if (a.tagName === "A") e.preventDefault(); ACTIONS[a.dataset.action](a, e); return; }
      const row = e.target.closest("tr[data-open]");
      if (row && !e.target.closest("a, button, input, select, textarea, label") && ACTIONS[row.dataset.open]) ACTIONS[row.dataset.open](row, e);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#user-menu").hidden) { toggleMenu(false); $("#user-btn").focus(); }
      // Enter i et innebygd redigeringsfelt (f.eks. innpris i Katalog) lagrer uten å forlate feltet.
      if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.dataset.change && !e.target.closest("form")) { e.preventDefault(); e.target.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    document.addEventListener("input", (e) => {
      const f = e.target.dataset && e.target.dataset.filter;
      if (f && e.target.tagName === "INPUT") { S.f[f] = e.target.value; withFocus(renderView); }
    });
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "csv-file") { importMaterialsCsv(t.files && t.files[0]); return; }
      if (t.dataset.filter && t.tagName === "SELECT") { S.f[t.dataset.filter] = t.value; withFocus(renderView); return; }
      if (t.dataset.change && CHANGES[t.dataset.change]) CHANGES[t.dataset.change](t);
    });
    document.addEventListener("submit", (e) => {
      if (e.target.id === "modal-form") { e.preventDefault(); submitForm(); }
      else if (e.target.id === "invite-form") { e.preventDefault(); invite(e.target); }
    });
    // Lukk ved klikk på bakgrunnen
    ["#drawer", "#modal"].forEach((sel) => {
      const d = $(sel);
      d.addEventListener("click", (e) => { if (e.target === d) { if (sel === "#drawer") closeDrawer(); else d.close(); } });
      d.addEventListener("close", () => {
        if (sel === "#drawer") S.drawerFn = null; else S.form = null;
        const back = sel === "#drawer" ? S.drawerReturn : S.modalReturn;
        if (back && document.contains(back) && typeof back.focus === "function") back.focus();
        else if (sel === "#modal" && $("#drawer").open) { const c = $("#drawer [data-close]"); if (c) c.focus(); }
      });
    });
    window.addEventListener("hashchange", () => route(true));
  }

  /* ================= Start ================= */
  function boot() {
    bind();
    const forceDemo = /[?&]demo=1\b/.test(location.search) || sget("jobos_demo") === "1";
    if (!F || !F.enabled() || forceDemo) { startDemo(); return; }
    const s = F.session.get();
    if (!s) { renderLogin(); return; }
    startFirebase(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
