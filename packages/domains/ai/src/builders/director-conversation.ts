/**
 * Conversation layer of the AI Director: how it talks, and the recommend -> confirm -> execute flow.
 *
 * The director behaves like a friendly human editor in a chat:
 *   recommend  — the creator was vague ("edit this video"): say what you see, suggest a direction, ask one question
 *   gather     — one short question when something essential is unclear
 *   confirm    — a tiny numbered plan ("Here's what I'll do ... Good to go?"); nothing is edited yet
 *   done       — edits were applied; a 1-2 sentence report + follow-up chips
 *   chat       — small talk / questions, no edits
 *
 * The LLM speaks through the `reply_to_creator` tool (structured JSON), next to the edit tools. Without an LLM the
 * same flow is approximated deterministically here, so the phone always gets short, friendly replies.
 */
import { jsonrepair } from "jsonrepair";
import type { CreativeOperation } from "@workspace/video-contracts";

export type DirectorPhase = "recommend" | "gather" | "confirm" | "done" | "chat";
export const DIRECTOR_PHASES: DirectorPhase[] = ["recommend", "gather", "confirm", "done", "chat"];

export interface DirectorConversation {
  /** Short, friendly chat message (1-4 sentences). */
  reply: string;
  phase: DirectorPhase;
  /** 0-3 one-tap answers for the creator. */
  quickReplies: string[];
  /** confirm (and sometimes recommend): the concrete steps the director will do once the creator agrees. */
  proposedPlan: string[];
}

export const CHAT_TOOL_NAME = "reply_to_creator";

const MAX_REPLY_CHARS = 420;
const MAX_CHIP_CHARS = 32;
const MAX_STEP_CHARS = 80;

/** The chat tool, in the same OpenAI function format as the edit tools. */
export function buildChatToolDefinition() {
  return {
    type: "function",
    function: {
      name: CHAT_TOOL_NAME,
      description:
        "Talk to the creator in the chat. Call it EVERY turn, exactly once. Without edit tools it is a pure chat turn (recommend / gather / confirm / chat) and nothing on the timeline changes. After edit tools, use phase \"done\" and report briefly what you did.",
      parameters: {
        type: "object",
        properties: {
          reply: {
            type: "string",
            description: "Your chat message: 1-3 short sentences (max ~45 words), warm and casual, plain words, no markdown, at most one question. Same language as the creator.",
          },
          phase: {
            type: "string",
            enum: DIRECTOR_PHASES,
            description: "recommend = suggest a direction for a vague ask; gather = one clarifying question; confirm = propose a plan and wait for a yes; done = you just made edits; chat = anything else.",
          },
          quickReplies: {
            type: "array",
            items: { type: "string" },
            description: "2-3 short tap-to-send answers in the creator's voice (max 4 words each), e.g. [\"Yes, do it\", \"Calmer please\", \"Something else\"].",
          },
          proposedPlan: {
            type: "array",
            items: { type: "string" },
            description: "phase confirm: 2-5 concrete steps you will do, max 8 words each (e.g. \"Trim the dead air\", \"Bold yellow captions\", \"Title card: 'Gym Truth'\"). Empty otherwise.",
          },
        },
        required: ["reply", "phase"],
      },
    },
  };
}

