/**
 * Click-and-drag horizontal scrolling for wide tables / panels.
 * Installed once app-wide; only activates when the container overflows.
 */

const SCROLL_SELECTOR = [
  ".tablewrap",
  ".jod-tablewrap",
  ".vdash-tablewrap",
  ".vdash-ack-scroll",
  ".vq-scroll",
  ".vq-ack-items-scroll",
  ".jo-materials-scroll",
  ".jo-view-items-wrap",
  ".jo-view-qc-wrap",
  ".jo-orders-wrap",
  "[data-drag-scroll]",
].join(",");

const IGNORE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "summary",
  "[role='button']",
  "[contenteditable='true']",
  ".col-filter-btn",
  ".col-filter-panel",
  ".col-filter-menu",
  ".jo-more-btn",
  ".jo-more-menu",
  ".jod-act-btns",
  ".jod-act-btn",
].join(",");

const DRAG_THRESHOLD_PX = 4;

function canScrollX(el) {
  return el && el.scrollWidth > el.clientWidth + 1;
}

function enableDragScroll() {
  if (typeof document === "undefined") return () => {};
  if (document.documentElement.dataset.dragScrollBound === "1") {
    return () => {};
  }
  document.documentElement.dataset.dragScrollBound = "1";

  let active = null;

  function endDrag() {
    if (!active) return;
    const { el, moved, pointerId } = active;
    try {
      if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    el.classList.remove("is-dragging");
    if (moved) {
      // Block the click that fires after a drag so buttons aren't triggered.
      const blockClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.removeEventListener("click", blockClick, true);
      };
      el.addEventListener("click", blockClick, true);
      setTimeout(() => el.removeEventListener("click", blockClick, true), 0);
    }
    active = null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target?.closest?.(IGNORE_SELECTOR)) return;

    const el = e.target?.closest?.(SCROLL_SELECTOR);
    if (!el || !canScrollX(el)) return;

    active = {
      el,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      moved: false,
    };

    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e) {
    if (!active || active.pointerId !== e.pointerId) return;

    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;

    if (!active.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      // Prefer horizontal intent; abandon if mostly vertical.
      if (Math.abs(dy) > Math.abs(dx)) {
        endDrag();
        return;
      }
      active.moved = true;
      active.el.classList.add("is-dragging");
    }

    e.preventDefault();
    active.el.scrollLeft = active.scrollLeft - dx;
  }

  function onPointerUp(e) {
    if (!active || active.pointerId !== e.pointerId) return;
    endDrag();
  }

  function onPointerOver(e) {
    const el = e.target?.closest?.(SCROLL_SELECTOR);
    if (!el) return;
    el.classList.toggle("can-h-scroll", canScrollX(el));
  }

  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  document.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
  document.addEventListener("pointercancel", onPointerUp, { capture: true, passive: true });
  document.addEventListener("pointerover", onPointerOver, { capture: true, passive: true });

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("pointerover", onPointerOver, true);
    delete document.documentElement.dataset.dragScrollBound;
  };
}

export { enableDragScroll, SCROLL_SELECTOR };
