export const cx = (...cls: (string | false | null | undefined)[]) => cls.filter(Boolean).join(' ')
