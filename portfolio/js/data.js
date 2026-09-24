/* Content for the portfolio bench. Edit this file to update text —
   no need to touch scene.js or ui.js for content changes.

   Three totems total, evenly spaced around the decorative hub. Each node
   needs:
     id          unique, used everywhere (nav buttons, game tracking)
     engraving   short text carved into the totem's plaque (keep it SHORT —
                 it's stone, not a billboard)
     color       accent hex for the totem's capstone gem
     kicker / title / meta / body (HTML) / tags — the info-panel content
     stats       optional array of {value, decimals, prefix, suffix, label}
                 rendered as animated count-up numbers at the top of the panel */

const PORTFOLIO_DATA = {

  nodes: [
    {
      id: "about",
      engraving: "ABOUT ME",
      markerType: "face",
      color: 0x33d9c7,
      kicker: "ABOUT",
      title: "Jordan Banh",
      meta: "Biomedical &amp; Mechanical Engineering · Carleton University",
      stats: [
        { value: 4, label: "Current co-op work term" },
        { value: 2, label: "Engineering disciplines combined" }
      ],
      gallery: [
        { src: "images/about-1.jpg", caption: "Profile photo" },
        { src: "images/about-2.png", caption: "Deep Cove, British Columbia", alt: "Hiking at Deep Cove!" }
      ],
      body: `
        <p>I'm a Biomedical and Mechanical Engineering co-op student at Carleton University,
        currently on my fourth work term in maintenance and reliability engineering at
        CertainTeed Insulation Canada, a Saint-Gobain company, in Ottawa.</p>
        <p>I treat my engineering degree as a strategic foundation rather than a fixed identity.
        Most of what's on this bench is plant reliability and mechanical design — but I'm just
        as interested in where that meets biomedical and character-driven robotics, which is
        why a small robot owl (very much still a work in progress) has a spot here too.</p>
      `,
      tags: ["Reliability Engineering", "WCM", "CAD", "Biomedical Engineering"]
    },
    {
      id: "work-experience",
      engraving: "WORK EXP",
      markerType: "heart",
      color: 0xe8862b,
      kicker: "WORK EXPERIENCE",
      title: "Maintenance Engineering Co-op",
      meta: "CertainTeed Insulation Canada (Saint-Gobain) · Ottawa, ON · 4th work term",
      stats: [
        { value: 313, label: "Drawing folders cross-referenced" },
        { value: 29, suffix: "k+", label: "Maintenance orders processed" },
        { value: 2.5, decimals: 1, suffix: "k+", label: "Legacy parts reconciled" }
      ],
      body: `
        <p>Reporting to Shubhank Sondhiya, I work across reliability engineering, World Class
        Manufacturing (WCM) projects, industrial automation, equipment diagnostics, and
        maintenance documentation at CertainTeed's Ottawa insulation plant.</p>

        <p><strong>WCM &amp; documentation.</strong> Delivered a WCM Yellow Belt "Understand
        the Machine" project on the Strapper lines — a 23-tab workbook covering the
        lubrication map, spare parts list, risk assessments, and an OPL library. Built a
        Python OCR pipeline (OpenCV preprocessing, homography alignment, consensus OCR) to
        replace manual fault-count entry from the strapper's HMI, feeding an openpyxl
        dashboard with KPI and Pareto charts.</p>

        <p><strong>Reliability &amp; diagnostics.</strong> Diagnosed a down Atlas Copco ZT160
        compressor with an intermittent star-delta contactor fault, planned SCADA integration
        for a TURBO-AIR 2000 compressor's Maestro controller, selected an IO-Link flow meter
        for a 6-inch air line, and traced a condensation problem on a Micronaire line.</p>

        <p><strong>Safety SOPs.</strong> Rebuilt the forehearth electrode and bushing
        replacement procedures from two unofficial 2012–2013 SOPs, restructured to
        Saint-Gobain's Isover specification with flagged LOTO review notes for mechanic and
        electrician sign-off.</p>

        <p><strong>Data systems.</strong> Cross-referenced 313 legacy drawing folders against
        SAP's functional location hierarchy to validate active parts, and automated a manual
        parts-rationalization review with a Python tool working through ~2,500 parts and
        ~29,000 maintenance orders.</p>
      `,
      tags: ["Reliability Engineering", "WCM", "SolidWorks", "Python", "SAP", "SCADA", "Excel VBA"]
    },
    {
      id: "projects",
      engraving: "PROJECTS",
      markerType: "hand",
      color: 0x9b6bd1,
      kicker: "PROJECTS",
      title: "Mechanical Design &amp; Fabrication",
      meta: "Mechanical design, from CertainTeed and beyond",
      stats: [
        { value: 10.5, decimals: 1, suffix: "×", label: "Peak stress reduction, chopper frame" },
        { value: 8, label: "Fiberizer nozzles retrofitted per unit" },
        { value: 24, suffix: "hr", label: "Hed-1 design-challenge window" }
      ],
      gallery: [
        { src: "images/chopper-frame-before.jpg", caption: "Before: original frame", alt: "The original chopper frame installed in the plant" },
        { src: "images/chopper-frame-after.jpg", caption: "After: redesigned frame", alt: "The redesigned chopper frame — four support posts and added top-frame trusses — fabricated and ready for install" }
      ],
      body: `
        <div class="sub-project">
          <p class="sub-project-label">Chopper Frame Redesign</p>
          <p>Redesigned a chopper frame at CertainTeed to cut peak stress by roughly
          6.5–10.5&times; under load. The new design adds four support posts in place of the
          original's fewer legs and works in additional trusses across the top frame to
          spread the load more evenly — the kind of work that lives between a CAD model and a
          stress calculation. Stress analysis was a group effort with peers on the FEA side;
          this shows the before-and-after of the physical rebuild.</p>
        </div>
        <div class="sub-project">
          <p class="sub-project-label">Burner Bushing Wall &amp; Nozzle</p>
          <p>Modeled and fabricated a burner bushing wall and nozzle for CertainTeed's
          fiberizers — the units that turn molten glass into fiber. Eight of these nozzles sit
          on each unit, and frequent breakdowns were eating up a lot of maintenance labor
          hours. My fix was to pre-weld the components and design them for a fast retrofit
          onto the wall, instead of rebuilding them in place, cutting repair time
          significantly.</p>
          <div class="model-viewer" data-model-key="burner-bushing-wall" data-model="models/burner-bushing-wall.stl"
               role="img" aria-label="Interactive 360-degree viewer of the burner bushing wall and nozzle CAD model — drag to rotate, scroll to zoom">
            <span class="model-viewer-hint">drag to rotate</span>
          </div>
        </div>
        <div class="sub-project">
          <p class="sub-project-label">Hed-1: A Robot Alarm Clock <span class="wip-badge">WIP</span></p>
          <p>My entry to Human Computer Lab's Mech Challenge: design a robot alarm clock with
          at least one degree of freedom, in 24 hours. Hed-1 is an owl (a nod to Hedwig) that
          wakes you with a four-bar linkage coupling head rise and pitch, plus a servo neck
          for head pan. Still very much in progress — CAD, FEA, and GD&amp;T are underway.</p>
        </div>
      `,
      tags: ["SolidWorks", "FEA", "Stress Analysis", "GD&T", "Fabrication", "Four-Bar Linkage"]
    }
  ]
};
