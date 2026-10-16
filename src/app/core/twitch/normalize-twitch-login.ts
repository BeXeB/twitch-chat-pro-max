export function normalizeTwitchLogin(input: string): string | null {
  const login = input.trim().replace(/^@/, '');

  return /^[a-zA-Z0-9_]{1,25}$/.test(login) ? login : null;
}
