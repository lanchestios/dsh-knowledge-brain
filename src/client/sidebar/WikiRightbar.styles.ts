// Shared Tailwind recipes; interaction and state stay in the consuming components.
const styles: Record<string, string> = {
  "root": "wk:absolute wk:inset-0 wk:box-border wk:[border-left:1px_solid_var(--wk-alias-border-l1)] wk:bg-background wk:text-foreground wk:overflow-hidden wk:flex wk:flex-col",
  "head": "wk:flex-none wk:h-11 wk:flex wk:items-center wk:justify-between wk:pt-0 wk:pr-2 wk:pb-0 wk:pl-4 wk:[border-bottom:1px_solid_var(--wk-alias-border-l1)] wk:text-sm wk:leading-normal wk:font-sans wk:font-medium",
  "empty": "wk:p-4 wk:text-xs wk:leading-normal wk:font-sans wk:font-normal wk:text-muted-foreground",
  "acts": "wk:flex wk:items-center wk:gap-[2px] wk:flex-none",
  "session": "wk:flex-1 wk:min-h-0 wk:flex wk:flex-col wk:[&_>_*]:flex-1 wk:[&_>_*]:min-h-0 wk:[&[hidden]]:hidden",
  "lead": "wk:flex-1 wk:min-w-0 wk:flex wk:items-center wk:gap-[6px]",
  "title": "wk:flex-1 wk:min-w-0 wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap",
  "crumbs": "wk:min-w-0 wk:flex wk:items-center wk:overflow-hidden wk:whitespace-nowrap",
  "crumbSeg": "wk:min-w-0 wk:inline-flex wk:items-center wk:[&:last-child]:flex-1 wk:[&:not(:last-child)]:[flex:0_1_auto] wk:[&:not(:last-child)]:max-w-[40%]",
  "crumbSep": "wk:flex-none wk:py-0 wk:px-[6px] wk:text-muted-foreground",
  "crumb": "wk:min-w-0 wk:overflow-hidden wk:text-ellipsis wk:whitespace-nowrap wk:p-0 wk:border-0 wk:bg-transparent wk:[font-family:inherit] wk:text-[length:inherit] wk:leading-[inherit] wk:[font-weight:inherit] wk:text-secondary-foreground wk:cursor-pointer wk:[button&:hover]:text-foreground",
  "crumbCur": "wk:text-foreground wk:cursor-default",
  "props": "wk:flex-1 wk:min-h-0 wk:overflow-auto wk:[&_>_*]:h-auto wk:[&_>_*]:overflow-visible",
}
export default styles
