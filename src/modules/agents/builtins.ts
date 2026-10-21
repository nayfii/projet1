import type { Department, FieldType, MemoryScope, OutputFormat, ToolCapability } from "./definitions";

/**
 * The launch agents (CLAUDE.md §4.7), defined in code and kept in sync with the `agents` table
 * (`server/builtin-sync.ts`). Labels, options and notices are translated (messages: tools.launch.<key>);
 * the English labels below are stored in the database as a fallback. Instructions are written for the
 * model in English; the model answers in the person's language.
 * Motion Design and Video Editor (marketing) write a composition or an edit plan that the render worker
 * turns into MP4 files (Step 8, src/modules/render).
 */

export type BuiltinField = {
  key: string;
  type: FieldType;
  required: boolean;
  /** Fallback label (English). */
  label: string;
  /** Option keys for "select" fields (translated in tools.launch.<agent>.options.<field>.<option>). */
  options?: string[];
};

/** Shown on the agent's page and in its conversations. */
export type AgentNotice = "legal" | "hiring" | "draft" | "video";

export type BuiltinAgent = {
  key: string;
  department: Exclude<Department, "general">;
  name: string;
  description: string;
  fields: BuiltinField[];
  instructions: string;
  outputFormat: OutputFormat;
  memoryScope: MemoryScope;
  tools: ToolCapability[];
  notice: AgentNotice | null;
};

/** How a chart is written in an answer; the conversation draws it (see conversations/ui/chart.tsx). */
export const CHART_INSTRUCTION = [
  "To show a chart, add a fenced code block whose language is `chart`, containing only JSON:",
  '{"type": "line" | "bar", "title": "...", "unit": "€", "labels": ["Jan", "Feb", ...], "series": [{"name": "...", "values": [number, ...]}]}',
  "One value per label in every series, plain numbers (no thousands separators), at most 3 series and 24 labels. Never chart numbers that are not in your table.",
].join("\n");

const DRAFT_RULES = [
  "Rules:",
  "- Work only from the form, the attached files and the company knowledge provided. Never invent facts, figures, names, prices, dates or references: write [to complete] (in the person's language) where something is missing, and list what is missing at the end.",
  "- What you produce is a draft for a person to review. You never send, pay, sign or submit anything.",
].join("\n");

const LEGAL_RULES = [
  "- You are not a lawyer and this is not legal advice. Do not cite laws, articles or case law unless they appear in the documents provided; when the applicable law matters, say that a legal professional must check it.",
  "- End with one line reminding that the document must be reviewed by a legal professional before any use.",
].join("\n");

/** How Motion Design writes a HyperFrames composition (checked by src/modules/render/composition.ts). */
const MOTION_RULES = [
  "Write ONE complete HyperFrames composition: an HTML page animated with a GSAP timeline, in a fenced code block whose language is `hyperframes`.",
  "Required structure:",
  '- In <head>: <meta data-composition-id="motion" data-width="W" data-height="H" data-duration="D">, where W×H is 1920×1080 for 16:9, 1080×1920 for 9:16, 1080×1080 for 1:1 (the format chosen in the form) and D is the duration in seconds chosen in the form.',
  "- html and body exactly W×H pixels, overflow hidden, a background colour. A #stage div of W×H, position relative.",
  '- Each scene is an element with class="clip", data-start (seconds), data-duration (seconds) and data-track-index (0, 1, 2… higher is in front). The CSS sets .clip { position: absolute; inset: 0; visibility: hidden; }. Never change visibility yourself.',
  '- One script at the end of <body>: var tl = gsap.timeline({ paused: true }); animate opacity, transforms (x, y, scale, rotation), colours, clip-path; end with tl.set({}, {}, D); then window.__timelines = window.__timelines || {}; window.__timelines["motion"] = tl;',
  "Strict limits: no other script, no <script src>, no external URL (no CDN, no web fonts, no remote images), no fetch, no video or audio element. GSAP is provided. The only font is \"Inter\" (weights 100 to 900): font-family: Inter, sans-serif.",
  "Images: only the files attached to the form, written exactly as src=\"assets/<file name>\" (for example assets/logo.png). Never invent an image.",
  "Design: one idea per scene, large legible text (at least 64px on 16:9, 80px on 9:16), a safe margin of 8% on every side, at most 3 colours from the brief or the brand (company knowledge), smooth eases, short readable texts. Texts come from the brief; never invent figures, prices or claims.",
  "Before the code block, describe the scenes in 2 to 4 short lines in the person's language. Nothing after the code block. The person previews it, then makes the MP4.",
].join("\n");

