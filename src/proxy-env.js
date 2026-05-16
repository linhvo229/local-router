import dns from "node:dns";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

export function configureNetworkFromEnv() {
  if (configured) return;
  configured = true;

  // Prefer IPv4 first because Node fetch can fail when IPv6 is advertised but unreachable.
  dns.setDefaultResultOrder?.("ipv4first");

  if (hasProxyEnv() || isInsecureTlsEnabled()) {
    setGlobalDispatcher(new EnvHttpProxyAgent(dispatcherOptions()));
  }
}

function dispatcherOptions() {
  if (!isInsecureTlsEnabled()) return {};
  return { connect: { rejectUnauthorized: false } };
}

function isInsecureTlsEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.LOCAL_ROUTER_INSECURE_TLS || "").toLowerCase());
}

function hasProxyEnv() {
  return Boolean(
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.NO_PROXY ||
    process.env.no_proxy,
  );
}
