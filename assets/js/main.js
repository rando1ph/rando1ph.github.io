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

  /* --- Hero name evolution --------------------------------------- */
  var nameLine = document.querySelector(".hero-line");
  var heroGhost = document.querySelector(".hero-ghost");

  if (nameLine && reduceMotion) {
    // No perpetual animation: show both name forms once, statically.
    // A no-break space after the slash keeps the two names together on a line.
    nameLine.textContent = "RANDOLF /\u00A0RANDOLPH";
  } else if (nameLine) {
    var FORMS = ["Randúlfr", "Randulf", "Randolf", "Randolph"];
    var ERASE_MS = 55;
    var TYPE_MS = 75;
    var cur = "";

    function show(text) {
      cur = text;
      nameLine.textContent = text;
      if (heroGhost) {
        heroGhost.textContent = text;
      }
    }

    function commonPrefixLen(a, b) {
      var i = 0;
      var n = Math.min(a.length, b.length);
      while (i < n && a[i] === b[i]) {
        i += 1;
      }
      return i;
    }

    function entrance(word) {
      var html = "";
      var delay;
      for (var i = 0; i < word.length; i += 1) {
        delay = (0.12 + i * 0.05).toFixed(2);
        html +=
          '<span class="hero-char" style="--d:' +
          delay +
          's"><span>' +
          word[i] +
          "</span></span>";
      }
      nameLine.innerHTML = html;
    }

    function morphTo(target, done) {
      var keep = commonPrefixLen(cur, target);
      var from = cur;

      function eraseStep(k) {
        if (k > keep) {
          k -= 1;
          show(from.slice(0, k));
          setTimeout(function () {
            eraseStep(k);
          }, ERASE_MS);
        } else {
          typeStep(keep);
        }
      }

      function typeStep(k) {
        if (k < target.length) {
          k += 1;
          show(target.slice(0, k));
          setTimeout(function () {
            typeStep(k);
          }, TYPE_MS);
        } else {
          done();
        }
      }

      eraseStep(cur.length);
    }

    // Entrance: characters of the oldest form rise in one by one.
    // The ghost echo stays empty until the characters have risen, so the
    // outlined text does not cross the rising glyphs.
    entrance(FORMS[0]);
    if (heroGhost) {
      heroGhost.textContent = "";
    }

    // Once risen, flatten the characters and play the historical evolution,
    // then settle into a slow, calm alternation between RANDOLF and RANDOLPH.
    setTimeout(function () {
      show(FORMS[0]);
      setTimeout(playHistory, 1200);
    }, 1550);

    var step = 1;

    function playHistory() {
      if (step < FORMS.length) {
        var target = FORMS[step];
        var isLast = step === FORMS.length - 1;
        step += 1;
        morphTo(target, function () {
          setTimeout(playHistory, isLast ? 3200 : 1700);
        });
      } else {
        settle();
      }
    }

    function settle() {
      function flip(target) {
        morphTo(target, function () {
          setTimeout(function () {
            flip(target === FORMS[2] ? FORMS[3] : FORMS[2]);
          }, 3000);
        });
      }
      flip(FORMS[2]);
    }
  }

  /* --- Mouse parallax (wide screens, fine pointer only) ---------- */
  if (!reduceMotion && finePointer && window.innerWidth > 900) {
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
