type NativeImport = (specifier: string) => Promise<unknown>;

// Keep import() behind a runtime compiler boundary. TypeScript rewrites a
// directly-authored import() to require() when emitting this project as CJS,
// and require() cannot load the runner/wasm .mjs entry points.
const nativeImport = new Function(
  "specifier",
  "return import(specifier);"
) as NativeImport;

export function importNativeModule(specifier: string): Promise<unknown> {
  return nativeImport(specifier);
}
