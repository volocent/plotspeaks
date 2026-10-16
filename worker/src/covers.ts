// Cover images (Phase 2, M5). One fixed house style, generated on Workers AI.
//
//   generateCover(ai, { prompt?, title?, description?, story? }) -> { bytes, contentType, prompt }
//
// The scene comes from `prompt` (a story's cover-prompt.txt, sent by worker/scripts/make-covers.mjs)
// or, when there is none, a small text model writes one from the title, description and first
// scene. Either way the house style and the "no text, no faces, no bodies, no gore" rules are added
// here, so no caller can leave them out.
//
// Models (checked against developers.cloudflare.com/workers-ai/models, 2026-10-16):
//   @cf/black-forest-labs/flux-1-schnell: input { prompt (<= 2048 chars), steps (<= 8, default 4) };
//     output { image: base64 JPEG }. Width/height are not accepted: the output is 1024x1024.
//     Cost: 4.80 neurons per 512x512 tile + 9.60 per step, so about 77 neurons at 6 steps.
//   @cf/meta/llama-3.2-3b-instruct: { messages } -> { response }. 4,625 neurons per M input
//     tokens, 30,475 per M output tokens: a fraction of a neuron to a few neurons per prompt.

export const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
export const PROMPT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const STEPS = 6;

// Colour names rather than hex codes: FLUX tends to paint hex strings onto the image as text.
// The palette is the Plot Speaks logo's: deep navy #12355B, warm orange #F07A22, sky blue #3FB0E8,
// peach #F6C79A, off-white.
export const HOUSE_STYLE =
  "Flat vector book-cover illustration, bold simple shapes, clean edges, atmospheric lighting, " +
  "limited palette of deep navy blue, warm orange, sky blue, soft peach and off-white, portrait book-cover composition.";
export const RULES =
  "An empty, uninhabited scene: places, buildings, landscape and objects only. " +
  "No text, no letters, no words, no numbers, no signs with writing, no title, no logo. " +
  "No people, no faces, no bodies, no hands, no silhouettes of people, no gore, no blood.";

type Ai = { run: (model: string, input: Record<string, unknown>) => Promise<any> };

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/["“”]/g, "").replace(/\s+/g, " ").trim();

/** Title + description + first scene, the only story text the prompt writer sees (no secrets). */
export function coverSource(story: string): { title: string; description: string; scene: string } {
  const fm = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(story) || [, ""])[1];
  const field = (k: string) => clean(((new RegExp(`^\\s*${k}:\\s*(.+)$`, "m").exec(fm) || [, ""])[1]).replace(/^["']|["']$/g, ""));
  const setting = (/^## Setting\s*\n([\s\S]*?)(?=^## )/m.exec(story) || [, ""])[1];
  const coldOpen = [...story.matchAll(/\*\*Read aloud \(cold open[^*]*\*\*\s*([^\n]+)/g)].map((m) => m[1]).join(" ");
  return { title: field("title"), description: field("description"), scene: clean(`${setting} ${coldOpen}`).slice(0, 1500) };
}

/** Asks the small text model for a one-paragraph scene description under the cover rules. */
export async function writeCoverPrompt(ai: Ai, src: { title?: string; description?: string; scene?: string }): Promise<string> {
  const out = await ai.run(PROMPT_MODEL, {
    max_tokens: 120,
    messages: [
      {
        role: "system",
        content:
          "You write one-paragraph prompts for a book-cover illustration. Describe only the setting and its mood: the place, the weather, " +
          "the light, a few objects. Never describe people, faces, bodies, hands, blood, gore or weapons. Never include any text, " +
          "letters, titles or signs. Never reveal plot twists or who did anything. At most 60 words. Reply with the paragraph only.",
      },
      { role: "user", content: `Title: ${src.title ?? ""}\nDescription: ${src.description ?? ""}\nOpening scene: ${src.scene ?? ""}` },
    ],
  });
  const text = clean(String(out?.response ?? "")).replace(/^(here is|prompt:)[^:]*:\s*/i, "");
  return text.split(" ").slice(0, 70).join(" ");
}

export async function generateCover(
  ai: Ai,
  opts: { prompt?: string; title?: string; description?: string; story?: string; seed?: number },
): Promise<{ bytes: Uint8Array; contentType: string; prompt: string }> {
  let scene = clean(opts.prompt ?? "");
  if (!scene) {
    const src = opts.story ? coverSource(opts.story) : { title: opts.title, description: opts.description, scene: "" };
    scene = await writeCoverPrompt(ai, {
      title: src.title || opts.title,
      description: src.description || opts.description,
      scene: src.scene,
    });
  }
  if (!scene) throw new Error("no cover prompt");
  const prompt = `${scene.slice(0, 900)} ${HOUSE_STYLE} ${RULES}`;
  const input: Record<string, unknown> = { prompt, steps: STEPS };
  if (opts.seed !== undefined) input.seed = opts.seed;
  const out = await ai.run(IMAGE_MODEL, input);
  const b64 = typeof out?.image === "string" ? out.image : "";
  if (!b64) throw new Error("the image model returned no image");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // FLUX schnell returns JPEG; sniff anyway so a model change can't mislabel the file.
  const contentType = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0x52 && bytes[1] === 0x49 ? "image/webp" : "image/jpeg";
  return { bytes, contentType, prompt: scene };
}
