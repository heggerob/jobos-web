/* Innlogging mot Firebase Identity Toolkit REST (ingen SDK). */
(function () {
  "use strict";
  var cfg = window.JOBOS_FIREBASE || {};
  var form = document.getElementById("auth-form");
  if (!form) return;
  var msg = document.getElementById("auth-msg");
  var submit = document.getElementById("auth-submit");
  var nameField = document.getElementById("field-firma");
  var tabs = document.querySelectorAll(".auth-tabs button");
  var mode = "signin";

  function show(text, kind) { msg.className = "notice " + (kind || "info"); msg.textContent = text; msg.hidden = false; }

  function setMode(m) {
    mode = m;
    tabs.forEach(function (t) { t.setAttribute("aria-selected", t.dataset.mode === m ? "true" : "false"); });
    nameField.hidden = m !== "signup";
    submit.textContent = m === "signup" ? "Opprett bedrift" : "Logg inn";
    document.getElementById("password").setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { setMode(t.dataset.mode); }); });
  if (location.hash === "#opprett") setMode("signup");
  document.querySelectorAll('a[href="#opprett"]').forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); setMode("signup"); document.getElementById("email").focus(); }); });

  function currentUser() {
    try { var email = sessionStorage.getItem("jobos_email"); return sessionStorage.getItem("jobos_idToken") && email; } catch (e) { return null; }
  }
  var logged = currentUser();
  if (logged) { show("Innlogget som " + logged + ". ", "ok"); var go = document.createElement("a"); go.href = "app.html"; go.textContent = "Gå til kontorsiden"; msg.appendChild(go); }

  function showOffline() {
    show("Innlogging aktiveres når Firebase er koblet til. Inntil da kan du ", "info");
    var demo = document.createElement("a"); demo.href = "app.html"; demo.textContent = "prøve kontorsiden i demomodus";
    msg.appendChild(demo); msg.appendChild(document.createTextNode("."));
  }
  if (!cfg.apiKey) showOffline();


  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!cfg.apiKey) { showOffline(); return; }
    var email = document.getElementById("email").value.trim();
    var password = document.getElementById("password").value;
    if (!email || !password) { show("Fyll inn e-post og passord.", "err"); return; }
    submit.disabled = true;
    show(mode === "signup" ? "Oppretter bruker …" : "Logger inn …", "info");
    var signInP = window.JobOSFire
      ? window.JobOSFire.signIn(email, password, mode === "signup")
      : Promise.reject(new Error("Innloggingsmodulen ble ikke lastet."));
    signInP
      .then(function (s) {
        document.getElementById("password").value = "";
        show("Innlogget som " + s.email + ". Åpner kontorsiden …", "ok");
        window.location.href = "app.html";
      })
      .catch(function (err) { show(err.message, "err"); })
      .then(function () { submit.disabled = false; });
  });
})();
