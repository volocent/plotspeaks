// Ambient declarations for non-code imports bundled by wrangler (esbuild).
declare module "*.txt" {
  const text: string;
  export default text;
}
