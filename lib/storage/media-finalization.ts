export async function writeDerivativeWithConditionalCommit(input: {
  write: () => Promise<void>;
  commit: () => Promise<boolean>;
  remove: () => Promise<void>;
}) {
  let committed = false;
  try {
    await input.write();
    committed = await input.commit();
    return committed;
  } finally {
    if (!committed) await input.remove();
  }
}
