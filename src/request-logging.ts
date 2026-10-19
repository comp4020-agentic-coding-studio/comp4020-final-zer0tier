import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import type { RequestHandler } from "express";
import { playerFor } from "./auth.ts";
import { logEvent, ROOM } from "./logging.ts";
import { clientsInRoom } from "./realtime.ts";

// Installed before the JSON parser: even a malformed action has a receipt
// and a rejection. The finish event records responses actually sent to a user.
export const logRequest: RequestHandler = (req, res, next) => {
  const action = req.path; // Deliberately excludes query parameters.
  const request = `req_${randomUUID()}`;
  res.locals.logUser = playerFor(req.headers.cookie) ?? "anonymous";
  const fields = () => ({
    user: res.locals.logUser as string, room: ROOM, client_in_room: clientsInRoom(),
    request, action, method: req.method,
  });
  const isAction = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (isAction) logEvent("action", fields());

  let jsonResponse = false;
  let reason: string | undefined;
  const json = res.json;
  res.json = function (body: unknown) {
    jsonResponse = true;
    if (res.statusCode >= 400 && body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      reason = body.error;
    }
    return json.call(this, body);
  };
  res.once("finish", () => {
    if (res.statusCode >= 400) {
      logEvent("reject", {
        ...fields(), status: res.statusCode, reason: reason ?? STATUS_CODES[res.statusCode] ?? "Request failed",
      });
    } else if (jsonResponse && req.method !== "HEAD" && res.statusCode !== 204 && res.statusCode !== 304) {
      logEvent("snapshot", { ...fields(), status: res.statusCode, recipients: 1, transport: "http" });
    }
  });
  next();
};
