import type { CaptionCue, ElevenLabsAlignment } from "../types";

export interface VisibleCaptionChar {
  value: string;
  visibleIndex: number;
}

export interface CaptionRange {
  text: string;
  start: number;
  end: number;
}

export function trimCaptionPieces(pieces: VisibleCaptionChar[]): VisibleCaptionChar[] {
  let first = 0;
  let last = pieces.length - 1;

  while (first <= last && pieces[first].value.trim() === "") first++;
  while (last >= first && pieces[last].value.trim() === "") last--;

  return first <= last ? pieces.slice(first, last + 1) : [];
}

export function makeCaptionRange(pieces: VisibleCaptionChar[]): CaptionRange | null {
  const trimmed = trimCaptionPieces(pieces);
  if (!trimmed.length) return null;

  const text = trimmed
    .map((piece) => piece.value)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:，。！？；：])/g, "$1")
    .trim();

  if (!text) return null;

  return {
    text,
    start: trimmed[0].visibleIndex,
    end: trimmed[trimmed.length - 1].visibleIndex + 1,
  };
}

export function splitCaptionPieces(pieces: VisibleCaptionChar[]): VisibleCaptionChar[][] {
  const trimmed = trimCaptionPieces(pieces);
  if (trimmed.length <= 48) return trimmed.length ? [trimmed] : [];

  const sentenceSegments: VisibleCaptionChar[][] = [];
  let sentenceStart = 0;

  for (let i = 0; i < trimmed.length; i++) {
    if (/[.!?。！？]/.test(trimmed[i].value) && i - sentenceStart >= 8) {
      const segment = trimCaptionPieces(trimmed.slice(sentenceStart, i + 1));
      if (segment.length) sentenceSegments.push(segment);
      sentenceStart = i + 1;
    }
  }

  if (sentenceStart < trimmed.length) {
    const segment = trimCaptionPieces(trimmed.slice(sentenceStart));
    if (segment.length) sentenceSegments.push(segment);
  }

  if (sentenceSegments.length > 1) return sentenceSegments;

  const chunks: VisibleCaptionChar[][] = [];
  let chunkStart = 0;

  while (chunkStart < trimmed.length) {
    let chunkEnd = Math.min(chunkStart + 48, trimmed.length);

    if (chunkEnd < trimmed.length) {
      for (let i = chunkEnd; i > chunkStart + 18; i--) {
        if (trimmed[i]?.value.trim() === "") {
          chunkEnd = i;
          break;
        }
      }
    }

    const chunk = trimCaptionPieces(trimmed.slice(chunkStart, chunkEnd));
    if (chunk.length) chunks.push(chunk);
    chunkStart = Math.max(chunkEnd, chunkStart + 1);
  }

  return chunks;
}

export function createVisibleCaptionRanges(text: string): CaptionRange[] {
  const chars = Array.from(text);
  const ranges: CaptionRange[] = [];
  let line: VisibleCaptionChar[] = [];
  let visibleIndex = 0;

  const pushLine = () => {
    for (const segment of splitCaptionPieces(line)) {
      const range = makeCaptionRange(segment);
      if (range) ranges.push(range);
    }
    line = [];
  };

  for (let i = 0; i < chars.length; i++) {
    const value = chars[i];

    if (value === "[") {
      let closeIndex = -1;
      for (let j = i + 1; j < Math.min(chars.length, i + 82); j++) {
        if (chars[j] === "\n" || chars[j] === "\r") break;
        if (chars[j] === "]") {
          closeIndex = j;
          break;
        }
      }
      if (closeIndex !== -1) {
        i = closeIndex;
        continue;
      }
    }

    if (value === "\r") continue;
    if (value === "\n") {
      pushLine();
      continue;
    }

    line.push({ value, visibleIndex });
    visibleIndex++;
  }

  pushLine();
  return ranges;
}

export function createAlignmentVisibleIndexes(alignment: ElevenLabsAlignment): number[] {
  const characters = alignment.characters || [];
  const indexes: number[] = [];

  for (let i = 0; i < characters.length; i++) {
    const value = characters[i];

    if (value === "[") {
      let closeIndex = -1;
      for (let j = i + 1; j < Math.min(characters.length, i + 82); j++) {
        if (characters[j] === "\n" || characters[j] === "\r") break;
        if (characters[j] === "]") {
          closeIndex = j;
          break;
        }
      }
      if (closeIndex !== -1) {
        i = closeIndex;
        continue;
      }
    }

    if (value === "\n" || value === "\r") continue;
    indexes.push(i);
  }

  return indexes;
}

export function createCaptionCues(text: string, alignment?: ElevenLabsAlignment): CaptionCue[] {
  if (!alignment) return [];

  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;

  if (!characters?.length || !starts?.length || !ends?.length) return [];

  const visibleIndexes = createAlignmentVisibleIndexes(alignment);
  const ranges = createVisibleCaptionRanges(text);
  const cues: CaptionCue[] = [];

  for (const range of ranges) {
    const lastVisibleOffset = Math.min(range.end, visibleIndexes.length) - 1;
    let firstAlignmentIndex = -1;
    let lastAlignmentIndex = -1;

    for (let offset = range.start; offset <= lastVisibleOffset; offset++) {
      const alignmentIndex = visibleIndexes[offset];
      if (
        alignmentIndex !== undefined &&
        characters[alignmentIndex]?.trim() !== "" &&
        Number.isFinite(starts[alignmentIndex]) &&
        Number.isFinite(ends[alignmentIndex])
      ) {
        firstAlignmentIndex = alignmentIndex;
        break;
      }
    }

    for (let offset = lastVisibleOffset; offset >= range.start; offset--) {
      const alignmentIndex = visibleIndexes[offset];
      if (
        alignmentIndex !== undefined &&
        characters[alignmentIndex]?.trim() !== "" &&
        Number.isFinite(starts[alignmentIndex]) &&
        Number.isFinite(ends[alignmentIndex])
      ) {
        lastAlignmentIndex = alignmentIndex;
        break;
      }
    }

    if (firstAlignmentIndex === -1 || lastAlignmentIndex === -1) continue;

    const start = Math.max(0, starts[firstAlignmentIndex]);
    const end = Math.max(start + 0.08, ends[lastAlignmentIndex]);
    cues.push({ text: range.text, start, end });
  }

  return cues;
}

export function normalizeElevenLabsAlignment(value: unknown): ElevenLabsAlignment | undefined {
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const characters = record.characters || record.chars;
  const starts = record.character_start_times_seconds || record.start_times_seconds;
  const ends = record.character_end_times_seconds || record.end_times_seconds;

  if (
    Array.isArray(characters) &&
    Array.isArray(starts) &&
    Array.isArray(ends) &&
    characters.length === starts.length &&
    starts.length === ends.length
  ) {
    const startTimes = starts.map((start) => Number(start));
    const endTimes = ends.map((end) => Number(end));

    if (!startTimes.every(Number.isFinite) || !endTimes.every(Number.isFinite)) return undefined;

    return {
      characters: characters.map((character) => String(character)),
      character_start_times_seconds: startTimes,
      character_end_times_seconds: endTimes,
    };
  }

  return normalizeElevenLabsAlignment(record.alignment) || normalizeElevenLabsAlignment(record.normalized_alignment);
}
