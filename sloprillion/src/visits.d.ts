// Types for visits.js, for the personal site's TypeScript build.
export function localDate(now?: Date): string
export function onLocalhost(): boolean
export function automated(): boolean
export function firstVisit(where: "site" | "game", date: string, home: string): { src: string; first: boolean }
export function countVisit(api: string, where: "site" | "game", home?: string): void
