const SEPARATOR = "__";

export function qualifyToolName(slug: string, tool: string): string {
  return `${slug}${SEPARATOR}${tool}`;
}

export function parseQualifiedToolName(qualified: string): { slug: string; tool: string } | null {
  const index = qualified.indexOf(SEPARATOR);
  if (index <= 0 || index === qualified.length - SEPARATOR.length) return null;
  return {
    slug: qualified.slice(0, index),
    tool: qualified.slice(index + SEPARATOR.length),
  };
}

export function assertSlug(slug: string): void {
  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Slug must start with a letter and use lowercase letters, digits, and single underscores");
  }
}

export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 40)
    .replace(/_+$/g, "");
  assertSlug(slug);
  return slug;
}
