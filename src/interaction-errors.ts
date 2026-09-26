// Preserve explicit Chinese business feedback; browser/network implementation
// messages are replaced by the operation's Chinese retry instruction.
export function interactionError(value: unknown, fallback: string): string {
  if (value instanceof Error && !(value instanceof TypeError) && /[\u3400-\u9fff]/.test(value.message)) return value.message
  return fallback
}