/** Persona + conversation protocol (top of the planner prompt). */
export const DIRECTOR_PERSONA = [
  `You are the AI Director inside 180 Social Studio: a friendly, experienced video editor chatting with a creator on their phone. You can see their video through the analysis below (length, transcript, pauses, faces, scene labels) and you edit it by calling tools.`,
  ``,
  `## How you talk (very important)`,
  `- Short. 1-3 sentences, or a tiny numbered plan. Never paragraphs, essays, headings, bold text or bullet walls.`,
  `- Warm, casual and confident, like a good editor friend. Plain words: no jargon (no LUFS, EditIR, tool names, hex codes, timestamps like 12.43s).`,
  `- Ask at most ONE question per message, and make it easy to answer.`,
  `- Never lecture, never explain editing theory, never condescend, never pad with apologies or disclaimers.`,
  `- Mirror the creator: reply in the language and tone they use (English, Hinglish, Spanish ...). Emojis only if they use them.`,
  `- Show you actually looked at THEIR video: mention one real detail (what kind of video it is, roughly how long, the topic, lots of pauses ...).`,
  ``,
  `## The conversation flow (decide from the conversation so far)`,
  `1. Vague or open request ("edit this video", "make it good", a first message without specifics): DO NOT edit yet. Call ${CHAT_TOOL_NAME} with phase "recommend": what you see + the style you'd go for + one question. Example: "Got it, this looks like a talking-head reel, about 45s. I'd go fast cuts, bold captions and a few punch-in zooms. Want that, or something calmer?" with quickReplies like ["Yes, go for it", "Calmer please", "Something else"].`,
  `2. The creator tells you what they want (or picks a direction): phase "confirm" with proposedPlan (2-5 concrete steps) and a short reply like "Here's what I'll do. Good to go?" and quickReplies ["Do it", "Change something"]. Only if something essential is missing, use phase "gather" with one question instead.`,
  `3. The creator agrees to your plan ("yes", "do it", "go ahead", "sounds good", a thumbs up, in any language): EXECUTE exactly that plan (plus any small change they added) by calling the edit tools, then ${CHAT_TOOL_NAME} with phase "done": one or two sentences on what you actually did, and 2-3 quickReplies for likely tweaks (e.g. "Bigger captions", "Remove the title", "Add music").`,
  `4. A clear, specific edit ("make captions bigger", "remove the title", "cut the first 3 seconds", "add captions", "add upbeat music"): just do it now, no plan needed, then phase "done".`,
  `5. Questions, thanks, small talk: phase "chat", no edits.`,
  `Never call edit tools in the same response as a recommend / gather / confirm reply. Never claim you did something you did not do.`,
  ``,
].join("\n");

/** Leniently parses `reply_to_creator` args (or a JSON object the model wrote as text). */
export function parseConversation(args: any): DirectorConversation | null {
  if (!args || typeof args !== "object") return null;
  const reply = tidyReply(typeof args.reply === "string" ? args.reply : typeof args.message === "string" ? args.message : "");
  if (!reply) return null;
  const phaseRaw = typeof args.phase === "string" ? args.phase.toLowerCase().trim() : "";
  const phase: DirectorPhase = (DIRECTOR_PHASES as string[]).includes(phaseRaw) ? (phaseRaw as DirectorPhase) : "chat";
  return {
    reply,
    phase,
    quickReplies: cleanList(args.quickReplies ?? args.quick_replies, 3, MAX_CHIP_CHARS),
    proposedPlan: cleanList(args.proposedPlan ?? args.proposed_plan ?? args.plan, 6, MAX_STEP_CHARS),
  };
}

/**
 * A text-only model answer: JSON ({reply, phase, ...}, possibly fenced or slightly broken) when the model followed the
 * format in text, else the text itself as a chat reply.
 */
export function conversationFromText(text: string): DirectorConversation | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = raw.slice(start, end + 1);
    for (const attempt of [() => JSON.parse(candidate), () => JSON.parse(jsonrepair(candidate))]) {
      try {
        const parsed = parseConversation(attempt());
        if (parsed) return parsed;
      } catch {
        /* try the next parser */
      }
    }
  }
  const reply = tidyReply(raw);
  return reply ? { reply, phase: "chat", quickReplies: [], proposedPlan: [] } : null;
}

/** Strips markdown and walls of text so a chat bubble stays a chat bubble. */
export function tidyReply(text: string): string {
  let s = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (s.length > MAX_REPLY_CHARS) {
    // Cut at a sentence boundary when possible.
    const cut = s.slice(0, MAX_REPLY_CHARS);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    s = lastStop > 120 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
  }
  return s;
}

function cleanList(v: unknown, max: number, maxChars: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const t = tidyReply(item).replace(/^\d+[.)]\s*/, "");
    if (!t || out.includes(t)) continue;
    out.push(t.length > maxChars ? `${t.slice(0, maxChars - 1).trimEnd()}…` : t);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Conversation state from history (the phone keeps the chat; the server is stateless)
// ---------------------------------------------------------------------------------------------

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The plan the director proposed in its LAST message, if any. The phone sends assistant turns as
 * `<reply>\nPlan:\n1. step\n2. step` (see `historyText`).
 */
export function planFromHistory(history: HistoryTurn[] | undefined): string[] {
  if (!history?.length) return [];
  const last = [...history].reverse().find((t) => t.role === "assistant");
  if (!last) return [];
  const idx = last.content.search(/(^|\n)\s*plan\s*:/i);
  if (idx < 0) return [];
  return last.content
    .slice(idx)
    .split("\n")
    .map((l) => l.match(/^\s*\d+[.)]\s+(.+)$/)?.[1]?.trim())
    .filter((s): s is string => !!s)
    .slice(0, 8);
}

