/**
 * Custom Express server.
 * Replaces @remix-run/serve for finer control.
 *
 * NOTE: Do NOT add express.json() or express.urlencoded() here.
 * Remix's createRequestHandler reads the raw request body directly;
 * Express body parsers would consume the stream and break form data parsing.
 */
import { createRequestHandler } from "@remix-run/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import { installGlobals } from "@remix-run/node";

installGlobals();

const app = express();
app.disable("x-powered-by");

// Compression + static assets (mirror @remix-run/serve setup)
app.use(compression());
app.use(express.static("public", { maxAge: "1h" }));

// Trust proxy for Railway's reverse proxy (x-forwarded-* headers)
app.set("trust proxy", 1);

// Logging
app.use(morgan("tiny"));

// Remix handles all routes — including body parsing
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
