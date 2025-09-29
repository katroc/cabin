// Utilities for handling reasoning/thinking content returned by some models

const RAW_THINK_BLOCK = /<think(?:\s[^>]*)?>([\s\S]*?)<\/think>/gi;
const ESC_THINK_BLOCK = /&lt;think(?:\s[^&]*)&gt;([\s\S]*?)&lt;\/think&gt;/gi;
const RAW_ORPHAN = /<think(?:\s[^>]*)?>[\s\S]*$/i;
const ESC_ORPHAN = /&lt;think(?:\s[^&]*)&gt;[\s\S]*$/i;

export function stripThinking(input: string): string {
  if (!input) return '';

  let output = input.replace(RAW_THINK_BLOCK, '').replace(ESC_THINK_BLOCK, '');
  output = output.replace(RAW_ORPHAN, '').replace(ESC_ORPHAN, '');
  return output.trim();
}

export function splitThinking(input: string): { thinking: string; answer: string } {
  if (!input) return { thinking: '', answer: '' };

  const parts: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = RAW_THINK_BLOCK.exec(input)) !== null) {
    if (match[1]) parts.push(match[1].trim());
  }

  while ((match = ESC_THINK_BLOCK.exec(input)) !== null) {
    if (!match[1]) continue;
    const unescaped = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (unescaped) parts.push(unescaped);
  }

  if (parts.length === 0) {
    const rawOpen = input.match(/<think(?:\s[^>]*)?>/i);
    if (rawOpen && typeof rawOpen.index === 'number') {
      const after = input.slice(rawOpen.index + rawOpen[0].length).trim();
      if (after) parts.push(after);
    } else {
      const escOpen = input.match(/&lt;think(?:\s[^&]*)&gt;/i);
      if (escOpen && typeof escOpen.index === 'number') {
        const after = input.slice(escOpen.index + escOpen[0].length).trim();
        const unescaped = after.replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        if (unescaped) parts.push(unescaped);
      }
    }
  }

  const answer = stripThinking(input);
  const thinking = parts.join('\n\n');
  return { thinking, answer };
}

const FALLBACK_MESSAGE = 'The response was cut off while generating. Please check the "Show thinking" section above for the partial content, or try asking again.';

export function deriveAnswerFromThinking(thinking: string, allowFallback = true): string {
  const t = (thinking || '').trim();
  if (!t) return '';

  const mdHeading = t.match(/^(#{1,3})\s+.+/m);
  if (mdHeading && typeof mdHeading.index === 'number') {
    return t.slice(mdHeading.index).trim();
  }

  const cues = [
    /^(?:final\s+answer|answer)\s*:/im,
    /^(?:response)\s*:/im,
    /(let\s+me\s+draft\s+the\s+response\s*:?)/i,
  ];
  for (const cue of cues) {
    const found = t.match(cue);
    if (found && typeof found.index === 'number') {
      return t.slice(found.index + found[0].length).trim();
    }
  }

  if (/^[-*]\s+.+/m.test(t)) {
    return t;
  }

  const lines = t.split('\n').map(line => line.trim()).filter(Boolean);
  const factualLines: string[] = [];
  const skipPrefixes = [
    'we need', 'we should', 'we must', 'according to', "let's", 'looking at',
    'the question', 'the user', 'based on', 'from context',
  ];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (skipPrefixes.some(prefix => lower.startsWith(prefix))) {
      continue;
    }
    if (/\[\d+\]/.test(line) && line.length > 30) {
      factualLines.push(line);
      continue;
    }
    if (/^[A-Z][a-z]+\s+(is|provides|offers)/.test(line) || /^It\s+(is|provides)/.test(line)) {
      factualLines.push(line);
    }
  }

  if (factualLines.length >= 2) {
    return factualLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  if (allowFallback && t.length > 200) {
    return FALLBACK_MESSAGE;
  }

  return '';
}

export function extractVisibleAnswer(raw: string): { answer: string; thinking: string } {
  if (!raw) return { answer: '', thinking: '' };
  const split = splitThinking(raw);
  let answer = split.answer.trim();
  const thinking = split.thinking.trim();

  if (!answer && thinking) {
    const derived = deriveAnswerFromThinking(thinking);
    if (derived) {
      answer = derived.trim();
    }
  }

  if (!answer) {
    answer = raw.trim();
  }

  return { answer, thinking };
}
