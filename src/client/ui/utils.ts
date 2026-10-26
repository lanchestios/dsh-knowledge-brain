import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const merge = extendTailwindMerge({ prefix: 'wk' })
export const cn = (...inputs: ClassValue[]) => merge(clsx(inputs))
