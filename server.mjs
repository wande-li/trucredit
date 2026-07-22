/**
 * Custom Express server with increased body parser limits.
 * Replaces @remix-run/serve (which defaults to 100kb).
 */
import { createRequestHandler } from "@remix-run/express";
import express from "express";
import { installGlobals } from "@remix-run/node";

installGlobals();

const app = express();

// Increase body parser limits for large webhook payloads and form submissions
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Trust proxy for Railway's reverse proxy (x-forwarded-* headers)
app.set("trust proxy", 1);

// Remix request handler
app.all(
  "*",
  createRequestHandler({
    build: await import("./build/server/index.js"),
  }),
);

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`TruCredit server running on port ${port}`);
});
