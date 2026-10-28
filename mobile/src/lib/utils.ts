import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names and lets a later Tailwind class win over an earlier one (React Native Reusables' helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
