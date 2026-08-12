const workspaceRoot = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return {
      shortCircuit: true,
      url: new URL(`${specifier.slice(2)}.ts`, workspaceRoot).href,
    };
  }

  return nextResolve(specifier, context);
}
