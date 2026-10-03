"use client";
import { useEffect } from "react";
import { reportUnexpected } from "@/lib/sentry-reporting";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { if (!error.digest) reportUnexpected(error, "react.render"); }, [error]);
  return <main id="main-content"><h1>This page is temporarily unavailable</h1><p>Please try again.</p><button onClick={reset}>Try again</button></main>;
}
