(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;

  /* --- Reveal on scroll ------------------------------------------ */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach(function (el) {
      io.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("is-in");
    });
  }

  /* --- UTC clock ------------------------------------------------ */
  var clockEls = document.querySelectorAll("[data-clock]");
  if (clockEls.length) {
    function tick() {
      var now = new Date();
      var p = function (n) {
        return String(n).padStart(2, "0");
      };
      var time =
        p(now.getUTCHours()) +
        ":" +
        p(now.getUTCMinutes()) +
        ":" +
        p(now.getUTCSeconds()) +
        " GMT";
      clockEls.forEach(function (el) {
        el.textContent = time;
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  /* --- Year ------------------------------------------------------ */
  var yearEls = document.querySelectorAll("[data-year]");
  yearEls.forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* --- Mouse parallax (desktop, fine pointer only) -------------- */
  if (!reduceMotion && finePointer) {
    var sigil = document.querySelector(".sigil");
    var title = document.querySelector(".hero-title");
    if (sigil && title) {
      var tx = window.innerWidth / 2;
      var ty = window.innerHeight / 2;
      var targetX = 0;
      var targetY = 0;
      var curX = 0;
      var curY = 0;
      var raf = null;

      function step() {
        curX += (targetX - curX) * 0.06;
        curY += (targetY - curY) * 0.06;

        sigil.style.transform =
          "translateY(-50%) rotate(" + curX * 2.5 + "deg)";
        title.style.transform =
          "translate3d(" + curX * 14 + "px, " + curY * 8 + "px, 0)";

        if (Math.abs(targetX - curX) > 0.001 || Math.abs(targetY - curY) > 0.001) {
          raf = requestAnimationFrame(step);
        } else {
          raf = null;
        }
      }

      window.addEventListener(
        "mousemove",
        function (e) {
          targetX = (e.clientX - tx) / tx;
          targetY = (e.clientY - ty) / ty;
          if (!raf) {
            raf = requestAnimationFrame(step);
          }
        },
        { passive: true }
      );

      window.addEventListener(
        "resize",
        function () {
          tx = window.innerWidth / 2;
          ty = window.innerHeight / 2;
        },
        { passive: true }
      );
    }
  }
})();
