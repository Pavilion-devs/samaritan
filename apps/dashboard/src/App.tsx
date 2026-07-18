import { CasebookApp } from "./Casebook";
import { CommandApp } from "./Command";
import { MatchroomApp } from "./Matchroom";
import { ProofApp } from "./Proof";
import { StudyApp } from "./Study";

export function App() {
  if (window.location.pathname === "/matchroom") return <MatchroomApp />;
  if (window.location.pathname === "/casebook") return <CasebookApp />;
  if (window.location.pathname === "/study") return <StudyApp />;
  if (window.location.pathname === "/proof") return <ProofApp />;
  return <CommandApp />;
}
