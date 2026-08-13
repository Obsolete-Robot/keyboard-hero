export type MotionPreference = "system" | "full" | "reduced";

export function normalizeMotionPreference(value: unknown): MotionPreference {
  return value === "full" || value === "reduced" ? value : "system";
}

export function shouldReduceMotion(
  preference: MotionPreference,
  systemPrefersReducedMotion: boolean,
): boolean {
  if (preference === "full") return false;
  if (preference === "reduced") return true;
  return systemPrefersReducedMotion;
}

export function resolveReducedMotion(preference: MotionPreference): boolean {
  const systemPrefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return shouldReduceMotion(preference, systemPrefersReducedMotion);
}
