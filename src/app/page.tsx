import { readFileSync } from "node:fs";
import path from "node:path";
import Desk from "./Desk";

// Default data: the files in /data. Uploads on the page replace them in the browser.
function load(name: string): string {
  try {
    return readFileSync(path.join(process.cwd(), "data", name), "utf8");
  } catch {
    return "";
  }
}

export default function Page() {
  return (
    <Desk
      defaultPools={load("royalpalm_pools.csv")}
      defaultReadings={load("royalpalm_readings.csv")}
    />
  );
}
