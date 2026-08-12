export interface SelectableMIDIInput {
  id: string;
  name: string | null;
  state: "connected" | "disconnected";
}

const inputName = (input: SelectableMIDIInput): string =>
  input.name?.trim().toLowerCase() ?? "";

const isControlPort = (input: SelectableMIDIInput): boolean =>
  /\b(daw|plugin|software control|control|din)\b/i.test(inputName(input));

/** Picks a likely performance keyboard when the user has no saved preference. */
export function chooseAutomaticMIDIInput<T extends SelectableMIDIInput>(
  inputs: readonly T[],
): T | null {
  const connectedInputs = inputs.filter((input) => input.state === "connected");
  const officialMPKInput = connectedInputs.find(
    (input) =>
      !isControlPort(input) &&
      inputName(input).endsWith("mpk mini iv midi port"),
  );
  const exactMPKInput = connectedInputs.find(
    (input) => inputName(input) === "mpk mini iv",
  );
  const performanceMPKInput = connectedInputs.find((input) => {
    const name = inputName(input);
    return (
      !isControlPort(input) &&
      (name.includes("mpk mini iv") || name.includes("mpk mini 4"))
    );
  });
  const nonControlInput = connectedInputs.find((input) => !isControlPort(input));

  return (
    officialMPKInput ??
    exactMPKInput ??
    performanceMPKInput ??
    nonControlInput ??
    null
  );
}
