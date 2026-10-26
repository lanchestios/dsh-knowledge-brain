// Shared Tailwind recipes; interaction and state stay in the consuming components.
const styles: Record<string, string> = {
  "root": "wk:[--wk-done:#2a78d6] wk:[--wk-todo:#eb6834] wk:dark:[--wk-done:#3987e5] wk:dark:[--wk-todo:#d95926]",
  "page": "wk:max-w-270 wk:my-0 wk:mx-auto wk:py-9 wk:px-10 wk:flex wk:flex-col wk:gap-[14px] wk:[@container_(max-width:_700px)]:py-6 wk:[@container_(max-width:_700px)]:px-4",
  "headrow": "wk:flex wk:items-end wk:gap-4",
  "h1": "wk:text-2xl wk:leading-normal wk:font-sans wk:font-normal wk:m-0",
  "meta": "wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-secondary-foreground",
  "spark": "wk:ml-auto wk:flex wk:items-end wk:gap-[3px] wk:h-7 wk:[&_b]:w-2 wk:[&_b]:h-7 wk:[&_b]:flex wk:[&_b]:flex-col wk:[&_b]:gap-[1px] wk:[&_b]:rounded-[2px_2px_0_0] wk:[&_b]:overflow-hidden wk:[&_b_i]:block",
  "bar": "wk:flex wk:items-center wk:gap-2 wk:flex-wrap",
  "go": "wk:ml-auto",
  "name": "wk:cursor-pointer wk:[&:hover]:underline",
  "empty": "wk:p-10 wk:text-center wk:text-muted-foreground",
  "panel": "wk:p-4 wk:flex wk:flex-col wk:gap-3 wk:[border-bottom:1px_solid_var(--wk-alias-border-l1)]",
  "lbl": "wk:text-xs wk:leading-normal wk:font-sans wk:font-medium wk:text-secondary-foreground wk:mb-[2px]",
  "link": "wk:block wk:border-0 wk:bg-transparent wk:p-0 wk:text-left wk:text-sm wk:leading-normal wk:font-sans wk:font-normal wk:text-[var(--wk-alias-link)] wk:cursor-pointer",
  "muted": "wk:text-muted-foreground",
}
export default styles
