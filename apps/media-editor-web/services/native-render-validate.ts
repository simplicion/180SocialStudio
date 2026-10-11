/**
 * Filter-graph validation for native renders.
 *
 * MIRRORS apps/desktop-app/src-tauri/src/render.rs (`validate_filter_graph`, `validate_spec`). Keep the algorithm, the
 * allowlist and the test cases identical in both places: the desktop app runs a graph ONLY if it passes this check,
 * which is what stops web content from using FFmpeg as a general tool. File-reading filters (`movie`, `amovie`,
 * `subtitles`, `ass`, `drawtext` with textfile/fontfile, `sendcmd`, `lut3d`, ...) are simply not on the list.
 */

import type { NativeRenderSpec } from "./native-render-plan";

export const ALLOWED_FILTERS = [
  "color", "trim", "atrim", "setpts", "asetpts", "scale", "setsar", "format", "aformat", "overlay", "loop",
  "colorchannelmixer", "fps", "atempo", "volume", "adelay", "afade", "amix", "anullsrc", "aresample", "null", "anull",
  // photos + effect track (none of these read files)
  "crop", "split", "zoompan", "hue", "vignette", "fade",
  // transitions
  "geq", "gblur", "rgbashift", "noise",
  // clip rotation
  "rotate",
] as const;

export const MAX_GRAPH_LEN = 100_000;
// No backslashes (escape tricks), double quotes, backticks, `$`, newlines or control characters.
const GRAPH_CHARS = /^[A-Za-z0-9 \[\]=:;,.'()+\-*\/_%|<>~@!&?^]+$/;

/** Splits on `sep` outside single quotes and outside [labels]. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inQuote = false;
  let bracket = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") inQuote = !inQuote;
    else if (!inQuote && c === "[") bracket++;
    else if (!inQuote && c === "]") bracket--;
    else if (!inQuote && bracket === 0 && c === sep) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
    if (bracket < 0) throw new Error("unbalanced brackets");
  }
  if (inQuote) throw new Error("unbalanced quotes");
  if (bracket !== 0) throw new Error("unbalanced brackets");
  parts.push(s.slice(start));
  return parts;
}

function checkLabel(label: string, inputCount: number) {
  const m = /^(\d+):([va])$/.exec(label);
  if (m) {
    if (Number(m[1]) >= inputCount) throw new Error(`input label [${label}] is out of range`);
    return;
  }
  if (!/^[A-Za-z0-9_]{1,32}$/.test(label)) throw new Error(`invalid label [${label}]`);
}

/** Throws with a reason if the graph is not safe to run. */
export function validateFilterGraph(graph: string, inputCount: number): void {
  if (graph.length === 0 || graph.length > MAX_GRAPH_LEN) throw new Error("filter graph has an invalid length");
  if (!GRAPH_CHARS.test(graph)) throw new Error("filter graph contains a character that is not allowed");

  for (const chain of splitTopLevel(graph, ";")) {
    for (const rawFilter of splitTopLevel(chain, ",")) {
      let token = rawFilter.trim();
      while (token.startsWith("[")) {
        const end = token.indexOf("]");
        if (end < 0) throw new Error("unterminated label");
        checkLabel(token.slice(1, end), inputCount);
        token = token.slice(end + 1);
      }
      while (token.endsWith("]")) {
        const start = token.lastIndexOf("[");
        if (start < 0) throw new Error("unterminated label");
        checkLabel(token.slice(start + 1, -1), inputCount);
        token = token.slice(0, start);
      }
      token = token.trim();
      const name = token.split("=")[0].trim();
      if (!(ALLOWED_FILTERS as readonly string[]).includes(name)) throw new Error(`filter "${name}" is not allowed`);
      // A label inside the arguments (e.g. `scale=[x]=2`) or a nested graph is never legitimate here.
      if (token.includes("[") || token.includes("]")) throw new Error("unexpected label inside filter arguments");
    }
  }
}

/** Full pre-flight of a spec (the same checks the native side applies). */
export function validateRenderSpec(spec: NativeRenderSpec): void {
  if (spec.version !== 1) throw new Error("unsupported spec version");
  if (spec.inputs.length < 1 || spec.inputs.length > 64) throw new Error("invalid input count");
  if (!(spec.width >= 16 && spec.width <= 8192 && spec.height >= 16 && spec.height <= 8192)) throw new Error("invalid size");
  if (!(spec.fps >= 1 && spec.fps <= 120)) throw new Error("invalid fps");
  if (!(spec.durationSec >= 0.1 && spec.durationSec <= 86_400)) throw new Error("invalid duration");
  if (!["draft", "balanced", "high"].includes(spec.quality)) throw new Error("invalid quality");
  const expectedMaps = spec.hasAudio ? ["[vout]", "[aout]"] : ["[vout]"];
  if (spec.maps.length !== expectedMaps.length || spec.maps.some((m, i) => m !== expectedMaps[i])) throw new Error("invalid output maps");
  if (spec.overlaySequence != null && (!spec.overlaySequence.endsWith("list.ffconcat") || spec.overlaySequence.length > 4096)) {
    throw new Error("invalid overlay sequence");
  }
  validateFilterGraph(spec.filterComplex, spec.inputs.length + (spec.overlaySequence ? 1 : 0));
}
