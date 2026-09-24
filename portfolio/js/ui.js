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
  const RESUME_PATH = "resume/Resume_Jordan_Banh_Mechanical_Design_Engineering_2026-09.pdf";
  const themeToggle = document.getElementById("theme-toggle");

  const textToggle = document.getElementById("text-toggle");
  const textFallback = document.getElementById("text-fallback");
  const sceneContainer = document.getElementById("scene-container");
  const hudTop = document.getElementById("hud-top");
  const legend = document.getElementById("legend");

  const progressDots = document.querySelectorAll(".progress-dot");
  const progressCount = document.querySelector(".progress-count");
  const toastContainer = document.getElementById("toast-container");

  let benchReady = false;
  let forcedTextMode = false;

  // ---- Exploration game: progress tracking, unlock toasts, completion ----
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
    // The hub sculpture mirrors the tracker: one gear arc lights per
    // section, and the whole assembly winds up as the count rises.
    if (window.setHubProgress) window.setHubProgress(explored.size, SECTIONS.length);
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

  // ---- Completion sequence -------------------------------------------------
  // Three beats, fired once all three sections have been opened:
  //   1. the hub powers up and a shockwave lights each monolith (scene.js)
  //   2. the drawing annotates itself — dimension callouts pinned to the
  //      monoliths in screen space, drawn on like the intro's linework
  //   3. the sheet hands over the contact block
  //
  // This replaces the old confetti, which was gold squares falling through a
  // monochrome drafting site — generic, and belonging to nothing else here.

  const dimensionLayer = document.getElementById("dimension-layer");
  const completeCard = document.getElementById("complete-card");
  const completeClose = document.getElementById("complete-close");

  const SVG_NS = "http://www.w3.org/2000/svg";
  let dimParts = null;       // built once, then repositioned each frame
  let dimRaf = 0;
  let dimVisible = false;

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // One callout per monolith: a dot on the subject, a leader elbowing out to
  // the side, and the label sitting on a short shelf — standard drafting
  // annotation, which is why it reads as belonging here.
  function buildDimensions() {
    if (dimParts) return dimParts;
    dimensionLayer.innerHTML = "";
    const callouts = SECTIONS.map(function (id, i) {
      const g = svgEl("g", { class: "dim-callout", "data-id": id });
      const dot = svgEl("circle", { class: "dim-dot", r: 3 });
      const leader = svgEl("path", { class: "dim-line dim-leader" });
      const shelf = svgEl("path", { class: "dim-line dim-shelf" });
      const num = svgEl("text", { class: "dim-num" });
      const label = svgEl("text", { class: "dim-label" });
      num.textContent = "0" + (i + 1);
      // The placard engraving, not the achievement phrasing — a callout
      // labelled "MET JORDAN" reads as a badge, whereas "ABOUT ME" reads as
      // an annotation on a drawing, which is the whole point of this beat.
      const node = PORTFOLIO_DATA.nodes.filter(function (n) { return n.id === id; })[0];
      label.textContent = ((node && node.engraving) || id).toUpperCase();
      g.appendChild(leader); g.appendChild(shelf);
      g.appendChild(dot); g.appendChild(num); g.appendChild(label);
      g.style.animationDelay = (0.12 + i * 0.16) + "s";
      dimensionLayer.appendChild(g);
      return { g: g, dot: dot, leader: leader, shelf: shelf, num: num, label: label, id: id };
    });

    // Overall extent run across the island, with the usual terminator ticks.
    const extent = svgEl("g", { class: "dim-callout dim-extent" });
    const run = svgEl("path", { class: "dim-line" });
    const ticks = svgEl("path", { class: "dim-line" });
    const extentLabel = svgEl("text", { class: "dim-label dim-extent-label" });
    extentLabel.textContent = "OVERALL — 3 OF 3 SECTIONS";
    extent.appendChild(run); extent.appendChild(ticks); extent.appendChild(extentLabel);
    extent.style.animationDelay = "0.66s";
    dimensionLayer.appendChild(extent);

    dimParts = { callouts: callouts, extent: { g: extent, run: run, ticks: ticks, label: extentLabel } };
    return dimParts;
  }

  function positionDimensions() {
    if (!dimVisible) return;
    const anchors = window.getBenchAnchors && window.getBenchAnchors();
    if (!anchors) return;
    const parts = dimParts;
    const w = window.innerWidth;

    parts.callouts.forEach(function (c) {
      const a = anchors.nodes.filter(function (n) { return n.id === c.id; })[0];
      if (!a || !a.visible) { c.g.style.opacity = "0"; return; }
      c.g.style.opacity = "";

      // Elbow away from whichever side of the frame the subject sits on, so
      // labels never run off screen or collide with the centre of the view.
      const toLeft = a.x > w * 0.5;
      const dir = toLeft ? -1 : 1;
      const elbowX = a.x + dir * 54;
      const elbowY = a.y - 40;
      const shelfEnd = elbowX + dir * 92;

      c.dot.setAttribute("cx", a.x);
      c.dot.setAttribute("cy", a.y);
      c.leader.setAttribute("d", "M" + a.x + " " + a.y + " L" + elbowX + " " + elbowY);
      c.shelf.setAttribute("d", "M" + elbowX + " " + elbowY + " L" + shelfEnd + " " + elbowY);

      const textX = toLeft ? shelfEnd + 6 : shelfEnd - 6;
      const anchor = toLeft ? "start" : "end";
      c.label.setAttribute("x", textX);
      c.label.setAttribute("y", elbowY - 7);
      c.label.setAttribute("text-anchor", anchor);
      c.num.setAttribute("x", toLeft ? elbowX + 6 : elbowX - 6);
      c.num.setAttribute("y", elbowY - 7);
      c.num.setAttribute("text-anchor", toLeft ? "start" : "end");
    });

    const L = anchors.left, R = anchors.right, ex = parts.extent;
    if (L && R && L.visible && R.visible) {
      ex.g.style.opacity = "";
      const y = Math.max(L.y, R.y) + 46;
      ex.run.setAttribute("d", "M" + L.x + " " + y + " L" + R.x + " " + y);
      ex.ticks.setAttribute("d",
        "M" + L.x + " " + (y - 7) + " v14 M" + R.x + " " + (y - 7) + " v14");
      ex.label.setAttribute("x", (L.x + R.x) / 2);
      ex.label.setAttribute("y", y - 10);
      ex.label.setAttribute("text-anchor", "middle");
    } else {
      ex.g.style.opacity = "0";
    }
  }

  function dimensionFrame() {
    positionDimensions();
    if (dimVisible) dimRaf = requestAnimationFrame(dimensionFrame);
  }

  function showDimensions() {
    buildDimensions();
    dimVisible = true;
    dimensionLayer.classList.add("visible");
    positionDimensions();
    cancelAnimationFrame(dimRaf);
    dimRaf = requestAnimationFrame(dimensionFrame);
  }

  function hideDimensions() {
    dimVisible = false;
    cancelAnimationFrame(dimRaf);
    dimensionLayer.classList.remove("visible");
  }

  function showCompleteCard() {
    // Pull the contact details from the existing modal rather than repeating
    // them in the markup — one place to edit an email address.
    const slot = completeCard.querySelector(".cc-slot");
    if (slot && !slot.childElementCount) {
      const list = document.querySelector("#contact-modal .contact-list");
      if (list) slot.appendChild(list.cloneNode(true));
    }
    completeCard.hidden = false;
    // Force a reflow so the transition has a start state to animate from.
    // requestAnimationFrame would be the usual idiom, but it never fires in
    // a backgrounded or occluded tab — which would leave the card unhidden
    // and permanently at opacity 0. This is synchronous either way.
    void completeCard.offsetWidth;
    completeCard.classList.add("open");
  }

  function hideCompleteCard() {
    completeCard.classList.remove("open");
    hideDimensions();
    setTimeout(function () { completeCard.hidden = true; }, 420);
  }

  if (completeClose) completeClose.addEventListener("click", hideCompleteCard);

  function runCompletionSequence() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // No shockwave and no draw-on: the annotated drawing and the contact
      // block are the payoff, and both are perfectly legible static.
      showDimensions();
      showCompleteCard();
      return;
    }
    // Beat 1 fires from updateProgressUI -> setHubProgress in scene.js.
    setTimeout(showDimensions, 900);
    setTimeout(showCompleteCard, 2600);
  }

  function markExplored(id) {
    if (SECTIONS.indexOf(id) === -1 || explored.has(id)) return;
    explored.add(id);
    updateProgressUI();
    showToast("Unlocked: " + (ACHIEVEMENT_LABELS[id] || id));
    if (explored.size === SECTIONS.length) {
      setTimeout(runCompletionSequence, 400);
    }
  }

  // ---- Loading / intro -------------------------------------------------

  function hideLoading() {
    loadingScreen.classList.add("hidden");
  }

  // While the blueprint intro plays, the HUD stays out of the way so the
  // sheet is the only thing on screen. Set from JS, not markup, so a failed
  // script can never leave the navigation permanently hidden.
  document.body.classList.add("intro-playing");

  function endIntro() {
    introScreen.classList.add("hidden");
    document.body.classList.remove("intro-playing");
  }

  document.addEventListener("bench-ready", function () {
    benchReady = true;
    hideLoading();
    applyInitialHash();
  });

  // Fired by scene.js when the scene has finished rendering itself in.
  document.addEventListener("bench-intro-done", endIntro);

  document.addEventListener("bench-unavailable", function () {
    hideLoading();
    forceTextMode();
    endIntro();
  });

  function skipIntro() {
    if (window.skipBenchIntro) window.skipBenchIntro();
    endIntro();
  }

  function applyInitialHash() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    if (hash === "contact") {
      skipIntro();
      contactModal.classList.add("open");
      return;
    }
    if (hash === "resume") {
      skipIntro();
      openResume();
      return;
    }
    const match = PORTFOLIO_DATA.nodes.some(function (n) { return n.id === hash; });
    if (match) {
      skipIntro();
      window.selectPortfolioNode(hash);
    }
  }

  // Fallback in case neither event fires quickly (slow script load etc.)
  window.addEventListener("load", function () {
    setTimeout(hideLoading, 1200);
    // Backstop: if the scene never reports the intro finished (script error,
    // no WebGL), the sheet must not sit there forever.
    setTimeout(function () {
      if (!introScreen.classList.contains("hidden")) skipIntro();
    }, 7000);
  });

  enterBtn.addEventListener("click", skipIntro);

  enterTextBtn.addEventListener("click", function () {
    skipIntro();
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
    // Only the label swaps — writing textContent on the button itself would
    // destroy the number slot and the sun/moon mark inside it.
    const label = themeToggle.querySelector(".nav-label");
    if (label) label.textContent = nightMode ? "Day Mode" : "Night Mode";
    else themeToggle.textContent = nightMode ? "Day Mode" : "Night Mode";
    // Drives the HUD's own palette. The chrome sits directly on the scene
    // with no panel behind it, so it has to invert with the world or it
    // becomes dark-on-dark.
    document.body.classList.toggle("night", nightMode);
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
