import workstationXml from "../fixtures/workstation.xml?raw";
import acceleratorXml from "../fixtures/accelerator-server.xml?raw";

export const fixtures = {
  workstation: workstationXml,
  accelerator: acceleratorXml
} as const;
