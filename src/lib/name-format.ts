export function formatName(name: string | null | undefined) {
  return (name ?? "").trim().replace(/\b\w/g, (character) => character.toUpperCase());
}
