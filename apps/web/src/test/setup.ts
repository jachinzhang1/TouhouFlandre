// jsdom 30 + vitest 3.2 组合下全局 localStorage getter 返回 undefined，
// 从 jsdom 实例直接注入（见 vitest populateGlobal 的 getter 链问题）。
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom?.window?.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: dom.window.localStorage,
    configurable: true,
  });
}
