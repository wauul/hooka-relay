export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startObservability } = await import("./lib/observability-runtime");
    startObservability("web");
  }
}
