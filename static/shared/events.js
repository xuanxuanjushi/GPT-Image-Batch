const bus = new EventTarget();

export function emit(eventName, detail = {}) {
  bus.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function on(eventName, handler) {
  const listener = (event) => handler(event.detail);
  bus.addEventListener(eventName, listener);
  return () => bus.removeEventListener(eventName, listener);
}

