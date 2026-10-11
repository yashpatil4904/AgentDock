/**
 * Chat replies are markdown. Some models emit a whole table on one line, which
 * will not parse until each row is on its own line.
 */
export function formatReply(text: string): string {
  let result = text.replace(/\r\n/g, "\n").trim();
  if (!result.includes("|") || !/\|[\s|:-]*-{3,}[\s|:-]*\|/.test(result)) return result;
  if (!result.includes("\n")) result = result.replace(/\| \|/g, "|\n|");
  result = result.replace(/^(\*\*[^*\n]+\*\*)\s+(\|)/, "$1\n\n$2");
  const lines = result.split("\n").flatMap((line) => {
    const match = line.match(/^(.*\|)\s+([^|]+)$/);
    if (!match?.[1]?.trim().startsWith("|") || !match[2]) return [line];
    return [match[1].trimEnd(), "", match[2].trim()];
  });
  return lines.join("\n");
}
