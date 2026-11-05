import { Fragment, type ReactNode } from "react";

/*
 * The small amount of Markdown the content bodies actually use: `code`, **bold**, and `--`
 * as an em dash. A full Markdown pipeline would be a dependency and a sanitisation problem
 * for three constructs, and the schema has no place for anything richer -- headings and
 * lists belong in `parts`, which is structured and validated.
 */
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*)/g;

/** Em dashes outside code, so "a -- b" in the source reads as prose. */
const dashes = (text: string) => text.replace(/ -- /g, " — ");

export function inline(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <b key={i}>{dashes(part.slice(2, -2))}</b>;
    }
    return <Fragment key={i}>{dashes(part)}</Fragment>;
  });
}

/** One paragraph of body text. */
export function Prose({ text }: { text: string }) {
  return <p>{inline(text)}</p>;
}
