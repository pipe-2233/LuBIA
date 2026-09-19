import { createClient } from "@deepgram/sdk";
import { getSetting } from "../config/env.js";

let _deepgram = null;

export function getDeepgram() {
  if (!_deepgram) {
    _deepgram = createClient(getSetting("DEEPGRAM_API_KEY"));
  }
  return _deepgram;
}

export function resetDeepgram() {
  _deepgram = null;
}

export async function transcribeAudioBuffer(buffer) {
  const deepgram = getDeepgram();
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(buffer, {
    model: "nova-3",
    smart_format: true,
    diarize: true,
    detect_language: true,
    punctuate: true,
  });

  if (error) throw new Error(error.message);

  const paragraphs = result.results?.channels[0]?.alternatives[0]?.paragraphs?.paragraphs || [];
  let text = "";
  const segments = [];
  for (const p of paragraphs) {
    const s = p.speaker ?? 0;
    const t = p.sentences.map((sentence) => sentence.text).join(" ");
    text += `[Speaker ${s}]: ${t}\n`;
    segments.push({ speaker: s, text: t, start: p.start, end: p.end });
  }

  if (!text) {
    const alt = result.results?.channels[0]?.alternatives[0]?.transcript || "";
    text = alt;
    segments.push({ speaker: 0, text: alt, start: 0, end: 0 });
  }

  return { transcription: text.trim(), segments };
}
