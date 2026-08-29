import type { Result } from "@/bindings";

export type SettingCommandResult = void | Result<unknown, string>;

/**
 * Run a generated settings command and turn its serialized `Result::Err`
 * into a rejected promise. Tauri invocation failures already reject; keeping
 * both failure shapes identical lets the store reliably roll back optimistic
 * state and lets callers decide how to recover.
 */
export const executeSettingCommand = async (
  command: () => Promise<SettingCommandResult>,
): Promise<void> => {
  const result = await command();
  if (result && result.status === "error") {
    throw new Error(result.error);
  }
};
