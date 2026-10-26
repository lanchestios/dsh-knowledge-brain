declare module '*.module.css' { const classes: Readonly<Record<string, string>>; export default classes }
declare module '*.css' { const noop: void; export default noop }
