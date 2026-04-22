const CURSOR_ID = "ai-cursor";
const CURSOR_VISIBLE_CLASS = "ai-cursor-visible";

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
}

class AICursor {
  private cursor: HTMLElement | null = null;
  private activeTarget: HTMLElement | null = null;

  init() {
    if (typeof document === "undefined") {
      return null;
    }

    if (this.cursor?.isConnected) {
      return this.cursor;
    }

    const existing = document.getElementById(CURSOR_ID);
    if (existing) {
      this.cursor = existing;
      return existing;
    }

    const cursor = document.createElement("div");
    cursor.id = CURSOR_ID;
    cursor.setAttribute("aria-hidden", "true");
    document.body.appendChild(cursor);
    this.cursor = cursor;
    return cursor;
  }

  show() {
    const cursor = this.init();
    cursor?.classList.add(CURSOR_VISIBLE_CLASS);
  }

  hide() {
    if (typeof document === "undefined") {
      return;
    }

    const cursor = this.cursor ?? document.getElementById(CURSOR_ID);
    cursor?.classList.remove(CURSOR_VISIBLE_CLASS, "ai-cursor-click");

    if (this.activeTarget) {
      this.activeTarget.classList.remove("ai-cursor-hover");
      this.activeTarget = null;
    }
  }

  async moveTo(element?: HTMLElement | null) {
    if (!element || typeof window === "undefined") {
      return;
    }

    const cursor = this.init();
    if (!cursor) {
      return;
    }

    this.show();
    await nextFrame();

    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + Math.min(Math.max(rect.height * 0.35, 10), 26));

    cursor.style.setProperty("--ai-cursor-x", `${x}px`);
    cursor.style.setProperty("--ai-cursor-y", `${y}px`);

    await wait(240);
  }

  hover(element?: HTMLElement | null) {
    if (!element) {
      return;
    }

    if (this.activeTarget && this.activeTarget !== element) {
      this.activeTarget.classList.remove("ai-cursor-hover");
    }

    element.classList.add("ai-cursor-hover");
    this.activeTarget = element;
  }

  unhover(element?: HTMLElement | null) {
    if (!element) {
      return;
    }

    element.classList.remove("ai-cursor-hover");

    if (this.activeTarget === element) {
      this.activeTarget = null;
    }
  }

  async click(element?: HTMLElement | null, onClick?: () => void) {
    if (!element || typeof window === "undefined") {
      return;
    }

    const cursor = this.init();
    if (!cursor) {
      return;
    }

    this.hover(element);
    await this.moveTo(element);

    cursor.classList.remove("ai-cursor-click");
    void cursor.offsetWidth;
    cursor.classList.add("ai-cursor-click");

    this.createRipple(element);
    onClick?.();

    await wait(180);
    cursor.classList.remove("ai-cursor-click");
    this.unhover(element);
  }

  private createRipple(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ai-click-ripple";
    ripple.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    ripple.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
    document.body.appendChild(ripple);

    window.setTimeout(() => {
      ripple.remove();
    }, 520);
  }
}

export const aiCursor = new AICursor();
