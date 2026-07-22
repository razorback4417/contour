import { describe, expect, it } from "vitest";
import { detectSshSession, formatServerReady, sshTarget } from "../src/cli/presentation";

describe("CLI startup guidance", () => {
  it("reports an opened local browser without SSH noise", () => {
    const output = formatServerReady("http://127.0.0.1:4177/", { host: "127.0.0.1", port: 4177, openRequested: true, browserOpened: true, sshSession: false });
    expect(output).toContain("Opened in your default browser");
    expect(output).not.toContain("ssh -N");
  });

  it("prints a copyable tunnel command for a remote loopback server", () => {
    const output = formatServerReady("http://127.0.0.1:4199/", { host: "127.0.0.1", port: 4199, openRequested: false, browserOpened: false, sshSession: true, sshTarget: "engineer@linux-host" });
    expect(output).toContain("ssh -N -L 4199:127.0.0.1:4199 engineer@linux-host");
    expect(output).toContain("Then open http://127.0.0.1:4199/");
  });

  it("recognizes common SSH environment variables", () => {
    expect(detectSshSession({ SSH_CONNECTION: "client server" })).toBe(true);
    expect(detectSshSession({})).toBe(false);
    expect(sshTarget({ USER: "ubuntu", SSH_CONNECTION: "10.0.0.2 52000 10.0.0.8 22" }, "remote-host")).toBe("ubuntu@10.0.0.8");
  });
});
