import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);

test("worker in-flight guard skips overlapping ticks and accepts the next tick after completion", async () => {
  const moduleUrl = pathToFileURL(`${process.cwd()}/scripts/worker-in-flight.mjs`).href;
  const script = `
    import { createInFlightGuard } from ${JSON.stringify(moduleUrl)};
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    let started;
    const didStart = new Promise((resolve) => { started = resolve; });
    let calls = 0;
    const guarded = createInFlightGuard(async () => {
      calls += 1;
      started();
      await blocked;
    });
    const first = guarded();
    await didStart;
    const overlap = await guarded();
    release();
    const firstResult = await first;
    const nextResult = await guarded();
    process.stdout.write(JSON.stringify({ calls, overlap, firstResult, nextResult }));
  `;

  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script]);
  expect(JSON.parse(stdout)).toEqual({
    calls: 2,
    overlap: false,
    firstResult: true,
    nextResult: true
  });
});
