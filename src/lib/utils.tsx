import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrencyString(amount: number) {
  return `ر.س ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCurrency(amount: number) {
  return (
    <span className="inline-flex items-baseline gap-1" dir="ltr">
      <span className="font-thmanyah">ر.س</span>
      <span>{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </span>
  );
}

export function calculateCountedHours(durationMs: number): number {
  const totalMinutes = Math.floor(durationMs / 1000 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  
  if (remainingMinutes >= 15) {
    return hours + 1;
  }
  return hours;
}

export function calculateEarned(durationMs: number, hourlyRate: number): number {
  const totalMinutes = Math.floor(durationMs / 1000 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  
  // A 15-minute working in a new hour is considered a full hour and is rounded up
  let billedHours = hours;
  if (remainingMinutes >= 15) {
    if (billedHours === 0 && hours === 0) {
      billedHours = 1;
    } else {
      billedHours += 1;
    }
  }

  return billedHours * hourlyRate;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num: number) => num.toString().padStart(2, '0');
  
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
