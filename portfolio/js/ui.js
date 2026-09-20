/* UI glue: intro/loading screens, info panel, nav, contact modal, text fallback.
   Depends on PORTFOLIO_DATA from data.js and the two globals scene.js exposes:
   window.focusPortfolioNode(id), window.resetPortfolioFocus(). */

(function () {
  "use strict";

  const loadingScreen = document.getElementById("loading-screen");
  const introScreen = document.getElementById("intro-screen");
  const enterBtn = document.getElementById("enter-btn");
  const enterTextBtn = document.getElementById("enter-text-btn");

  const panel = document.getElementById("info-panel");
  const panelBackdrop = document.getElementById("panel-backdrop");
  const panelClose = document.getElementById("panel-close");
  const panelExpand = document.getElementById("panel-expand");
  const panelContent = panel.querySelector(".panel-content");
  const panelKicker = panel.querySelector(".panel-kicker");
  const panelTitle = panel.querySelector(".panel-title");
  const panelMeta = panel.querySelector(".panel-meta");
  const panelStats = panel.querySelector(".panel-stats");
  const panelGallery = panel.querySelector(".panel-gallery");
  const panelBody = panel.querySelector(".panel-body");
  const panelTags = panel.querySelector(".panel-tags");

  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const lightboxClose = document.getElementById("lightbox-close");

  const navButtons = document.querySelectorAll("#hud-nav [data-node]");
  const contactBtn = document.getElementById("contact-btn");
  const contactModal = document.getElementById("contact-modal");
  const contactClose = document.getElementById("contact-close");
  const resumeBtn = document.getElementById("resume-btn");
  const resumeModal = document.getElementById("resume-modal");
  const resumeClose = document.getElementById("resume-close");
  const resumeFrame = document.getElementById("resume-frame");
  const RESUME_PATH = "resume/Jordan-Banh-Resume.pdf";
  const themeToggle = document.getElementById("theme-toggle");

  const textToggle = document.getElementById("text-toggle");
  const textFallback = document.getElementById("text-fallback");
  const sceneContainer = document.getElementById("scene-container");
  const hudTop = document.getElementById("hud-top");
  const legend = document.getElementById("legend");

  const progressDots = document.querySelectorAll(".progress-dot");
  const progressCount = document.querySelector(".progress-count");
  const toastContainer = document.getElementById("toast-container");
  const confettiLayer = document.getElementById("confetti-layer");

  let benchReady = false;
  let forcedTextMode = false;

  // ---- Exploration game: progress tracking, unlock toasts, confetti -----
  //
  // Deliberately NOT persisted across reloads — each visit starts fresh.

  const SECTIONS = ["about", "work-experience", "projects"];
  const ACHIEVEMENT_LABELS = {
    "about": "Met Jordan",
    "work-experience": "Explored Work Experience",
    "projects": "Explored Projects"
  };

  const explored = new Set();

  function updateProgressUI() {
    progressDots.forEach(function (dot) {
      dot.classList.toggle("filled", explored.has(dot.dataset.id));
    });
    if (progressCount) progressCount.textContent = explored.size + "/" + SECTIONS.length + " explored";
  }
  updateProgressUI();

  function showToast(text, celebrate) {
    if (!toastContainer) return;
    const el = document.createElement("div");
    el.className = "toast" + (celebrate ? " celebrate" : "");
    el.textContent = text;
    toastContainer.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("show"); });
    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.remove(); }, 320);
    }, 2600);
  }

  function spawnConfetti() {
    if (!confettiLayer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#f2c218", "#ffd84d", "#15171c", "#ffffff"];
    for (let i = 0; i < 46; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "%";
      piece.style.backgroundColor = colors[i % colors.length];
      piece.style.animationDuration = (1.6 + Math.random() * 1.2) + "s";
      piece.style.animationDelay = (Math.random() * 0.4) + "s";
      piece.style.transform = "rotate(" + Math.floor(Math.random() * 360) + "deg)";
      confettiLayer.appendChild(piece);
      setTimeout(function () { piece.remove(); }, 3400);
    }
  }

  function markExplored(id) {
    if (SECTIONS.indexOf(id) === -1 || explored.has(id)) return;
    explored.add(id);
    updateProgressUI();
    showToast("Unlocked: " + (ACHIEVEMENT_LABELS[id] || id));
    if (explored.size === SECTIONS.length) {
      setTimeout(function () {
        spawnConfetti();
        showToast("You explored the whole bench — let's talk!", true);
      }, 500);
    }
  }

  // ---- Loading / intro -------------------------------------------------

  function hideLoading() {
    loadingScreen.classList.add("hidden");
  }

  document.addEventListener("bench-ready", function () {
    benchReady = true;
    hideLoading();
    applyInitialHash();
  });

  document.addEventListener("bench-unavailable", function () {
    hideLoading();
    forceTextMode();
    introScreen.classList.add("hidden");
  });

  function applyInitialHash() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    if (hash === "contact") {
      introScreen.classList.add("hidden");
      contactModal.classList.add("open");
      return;
    }
    if (hash === "resume") {
      introScreen.classList.add("hidden");
      openResume();
      return;
    }
    const match = PORTFOLIO_DATA.nodes.some(function (n) { return n.id === hash; });
    if (match) {
      introScreen.classList.add("hidden");
      window.selectPortfolioNode(hash);
    }
  }

  // Fallback in case neither event fires quickly (slow script load etc.)
  window.addEventListener("load", function () {
    setTimeout(hideLoading, 1200);
  });

  enterBtn.addEventListener("click", function () {
    introScreen.classList.add("hidden");
  });

  enterTextBtn.addEventListener("click", function () {
    introScreen.classList.add("hidden");
    if (!forcedTextMode) {
      inTextMode = true;
      toggleTextMode(true);
    }
  });

  // ---- Info panel --------------------------------------------------------

  const COUNT_UP_MS = 1100;
  const countUpTimers = [];

  function formatStatValue(stat, v) {
    const decimals = stat.decimals || 0;
    return (stat.prefix || "") + v.toFixed(decimals) + (stat.suffix || "");
  }

  function animateCountUp(el, stat) {
    const start = performance.now();
    const from = 0;
    const to = stat.value;
    function tick(t) {
      const p = Math.min((t - start) / COUNT_UP_MS, 1);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = formatStatValue(stat, from + (to - from) * eased);
      if (p < 1) {
        countUpTimers.push(requestAnimationFrame(tick));
      }
    }
    countUpTimers.push(requestAnimationFrame(tick));
  }

  function renderStats(stats) {
    while (countUpTimers.length) cancelAnimationFrame(countUpTimers.pop());
    panelStats.innerHTML = "";
    (stats || []).forEach(function (stat) {
      const wrap = document.createElement("div");
      wrap.className = "stat";
      const value = document.createElement("div");
      value.className = "stat-value";
      value.textContent = formatStatValue(stat, 0);
      const label = document.createElement("div");
      label.className = "stat-label";
      label.textContent = stat.label;
      wrap.appendChild(value);
      wrap.appendChild(label);
      panelStats.appendChild(wrap);
      animateCountUp(value, stat);
    });
  }

  function renderGallery(gallery) {
    panelGallery.innerHTML = "";
    (gallery || []).forEach(function (photo) {
      const thumb = document.createElement("div");
      thumb.className = "gallery-thumb";
      thumb.tabIndex = 0;
      thumb.setAttribute("role", "button");
      thumb.setAttribute("aria-label", "View larger: " + (photo.caption || "photo"));

      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = photo.alt || photo.caption || "";
      img.loading = "lazy";
      thumb.appendChild(img);

      if (photo.caption) {
        const cap = document.createElement("span");
        cap.className = "gallery-caption";
        cap.textContent = photo.caption;
        thumb.appendChild(cap);
      }

      function open() { openLightbox(photo.src, photo.caption || "", photo.alt || ""); }
      thumb.addEventListener("click", open);
      thumb.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });

      panelGallery.appendChild(thumb);
    });
  }

  function openLightbox(src, caption, alt) {
    lightboxImg.src = src;
    lightboxImg.alt = alt || caption || "";
    lightboxCaption.textContent = caption || "";
    lightbox.classList.add("open");
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
  }

  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) closeLightbox();
  });

  function renderNode(node) {
    panelKicker.textContent = node.kicker;
    panelTitle.innerHTML = node.title;
    panelMeta.innerHTML = node.meta;
    renderStats(node.stats);
    renderGallery(node.gallery);
    panelBody.innerHTML = node.body;
    panelTags.innerHTML = "";
    (node.tags || []).forEach(function (tag) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag;
      panelTags.appendChild(span);
    });
    // Any embedded 360° model viewers in this node's body need their own
    // Three.js scene, started fresh each time (this also disposes whatever
    // viewer belonged to the previously-shown node).
    if (window.initModelViewers) window.initModelViewers(panelBody);
  }

  let panelSwapTimer = null;

  window.selectPortfolioNode = function (id) {
    const node = PORTFOLIO_DATA.nodes.find(function (n) { return n.id === id; });
    if (!node) return;

    const wasOpen = panel.classList.contains("open");
    clearTimeout(panelSwapTimer);

    if (wasOpen) {
      // Panel is already open and showing a different node — crossfade
      // instead of snapping the text straight to the new content.
      panelContent.classList.add("is-swapping");
      panelSwapTimer = setTimeout(function () {
        renderNode(node);
        panelContent.classList.remove("is-swapping");
      }, 160);
    } else {
      renderNode(node);
    }

    panel.classList.add("open");
    panelBackdrop.classList.add("open");
    if (window.focusPortfolioNode) window.focusPortfolioNode(id);
    navButtons.forEach(function (b) {
      b.classList.toggle("active", b.dataset.node === id);
    });
    markExplored(id);
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* ignore */ }
  };

  function closePanel() {
    panel.classList.remove("open");
    panel.classList.remove("expanded");
    panelExpanded = false;
    panelExpand.setAttribute("aria-pressed", "false");
    panelExpand.title = "Expand";
    panelBackdrop.classList.remove("open");
    closeLightbox();
    if (window.disposeModelViewers) window.disposeModelViewers();
    if (window.resetPortfolioFocus) window.resetPortfolioFocus();
    navButtons.forEach(function (b) { b.classList.remove("active"); });
  }

  panelClose.addEventListener("click", closePanel);
  panelBackdrop.addEventListener("click", closePanel);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (lightbox.classList.contains("open")) {
        closeLightbox();
        return;
      }
      closePanel();
      contactModal.classList.remove("open");
      resumeModal.classList.remove("open");
    }
  });

  navButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      window.selectPortfolioNode(btn.dataset.node);
    });
  });

  // ---- Contact ------------------------------------------------------------

  contactBtn.addEventListener("click", function () {
    contactModal.classList.add("open");
    try { history.replaceState(null, "", "#contact"); } catch (e) { /* ignore */ }
  });
  contactClose.addEventListener("click", function () {
    contactModal.classList.remove("open");
  });
  contactModal.addEventListener("click", function (e) {
    if (e.target === contactModal) contactModal.classList.remove("open");
  });

  // ---- Resume ---------------------------------------------------------------

  function openResume() {
    // Lazy-load: the iframe's src is only set the first time this opens,
    // so the PDF isn't fetched until someone actually asks for it.
    if (!resumeFrame.getAttribute("src")) resumeFrame.setAttribute("src", RESUME_PATH);
    resumeModal.classList.add("open");
    try { history.replaceState(null, "", "#resume"); } catch (e) { /* ignore */ }
  }
  function closeResume() {
    resumeModal.classList.remove("open");
  }

  resumeBtn.addEventListener("click", openResume);
  resumeClose.addEventListener("click", closeResume);
  resumeModal.addEventListener("click", function (e) {
    if (e.target === resumeModal) closeResume();
  });

  // ---- Theme (day/night) ---------------------------------------------------

  let nightMode = false;
  themeToggle.addEventListener("click", function () {
    nightMode = !nightMode;
    themeToggle.setAttribute("aria-pressed", String(nightMode));
    themeToggle.textContent = nightMode ? "Day Mode" : "Night Mode";
    if (window.setPortfolioTheme) window.setPortfolioTheme(nightMode ? "night" : "day");
  });

  // ---- Panel expand ---------------------------------------------------------

  let panelExpanded = false;
  panelExpand.addEventListener("click", function () {
    panelExpanded = !panelExpanded;
    panel.classList.toggle("expanded", panelExpanded);
    panelExpand.setAttribute("aria-pressed", String(panelExpanded));
    panelExpand.title = panelExpanded ? "Collapse" : "Expand";
  });

  // ---- Text fallback --------------------------------------------------------

  function buildTextFallback() {
    const backBtnHtml = '<button type="button" id="tf-back-btn">&larr; Back to the 3D bench</button>';

    const all = PORTFOLIO_DATA.nodes;
    textFallback.innerHTML = backBtnHtml + all.map(function (n) {
      const statsHtml = (n.stats || []).map(function (s) {
        return '<div class="stat"><div class="stat-value">' + formatStatValue(s, s.value) +
          '</div><div class="stat-label">' + s.label + "</div></div>";
      }).join("");
      const galleryHtml = (n.gallery || []).map(function (p) {
        return '<figure class="tf-photo"><img src="' + p.src + '" alt="' + (p.alt || p.caption || "") + '" loading="lazy">' +
          (p.caption ? "<figcaption>" + p.caption + "</figcaption>" : "") + "</figure>";
      }).join("");
      const bodyHtml = n.body.replace(
        /<div class="model-viewer"[\s\S]*?<\/div>/,
        '<p class="tf-model-note">A 360\u00b0 model of this part is viewable in the 3D version of this page.</p>'
      );
      return (
        '<article class="tf-item">' +
          '<p class="tf-kicker">' + n.kicker + "</p>" +
          "<h2>" + n.title + "</h2>" +
          '<p class="tf-meta">' + n.meta + "</p>" +
          (statsHtml ? '<div class="panel-stats">' + statsHtml + "</div>" : "") +
          (galleryHtml ? '<div class="tf-gallery">' + galleryHtml + "</div>" : "") +
          "<div>" + bodyHtml + "</div>" +
          '<div class="panel-tags">' +
            (n.tags || []).map(function (t) { return '<span class="tag">' + t + "</span>"; }).join("") +
          "</div>" +
        "</article>"
      );
    }).join("");

    const contact = document.createElement("article");
    contact.className = "tf-item";
    contact.innerHTML =
      '<p class="tf-kicker">CONTACT</p><h2>Let\u2019s talk</h2>' +
      '<ul class="contact-list">' +
      '<li><span>Email</span><a href="mailto:jordanbanh@cmail.carleton.ca">jordanbanh@cmail.carleton.ca</a></li>' +
      '<li><span>LinkedIn</span><a href="https://www.linkedin.com/in/jordan-banh/" target="_blank" rel="noopener">linkedin.com/in/jordan-banh</a></li>' +
      '<li><span>Phone</span><a href="tel:+16137167146">+1 (613) 716-7146</a></li>' +
      '<li><span>Resume</span><a href="' + RESUME_PATH + '" target="_blank" rel="noopener">Download PDF</a></li>' +
      "</ul>";
    textFallback.appendChild(contact);
  }
  buildTextFallback();

  textFallback.addEventListener("click", function (e) {
    if (e.target && e.target.id === "tf-back-btn") {
      inTextMode = false;
      toggleTextMode(false);
    }
  });

  function toggleTextMode(showText) {
    textFallback.hidden = !showText;
    sceneContainer.style.display = showText ? "none" : "";
    hudTop.style.display = showText ? "none" : "";
    legend.style.display = showText ? "none" : "";
    panel.classList.remove("open");
    panelBackdrop.classList.remove("open");
    if (window.disposeModelViewers) window.disposeModelViewers();
    textToggle.textContent = showText ? "View as 3D" : "View as text";
  }

  function forceTextMode() {
    forcedTextMode = true;
    toggleTextMode(true);
    textToggle.hidden = true; // no 3D scene to switch back to
    const backBtn = document.getElementById("tf-back-btn");
    if (backBtn) backBtn.hidden = true;
  }

  let inTextMode = false;
  textToggle.addEventListener("click", function () {
    inTextMode = !inTextMode;
    toggleTextMode(inTextMode);
  });
})();