/** The text an assistant turn should carry in history so the next turn knows the plan on the table. */
export function historyText(reply: string, plan: string[]): string {
  return plan.length ? `${reply}\nPlan:\n${plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : reply;
}

const AFFIRMATIVE =
  /^(?:(?:ok(?:ay)?|sure|yes+|yeah|yep|yup|ya|yea|y|haa?n?|ha+|ji|theek hai|thik hai|chalo|kar do|karo|go|go ahead|go for it|do it|do that|let'?s do it|let'?s go|sounds good|sounds great|looks good|good to go|perfect|great|awesome|love it|deal|ship it|please do|please|si|sí|vale|claro|oui|ja|👍|✅|🔥|💯)[\s,.!]*)+(?:please|now|then|bro|man|buddy|thanks|thank you)?[\s.!]*$/i;

/** "yes", "do it", "go ahead", "haan kar do", 👍 ... (a short agreement, no new instructions). */
export function isAffirmative(prompt: string): boolean {
  const p = prompt.trim();
  return p.length > 0 && p.length <= 40 && AFFIRMATIVE.test(p);
}

/** "yes, but make the captions yellow": agreement plus a small change. */
export function startsWithAgreement(prompt: string): boolean {
  return /^(?:ok(?:ay)?|sure|yes+|yeah|yep|yup|do it|go ahead|sounds good|looks good|perfect|great|haan?|ha)\b[\s,.!-]+\S/i.test(prompt.trim());
}

/** Open requests with nothing specific to do yet ("edit this video", "make it better", "hi", "help"). */
export function isOpenEnded(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/[!?.]+$/g, "").replace(/\s+/g, " ").trim();
  if (!p) return true;
  if (/^(hi+|hello|hey+|yo|hola|namaste|good (morning|afternoon|evening))( there| bro| man)?$/.test(p)) return true;
  if (/^(help|what can you do|what should i do|any ideas|ideas|suggestions?|what do you think|how does this work)( me)?$/.test(p)) return true;
  return /^(please |pls |can you |could you |hey,? )?(edit|fix|improve|polish|enhance|do|work on|make)( (this|it|my|the))?( (video|clip|reel|short|vid|footage|one))?( (better|good|great|nice|awesome|pop|cool|viral|look good|look great|look better))?( (for me|please|pls|now))*$/.test(p);
}

/** The planner prompt for "yes" to a proposed plan: the plan itself, plus the creator's own words. */
export function agreedPlanPrompt(prompt: string, plan: string[]): string {
  return [
    `The creator agreed to your plan (their words: ${JSON.stringify(prompt.slice(0, 300))}). Do exactly this now:`,
    ...plan.map((p, i) => `${i + 1}. ${p}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Deterministic replies (no LLM, or the LLM did not talk)
// ---------------------------------------------------------------------------------------------

export interface MediaGist {
  durationMs: number;
  width: number;
  height: number;
  words: number;
  silences: number;
  faces: number;
  labels: string[];
}

/** "talking-head reel, about 45s" from the on-device analysis. */
export function describeMedia(m: MediaGist): string {
  const sec = Math.max(1, Math.round(m.durationMs / 1000));
  const length = sec >= 90 ? `about ${Math.round(sec / 60)} min` : `about ${sec}s`;
  const portrait = m.height > m.width;
  const talking = m.words > 0 && (m.faces > 0 || m.words / Math.max(1, sec) > 0.8);
  const kind = talking ? (portrait ? "a talking-head reel" : "a talking-head video") : m.words > 0 ? (portrait ? "a vertical clip with voice" : "a video with voice") : portrait ? "a vertical clip" : "a clip without speech";
  const topic = m.labels.length ? ` (${m.labels.slice(0, 2).join(", ")})` : "";
  return `${kind}${topic}, ${length}`;
}

/** The opening recommendation for "edit this video" without an LLM. */
export function deterministicRecommendation(m: MediaGist): DirectorConversation {
  const portrait = m.height > m.width;
  const plan: string[] = [];
  if (m.silences > 0 || m.words > 0) plan.push("Cut the pauses and dead air");
  if (m.words > 0) plan.push("Add bold captions");
  if (m.faces > 0 || m.words > 0) plan.push("Punch-in zooms on key moments");
  if (!portrait) plan.push("Reframe to vertical 9:16");
  if (!m.words) plan.push("Add upbeat background music");
  const style = m.words > 0 ? "fast cuts, bold captions and a few punch-in zooms" : "a vertical reframe and an upbeat music bed";
  return {
    reply: `Got it, this looks like ${describeMedia(m)}. I'd go ${style}. Want that, or something calmer?`,
    phase: "recommend",
    quickReplies: ["Yes, do it", "Calmer please", "Something else"],
    proposedPlan: plan.slice(0, 4),
  };
}

/** A calmer alternative when the creator says "calmer" to the deterministic recommendation. */
export function deterministicCalmPlan(m: MediaGist): DirectorConversation {
  const plan = [m.words > 0 ? "Cut the long pauses" : "Gentle cinematic colour grade", m.words > 0 ? "Add clean captions" : "Add calm background music"];
  return {
    reply: "Calmer it is. Here's what I'll do. Good to go?",
    phase: "confirm",
    quickReplies: ["Do it", "Change something"],
    proposedPlan: plan,
  };
}

/** The director could not turn the message into an edit (no LLM, no keyword match). */
export function didNotUnderstandReply(hasTranscript: boolean): DirectorConversation {
  return {
    reply: `Hmm, I'm not sure what to change there. Could you say it another way?`,
    phase: "gather",
    quickReplies: hasTranscript ? ["Cut the pauses", "Add captions", "Make it punchy"] : ["Make it vertical", "Add music", "Make it punchy"],
    proposedPlan: [],
  };
}

const OP_LABELS: Record<string, (n: number) => string> = {
  removeSilences: () => "cut the pauses",
  removeRange: (n) => (n === 1 ? "trimmed a section" : `trimmed ${n} sections`),
  cleanFillers: () => "removed the filler words",
  autoCaptions: () => "added captions",
  styleCaption: () => "restyled the captions",
  emphasizeWord: () => "highlighted key words",
  addText: (n) => (n === 1 ? "added a title" : `added ${n} text callouts`),
  addZoom: (n) => (n === 1 ? "added a punch-in zoom" : `added ${n} punch-in zooms`),
  reframeSubject: () => "reframed it",
  changeAspectRatio: () => "changed the frame size",
  insertBroll: (n) => (n === 1 ? "added a B-roll cutaway" : `added ${n} B-roll cutaways`),
  addBackgroundMusic: () => "added background music",
  duckAudio: () => "tucked the music under your voice",
  adjustVolume: () => "adjusted the volume",
  applyFilter: () => "gave it a colour grade",
  addTransition: () => "added transitions",
  addEffect: (n) => (n === 1 ? "added an effect" : "added a few effects"),
  addSoundEffect: () => "added sound effects",
  autoSoundDesign: () => "added sound effects",
  changeSpeed: () => "changed the speed",
  rotateClip: () => "rotated the footage",
  removeItem: () => "removed what you asked",
  addSticker: (n) => (n === 1 ? "added a sticker" : `added ${n} stickers`),
  addNarration: () => "added a voice-over",
  translateCaptions: () => "translated the captions",
  trimClip: () => "trimmed the clip",
  rippleDelete: () => "removed a clip",
  splitClip: () => "split the clip",
  moveClip: () => "moved things around",
  reorderSegment: () => "moved things around",
  cleanVoice: () => "cleaned up the audio",
};

/** "Done! Cut the pauses, added captions and a punch-in zoom." from the operations that were applied. */
export function doneReply(operations: CreativeOperation[]): string {
  const counts = new Map<string, number>();
  for (const o of operations) {
    // Rule-based pause cuts arrive as removeRange with a reason: say "cut the pauses", not "trimmed 5 sections".
    const reason = String((o as any).reason || "");
    const type = o.type === "removeRange" && /pause|silen|dead air|gap/i.test(reason) ? "removeSilences" : o.type;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  const parts = Array.from(new Set(Array.from(counts.entries()).map(([t, n]) => (OP_LABELS[t] ? OP_LABELS[t](n) : null)).filter((s): s is string => !!s)));
  if (!parts.length) return "Done! Take a look.";
  const list = parts.slice(0, 4);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `Done! I ${joined}${parts.length > 4 ? ", plus a couple more touches" : ""}. Take a look.`;
}

/** Follow-up chips after an edit, based on what is on the timeline now. */
export function followUpChips(state: { captions: number; titles: number; music: boolean; zooms: number }): string[] {
  const out: string[] = [];
  if (state.captions > 0) out.push("Bigger captions");
  if (state.titles > 0) out.push("Remove the title");
  if (!state.music) out.push("Add music");
  else out.push("Music quieter");
  if (state.zooms > 0 && out.length < 3) out.push("Fewer zooms");
  if (out.length < 3) out.push("Looks great!");
  return out.slice(0, 3);
}
