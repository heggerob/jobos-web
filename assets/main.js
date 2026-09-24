/* JobOS – mobilmeny, nedtrekksmeny, FAQ og priskalkulator. Ingen avhengigheter. */
(function () {
  "use strict";

  // Mobilmeny
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  if (header && toggle) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Lukk meny" : "Åpne meny");
    });
  }

  // Nedtrekksmeny (Løsninger)
  document.querySelectorAll(".has-dd").forEach(function (li) {
    var btn = li.querySelector(".dd-toggle");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = li.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  document.addEventListener("click", function (e) {
    document.querySelectorAll(".has-dd.open").forEach(function (li) {
      if (!li.contains(e.target)) { li.classList.remove("open"); li.querySelector(".dd-toggle").setAttribute("aria-expanded", "false"); }
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".has-dd.open").forEach(function (li) {
      li.classList.remove("open");
      var b = li.querySelector(".dd-toggle"); b.setAttribute("aria-expanded", "false"); b.focus();
    });
    if (header && header.classList.contains("nav-open")) { header.classList.remove("nav-open"); toggle.setAttribute("aria-expanded", "false"); }
  });

  // FAQ-trekkspill
  document.querySelectorAll(".faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var expanded = q.getAttribute("aria-expanded") === "true";
      q.setAttribute("aria-expanded", expanded ? "false" : "true");
      var a = document.getElementById(q.getAttribute("aria-controls"));
      if (a) a.hidden = expanded;
    });
  });

  // Priskalkulator
  var calc = document.getElementById("calc");
  if (calc) {
    var COMPETITOR = 359;
    var range = document.getElementById("calc-range");
    var usersOut = document.getElementById("calc-users");
    var oursOut = document.getElementById("calc-ours");
    var theirsOut = document.getElementById("calc-theirs");
    var saveOut = document.getElementById("calc-save");
    var fmt = new Intl.NumberFormat("nb-NO");
    var update = function () {
      var n = parseInt(range.value, 10) || 1;
      var planInput = calc.querySelector('input[name="plan"]:checked');
      var price = planInput ? parseInt(planInput.value, 10) : 199;
      var ours = n * price, theirs = n * COMPETITOR;
      usersOut.textContent = n + (n === 1 ? " bruker" : " brukere");
      oursOut.textContent = fmt.format(ours) + " kr/mnd";
      theirsOut.textContent = fmt.format(theirs) + " kr/mnd";
      saveOut.textContent = fmt.format((theirs - ours) * 12) + " kr/år";
      range.setAttribute("aria-valuetext", n + " brukere");
    };
    range.addEventListener("input", update);
    calc.querySelectorAll('input[name="plan"]').forEach(function (r) { r.addEventListener("change", update); });
    update();
  }

  // Årstall i footer
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
