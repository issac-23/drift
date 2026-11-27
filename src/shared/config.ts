// Every tunable number for the ball, panel and fade lives here.

export const BALL_SIZE = 56
export const PANEL_WIDTH = 372
export const PANEL_HEIGHT = 460
export const GAP = 8
// Space around the ball/panel so the soft shadow is not clipped.
export const WINDOW_PAD = 14

// One fixed-size window holds the ball plus the panel on either side of it.
export const WINDOW_WIDTH = PANEL_WIDTH + GAP + BALL_SIZE + WINDOW_PAD * 2
export const WINDOW_HEIGHT = PANEL_HEIGHT + WINDOW_PAD * 2

export const OPEN_DELAY_MS = 120
export const CLOSE_DELAY_MS = 350
export const IDLE_FADE_MS = 3500

export const OPACITY_ACTIVE = 1
export const OPACITY_IDLE = 0.22
export const FADE_TRANSITION_MS = 450

// Pointer movement (px) before a press on the ball counts as a drag, not a click.
export const DRAG_THRESHOLD_PX = 4

// Gap kept between the ball and the work-area edge when first placed.
export const DEFAULT_MARGIN = 28

export const WATCH_DEBOUNCE_MS = 120
export const POSITION_SAVE_DEBOUNCE_MS = 300
// One retry after a transient read error (antivirus or sync client holding the file).
// Delays between re-reads when the data file is briefly locked (antivirus, OneDrive).
export const READ_RETRY_DELAYS_MS = [250, 1000, 3000]
// A write that finds the file unparseable looks again after this long before setting it aside.
export const CORRUPT_RECHECK_MS = 150
// How long a failed-save notice stays in the panel.
export const NOTICE_MS = 4000

export const MAX_TITLE_LENGTH = 500

// Cross-process lock around data file writes.
export const LOCK_STALE_MS = 5000
export const LOCK_TIMEOUT_MS = 10_000
export const LOCK_RETRY_MIN_MS = 5
export const LOCK_RETRY_MAX_MS = 40

// Reloading the page after a renderer crash: at most this many reloads per window, each delayed a bit longer.
export const RENDERER_MAX_RELOADS = 3
export const RENDERER_CRASH_WINDOW_MS = 60_000
export const RENDERER_RELOAD_DELAY_MS = 1000

// How often the foreground window is checked for a fullscreen app on the ball's display.
export const FULLSCREEN_POLL_MS = 1000
// Slack (physical px) when deciding a window covers its whole monitor.
export const FULLSCREEN_TOLERANCE_PX = 2

// Cloud sync with tend: how often to poll, and how long to wait after a local edit before pushing.
export const SYNC_POLL_MS = 60_000
export const SYNC_PUSH_DELAY_MS = 1500