/** How the Video Editor writes an edit plan (checked by src/modules/render/edit-plan.ts). */
const EDIT_RULES = [
  'You cannot see or hear the videos: each attached video is described as [Video "name": duration, size]. Plan from the brief, the names and the durations, and say so in one line when the brief asks for things only visible in the pictures (e.g. "keep the best moments").',
  "Write the edit plan as JSON in a fenced code block whose language is `editplan`:",
  '{"title": "...", "segments": [{"clip": "exact file name", "start": 0, "end": 4.5}], "captions": [{"text": "...", "start": 0, "end": 3}], "formats": ["16:9", "9:16", "1:1"], "fit": "crop"}',
  "- segments: the cuts, in playing order; start and end in seconds inside that clip (never beyond its duration); at least 0.5 s each. The same clip may be used several times.",
  "- captions: short texts shown at the bottom (at most 2 lines each), timed on the final video; only texts from the form or the brief, never invented facts. Empty list if none.",
  '- formats: the formats chosen in the form ("all" means the three). fit: "crop" fills the frame (default, best for social networks); "pad" keeps the whole picture with bars when the brief asks for it.',
  "- The whole video lasts at most 300 seconds.",
  "Before the code block, explain the edit in 2 to 4 short lines in the person's language (order, total duration, formats). Nothing after the code block. The person checks the plan, then makes the videos.",
].join("\n");

