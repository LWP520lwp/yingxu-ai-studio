import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
const ID_LENGTH = 21;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function randomId(): string {
  const random = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (!random) return createFallbackId();

  const bytes = random(new Uint8Array(ID_LENGTH));
  return Array.from(bytes, (byte) => ID_ALPHABET[byte & 63]).join("");
}

function createFallbackId() {
  const timeSeed = Date.now().toString(36);
  const randomSeed = Math.random().toString(36).slice(2);
  return `${timeSeed}${randomSeed}`.padEnd(ID_LENGTH, "0").slice(-ID_LENGTH);
}
