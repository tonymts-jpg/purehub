export function createInFlightGuard(operation) {
  let inFlight = false;
  return async function runIfIdle() {
    if (inFlight) return false;
    inFlight = true;
    try {
      await operation();
      return true;
    } finally {
      inFlight = false;
    }
  };
}
