import http from "node:http";
import https from "node:https";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";
import type { Socket } from "node:net";
import httpProxy from "http-proxy";
import { ServiceRepository } from "../services/repository.js";

const hostnameFrom = (host: string | undefined) => (host ?? "").split(":")[0].toLowerCase();

export class ProxyServer {
  private readonly proxy = httpProxy.createProxyServer({ xfwd: true, ws: true, changeOrigin: false });
  private server?: http.Server;
  private tlsServer?: https.Server;
  constructor(private readonly repository: ServiceRepository, private readonly host: string, private readonly port: number, private readonly tlsPort: number, private readonly certificateDir: string) {
    this.proxy.on("error", (_error, _request, response) => {
      if ("writeHead" in response && !response.headersSent) response.writeHead(502, { "Content-Type": "text/plain" });
      response.end("Lain could not reach the upstream service.");
    });
  }
  async start(): Promise<void> {
    const handler: http.RequestListener = (request, response) => {
      const service = this.repository.getByHostname(hostnameFrom(request.headers.host));
      if (!service?.proxyEnabled) { response.writeHead(404, { "Content-Type": "text/plain" }); response.end("No managed service for this hostname."); return; }
      this.proxy.web(request, response, { target: `${service.targetProtocol}://${service.targetHost}:${service.targetPort}` });
    };
    const upgrade = (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
      const service = this.repository.getByHostname(hostnameFrom(request.headers.host));
      if (!service?.proxyEnabled) { socket.destroy(); return; }
      this.proxy.ws(request, socket, head, { target: `${service.targetProtocol}://${service.targetHost}:${service.targetPort}` });
    };
    this.server = http.createServer(handler);
    this.server.on("upgrade", upgrade);
    await new Promise<void>((resolve) => this.server!.listen(this.port, this.host, resolve));
    const certificate = this.firstCertificate();
    if (certificate) {
      this.tlsServer = https.createServer({ ...certificate, SNICallback: (hostname, callback) => {
        try { callback(null, tls.createSecureContext(this.certificateFor(hostname))); }
        catch (error) { callback(error as Error); }
      } }, handler);
      this.tlsServer.on("upgrade", upgrade);
      await new Promise<void>((resolve) => this.tlsServer!.listen(this.tlsPort, this.host, resolve));
    }
  }
  async stop(): Promise<void> { await Promise.all([new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve()), new Promise<void>((resolve) => this.tlsServer?.close(() => resolve()) ?? resolve())]); }
  private certificateFor(hostname: string) { return { key: readFileSync(join(this.certificateDir, `${hostname}.key`)), cert: readFileSync(join(this.certificateDir, `${hostname}.crt`)) }; }
  private firstCertificate() {
    if (!existsSync(this.certificateDir)) return undefined;
    const certificate = readdirSync(this.certificateDir).find((file) => file.endsWith(".crt"));
    return certificate ? this.certificateFor(certificate.slice(0, -4)) : undefined;
  }
}
