// Simple module-level scroll state shared between DOM and R3F
let _progress = 0;

export function getScrollProgress() {
  return _progress;
}

export function setScrollProgress(v: number) {
  _progress = v;
}
