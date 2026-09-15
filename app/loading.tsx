import { LoadingState } from "@/components/ui";
export default function Loading() {
  return (
    <main id="main-content" tabIndex={-1} className="content">
      <LoadingState label="Getting things ready…" />
    </main>
  );
}
