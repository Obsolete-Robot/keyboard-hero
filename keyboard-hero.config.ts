export interface KeyboardHeroConfig {
  /**
   * Leave false for the full, unlocked game. Set true before creating the
   * itch.io demo build to keep one playable song per venue and lock the rest.
   */
  demoMode: boolean;
}

export const KEYBOARD_HERO_CONFIG: KeyboardHeroConfig = {
  demoMode: false,
};
