/* JobOS – felles Firebase-klient via REST (ingen SDK).
   Brukes av app.html (kontor), tilbud.html (kundeportal) og logg-inn.html.
   Eksponerer window.JobOSFire. */
(function () {
  "use strict";
  var cfg = window.JOBOS_FIREBASE || {};
  var ID_BASE = "https://identitytoolkit.googleapis.com/v1/";
  var TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

  function enabled() { return !!(cfg.apiKey && cfg.projectId); }
  function docsBase() {
    return "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(cfg.projectId) + "/databases/(default)/documents";
  }

  /* ---------- JSON <-> Firestore Value ---------- */
  // Felter som er Double i iOS-modellene lagres alltid som doubleValue, også når verdien er et heltall.
  var DOUBLE_KEYS = { quantity: 1, vatRate: 1, distanceKm: 1, latitude: 1, longitude: 1, stockQuantity: 1, reorderPoint: 1, reorderTarget: 1 };

  function toValue(v, key) {
    if (v === null) return { nullValue: null };
    if (Array.isArray(v)) {
      return { arrayValue: { values: v.filter(function (x) { return x !== undefined; }).map(function (x) { return toValue(x); }) } };
    }
    switch (typeof v) {
      case "string": return { stringValue: v };
      case "boolean": return { booleanValue: v };
      case "number":
        if (!isFinite(v)) return { nullValue: null };
        if (Number.isInteger(v) && !(key && DOUBLE_KEYS[key])) return { integerValue: String(v) };
        return { doubleValue: v };
      case "object": return { mapValue: { fields: toFields(v) } };
      default: return { nullValue: null };
    }
  }
  function toFields(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) {
      if (obj[k] !== undefined) out[k] = toValue(obj[k], k);
    });
    return out;
  }
  function fromValue(v) {
    if (!v || typeof v !== "object") return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("booleanValue" in v) return !!v.booleanValue;
    if ("nullValue" in v) return null;
    if ("timestampValue" in v) return v.timestampValue;
    if ("referenceValue" in v) return v.referenceValue;
    if ("geoPointValue" in v) return v.geoPointValue;
    if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromValue);
    if ("mapValue" in v) return fromFields((v.mapValue && v.mapValue.fields) || {});
    return null;
  }
  function fromFields(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = fromValue(fields[k]); });
    return out;
  }
  function fromDoc(doc) {
    var obj = fromFields(doc.fields || {});
    var segs = (doc.name || "").split("/");
    if (!obj.id) obj.id = decodeURIComponent(segs[segs.length - 1] || "");
    return obj;
  }

  /* ---------- Økt (sessionStorage) ---------- */
  var K = { idToken: "jobos_idToken", refreshToken: "jobos_refreshToken", uid: "jobos_uid", email: "jobos_email", expiresAt: "jobos_expiresAt" };
  var session = {
    get: function () {
      try {
        var s = {};
        Object.keys(K).forEach(function (k) { s[k] = sessionStorage.getItem(K[k]); });
        if (!s.idToken || !s.uid) return null;
        s.expiresAt = parseInt(s.expiresAt || "0", 10);
        return s;
      } catch (e) { return null; }
    },
    save: function (d) {
      // Tar imot både signIn-svar (idToken/refreshToken/localId/expiresIn) og token-svar (id_token/refresh_token/user_id/expires_in).
      var s = {
        idToken: d.idToken || d.id_token,
        refreshToken: d.refreshToken || d.refresh_token,
        uid: d.localId || d.user_id || d.uid,
        email: d.email,
        expiresAt: Date.now() + (parseInt(d.expiresIn || d.expires_in || "3600", 10) * 1000)
      };
      try {
        Object.keys(K).forEach(function (k) { if (s[k] !== undefined && s[k] !== null) sessionStorage.setItem(K[k], String(s[k])); });
      } catch (e) { /* sessionStorage utilgjengelig */ }
      return session.get();
    },
    clear: function () {
      try { Object.keys(K).forEach(function (k) { sessionStorage.removeItem(K[k]); }); sessionStorage.removeItem("jobos_companyId"); } catch (e) { /* ignorer */ }
    }
  };

  var AUTH_ERR = {
    EMAIL_NOT_FOUND: "Fant ingen bruker med denne e-postadressen.",
    INVALID_PASSWORD: "Feil passord.",
    INVALID_LOGIN_CREDENTIALS: "Feil e-post eller passord.",
    INVALID_EMAIL: "Ugyldig e-postadresse.",
    USER_DISABLED: "Brukeren er deaktivert.",
    EMAIL_EXISTS: "Det finnes allerede en bruker med denne e-postadressen.",
    WEAK_PASSWORD: "Passordet må ha minst 6 tegn.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "For mange forsøk. Prøv igjen om litt.",
    TOKEN_EXPIRED: "Innloggingen er utløpt. Logg inn på nytt.",
    INVALID_REFRESH_TOKEN: "Innloggingen er utløpt. Logg inn på nytt."
  };
  function authError(data) {
    var code = ((data && data.error && data.error.message) || "").split(" ")[0];
    return new Error(AUTH_ERR[code] || "Noe gikk galt (" + (code || "ukjent feil") + ").");
  }

  function readJson(r) {
    return r.text().then(function (t) {
      var d = null;
      try { d = t ? JSON.parse(t) : {}; } catch (e) { d = { raw: t }; }
      return { ok: r.ok, status: r.status, data: d };
    });
  }

  function signIn(email, password, signup) {
    return fetch(ID_BASE + (signup ? "accounts:signUp" : "accounts:signInWithPassword") + "?key=" + encodeURIComponent(cfg.apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
    }).then(readJson).then(function (res) {
      if (!res.ok) throw authError(res.data);
      if (signup && res.data.idToken) {
        // Bekreftet e-post kreves for å godta invitasjoner til et firma.
        fetch(ID_BASE + "accounts:sendOobCode?key=" + encodeURIComponent(cfg.apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken: res.data.idToken })
        }).catch(function () {});
      }
      return session.save(res.data);
    });
  }

  var refreshing = null;
  function refresh() {
    var s = session.get();
    if (!s || !s.refreshToken) return Promise.reject(new Error("Du er ikke logget inn."));
    if (refreshing) return refreshing;
    refreshing = fetch(TOKEN_URL + "?key=" + encodeURIComponent(cfg.apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(s.refreshToken)
    }).then(readJson).then(function (res) {
      refreshing = null;
      if (!res.ok) { session.clear(); var e = authError(res.data); e.authExpired = true; throw e; }
      res.data.email = s.email;
      return session.save(res.data);
    }, function (err) { refreshing = null; throw err; });
    return refreshing;
  }

  function idToken() {
    var s = session.get();
    if (!s) { var e = new Error("Du er ikke logget inn."); e.authExpired = true; return Promise.reject(e); }
    if (Date.now() < s.expiresAt - 60000) return Promise.resolve(s.idToken);
    return refresh().then(function (n) { return n.idToken; });
  }

  /* ---------- Firestore REST ---------- */
  function fsError(res) {
    var d = res.data || {};
    var st = (d.error && d.error.status) || "";
    var msg = (d.error && d.error.message) || ("HTTP " + res.status);
    var text = st === "PERMISSION_DENIED" ? "Du har ikke tilgang til dette (PERMISSION_DENIED)."
      : st === "NOT_FOUND" || res.status === 404 ? "Fant ikke dokumentet."
      : st === "UNAUTHENTICATED" ? "Innloggingen er utløpt. Logg inn på nytt."
      : "Feil fra Firestore: " + msg;
    var e = new Error(text); e.status = res.status; e.code = st; return e;
  }

  // path: dokumentsti uten ledende skråstrek, segmentene er allerede URL-kodet av kalleren (se docPath).
  function request(method, path, body, opts) {
    opts = opts || {};
    var url = docsBase() + (path ? (path.charAt(0) === ":" ? path : "/" + path) : "");
    var qs = opts.query ? opts.query.slice() : [];
    if (opts.auth === false) qs.push("key=" + encodeURIComponent(cfg.apiKey));
    if (qs.length) url += (url.indexOf("?") === -1 ? "?" : "&") + qs.join("&");
    function go(retried) {
      var tokenP = opts.auth === false ? Promise.resolve(null) : idToken();
      return tokenP.then(function (tok) {
        var headers = {};
        if (tok) headers.Authorization = "Bearer " + tok;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        return fetch(url, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
      }).then(readJson).then(function (res) {
        if (res.status === 401 && opts.auth !== false && !retried) return refresh().then(function () { return go(true); });
        if (!res.ok) throw fsError(res);
        return res.data;
      });
    }
    return go(false);
  }

  function docPath(segments) { return segments.map(function (s) { return encodeURIComponent(s); }).join("/"); }

  function getDoc(segments, opts) { return request("GET", docPath(segments), undefined, opts).then(fromDoc); }

  function listDocs(segments, opts) {
    var all = [];
    function page(token) {
      var q = ["pageSize=300"];
      if (token) q.push("pageToken=" + encodeURIComponent(token));
      return request("GET", docPath(segments), undefined, { query: q, auth: opts && opts.auth }).then(function (d) {
        (d.documents || []).forEach(function (doc) { all.push(fromDoc(doc)); });
        return d.nextPageToken ? page(d.nextPageToken) : all;
      });
    }
    return page(null);
  }

  function patchDoc(segments, obj, opts) {
    opts = opts || {};
    var q = (opts.fieldPaths || []).map(function (f) { return "updateMask.fieldPaths=" + encodeURIComponent(f); });
    return request("PATCH", docPath(segments), { fields: toFields(obj) }, { query: q, auth: opts.auth }).then(fromDoc);
  }

  function deleteDoc(segments) { return request("DELETE", docPath(segments)); }

  // parentSegments: [] for rotnivå, ellers f.eks. ["companies", id].
  function runQuery(parentSegments, structuredQuery) {
    var p = docPath(parentSegments);
    return request("POST", p + ":runQuery", { structuredQuery: structuredQuery })
      .then(function (rows) {
        return (rows || []).filter(function (r) { return r.document; }).map(function (r) {
          var o = fromDoc(r.document); o._path = r.document.name; return o;
        });
      });
  }

  function randomToken(len) {
    var bytes = new Uint8Array(Math.ceil((len || 32) / 2));
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("").slice(0, len || 32);
  }

  window.JobOSFire = {
    config: cfg,
    enabled: enabled,
    toValue: toValue, toFields: toFields, fromValue: fromValue, fromFields: fromFields, fromDoc: fromDoc,
    session: session, signIn: signIn, refresh: refresh, idToken: idToken,
    request: request, getDoc: getDoc, listDocs: listDocs, patchDoc: patchDoc, deleteDoc: deleteDoc, runQuery: runQuery,
    randomToken: randomToken
  };
})();
