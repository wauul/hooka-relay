"use client";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { filterTelemetry } from "@/lib/telemetry";
export function Telemetry() { return <><Analytics beforeSend={filterTelemetry} /><SpeedInsights beforeSend={filterTelemetry} /></>; }
