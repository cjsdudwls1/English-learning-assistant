export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}


