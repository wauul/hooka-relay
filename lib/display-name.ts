import { z } from "zod";
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine(
    (value) => !/[\x00-\x1f\x7f]/.test(value),
    "Use a name without control characters.",
  );
export function userDisplayName(user: {
  displayName?: string | null;
  email: string;
}) {
  return user.displayName?.trim() || user.email.split("@")[0].slice(0, 40);
}
