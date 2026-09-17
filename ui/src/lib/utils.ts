import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn/ui helper: merge conditional class lists without Tailwind class collisions. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
