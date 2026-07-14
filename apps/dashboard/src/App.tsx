import { CasebookApp } from "./Casebook";
import { CommandApp } from "./Command";
import { MatchroomApp } from "./Matchroom";
import { StudyApp } from "./Study";

export function App() {
  if (window.location.pathname === "/matchroom") return <MatchroomApp />;
  if (window.location.pathname === "/casebook") return <CasebookApp />;
  if (window.location.pathname === "/study") return <StudyApp />;
  return <CommandApp />;
}
