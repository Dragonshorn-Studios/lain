import dgram from "node:dgram";
import net from "node:net";
import dnsPacket from "dns-packet";
import { ServiceRepository } from "../services/repository.js";

export class DnsServer {
  private udp?: dgram.Socket;
  private tcp?: net.Server;
  constructor(private readonly repository: ServiceRepository, private readonly host: string, private readonly port: number, private readonly upstream: string, private readonly proxyAddress = "127.0.0.1") {}
  async resolve(query: Buffer): Promise<Buffer> {
    const request = dnsPacket.decode(query);
    const answers: dnsPacket.Answer[] = [];
    for (const question of request.questions ?? []) {
      const service = this.repository.getByHostname(question.name.replace(/\.$/, ""));
      if (!service?.dnsEnabled || service.exposure === "public" || question.type !== "A") continue;
      const address = service.proxyEnabled ? this.proxyAddress : service.targetHost;
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) answers.push({ type: "A", name: question.name, ttl: 30, class: "IN", data: address });
    }
    if (answers.length) return dnsPacket.encode({ type: "response", id: request.id, flags: dnsPacket.AUTHORITATIVE_ANSWER, questions: request.questions, answers });
    return this.forward(query);
  }
  async start(): Promise<void> {
    this.udp = dgram.createSocket("udp4");
    this.udp.on("message", async (message, info) => { try { const response = await this.resolve(message); this.udp?.send(response, info.port, info.address); } catch { /* Ignore malformed DNS packets. */ } });
    await new Promise<void>((resolve) => this.udp!.bind(this.port, this.host, resolve));
    this.tcp = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on("data", async (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const length = buffer.readUInt16BE(0);
          if (buffer.length < length + 2) break;
          const query = buffer.subarray(2, length + 2); buffer = buffer.subarray(length + 2);
          try { const response = await this.resolve(query); const prefix = Buffer.alloc(2); prefix.writeUInt16BE(response.length); socket.write(Buffer.concat([prefix, response])); } catch { socket.destroy(); }
        }
      });
    });
    await new Promise<void>((resolve) => this.tcp!.listen(this.port, this.host, resolve));
  }
  async stop(): Promise<void> { this.udp?.close(); await new Promise<void>((resolve) => this.tcp?.close(() => resolve()) ?? resolve()); }
  private forward(query: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket("udp4");
      const timer = setTimeout(() => { socket.close(); reject(new Error("DNS upstream timed out")); }, 3_000);
      socket.once("message", (message) => { clearTimeout(timer); socket.close(); resolve(message); });
      socket.once("error", (error) => { clearTimeout(timer); socket.close(); reject(error); });
      socket.send(query, 53, this.upstream);
    });
  }
}
