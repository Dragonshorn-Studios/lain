#!/usr/bin/env node
import type { ServiceWithStatus } from "@lain/shared";
import { setupHelp, setupUbuntu } from "./setup.js";

const baseUrl = process.env.LAIN_URL ?? "http://localhost:3100";
const [command = "help", subject] = process.argv.slice(2);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

try {
  if (command === "status") {
    const health = await request<{ status: string; adapterMode: string }>("/api/health");
    const services = await request<ServiceWithStatus[]>("/api/services");
    console.log(`laind: ${health.status} (${health.adapterMode} adapters)`);
    console.log(`services: ${services.length}, healthy: ${services.filter((service) => service.status.healthy).length}`);
  } else if (command === "services" || (command === "service" && subject === "list")) {
    const services = await request<ServiceWithStatus[]>("/api/services");
    if (!services.length) console.log("No services registered.");
    for (const service of services) console.log(`${service.id}\t${service.hostname}\t${service.targetHost}:${service.targetPort}\t${service.status.healthy === null ? "pending" : service.status.healthy ? "healthy" : "unhealthy"}`);
  } else if (command === "reconcile") {
    const id = subject;
    await request(id ? `/api/services/${id}/reconcile` : "/api/reconcile", { method: "POST" });
    console.log(id ? `Reconciled ${id}.` : "Reconciled all services.");
  } else if (command === "setup") {
    if (subject !== "ubuntu") console.log(setupHelp);
    else await setupUbuntu(process.argv.slice(4));
  } else {
    console.log(`lainctl — control the Lain service registry

Usage:
  lainctl status
  lainctl services
  lainctl reconcile [service-id]
  lainctl setup ubuntu [options]

Environment:
  LAIN_URL  API URL (default: http://localhost:3100)`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
