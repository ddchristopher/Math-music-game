/**
 * Settings, persisted to localStorage.
 *
 * `reducedMotion` defaults to the OS preference — a player who has asked their
 * system for less motion should not have to ask again here.
 */

const KEY = 'mmg.settings.v1';

export interface Settings {
  volume: number;
  muted: boolean;
  reducedMotion: boolean;
  /** When true, Enter is required instead of auto-submitting on digit count. */
  requireEnter: boolean;
  highContrast: boolean;
}

export function defaultSettings(): Settings {
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  return {
    volume: 0.8,
    muted: false,
    reducedMotion: prefersReduced,
    requireEnter: false,
    highContrast: false,
  };
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    return { ...base, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* not fatal */
  }
}

export interface SettingsPanelCallbacks {
  onChange: (settings: Settings) => void;
}

export class SettingsPanel {
  private readonly root: HTMLElement;
  private settings: Settings;
  private readonly callbacks: SettingsPanelCallbacks;

  constructor(root: HTMLElement, settings: Settings, callbacks: SettingsPanelCallbacks) {
    this.root = root;
    this.settings = settings;
    this.callbacks = callbacks;
    this.bind();
    this.sync();
  }

  get value(): Settings {
    return this.settings;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
  }

  private bind(): void {
    const volume = this.input('#set-volume');
    volume.addEventListener('input', () => {
      this.settings.volume = Number(volume.value) / 100;
      this.commit();
    });

    for (const [selector, key] of [
      ['#set-muted', 'muted'],
      ['#set-reduced-motion', 'reducedMotion'],
      ['#set-require-enter', 'requireEnter'],
      ['#set-high-contrast', 'highContrast'],
    ] as const) {
      const input = this.input(selector);
      input.addEventListener('change', () => {
        (this.settings[key] as boolean) = input.checked;
        this.commit();
      });
    }
  }

  private sync(): void {
    this.input('#set-volume').value = String(Math.round(this.settings.volume * 100));
    this.input('#set-muted').checked = this.settings.muted;
    this.input('#set-reduced-motion').checked = this.settings.reducedMotion;
    this.input('#set-require-enter').checked = this.settings.requireEnter;
    this.input('#set-high-contrast').checked = this.settings.highContrast;
  }

  private commit(): void {
    saveSettings(this.settings);
    this.callbacks.onChange(this.settings);
  }

  private input(selector: string): HTMLInputElement {
    const el = this.root.querySelector<HTMLInputElement>(selector);
    if (!el) throw new Error(`Missing settings control: ${selector}`);
    return el;
  }
}
