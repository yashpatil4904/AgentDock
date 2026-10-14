/** A container image with an explicit tag. Ports in a registry host are allowed. */
export function assertImageRef(image: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,200}$/.test(image) || !/:[A-Za-z0-9._-]+$/.test(image)) {
    throw new Error("Image must include a tag, for example ghcr.io/org/server:1.0.0");
  }
}
