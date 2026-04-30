import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/** Merges Tailwind CSS class strings, resolving conflicts in favor of the last value. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
