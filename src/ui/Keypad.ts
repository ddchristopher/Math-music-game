/**
 * On-screen keypad for touch, plus the keyboard bindings.
 *
 * Both routes funnel into the same three callbacks so the game loop never has
 * to care which one the player used.
 */

export interface KeypadCallbacks {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onClear: () => void;
}

const LAYOUT = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'clear', '0', 'back'];

export class Keypad {
  private readonly root: HTMLElement;
  private readonly callbacks: KeypadCallbacks;
  private enabled = false;

  constructor(root: HTMLElement, callbacks: KeypadCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.build();
    window.addEventListener('keydown', this.handleKeyDown);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.classList.toggle('is-disabled', !enabled);
  }

  private build(): void {
    for (const key of LAYOUT) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key';
      button.dataset.key = key;

      if (key === 'back') {
        button.textContent = '⌫';
        button.setAttribute('aria-label', 'Backspace');
        button.classList.add('key--util');
      } else if (key === 'clear') {
        button.textContent = 'CLR';
        button.setAttribute('aria-label', 'Clear scratchpad');
        button.classList.add('key--util');
      } else {
        button.textContent = key;
      }

      // pointerdown, not click: on touch, click carries a ~300ms tail on some
      // browsers, and this game is scored on reaction time.
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.press(key);
      });
      this.root.appendChild(button);
    }
  }

  private press(key: string): void {
    if (!this.enabled) return;
    if (key === 'back') this.callbacks.onBackspace();
    else if (key === 'clear') this.callbacks.onClear();
    else this.callbacks.onDigit(key);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key >= '0' && event.key <= '9') {
      event.preventDefault();
      this.callbacks.onDigit(event.key);
      this.highlight(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.callbacks.onBackspace();
      this.highlight('back');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.callbacks.onSubmit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.callbacks.onClear();
    }
  };

  /** Light the matching on-screen key so keyboard input has visible feedback. */
  private highlight(key: string): void {
    const button = this.root.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!button) return;
    button.classList.remove('is-hit');
    void button.offsetWidth;
    button.classList.add('is-hit');
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
