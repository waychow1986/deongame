/** Animation durations in milliseconds (TD-013). Not shortened for reduced motion (G2 decision I2). */
export const MOVE_MS = 300;
export const FLIP_MS = 320;
export const CAPTURE_MS = 260;
export const DEAL_CARD_MS = 120;
export const COLLECT_MS = 380;
export const REVEAL_MS = 260;
/** Upper bound after which the snapshot queue moves on even if the board did not report completion. */
export const ANIM_WATCHDOG_MS = MOVE_MS + FLIP_MS + CAPTURE_MS + 600;
