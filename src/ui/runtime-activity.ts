import type { RuntimeObservation } from "../runtime/types";

export interface RuntimeActivityGroup {
  observation: RuntimeObservation;
  endIndex: number;
  count: number;
  targets: number;
  category: "container" | "file" | "network" | "process";
  kinds: Set<RuntimeObservation["kind"]>;
}

export function groupRuntimeActivity(
  observations: RuntimeObservation[],
): RuntimeActivityGroup[] {
  const groups: RuntimeActivityGroup[] = [];
  observations.forEach((observation, index) => {
    const previous = groups.at(-1);
    const sameBurst = previous
      && previous.category === activityCategory(observation)
      && Math.abs(
        timestampMs(previous.observation.observedAt) - timestampMs(observation.observedAt),
      ) <= 100;
    if (!sameBurst) {
      groups.push({
        observation,
        endIndex: index,
        count: 1,
        targets: 1,
        category: activityCategory(observation),
        kinds: new Set([observation.kind]),
      });
      return;
    }
    const targets = new Set(
      observations
        .slice(previous.endIndex - previous.count + 1, index + 1)
        .map(runtimeActivityTarget),
    );
    previous.observation = observation;
    previous.endIndex = index;
    previous.count += 1;
    previous.targets = targets.size;
    previous.kinds.add(observation.kind);
  });
  return groups;
}

export function activityGroupLabel(group: RuntimeActivityGroup): string {
  if (group.kinds.size === 1) return group.observation.kind.replaceAll("_", " ");
  const labels: Record<RuntimeActivityGroup["category"], string> = {
    container: "container lifecycle activity",
    file: "filesystem activity",
    network: "TCP connection activity",
    process: "process lifecycle activity",
  };
  return labels[group.category];
}

export function runtimeActivityTarget(observation: RuntimeObservation): string {
  if (observation.fileDescriptor?.path) return observation.fileDescriptor.path;
  if (observation.connection) {
    return `${observation.connection.destination.address}:${observation.connection.destination.port}`;
  }
  if (observation.process?.currentWorkingDirectory) {
    return observation.process.currentWorkingDirectory;
  }
  if (observation.container?.containerId) return truncate(observation.container.containerId, 24);
  return observation.process?.name ?? "execution";
}

function activityCategory(
  observation: RuntimeObservation,
): RuntimeActivityGroup["category"] {
  if (observation.kind.startsWith("file_")) return "file";
  if (observation.kind.startsWith("tcp_")) return "network";
  if (observation.kind.startsWith("container_")) return "container";
  return "process";
}

function timestampMs(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2"));
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
