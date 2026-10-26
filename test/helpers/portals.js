import { afterEach } from 'vitest'
import { act } from 'react'

// Real Radix dialogs portal outside the mounting element. Query the rendered
// surface, and unmount roots before deleting DOM so focus scopes can clean up.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
export function trackRoot(root, host) { mounted.push({ root, host }) }
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove() }
})
export function portalView(host) {
  const surface = '[data-wiki-dialog], [data-slot="dropdown-menu-content"], [data-slot="select-content"]'
  const dialogs = () => [...document.querySelectorAll(surface)].filter((el) => !el.parentElement?.closest(surface))
  return {
    querySelector: (selector) => dialogs().map((d) => d.querySelector(selector)).find(Boolean) ?? host.querySelector(selector),
    querySelectorAll: (selector) => [...host.querySelectorAll(selector), ...dialogs().flatMap((d) => [...d.querySelectorAll(selector)])],
    get textContent() { return host.textContent + dialogs().map((d) => d.textContent).join('') },
    get innerHTML() { return host.innerHTML + dialogs().map((d) => d.innerHTML).join('') },
  }
}
