import { Brand } from "./shell";
import { Users } from "lucide-react";
export function InviteLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="invite-page" id="main-content">
      <header>
        <Brand />
        <span className="invite-label">WORKSPACE INVITATION</span>
      </header>
      <div className="invite-card">
        <div className="invite-icon">
          <Users size={28} />
        </div>
        {children}
      </div>
      <footer>Hooka Relay � Reliable delivery, together.</footer>
    </main>
  );
}
