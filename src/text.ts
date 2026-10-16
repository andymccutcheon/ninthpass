export const MAX_TEXT = 200_000;

export function boundedText(text: string, label = 'Input'): string {
  if (!text.trim() || text.length > MAX_TEXT) throw new Error(`${label} must contain 1–${MAX_TEXT} characters.`);
  return text;
}
