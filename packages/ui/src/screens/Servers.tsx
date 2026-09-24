import { GuildList } from "../components/Sidebar.tsx";

/** Phone: the server list that lives in the sidebar on desktop. */
export function ServersScreen() {
  return (
    <div className="flex-1 overflow-y-auto bg-bg">
      <div className="px-4 pb-6 pt-5">
        <h1 className="mb-3 px-2 text-[22px] font-bold">Servers</h1>
        <GuildList />
      </div>
    </div>
  );
}