export const BUILTIN_AGENTS: BuiltinAgent[] = [
  {
    key: "motion_design",
    department: "marketing",
    name: "Motion Design",
    description: "Brief + brand assets → animated MP4, built with HyperFrames.",
    fields: [
      { key: "brief", type: "textarea", required: true, label: "Brief (message, texts, audience)" },
      { key: "assets", type: "files", required: false, label: "Logo and images (PNG, JPG)" },
      { key: "format", type: "select", required: true, label: "Format", options: ["16_9", "9_16", "1_1"] },
      { key: "duration", type: "select", required: true, label: "Duration", options: ["6", "10", "15", "20", "30"] },
      { key: "style", type: "text", required: false, label: "Colours and style" },
    ],
    instructions: [
      "Create a short animated video (motion design) from the brief: title cards, key messages, logo reveal, call to action.",
      "The format in the form is 16_9 (16:9, landscape), 9_16 (9:16, vertical) or 1_1 (1:1, square); the duration is in seconds.",
      "Use the company knowledge for the brand (colours, tone, offers) when the brief does not say.",
      MOTION_RULES,
    ].join("\n"),
    outputFormat: "text",
    memoryScope: "company",
    tools: ["attachments"],
    notice: "video",
  },
  {
    key: "video_editor",
    department: "marketing",
    name: "Video Editor",
    description: "Uploaded clips + brief → edited MP4 (cuts, order, captions, 16:9 / 9:16 / 1:1 versions).",
    fields: [
      { key: "clips", type: "videos", required: true, label: "Video clips (MP4, MOV, WebM)" },
      { key: "brief", type: "textarea", required: true, label: "Brief (what the video must show, length, tone)" },
      { key: "formats", type: "select", required: true, label: "Formats", options: ["all", "16_9", "9_16", "1_1"] },
      { key: "captions", type: "textarea", required: false, label: "Texts to show (titles, captions)" },
    ],
    instructions: [
      "Plan the edit of the attached clips into one video following the brief: cuts, order, captions and formats.",
      "Formats in the form: all (16:9, 9:16 and 1:1), 16_9, 9_16 or 1_1.",
      EDIT_RULES,
    ].join("\n"),
    outputFormat: "text",
    memoryScope: "company",
    tools: ["attachments"],
    notice: "video",
  },
  {
    key: "proposal_writer",
    department: "sales",
    name: "Proposal Writer",
    description: "Client and needs → commercial proposal draft, exportable.",
    fields: [
      { key: "client", type: "client", required: true, label: "Client" },
      { key: "needs", type: "textarea", required: true, label: "The client's needs" },
      { key: "offer", type: "textarea", required: false, label: "What you propose (services, products)" },
      { key: "budget", type: "text", required: false, label: "Budget or price elements" },
      { key: "deadline", type: "text", required: false, label: "Timing" },
    ],
    instructions: [
      "Write a commercial proposal draft for the client in the form, ready to be exported as a document.",
      "Structure: title; context and our understanding of the client's needs; proposed solution; deliverables and timeline; price (only figures given in the form or found in the company knowledge, otherwise [to complete]); why our company (from the company knowledge); next steps.",
      "Use what the company knowledge says about this client (history, preferences, decisions) and cite it. Follow the company's tone if the knowledge describes it. Be specific and concise; no filler.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company_and_client",
    tools: [],
    notice: null,
  },
  {
    key: "meeting_prep",
    department: "sales",
    name: "Meeting Prep",
    description: "Client → brief with context from client memory, history, talking points and questions.",
    fields: [
      { key: "client", type: "client", required: true, label: "Client" },
      { key: "goal", type: "textarea", required: true, label: "Goal of the meeting" },
      { key: "date", type: "text", required: false, label: "Date and format" },
      { key: "attendees", type: "text", required: false, label: "Attendees" },
    ],
    instructions: [
      "Prepare a one-page brief for a meeting with the client in the form.",
      "Sections: the client in brief; history and recent decisions (from the company knowledge, cited); open issues and sensitive points; talking points for the goal of the meeting; questions to ask; desired outcome and next step.",
      "When the company knowledge has little about this client, say so plainly instead of filling the gaps.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company_and_client",
    tools: [],
    notice: null,
  },
  {
    key: "invoice_intake",
    department: "accounting",
    name: "Invoice Intake",
    description: "Uploaded invoices (PDF or images) → extracted table, exportable as CSV/XLSX.",
    fields: [
      { key: "invoices", type: "files", required: true, label: "Invoices (PDF or images)" },
      { key: "instructions", type: "textarea", required: false, label: "Instructions (categories, period…)" },
    ],
    instructions: [
      "Extract one row per invoice from the attached files into a single Markdown table with exactly these columns, in the person's language:",
      "Supplier | Invoice number | Invoice date | Due date | Amount excl. VAT | VAT rate | VAT amount | Total incl. VAT | Currency | Category",
      "Dates as YYYY-MM-DD; amounts as plain numbers with a dot for decimals and no currency symbol (the currency has its own column). Category: a short accounting category (use the categories from the instructions or the company knowledge if given).",
      "Write ? for any value you cannot read with certainty: never guess. After the table, add a totals line per currency, then list the invoices or values to check by hand.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "table",
    memoryScope: "company",
    tools: ["attachments"],
    notice: "draft",
  },
  {
    key: "payment_reminders",
    department: "accounting",
    name: "Payment Reminders",
    description: "List of unpaid invoices → reminder email drafts with escalating tone.",
    fields: [
      { key: "invoices", type: "textarea", required: true, label: "Unpaid invoices (client, number, amount, due date)" },
      { key: "file", type: "files", required: false, label: "Or a file (CSV, Excel)" },
      { key: "stage", type: "select", required: true, label: "Reminder", options: ["first", "second", "final"] },
      { key: "signature", type: "text", required: false, label: "Signature" },
    ],
    instructions: [
      "Write one reminder e-mail draft per client with unpaid invoices: a subject line, then the body.",
      "Mention each invoice's number, amount and due date, and how many days it is overdue compared with today's date.",
      "Tone by reminder: first = courteous, assumes an oversight; second = firm and precise, asks for a payment date; final = formal notice of the next steps. Next steps, penalties or fees only if they appear in the company knowledge or the form; never invent legal threats, bank details or payment links.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "email",
    memoryScope: "company_and_client",
    tools: ["attachments"],
    notice: "draft",
  },
  {
    key: "cash_flow_forecast",
    department: "finance",
    name: "Cash-Flow Forecast",
    description: "Bank exports + recurring items → 3–12 month forecast table and chart.",
    fields: [
      { key: "exports", type: "files", required: true, label: "Bank exports (CSV, Excel, PDF)" },
      { key: "opening", type: "text", required: false, label: "Current balance" },
      { key: "recurring", type: "textarea", required: false, label: "Known recurring income and expenses" },
      { key: "horizon", type: "select", required: true, label: "Horizon", options: ["3", "6", "12"] },
    ],
    instructions: [
      "Build a monthly cash-flow forecast for the horizon chosen in the form (in months), starting next month.",
      "1. From the bank exports, identify recurring inflows and outflows (salaries, rent, subscriptions, regular clients…) and their usual amounts; combine them with the recurring items given in the form.",
      "2. A Markdown table with the columns: Month | Expected inflows | Expected outflows | Net | Closing balance. Start from the current balance in the form, else from the last balance in the exports.",
      "3. A line chart of the closing balance (and inflows and outflows as other series if useful).",
      "4. The assumptions you made, and the months where the balance becomes low or negative.",
      CHART_INSTRUCTION,
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "table",
    memoryScope: "company",
    tools: ["attachments"],
    notice: "draft",
  },
  {
    key: "margin_analysis",
    department: "finance",
    name: "Margin Analysis",
    description: "Sales and cost data → margins by product, client or project, with commentary.",
    fields: [
      { key: "data", type: "files", required: false, label: "Sales and cost data (CSV, Excel)" },
      { key: "figures", type: "textarea", required: false, label: "Or paste your figures" },
      { key: "by", type: "select", required: true, label: "Margins by", options: ["product", "client", "project"] },
      { key: "period", type: "text", required: false, label: "Period" },
    ],
    instructions: [
      "Compute margins by the dimension chosen in the form from the data provided.",
      "A Markdown table: Item | Revenue | Costs | Gross margin | Margin % — sorted by gross margin, with a total row. Show how costs were allocated when they are shared.",
      "Then a bar chart of the margin % by item, and a short commentary: best and weakest items, anomalies, missing cost data, three concrete recommendations.",
      CHART_INSTRUCTION,
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "table",
    memoryScope: "company",
    tools: ["attachments"],
    notice: "draft",
  },
  {
    key: "job_posting_writer",
    department: "hr",
    name: "Job Posting Writer",
    description: "Role + context → job posting draft.",
    fields: [
      { key: "role", type: "text", required: true, label: "Job title" },
      { key: "context", type: "textarea", required: true, label: "Team, missions, requirements" },
      { key: "contract", type: "select", required: false, label: "Contract", options: ["permanent", "fixed_term", "freelance", "internship", "work_study"] },
      { key: "location", type: "text", required: false, label: "Location and remote work" },
      { key: "salary", type: "text", required: false, label: "Salary range" },
    ],
    instructions: [
      "Write a job posting draft: an engaging title; the company (from the company knowledge); the role and missions; the profile (separate required and nice-to-have); what we offer (only what is given); contract, location, salary (only if given); how to apply.",
      "Use inclusive, non-discriminatory wording: no criteria about age, gender, origin, family situation, health or appearance; in French, use a gender-neutral title or \"(F/H)\".",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company",
    tools: [],
    notice: null,
  },
  {
    key: "application_review",
    department: "hr",
    name: "Application Review Assistant",
    description: "Applications + employer-written criteria → structured summaries. A person decides.",
    fields: [
      { key: "role", type: "text", required: true, label: "Position" },
      { key: "criteria", type: "textarea", required: true, label: "Your criteria" },
      { key: "applications", type: "files", required: true, label: "Applications (CV, letters)" },
    ],
    instructions: [
      "For each application, in the order received, write a structured summary against the employer's criteria in the form:",
      "- the candidate's background in 2 to 3 lines;",
      "- for each criterion: what the application shows (with a short quote or reference), or \"not found in the application\";",
      "- questions to ask in an interview to clarify the gaps.",
      "Strict rules: never give a score, a grade, a ranking, an order of preference, a shortlist, a recommendation to hire or to reject, or an overall verdict, even if asked. Do not compare candidates with each other. Ignore and never mention age, gender, origin, nationality, family situation, health, disability, photo or any other personal characteristic unrelated to the criteria.",
      "End with this line: a person reviews the applications and takes every decision.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "none",
    tools: ["attachments"],
    notice: "hiring",
  },
  {
    key: "contract_review",
    department: "legal",
    name: "Contract Review",
    description: "Uploaded contract → key clauses, risks, missing clauses, questions for a lawyer.",
    fields: [
      { key: "contract", type: "files", required: true, label: "Contract" },
      { key: "side", type: "select", required: false, label: "We are", options: ["client", "supplier", "partner", "other"] },
      { key: "focus", type: "textarea", required: false, label: "Points of attention" },
    ],
    instructions: [
      "Review the attached contract from the point of view of the side given in the form.",
      "Sections: summary (parties, object, duration, price and payment, termination); a Markdown table of key clauses (Clause | Reference | What it says | Attention point); risks, each with its clause reference, a short quote and a level (low, medium, high); missing or unusual clauses; questions to ask a lawyer.",
      "Quote the contract exactly when you rely on it; if a passage is unreadable or absent, say so.",
      DRAFT_RULES,
      LEGAL_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company",
    tools: ["attachments"],
    notice: "legal",
  },
  {
    key: "template_drafter",
    department: "legal",
    name: "Template Drafter",
    description: "Type of document → draft of terms and conditions (CGV), NDA or other standard document.",
    fields: [
      { key: "type", type: "select", required: true, label: "Document", options: ["terms_of_sale", "nda", "terms_of_service", "services_agreement", "other"] },
      { key: "details", type: "textarea", required: true, label: "Parties and useful information" },
      { key: "specifics", type: "textarea", required: false, label: "Specific points to include" },
    ],
    instructions: [
      "Draft the standard document chosen in the form, with numbered articles and clear headings, using the company knowledge (company name, activity, usual conditions).",
      "Leave [to complete] for every element not provided (identities, amounts, durations, governing law and courts unless given). Keep the wording balanced and plain.",
      DRAFT_RULES,
      LEGAL_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company",
    tools: [],
    notice: "legal",
  },
  {
    key: "email_responder",
    department: "customer_service",
    name: "Email Responder",
    description: "Incoming client email → reply draft in the company's tone, using memory.",
    fields: [
      { key: "email", type: "textarea", required: true, label: "E-mail received" },
      { key: "client", type: "client", required: false, label: "Client" },
      { key: "intent", type: "textarea", required: false, label: "What you want to answer" },
    ],
    instructions: [
      "Write a reply e-mail draft (subject line, then body) to the e-mail in the form, in the company's tone as described in the company knowledge.",
      "Answer every question or request in the e-mail; use the company knowledge and the client's history (cited) for facts; follow what the person wants to answer.",
      "Never promise a refund, a discount, a deadline or a commitment that the form or the company knowledge does not support: write [to confirm] instead.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "email",
    memoryScope: "company_and_client",
    tools: [],
    notice: "draft",
  },
  {
    key: "feedback_synthesis",
    department: "customer_service",
    name: "Feedback Synthesis",
    description: "Uploaded reviews or emails → themes, sentiment, recommended actions.",
    fields: [
      { key: "files", type: "files", required: false, label: "Reviews or e-mails (files)" },
      { key: "text", type: "textarea", required: false, label: "Or paste them" },
      { key: "context", type: "text", required: false, label: "Product, service or period" },
    ],
    instructions: [
      "Analyse the customer feedback provided.",
      "1. Overall sentiment: number of positive, neutral and negative items.",
      "2. A Markdown table of themes: Theme | Mentions | Sentiment | Representative quote — most frequent first.",
      "3. Urgent issues (safety, legal, a customer about to leave), if any.",
      "4. Recommended actions, prioritised, each linked to a theme.",
      "Count only what is in the feedback; quote it exactly.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company",
    tools: ["attachments"],
    notice: null,
  },
  {
    key: "meeting_minutes",
    department: "management",
    name: "Meeting Minutes",
    description: "Notes, transcript or audio file → minutes with decisions and action items.",
    fields: [
      { key: "files", type: "files", required: false, label: "Notes or transcript (file)" },
      { key: "notes", type: "textarea", required: false, label: "Or paste your notes" },
      { key: "meeting", type: "text", required: false, label: "Meeting (title, date)" },
      { key: "attendees", type: "text", required: false, label: "Attendees" },
    ],
    instructions: [
      "Write the minutes of the meeting from the notes or transcript provided.",
      "Sections: title, date and attendees; summary in 3 to 5 lines; decisions (numbered); a Markdown table of actions: Action | Owner | Due date; open questions.",
      "Only what the notes say: write ? for an owner or a date that is not clear.",
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company",
    tools: ["attachments"],
    notice: null,
  },
  {
    key: "weekly_dashboard",
    department: "management",
    name: "Weekly Dashboard",
    description: "Uploaded data files + memory → one-page weekly summary of KPIs, highlights and risks.",
    fields: [
      { key: "data", type: "files", required: true, label: "Data files (CSV, Excel)" },
      { key: "week", type: "text", required: false, label: "Week" },
      { key: "kpis", type: "textarea", required: false, label: "Indicators to follow" },
    ],
    instructions: [
      "Write a one-page weekly dashboard from the data files and the company knowledge.",
      "1. A Markdown table of indicators: Indicator | This week | Previous period | Change | Comment — the indicators asked in the form, else the most important ones in the data.",
      "2. A chart of the main indicator over the periods available.",
      "3. Highlights (3 to 5), risks and attention points, priorities for next week.",
      "Never invent a figure: write ? when the data does not give it, and say which data is missing.",
      CHART_INSTRUCTION,
      DRAFT_RULES,
    ].join("\n"),
    outputFormat: "document",
    memoryScope: "company",
    tools: ["attachments"],
    notice: null,
  },
];

export function builtinAgent(key: string | null | undefined): BuiltinAgent | undefined {
  return key ? BUILTIN_AGENTS.find((a) => a.key === key) : undefined;
}
