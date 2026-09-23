# ABLE — concept redesign

A scroll-directed 3D site for the ABLE Exoskeleton, built around one idea: **the product is motion, so the site should move.**

## Open it
- **Quickest:** double-click `ABLE-standalone.html` (needs internet for three.js, Lenis and the fonts from their CDNs).
- **Editing:** `python3 -m http.server 8931` in this folder, then open http://localhost:8931. After editing, run `python3 build.py` to regenerate the standalone file.

## Files
- `index.html`: page structure and all copy
- `css/style.css`: design system (Instrument Serif / Geist / Geist Mono, signal orange `#ff5b1f`)
- `js/main.js`: gait model, 3D figure and exoskeleton, Marey ghosts, globe, scroll director
- `js/land.js`: 1° world land mask for the dotted globe

## The chapters
1. **Hero**: a live chronophotograph (after Étienne-Jules Marey, 1882). A procedural user walks in the exoskeleton with crutches, trailed by stick-figure "exposures" of earlier moments in the stride. The ground scrolls at exactly the stance foot's speed, so nothing skates.
2. **Why it matters**: the emotional line, revealed word by word as you scroll.
3. **Anatomy of a step**: a side-on gait lab where scrolling walks one gait cycle through its 8 phases. Live knee/hip angle arcs, a synced knee/hip chart and a scrubber.
4. **The device**: an orbiting x-ray exploded view with leader-line callouts. Spec strip: 9.8 kg, 150–190 cm, ≤100 kg, C5–L5, <7 min.
5. **A stride over time**: sessions 1→12. The stride and cadence open up while footprints accumulate and the published outcome multipliers count up.
6. **For clinics**: the six procurement questions (CE, evidence, throughput, reimbursement, staff, references), including a live throughput calculator.
7. **Network**: dotted globe with pins and arcs from Barcelona.
8. **Impact + CTA**: 200+ people, 1,000,000+ steps, and a demo booking.

## Sources for the facts used
- ablehumanmotion.com/en (200+ people, 1M+ steps, <6 min donning claim, countries, contact)
- Wright M.A. et al., *J NeuroEng Rehabil* 20:45 (2023), PMC10091314: n=24, Institut Guttmann + Heidelberg, 9.8 kg, 150–190 cm, ≤100 kg, fitting 6:50 ± 2:50, ×2.6 walking time, ×3.0 steps, ×2.1 10MWT, ×1.9 6MWT, QUEST 31.7/40 (patients) and 31.6/40 (11 therapists)
- CE 2797 under MDR 2017/745, April 2024; indication SCI C5–L5, elbow extensors ≥4/5 (company announcement and Exoskeleton Report)
- *J NeuroEng Rehabil* 2024 (PMC11464447); *Disability & Rehabilitation* 47(23) 2025; ClinicalTrials.gov NCT04876794, NCT05590065, NCT05643313, NCT07062575

## Needs ABLE's input before this goes live
Click **"Show content gaps"** in the footer to highlight these on the page.
- Reimbursement codes and payer precedents per market (Q4)
- Staff onboarding format and length (Q5)
- Named reference sites in the Netherlands and the UK (Network)
- Clinical dossier PDF link (CTA)
- Device-behaviour lines in the gait-phase descriptions (e.g. what the knee motor does in each phase) need clinical/regulatory sign-off
- The gait kinematics are a typical illustrative pattern, not recorded ABLE data. Swapping in real joint-angle recordings would make the gait lab literal.
- The figure and exoskeleton are procedural stand-ins. A real CAD/GLB of the device would drop into the same bone rig.
