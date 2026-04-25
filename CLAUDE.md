# CLAUDE.md — Healthcare AI Navigator (Hackathon Build)

## Project Overview

**Name:** MedGuide (working title — healthcare AI screen companion)
**Hackathon:** Built with Opus 4.7 — Cerebral Valley x Anthropic
**Deadline:** April 26, 2026
**Builder:** Arinze Okemuo — 5th year UCL medical student
**Submission:** Demo video (2 min max)

## The Problem (Founder Story)

I ruptured my patellar tendon and spent months bedbound. I tried to use that time productively — do ophthalmology research remotely. But I couldn't navigate the university research systems without someone physically showing me where to click. No one was available. The opportunity passed.

When I returned to clinical placement, I watched the same problem repeat daily. Junior doctors rotate every few months onto new wards with new software. They waste hours trying to figure out: how do I request a scan? Where do I refer this patient? What form do I fill in? The medical knowledge isn't the bottleneck — navigating the SYSTEM is.

Every NHS trust uses different clinical software (EPIC, Cerner, SystmOne, EMIS). Every rotation is like starting a new job with no onboarding.

## The Solution

An AI-powered clinical companion that SEES your screen and GUIDES you through healthcare systems in real time. Inspired by Clicky (Farza Majeed's viral AI cursor companion), but purpose-built for healthcare workflows.

The user shares their screen or uploads a screenshot. The AI:
1. Recognises what clinical system/interface they're looking at
2. Understands their question in clinical context
3. Provides step-by-step guidance with visual annotations pointing to exact UI elements
4. References relevant NICE guidelines, clinical pathways, or protocols when appropriate

## Core Philosophy

"Google Maps for clinical workflows. It doesn't teach you medicine — it tells you how to navigate the system."

## Tech Stack

- **Frontend:** Next.js 14+ with App Router, Tailwind CSS
- **AI:** Anthropic Claude API (Opus 4.7) with vision capabilities
- **Voice (stretch):** Web Speech API for voice input (browser-native, no external dependency)
- **Deployment:** Vercel
- **No database needed** — stateless for hackathon MVP

## Architecture

```
User Screen/Screenshot
        ↓
   Browser captures screen (via Screen Capture API)
   OR user uploads/pastes screenshot
        ↓
   Image sent to Claude Vision API with healthcare system prompt
        ↓
   Claude returns:
     - Natural language guidance
     - Coordinates/descriptions of UI elements to interact with
     - Relevant clinical context (NICE guidelines, pathways)
        ↓
   Frontend renders:
     - Step-by-step instructions
     - Visual overlay/annotations on the screenshot
     - (Stretch) Voice readback of instructions
```

## System Prompt (for Claude API calls)

```
You are MedGuide, an AI clinical navigation assistant built by a medical student for doctors, medical students, and healthcare professionals.

You can SEE the user's screen. Your job is NOT to provide medical knowledge (UpToDate and textbooks do that). Your job is to help users NAVIGATE healthcare systems, clinical software, research platforms, and administrative workflows.

When you see a screenshot, you should:
1. Identify what system/interface the user is looking at (e.g., EPIC, EMIS, a research database, a NICE guidelines page, a clinical trial registry)
2. Understand their question in clinical context
3. Provide clear, numbered step-by-step guidance
4. Reference specific UI elements by their visual position (e.g., "Click the blue button labelled 'Order' in the top-right corner")
5. If relevant, cite NICE guidelines, BNF entries, or clinical pathways that apply

You should be:
- Concise and action-oriented (doctors are busy)
- Specific about UI elements (describe exactly what to click and where)
- Clinically aware (understand medical terminology and context)
- Honest when you can't identify a specific system

You should NOT:
- Provide medical diagnoses or treatment decisions
- Access or request any patient data
- Guess at system-specific workflows you can't see evidence for

Always end complex guidance with: "Would you like me to walk you through the next step?"
```

## Features (Priority Order)

### P0 — Must Have for Demo (Days 1-2)
1. **Screenshot upload** — user drags/drops or pastes a screenshot
2. **Chat interface** — user types a question about what they see
3. **AI vision response** — Claude analyses the screenshot and provides step-by-step clinical navigation guidance
4. **Visual annotations** — overlay arrows/highlights on the screenshot showing where to click
5. **Conversation history** — follow-up questions within same session

### P1 — Should Have for Demo (Day 3)
6. **Live screen capture** — browser Screen Capture API to grab the current screen without manual screenshot
7. **Preset clinical scenarios** — one-click demo buttons:
   - "How do I request an urgent CT Head?"
   - "Walk me through a discharge summary"
   - "Find clinical trials for my patient's condition"
   - "What's the NICE pathway for suspected PE?"
8. **NICE guidelines context** — pre-loaded knowledge of key NICE pathways that Claude can reference
9. **Mobile-responsive** — works on phone (doctor on the ward with their phone)

### P2 — Stretch Goals (Day 4, only if time)
10. **Voice input** — ask questions by speaking (Web Speech API)
11. **Voice output** — responses read aloud (Speech Synthesis API)
12. **Screen recording mode** — continuously capture and guide through multi-step workflows
13. **Export guidance** — save the step-by-step instructions as a PDF/markdown for future reference

## Page Structure

### Single Page Application
```
/  — Main app page
   ├── Header: Logo, tagline "Navigate any clinical system with AI"
   ├── Main area (split view):
   │   ├── Left panel: Screenshot display with annotation overlay
   │   └── Right panel: Chat interface
   ├── Bottom: Preset scenario buttons
   └── Footer: "Built by a UCL medical student for the Anthropic Hackathon"
```

## UI Design Direction

- **Clean, clinical aesthetic** — white background, subtle blue accents (#1a73e8), professional
- **NOT gamified or playful** — this is a clinical tool, should feel trustworthy
- **Font:** Inter or system font stack
- **Inspiration:** UpToDate's clarity, Notion's cleanliness, Linear's polish
- **Dark mode NOT needed** — clinical environments use light screens
- **Key colours:**
  - Primary: #1a73e8 (clinical blue)
  - Accent: #0d9488 (teal, for annotations/highlights)
  - Background: #ffffff
  - Text: #1a1a1a
  - Subtle: #f3f4f6 (panel backgrounds)

## Visual Annotation System

When Claude identifies UI elements to interact with, it returns coordinate descriptions. The frontend should render:

1. **Numbered circles** — placed on the screenshot at approximately described locations
2. **Connecting lines** — from each numbered circle to the corresponding instruction
3. **Highlight boxes** — semi-transparent coloured overlay on the target area
4. **Arrow pointers** — pointing to specific buttons or fields

For the hackathon, annotations can be approximate (based on Claude's description of position like "top-right corner" or "third item in the left sidebar") rather than pixel-perfect.

Implementation approach:
- Claude returns structured JSON with step descriptions and approximate positions
- Frontend maps positions to percentage-based coordinates on the image
- Canvas or absolute-positioned div overlays render the annotations

Example Claude response format:
```json
{
  "steps": [
    {
      "number": 1,
      "instruction": "Click on the 'Orders' tab in the top navigation bar",
      "position": { "x": 35, "y": 5 },
      "ui_element": "Orders tab",
      "annotation_type": "circle"
    },
    {
      "number": 2,
      "instruction": "Select 'Imaging' from the dropdown menu",
      "position": { "x": 35, "y": 15 },
      "ui_element": "Imaging option",
      "annotation_type": "highlight"
    }
  ],
  "context": "To request a CT Head, you'll need to go through the imaging orders workflow. Based on NICE Head Injury guidelines (CG176), CT should be performed within 1 hour if any red flag features are present.",
  "follow_up": "Would you like me to walk you through filling in the CT request form next?"
}
```

## Demo Scenarios (for video recording)

### Scenario 1: Requesting an Urgent CT Head
- Screenshot: Mock clinical ordering interface
- Question: "I have a patient with a head injury, how do I request an urgent CT?"
- MedGuide: Identifies the ordering system, walks through the steps, references NICE CG176 head injury guidelines

### Scenario 2: Finding Clinical Trials
- Screenshot: ClinicalTrials.gov or NIHR research page
- Question: "My patient has advanced endometrial cancer, are there any trials they could join?"
- MedGuide: Navigates the trial registry, explains eligibility criteria in plain English

### Scenario 3: Discharge Summary
- Screenshot: Mock EHR discharge template
- Question: "Walk me through writing a discharge summary for this patient"
- MedGuide: Points to each field, explains what goes where, references best practice

### Scenario 4: NICE Guidelines Navigation
- Screenshot: NICE website showing a clinical pathway
- Question: "What's the pathway for suspected PE?"
- MedGuide: Walks through the NICE PE pathway step by step, highlighting decision points

## Mock Screenshots Needed

Since we can't use real NHS systems (data protection), create clean mock interfaces that look realistic:
1. A mock clinical ordering screen (inspired by EPIC/Cerner layout)
2. ClinicalTrials.gov actual public interface (this IS public, safe to use)
3. NICE guidelines actual public pages (public, safe to use)
4. A mock discharge summary template

Use public websites (NICE, BNF, ClinicalTrials.gov) for at least 2 of the 4 demo scenarios — these are real, publicly accessible, and demonstrate genuine utility.

## Data Protection Rules

- **NO real patient data** — ever, anywhere, not even in demos
- **NO real NHS system screenshots** — use mocks or public websites only
- **NO stored user data** — stateless application, nothing persisted
- **All clinical knowledge from public sources** — NICE, BNF, published guidelines
- **Disclaimer in UI:** "MedGuide provides navigation assistance only. It does not provide medical advice. Always follow your trust's local policies and clinical judgment."

## Demo Video Script (2 minutes)

```
[0:00-0:20] HOOK — Personal story
"Six months ago I ruptured my patellar tendon. While I was bedbound recovering,
I tried to do research remotely. But I couldn't navigate the university systems
without someone showing me where to click. When I got back to the ward, I
watched every junior doctor face the same problem — not with research, but
with clinical software. Every rotation. Every trust. Starting from zero."

[0:20-0:35] PROBLEM
"The NHS runs on a patchwork of clinical systems. Junior doctors rotate every
few months. The medical knowledge isn't the bottleneck — navigating the SYSTEM
is. And there's no onboarding."

[0:35-1:00] SOLUTION
"MedGuide is an AI companion that sees your screen and guides you through any
clinical system in real time. Built with Claude's vision capabilities."

[1:00-1:45] LIVE DEMO
- Show Scenario 1: CT Head ordering (30 seconds)
- Show Scenario 2: Clinical trial search (15 seconds)
Quick cuts, clean, showing the annotations and guidance in action.

[1:45-2:00] CLOSE
"Built in 4 days by a final-year UCL medical student. Because no doctor should
feel lost in the system when a patient is waiting."
```

## Development Sequence

### Day 1 (Today): Foundation
- [ ] Initialize Next.js project with Tailwind
- [ ] Build the main layout (split screen: image left, chat right)
- [ ] Implement screenshot upload (drag-drop + paste)
- [ ] Connect Claude API with vision — send image + text, get response
- [ ] Display AI responses in chat format
- [ ] Test with a screenshot of NICE guidelines website

### Day 2: Annotations + Polish
- [ ] Implement visual annotation overlay system on screenshots
- [ ] Parse Claude's structured position responses into visual markers
- [ ] Add numbered step indicators on the screenshot
- [ ] Add preset scenario buttons
- [ ] Style the full interface — clean, clinical, professional
- [ ] Test with all 4 demo scenarios

### Day 3: Enhancement + Content
- [ ] Create mock clinical interface screenshots for demo
- [ ] Add live screen capture (Screen Capture API) if feasible
- [ ] Load NICE guidelines context for key pathways (PE, ACS, head injury, sepsis)
- [ ] Add the disclaimer and about section
- [ ] Mobile responsive pass
- [ ] Full end-to-end testing of all demo flows

### Day 4: Demo Video + Submit
- [ ] Record all demo scenarios
- [ ] Record personal story intro (film yourself, keep it authentic)
- [ ] Edit video (CapCut or similar — 2 min max)
- [ ] Deploy final version to Vercel
- [ ] Submit to hackathon
- [ ] Post on X/LinkedIn for visibility

## Environment Variables

```
ANTHROPIC_API_KEY=xxx  (use hackathon $500 credits)
```

## Key Commands

```bash
# Initialize
npx create-next-app@latest medguide --typescript --tailwind --app --src-dir

# Install dependencies
npm install ai @anthropic-ai/sdk

# Run dev server
npm run dev

# Deploy
vercel --prod
```

## Success Metrics (for judges)

1. **Real problem** — judges should FEEL the pain point (personal story)
2. **Working demo** — not a slide deck, a real tool that works live
3. **Domain expertise** — a medical student built this, not a generic developer
4. **Claude vision used well** — the screenshot analysis should feel magical
5. **Potential impact** — 70,000+ junior doctors in the UK rotate every 4-6 months. Each one could use this.

## What Makes This Win

- PostVisit (3rd place last time) was built by a cardiologist solving a healthcare problem
- The lawyer who won 1st place "didn't write a single line of code"
- The judges reward REAL problems solved by DOMAIN EXPERTS
- You ARE the user. You lived the problem. That's unjudgeable.
