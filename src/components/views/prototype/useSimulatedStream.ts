// PROTOTYPE — throwaway UI prototype for wayfinder ticket 08 (non-expert analysis report design). Not production code.

import { useCallback, useEffect, useState } from 'react';

export type StreamPhase = 'verdict' | 'streaming' | 'complete';

export interface SimulatedStream {
  phase: StreamPhase;
  /** Progressively revealed prose. The last entry may be a partial paragraph. */
  streamedParagraphs: string[];
  restart: () => void;
}

const VERDICT_DELAY_MS = 500;
const TICK_MS = 30;
const MIN_UNITS_PER_TICK = 2;
const MAX_UNITS_PER_TICK = 4;

const TOKEN_SPLIT = /(\{\{\d+\|[^}]*\}\})/g;

/**
 * Split a paragraph into reveal units: whole `{{id|label}}` tokens stay atomic
 * so a partially streamed paragraph never shows a half-written token.
 */
function splitUnits(paragraph: string): string[] {
  const units: string[] = [];
  for (const part of paragraph.split(TOKEN_SPLIT)) {
    if (!part) continue;
    if (part.startsWith('{{')) {
      units.push(part);
    } else {
      for (const word of part.split(/\s+/)) {
        if (word) units.push(word);
      }
    }
  }
  return units;
}

/** Re-join units with spaces, but keep trailing punctuation tight. */
function joinUnits(units: string[]): string {
  let out = '';
  units.forEach((unit, i) => {
    if (i === 0) out = unit;
    else if (/^[.,;:!?)\]]/.test(unit)) out += unit;
    else out += ` ${unit}`;
  });
  return out;
}

/**
 * Fake a token stream from a hosted analysis endpoint:
 * a short "thinking" beat, then word-by-word prose, then structured content.
 */
export function useSimulatedStream(paragraphs: string[]): SimulatedStream {
  const [phase, setPhase] = useState<StreamPhase>('verdict');
  const [streamedParagraphs, setStreamedParagraphs] = useState<string[]>([]);
  const [runId, setRunId] = useState(0);

  // Reset here rather than at the top of the effect: the effect body should only
  // wire up timers, and the initial state already is the "verdict" beat.
  const restart = useCallback(() => {
    setPhase('verdict');
    setStreamedParagraphs([]);
    setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    const allUnits = paragraphs.map(splitUnits);
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const startId = setTimeout(() => {
      if (allUnits.length === 0) {
        setPhase('complete');
        return;
      }
      setPhase('streaming');

      let paraIdx = 0;
      let unitIdx = 0;

      intervalId = setInterval(() => {
        unitIdx +=
          MIN_UNITS_PER_TICK +
          Math.floor(Math.random() * (MAX_UNITS_PER_TICK - MIN_UNITS_PER_TICK + 1));

        const revealed: string[] = [];
        for (let i = 0; i < paraIdx; i += 1) revealed.push(joinUnits(allUnits[i]));

        const current = allUnits[paraIdx];
        if (unitIdx >= current.length) {
          revealed.push(joinUnits(current));
          paraIdx += 1;
          unitIdx = 0;
        } else {
          revealed.push(joinUnits(current.slice(0, unitIdx)));
        }

        setStreamedParagraphs(revealed);

        if (paraIdx >= allUnits.length) {
          if (intervalId) clearInterval(intervalId);
          intervalId = undefined;
          setPhase('complete');
        }
      }, TICK_MS);
    }, VERDICT_DELAY_MS);

    return () => {
      clearTimeout(startId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [paragraphs, runId]);

  return { phase, streamedParagraphs, restart };
}
