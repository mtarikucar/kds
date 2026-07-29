// Refcounted body scroll lock shared by every full-screen overlay (Modal,
// the POS CartDrawer, …). Without a single shared refcount, an overlay that
// closes earlier than another one stacked over/under it would restore body
// scroll while the other surface is still on screen — the page suddenly
// scrolls under the visible overlay. Each overlay acquires on open and
// releases on close/unmount; the body style only changes on the 0↔1 edges.
let scrollLockRefcount = 0;

export function acquireBodyScrollLock() {
  scrollLockRefcount += 1;
  if (scrollLockRefcount === 1) {
    document.body.style.overflow = 'hidden';
  }
}

export function releaseBodyScrollLock() {
  scrollLockRefcount = Math.max(0, scrollLockRefcount - 1);
  if (scrollLockRefcount === 0) {
    document.body.style.overflow = 'unset';
  }
}
