export type EndpointState = "ACTIVE" | "PAUSED";
export function endpointTransition(_current: EndpointState, action: "pause" | "resume"): EndpointState {
  return action === "pause" ? "PAUSED" : "ACTIVE";
}
