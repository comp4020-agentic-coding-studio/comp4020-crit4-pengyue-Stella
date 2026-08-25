import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Mechanically-checkable lines from the crit-4 ("An instrument") spec:
// https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/04-instrument/
//
// Most of the brief only a person can judge at the crit — expressiveness,
// whether two players sound different, whether a stranger is invited to play,
// whether there's truly no way to play it wrong. No test can hold those; see
// PROCESS.md for how that gets demonstrated instead.
const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const shipped = files();
const bundle = shipped
  .filter((path) => path.endsWith(".js"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const doc = new JSDOM(readFileSync(join(DIST, "index.html"), "utf8")).window
  .document;

describe("crit-4: an instrument", () => {
  it("makes sound with the Web Audio API, not a canned recording", () => {
    expect(
      doc.querySelector("audio, video"),
      "an <audio>/<video> element plays a fixed recording back --- the brief asks for sound synthesised live by the player, not played back",
    ).toBeNull();
    expect(
      /\bAudioContext\b/.test(bundle),
      "no AudioContext found in the shipped script --- the instrument must synthesise sound with the Web Audio API",
    ).toBe(true);
  });

  it("is playable via pointer input, so it works at both marked viewports", () => {
    // Pointer events cover mouse and touch alike, which is what desktop and
    // phone crit viewports actually have at hand. Quote char is `["'\`]`, not
    // just ["'], because esbuild's minifier rewrites plain string literals to
    // backticks in this toolchain.
    const listensForPointerInput =
      /addEventListener\(\s*["'`](pointerdown|pointerup|mousedown|touchstart|click)["'`]/.test(
        bundle,
      );
    expect(
      listensForPointerInput,
      "no pointer/mouse/touch listener found in the shipped script --- a stranger at either marked viewport needs a way in",
    ).toBe(true);
  });
});
